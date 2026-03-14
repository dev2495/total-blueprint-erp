from django.db import migrations, models


def normalize_roll_behavior(apps, schema_editor):
    Process = apps.get_model('factory', 'Process')
    for proc in Process.objects.all():
        input_form = (proc.input_form or '').upper()
        output_form = (proc.output_form or '').upper()
        name = (proc.name or '').lower()
        code = (proc.code or '').lower()
        rb = (proc.roll_behavior or '').upper()

        if input_form == 'ROLL' and output_form == 'ROLL':
            if rb in ['CREATE_NEW', 'MODIFY_EXISTING', 'MULTI_INPUT_COMBINE', 'SPLIT', 'NONE']:
                new_rb = rb
            elif 'lamin' in name or 'lamin' in code:
                new_rb = 'MULTI_INPUT_COMBINE'
            elif 'slit' in name or 'slit' in code:
                new_rb = 'SPLIT'
            elif 'print' in name or 'coat' in name or 'print' in code or 'coat' in code:
                new_rb = 'MODIFY_EXISTING'
            else:
                new_rb = 'MODIFY_EXISTING'
        elif input_form == 'BULK' and output_form == 'ROLL':
            new_rb = 'CREATE_NEW'
        else:
            new_rb = 'NONE'

        if proc.roll_behavior != new_rb:
            proc.roll_behavior = new_rb
            proc.save(update_fields=['roll_behavior'])


class Migration(migrations.Migration):
    dependencies = [
        ('factory', '0014_alter_process_input_form'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='process',
            name='is_active',
        ),
        migrations.RemoveField(
            model_name='process',
            name='is_system',
        ),
        migrations.AlterField(
            model_name='process',
            name='roll_behavior',
            field=models.CharField(
                choices=[
                    ('CREATE_NEW', 'Create New Roll'),
                    ('MODIFY_EXISTING', 'Modify Existing Roll'),
                    ('MULTI_INPUT_COMBINE', 'Combine Multiple Rolls'),
                    ('SPLIT', 'Split Roll'),
                    ('NONE', 'None'),
                ],
                default='NONE',
                max_length=30,
            ),
        ),
        migrations.RunPython(normalize_roll_behavior, migrations.RunPython.noop),
    ]
