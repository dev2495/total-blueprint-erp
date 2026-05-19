"""
Clear all PouchStyleMaster rows.

The seeded styles were placeholders; production users build their own from
scratch. Any ProductMasterSize.pouch_style_master FK is set to NULL via the
existing ON DELETE SET NULL behaviour.
"""

from django.db import migrations


def clear_all(apps, schema_editor):
    PouchStyleMaster = apps.get_model("materials", "PouchStyleMaster")
    PouchStyleMaster.objects.all().delete()


def noop_reverse(apps, schema_editor):
    # Reverse is a no-op: we never want to re-introduce the placeholder seeds.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("materials", "0033_web_width_policy"),
    ]

    operations = [
        migrations.RunPython(clear_all, noop_reverse),
    ]
