"""Scheduled MRP execution with a database-wide overlap guard."""
from celery import shared_task
from django.db import connection, transaction
from apps.mrp.services import MRPService


@shared_task(name="apps.mrp.tasks.run_nightly_mrp", ignore_result=True)
def run_nightly_mrp():
    # Transaction-scoped lock is released on success, rollback or worker death.
    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_try_advisory_xact_lock(%s)", [7319072401])
            if not cursor.fetchone()[0]:
                return {"status": "skipped", "reason": "already_running"}
        plan = MRPService.run_mrp()
        return {"status": plan.status, "plan_id": str(plan.pk)}
