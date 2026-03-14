from django.core.management.base import BaseCommand
from apps.production.models import PlannedStockOrder, ProductionJob

class Command(BaseCommand):
    help = 'Test missing jobs'

    def handle(self, *args, **options):
        self.stdout.write("--- MTS ORDERS ---")
        orders = PlannedStockOrder.objects.order_by('-created_at')[:10]
        for idx, o in enumerate(orders):
            jobs_count = ProductionJob.objects.filter(mts_order=o).count()
            self.stdout.write(f"[{idx}] {o.order_number} ({o.status}) | Jobs: {jobs_count}")

        self.stdout.write("\n--- ALL JOBS IN RECENT ---")
        jobs = ProductionJob.objects.order_by('-created_at')[:10]
        for j in jobs:
            self.stdout.write(f"{j.job_number} -> {j.origin} (Status: {j.job_state})")
