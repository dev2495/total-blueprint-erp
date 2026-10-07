from django.core.management.base import BaseCommand
from apps.factory.models import Plant
from apps.gate.models import GatePublicLink


class Command(BaseCommand):
    help = "Create missing visitor QR links for factory gates without rotating existing links."

    def handle(self, **options):
        created = 0
        for plant in Plant.objects.all().iterator():
            _, was_created = GatePublicLink.objects.get_or_create(plant=plant)
            created += int(was_created)
        self.stdout.write(f"Gate links configured: {created} created; existing tokens preserved.")
