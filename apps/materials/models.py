import hashlib
import json
import logging
from django.db import models
from django.db.utils import OperationalError, ProgrammingError
from django.core.exceptions import ValidationError
import uuid
from decimal import Decimal

from .naming import normalize_code
from .stock_forms import (
    SLIT_POLICY_CHOICES,
    SLIT_POLICY_ALLOWED,
    STOCK_FORM_CHOICES,
    STOCK_FORM_OPEN_WEB,
    WIDTH_BASIS_CHOICES,
    WIDTH_BASIS_OPEN_WEB,
    default_slit_policy,
    default_width_basis,
    film_area_factor_for_stock_form,
    normalize_slit_policy,
    normalize_stock_form,
    normalize_width_basis,
)

logger = logging.getLogger(__name__)


class CommercialFamily(models.Model):
    FORM_CHOICES = [
        ("ROLL", "Roll"),
        ("POUCH", "Pouch"),
    ]

    REPORTING_GROUP_CHOICES = [
        ("FILM", "Film"),
        ("PRINTED", "Printed"),
        ("LAMINATED", "Laminated"),
        ("SEMI_FG", "Semi-Finished"),
        ("FG", "Finished Goods"),
        ("PACKAGING", "Packaging"),
        ("POD", "POD"),
        ("OTHER", "Other"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=50, unique=True, db_index=True)
    name = models.CharField(max_length=120)
    default_form = models.CharField(max_length=10, choices=FORM_CHOICES, default="ROLL")
    default_reporting_group = models.CharField(max_length=20, choices=REPORTING_GROUP_CHOICES, default="FILM")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "commercial_families"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=50)
        super().save(*args, **kwargs)


class ProductMaster(models.Model):
    PRODUCT_KIND_CHOICES = [
        ("POUCH", "Pouch"),
        ("ROLL", "Roll"),
        ("PACKAGING", "Packaging"),
        ("POD", "POD"),
        ("OTHER", "Other"),
    ]
    REUSABLE_POLICY_CHOICES = [
        ("CONFIGURABLE", "Configurable Order Lines"),
        ("PRESET_ONLY", "Saved Presets Only"),
        ("CUSTOMER_SPECIFIC", "Customer Specific"),
    ]
    # Subtype for PACKAGING masters. Only INNER_POUCH (inner-pouch carriers)
    # and SHEET (roll-form packing sheet/wrap, "roll for packing" in the new
    # model) are valid choices — packaging masters are in-house produced
    # items only. Purchased packing items (gunny, tape, label, tag) stay as
    # plain InventoryMaterial rows and don't get a ProductMaster.
    # Null for non-PACKAGING masters.
    PACKAGING_KIND_CHOICES = [
        ("INNER_POUCH", "Inner Pouch"),
        ("SHEET", "Sheet / Roll for packing"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    version_group = models.CharField(
        max_length=80,
        blank=True,
        default="",
        db_index=True,
        help_text="Stable root code shared by all versions of this Product Master.",
    )
    version = models.PositiveIntegerField(default=1, db_index=True)
    is_current_version = models.BooleanField(default=True, db_index=True)
    superseded_by = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="superseded_versions",
    )
    product_kind = models.CharField(max_length=20, choices=PRODUCT_KIND_CHOICES, default="POUCH")
    # Subtype indicator — only set when product_kind=PACKAGING. It constrains
    # which fixed catalog SKU kind an admin may manually link to this master's
    # variants.
    packaging_kind = models.CharField(
        max_length=20,
        choices=PACKAGING_KIND_CHOICES,
        null=True,
        blank=True,
        help_text="Only set for PACKAGING masters. INNER_POUCH = inner pouch carrier · SHEET = roll for packing.",
    )
    default_template = models.ForeignKey(
        "templates.TemplateBlueprint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="product_masters",
    )
    # v3: template is the canonical route (replaces default_template for new flow)
    template = models.ForeignKey(
        "templates.TemplateBlueprint",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="masters",
    )
    extrusion_recipe = models.ForeignKey(
        "recipes.ExtrusionRecipe",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="masters",
    )
    commercial_family = models.ForeignKey(
        CommercialFamily,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="product_masters",
    )
    default_reporting_group = models.CharField(max_length=20, choices=CommercialFamily.REPORTING_GROUP_CHOICES, default="FG")
    reusable_policy = models.CharField(max_length=24, choices=REUSABLE_POLICY_CHOICES, default="CONFIGURABLE")
    canonical_layer_stack = models.JSONField(
        default=list,
        blank=True,
        help_text="Reusable product-level layer identity, excluding size/artwork/customer. Execution still freezes order snapshots.",
    )
    # v3 canonical recipe shape
    layer_template = models.JSONField(
        default=list,
        blank=True,
        help_text="[{role, material_code/film_variant_code, thickness_micron, grade_options, default_grade}]",
    )
    # v3 which axes vary on this master
    variant_axes = models.JSONField(
        default=list,
        blank=True,
        help_text="[{axis, type, required, options?, scope?}]",
    )
    # v3 what does NOT vary
    fixed_attributes = models.JSONField(
        default=dict,
        blank=True,
        help_text="{layer_count, fg_type, print_capable, ...}",
    )
    invariant_signature = models.CharField(
        max_length=128,
        blank=True,
        default="",
        db_index=True,
        help_text="Product-level invariant signature used for grouping/reporting and planner reuse hints.",
    )
    description = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "product_masters"
        ordering = ["name", "code"]

    def clean(self):
        if self.default_template_id:
            template_kind = str(getattr(self.default_template, "fg_type", "") or "").upper()
            if self.product_kind in {"POUCH", "ROLL"} and template_kind and template_kind != self.product_kind:
                raise ValidationError({"default_template": "Default template fg_type must match Product Master kind."})

    def __str__(self):
        return f"{self.code} - {self.name}"

    @staticmethod
    def version_root_from_code(code: str) -> str:
        root = normalize_code(str(code or "PM"), max_length=80)
        if "-V" in root:
            prefix, suffix = root.rsplit("-V", 1)
            if prefix and suffix.isdigit():
                return prefix
        return root or "PM"

    @staticmethod
    def version_number_from_code(code: str) -> int:
        root = normalize_code(str(code or ""), max_length=80)
        if "-V" in root:
            _prefix, suffix = root.rsplit("-V", 1)
            if suffix.isdigit():
                return max(1, int(suffix))
        return 1

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80)
        self.version_group = normalize_code(
            self.version_group or self.version_root_from_code(self.code),
            max_length=80,
        )
        parsed_version = self.version_number_from_code(self.code)
        if parsed_version > 1 and int(self.version or 1) <= 1:
            self.version = parsed_version
        elif not self.version or int(self.version) < 1:
            self.version = 1
        seed = {
            "template": str(self.template_id or self.default_template_id or ""),
            "layer_template": self.layer_template or self.canonical_layer_stack or [],
            "variant_axes": self.variant_axes or [],
            "fixed_attributes": self.fixed_attributes or {},
        }
        self.invariant_signature = hashlib.sha256(
            json.dumps(seed, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:64]
        super().save(*args, **kwargs)


class ProductVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    master = models.ForeignKey(
        ProductMaster,
        on_delete=models.PROTECT,
        related_name="variants",
    )
    code = models.CharField(max_length=80)
    axis_values = models.JSONField(default=dict, blank=True)
    geometry_snapshot = models.JSONField(default=dict, blank=True)
    layer_snapshot = models.JSONField(default=list, blank=True)
    bom_signature = models.CharField(max_length=128, db_index=True, blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "product_variants"
        ordering = ["master__name", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["master", "bom_signature"],
                name="product_variant_unique_per_master_axis_combo",
            ),
        ]

    def __str__(self):
        return f"{self.master.code} / {self.code}"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80)
        super().save(*args, **kwargs)


