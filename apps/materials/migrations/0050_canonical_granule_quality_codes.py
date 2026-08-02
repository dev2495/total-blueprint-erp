import re
import unicodedata
from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


def _canonical(value):
    normalized = unicodedata.normalize("NFKC", str(value or "")).strip().upper()
    normalized = re.sub(r"[\s_\-\u2010-\u2015]+", "-", normalized)
    return normalized.strip("-")[:100]


def _weighted_cost(first_qty, first_cost, second_qty, second_cost):
    first_qty = Decimal(str(first_qty or 0))
    second_qty = Decimal(str(second_qty or 0))
    total = first_qty + second_qty
    if total <= 0:
        return Decimal("0")
    return (
        (first_qty * Decimal(str(first_cost or 0)))
        + (second_qty * Decimal(str(second_cost or 0)))
    ) / total


def _replace_code_ids(value, replacements):
    if isinstance(value, list):
        return [_replace_code_ids(item, replacements) for item in value]
    if isinstance(value, dict):
        updated = {}
        for key, item in value.items():
            if key in {"granule_code_id", "granule_code"} and str(item) in replacements:
                updated[key] = replacements[str(item)]
            else:
                updated[key] = _replace_code_ids(item, replacements)
        return updated
    return value


def canonicalize_and_merge_codes(apps, schema_editor):
    GranuleQualityCode = apps.get_model("materials", "GranuleQualityCode")
    InventoryBulk = apps.get_model("inventory", "InventoryBulk")
    BulkTransaction = apps.get_model("inventory", "BulkTransaction")
    InterPlantChallanItem = apps.get_model("inventory", "InterPlantChallanItem")
    ProductionJob = apps.get_model("production", "ProductionJob")

    grouped = {}
    for row in GranuleQualityCode.objects.all().order_by("granule_id", "created_at", "id"):
        canonical_key = _canonical(row.code)
        GranuleQualityCode.objects.filter(pk=row.pk).update(canonical_key=canonical_key)
        grouped.setdefault((str(row.granule_id), canonical_key), []).append(row)

    replacements = {}
    for (_granule_id, canonical_key), rows in grouped.items():
        if len(rows) < 2:
            continue

        rows.sort(
            key=lambda row: (
                str(row.status or "").upper() != "ACTIVE",
                str(row.code or "").strip().upper() != canonical_key,
                row.created_at,
                str(row.id),
            )
        )
        survivor = rows[0]
        if str(survivor.status or "").upper() != "ACTIVE":
            GranuleQualityCode.objects.filter(pk=survivor.pk).update(status="ACTIVE")

        for duplicate in rows[1:]:
            replacements[str(duplicate.id)] = str(survivor.id)
            for stock in InventoryBulk.objects.filter(granule_code_id=duplicate.id):
                source_qty = Decimal(str(stock.qty_kg or 0))
                if source_qty > 0:
                    target, _created = InventoryBulk.objects.get_or_create(
                        material_id=stock.material_id,
                        granule_code_id=survivor.id,
                        plant_id=stock.plant_id,
                        location_id=stock.location_id,
                        defaults={"qty_kg": Decimal("0"), "avg_cost": stock.avg_cost or 0},
                    )
                    target.avg_cost = _weighted_cost(
                        target.qty_kg,
                        target.avg_cost,
                        source_qty,
                        stock.avg_cost,
                    )
                    target.qty_kg = Decimal(str(target.qty_kg or 0)) + source_qty
                    target.save(update_fields=["qty_kg", "avg_cost", "updated_at"])
                    reference = f"SYSTEM-CANONICAL-CODE-MERGE:{duplicate.code}->{survivor.code}"
                    BulkTransaction.objects.create(
                        material_id=stock.material_id,
                        granule_code_id=duplicate.id,
                        location_id=stock.location_id,
                        type="ADJUST",
                        qty_kg=-source_qty,
                        avg_cost=stock.avg_cost,
                        reference=reference,
                    )
                    BulkTransaction.objects.create(
                        material_id=stock.material_id,
                        granule_code_id=survivor.id,
                        location_id=stock.location_id,
                        type="ADJUST",
                        qty_kg=source_qty,
                        avg_cost=stock.avg_cost,
                        reference=reference,
                    )
                    stock.qty_kg = Decimal("0")
                    stock.save(update_fields=["qty_kg", "updated_at"])

            InterPlantChallanItem.objects.filter(granule_code_id=duplicate.id).update(
                granule_code_id=survivor.id
            )
            merge_note = f"Merged into {survivor.code} by canonical-code migration."
            old_notes = str(duplicate.notes or "").strip()
            GranuleQualityCode.objects.filter(pk=duplicate.pk).update(
                status="INACTIVE",
                merged_into_id=survivor.id,
                notes=f"{old_notes} {merge_note}".strip()[:255],
            )

    if replacements:
        for job in ProductionJob.objects.exclude(current_step_material_confirmations=[]).only(
            "id", "current_step_material_confirmations"
        ):
            current = job.current_step_material_confirmations
            updated = _replace_code_ids(current, replacements)
            if updated != current:
                ProductionJob.objects.filter(pk=job.pk).update(
                    current_step_material_confirmations=updated
                )


class Migration(migrations.Migration):

    # PostgreSQL cannot ALTER the quality-code table while deferred FK trigger
    # events from the merge are pending. Keep the data merge atomic, commit it,
    # then apply the constraint change as the next migration operation.
    atomic = False

    dependencies = [
        ("materials", "0049_materialcodealias"),
        ("inventory", "0050_interplantchallanitem_granule_code"),
        ("production", "0070_delivery_challan_item_reservations"),
    ]

    operations = [
        migrations.AddField(
            model_name="granulequalitycode",
            name="canonical_key",
            field=models.CharField(db_index=True, default="", editable=False, max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="granulequalitycode",
            name="merged_into",
            field=models.ForeignKey(
                blank=True,
                help_text="Canonical record when this legacy spelling has been merged.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="merged_aliases",
                to="materials.granulequalitycode",
            ),
        ),
        migrations.RunPython(
            canonicalize_and_merge_codes,
            migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.RemoveConstraint(
            model_name="granulequalitycode",
            name="uniq_granule_quality_code",
        ),
        migrations.AddConstraint(
            model_name="granulequalitycode",
            constraint=models.UniqueConstraint(
                condition=Q(status="ACTIVE"),
                fields=("granule", "canonical_key"),
                name="uniq_active_granule_canonical_code",
            ),
        ),
    ]
