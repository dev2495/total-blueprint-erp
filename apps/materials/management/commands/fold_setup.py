"""Set up folding on an existing database (2 Nov 2026). Report only unless an --apply flag is given.

1. Roll sizes whose Roll form (FLAT / FOLDED / TUBING) never reached their stock form: before this
   release the roll size editor saved only geometry_config.roll_form, so TUBING sizes stayed OPEN_WEB.
   --apply-sizes saves them so the form, width basis, slit rule and film area follow the picker.
2. The Folding process: Process Master's fold step must take open web and output the line's form.
   --apply-process sets it to one roll in / one roll out, in [OPEN_WEB], out [OPEN_WEB, FOLDED_WEB,
   LAYFLAT_TUBE], output form from the order. Refused while a job is running on that process.

3. Ready-made roll styles (--apply-styles): Open roll, Folded (C-fold, no flap) and Lay-flat tube, approved and
   locked, so a roll size can pick one; a size may still type its own flap / seal / trim.

    manage.py fold_setup                       # report
    manage.py fold_setup --apply-styles
    manage.py fold_setup --apply-sizes
    manage.py fold_setup --apply-process --process-code Fold "Sheet Seal"

On the live masters (2 Nov 2026) both "Fold" (courier / side-seal routes) and "Sheet Seal" (BOPP sheet
folding, diaper bags EXT -> PRT -> Sheet Seal -> GZT -> Bottom, where GZT and Bottom take tubes only)
turn an open web into a folded web or tube.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.factory.models import Process
from apps.materials.models import PouchStyleMaster, ProductMasterSize
from apps.materials.stock_forms import (
    default_slit_policy,
    default_width_basis,
    normalize_stock_form,
    stock_form_from_roll_form,
)
from apps.production.models import ProductionJob

FOLD_CONFIG = {
    "roll_behavior": "MODIFY_EXISTING",
    "allowed_input_stock_forms": ["OPEN_WEB"],
    "allowed_output_stock_forms": ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"],
    "stock_form_output_mode": "TARGET_DECIDES",
}
ROLL_STYLES = [
    # code, name, form, emoji, notes
    ("ROLL-OPEN", "Open roll", "OPEN_WEB", "🧻", "Open web / sheet roll. Slitting allowed."),
    ("ROLL-FOLDED", "Folded roll (C-fold)", "FOLDED_WEB", "📁", "Folded in half, no flap. A size may type its own flap for a J-fold."),
    ("ROLL-TUBE", "Lay-flat tube roll", "LAYFLAT_TUBE", "⭕", "Lay-flat tube. A size may type the seal it takes when the folder seals."),
]
RUNNING_STATES = {"EXECUTING", "PAUSED"}
CLOSED_STATES = {"COMPLETED", "CANCELLED", "CLOSED"}


class Command(BaseCommand):
    help = "Report (and optionally fix) roll sizes whose Roll form never reached their stock form, and the Folding process setup."

    def add_arguments(self, parser):
        parser.add_argument("--process-code", nargs="+", default=["Fold"], help="Process Master code(s) of the folding steps (default: Fold).")
        parser.add_argument("--apply-sizes", action="store_true", help="Save the mismatched roll sizes.")
        parser.add_argument("--apply-styles", action="store_true", help="Create the ready-made roll styles that are missing.")
        parser.add_argument("--apply-process", action="store_true", help="Reconfigure the folding process.")

    def handle(self, *args, **options):
        self._styles(apply=bool(options["apply_styles"]))
        self._sizes(apply=bool(options["apply_sizes"]))
        for code in options["process_code"]:
            self._process(code=str(code), apply=bool(options["apply_process"]))

    def _styles(self, *, apply: bool):
        missing = [row for row in ROLL_STYLES if not PouchStyleMaster.objects.filter(code=row[0]).exists()]
        self.stdout.write(f"Ready-made roll styles missing: {len(missing)} ({', '.join(row[0] for row in missing) or 'none'})")
        if not apply or not missing:
            return
        with transaction.atomic():
            for code, name, form, emoji, notes in missing:
                PouchStyleMaster.objects.create(
                    code=code, name=name, style_for="ROLL", locked=True, visual_emoji=emoji, notes=notes,
                    default_stock_form=form, default_width_basis=default_width_basis(form),
                    default_slit_policy=default_slit_policy(form), sort_order=900,
                    stock_form_options={form: {"enabled": True, "flap_mm": 0, "seal_mm": 0, "trim_mm": 0}} if form != "OPEN_WEB" else {},
                )
        self.stdout.write(self.style.SUCCESS(f"Created {len(missing)} roll styles."))

    def _sizes(self, *, apply: bool):
        rows = []
        sizes = ProductMasterSize.objects.filter(product_master__product_kind="ROLL", pouch_style_master__isnull=True).select_related("product_master")
        for size in sizes:
            geometry = size.geometry_config if isinstance(size.geometry_config, dict) else {}
            wanted = stock_form_from_roll_form(geometry.get("roll_form"))
            if wanted and wanted != normalize_stock_form(size.stock_form):
                rows.append((size, geometry.get("roll_form"), wanted))
        self.stdout.write(f"Roll sizes with Roll form not on their stock form: {len(rows)}")
        for size, roll_form, wanted in rows:
            state = "active" if size.active else "retired"
            self.stdout.write(f"  {size.product_master.name} / {size.label} ({state}): roll_form={roll_form} stock_form={size.stock_form} -> {wanted}")
        if apply and rows:
            with transaction.atomic():
                for size, _, _ in rows:
                    size.save()
            self.stdout.write(self.style.SUCCESS(f"Saved {len(rows)} roll sizes."))

    def _process(self, *, code: str, apply: bool):
        process = Process.objects.filter(code=code).first()
        if process is None:
            self.stdout.write(f"No process with code {code!r}; create the folding process in Process Master.")
            return
        current = {key: getattr(process, key) for key in FOLD_CONFIG}
        self.stdout.write(f"Process {process.code} ({process.name}): {current}")
        open_jobs = ProductionJob.objects.filter(current_process=process).exclude(job_state__in=CLOSED_STATES)
        running = [job.job_number for job in open_jobs if str(job.job_state).upper() in RUNNING_STATES]
        self.stdout.write(f"  open jobs at this step: {open_jobs.count()} (running: {', '.join(running) or 'none'})")
        if current == FOLD_CONFIG:
            self.stdout.write(self.style.SUCCESS("  already set up for folding."))
            return
        self.stdout.write(f"  folding setup: {FOLD_CONFIG}")
        if not apply:
            return
        if running:
            raise CommandError(f"Jobs running on {process.code}: {', '.join(running)}. Finish or pause them first.")
        for key, value in FOLD_CONFIG.items():
            setattr(process, key, value)
        process.save(update_fields=list(FOLD_CONFIG))
        self.stdout.write(self.style.SUCCESS(f"  {process.code} now folds: open web in, the order's form out."))
