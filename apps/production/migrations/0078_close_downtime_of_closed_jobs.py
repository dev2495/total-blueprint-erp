from django.db import migrations
from django.db.models import F, Q, TextField, Value
from django.db.models.functions import Concat

NOTE = " [closed automatically: the job was already closed; real end unknown]"


def close_downtime_of_closed_jobs(apps, schema_editor):
    """Downtime left open on a completed/cancelled job is closed with zero length.

    Such rows kept their machine reading "Down" on the WC terminal. Their real end is unknown and
    downtime reports already skipped them (open rows), so no duration is invented: end = start.
    From now on ProductionJob.save ends open downtime when a job closes.
    """
    DowntimeLog = apps.get_model("production", "DowntimeLog")
    closed = ["COMPLETED", "CANCELLED"]
    DowntimeLog.objects.filter(end_time__isnull=True).filter(
        Q(production_job__job_state__in=closed) | Q(production_job__status__in=closed)
    ).update(end_time=F("start_time"), notes=Concat(F("notes"), Value(NOTE), output_field=TextField()))


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0077_packing_check_and_roll_return"),
    ]

    operations = [
        migrations.RunPython(close_downtime_of_closed_jobs, migrations.RunPython.noop),
    ]
