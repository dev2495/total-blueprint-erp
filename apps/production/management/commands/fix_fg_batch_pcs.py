from collections import defaultdict
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP

from django.core.management.base import BaseCommand
from django.db.models import Sum

from apps.production.models import FinishedGoodsBatch


class Command(BaseCommand):
    help = (
        "Fix historical FG batch PCS values for bulk-output jobs by deriving "
        "PCS from qty_kg and sales_order_item.unit_weight_g."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--so",
            dest="so_number",
            default=None,
            help="Optional Sales Order number filter (e.g. SO00001).",
        )
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Apply changes. Without this flag, command runs in dry-run mode.",
        )

    def handle(self, *args, **options):
        so_number = options.get("so_number")
        apply_changes = bool(options.get("apply"))

        qs = FinishedGoodsBatch.objects.filter(
            production_job__output_form="BULK",
            sales_order_item__isnull=False,
        ).select_related("production_job", "sales_order_item", "sales_order_item__sales_order")
        if so_number:
            qs = qs.filter(sales_order_item__sales_order__order_number=so_number)

        batches = list(qs)
        total_candidates = len(batches)
        self.stdout.write(f"Scanning {total_candidates} FG batch rows...")

        if total_candidates == 0:
            self.stdout.write(self.style.WARNING("No FG batches matched filters."))
            return

        batches_by_job = defaultdict(list)
        for batch in batches:
            batches_by_job[str(batch.production_job_id or batch.id)].append(batch)

        updated = 0
        skipped = 0
        for _, job_batches in batches_by_job.items():
            job = job_batches[0].production_job
            job_expected_total = None
            if job and str(job.uom or "").upper() == "PCS" and Decimal(str(job.produced_qty or 0)) > 0:
                job_expected_total = int(
                    Decimal(str(job.produced_qty or 0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
                )

            expected_total_map = {}
            if job_expected_total is not None and len(job_batches) > 0:
                total_job_kg = sum(Decimal(str(b.qty_kg or 0)) for b in job_batches)
                if total_job_kg > 0:
                    weighted_rows = []
                    allocated = 0
                    for b in job_batches:
                        share = (Decimal(job_expected_total) * Decimal(str(b.qty_kg or 0))) / total_job_kg
                        floored = int(share.to_integral_value(rounding=ROUND_FLOOR))
                        weighted_rows.append((b, share, floored))
                        allocated += floored
                    remainder = max(0, job_expected_total - allocated)
                    weighted_rows.sort(key=lambda row: (row[1] - Decimal(row[2])), reverse=True)
                    for idx, (b, _share, floored) in enumerate(weighted_rows):
                        expected_total_map[str(b.id)] = floored + (1 if idx < remainder else 0)
                else:
                    # If weights are unavailable, assign all PCS to first row.
                    for idx, b in enumerate(job_batches):
                        expected_total_map[str(b.id)] = job_expected_total if idx == 0 else 0
            else:
                for b in job_batches:
                    unit_weight = Decimal(str(getattr(b.sales_order_item, "unit_weight_g", 0) or 0))
                    qty_kg = Decimal(str(b.qty_kg or 0))
                    if unit_weight > 0 and qty_kg > 0:
                        expected_total_map[str(b.id)] = int(
                            ((qty_kg * Decimal("1000")) / unit_weight).quantize(
                                Decimal("1"), rounding=ROUND_HALF_UP
                            )
                        )
                    else:
                        expected_total_map[str(b.id)] = int(b.qty_pcs or 0)

            for batch in job_batches:
                packed_qty = int(
                    batch.packing_units.aggregate(total=Sum("qty_pcs")).get("total") or 0
                )
                expected_total = max(0, int(expected_total_map.get(str(batch.id), batch.qty_pcs or 0)))
                expected_remaining = max(0, expected_total - packed_qty)

                current_remaining = int(batch.qty_pcs or 0)
                current_dispatched = int(batch.dispatched_qty_pcs or 0)
                next_dispatched = min(current_dispatched, expected_total)
                next_status = batch.status
                if expected_remaining <= 0 and batch.status == "AVAILABLE":
                    next_status = "PACKED"
                elif expected_remaining > 0 and batch.status == "PACKED":
                    next_status = "AVAILABLE"

                if (
                    current_remaining == expected_remaining
                    and current_dispatched == next_dispatched
                    and next_status == batch.status
                ):
                    skipped += 1
                    continue

                self.stdout.write(
                    f"- {batch.batch_number} | packed={packed_qty} | remaining {current_remaining} -> {expected_remaining} | "
                    f"dispatched {current_dispatched} -> {next_dispatched} | status {batch.status} -> {next_status}"
                )
                if apply_changes:
                    FinishedGoodsBatch.objects.filter(id=batch.id).update(
                        qty_pcs=expected_remaining,
                        dispatched_qty_pcs=next_dispatched,
                        status=next_status,
                    )
                    updated += 1

        mode = "APPLY" if apply_changes else "DRY-RUN"
        self.stdout.write(
            self.style.SUCCESS(
                f"[{mode}] Done. Updated={updated}, Skipped={skipped}, Total={total_candidates}"
            )
        )
