from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("artwork", "0010_artwork_product_metadata"),
    ]

    operations = [
        migrations.AddField(
            model_name="artwork",
            name="ink_gsm_total",
            field=models.DecimalField(decimal_places=4, default=0, max_digits=8),
        ),
        migrations.AddField(
            model_name="artwork",
            name="ink_gsm_split_mode",
            field=models.CharField(
                choices=[("EQUAL", "Equal by color"), ("PERCENT", "Percentage by color")],
                default="EQUAL",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="artwork",
            name="ink_gsm_color_percentages",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="artwork",
            name="ink_gsm_by_color",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