class WebWidthPolicy(models.Model):
    """
    Production-side policy declaring how a sales-order's `preferred_lane_count`
    is allowed to translate into actual production. Attached as a default to
    `RoutingRule` (one policy per route). Optional override per Machine.

    Fields:
      - allowed_lanes: which N-up runs are permitted (e.g. [1, 2, 3])
      - allowed_parent_widths: optional hint list (e.g. [440, 880, 1320]);
        null = "any width ≥ child × lanes + trim is fine"
      - slitting_waste_rule: { inter_cut_mm, edge_trim_mm, formula }
      - min_remainder_mm: remainder rolls smaller than this go to scrap
      - prefer_remainder_first: if true, allocator scores remainder rolls
        ahead of fresh rolls within the same tier
    """

    FORMULA_CHOICES = [
        ("PER_CUT", "Per cut"),
        ("PER_LANE", "Per lane"),
        ("FIXED", "Fixed amount"),
    ]
    SCOPE_CHOICES = [
        ("GLOBAL", "Global default"),
        ("PRODUCT_KIND", "Product kind"),
        ("PRODUCT_MASTER", "Product master"),
        ("POUCH_STYLE", "Pouch style"),
        ("PROCESS", "Process"),
        ("MACHINE", "Machine"),
    ]
    PARENT_WIDTH_STRATEGY_CHOICES = [
        ("CALCULATED", "Use calculated width"),
        ("NEAREST_STANDARD", "Use nearest configured parent width"),
        ("STRICT_STANDARD", "Require configured parent width"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True, db_index=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")

    is_default = models.BooleanField(
        default=False,
        help_text="True for the global fallback policy used when a route has none attached.",
    )
    scope_type = models.CharField(max_length=32, choices=SCOPE_CHOICES, default="GLOBAL", db_index=True)
    scope_ref = models.CharField(
        max_length=120,
        blank=True,
        default="",
        db_index=True,
        help_text="Code or UUID for the selected scope. Blank for GLOBAL.",
    )

    allowed_lanes = models.JSONField(default=list, blank=True)
    allowed_parent_widths = models.JSONField(default=list, blank=True)
    parent_width_strategy = models.CharField(
        max_length=32,
        choices=PARENT_WIDTH_STRATEGY_CHOICES,
        default="CALCULATED",
        help_text="Whether planning uses the calculated web width or snaps to configured parent widths.",
    )
    min_parent_width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    max_parent_width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    slitting_waste_rule = models.JSONField(
        default=dict,
        blank=True,
        help_text="JSON: { inter_cut_mm, edge_trim_mm, formula: PER_CUT|PER_LANE|FIXED }",
    )

    min_remainder_mm = models.PositiveIntegerField(
        default=50,
        help_text="Remainder rolls below this width go straight to scrap.",
    )
    prefer_remainder_first = models.BooleanField(default=True)

    deprecated = models.BooleanField(default=False)
    notes = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "web_width_policies"
        ordering = ["-is_default", "name"]
        indexes = [
            models.Index(fields=["scope_type", "scope_ref"], name="web_width_policy_scope_idx"),
        ]

    def __str__(self):
        return f"{self.name} ({self.code})"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80).upper()
        self.scope_type = (self.scope_type or "GLOBAL").upper()
        self.scope_ref = "" if self.scope_type == "GLOBAL" else str(self.scope_ref or "").strip()
        self.parent_width_strategy = (self.parent_width_strategy or "CALCULATED").upper()
        super().save(*args, **kwargs)
        if self.is_default:
            WebWidthPolicy.objects.exclude(pk=self.pk).filter(is_default=True).update(is_default=False)


class PouchStyleMaster(models.Model):
    """
    Pouch style master — declares which input fields apply, how they affect the
    web axis (per-side adjustments), and the formula that computes
    target_child_width_mm.

    Two formula modes:
      * One of the closed-set `formula_kind` values (safe, fast, pre-baked).
      * `CUSTOM_AST` mode — operator builds an expression tree by hand.

    Version-pinned: ProductMasterSize stores both pouch_style_id and the version
    snapshot at the time it was bound, so historical sizes keep their math even
    when ops tunes the style going forward.
    """

    FORMULA_KIND_CHOICES = [
        ("SIMPLE_DOUBLE", "Simple double wall"),
        ("THREE_SIDE_SEAL", "Three-side seal"),
        ("GUSSETED_SIDE", "Side gusset"),
        ("GUSSETED_BOTTOM", "Bottom gusset / stand-up"),
        ("QUAD_SEAL", "Quad seal"),
        ("FLAT_BOTTOM", "Flat bottom"),
        ("CENTER_SEAL_H", "Center seal on height axis"),
        ("SPOUT", "Spout pouch"),
        ("STICK_PACK", "Stick pack"),
        ("SACHET", "Sachet"),
        ("LINEAR", "Linear formula - sum(coefficient x field) + trim"),
        ("SHAPED_OVERRIDE", "Operator enters target directly"),
        ("CUSTOM_AST", "Custom expression tree (advanced)"),
    ]

    AXIS_CHOICES = [
        ("WIDTH", "Width axis"),
        ("HEIGHT", "Height axis"),
        ("BOTH", "Both axes"),
        ("NONE", "None"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, db_index=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True, default="")

    version = models.PositiveIntegerField(default=1)
    locked = models.BooleanField(
        default=False,
        help_text="Set true once first ProductMasterSize binds. Editing then spawns a new version.",
    )

    visual_emoji = models.CharField(max_length=8, blank=True, default="🛍️")
    visual_svg = models.TextField(
        blank=True,
        default="",
        help_text="Optional inline SVG cheat-sheet of the pouch shape.",
    )

    default_roll_axis = models.CharField(max_length=10, choices=AXIS_CHOICES, default="WIDTH")
    default_stock_form = models.CharField(
        max_length=24,
        choices=STOCK_FORM_CHOICES,
        default=STOCK_FORM_OPEN_WEB,
        help_text="Physical stock form this pouch style normally consumes: open web/sheet or lay-flat tubing.",
    )
    default_width_basis = models.CharField(
        max_length=32,
        choices=WIDTH_BASIS_CHOICES,
        default=WIDTH_BASIS_OPEN_WEB,
        help_text="Meaning of the stored width for this stock form.",
    )
    default_slit_policy = models.CharField(
        max_length=24,
        choices=SLIT_POLICY_CHOICES,
        default=SLIT_POLICY_ALLOWED,
        help_text="Whether WCM can slit wider parent stock for this pouch style.",
    )
    stock_form_options = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Per-stock-form overrides. Example: "
            "{OPEN_WEB:{film_area_factor:1, slit_policy:SLIT_ALLOWED}, "
            "LAYFLAT_TUBE:{film_area_factor:2, slit_policy:EXACT_ONLY}}."
        ),
    )

    # Which input fields the size editor will surface for this style.
    # JSON shape:
    #   {
    #     "W":      {"required": true,  "label": "Width",  "min": 1,    "max": 2000},
    #     "H":      {"required": true,  "label": "Height", "min": 1,    "max": 2000},
    #     "gusset": {"required": false, "label": "Gusset"},
    #     "flap":   {"required": false, "label": "Flap"},
    #     "factor": {"required": false, "default": 1.0},
    #   }
    allowed_fields = models.JSONField(default=dict, blank=True)

    # How allowed fields affect the roll-width math when the closed-set
    # formula is used. Per-side adjustments live here.
    # JSON shape:
    #   {
    #     "gusset_axis":   "BOTH" | "WIDTH" | "HEIGHT" | "NONE",
    #     "trim_axis":     "WIDTH" | "HEIGHT" | "BOTH" | "NONE",
    #     "trim_default_mm": 5
    #   }
    field_adjustments = models.JSONField(default=dict, blank=True)

    formula_kind = models.CharField(
        max_length=24,
        choices=FORMULA_KIND_CHOICES,
        default="LINEAR",
    )
    formula_params = models.JSONField(default=dict, blank=True)
    formula_ast = models.JSONField(default=dict, blank=True)
    formula_expression = models.TextField(
        blank=True,
        default="",
        help_text="Human-readable mirror of the AST/kind for display only.",
    )

    deprecated = models.BooleanField(default=False)
    sort_order = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default="")

    default_margin_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Style default margin floor. Cascade rank #2.",
    )
    conversion_stages = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'Which plant rate-card stages apply for this pouch style, '
            'e.g. ["extrusion","printing","slitting","pouching"]. '
            'Empty list = all stages.'
        ),
    )

    created_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="pouch_styles_created"
    )
    updated_by = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="pouch_styles_updated"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pouch_styles"
        ordering = ["sort_order", "name", "-version"]
        constraints = [
            models.UniqueConstraint(fields=["code", "version"], name="pouchstyle_code_version_unique"),
        ]

    def __str__(self):
        return f"{self.name} ({self.code}) v{self.version}"

    def clean(self):
        super().clean()
        from .services_pouch_style import formula_axis_contract_error

        contract_error = formula_axis_contract_error(
            default_roll_axis=self.default_roll_axis,
            formula_kind=self.formula_kind,
            formula_params=self.formula_params,
            formula_ast=self.formula_ast,
        )
        if contract_error:
            raise ValidationError({"default_roll_axis": contract_error})

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80).upper()
        self.default_stock_form = normalize_stock_form(self.default_stock_form)
        self.default_width_basis = normalize_width_basis(self.default_width_basis, stock_form=self.default_stock_form)
        self.default_slit_policy = normalize_slit_policy(self.default_slit_policy, stock_form=self.default_stock_form)
        options = self.stock_form_options if isinstance(self.stock_form_options, dict) else {}
        if not options:
            options = {
                "OPEN_WEB": {
                    "enabled": True,
                    "film_area_factor": 1,
                    "width_basis": "OPEN_WEB_WIDTH",
                    "slit_policy": "SLIT_ALLOWED",
                },
                "LAYFLAT_TUBE": {
                    "enabled": False,
                    "film_area_factor": 2,
                    "width_basis": "LAYFLAT_WIDTH",
                    "slit_policy": "EXACT_ONLY",
                },
            }
        self.stock_form_options = options
        super().save(*args, **kwargs)


