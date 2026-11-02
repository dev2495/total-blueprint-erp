"""Set up folding on an existing database (2 Nov 2026). Report only unless an --apply flag is given.

1. Roll sizes whose Roll form (FLAT / FOLDED / TUBING) never reached their stock form: before this
   release the roll size editor saved only geometry_config.roll_form, so TUBING sizes stayed OPEN_WEB.
   --apply-sizes saves them so the form, width basis, slit rule and film area follow the picker.
2. The Folding process: Process Master's fold step must take open web and output the line's form.
   --apply-process sets it to one roll in / one roll out, in [OPEN_WEB], out [OPEN_WEB, FOLDED_WEB,
   LAYFLAT_TUBE], output form from the order. Refused while a job is running on that process.

3. Ready-made roll styles (--apply-styles): open roll, C-fold, J-fold with a 20 / 30 / 40 mm flap, blown tube and
   folded-and-sealed tube, approved and locked, so a roll size picks one; a size may still type its own flap / seal / trim.
4. Products on routes with a fold step (--apply-links): a pouch size whose route folds (or folds and seals) but whose
   style is open web gets a linked copy of its style, "<code>-ON-FOLD" / "<code>-ON-TUBE": same formula, read as the
   open web before the fold (formula_basis OPEN_WEB). The open width, the rolls picked before the fold and the kg
   targets stay what they are today; the fold step and every later step get the folded / tube width. The form comes
   from the route: a later step that takes tubes only means tube, otherwise folded. Order lines already placed keep
   their snapshot. Sizes with a typed child width or no pouch style are listed, not changed.

    manage.py fold_setup                       # report
    manage.py fold_setup --apply-styles
    manage.py fold_setup --apply-sizes
    manage.py fold_setup --apply-process --process-code Fold "Sheet Seal"
    manage.py fold_setup --apply-links

On the live masters (2 Nov 2026) both "Fold" (courier / side-seal routes) and "Sheet Seal" (BOPP sheet
folding, diaper bags EXT -> PRT -> Sheet Seal -> GZT -> Bottom, where GZT and Bottom take tubes only)
turn an open web into a folded web or tube.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.factory.models import Process
from apps.materials.models import PouchStyleMaster, ProductMaster, ProductMasterSize
from apps.materials.serializers import ProductMasterSizeSerializer
from apps.materials.stock_forms import (
    FOLDABLE_FORMS,
    FORMULA_BASIS_OPEN,
    STOCK_FORM_FOLDED_WEB,
    STOCK_FORM_LAYFLAT_TUBE,
    STOCK_FORM_OPEN_WEB,
    default_slit_policy,
    default_width_basis,
    normalize_stock_form,
    stock_form_from_roll_form,
)
from apps.production.models import ProductionJob
from apps.templates.models import TemplateProcessStepRollSpec
from apps.production.services.stock_form_resolver import StockFormResolver

FOLD_CONFIG = {
    "roll_behavior": "MODIFY_EXISTING",
    "allowed_input_stock_forms": ["OPEN_WEB"],
    "allowed_output_stock_forms": ["OPEN_WEB", "FOLDED_WEB", "LAYFLAT_TUBE"],
    "stock_form_output_mode": "TARGET_DECIDES",
}
ROLL_STYLES = [
    # code, name, form, emoji, notes, fold (flap, seal, trim)
    ("ROLL-OPEN", "Open roll", "OPEN_WEB", "🧻", "Open web / sheet roll. Slitting allowed.", None),
    ("ROLL-FOLDED", "Folded roll (C-fold)", "FOLDED_WEB", "📁", "Folded in half, no flap. A size may type its own flap for a J-fold.", (0, 0, 0)),
    ("ROLL-JFOLD-20", "J-fold roll · 20 mm flap", "FOLDED_WEB", "📁", "One wall 20 mm longer. Open web = 2W + 20.", (20, 0, 0)),
    ("ROLL-JFOLD-30", "J-fold roll · 30 mm flap", "FOLDED_WEB", "📁", "One wall 30 mm longer. Open web = 2W + 30.", (30, 0, 0)),
    ("ROLL-JFOLD-40", "J-fold roll · 40 mm flap", "FOLDED_WEB", "📁", "One wall 40 mm longer (courier-bag lip). Open web = 2W + 40.", (40, 0, 0)),
    ("ROLL-TUBE", "Lay-flat tube roll", "LAYFLAT_TUBE", "⭕", "Lay-flat tube (blown or bought). A size may type the seal it takes when the folder seals.", (0, 0, 0)),
    ("ROLL-TUBE-SEAL-8", "Folded + sealed tube · 8 mm seal", "LAYFLAT_TUBE", "⭕", "Folded and edge-sealed into a tube; the seal takes 8 mm. Open web = 2W + 8.", (0, 8, 0)),
]
# Route step settings a fold step must have (one roll in, one out). Steps set up while the process was a
# combine keep lane groups / 2 rolls / narrowest width / summed gauge, which the WC screen reads as lamination lanes.
FOLD_STEP_SETTINGS = {
    "input_roll_count": 1,
    "combine_mode": "STRICT_ROLL_COUNT",
    "input_lane_count": 0,
    "lane_schema": [],
    "active_min_layer_count": 0,
    "width_rule": "LOCK_INPUT",
    "thickness_rule": "INHERIT_INPUT",
}
RUNNING_STATES = {"EXECUTING", "PAUSED"}
CLOSED_STATES = {"COMPLETED", "CANCELLED", "CLOSED"}


class Command(BaseCommand):
    help = "Report (and optionally fix) roll sizes whose Roll form never reached their stock form, and the Folding process setup."

    def add_arguments(self, parser):
        parser.add_argument("--process-code", nargs="+", default=["Fold"], help="Process Master code(s) of the folding steps (default: Fold).")
        parser.add_argument("--apply-sizes", action="store_true", help="Save the mismatched roll sizes.")
        parser.add_argument("--apply-styles", action="store_true", help="Create the ready-made roll styles that are missing.")
        parser.add_argument("--apply-links", action="store_true", help="Link pouch sizes on fold routes to the fold (linked style copies).")
        parser.add_argument("--apply-process", action="store_true", help="Reconfigure the folding process.")

    def handle(self, *args, **options):
        self._styles(apply=bool(options["apply_styles"]))
        self._sizes(apply=bool(options["apply_sizes"]))
        for code in options["process_code"]:
            self._process(code=str(code), apply=bool(options["apply_process"]))
        self._links(apply=bool(options["apply_links"]))

    def _styles(self, *, apply: bool):
        missing = [row for row in ROLL_STYLES if not PouchStyleMaster.objects.filter(code=row[0]).exists()]
        self.stdout.write(f"Ready-made roll styles missing: {len(missing)} ({', '.join(row[0] for row in missing) or 'none'})")
        if not apply or not missing:
            return
        with transaction.atomic():
            for code, name, form, emoji, notes, fold in missing:
                options = {}
                if fold is not None:
                    flap, seal, trim = fold
                    options = {form: {"enabled": True, "flap_mm": flap, "seal_mm": seal, "trim_mm": trim,
                                      "width_basis": default_width_basis(form), "slit_policy": default_slit_policy(form)}}
                PouchStyleMaster.objects.create(
                    code=code, name=name, style_for="ROLL", locked=True, visual_emoji=emoji, notes=notes,
                    default_stock_form=form, default_width_basis=default_width_basis(form),
                    default_slit_policy=default_slit_policy(form), sort_order=900, stock_form_options=options,
                )
        self.stdout.write(self.style.SUCCESS(f"Created {len(missing)} roll styles."))

    def _links(self, *, apply: bool):
        plan = _fold_route_plan()
        self.stdout.write(f"Pouch products on routes with a fold step: {len(plan)}")
        for master, step, target, rows in plan:
            counts = {}
            for _, action, _ in rows:
                counts[action] = counts.get(action, 0) + 1
            route = (master.template or master.default_template).name
            self.stdout.write(f"  {master.name} [{route}] fold at step {step} -> {target}: {counts or 'no active sizes'}")
            for size, action, reason in rows:
                if action == "skip":
                    self.stdout.write(f"    skip {size.label}: {reason}")
        if not apply:
            return
        linked = 0
        refreshed = 0
        with transaction.atomic():
            for master, step, target, rows in plan:
                for size, action, reason in rows:
                    if action == "refresh":
                        serializer = ProductMasterSizeSerializer(size, data={}, partial=True)
                        if not serializer.is_valid():
                            raise CommandError(f"{master.name} / {size.label}: {serializer.errors}")
                        serializer.save()
                        refreshed += 1
                        continue
                    if action != "link":
                        continue
                    copy, created = linked_style(size.pouch_style_master, target)
                    if created:
                        flap_field = (copy.stock_form_options.get(target) or {}).get("flap_field") or "none (fixed)"
                        self.stdout.write(f"  made style {copy.code} (v{copy.version}), flap from field: {flap_field}")
                    serializer = ProductMasterSizeSerializer(size, data={"pouch_style_master": str(copy.id)}, partial=True)
                    if not serializer.is_valid():
                        raise CommandError(f"{master.name} / {size.label}: {serializer.errors}")
                    serializer.save()
                    linked += 1
        self.stdout.write(self.style.SUCCESS(f"Linked {linked} sizes to the fold; refreshed {refreshed} already linked."))

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
        stale = [
            rs for rs in TemplateProcessStepRollSpec.objects.filter(template_step__process=process).select_related("template_step__template")
            if any(getattr(rs, key) != value for key, value in FOLD_STEP_SETTINGS.items())
        ]
        self.stdout.write(f"  route steps with old (combine) settings: {len(stale)}")
        for rs in stale:
            self.stdout.write(
                f"    {rs.template_step.template.name} step {rs.template_step.sequence_number}: rolls {rs.input_roll_count}, "
                f"{rs.combine_mode} x{rs.input_lane_count}, width {rs.width_rule}, thickness {rs.thickness_rule}"
            )
        open_jobs = ProductionJob.objects.filter(current_process=process).exclude(job_state__in=CLOSED_STATES)
        running = [job.job_number for job in open_jobs if str(job.job_state).upper() in RUNNING_STATES]
        self.stdout.write(f"  open jobs at this step: {open_jobs.count()} (running: {', '.join(running) or 'none'})")
        if current == FOLD_CONFIG and not stale:
            self.stdout.write(self.style.SUCCESS("  already set up for folding."))
            return
        self.stdout.write(f"  folding setup: {FOLD_CONFIG}")
        if not apply:
            return
        if running:
            raise CommandError(f"Jobs running on {process.code}: {', '.join(running)}. Finish or pause them first.")
        with transaction.atomic():
            if current != FOLD_CONFIG:
                for key, value in FOLD_CONFIG.items():
                    setattr(process, key, value)
                process.save(update_fields=list(FOLD_CONFIG))
            if stale:
                TemplateProcessStepRollSpec.objects.filter(id__in=[rs.id for rs in stale]).update(**FOLD_STEP_SETTINGS)
        self.stdout.write(self.style.SUCCESS(
            f"  {process.code} now folds: open web in, the order's form out; {len(stale)} route step settings reset to one roll in / one out."
        ))


def route_fold_target(template):
    """(fold step sequence, form the route's fold makes) or None when the route has no fold step.

    The fold step is the first step whose process takes open web and can output a folded web or a tube
    (Process Master: non-PRESERVE output mode). Tube when a later step takes tubes only, else folded web.
    """
    if template is None:
        return None
    steps = list(template.process_steps.filter(is_removed_from_route=False).select_related("process").order_by("sequence_number"))
    for index, step in enumerate(steps):
        process = step.process
        if not (StockFormResolver.makes_form(process, STOCK_FORM_FOLDED_WEB) or StockFormResolver.makes_form(process, STOCK_FORM_LAYFLAT_TUBE)):
            continue
        later_inputs = [StockFormResolver._allowed(later.process, "allowed_input_stock_forms") for later in steps[index + 1:]]
        tube_only = any(forms and STOCK_FORM_LAYFLAT_TUBE in forms and STOCK_FORM_OPEN_WEB not in forms and STOCK_FORM_FOLDED_WEB not in forms for forms in later_inputs)
        target = STOCK_FORM_LAYFLAT_TUBE if tube_only else STOCK_FORM_FOLDED_WEB
        if StockFormResolver.makes_form(process, target):
            return step.sequence_number, target
    return None


def flap_field_of(style) -> str:
    """The formula input that is a flap (e.g. "Flap"), when the formula adds it once to the open web."""
    params = style.formula_params if isinstance(style.formula_params, dict) else {}
    for term in params.get("terms") or []:
        factors = term.get("factors") if isinstance(term, dict) else None
        if not isinstance(factors, list):
            continue
        fields = [f.get("field") for f in factors if isinstance(f, dict) and f.get("kind") == "FIELD"]
        numbers = [f.get("value") for f in factors if isinstance(f, dict) and f.get("kind") == "NUMBER"]
        if len(fields) == 1 and "flap" in str(fields[0]).lower() and all(float(n or 0) == 1 for n in numbers):
            return str(fields[0])
    return ""


def linked_style(style, target):
    """The approved copy of `style` (same code + version, suffixed) read as the open web before the fold."""
    suffix = "ON-TUBE" if target == STOCK_FORM_LAYFLAT_TUBE else "ON-FOLD"
    code = f"{style.code}-{suffix}"[:80]
    existing = PouchStyleMaster.objects.filter(code=code, version=style.version).first()
    if existing is not None:
        return existing, False
    options = dict(style.stock_form_options or {}) if isinstance(style.stock_form_options, dict) else {}
    options[target] = {
        "enabled": True,
        "formula_basis": FORMULA_BASIS_OPEN,
        "flap_mm": 0,
        "flap_field": flap_field_of(style),
        "seal_mm": 0,
        "trim_mm": 0,
        "film_area_factor": 2,
        "width_basis": default_width_basis(target),
        "slit_policy": default_slit_policy(target),
    }
    word = "tube" if target == STOCK_FORM_LAYFLAT_TUBE else "folded film"
    copy = PouchStyleMaster.objects.create(
        code=code,
        version=style.version,
        name=f"{style.name} · on {word}"[:160],
        description=style.description,
        locked=True,
        visual_emoji=style.visual_emoji,
        visual_svg=style.visual_svg,
        style_for="POUCH",
        default_roll_axis=style.default_roll_axis,
        default_stock_form=target,
        default_width_basis=default_width_basis(target),
        default_slit_policy=default_slit_policy(target),
        stock_form_options=options,
        allowed_fields=style.allowed_fields,
        field_adjustments=style.field_adjustments,
        formula_kind=style.formula_kind,
        formula_params=style.formula_params,
        formula_ast=style.formula_ast,
        formula_expression=style.formula_expression,
        sort_order=style.sort_order,
        default_margin_pct=style.default_margin_pct,
        conversion_stages=style.conversion_stages,
        notes=(
            f"Linked copy of {style.code} v{style.version} for routes with a fold step: the formula gives the open web "
            f"before the fold; the {word} width = (open - flap - seal - trim) / 2. "
            + (f"The flap is each size's \"{flap_field_of(style)}\" value. " if flap_field_of(style) else "Fill the flap here. ")
            + "Seal / fold trim are set here."
        ),
    )
    return copy, True


def _fold_route_plan():
    """Rows: (product, fold step, target, [(size, action, reason)])."""
    plan = []
    masters = ProductMaster.objects.filter(product_kind="POUCH").select_related("template", "default_template")
    for master in masters:
        if getattr(master, "active", True) is False:
            continue
        target = route_fold_target(master.template or master.default_template)
        if target is None:
            continue
        rows = []
        for size in ProductMasterSize.objects.filter(product_master=master, active=True).select_related("pouch_style_master"):
            style = size.pouch_style_master
            form = normalize_stock_form(size.stock_form)
            options = (style.stock_form_options or {}) if style is not None and isinstance(style.stock_form_options, dict) else {}
            if form in FOLDABLE_FORMS and str((options.get(form) or {}).get("formula_basis") or "").upper() == FORMULA_BASIS_OPEN:
                # Already on a linked style: recompute so the folded width follows the style's current fold.
                rows.append((size, "refresh", style.code))
            elif form in FOLDABLE_FORMS:
                rows.append((size, "keep", f"already {form}"))
            elif style is None:
                rows.append((size, "skip", "no pouch style: pick one on the size"))
            elif size.child_target_override:
                rows.append((size, "skip", "child width typed by hand: set the form on the size"))
            elif getattr(style, "is_roll_style", False):
                rows.append((size, "skip", "bound to a roll style"))
            else:
                rows.append((size, "link", style.code))
        plan.append((master, target[0], target[1], rows))
    return plan
