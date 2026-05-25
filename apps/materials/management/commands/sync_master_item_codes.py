from __future__ import annotations

from copy import deepcopy

from django.core.management.base import BaseCommand

from apps.materials.models import InventoryMaterial, ProductMaster, ProductVariant


class Command(BaseCommand):
    help = "Refresh Product Master and Product Variant JSON snapshots after master item code changes."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report changes without saving.")

    def handle(self, *args, **options):
        dry_run = bool(options.get("dry_run"))
        material_by_id = {
            str(row.id): row
            for row in InventoryMaterial.objects.filter(category="FILM_VARIANT").only("id", "code")
        }

        master_changes = 0
        variant_changes = 0
        unresolved = 0

        for master in ProductMaster.objects.all().only("id", "code", "layer_template", "canonical_layer_stack"):
            layer_template, changed_a, unresolved_a = _sync_layer_rows(master.layer_template, material_by_id)
            canonical_stack, changed_b, unresolved_b = _sync_layer_rows(master.canonical_layer_stack, material_by_id)
            unresolved += unresolved_a + unresolved_b
            if changed_a or changed_b:
                master_changes += 1
                if not dry_run:
                    master.layer_template = layer_template
                    master.canonical_layer_stack = canonical_stack
                    master.save(update_fields=["layer_template", "canonical_layer_stack", "updated_at"])

        for variant in ProductVariant.objects.all().only("id", "code", "layer_snapshot"):
            layer_snapshot, changed, unresolved_count = _sync_layer_rows(variant.layer_snapshot, material_by_id)
            unresolved += unresolved_count
            if changed:
                variant_changes += 1
                if not dry_run:
                    variant.layer_snapshot = layer_snapshot
                    variant.save(update_fields=["layer_snapshot", "updated_at"])

        mode = "would update" if dry_run else "updated"
        self.stdout.write(
            self.style.SUCCESS(
                f"{mode} {master_changes} product masters and {variant_changes} product variants; unresolved layer refs: {unresolved}"
            )
        )


def _sync_layer_rows(rows, material_by_id):
    if not isinstance(rows, list):
        return rows, False, 0
    out = deepcopy(rows)
    changed = False
    unresolved = 0
    for row in out:
        if not isinstance(row, dict):
            continue
        material_id = str(row.get("film_variant_id") or row.get("material_id") or row.get("variant_id") or "").strip()
        if not material_id:
            code = str(row.get("film_variant_code") or row.get("material_code") or row.get("code") or "").strip()
            material = None
            if code:
                material = InventoryMaterial.objects.filter(category="FILM_VARIANT", code__iexact=code).only("id", "code").first()
            if material:
                row["film_variant_id"] = str(material.id)
                row["film_variant_code"] = material.code
                if "material_code" in row:
                    row["material_code"] = material.code
                if "code" in row:
                    row["code"] = material.code
                changed = True
            elif code:
                unresolved += 1
            continue
        material = material_by_id.get(material_id)
        if not material:
            unresolved += 1
            continue
        if row.get("film_variant_code") != material.code:
            row["film_variant_code"] = material.code
            changed = True
        if "material_code" in row and row.get("material_code") != material.code:
            row["material_code"] = material.code
            changed = True
        if "code" in row and row.get("code") != material.code:
            row["code"] = material.code
            changed = True
    return out, changed, unresolved
