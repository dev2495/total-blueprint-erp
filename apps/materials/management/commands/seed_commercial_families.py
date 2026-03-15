from django.core.management.base import BaseCommand

from apps.materials.models import CommercialFamily


SEED_ROWS = [
    {"code": "PET_PRINT_WEB", "name": "PET Print Web", "default_form": "ROLL", "default_reporting_group": "PRINTED"},
    {"code": "BOPP_ROLL_STOCK", "name": "BOPP Roll Stock", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "CPP_SEALANT_WEB", "name": "CPP Sealant Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "PE_SEALANT_WEB", "name": "PE Sealant Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "METALLIZED_WEB", "name": "Metallized Web", "default_form": "ROLL", "default_reporting_group": "LAMINATED"},
    {"code": "FOIL_LAMINATE", "name": "Foil Laminate", "default_form": "ROLL", "default_reporting_group": "LAMINATED"},
    {"code": "PAPER_LAMINATE", "name": "Paper Laminate", "default_form": "ROLL", "default_reporting_group": "LAMINATED"},
    {"code": "NYLON_PA_BARRIER_WEB", "name": "Nylon / PA Barrier Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "EVOH_BARRIER_WEB", "name": "EVOH Barrier Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "MONO_PE_RECYCLABLE_WEB", "name": "Mono-PE Recyclable Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "MONO_PP_RECYCLABLE_WEB", "name": "Mono-PP Recyclable Web", "default_form": "ROLL", "default_reporting_group": "FILM"},
    {"code": "SHRINK_LABEL_SLEEVE_STOCK", "name": "Shrink / Label Sleeve Stock", "default_form": "ROLL", "default_reporting_group": "PRINTED"},
    {"code": "THREE_SIDE_SEAL", "name": "Three-Side Seal Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "PILLOW_CENTER_SEAL", "name": "Pillow / Center Seal Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "STAND_UP_POUCH", "name": "Stand-Up Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "SIDE_GUSSET_POUCH", "name": "Side Gusset Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "QUAD_SEAL_POUCH", "name": "Quad Seal Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "FLAT_BOTTOM_BOX_POUCH", "name": "Flat-Bottom / Box Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "SPOUT_POUCH", "name": "Spout Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "SHAPED_POUCH", "name": "Shaped Pouch", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "SACHET_POUCH", "name": "Sachet", "default_form": "POUCH", "default_reporting_group": "FG"},
    {"code": "STICK_PACK", "name": "Stick Pack", "default_form": "POUCH", "default_reporting_group": "FG"},
]


class Command(BaseCommand):
    help = "Seed editable commercial family defaults for mainstream flexible-packaging families."

    def handle(self, *args, **options):
        created = 0
        updated = 0
        for row in SEED_ROWS:
            obj, was_created = CommercialFamily.objects.update_or_create(
                code=row["code"],
                defaults={
                    "name": row["name"],
                    "default_form": row["default_form"],
                    "default_reporting_group": row["default_reporting_group"],
                    "active": True,
                },
            )
            if was_created:
                created += 1
                self.stdout.write(self.style.SUCCESS(f"Created {obj.code}"))
            else:
                updated += 1
                self.stdout.write(f"Updated {obj.code}")

        self.stdout.write(self.style.SUCCESS(f"Commercial family seed complete. created={created} updated={updated}"))
