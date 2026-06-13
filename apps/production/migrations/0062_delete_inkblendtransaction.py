from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0061_seed_reason_codes"),
    ]

    operations = [
        migrations.DeleteModel(
            name="InkBlendTransaction",
        ),
    ]
