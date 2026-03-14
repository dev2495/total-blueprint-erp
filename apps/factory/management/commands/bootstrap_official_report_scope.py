from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.factory.models import Plant


EXCLUDE_TOKENS = {
    "TEST",
    "E2E",
    "UI E2E",
    "DEMO",
    "SAMPLE",
    "PHYSICS",
    "POUCH PLANT 1773439731",
}


def _looks_like_demo_plant(plant: Plant) -> bool:
    haystacks = [str(plant.name or "").upper(), str(plant.code or "").upper()]
    return any(token in value for value in haystacks for token in EXCLUDE_TOKENS)


class Command(BaseCommand):
    help = "Backfill Plant.include_in_official_reports using a one-time heuristic for obvious seeded/demo plants."

    def add_arguments(self, parser):
        parser.add_argument(
            "--all-true",
            action="store_true",
            help="Mark all plants as included and skip the demo/test heuristic.",
        )

    def handle(self, *args, **options):
        updated = 0
        included = 0
        excluded = 0
        for plant in Plant.objects.order_by("name"):
            include = True if options["all_true"] else not _looks_like_demo_plant(plant)
            if plant.include_in_official_reports != include:
                plant.include_in_official_reports = include
                plant.save(update_fields=["include_in_official_reports"])
                updated += 1
            if include:
                included += 1
            else:
                excluded += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Official report scope ready: updated={updated}, included={included}, excluded={excluded}"
            )
        )
