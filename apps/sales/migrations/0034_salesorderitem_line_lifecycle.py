from django.db import migrations, models


def backfill_line_status(apps, schema_editor):
    SalesOrderItem = apps.get_model("sales", "SalesOrderItem")
    status_map = {
        "DRAFT": "OPEN",
        "CONFIRMED": "PLANNING_REQUIRED",
        "PLANNING_REQUIRED": "PLANNING_REQUIRED",
        "PLANNED": "PLANNED",
        "RELEASED": "RELEASED",
        "PACKING_READY": "PACKING_READY",
        "DISPATCH_READY": "DISPATCH_READY",
        "COMPLETED": "COMPLETED",
        "CANCELLED": "CANCELLED",
    }
    for order_status, line_status in status_map.items():
        SalesOrderItem.objects.filter(sales_order__status=order_status).update(line_status=line_status)


def noop_reverse(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0033_salesorder_address_override"),
    ]

    operations = [
        migrations.AddField(
            model_name="salesorderitem",
            name="line_status",
            field=models.CharField(
                choices=[
                    ("OPEN", "Open"),
                    ("PLANNING_REQUIRED", "Planning Required"),
                    ("PLANNED", "Planned"),
                    ("RELEASED", "Released"),
                    ("IN_PRODUCTION", "In Production"),
                    ("PACKING_READY", "Packing Ready"),
                    ("DISPATCH_READY", "Dispatch Ready"),
                    ("PARTIAL", "Partial"),
                    ("SHORT_CLOSED", "Short Closed"),
                    ("CANCELLED", "Cancelled"),
                    ("COMPLETED", "Completed"),
                ],
                db_index=True,
                default="OPEN",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="qty_cancelled",
            field=models.DecimalField(decimal_places=3, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="qty_short_closed",
            field=models.DecimalField(decimal_places=3, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="line_closed_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="salesorderitem",
            name="line_closed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_line_status, noop_reverse),
    ]
