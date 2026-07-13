from __future__ import annotations

import json
from copy import deepcopy

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.factory.models import Process
from apps.materials.models import InventoryMaterial, MaterialCodeAlias, ProductMaster
from apps.materials.services_product_master_rebase import rebase_open_sales_lines_to_current_master
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint
from apps.templates.services import TemplateGovernanceService


# These are confirmed historical aliases from the production incident.  They
# preserve the material identity; they do not guess substitutions by name.
KNOWN_FILM_ALIASES = {
    "PP": "PP-SHEET",
    "PP-TUBING": "PP-MONO",
    "LD-GREY": "LD-GREY-MONOLAYER",
    "LDNAT-ML": "LD-NAT",
}

# Only an evidence-backed legacy process name belongs here.  New aliases must
# be reviewed rather than silently changing a manufacturing route.
KNOWN_ROUTE_ALIASES = {
    "BOPP Sheet Fold": "Sheet Seal",
}

# Legacy masters that pre-date template lineage.  Every entry is a reviewed
# business mapping, not a fuzzy name match.  PLAIN-POD is a roll using the
# Multilayer LD extrusion route; Multilayer Tubing is its current LIVE route.
KNOWN_MASTER_TEMPLATE_FALLBACKS = {
    "PLAIN-POD": "Multilayer Tubing",
}

# These groups were retired by the former "clone on every save" behaviour
# without a current replacement.  The selected versions are the latest
# verified specifications for those exact product families.  The template
# targets were verified to have the same manufacturing route as the former
# template, so this repairs the lineage without changing the product itself.
KNOWN_ORPHANED_MASTER_RESTORATIONS = {
    "BOPP-BAGS": {
        "master_code": "BOPP-BAGS-V31",
        "template_name": "SILVER BOPP BAGS - BMC PRT",
    },
    "MLD-LDNAT": {
        "master_code": "MLD-LDNAT-V20",
        "template_name": "MLD",
    },
}

# This Flexo master was recreated under a corrected commercial family key,
# not a version of its former key. Both records use the verified current
# Bottom Sealing (Flexo Printing) route and share the affected 13x18 size.
# It therefore needs an explicit redirect instead of a version-group rebase.
KNOWN_LEGACY_MASTER_REDIRECTS = {
    "FLEXO-PRT-BOTTOM-SEALING": "FLEXO-PRT-BOTTOM-SEALING-2",
}

LAYER_OPTION_KEYS = {
    "allowed_film_variant_codes",
    "alternate_film_variant_codes",
    "allowed_alternate_film_variant_codes",
    "allowed_material_codes",
    "alternate_material_codes",
    "material_options",
    "film_variant_options",
}