class ProductMasterSize(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    product_master = models.ForeignKey(ProductMaster, on_delete=models.CASCADE, related_name="sizes")
    code = models.CharField(max_length=80)
    label = models.CharField(max_length=120)
    width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    height_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    gusset_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    roll_width_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    thickness_micron = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    standard_qty = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    qty_uom = models.CharField(max_length=10, choices=[("KG", "Kilograms"), ("PCS", "Pieces"), ("METER", "Meters")], default="KG")
    geometry_config = models.JSONField(default=dict, blank=True)
    default_packing = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True, default="")
    active = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    # ── Pouch-style binding (new final model) ────────────────────────────
    pouch_style_master = models.ForeignKey(
        PouchStyleMaster,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sizes",
        help_text="Pouch style master defining formula + allowed fields for this size.",
    )
    pouch_style_version = models.PositiveIntegerField(
        default=0,
        help_text="Snapshot of the bound pouch style's version at the time of binding.",
    )
    child_target_width_mm = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Physical stock width requirement. Auto-computed by the pouch style formula, with optional manual override.",
    )
    stock_form = models.CharField(
        max_length=24,
        choices=STOCK_FORM_CHOICES,
        default=STOCK_FORM_OPEN_WEB,
        db_index=True,
        help_text="Physical stock form to consume for this size.",
    )
    width_basis = models.CharField(
        max_length=32,
        choices=WIDTH_BASIS_CHOICES,
        default=WIDTH_BASIS_OPEN_WEB,
        help_text="Meaning of child_target_width_mm / roll_width_mm for this size.",
    )
    film_area_width_mm = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Width used for film-area weight math. Usually stock width for open web, 2 × lay-flat width for tubing.",
    )
    slit_policy = models.CharField(
        max_length=24,
        choices=SLIT_POLICY_CHOICES,
        default=SLIT_POLICY_ALLOWED,
        help_text="Whether WCM can slit wider parent rolls for this size.",
    )
    child_target_override = models.BooleanField(
        default=False,
        help_text="True when child_target_width_mm was set manually instead of computed.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "product_master_sizes"
        ordering = ["product_master__name", "sort_order", "label", "code"]
        constraints = [
            models.UniqueConstraint(fields=["product_master", "code"], name="product_master_size_unique_code"),
        ]

    def clean(self):
        super().clean()
        if self.product_master_id and str(getattr(self.product_master, "product_kind", "") or "").upper() == "POUCH":
            missing = {}
            if self.width_mm is None:
                missing["width_mm"] = "Pouch size requires width_mm."
            if self.height_mm is None:
                missing["height_mm"] = "Pouch size requires height_mm."
            if missing:
                raise ValidationError(missing)
        style = getattr(self, "pouch_style_master", None)
        if style is not None:
            from .services_pouch_style import formula_axis_contract_error

            contract_error = formula_axis_contract_error(
                default_roll_axis=style.default_roll_axis,
                formula_kind=style.formula_kind,
                formula_params=style.formula_params,
                formula_ast=style.formula_ast,
            )
            if contract_error:
                raise ValidationError({"pouch_style_master": contract_error})

    def __str__(self):
        return f"{self.product_master.code} / {self.code}"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80)
        self.stock_form = normalize_stock_form(self.stock_form)
        self.width_basis = normalize_width_basis(self.width_basis, stock_form=self.stock_form)
        self.slit_policy = normalize_slit_policy(self.slit_policy, stock_form=self.stock_form)
        if self.film_area_width_mm in (None, "") and self.child_target_width_mm not in (None, ""):
            factor = Decimal(str(film_area_factor_for_stock_form(self.stock_form)))
            self.film_area_width_mm = (Decimal(str(self.child_target_width_mm)) * factor).quantize(Decimal("0.01"))
        elif self.film_area_width_mm in (None, "") and self.width_mm not in (None, ""):
            try:
                is_pouch = self.product_master_id and str(getattr(self.product_master, "product_kind", "") or "").upper() == "POUCH"
            except Exception:
                is_pouch = False
            if is_pouch:
                geometry_config = self.geometry_config if isinstance(self.geometry_config, dict) else {}
                trim_loss = Decimal(str(geometry_config.get("trim_loss_mm") if geometry_config.get("trim_loss_mm") not in (None, "") else 10))
                trim_apply_to = str(geometry_config.get("trim_apply_to") or "WIDTH").upper()
                width_trim = trim_loss if trim_apply_to in {"WIDTH", "BOTH"} else Decimal("0")
                legacy_open_web_width = ((Decimal(str(self.width_mm)) * Decimal("2")) + width_trim).quantize(Decimal("0.01"))
                if self.child_target_width_mm in (None, ""):
                    self.child_target_width_mm = legacy_open_web_width
                self.film_area_width_mm = legacy_open_web_width
        super().save(*args, **kwargs)


