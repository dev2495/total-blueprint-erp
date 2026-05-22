from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0037_add_is_sellable_and_trading_good"),
    ]

    operations = [
        migrations.AddField(
            model_name="tradinggood",
            name="trade_type",
            field=models.CharField(
                choices=[
                    ("READY_POUCH", "Ready pouch"),
                    ("READY_ROLL", "Ready roll"),
                    ("PACKAGING", "Packaging item"),
                    ("RAW_MATERIAL", "Raw material"),
                    ("OTHER", "Other"),
                ],
                default="READY_POUCH",
                max_length=20,
            ),
        ),
    ]
