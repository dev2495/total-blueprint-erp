from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0034_salesorderitem_line_lifecycle"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="salesorder",
            index=models.Index(fields=["status", "-created_at"], name="sales_so_status_created"),
        ),
        migrations.AddIndex(
            model_name="salesorder",
            index=models.Index(fields=["customer_name", "-created_at"], name="sales_so_customer_created"),
        ),
        migrations.AddIndex(
            model_name="salesorder",
            index=models.Index(fields=["status", "-completed_at"], name="sales_so_status_completed"),
        ),
        migrations.AddIndex(
            model_name="salesorderitem",
            index=models.Index(fields=["sales_order", "line_status"], name="sales_soi_order_status"),
        ),
        migrations.AddIndex(
            model_name="salesorderitem",
            index=models.Index(fields=["product_master", "line_status"], name="sales_soi_pm_status"),
        ),
        migrations.AddIndex(
            model_name="salesorderitem",
            index=models.Index(fields=["line_status", "-created_at"], name="sales_soi_status_created"),
        ),
    ]