class Command(BaseCommand):
    help = (
        "Repair known legacy material/template/route references and revise only untouched open demand. "
        "Runs in dry-run mode unless --apply is supplied."
    )

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply deterministic repairs.")
        parser.add_argument("--skip-open-order-revision", action="store_true", help="Do not refresh eligible open order snapshots/queues.")

    @transaction.atomic
    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        skip_order_revision = bool(options.get("skip_open_order_revision"))
        report = {
            "mode": "apply" if apply_changes else "dry_run",
            "aliases": {"planned": 0, "applied": 0, "unresolved": []},
            "orphaned_master_families": {"planned": 0, "applied": 0, "unresolved": []},
            "product_masters": {"planned": 0, "applied": 0, "unresolved": []},
            "template_bindings": {"planned": 0, "applied": 0, "unresolved": []},
            "routes": {"planned": 0, "applied": 0, "unresolved": []},
            "open_order_revision": {},
            "stale_order_rebase": {"updated": 0, "skipped": 0, "failed": 0, "groups": 0},
            "legacy_master_redirects": {"updated": 0, "skipped": 0, "failed": 0, "groups": 0, "unresolved": []},
        }

        targets = {
            code: InventoryMaterial.objects.filter(code__iexact=target, category="FILM_VARIANT", status="ACTIVE").first()
            for code, target in KNOWN_FILM_ALIASES.items()
        }
        for alias, target in targets.items():
            if not target:
                report["aliases"]["unresolved"].append({"alias": alias, "target": KNOWN_FILM_ALIASES[alias]})
                continue
            existing = MaterialCodeAlias.objects.filter(alias__iexact=alias).first()
            if existing and existing.material_id == target.id and existing.active:
                continue
            report["aliases"]["planned"] += 1
            if apply_changes:
                MaterialCodeAlias.objects.update_or_create(
                    alias=alias,
                    defaults={
                        "material": target,
                        "category": "FILM_VARIANT",
                        "active": True,
                        "notes": "Production legacy-code continuity repair.",
                    },
                )
                report["aliases"]["applied"] += 1

        # Repair only the evidence-backed groups above.  A broad "latest row
        # wins" rule would be unsafe for masters that were intentionally
        # retired or replaced by a different commercial product.
        for version_group, restoration in KNOWN_ORPHANED_MASTER_RESTORATIONS.items():
            master = ProductMaster.objects.filter(
                version_group=version_group,
                code=restoration["master_code"],
            ).first()
            template = TemplateBlueprint.objects.filter(
                name=restoration["template_name"],
                status="LIVE",
                is_current_version=True,
            ).first()
            if not master or not template:
                report["orphaned_master_families"]["unresolved"].append(
                    {
                        "version_group": version_group,
                        "master_code": restoration["master_code"],
                        "template_name": restoration["template_name"],
                    }
                )
                continue
            already_current = (
                master.active
                and master.is_current_version
                and master.template_id == template.id
                and master.default_template_id == template.id
            )
            if already_current:
                continue
            report["orphaned_master_families"]["planned"] += 1
            if apply_changes:
                ProductMaster.objects.filter(version_group=version_group).exclude(id=master.id).update(
                    active=False,
                    is_current_version=False,
                )
                ProductMaster.objects.filter(id=master.id).update(
                    active=True,
                    is_current_version=True,
                    template=template,
                    default_template=template,
                )
                report["orphaned_master_families"]["applied"] += 1

        material_by_id = {str(row.id): row for row in InventoryMaterial.objects.filter(category="FILM_VARIANT", status="ACTIVE")}
        material_by_code = {str(row.code).upper(): row for row in material_by_id.values()}
        material_by_code.update({alias.upper(): target for alias, target in targets.items() if target})

        for master in ProductMaster.objects.filter(active=True, is_current_version=True).order_by("name", "code"):
            layer_template, layer_changed, unresolved_a = _normalise_layers(master.layer_template, material_by_id, material_by_code)
            canonical_stack, stack_changed, unresolved_b = _normalise_layers(master.canonical_layer_stack, material_by_id, material_by_code)
            if unresolved_a or unresolved_b:
                report["product_masters"]["unresolved"].append(
                    {"id": str(master.id), "code": master.code, "refs": sorted(set(unresolved_a + unresolved_b))}
                )
            if not (layer_changed or stack_changed):
                continue
            report["product_masters"]["planned"] += 1
            if apply_changes:
                master.layer_template = layer_template
                master.canonical_layer_stack = canonical_stack
                master.save(update_fields=["layer_template", "canonical_layer_stack", "updated_at"])
                report["product_masters"]["applied"] += 1

        for master in ProductMaster.objects.filter(active=True, is_current_version=True).select_related("template", "default_template"):
            expected = _current_live_template(master.template) or _current_live_template(master.default_template)
            if not expected:
                fallback_name = KNOWN_MASTER_TEMPLATE_FALLBACKS.get(master.version_group or master.code)
                if fallback_name:
                    expected = TemplateBlueprint.objects.filter(
                        name=fallback_name,
                        status="LIVE",
                        is_current_version=True,
                    ).first()
            if not expected:
                report["template_bindings"]["unresolved"].append({"id": str(master.id), "code": master.code})
                continue
            if master.template_id == expected.id and master.default_template_id == expected.id:
                continue
            report["template_bindings"]["planned"] += 1
            if apply_changes:
                ProductMaster.objects.filter(id=master.id).update(template=expected, default_template=expected)
                report["template_bindings"]["applied"] += 1

        route_target_exists = {target: Process.objects.filter(code=target).exists() for target in KNOWN_ROUTE_ALIASES.values()}
        touched_routes = []
        for route in RoutingRule.objects.all().order_by("name"):
            ordered = list(route.ordered_processes or [])
            corrected = [KNOWN_ROUTE_ALIASES.get(str(code), str(code)) for code in ordered]
            if corrected == ordered:
                continue
            missing_targets = sorted({code for code in corrected if code in KNOWN_ROUTE_ALIASES.values() and not route_target_exists.get(code)})
            if missing_targets:
                report["routes"]["unresolved"].append({"id": str(route.id), "name": route.name, "missing_processes": missing_targets})
                continue
            report["routes"]["planned"] += 1
            if apply_changes:
                route.ordered_processes = corrected
                route.save(update_fields=["ordered_processes", "updated_at"])
                touched_routes.append(route.id)
                report["routes"]["applied"] += 1

        if apply_changes and touched_routes:
            for template in TemplateBlueprint.objects.filter(routing_rule_id__in=touched_routes).prefetch_related("process_steps"):
                TemplateGovernanceService.apply_route_sync(template, destructive=False)

        if apply_changes and not skip_order_revision:
            # This service rejects any allocation, release, execution, stock, or
            # material issue before writing.  It is safe to call over every
            # active current master: only mutable demand is revised.
            with transaction.atomic():
                report["open_order_revision"] = SalesOrderService.refresh_open_snapshots_for_items(
                    SalesOrderItem.objects.filter(product_master__active=True, product_master__is_current_version=True),
                    reason="PRODUCTION_INTEGRITY_REPAIR",
                )
                # Historical Product Master versions are deliberately excluded
                # from the direct refresh above. Rebase only their mutable
                # lines onto each current master; released/allocated/started
                # lines are left frozen by the same service-level guard.
                for current in ProductMaster.objects.filter(active=True, is_current_version=True).order_by("version_group", "code"):
                    result = rebase_open_sales_lines_to_current_master(current, current)
                    if not any(result.get(key, 0) for key in ("updated", "skipped", "failed")):
                        continue
                    report["stale_order_rebase"]["groups"] += 1
                    for key in ("updated", "skipped", "failed"):
                        report["stale_order_rebase"][key] += int(result.get(key, 0) or 0)

                # A small number of validated replacements use a corrected
                # family identity, so they cannot be discovered by the
                # normal same-version-group scan above.
                for source_group, current_code in KNOWN_LEGACY_MASTER_REDIRECTS.items():
                    source = ProductMaster.objects.filter(version_group=source_group).order_by("-version", "-updated_at").first()
                    current = ProductMaster.objects.filter(
                        code=current_code,
                        active=True,
                        is_current_version=True,
                    ).first()
                    if not source or not current:
                        report["legacy_master_redirects"]["unresolved"].append(
                            {"source_group": source_group, "current_code": current_code}
                        )
                        continue
                    result = rebase_open_sales_lines_to_current_master(source, current)
                    if not any(result.get(key, 0) for key in ("updated", "skipped", "failed")):
                        continue
                    report["legacy_master_redirects"]["groups"] += 1
                    for key in ("updated", "skipped", "failed"):
                        report["legacy_master_redirects"][key] += int(result.get(key, 0) or 0)
        elif skip_order_revision:
            report["open_order_revision"] = {"status": "skipped_by_flag"}
        else:
            report["open_order_revision"] = {"status": "dry_run"}

        self.stdout.write(json.dumps(report, sort_keys=True, default=str))
        if report["aliases"]["unresolved"]:
            raise CommandError("One or more required film alias targets are missing; no claim of complete repair was made.")


