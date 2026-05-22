from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0038_tradinggood_trade_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="webwidthpolicy",
            name="scope_type",
            field=models.CharField(
                choices=[
                    ("GLOBAL", "Global default"),
                    ("PRODUCT_KIND", "Product kind"),
                    ("PRODUCT_MASTER", "Product master"),
                    ("POUCH_STYLE", "Pouch style"),
                    ("PROCESS", "Process"),
                    ("MACHINE", "Machine"),
                ],
                db_index=True,
                default="GLOBAL",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="webwidthpolicy",
            name="scope_ref",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                help_text="Code or UUID for the selected scope. Blank for GLOBAL.",
                max_length=120,
            ),
        ),
        migrations.AddField(
            model_name="webwidthpolicy",
            name="parent_width_strategy",
            field=models.CharField(
                choices=[
                    ("CALCULATED", "Use calculated width"),
                    ("NEAREST_STANDARD", "Use nearest configured parent width"),
                    ("STRICT_STANDARD", "Require configured parent width"),
                ],
                default="CALCULATED",
                help_text="Whether planning uses the calculated web width or snaps to configured parent widths.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="webwidthpolicy",
            name="min_parent_width_mm",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="webwidthpolicy",
            name="max_parent_width_mm",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddIndex(
            model_name="webwidthpolicy",
            index=models.Index(fields=["scope_type", "scope_ref"], name="web_width_policy_scope_idx"),
        ),
    ]
