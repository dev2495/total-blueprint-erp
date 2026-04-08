import logging

from celery import shared_task
from django.utils import timezone

from apps.analytics.models import ReportDispatchRun, ReportDistributionProfile
from apps.analytics.report_delivery import ReportDistributionService

logger = logging.getLogger(__name__)


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=2)
def dispatch_due_report_packs_task(self):
    now = timezone.localtime()
    due_profiles = ReportDistributionProfile.objects.filter(active=True).order_by("report_code")
    results = []
    report_date = ReportDistributionService.report_date_for_run()
    for profile in due_profiles:
        already_sent = ReportDispatchRun.objects.filter(
            report_code=profile.report_code,
            report_date=report_date,
            triggered_manually=False,
            status=ReportDispatchRun.Status.SUCCEEDED,
        ).exists()
        if already_sent:
            results.append({"report_code": profile.report_code, "status": "skipped", "reason": "already_sent"})
            continue
        run = ReportDistributionService.send_profile(profile, report_date=report_date, triggered_manually=False)
        results.append({"report_code": profile.report_code, "status": run.status})
    return {"timestamp": now.isoformat(), "results": results}


@shared_task(bind=True, autoretry_for=(Exception,), retry_backoff=True, retry_jitter=True, max_retries=2)
def send_report_pack_task(self, report_code: str, report_date: str | None = None, triggered_by_id: str | None = None):
    from apps.users.models import User

    profile = ReportDistributionProfile.objects.filter(report_code=report_code).first()
    if not profile:
        raise ValueError(f"Unknown report_code: {report_code}")
    user = User.objects.filter(id=triggered_by_id).first() if triggered_by_id else None
    parsed_date = timezone.datetime.fromisoformat(report_date).date() if report_date else None
    run = ReportDistributionService.send_profile(
        profile,
        report_date=parsed_date,
        triggered_by=user,
        triggered_manually=bool(triggered_by_id),
    )
    return {"report_code": report_code, "run_id": str(run.id), "status": run.status}
