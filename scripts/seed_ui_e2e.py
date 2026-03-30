import os
import sys
import django

sys.path.insert(0, os.getcwd())
os.environ.setdefault("SKIP_CELERY_IMPORT", "1")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from apps.inventory.models import InkMaterial, Vendor

COLORS = ["YELLOW", "CYAN", "MAGENTA", "BLACK", "WHITE", "RED"]
BASES = ["POLY", "PET"]

for base in BASES:
    for color in COLORS:
        ink, created = InkMaterial.objects.get_or_create(
            base_type=base,
            color_name=color,
            defaults={
                "status": "ACTIVE",
                "is_purchasable": True,
                "is_extrudable": False,
            },
        )
        if not created:
            changed = False
            if getattr(ink, "status", "") != "ACTIVE":
                ink.status = "ACTIVE"
                changed = True
            if hasattr(ink, "is_purchasable") and not ink.is_purchasable:
                ink.is_purchasable = True
                changed = True
            if changed:
                ink.save()

Vendor.objects.get_or_create(
    code="UI_E2E_VENDOR",
    defaults={
        "name": "UI E2E Vendor",
        "type": "BOTH",
        "status": "ACTIVE",
        "payment_terms": "Immediate",
        "lead_time_days": 1,
    },
)

print("UI E2E fixture seed complete.")
