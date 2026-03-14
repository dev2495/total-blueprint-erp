from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.analytics.models import ReportDistributionProfile
from apps.analytics.report_delivery import ReportDistributionService
from apps.users.models import User


def _is_production_like() -> bool:
    environment = str(
        getattr(settings, "ENVIRONMENT", "")
        or getattr(settings, "APP_ENV", "")
        or getattr(settings, "DJANGO_ENV", "")
        or ""
    ).strip().lower()
    return bool(environment in {"prod", "production"} or (not settings.DEBUG and environment))


class Command(BaseCommand):
    help = "Append a smoke recipient for daily report packs and optionally send both packs through the audited pipeline."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="dvrshthakkar@gmail.com", help="Smoke recipient email.")
        parser.add_argument("--username", default="admin", help="Admin username to align for smoke verification.")
        parser.add_argument("--send-now", action="store_true", help="Immediately send both report packs.")
        parser.add_argument("--allow-production", action="store_true", help="Allow execution in production-like environments.")

    def handle(self, *args, **options):
        if _is_production_like() and not options["allow_production"]:
            raise CommandError("Refusing to bootstrap report smoke in production-like environment without --allow-production.")

        smoke_email = str(options["email"] or "").strip().lower()
        if not smoke_email:
            raise CommandError("--email is required.")

        ReportDistributionService.ensure_defaults()

        updated_profiles = []
        with transaction.atomic():
            admin_user = User.objects.filter(username=options["username"]).first()
            if admin_user and admin_user.email != smoke_email:
                admin_user.email = smoke_email
                admin_user.save(update_fields=["email"])

            for profile in ReportDistributionProfile.objects.order_by("report_code"):
                recipients = [str(value or "").strip().lower() for value in (profile.extra_recipients or []) if str(value or "").strip()]
                if smoke_email not in recipients:
                    recipients.append(smoke_email)
                    profile.extra_recipients = recipients
                    profile.save(update_fields=["extra_recipients"])
                    updated_profiles.append(profile.report_code)

        self.stdout.write(
            self.style.SUCCESS(
                f"Report smoke recipient prepared for {len(updated_profiles)} profile(s): {smoke_email}"
            )
        )

        if options["send_now"]:
            failures = []
            for profile in ReportDistributionProfile.objects.filter(active=True).order_by("report_code"):
                rendered = ReportDistributionService.render_report(profile.report_code)
                artifact_paths = ReportDistributionService.persist_rendered_artifacts(rendered, folder="manual-preview")
                artifact_path = artifact_paths["pdf"]
                self.stdout.write(
                    self.style.SUCCESS(
                        f"{profile.report_code}: preview saved -> {artifact_path}"
                    )
                )
                for attachment_name, attachment_path in artifact_paths.items():
                    if attachment_name == "pdf":
                        continue
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"{profile.report_code}: detail saved -> {attachment_path}"
                        )
                    )
                try:
                    run = ReportDistributionService.send_profile(
                        profile,
                        triggered_by=User.objects.filter(username=options["username"]).first(),
                        triggered_manually=True,
                    )
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"{profile.report_code}: {run.status} run={run.id} recipients={run.recipient_count}"
                        )
                    )
                except Exception as exc:
                    failures.append((profile.report_code, str(exc)))
                    self.stderr.write(
                        self.style.ERROR(f"{profile.report_code}: failed - {exc}")
                    )
            if failures:
                raise CommandError(
                    "Report smoke completed with failures: "
                    + ", ".join(f"{report_code} ({error})" for report_code, error in failures)
                )
