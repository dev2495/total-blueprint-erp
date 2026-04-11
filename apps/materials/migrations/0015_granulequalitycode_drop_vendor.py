from decimal import Decimal

from django.db import migrations, models


def _weighted_avg_cost(existing_qty, existing_cost, incoming_qty, incoming_cost):
    existing_qty = Decimal(str(existing_qty or 0))
    existing_cost = Decimal(str(existing_cost or 0))
    incoming_qty = Decimal(str(incoming_qty or 0))
    incoming_cost = Decimal(str(incoming_cost or 0))
    total_qty = existing_qty + incoming_qty
    if total_qty <= 0:
        return Decimal("0")
    return ((existing_qty * existing_cost) + (incoming_qty * incoming_cost)) / total_qty


def merge_vendor_split_granule_codes(apps, schema_editor):
    GranuleQualityCode = apps.get_model("materials", "GranuleQualityCode")
    InventoryBulk = apps.get_model("inventory", "InventoryBulk")
    BulkTransaction = apps.get_model("inventory", "BulkTransaction")
    MaterialConsumptionLog = apps.get_model("production", "MaterialConsumptionLog")

    survivors = {}
    duplicate_ids = []
    ordered_codes = GranuleQualityCode.objects.all().order_by("granule_id", "code", "created_at", "id")
    for row in ordered_codes:
        normalized_code = str(getattr(row, "code", "") or "").strip().upper()
        key = (str(getattr(row, "granule_id", "") or ""), normalized_code)
        survivor = survivors.get(key)
        if survivor is None:
            survivors[key] = row
            continue

        for stock in InventoryBulk.objects.filter(granule_code_id=row.id):
            existing = InventoryBulk.objects.filter(
                material_id=stock.material_id,
                granule_code_id=survivor.id,
                plant_id=stock.plant_id,
                location_id=stock.location_id,
            ).exclude(id=stock.id).first()
            if existing:
                existing.avg_cost = _weighted_avg_cost(existing.qty_kg, existing.avg_cost, stock.qty_kg, stock.avg_cost)
                existing.qty_kg = Decimal(str(existing.qty_kg or 0)) + Decimal(str(stock.qty_kg or 0))
                existing.save(update_fields=["qty_kg", "avg_cost", "updated_at"])
                stock.delete()
            else:
                stock.granule_code_id = survivor.id
                stock.save(update_fields=["granule_code"])

        BulkTransaction.objects.filter(granule_code_id=row.id).update(granule_code_id=survivor.id)
        MaterialConsumptionLog.objects.filter(granule_code_id=row.id).update(granule_code_id=survivor.id)
        duplicate_ids.append(row.id)

    if duplicate_ids:
        GranuleQualityCode.objects.filter(id__in=duplicate_ids).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0033_vendor_phone_and_granule_code_bulk"),
        ("production", "0048_materialconsumptionlog_granule_code"),
        ("materials", "0014_granulequalitycode"),
    ]

    operations = [
        migrations.RunPython(merge_vendor_split_granule_codes, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="granulequalitycode",
            name="uniq_granule_quality_code_vendor",
        ),
        migrations.RemoveField(
            model_name="granulequalitycode",
            name="vendor",
        ),
        migrations.AddConstraint(
            model_name="granulequalitycode",
            constraint=models.UniqueConstraint(fields=("granule", "code"), name="uniq_granule_quality_code"),
        ),
    ]
