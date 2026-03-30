from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.materials.models import CommercialFamily, InventoryMaterial
from apps.sales.models import SalesSku
from apps.templates.models import TemplateBlueprint


POUCH_STYLE_TO_BUSINESS_FAMILY = {
    "THREE_SIDE_SEAL": "THREE_SIDE_SEAL",
    "PILLOW": "PILLOW_CENTER_SEAL",
    "STAND_UP": "STAND_UP_POUCH",
    "SIDE_GUSSET": "SIDE_GUSSET_POUCH",
    "QUAD_SEAL": "QUAD_SEAL_POUCH",
    "FLAT_BOTTOM": "FLAT_BOTTOM_BOX_POUCH",
    "SPOUT": "SPOUT_POUCH",
    "SHAPED": "SHAPED_POUCH",
    "SACHET": "SACHET_POUCH",
    "STICK_PACK": "STICK_PACK",
}

FILM_RULES = [
    (("MET", "METAL"), "METALLIZED_WEB"),
    (("FOIL", "ALU"), "FOIL_LAMINATE"),
    (("PAPER",), "PAPER_LAMINATE"),
    (("NYLON", "PA "), "NYLON_PA_BARRIER_WEB"),
    (("EVOH",), "EVOH_BARRIER_WEB"),
    (("BOPP",), "BOPP_ROLL_STOCK"),
    (("CPP",), "CPP_SEALANT_WEB"),
    (("MDOPE", "MLDPE", "LDPE", "HDPE", "PE "), "PE_SEALANT_WEB"),
    (("PET",), "PET_PRINT_WEB"),
]


def _detect_business_family_code(*parts: str) -> str | None:
    text = " ".join(str(part or "").upper() for part in parts)
    if not text.strip():
        return None
    for keywords, business_family_code in FILM_RULES:
        if any(keyword in text for keyword in keywords):
            return business_family_code
    return None


class Command(BaseCommand):
    help = (
        "Backfill deterministic Business Family aliases for seeded physical film families, "
        "film variants, templates, and sales SKUs without changing physical hierarchy."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Persist the detected aliases. Without this flag the command runs in dry-run mode.",
        )

    def handle(self, *args, **options):
        apply_changes = bool(options["apply"])
        families = CommercialFamily.objects.in_bulk(field_name="code")
        updates = 0

        def assign(obj, business_family_code: str | None, label: str):
            nonlocal updates
            if not business_family_code:
                return
            business_family = families.get(business_family_code)
            if business_family is None or getattr(obj, "commercial_family_id", None):
                return
            updates += 1
            self.stdout.write(f"{label}: {obj} -> {business_family.code}")
            if apply_changes:
                obj.commercial_family = business_family
                obj.save(update_fields=["commercial_family"])

        for material in InventoryMaterial.objects.filter(category="FILM_FAMILY", commercial_family__isnull=True):
            assign(material, _detect_business_family_code(material.code, material.name), "film-family")

        for material in InventoryMaterial.objects.filter(category="FILM_VARIANT", commercial_family__isnull=True).select_related("parent_family", "parent_family__commercial_family"):
            inherited = getattr(getattr(material, "parent_family", None), "commercial_family", None)
            if inherited:
                assign(material, inherited.code, "film-variant")
                continue
            assign(
                material,
                _detect_business_family_code(
                    material.code,
                    material.name,
                    getattr(getattr(material, "parent_family", None), "code", ""),
                    getattr(getattr(material, "parent_family", None), "name", ""),
                ),
                "film-variant",
            )

        for template in TemplateBlueprint.objects.filter(commercial_family__isnull=True):
            business_family_code = None
            if str(template.fg_type or "").upper() == "POUCH":
                business_family_code = POUCH_STYLE_TO_BUSINESS_FAMILY.get(str(template.pouch_style or "").upper())
            else:
                business_family_code = _detect_business_family_code(template.name)
            assign(template, business_family_code, "template")

        for sku in SalesSku.objects.filter(commercial_family__isnull=True).select_related("template", "template__commercial_family"):
            inherited = getattr(getattr(sku, "template", None), "commercial_family", None)
            if inherited:
                assign(sku, inherited.code, "sales-sku")
                continue
            assign(sku, _detect_business_family_code(sku.code, sku.name), "sales-sku")

        mode = "APPLIED" if apply_changes else "DRY-RUN"
        self.stdout.write(self.style.SUCCESS(f"Business family alias backfill complete ({mode}). updates={updates}"))
