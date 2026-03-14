from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0039_packingunit_content_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="jobmaterialrequirement",
            name="theoretical_qty",
            field=models.DecimalField(
                decimal_places=4,
                default=0,
                help_text="Ideal no-loss theoretical requirement",
                max_digits=12,
            ),
        ),
    ]
