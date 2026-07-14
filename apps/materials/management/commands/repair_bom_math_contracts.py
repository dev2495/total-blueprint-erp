from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.materials.models import InventoryMaterial, PouchStyleMaster, ProductMasterSize, ProductVariant
from apps.materials.services_pouch_style import infer_formula_roll_axis, normalize_formula_axis
from apps.materials.services_product_variant import find_or_create_product_variant
from apps.sales.models import SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService


TERMINAL_LINE_STATUSES = {"CANCELLED", "SHORT_CLOSED", "COMPLETED"}
PRE_RELEASE_LINE_STATUSES = {"", "OPEN", "PLANNING_REQUIRED", "PLANNED"}


def _layer_uses_material(layers, *, code: str, material_id: str) -> bool:
    wanted_code = str(code or "").strip().upper()
    wanted_id = str(material_id or "").strip()
    for layer in layers if isinstance(layers, list) else []:
        if not isinstance(layer, dict):
            continue
        codes = {
            str(layer.get("material_code") or "").strip().upper(),
            str(layer.get("film_variant_code") or "").strip().upper(),
            str(layer.get("base_material_code") or "").strip().upper(),
        }
        ids = {
            str(layer.get("variant_id") or "").strip(),
            str(layer.get("material_id") or "").strip(),
        }
        if wanted_code in codes or wanted_id in ids:
            return True
    return False


