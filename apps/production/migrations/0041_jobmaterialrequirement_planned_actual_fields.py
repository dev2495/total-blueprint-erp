from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0040_jobmaterialrequirement_theoretical_qty"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="planned_issue_qty",
            field=models.DecimalField(decimal_places=4, default=0, help_text="Planned issue after applying issue policy", max_digits=12),
        ),
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="actual_issued_qty",
            field=models.DecimalField(decimal_places=4, default=0, help_text="Actual gross issued quantity", max_digits=12),
        ),
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="actual_returned_qty",
            field=models.DecimalField(decimal_places=4, default=0, help_text="Actual returned usable quantity", max_digits=12),
        ),
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="actual_scrap_qty",
            field=models.DecimalField(decimal_places=4, default=0, help_text="Actual scrap quantity", max_digits=12),
        ),
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="variance_qty",
            field=models.DecimalField(decimal_places=4, default=0, help_text="Consumed minus theoretical variance", max_digits=12),
        ),
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="is_estimated",
            field=models.BooleanField(default=False, help_text="True when actual values were estimated instead of directly captured"),
        ),
    ]
