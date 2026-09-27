from django.db import migrations, models
from django.contrib.postgres.operations import AddIndexConcurrently


class Migration(migrations.Migration):
    atomic = False
    dependencies = [('production', '0070_delivery_challan_item_reservations')]
    operations = [
        AddIndexConcurrently(model_name='productionjob', index=models.Index(fields=['job_state', '-created_at', '-id'], name='prod_job_state_created')),
        AddIndexConcurrently(model_name='productionjob', index=models.Index(fields=['-created_at', '-id'], name='prod_job_created')),
    ]
