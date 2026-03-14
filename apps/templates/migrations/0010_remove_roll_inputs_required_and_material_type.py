from django.db import migrations


def delete_roll_materials(apps, schema_editor):
    TemplateProcessStepMaterial = apps.get_model('templates', 'TemplateProcessStepMaterial')
    if hasattr(TemplateProcessStepMaterial, 'type'):
        TemplateProcessStepMaterial.objects.filter(type='ROLL').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('templates', '0009_templateprocessstep_roll_inputs_required_and_more'),
    ]

    operations = [
        migrations.RunPython(delete_roll_materials, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='templateprocessstep',
            name='roll_inputs_required',
        ),
        migrations.RemoveField(
            model_name='templateprocessstepmaterial',
            name='type',
        ),
    ]
