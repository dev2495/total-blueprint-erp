from django.db import migrations


GROUPS = [
    ("PLANT_GENERAL", "Plant General", "Fallback bucket when no more specific runtime mapping exists.", "1.0000"),
    ("ROLL_EXTRUSION", "Roll Extrusion", "Extrusion-heavy roll production.", "1.8000"),
    ("ROLL_PRINTING", "Roll Printing", "Flexo / roto printing runtime.", "1.3000"),
    ("ROLL_LAMINATION", "Roll Lamination", "Lamination and bonding runtime.", "1.2000"),
    ("ROLL_SLITTING", "Roll Slitting", "Slitting and rewind operations.", "0.8000"),
    ("POUCH_CONVERTING", "Pouch Converting", "Bag, pouch, sealing, and converting runtime.", "1.0000"),
    ("PACKING", "Packing", "Primary / secondary pack runtime.", "0.5000"),
    ("BULK_PROCESSING", "Bulk Processing", "Blend, remix, in-house bulk, and general bulk movement.", "1.0000"),
]


def infer_group(code: str, name: str):
    text = f"{code or ''} {name or ''}".upper()
    if any(token in text for token in ["EXTRU", "BLOWN", "CAST"]):
        return "ROLL_EXTRUSION"
    if any(token in text for token in ["PRINT", "FLEXO", "ROTO"]):
        return "ROLL_PRINTING"
    if "LAMI" in text:
        return "ROLL_LAMINATION"
    if "SLIT" in text:
        return "ROLL_SLITTING"
    if any(token in text for token in ["POUCH", "BAG", "SEAL", "CONVERT"]):
        return "POUCH_CONVERTING"
    if "PACK" in text:
        return "PACKING"
    if any(token in text for token in ["BULK", "BLEND", "MIX", "POD"]):
        return "BULK_PROCESSING"
    return None


def seed_cost_groups(apps, schema_editor):
    CostAbsorptionGroup = apps.get_model("costing", "CostAbsorptionGroup")
    Plant = apps.get_model("factory", "Plant")
    WorkCenter = apps.get_model("factory", "WorkCenter")
    Machine = apps.get_model("factory", "Machine")
    TemplateProcessStep = apps.get_model("templates", "TemplateProcessStep")

    groups = {}
    for code, label, description, factor in GROUPS:
        group, _ = CostAbsorptionGroup.objects.update_or_create(
            code=code,
            defaults={
                "label": label,
                "description": description,
                "default_intensity_factor": factor,
                "is_active": True,
            },
        )
        groups[code] = group

    fallback = groups["PLANT_GENERAL"]
    Plant.objects.filter(default_cost_absorption_group__isnull=True).update(default_cost_absorption_group=fallback)

    for work_center in WorkCenter.objects.all():
        group_code = infer_group(work_center.code, work_center.name)
        if group_code:
            work_center.default_cost_absorption_group = groups[group_code]
            work_center.save(update_fields=["default_cost_absorption_group"])

    for machine in Machine.objects.select_related("work_center").all():
        group_code = infer_group(machine.code, machine.name)
        if group_code:
            machine.cost_absorption_group = groups[group_code]
        elif getattr(machine, "work_center", None) and getattr(machine.work_center, "default_cost_absorption_group_id", None):
            machine.cost_absorption_group = machine.work_center.default_cost_absorption_group
        if machine.cost_absorption_group_id:
            machine.save(update_fields=["cost_absorption_group"])

    for step in TemplateProcessStep.objects.select_related("process").all():
        group_code = infer_group(getattr(step.process, "code", ""), getattr(step.process, "name", ""))
        if group_code:
            step.cost_absorption_group = groups[group_code]
            step.save(update_fields=["cost_absorption_group"])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("costing", "0003_costabsorptiongroup_jobcost_actual_cost_coverage_pct_and_more"),
        ("factory", "0022_machine_cost_absorption_group_and_more"),
        ("templates", "0029_templateprocessstep_cost_absorption_group"),
    ]

    operations = [
        migrations.RunPython(seed_cost_groups, noop_reverse),
    ]
