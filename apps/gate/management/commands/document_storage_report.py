import json

from django.core.management.base import BaseCommand

from apps.gate.storage_monitor import run_storage_monitor, storage_report


class Command(BaseCommand):
    help = "Print document image storage in PostgreSQL; --alert also notifies owners when thresholds are crossed."

    def add_arguments(self, parser):
        parser.add_argument("--alert", action="store_true", help="Send owner alerts when action is needed.")

    def handle(self, *args, **options):
        report = run_storage_monitor() if options["alert"] else storage_report()
        self.stdout.write(json.dumps(report, indent=2, default=str))