def _current_live_template(template):
    if not template:
        return None
    if str(template.status or "").upper() == "LIVE" and bool(template.is_current_version):
        return template
    candidates = TemplateBlueprint.objects.filter(version_group=template.version_group, status="LIVE", is_current_version=True).order_by("-version", "-updated_at")
    return candidates.first()


def _normalise_layers(rows, material_by_id, material_by_code):
    if not isinstance(rows, list):
        return rows, False, []
    out = deepcopy(rows)
    changed = False
    unresolved = []
    for row in out:
        if not isinstance(row, dict):
            continue
        material_id = str(row.get("film_variant_id") or row.get("material_id") or row.get("variant_id") or "").strip()
        code = str(row.get("film_variant_code") or row.get("material_code") or row.get("code") or row.get("layer") or "").strip()
        material = material_by_id.get(material_id) or material_by_code.get(code.upper())
        if not material:
            if code:
                unresolved.append(code)
            continue
        for key, value in (("film_variant_id", str(material.id)), ("film_variant_code", material.code)):
            if row.get(key) != value:
                row[key] = value
                changed = True
        for key in ("material_code", "code"):
            if key in row and row.get(key) != material.code:
                row[key] = material.code
                changed = True
        for key in LAYER_OPTION_KEYS:
            if key not in row:
                continue
            value, value_changed = _normalise_option_value(row.get(key), material_by_code)
            if value_changed:
                row[key] = value
                changed = True
    return out, changed, unresolved


def _normalise_option_value(value, material_by_code):
    if isinstance(value, list):
        rows = [_normalise_option_value(item, material_by_code) for item in value]
        canonical = [item for item, _ in rows]
        deduped = []
        seen = set()
        for item in canonical:
            if isinstance(item, dict):
                identity = next(
                    (
                        str(item.get(key) or "").strip().casefold()
                        for key in ("code", "material_code", "film_variant_code", "value")
                        if str(item.get(key) or "").strip()
                    ),
                    json.dumps(item, sort_keys=True, default=str, separators=(",", ":")).casefold(),
                )
            else:
                identity = str(item or "").strip().casefold()
            if identity in seen:
                continue
            seen.add(identity)
            deduped.append(item)
        return deduped, len(deduped) != len(canonical) or any(changed for _, changed in rows)
    if isinstance(value, dict):
        out = {}
        changed = False
        for key, item in value.items():
            if key in {"code", "material_code", "film_variant_code", "value"} and str(item or "").strip().upper() in material_by_code:
                out[key] = material_by_code[str(item).strip().upper()].code
                changed = out[key] != item
            else:
                out[key], nested_changed = _normalise_option_value(item, material_by_code)
                changed = changed or nested_changed
        return out, changed
    material = material_by_code.get(str(value or "").strip().upper())
    if material and material.code != value:
        return material.code, True
    return value, False
