"""Celery tasks for the inventory app.

Tasks here are safe to call when the database is empty — they no-op without raising.
"""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.inventory.tasks.low_stock_scan", ignore_result=True)
def low_stock_scan():
    """Daily reorder-policy scan: raise/resolve LOW_STOCK alerts."""
    try:
        from apps.inventory.services.inventory_audit_service import InventoryAuditService
    except Exception as exc:  # pragma: no cover - import-time edge cases
        logger.warning("low_stock_scan import failed: %s", exc, exc_info=True)
        return {"raised": 0, "resolved": 0, "scanned": 0, "error": "import_failed"}
    try:
        return InventoryAuditService.generate_low_stock_alerts()
    except Exception as exc:
        logger.exception("low_stock_scan failed: %s", exc)
        return {"raised": 0, "resolved": 0, "scanned": 0, "error": str(exc)}


@shared_task(name="apps.inventory.tasks.jobwork_overdue_task", ignore_result=True)
def jobwork_overdue_task():
    """Daily: job-work orders past their expected return date and material held
    by a job worker for 300+ days (GST ITC-04 one-year limit)."""
    from apps.inventory.services.job_work_integrations import run_jobwork_overdue_reminders

    return run_jobwork_overdue_reminders()