class InventoryMaterial(models.Model):
    """
    Consolidated Master for all physical materials.
    Atomic Truth: ONE table, behavior by category.
    """
    CATEGORY_CHOICES = [
        ('FILM_FAMILY', 'Film Family'),
        ('FILM_VARIANT', 'Film Variant'),
        ('GRANULE', 'Granule'),
        ('INK', 'Ink'),
        ('SOLVENT', 'Solvent'),
        ('ADHESIVE', 'Adhesive'),
        ('PACKAGING', 'Packaging'),
        ('ADDON', 'Add-On'),
        ('POD', 'POD Film'),
    ]
    
    UNIT_CHOICES = [
        ('KG', 'Kilograms (KG)'),
        ('PCS', 'Pieces (PCS)'),
        ('METER', 'Meters (M)'),
    ]
    VALID_MASTER_UOMS = {'KG', 'PCS', 'METER'}
    UOM_ALIASES = {
        'KG': 'KG',
        'KGS': 'KG',
        'KILOGRAM': 'KG',
        'KILOGRAMS': 'KG',
        'PCS': 'PCS',
        'PC': 'PCS',
        'PIECE': 'PCS',
        'PIECES': 'PCS',
        'NOS': 'PCS',
        'NO': 'PCS',
        'EACH': 'PCS',
        'EA': 'PCS',
        'UNIT': 'PCS',
        'UNITS': 'PCS',
        'M': 'METER',
        'MTR': 'METER',
        'MTRS': 'METER',
        'MTS': 'METER',
        'METRE': 'METER',
        'METRES': 'METER',
        'METER': 'METER',
        'METERS': 'METER',
    }

    # Addon Weight Modes
    WEIGHT_MODE_CHOICES = [
        ('PER_MM', 'Per MM'),
        ('PER_PIECE', 'Per Piece'),
        ('FIXED', 'Fixed Weight'),
    ]

    PACKAGING_KIND_CHOICES = [
        ('INNER_POUCH', 'Inner Pouch'),
        ('OUTER_BAG', 'Outer Bag / Packing Pouch'),
        ('GONNY', 'Gonny'),
        ('TAPE', 'Tape'),
        ('SHEET', 'Sheet'),
        ('BOX', 'Box'),
        ('LABEL', 'Label'),
        ('TAG', 'Tag'),
        ('OTHER', 'Other'),
    ]

    PACKAGING_SUPPLY_MODE_CHOICES = [
        ('PURCHASED', 'Purchased'),
        ('IN_HOUSE', 'In House'),
        ('BOTH', 'Both'),
    ]

    POD_TYPE_CHOICES = [
        ('SINGLE', 'Single POD'),
        ('DOUBLE', 'Double POD'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, db_index=True)
    base_uom = models.CharField(max_length=10, choices=UNIT_CHOICES, default='KG')
    commercial_family = models.ForeignKey(
        CommercialFamily,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='materials',
        help_text="Controlled business-facing family alias used for naming, stock grouping, and reporting.",
    )

    # Film Specific
    density_gcm3 = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True, help_text="Density in g/cm3 - Mandatory for FILM_FAMILY")
    parent_family = models.ForeignKey(
        'self', 
        on_delete=models.PROTECT, 
        null=True, 
        blank=True, 
        related_name='variants', 
        limit_choices_to={'category': 'FILM_FAMILY'},
        help_text="Mandatory for FILM_VARIANT"
    )
    grade = models.ForeignKey(
        'recipes.RecipeGrade', 
        on_delete=models.PROTECT, 
        null=True, 
        blank=True, 
        related_name='materials',
        help_text="Mandatory for FILM_VARIANT"
    )
    is_extrudable = models.BooleanField(default=False, help_text="TRUE enables recipe engineering for this variant")
    is_purchasable = models.BooleanField(default=True, help_text="TRUE if this material can be purchased directly")

    # Addon Specific
    weight_mode = models.CharField(max_length=20, choices=WEIGHT_MODE_CHOICES, null=True, blank=True)
    weight_value = models.FloatField(null=True, blank=True, help_text="Formula input value (g) based on weight_mode")
    addon_is_purchased = models.BooleanField(
        default=False,
        help_text="TRUE when this add-on is bought and stocked through bulk GRN before order-level consumption.",
    )
    addon_purchase_uom = models.CharField(
        max_length=10,
        choices=[('KG', 'Kilograms (KG)'), ('PCS', 'Pieces (PCS)'), ('METER', 'Meters (METER)')],
        default='KG',
        help_text="Inventory UOM used when purchased add-ons are inwarded through bulk GRN.",
    )

    # Packaging Specific
    packaging_kind = models.CharField(
        max_length=20,
        choices=PACKAGING_KIND_CHOICES,
        null=True,
        blank=True,
    )
    packaging_supply_mode = models.CharField(
        max_length=20,
        choices=PACKAGING_SUPPLY_MODE_CHOICES,
        null=True,
        blank=True,
    )
    production_template = models.ForeignKey(
        "templates.TemplateBlueprint",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="packaging_materials",
        help_text="Linked in-house template/blueprint used when this packaging SKU is manufactured as PACKAGING_STOCK.",
    )
    packaging_defaults_json = models.JSONField(
        default=dict,
        blank=True,
        help_text="Optional branded packaging defaults used by packing-yard flows.",
    )
    per_sheet_base_qty = models.DecimalField(
        max_digits=12,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="Base-UOM qty represented by one consumed unit when operators enter packaging usage in PCS.",
    )

    # POD profile (formula-driven, master-authoritative)
    pod_type = models.CharField(max_length=20, choices=POD_TYPE_CHOICES, null=True, blank=True)
    pod_fixed_height_mm = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    pod_thickness_micron = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    pod_panel_count = models.PositiveIntegerField(null=True, blank=True)
    pod_is_inhouse_produced = models.BooleanField(default=False)

    # ── ProductMaster ↔ InventoryMaterial bridge ────────────────────
    # Manual ProductMaster <-> catalog bridge for PACKAGING/POD. Catalog SKUs
    # stay fixed rows; admins link an existing row to the PM variant that can
    # produce it in-house. Null = purchased/manual catalog row not tied to a
    # PM variant.
    produced_by_product_variant = models.ForeignKey(
        "materials.ProductVariant",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="inventory_links",
        help_text="Manual back-link to the ProductVariant that can produce this fixed catalog row (PACKAGING / POD masters). Null for purchased/manual SKUs.",
    )

    status = models.CharField(max_length=10, default='ACTIVE', choices=[('ACTIVE', 'Active'), ('INACTIVE', 'Inactive')])

    # Sprint 3 — Reorder policy fields (low-stock alerts + MRP buffers).
    reorder_qty = models.DecimalField(
        max_digits=14,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="When stock falls below this, raise a low-stock alert.",
    )
    safety_stock = models.DecimalField(
        max_digits=14,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Buffer below which production is at risk.",
    )
    lead_time_override_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Override vendor lead time for this material.",
    )

    # Trade-resale flags — granules and film variants flagged TRUE here become
    # selectable in Trade Orders (resold as-is, no production cycle).
    is_sellable = models.BooleanField(
        default=False,
        help_text="TRUE if this material can be sold as a trading good (granules, film variants resold as-is)",
    )
    default_gst_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Default GST % when sold via trade order. Operator can override per-line.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inventory_materials'
        verbose_name = "Material Master"
        verbose_name_plural = "Material Master"

    def __str__(self):
        return f"[{self.code}] {self.name}"

    @classmethod
    def normalize_master_uom(cls, value, default='KG'):
        compact = ''.join(ch for ch in str(value or default or '').strip().upper() if ch.isalnum())
        uom = cls.UOM_ALIASES.get(compact, compact)
        if uom not in cls.VALID_MASTER_UOMS:
            raise ValidationError("Material base UOM must be KG, PCS, or METER.")
        return uom

    def save(self, *args, **kwargs):
        previous_code = ""
        if self.pk and not self._state.adding:
            try:
                previous_code = str(
                    type(self).objects.filter(pk=self.pk).values_list("code", flat=True).first() or ""
                )
            except Exception:
                previous_code = ""
        self.code = normalize_code(self.code, max_length=100)
        self.base_uom = self.normalize_master_uom(self.base_uom or 'KG')
        if self.category == 'ADDON':
            self.is_purchasable = bool(self.addon_is_purchased)
            self.addon_purchase_uom = self.normalize_master_uom(self.addon_purchase_uom or 'KG')
            self.base_uom = self.addon_purchase_uom if self.addon_is_purchased else 'KG'
        super().save(*args, **kwargs)
        if previous_code and previous_code != self.code:
            try:
                MaterialCodeAlias.objects.update_or_create(
                    alias=previous_code,
                    defaults={
                        "material": self,
                        "category": self.category,
                        "active": True,
                        "notes": "Automatically retained when material code changed.",
                    },
                )
            # During an upgrade, an older migration may update a material
            # before the alias table is created. The deterministic repair
            # command seeds those historical aliases after migration.
            except (OperationalError, ProgrammingError):
                logger.debug("Material alias table unavailable while retaining previous code=%s", previous_code, exc_info=True)

    def clean(self):
        # 1. FILM_FAMILY Density Validation
        if self.category == 'FILM_FAMILY' and self.density_gcm3 is None:
            raise ValidationError({'density_gcm3': "Film Family must have a density (g/cm³)."})
        
        # 2. FILM_VARIANT Parent Validation
        if self.category == 'FILM_VARIANT' and not self.parent_family:
            raise ValidationError({'parent_family': "Film Variant must belong to a parent family."})
        
        # 3. ADDON Validation
        if self.category == 'ADDON':
            if not self.weight_mode:
                raise ValidationError({'weight_mode': "Addon must have a weight mode (PER_MM, PER_PIECE, FIXED)."})
            if self.weight_value is None:
                raise ValidationError({'weight_value': "Addon must have a weight value (float)."})
            try:
                self.addon_purchase_uom = self.normalize_master_uom(self.addon_purchase_uom or 'KG')
            except ValidationError as exc:
                raise ValidationError({'addon_purchase_uom': str(exc)}) from exc
            self.is_purchasable = bool(self.addon_is_purchased)
            self.base_uom = self.addon_purchase_uom if self.addon_is_purchased else 'KG'
        else:
            try:
                self.base_uom = self.normalize_master_uom(self.base_uom or 'KG')
            except ValidationError as exc:
                raise ValidationError({'base_uom': str(exc)}) from exc

        # 4. Packaging Validation
        if self.category == 'PACKAGING':
            if not self.packaging_kind:
                raise ValidationError({'packaging_kind': "Packaging material must have a packaging kind."})
            if not self.packaging_supply_mode:
                raise ValidationError({'packaging_supply_mode': "Packaging material must have a packaging supply mode."})
            in_house_kinds = {"INNER_POUCH", "SHEET"}
            if self.packaging_supply_mode in {"IN_HOUSE", "BOTH"}:
                if self.packaging_kind not in in_house_kinds:
                    raise ValidationError(
                        {"packaging_supply_mode": f"{self.packaging_kind} cannot be produced in house in this phase."}
                    )
            elif self.production_template_id:
                raise ValidationError(
                    {"production_template": "Purchased-only packaging must not carry a production template."}
                )
        else:
            invalid_fields = {}
            if self.packaging_kind:
                invalid_fields['packaging_kind'] = "packaging_kind must be null for non-PACKAGING materials."
            if self.packaging_supply_mode:
                invalid_fields['packaging_supply_mode'] = "packaging_supply_mode must be null for non-PACKAGING materials."
            if self.production_template_id:
                invalid_fields['production_template'] = "production_template must be null for non-PACKAGING materials."
            if self.packaging_defaults_json:
                invalid_fields['packaging_defaults_json'] = "packaging_defaults_json must be empty for non-PACKAGING materials."
            if self.per_sheet_base_qty is not None:
                invalid_fields['per_sheet_base_qty'] = "per_sheet_base_qty must be null for non-PACKAGING materials."
            if invalid_fields:
                raise ValidationError(invalid_fields)

        # 5. POD validation
        if self.category == 'POD':
            pod_errors = {}
            if not self.pod_type:
                pod_errors['pod_type'] = "POD material must define pod_type."
            if self.pod_fixed_height_mm is None or Decimal(str(self.pod_fixed_height_mm or 0)) <= 0:
                pod_errors['pod_fixed_height_mm'] = "POD material must define fixed height (mm) > 0."
            if self.pod_thickness_micron is None or Decimal(str(self.pod_thickness_micron or 0)) <= 0:
                pod_errors['pod_thickness_micron'] = "POD material must define thickness (micron) > 0."
            if self.density_gcm3 is None or Decimal(str(self.density_gcm3 or 0)) <= 0:
                pod_errors['density_gcm3'] = "POD material must define density (g/cm³) > 0."
            if self.pod_panel_count is None or int(self.pod_panel_count or 0) <= 0:
                pod_errors['pod_panel_count'] = "POD material must define panel_count > 0."
            if self.base_uom != 'KG':
                pod_errors['base_uom'] = "POD material base_uom must be KG."
            if pod_errors:
                raise ValidationError(pod_errors)
        else:
            invalid_pod = {}
            if self.pod_type:
                invalid_pod['pod_type'] = "pod_type must be null for non-POD materials."
            if self.pod_fixed_height_mm is not None:
                invalid_pod['pod_fixed_height_mm'] = "pod_fixed_height_mm must be null for non-POD materials."
            if self.pod_thickness_micron is not None:
                invalid_pod['pod_thickness_micron'] = "pod_thickness_micron must be null for non-POD materials."
            if self.pod_panel_count is not None:
                invalid_pod['pod_panel_count'] = "pod_panel_count must be null for non-POD materials."
            if self.pod_is_inhouse_produced:
                invalid_pod['pod_is_inhouse_produced'] = "pod_is_inhouse_produced must be false for non-POD materials."
            if invalid_pod:
                raise ValidationError(invalid_pod)


