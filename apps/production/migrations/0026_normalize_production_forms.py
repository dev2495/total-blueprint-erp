from django.db import migrations


def normalize_forms(apps, schema_editor):
    ProductionJob = apps.get_model('production', 'ProductionJob')
    ProductionJob.objects.filter(input_form='POUCH').update(input_form='BULK')
    ProductionJob.objects.filter(output_form='POUCH').update(output_form='BULK')


class Migration(migrations.Migration):
    dependencies = [
        ('production', '0025_alter_jobmaterialrequirement_unique_together'),
    ]

    operations = [
        migrations.RunPython(normalize_forms, migrations.RunPython.noop),
    ]