class Command(BaseCommand):
    help = (
        "Audit or repair BOM formula-axis contracts, the approved TT/BOPP density, "
        "variant caches, and mutable sales/planner snapshots. Default is dry-run."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply changes. Default is dry-run.")
        parser.add_argument(
            "--bopp-density",
            default="0.9200",
            help="Approved density for the film family used by the TT variant.",
        )
        parser.add_argument(
            "--replan-pristine-released",
            action="store_true",
            help="Return affected released-but-unstarted orders to planning before snapshot rebuild.",
        )

    @staticmethod
    def _style_repairs():
        repairs = []
        for style in PouchStyleMaster.objects.all().order_by("code", "version"):
            inferred = infer_formula_roll_axis(style.formula_kind, style.formula_params, style.formula_ast)
            declared = normalize_formula_axis(style.default_roll_axis)
            if inferred and inferred != declared:
                repairs.append((style, inferred))
        return repairs

    @staticmethod
    def _tt_variant():
        return (
            InventoryMaterial.objects.select_related("parent_family")
            .filter(code__iexact="TT", category="FILM_VARIANT", status="ACTIVE")
            .first()
        )

    @staticmethod
    def _pristine_release_reason(item):
        from apps.costing.models import JobRuntimeSession
        from apps.inventory.models import InventoryRoll
        from apps.production.models import (
            DowntimeLog,
            InventoryAllocation,
            JobExecutionLog,
            JobMaterialRequirement,
            MaterialConsumptionLog,
            ProductionJob,
            ScrapLog,
            WorkCenterAssignment,
        )

        line_status = str(item.line_status or "").upper()
        order_status = str(item.sales_order.status or "").upper()
        if line_status in TERMINAL_LINE_STATUSES:
            return f"line status is {line_status}"
        if order_status in {"COMPLETED", "CANCELLED"}:
            return f"order status is {order_status}"
        master = getattr(item, "product_master", None)
        if master is None:
            return "line has no Product Master revision"
        if not master.active or not master.is_current_version:
            return f"Product Master {master.code} is inactive or superseded"

        jobs = list(ProductionJob.objects.filter(sales_order_item=item).exclude(job_state="CANCELLED"))
        job_ids = [job.id for job in jobs]
        for job in jobs:
            state = str(job.job_state or "").upper()
            status = str(job.status or "").upper()
            if state not in {"PLANNED", "WAITING", "RELEASED"}:
                return f"job {job.job_number} state is {state}"
            if status != "QUEUED":
                return f"job {job.job_number} status is {status}"
            if job.machine_id or job.operator_id or job.start_date or job.end_date or Decimal(str(job.produced_qty or 0)) > 0:
                return f"job {job.job_number} has execution state"
        if job_ids:
            for model in (JobExecutionLog, ScrapLog, DowntimeLog, MaterialConsumptionLog):
                if model.objects.filter(production_job_id__in=job_ids).exists():
                    return f"{model.__name__} records exist"
            if JobRuntimeSession.objects.filter(job_id__in=job_ids).exists():
                return "runtime sessions exist"
            if WorkCenterAssignment.objects.filter(
                production_job_id__in=job_ids,
                assigned_machine_id__isnull=False,
            ).exists():
                return "machine assignment exists"
            if JobMaterialRequirement.objects.filter(production_job_id__in=job_ids).filter(
                Q(assigned_qty__gt=0) | Q(actual_issued_qty__gt=0) | Q(consumed_qty__gt=0)
            ).exists():
                return "material has been allocated, issued, or consumed"
        if InventoryAllocation.objects.filter(sales_order=item.sales_order).exists():
            return "planner inventory allocation exists"
        if InventoryRoll.objects.filter(sales_order_item=item).exists():
            return "finished or WIP stock exists"
        return ""

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        replan_pristine = bool(options.get("replan_pristine_released"))
        try:
            approved_density = Decimal(str(options.get("bopp_density") or "0.9200"))
        except Exception as exc:
            raise CommandError("--bopp-density must be numeric.") from exc
        if approved_density <= 0:
            raise CommandError("--bopp-density must be greater than zero.")

        style_repairs = self._style_repairs()
        style_ids = {str(style.id) for style, _axis in style_repairs}
        affected_master_ids = set(
            str(value)
            for value in ProductMasterSize.objects.filter(
                pouch_style_master_id__in=style_ids,
                active=True,
                product_master__active=True,
                product_master__is_current_version=True,
            ).values_list("product_master_id", flat=True)
        )

        tt = self._tt_variant()
        if not tt or not tt.parent_family_id:
            raise CommandError("Active TT film variant with a parent BOPP family was not found.")
        density_change = Decimal(str(tt.parent_family.density_gcm3 or 0)) != approved_density

        variants = []
        for variant in (
            ProductVariant.objects.select_related("master")
            .filter(active=True, master__active=True, master__is_current_version=True)
            .order_by("created_at")
        ):
            if str(variant.master_id) in affected_master_ids or _layer_uses_material(
                variant.layer_snapshot,
                code=tt.code,
                material_id=str(tt.id),
            ):
                variants.append(variant)
                affected_master_ids.add(str(variant.master_id))

        affected_items = []
        for item in SalesOrderItem.objects.select_related("sales_order", "product_master").all().order_by("created_at"):
            geometry = item.geometry_snapshot if isinstance(item.geometry_snapshot, dict) else {}
            if (
                str(item.product_master_id or "") in affected_master_ids
                or str(geometry.get("pouch_style_master") or "") in style_ids
                or _layer_uses_material(item.layer_snapshot, code=tt.code, material_id=str(tt.id))
            ):
                affected_items.append(item)

        released = [
            item
            for item in affected_items
            if str(item.line_status or "").upper() not in PRE_RELEASE_LINE_STATUSES | TERMINAL_LINE_STATUSES
            or str(item.sales_order.status or "").upper() not in {"DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"}
        ]
        pristine_released = []
        blocked_released = []
        for item in released:
            reason = self._pristine_release_reason(item)
            if reason:
                blocked_released.append((item, reason))
            else:
                pristine_released.append(item)

        # An order can return to planning only when every active released line
        # on it is part of this pristine repair set.
        pristine_ids = {str(item.id) for item in pristine_released}
        grouped = defaultdict(list)
        for item in pristine_released:
            grouped[str(item.sales_order_id)].append(item)
        replan_items = []
        for order_id, candidates in grouped.items():
            unsafe_sibling = SalesOrderItem.objects.filter(sales_order_id=order_id).exclude(
                line_status__in=TERMINAL_LINE_STATUSES
            ).exclude(id__in=pristine_ids).exclude(line_status__in=PRE_RELEASE_LINE_STATUSES).exists()
            if unsafe_sibling:
                for item in candidates:
                    blocked_released.append((item, "another active line on the same order cannot be replanned"))
            else:
                replan_items.extend(candidates)

        mutable_candidates = [
            item
            for item in affected_items
            if str(item.line_status or "").upper() in PRE_RELEASE_LINE_STATUSES
            and str(item.sales_order.status or "").upper()
            in {"DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"}
        ]
        legacy_preserved = [
            item
            for item in mutable_candidates
            if item.product_master is None
            or not item.product_master.active
            or not item.product_master.is_current_version
        ]
        mutable_ids = {
            str(item.id)
            for item in mutable_candidates
            if item not in legacy_preserved
        }
        if replan_pristine:
            mutable_ids.update(str(item.id) for item in replan_items)

        self.stdout.write(f"Formula-axis styles requiring correction: {len(style_repairs)}")
        for style, axis in style_repairs:
            self.stdout.write(f"- {style.code} v{style.version}: {style.default_roll_axis} -> {axis}")
        self.stdout.write(
            f"TT/BOPP density: {tt.parent_family.density_gcm3 or 0} -> {approved_density} "
            f"({'change' if density_change else 'already correct'})"
        )
        self.stdout.write(f"Variant caches to rebuild: {len(variants)}")
        self.stdout.write(f"Affected sales lines found: {len(affected_items)}")
        self.stdout.write(f"Mutable lines to refresh: {len(mutable_ids)}")
        self.stdout.write(f"Pristine released lines eligible to replan: {len(replan_items)}")
        self.stdout.write(f"Released/executed lines preserved: {len(blocked_released)}")
        for item, reason in blocked_released[:40]:
            self.stdout.write(f"- PRESERVE {item.sales_order.order_number} / {item.id}: {reason}")
        self.stdout.write(f"Legacy inactive-master lines preserved: {len(legacy_preserved)}")
        for item in legacy_preserved[:40]:
            code = getattr(item.product_master, "code", "") if item.product_master else "NO-MASTER"
            self.stdout.write(f"- PRESERVE {item.sales_order.order_number} / {item.id}: {code}")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply after reviewing the audit."))
            return
        if blocked_released:
            self.stdout.write(
                self.style.WARNING(
                    "Blocked released lines will remain immutable; use a controlled variance/replan after physical review."
                )
            )

        with transaction.atomic():
            now = timezone.now()
            for style, axis in style_repairs:
                note = str(style.notes or "").strip()
                audit_note = f"BOM math incident repair: corrected roll axis {style.default_roll_axis} -> {axis}."
                style.default_roll_axis = axis
                style.notes = f"{note}\n{audit_note}".strip() if audit_note not in note else note
                style.updated_at = now
                style.save(update_fields=["default_roll_axis", "notes", "updated_at"])

            if density_change:
                tt.parent_family.density_gcm3 = approved_density
                tt.parent_family.save(update_fields=["density_gcm3", "updated_at"])

            rebuilt_variants = 0
            for variant in variants:
                find_or_create_product_variant(variant.master, variant.axis_values or {}, code=variant.code)
                rebuilt_variants += 1

            if replan_pristine and replan_items:
                from apps.production.models import ProductionJob

                replan_order_ids = set()
                for item in replan_items:
                    ProductionJob.objects.filter(
                        sales_order_item=item,
                        job_state="RELEASED",
                        status="QUEUED",
                    ).update(job_state="PLANNED", updated_at=now)
                    item.line_status = "PLANNED"
                    item.save(update_fields=["line_status"])
                    replan_order_ids.add(item.sales_order_id)
                SalesOrder.objects.filter(id__in=replan_order_ids).update(status="PLANNED")

            refresh_stats = SalesOrderService.refresh_open_snapshots_for_items(
                SalesOrderItem.objects.filter(id__in=mutable_ids),
                reason="BOM_MATH_CONTRACT_REPAIR",
                raise_on_error=True,
            )
            if refresh_stats.get("failed"):
                raise CommandError(f"Snapshot refresh failed: {refresh_stats}")

        self.stdout.write(self.style.SUCCESS(f"Corrected {len(style_repairs)} formula-axis contracts."))
        self.stdout.write(self.style.SUCCESS(f"Rebuilt {rebuilt_variants} ProductVariant caches."))
        self.stdout.write(self.style.SUCCESS(f"Snapshot refresh: {refresh_stats}"))