class MaterialCodeAlias(models.Model):
    """A durable former-code -> material identity mapping.

    Material codes are used inside historical Product Master layer JSON and
    saved sales snapshots.  Renaming a material must therefore never make an
    otherwise valid master or order impossible to resolve.  Aliases are kept
    as an explicit business record instead of guessing from material names.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alias = models.CharField(max_length=100, unique=True, db_index=True)
    material = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.CASCADE,
        related_name="code_aliases",
    )
    category = models.CharField(max_length=20, choices=InventoryMaterial.CATEGORY_CHOICES, db_index=True)
    active = models.BooleanField(default=True)
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_material_code_aliases"
        ordering = ["alias"]

    def save(self, *args, **kwargs):
        self.alias = normalize_code(self.alias, max_length=100)
        if self.material_id and not self.category:
            self.category = self.material.category
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.alias} -> {self.material.code}"


class GranuleQualityCode(models.Model):
    """
    Quality code registry for a granule master.
    The physical material remains the same granule; this code adds a reporting
    and issue-control layer for inward, WCM issue, and consumption analytics.
    Vendors stay transaction-level metadata on GRN, not an owner of the code.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    granule = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.CASCADE,
        related_name="quality_codes",
        limit_choices_to={"category": "GRANULE"},
    )
    code = models.CharField(max_length=80, db_index=True)
    status = models.CharField(max_length=10, default="ACTIVE", choices=[("ACTIVE", "Active"), ("INACTIVE", "Inactive")])
    notes = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "material_granule_quality_codes"
        ordering = ["granule__name", "code"]
        constraints = [
            models.UniqueConstraint(fields=["granule", "code"], name="uniq_granule_quality_code"),
        ]

    def clean(self):
        if self.granule_id and str(getattr(self.granule, "category", "") or "").upper() != "GRANULE":
            raise ValidationError({"granule": "Quality codes can only be attached to GRANULE materials."})

    def save(self, *args, **kwargs):
        self.code = str(self.code or "").strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.granule.name} / {self.code}"


