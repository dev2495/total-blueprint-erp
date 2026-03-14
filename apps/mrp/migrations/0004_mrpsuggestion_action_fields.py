from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('users', '0001_initial'),
        ('mrp', '0003_mrprequirement_wip_qty_kg'),
    ]

    operations = [
        migrations.AddField(
            model_name='mrpsuggestion',
            name='action_status',
            field=models.CharField(default='PENDING', max_length=20),
        ),
        migrations.AddField(
            model_name='mrpsuggestion',
            name='draft_ref',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='mrpsuggestion',
            name='last_action_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='mrpsuggestion',
            name='last_action_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='mrp_suggestion_actions', to='users.user'),
        ),
        migrations.AddField(
            model_name='mrpsuggestion',
            name='priority',
            field=models.CharField(default='MEDIUM', max_length=20),
        ),
        migrations.AddField(
            model_name='mrpsuggestion',
            name='required_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
