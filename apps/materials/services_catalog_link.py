"""Linking fixed catalog rows (POD rolls, in-house packaging) to the Product Master
that makes them, in one step from either side.

Every POD roll carries one POD SKU + variant (the catalog row sales and the
Product Master pick); rolls added after the 0012 back-fill never got one, so they
could neither be sold nor linked.
"""
from django.db import transaction

from .models import InventoryMaterial, PodSku, PodSkuVariant, ProductMaster

IN_HOUSE_PACKAGING_KINDS = {"INNER_POUCH", "SHEET"}


def ensure_pod_sku_variant(material: InventoryMaterial) -> PodSkuVariant | None:
    """The POD SKU + variant for a POD roll (created once, kept in step with the roll).

    The variant takes the roll's code, so sales can tell rolls apart by code."""
    if str(getattr(material, "category", "") or "").upper() != "POD":
        return None
    existing = PodSkuVariant.objects.select_related("pod_sku").filter(material=material).order_by("pod_sku__code", "code").first()
    active = str(material.status or "ACTIVE").upper() == "ACTIVE"
    if existing:
        if existing.active != active:
            existing.active = active
            existing.save(update_fields=["active", "updated_at"])
        return existing
    code = str(material.code or "").strip().upper()
    name = str(material.name or code).strip()
    family = str(material.pod_type or "POD").strip().upper() or "POD"
    pod_sku, _ = PodSku.objects.get_or_create(code=code, defaults={"name": name, "family": family, "active": active})
    variant, _ = PodSkuVariant.objects.get_or_create(
        pod_sku=pod_sku,
        code=code,
        defaults={
            "name": name,
            "material": material,
            "active": active,
            "production_defaults_json": {},
            "reporting_attributes_json": {"pod_type": family},
        },
    )
    return variant


def expected_master_kind(material: InventoryMaterial) -> tuple[str, str]:
    """(product_kind, packaging_kind) of the masters that may make this catalog row."""
    category = str(material.category or "").upper()
    if category == "POD":
        return "POD", ""
    if category == "PACKAGING":
        kind = str(material.packaging_kind or "").upper()
        return ("PACKAGING", kind) if kind in IN_HOUSE_PACKAGING_KINDS else ("", "")
    return "", ""


def candidate_masters(material: InventoryMaterial):
    product_kind, packaging_kind = expected_master_kind(material)
    if not product_kind:
        return ProductMaster.objects.none()
    qs = ProductMaster.objects.filter(product_kind=product_kind, active=True, is_current_version=True).prefetch_related("sizes")
    if packaging_kind:
        rows = []
        for master in qs:
            fixed = master.fixed_attributes if isinstance(master.fixed_attributes, dict) else {}
            kind = str(master.packaging_kind or "").upper() or ("SHEET" if str(fixed.get("fg_type") or "").upper() == "ROLL" else "INNER_POUCH")
            if kind == packaging_kind:
                rows.append(master.id)
        qs = qs.filter(id__in=rows)
    return qs.order_by("name", "code")


def variant_axis_values(master: ProductMaster, material: InventoryMaterial, size_code: str = "") -> dict:
    from apps.production.services.in_house_demand_service import InHouseDemandService

    if str(master.product_kind or "").upper() == "POD":
        axis_values = InHouseDemandService._default_pod_axis_values(master, ensure_pod_sku_variant(material))
    else:
        axis_values = InHouseDemandService._default_packaging_axis_values(master, material)
    size_code = str(size_code or "").strip()
    if size_code:
        size = master.sizes.filter(active=True, code__iexact=size_code).first()
        if size is None:
            from django.core.exceptions import ValidationError

            raise ValidationError({"size": f"Size {size_code} is not an active size of {master.code}."})
        for key in ("size", "size_code"):
            if key in axis_values or key == "size":
                axis_values[key] = size.code
        layer_defaults = InHouseDemandService._default_layer_axis_maps(master, size)
        for key, value in layer_defaults.items():
            if value:
                axis_values[key] = value
    return axis_values


@transaction.atomic
def find_or_create_link_variant(master: ProductMaster, material: InventoryMaterial, size_code: str = ""):
    from .services_product_variant import find_or_create_product_variant

    return find_or_create_product_variant(master, variant_axis_values(master, material, size_code))
