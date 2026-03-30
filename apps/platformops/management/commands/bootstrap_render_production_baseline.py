from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = (
        "Seed the repo-safe production baseline for Render go-live: system processes, "
        "commercial families, POD materials, and notification/routing defaults without sample inbox rows."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--allow-production",
            action="store_true",
            help="Required safety flag for production-like environments.",
        )

    def handle(self, *args, **options):
        if not options["allow_production"]:
            raise CommandError("Pass --allow-production to confirm you intend to seed a live environment.")

        steps = [
            ("seed_system_processes", {}),
            ("seed_commercial_families", {}),
            ("seed_pod_materials", {}),
            ("seed_notification_baseline", {"allow_production": True, "skip_sample_inbox": True}),
        ]

        for command_name, kwargs in steps:
            self.stdout.write(f"Running {command_name}")
            call_command(command_name, **kwargs)

        self.stdout.write(
            self.style.WARNING(
                "Render production baseline complete. Do not run bootstrap_official_report_scope "
                "until the real plant masters have been created."
            )
        )
