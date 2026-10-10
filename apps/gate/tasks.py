"""Scheduled document jobs (Celery beat). Bodies live in their owning modules."""
from celery import shared_task


@shared_task
def document_reminders_task():
    """Due-date / valid-until reminders for filed bills and licences."""
    from .document_reminders import run_document_reminders

    return run_document_reminders()


@shared_task
def gate_pass_overdue_task():
    """Alerts for returnable gate passes past their expected return date."""
    from .gate_pass_services import run_gate_pass_overdue_reminders

    return run_gate_pass_overdue_reminders()


@shared_task
def document_storage_monitor_task():
    """Measure document image storage in PostgreSQL and alert owners on thresholds."""
    from .storage_monitor import run_storage_monitor

    return run_storage_monitor()
