from django.core.management.base import BaseCommand

from apps.templates.services import TemplateDispatchService


class Command(BaseCommand):
    help = "Audit and optionally auto-fill route dispatch defaults for non-ambiguous template process steps."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Apply auto-fill. Default is dry run.")
        parser.add_argument("--show-issues", action="store_true", help="Print unresolved or invalid dispatch rows.")

    def handle(self, *args, **options):
        apply_changes = bool(options.get("apply"))
        result = TemplateDispatchService.backfill_auto_resolvable_steps(apply=apply_changes)
        rows = TemplateDispatchService.audit_steps()
        status_counts = {}
        for row in rows:
            status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1

        self.stdout.write(f"Route dispatch rows: {len(rows)}")
        for key in sorted(status_counts):
            self.stdout.write(f"- {key}: {status_counts[key]}")
        self.stdout.write(f"Auto-fill eligible: {result['eligible']}")
        self.stdout.write(f"Applied: {result['applied']}")

        issue_statuses = {
            "NEEDS_DECISION",
            "NO_CAPABILITY",
            "INVALID_ALLOWED_WORK_CENTERS",
            "INVALID_DEFAULT_WORK_CENTER",
        }
        issues = [row for row in rows if row["status"] in issue_statuses]
        if options.get("show_issues"):
            for row in issues[:100]:
                self.stdout.write(
                    f"- {row['status']} | {row['template_name']} | "
                    f"Step {row['sequence_number']} {row['process_code']} | "
                    f"candidates={row['filtered_candidate_count']}"
                )
        if issues:
            self.stdout.write(self.style.WARNING(f"Unresolved dispatch rows: {len(issues)}"))
        if not apply_changes:
            self.stdout.write(self.style.WARNING("Dry run only. Re-run with --apply to save auto-fill defaults."))
        else:
            self.stdout.write(self.style.SUCCESS("Route dispatch auto-fill applied."))
