from django.core.management.base import BaseCommand
from apps.factory.models import Process

class Command(BaseCommand):
    help = 'Seeds mandatory system processes'

    def handle(self, *args, **options):
        job_work, created = Process.objects.update_or_create(
            code='JOB_WORK',
            defaults={
                'name': 'Job Work',
                'description': 'External or vendor-managed processing step tracked as a system process.',
                'input_form': 'ROLL',
                'output_form': 'ROLL',
                'roll_behavior': 'MODIFY_EXISTING',
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created process: Job Work'))
        else:
            self.stdout.write(self.style.WARNING('Updated process: Job Work'))
