from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0049_ink_floor_stock"),
        ("materials", "0015_granulequalitycode_drop_vendor"),
    ]

    operations = [
        migrations.AddField(
            model_name="interplantchallanitem",
            name="granule_code",
            field=models.ForeignKey(
                blank=True,
                help_text="Exact granule grade/code moved on a bulk inter-plant line.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="interplant_challan_items",
                to="materials.granulequalitycode",
            ),
        ),
    ]
