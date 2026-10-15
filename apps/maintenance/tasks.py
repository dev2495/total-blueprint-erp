"""Scheduled maintenance work: due jobs every morning, overdue reminders after the shift starts."""
from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.maintenance.tasks.generate_due_maintenance_jobs", ignore_result=True)
def generate_due_maintenance_jobs():
    from apps.maintenance.services import MaintenanceService
    stats = MaintenanceService.generate_due_jobs()
    logger.info("maintenance due jobs: %s", stats)
    return stats


@shared_task(name="apps.maintenance.tasks.notify_overdue_maintenance", ignore_result=True)
def notify_overdue_maintenance():
    from apps.maintenance.services import MaintenanceService
    count = MaintenanceService.notify_overdue()
    logger.info("maintenance overdue notified: %s", count)
    return count
