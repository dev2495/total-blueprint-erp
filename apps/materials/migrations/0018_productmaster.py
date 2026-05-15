import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0017_alter_inventorymaterial_per_sheet_base_qty"),
        ("templates", "0028_alter_templateblueprint_pouch_style"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProductMaster",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("code", models.CharField(db_index=True, max_length=80, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("product_kind", models.CharField(choices=[("POUCH", "Pouch"), ("ROLL", "Roll"), ("PACKAGING", "Packaging"), ("OTHER", "Other")], default="POUCH", max_length=20)),
                ("default_reporting_group", models.CharField(choices=[("FILM", "Film"), ("PRINTED", "Printed"), ("LAMINATED", "Laminated"), ("SEMI_FG", "Semi-Finished"), ("FG", "Finished Goods"), ("PACKAGING", "Packaging"), ("OTHER", "Other")], default="FG", max_length=20)),
                ("reusable_policy", models.CharField(choices=[("CONFIGURABLE", "Configurable Order Lines"), ("PRESET_ONLY", "Saved Presets Only"), ("CUSTOMER_SPECIFIC", "Customer Specific")], default="CONFIGURABLE", max_length=24)),
                ("description", models.TextField(blank=True, default="")),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("commercial_family", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="product_masters", to="materials.commercialfamily")),
                ("default_template", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="product_masters", to="templates.templateblueprint")),
            ],
            options={
                "db_table": "product_masters",
                "ordering": ["name", "code"],
            },
        ),
    ]