class PodSku(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=80, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    family = models.CharField(max_length=120, blank=True, default="")
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pod_skus"
        ordering = ["name", "code"]

    def __str__(self):
        return f"{self.code} - {self.name}"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80)
        super().save(*args, **kwargs)


class PodSkuVariant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pod_sku = models.ForeignKey(PodSku, on_delete=models.CASCADE, related_name="variants")
    material = models.ForeignKey(
        InventoryMaterial,
        on_delete=models.PROTECT,
        related_name="pod_sku_variants",
        limit_choices_to={"category": "POD"},
    )
    code = models.CharField(max_length=80)
    name = models.CharField(max_length=255)
    active = models.BooleanField(default=True)
    production_defaults_json = models.JSONField(default=dict, blank=True)
    reporting_attributes_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "pod_sku_variants"
        ordering = ["pod_sku__name", "name", "code"]
        constraints = [
            models.UniqueConstraint(fields=["pod_sku", "code"], name="pod_sku_variant_code_unique_per_sku"),
        ]

    def clean(self):
        errors = {}
        if self.material_id and str(getattr(self.material, "category", "") or "").upper() != "POD":
            errors["material"] = "POD SKU variants must link to a POD material."
        if self.material_id and str(getattr(self.material, "status", "") or "").upper() != "ACTIVE":
            errors["material"] = "POD SKU variants must link to an ACTIVE POD material."
        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"{self.pod_sku.code} - {self.code}"

    def save(self, *args, **kwargs):
        self.code = normalize_code(self.code, max_length=80)
        super().save(*args, **kwargs)

