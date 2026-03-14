from django.core.management.base import BaseCommand
from apps.factory.models import Process

class Command(BaseCommand):
    help = 'Seeds mandatory system processes'

    def handle(self, *args, **options):
        job_work, created = Process.objects.get_or_create(
            code='JOB_WORK',
            defaults={
                'name': 'Job Work',
                'category': 'JOB_WORK',
                'input_mode': 'QTY',
                'output_mode': 'QTY',
                'is_terminal': False,
                'is_system': True
            }
        )
        if created:
            self.stdout.write(self.style.SUCCESS('Created process: Job Work'))
        else:
            self.stdout.write(self.style.WARNING('Process: Job Work already exists'))
