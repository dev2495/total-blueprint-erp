from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("sales", "0032_salesorder_completed_at_alter_salesorder_status_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="salesorder",
            name="address_override",
            field=models.TextField(blank=True, default=""),
        ),
    ]