class ConsumableMaterial(models.Model):
    """
    Phase 67.2: Unified Bulk Consumption Engine.
    Represents a specific consumable resource linked to a master material.
    Allows defining density/usage properties for materials that might not have them in the core master.
    """
    CATEGORY_CHOICES = [
        ('INK', 'Ink'),
        ('ADHESIVE', 'Adhesive'),
        ('SOLVENT', 'Solvent'),
        ('GRANULE', 'Granule'),
        ('POD', 'POD Material'),
        ('ADDON', 'Add-on'),
        ('CHEMICAL', 'Chemical'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, db_index=True)
    unit = models.CharField(max_length=10, default='KG')
    
    # Optional physics properties overriding master
    density_gcm3 = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    gsm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True, help_text="Common for Inks/Adhesives")
    
    # Link to Inventory Master
    # This allows us to deduct from the actual inventory stock
    master_material = models.ForeignKey(
        'InventoryMaterial',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='consumable_configurations'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'materials_consumables'
        verbose_name = "Consumable Material"
        verbose_name_plural = "Consumable Materials"

    def __str__(self):
        return f"{self.name} ({self.get_category_display()})"


# ──────────────────────────────────────────────────────────────────────────
# Trading Goods — trade-only items the factory resells (ready-made pouches,
# outsourced rolls, etc.). Separate stock pool. NOT consumed by production.
# ──────────────────────────────────────────────────────────────────────────


class TradingGood(models.Model):
    """Trade-only items the company resells (ready-made pouches, outsourced rolls, etc.)"""

    TRADE_TYPE_CHOICES = [
        ("READY_POUCH", "Ready pouch"),
        ("READY_ROLL", "Ready roll"),
        ("PACKAGING", "Packaging item"),
        ("RAW_MATERIAL", "Raw material"),
        ("OTHER", "Other"),
    ]

    UOM_CHOICES = [
        ("KG", "Kilograms"),
        ("PCS", "Pieces"),
        ("METER", "Meters"),
        ("ROLL", "Rolls"),
        ("BOX", "Boxes"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    trade_type = models.CharField(max_length=20, choices=TRADE_TYPE_CHOICES, default="READY_POUCH")
    description = models.TextField(blank=True, default="")
    base_uom = models.CharField(max_length=10, choices=UOM_CHOICES, default="PCS")
    hsn_code = models.CharField(max_length=20, blank=True, default="")
    default_gst_pct = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("18.00"))
    default_sale_rate = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    default_buy_rate = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "materials_trading_good"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} · {self.name}"


class TradingGoodStock(models.Model):
    """Per-plant stock of a TradingGood."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    trading_good = models.ForeignKey(TradingGood, on_delete=models.PROTECT, related_name="stocks")
    plant = models.ForeignKey("factory.Plant", on_delete=models.PROTECT, related_name="trading_good_stocks")
    qty = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal("0"))
    avg_cost = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("0"))
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "materials_trading_good_stock"
        unique_together = [("trading_good", "plant")]

    def __str__(self):
        return f"{self.trading_good.code} @ {self.plant.name}: {self.qty}"
