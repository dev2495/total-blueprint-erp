from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("templates", "0017_templateprocessstepmaterial_consumption_basis"),
    ]

    operations = [
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="issue_policy_mode",
            field=models.CharField(
                choices=[
                    ("NONE", "No Planned Over-Issue"),
                    ("PERCENT_OVER_THEORY", "Percent Over Theory"),
                    ("FIXED_EXTRA_KG", "Fixed Extra KG"),
                    ("MINIMUM_ISSUE_KG", "Minimum Issue KG"),
                ],
                default="NONE",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="templateprocessstepmaterial",
            name="issue_policy_value",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Planning-only over-issue policy value. Interpretation depends on issue_policy_mode.",
                max_digits=12,
            ),
        ),
    ]
