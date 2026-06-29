from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0062_delete_inkblendtransaction"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["job_state", "-closed_at"], name="prod_job_state_closed"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["sales_order_item", "job_state"], name="prod_job_soi_state"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["mts_order", "job_state"], name="prod_job_mts_state"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["work_center", "job_state"], name="prod_job_wc_state"),
        ),
        migrations.AddIndex(
            model_name="productionjob",
            index=models.Index(fields=["job_state", "-updated_at"], name="prod_job_state_updated"),
        ),
        migrations.AddIndex(
            model_name="plannedstockorder",
            index=models.Index(fields=["status", "-created_at"], name="prod_mts_status_created"),
        ),
        migrations.AddIndex(
            model_name="plannedstockorder",
            index=models.Index(fields=["template", "status"], name="prod_mts_template_status"),
        ),
        migrations.AddIndex(
            model_name="plannedstockorder",
            index=models.Index(fields=["stock_purpose", "status", "-created_at"], name="prod_mts_purpose_status"),
        ),
    ]
