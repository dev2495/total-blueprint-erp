from django.db import migrations, models


def add_gate_profile(apps, schema_editor):
    Profile = apps.get_model("analytics", "ReportDistributionProfile")
    Profile.objects.get_or_create(report_code="gate_register_daily", defaults={"target_roles": ["OWNER"]})


class Migration(migrations.Migration):
    dependencies = [("analytics", "0003_alter_reportdistributionprofile_report_code")]
    operations = [
        migrations.AlterField(
            model_name="reportdistributionprofile", name="report_code",
            field=models.CharField(max_length=64, unique=True, choices=[
                ("owner_executive_daily", "Owner Executive Daily"),
                ("production_daily", "Production Daily"),
                ("dispatch_daily", "Dispatch Daily"),
                ("packing_dispatch_summary_daily", "Packing Dispatch Summary Daily"),
                ("stock_standing_daily", "Stock Standing Daily"),
                ("gate_register_daily", "Gate Register Daily"),
            ]),
        ),
        migrations.AddField(model_name="reportdispatchrun", name="private_pdf_data", field=models.BinaryField(null=True, blank=True, editable=False)),
        migrations.AddField(model_name="reportdispatchrun", name="private_detail_data", field=models.BinaryField(null=True, blank=True, editable=False)),
        migrations.RunPython(add_gate_profile, migrations.RunPython.noop),
    ]
