from django.db import migrations, models


def set_roll_behavior(apps, schema_editor):
    Process = apps.get_model('factory', 'Process')
    for proc in Process.objects.all():
        if getattr(proc, 'modifies_existing_roll', False):
            roll_behavior = 'MODIFY_EXISTING'
        elif getattr(proc, 'allows_multi_roll_input', False):
            roll_behavior = 'MULTI_INPUT_COMBINE'
        else:
            roll_behavior = 'CREATE_NEW'
        proc.roll_behavior = roll_behavior
        if proc.description is None:
            proc.description = ''
        proc.save(update_fields=['roll_behavior', 'description'])


class Migration(migrations.Migration):
    dependencies = [
        ('factory', '0012_remove_process_consumption_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='process',
            name='description',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='process',
            name='roll_behavior',
            field=models.CharField(choices=[('MODIFY_EXISTING', 'Modify Existing Roll'), ('CREATE_NEW', 'Create New Roll'), ('MULTI_INPUT_COMBINE', 'Combine Multiple Rolls')], default='CREATE_NEW', max_length=30),
        ),
        migrations.RunPython(set_roll_behavior, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='process',
            name='allows_multi_roll_input',
        ),
        migrations.RemoveField(
            model_name='process',
            name='allows_multi_roll_output',
        ),
        migrations.RemoveField(
            model_name='process',
            name='modifies_existing_roll',
        ),
        migrations.DeleteModel(
            name='ProcessMaterialRule',
        ),
    ]
