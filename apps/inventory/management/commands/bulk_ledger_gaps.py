"""List bulk stock rows whose quantity differs from their own ledger.

Read-only. Prints one line per material + quality code + location whose
InventoryBulk quantity is not explained by the BulkTransaction rows with the
same three keys, so the store team can count those items physically.

    python manage.py bulk_ledger_gaps
    python manage.py bulk_ledger_gaps --plant DBH --csv
"""
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError

from apps.factory.models import Plant
from apps.inventory.services.inventory_audit_service import InventoryAuditService


class Command(BaseCommand):
    help = "Print bulk stock rows that do not tie to their ledger (read-only)."

    def add_arguments(self, parser):
        parser.add_argument("--plant", help="Plant code (default: all reportable plants)")
        parser.add_argument("--csv", action="store_true", help="Comma-separated output")
        parser.add_argument("--tolerance", default="0.01", help="Ignore gaps at or below this many kg (default 0.01)")

    def handle(self, *args, **options):
        if options["plant"]:
            try:
                plants = [Plant.objects.get(code=options["plant"])]
            except Plant.DoesNotExist:
                raise CommandError(f"Plant {options['plant']} not found")
        else:
            plants = list(Plant.objects.filter(include_in_official_reports=True).order_by("code"))
        tolerance = Decimal(str(options["tolerance"]))

        rows = []
        for plant in plants:
            rows.extend(InventoryAuditService.bulk_ledger_gaps(plant, tolerance=tolerance))

        headers = ["plant", "location", "material", "name", "quality_code", "stock_kg", "ledger_kg", "gap_kg", "ledger_rows", "last_ledger_entry"]
        table = []
        for gap in rows:
            bulk = gap["bulk"]
            table.append([
                bulk.plant.code,
                bulk.location.name,
                bulk.material.code,
                bulk.material.name,
                bulk.granule_code.code if bulk.granule_code_id else "",
                f"{gap['stock_qty']:.3f}",
                f"{gap['ledger_qty']:.3f}",
                f"{gap['gap']:+.3f}",
                "yes" if gap["has_ledger"] else "none",
                gap["last_ledger_at"].date().isoformat() if gap["last_ledger_at"] else "",
            ])

        if options["csv"]:
            self.stdout.write(",".join(headers))
            for row in table:
                self.stdout.write(",".join('"%s"' % str(cell).replace('"', '""') for cell in row))
        else:
            widths = [max(len(str(x)) for x in col) for col in zip(headers, *table)] if table else [len(h) for h in headers]
            fmt = "  ".join("{:<%d}" % w for w in widths)
            self.stdout.write(fmt.format(*headers))
            for row in table:
                self.stdout.write(fmt.format(*row))
        total = sum(abs(gap["gap"]) for gap in rows)
        self.stdout.write(f"\n{len(table)} row(s) with a gap; {total:.3f} kg in total (absolute). Nothing was changed.")
