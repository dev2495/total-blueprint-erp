from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0038_finishedgoodsbatch_meta_json_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="packingunit",
            name="content_mode",
            field=models.CharField(
                choices=[("LOOSE_POUCHES", "Loose Pouches"), ("PRIMARY_PACKS", "Primary Packs")],
                default="LOOSE_POUCHES",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="meta_json",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="packingunit",
            name="primary_pack_count",
            field=models.IntegerField(blank=True, null=True),
        ),
    ]
