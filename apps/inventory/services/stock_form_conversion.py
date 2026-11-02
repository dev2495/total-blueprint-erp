from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from django.db import transaction

from apps.inventory.models import InventoryRoll, RollLink, RollMovement
from apps.materials.stock_forms import (
    FOLDABLE_FORMS,
    STOCK_FORM_FOLDED_WEB,
    STOCK_FORM_LAYFLAT_TUBE,
    STOCK_FORM_OPEN_WEB,
    WIDTH_BASIS_FOLDED,
    WIDTH_BASIS_LAYFLAT,
    WIDTH_BASIS_OPEN_WEB,
    convert_width,
    fold_as_json,
    normalize_fold,
    normalize_stock_form,
    open_width_for,
)


Q_WIDTH = Decimal("0.01")
Q_WEIGHT = Decimal("0.001")


class StockFormConversionService:
    """Physical roll conversions that are inventory operations, not route edits.

    The service preserves mass, changes only the physical roll form/width where
    the operation requires it, and writes genealogy through RollLink.
    """

    OPEN_TUBE_ONE_WEB = "OPEN_TUBE_ONE_WEB"
    OPEN_TUBE_TWO_WEBS = "OPEN_TUBE_TWO_WEBS"
    FOLD_OPEN_WEB = "FOLD_OPEN_WEB"
    FOLD_SEAL_TO_TUBE = "FOLD_SEAL_TO_TUBE"
    UNFOLD_FOLDED_WEB = "UNFOLD_FOLDED_WEB"
    SLIT_OPEN_WEB = "SLIT_OPEN_WEB"

    @classmethod
    def operation_choices(cls) -> list[dict]:
        return [
            {
                "code": cls.SLIT_OPEN_WEB,
                "label": "Slit open-web jumbo",
                "from_stock_form": STOCK_FORM_OPEN_WEB,
                "to_stock_form": STOCK_FORM_OPEN_WEB,
                "requires_child_widths": True,
            },
            {
                "code": cls.OPEN_TUBE_ONE_WEB,
                "label": "Open tube to one sheet",
                "from_stock_form": STOCK_FORM_LAYFLAT_TUBE,
                "to_stock_form": STOCK_FORM_OPEN_WEB,
                "requires_child_widths": False,
            },
            {
                "code": cls.OPEN_TUBE_TWO_WEBS,
                "label": "Open tube to two sheets",
                "from_stock_form": STOCK_FORM_LAYFLAT_TUBE,
                "to_stock_form": STOCK_FORM_OPEN_WEB,
                "requires_child_widths": False,
            },
            {
                "code": cls.FOLD_OPEN_WEB,
                "label": "Fold open web",
                "from_stock_form": STOCK_FORM_OPEN_WEB,
                "to_stock_form": STOCK_FORM_FOLDED_WEB,
                "requires_child_widths": False,
            },
            {
                "code": cls.FOLD_SEAL_TO_TUBE,
                "label": "Fold and seal into tube",
                "from_stock_form": STOCK_FORM_OPEN_WEB,
                "to_stock_form": STOCK_FORM_LAYFLAT_TUBE,
                "requires_child_widths": False,
            },
            {
                "code": cls.UNFOLD_FOLDED_WEB,
                "label": "Unfold to open web",
                "from_stock_form": STOCK_FORM_FOLDED_WEB,
                "to_stock_form": STOCK_FORM_OPEN_WEB,
                "requires_child_widths": False,
            },
        ]

    @staticmethod
    def _dec(value, *, field: str, allow_zero: bool = False) -> Decimal:
        try:
            parsed = Decimal(str(value))
        except Exception as exc:
            raise ValueError(f"{field} must be numeric.") from exc
        if parsed < 0 or (not allow_zero and parsed <= 0):
            raise ValueError(f"{field} must be {'>= 0' if allow_zero else '> 0'}.")
        return parsed

    @staticmethod
    def _q_width(value: Decimal) -> Decimal:
        return value.quantize(Q_WIDTH, rounding=ROUND_HALF_UP)

    @staticmethod
    def _q_weight(value: Decimal) -> Decimal:
        return value.quantize(Q_WEIGHT, rounding=ROUND_HALF_UP)

    @classmethod
    def _child_roll(
        cls,
        parent: InventoryRoll,
        *,
        width_mm: Decimal,
        weight_kg: Decimal,
        stock_form: str,
        width_basis: str,
        suffix: str,
        meta: dict,
    ) -> InventoryRoll:
        label = f"{parent.label_id}-{suffix}"
        base = label
        counter = 2
        while InventoryRoll.objects.filter(label_id=label).exists():
            label = f"{base}-{counter}"
            counter += 1
        return InventoryRoll.objects.create(
            label_id=label,
            material=parent.material,
            batch_no=parent.batch_no,
            vendor=parent.vendor,
            vendor_invoice_no=parent.vendor_invoice_no,
            manual_po_ref=parent.manual_po_ref,
            thickness_micron=parent.thickness_micron,
            width_mm=cls._q_width(width_mm),
            stock_form=stock_form,
            width_basis=width_basis,
            density_gcm3=parent.density_gcm3,
            grade=parent.grade,
            plant=parent.plant,
            length_m=parent.length_m,
            original_weight_kg=cls._q_weight(weight_kg),
            weight_kg=cls._q_weight(weight_kg),
            net_weight_kg=cls._q_weight(weight_kg),
            location=parent.location,
            status="AVAILABLE",
            parent_roll=parent if suffix != "REM" else None,
            stage_index=parent.stage_index,
            created_by_job=parent.created_by_job,
            created_process=parent.created_process,
            is_fg=parent.is_fg,
            template=parent.template,
            current_step_index=parent.current_step_index,
            completed_step_index=parent.completed_step_index,
            geometry_override=parent.geometry_override or {},
            production_job=parent.production_job,
            sales_order_item=parent.sales_order_item,
            meta_json=meta,
        )

    @classmethod
    def _finish_child(cls, parent, child, *, qty_used_kg: Decimal, user=None, note: str = ""):
        RollLink.objects.create(
            parent_roll=parent,
            child_roll=child,
            relation_type="FORM_CONVERT",
            qty_used_kg=cls._q_weight(qty_used_kg),
        )
        RollMovement.objects.create(
            roll=child,
            to_location=child.location,
            reason="FORM_CONVERT",
            reason_note=note or "Stock form conversion",
            moved_by=user,
        )

    @classmethod
    def _base_meta(cls, parent: InventoryRoll, *, operation: str, reason: str = "") -> dict:
        return {
            **(parent.meta_json or {}),
            "source_roll_id": str(parent.id),
            "source_roll_label": parent.label_id,
            "form_conversion": {
                "operation": operation,
                "from_stock_form": normalize_stock_form(parent.stock_form),
                "from_width_mm": float(parent.width_mm or 0),
                "reason": reason or "",
            },
        }

    @classmethod
    def _close_parent(cls, parent: InventoryRoll):
        parent.status = "CONSUMED"
        parent.weight_kg = Decimal("0.000")
        parent.net_weight_kg = Decimal("0.000")
        parent.save(update_fields=["status", "weight_kg", "net_weight_kg"])

    @classmethod
    def convert(
        cls,
        roll: InventoryRoll,
        *,
        operation: str,
        child_widths_mm: Iterable[Decimal | str | int | float] | None = None,
        trim_mm: Decimal | str | int | float = 0,
        reason: str = "",
        user=None,
        folded_width_mm: Decimal | str | int | float | None = None,
        fold: dict | None = None,
    ) -> dict:
        """`fold` = {flap_mm, seal_mm, trim_mm} for FOLD_OPEN_WEB / FOLD_SEAL_TO_TUBE; blank = plain half fold.
        `folded_width_mm` picks the folded width; the open web left over is edge trim."""
        op = str(operation or "").upper().strip()
        if op not in {
            cls.OPEN_TUBE_ONE_WEB,
            cls.OPEN_TUBE_TWO_WEBS,
            cls.FOLD_OPEN_WEB,
            cls.FOLD_SEAL_TO_TUBE,
            cls.UNFOLD_FOLDED_WEB,
            cls.SLIT_OPEN_WEB,
        }:
            raise ValueError("Unsupported stock-form conversion operation.")

        with transaction.atomic():
            parent = InventoryRoll.objects.select_for_update().get(id=roll.id)
            if parent.status != "AVAILABLE":
                raise ValueError("Only available rolls can be converted.")
            parent_form = normalize_stock_form(parent.stock_form)
            parent_width = cls._dec(parent.width_mm, field="parent width_mm")
            parent_weight = cls._dec(parent.weight_kg, field="parent weight_kg")
            trim = cls._dec(trim_mm or 0, field="trim_mm", allow_zero=True)
            meta = cls._base_meta(parent, operation=op, reason=reason)

            children_spec: list[tuple[Decimal, Decimal, str, str, str]] = []
            scrap_width = Decimal("0")
            parent_fold = normalize_fold((parent.meta_json or {}).get("fold"))
            child_fold = None
            scrap_weight = None

            if op in {cls.FOLD_OPEN_WEB, cls.FOLD_SEAL_TO_TUBE}:
                if parent_form != STOCK_FORM_OPEN_WEB:
                    raise ValueError("Folding requires open-web stock.")
                to_form = STOCK_FORM_FOLDED_WEB if op == cls.FOLD_OPEN_WEB else STOCK_FORM_LAYFLAT_TUBE
                to_basis = WIDTH_BASIS_FOLDED if op == cls.FOLD_OPEN_WEB else WIDTH_BASIS_LAYFLAT
                child_fold = normalize_fold(fold)
                if folded_width_mm not in (None, ""):
                    width = cls._dec(folded_width_mm, field="folded_width_mm")
                else:
                    width = convert_width(STOCK_FORM_OPEN_WEB, to_form, parent_width, child_fold)
                if width <= 0:
                    raise ValueError("Flap, seal and trim leave no folded width.")
                needed = open_width_for(to_form, width, child_fold)
                if needed > parent_width:
                    raise ValueError(
                        f"Folding to {width.normalize():f} mm needs {needed.normalize():f} mm open web; "
                        f"the roll is {parent_width.normalize():f} mm."
                    )
                # Edge trim (fold trim + whatever the open web has beyond what the fold needs) is scrap.
                film_width = needed - child_fold["trim_mm"]
                scrap_width = parent_width - film_width
                kept_weight = cls._q_weight(parent_weight * film_width / parent_width)
                scrap_weight = parent_weight - kept_weight
                children_spec.append((width, kept_weight, to_form, to_basis, "FOLD" if op == cls.FOLD_OPEN_WEB else "TUBE"))
            elif op == cls.OPEN_TUBE_ONE_WEB:
                if parent_form != STOCK_FORM_LAYFLAT_TUBE:
                    raise ValueError("Open tube to one sheet requires lay-flat tube stock.")
                children_spec.append((convert_width(parent_form, STOCK_FORM_OPEN_WEB, parent_width, parent_fold), parent_weight, STOCK_FORM_OPEN_WEB, WIDTH_BASIS_OPEN_WEB, "OPEN"))
            elif op == cls.OPEN_TUBE_TWO_WEBS:
                if parent_form != STOCK_FORM_LAYFLAT_TUBE:
                    raise ValueError("Open tube to two sheets requires lay-flat tube stock.")
                each_weight = cls._q_weight(parent_weight / Decimal("2"))
                children_spec.extend(
                    [
                        (parent_width, each_weight, STOCK_FORM_OPEN_WEB, WIDTH_BASIS_OPEN_WEB, "S1"),
                        (parent_width, parent_weight - each_weight, STOCK_FORM_OPEN_WEB, WIDTH_BASIS_OPEN_WEB, "S2"),
                    ]
                )
            elif op == cls.UNFOLD_FOLDED_WEB:
                if parent_form != STOCK_FORM_FOLDED_WEB:
                    raise ValueError("Unfold requires folded-web stock.")
                children_spec.append((convert_width(parent_form, STOCK_FORM_OPEN_WEB, parent_width, parent_fold), parent_weight, STOCK_FORM_OPEN_WEB, WIDTH_BASIS_OPEN_WEB, "OPEN"))
            elif op == cls.SLIT_OPEN_WEB:
                if parent_form != STOCK_FORM_OPEN_WEB:
                    raise ValueError("Width slitting requires open-web stock. Use tube-opening for tube stock.")
                widths = [cls._dec(w, field="child_width_mm") for w in (child_widths_mm or [])]
                if not widths:
                    raise ValueError("SLIT_OPEN_WEB requires child widths.")
                consumed_width = sum(widths, Decimal("0")) + (trim * Decimal(len(widths)))
                if consumed_width > parent_width:
                    raise ValueError("Requested child widths plus trim exceed parent width.")
                kg_per_mm = parent_weight / parent_width
                for idx, child_width in enumerate(widths, start=1):
                    children_spec.append(
                        (
                            child_width,
                            kg_per_mm * child_width,
                            STOCK_FORM_OPEN_WEB,
                            WIDTH_BASIS_OPEN_WEB,
                            f"S{idx}",
                        )
                    )
                remainder_width = parent_width - consumed_width
                scrap_width = trim * Decimal(len(widths))
                if remainder_width > 0:
                    children_spec.append(
                        (
                            remainder_width,
                            kg_per_mm * remainder_width,
                            STOCK_FORM_OPEN_WEB,
                            WIDTH_BASIS_OPEN_WEB,
                            "REM",
                        )
                    )

            created = []
            for width, weight, stock_form, width_basis, suffix in children_spec:
                child_meta = {
                    **meta,
                    "form_conversion": {
                        **meta["form_conversion"],
                        "to_stock_form": stock_form,
                        "to_width_mm": float(cls._q_width(width)),
                    },
                    "roll_role": "REMAINDER" if suffix == "REM" else "FORM_CONVERTED",
                    "is_remainder": suffix == "REM",
                }
                child_meta.pop("fold", None)
                if stock_form in FOLDABLE_FORMS:
                    fold_source = child_fold if child_fold is not None else parent_fold
                    child_meta["fold"] = {
                        **fold_as_json(fold_source),
                        "open_width_mm": float(open_width_for(stock_form, width, fold_source)),
                    }
                child = cls._child_roll(
                    parent,
                    width_mm=width,
                    weight_kg=weight,
                    stock_form=stock_form,
                    width_basis=width_basis,
                    suffix=suffix,
                    meta=child_meta,
                )
                cls._finish_child(
                    parent,
                    child,
                    qty_used_kg=weight,
                    user=user,
                    note=f"{op} from {parent.label_id}",
                )
                created.append(child)

            cls._close_parent(parent)

            child_payloads = [
                {
                    "roll_id": str(child.id),
                    "label_id": child.label_id,
                    "width_mm": float(child.width_mm),
                    "weight_kg": float(child.weight_kg),
                    "stock_form": child.stock_form,
                    "width_basis": child.width_basis,
                    "is_remainder": bool((child.meta_json or {}).get("is_remainder")),
                }
                for child in created
            ]
            remainder = next((row for row in child_payloads if row["is_remainder"]), None)
            return {
                "operation": op,
                "parent_roll_id": str(parent.id),
                "parent_label_id": parent.label_id,
                "children": [row for row in child_payloads if not row["is_remainder"]],
                "remainder": remainder,
                "scrap_width_mm": float(scrap_width),
                "scrap_weight_kg": (
                    float(cls._q_weight(scrap_weight))
                    if scrap_weight is not None
                    else float(cls._q_weight((parent_weight / parent_width) * scrap_width)) if scrap_width else 0.0
                ),
            }
