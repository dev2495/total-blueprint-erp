"""
Seed the scrap + downtime reason taxonomies.

Top-level codes mirror the legacy ``ScrapLog.REASON_CHOICES`` /
``DowntimeLog.REASON_CHOICES`` so existing operator flows keep working, plus a
handful of representative sub-codes (parent_id) so the two-level taxonomy is
exercised out of the box. Idempotent: uses get_or_create on ``code``.
"""

from django.db import migrations


SCRAP_PARENTS = [
    ("SETUP", "Setup Waste", 10),
    ("TRIM", "Trim Loss", 20),
    ("DEFECT", "Print/Quality Defect", 30),
    ("MACHINE", "Machine Fault", 40),
    ("MATERIAL", "Material Issue", 50),
    ("OTHER", "Other", 90),
]

# parent_code, code, label, sort_order
SCRAP_CHILDREN = [
    ("DEFECT", "DEFECT_REGISTRATION", "Registration Off", 10),
    ("DEFECT", "DEFECT_COLOR", "Color Variation", 20),
    ("DEFECT", "DEFECT_SMUDGE", "Ink Smudge", 30),
    ("MATERIAL", "MATERIAL_FILM", "Film Defect", 10),
    ("MATERIAL", "MATERIAL_GAUGE", "Gauge Out of Spec", 20),
]

DOWNTIME_PARENTS = [
    ("BREAKDOWN", "Machine Breakdown", 10),
    ("MAINTENANCE", "Scheduled Maintenance", 20),
    ("MATERIAL", "Material Shortage", 30),
    ("MANPOWER", "Manpower Shortage", 40),
    ("POWER", "Power Failure", 50),
    ("OTHER", "Other", 90),
]

DOWNTIME_CHILDREN = [
    ("BREAKDOWN", "BREAKDOWN_MECHANICAL", "Mechanical", 10),
    ("BREAKDOWN", "BREAKDOWN_ELECTRICAL", "Electrical", 20),
    ("MAINTENANCE", "MAINTENANCE_CLEANING", "Cleaning / Changeover", 10),
]


def _seed(model, parents, children):
    code_to_obj = {}
    for code, label, sort_order in parents:
        obj, _ = model.objects.get_or_create(
            code=code,
            defaults={"label": label, "sort_order": sort_order, "is_active": True},
        )
        code_to_obj[code] = obj
    for parent_code, code, label, sort_order in children:
        parent = code_to_obj.get(parent_code)
        model.objects.get_or_create(
            code=code,
            defaults={
                "label": label,
                "sort_order": sort_order,
                "is_active": True,
                "parent": parent,
            },
        )


def seed_reason_codes(apps, schema_editor):
    ScrapReason = apps.get_model("production", "ScrapReason")
    DowntimeReason = apps.get_model("production", "DowntimeReason")
    _seed(ScrapReason, SCRAP_PARENTS, SCRAP_CHILDREN)
    _seed(DowntimeReason, DOWNTIME_PARENTS, DOWNTIME_CHILDREN)


def unseed_reason_codes(apps, schema_editor):
    ScrapReason = apps.get_model("production", "ScrapReason")
    DowntimeReason = apps.get_model("production", "DowntimeReason")
    scrap_codes = [c for c, *_ in SCRAP_PARENTS] + [c for _, c, *_ in SCRAP_CHILDREN]
    downtime_codes = [c for c, *_ in DOWNTIME_PARENTS] + [c for _, c, *_ in DOWNTIME_CHILDREN]
    ScrapReason.objects.filter(code__in=scrap_codes).delete()
    DowntimeReason.objects.filter(code__in=downtime_codes).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("production", "0060_downtimereason_scrapreason"),
    ]

    operations = [
        migrations.RunPython(seed_reason_codes, unseed_reason_codes),
    ]
