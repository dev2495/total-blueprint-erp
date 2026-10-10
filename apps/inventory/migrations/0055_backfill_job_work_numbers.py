"""Give pre-upgrade job-work orders a readable number and the new status name.

Legacy orders receive deterministic numbers ``JWO-L-000001`` ... in creation
order, a namespace that never collides with financial-year numbers issued by
``apps.gate.numbering`` (``JWO-2627-000001``). ``PARTIAL`` becomes
``PARTLY_RETURNED``. No stock, roll or roll status is touched here: rolls left
in JOBWORK_OUT by the old flow are settled only through the audited Owner
reconciliation screen.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    JobWorkOrder = apps.get_model("inventory", "JobWorkOrder")
    legacy = JobWorkOrder.objects.filter(number="").order_by("created_at", "id")
    used = set(JobWorkOrder.objects.exclude(number="").values_list("number", flat=True))
    counter = 0
    for order in legacy.iterator():
        counter += 1
        number = f"JWO-L-{counter:06d}"
        while number in used:
            counter += 1
            number = f"JWO-L-{counter:06d}"
        used.add(number)
        JobWorkOrder.objects.filter(pk=order.pk).update(number=number)
    JobWorkOrder.objects.filter(status="PARTIAL").update(status="PARTLY_RETURNED")


def backwards(apps, schema_editor):
    # The previous image only knows PARTIAL; legacy numbers are harmless.
    JobWorkOrder = apps.get_model("inventory", "JobWorkOrder")
    JobWorkOrder.objects.filter(status__in=["PARTLY_RETURNED", "RETURNED"]).update(status="PARTIAL")


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0054_job_work_documents"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
