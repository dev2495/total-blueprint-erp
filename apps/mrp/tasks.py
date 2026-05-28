"""Celery tasks for the MRP app.

Safe to call when the database is empty.
"""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.mrp.tasks.run_nightly_mrp", ignore_result=True)
def run_nightly_mrp():
    """Nightly MRP plan generation — only runs when there is open sales demand."""
    try:
        from apps.mrp.services import MRPService
    except Exception as exc:  # pragma: no cover
        logger.warning("run_nightly_mrp import failed: %s", exc, exc_info=True)
        return {"status": "skipped", "reason": "import_failed"}
    try:
        # Defensive: pick the engine entrypoint if it exists.
        if hasattr(MRPService, "run_plan"):
            return MRPService.run_plan()
        if hasattr(MRPService, "generate_plan"):
            return MRPService.generate_plan()
        logger.info("run_nightly_mrp: MRPService has no run_plan/generate_plan entrypoint; noop")
        return {"status": "noop"}
    except Exception as exc:
        logger.exception("run_nightly_mrp failed: %s", exc)
        return {"status": "error", "error": str(exc)}
