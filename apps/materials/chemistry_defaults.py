from __future__ import annotations

from decimal import Decimal, InvalidOperation
import uuid
from typing import Any

from django.core.exceptions import ValidationError

from apps.materials.models import InventoryMaterial


CHEMISTRY_FIELDS = {
    "adhesive": {
        "category": "ADHESIVE",
        "id": "adhesive_material_id",
        "code": "adhesive_material_code",
        "name": "adhesive_material_name",
        "gsm": "adhesive_gsm",
        "legacy_id": "adhesive_id",
        "legacy_code": "adhesive_code",
    },
    "solvent": {
        "category": "SOLVENT",
        "id": "solvent_material_id",
        "code": "solvent_material_code",
        "name": "solvent_material_name",
        "gsm": "solvent_gsm",
        "legacy_id": "solvent_id",
        "legacy_code": "solvent_code",
    },
}


def _decimal(value: Any) -> Decimal:
    try:
        if value in (None, ""):
            return Decimal("0")
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def _layer_count(layer_template: Any, fixed: dict[str, Any]) -> int:
    if isinstance(layer_template, list):
        return len([row for row in layer_template if isinstance(row, dict)])
    try:
        return int(fixed.get("layer_count") or 0)
    except Exception:
        return 0


def _safe_uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except Exception:
        return None


def _material_from_ref(category: str, material_id: Any, material_code: Any) -> InventoryMaterial | None:
    qs = InventoryMaterial.objects.filter(category=category, status="ACTIVE")
    safe_id = _safe_uuid(material_id)
    if safe_id:
        found = qs.filter(id=safe_id).first()
        if found:
            return found
    code = str(material_code or "").strip()
    if code:
        return qs.filter(code__iexact=code).first()
    return None


def _clear_family(fixed: dict[str, Any], family: str) -> None:
    fields = CHEMISTRY_FIELDS[family]
    for key in (
        fields["id"],
        fields["code"],
        fields["name"],
        fields["gsm"],
        fields["legacy_id"],
        fields["legacy_code"],
    ):
        fixed.pop(key, None)


def normalize_product_master_chemistry_defaults(
    fixed_attributes: Any,
    *,
    layer_template: Any = None,
) -> dict[str, Any]:
    fixed = dict(fixed_attributes or {}) if isinstance(fixed_attributes, dict) else {}
    if _layer_count(layer_template, fixed) <= 1:
        _clear_family(fixed, "adhesive")
        _clear_family(fixed, "solvent")
        return fixed

    for family, fields in CHEMISTRY_FIELDS.items():
        material_id = fixed.get(fields["id"]) or fixed.get(fields["legacy_id"])
        material_code = fixed.get(fields["code"]) or fixed.get(fields["legacy_code"])
        gsm = _decimal(fixed.get(fields["gsm"]))
        has_any_value = any(value not in (None, "") for value in (material_id, material_code, fixed.get(fields["gsm"])))
        if not has_any_value:
            _clear_family(fixed, family)
            continue
        material = _material_from_ref(fields["category"], material_id, material_code)
        if material is None:
            raise ValidationError({fields["id"]: f"Select an active {fields['category'].lower()} master."})
        if gsm <= 0:
            raise ValidationError({fields["gsm"]: "GSM must be greater than zero when a material is selected."})
        fixed[fields["id"]] = str(material.id)
        fixed[fields["code"]] = material.code
        fixed[fields["name"]] = material.name
        fixed[fields["gsm"]] = float(gsm)
        fixed.pop(fields["legacy_id"], None)
        fixed.pop(fields["legacy_code"], None)

    return fixed


def chemicals_payload_from_fixed_attributes(
    fixed_attributes: Any,
    *,
    layer_template: Any = None,
) -> dict[str, Any]:
    fixed = fixed_attributes if isinstance(fixed_attributes, dict) else {}
    if _layer_count(layer_template, fixed) <= 1:
        return {}

    payload: dict[str, Any] = {}
    for family, fields in CHEMISTRY_FIELDS.items():
        gsm = _decimal(fixed.get(fields["gsm"]))
        if gsm <= 0:
            continue
        material = _material_from_ref(
            fields["category"],
            fixed.get(fields["id"]) or fixed.get(fields["legacy_id"]),
            fixed.get(fields["code"]) or fixed.get(fields["legacy_code"]),
        )
        if material is None:
            continue
        payload[fields["gsm"]] = float(gsm)
        payload[fields["id"]] = str(material.id)
        payload[fields["code"]] = material.code
        payload[fields["name"]] = material.name
    return payload
