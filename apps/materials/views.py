from django.db import models
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets, filters
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
import uuid
from .models import CommercialFamily, GranuleQualityCode, InventoryMaterial, PodSku, PodSkuVariant, PouchStyleMaster, ProductMaster, ProductMasterSize, ProductVariant, WebWidthPolicy
from apps.sales.models import CustomerProductOverlay
from apps.inventory.models import InkMaterial
from apps.recipes.qty_formula import evaluate_qty_formula
from apps.users.audit_mixins import MasterDataAuditMixin
from .services_web_width_policy import evaluate_web_width_plan, resolve_web_width_policy
from .serializers import (
    FilmFamilySerializer, 
    FilmVariantSerializer, 
    GranuleSerializer, 
    GranuleQualityCodeSerializer,
    InkSerializer, 
    AdhesiveSolventSerializer,
    AddonSerializer,
    PODSerializer,
    PodSkuSerializer,
    PodSkuVariantSerializer,
    InventoryMaterialSerializer,
    PackagingSerializer,
    CommercialFamilySerializer,
    ProductMasterSerializer,
    ProductMasterSizeSerializer,
    ProductVariantSerializer,
    CustomerProductOverlaySerializer,
    PouchStyleSerializer,
    PouchStylePreviewSerializer,
    WebWidthPolicySerializer,
)


def _safe_float(value, default=0.0):
    try:
        if value in (None, ""):
            return None if default is None else float(default)
        return float(value)
    except Exception:
        return None if default is None else float(default)


def _safe_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        return None


def _flatten_preview_validation_errors(detail):
    messages = []

    def visit(value, prefix=""):
        if isinstance(value, dict):
            for key, nested in value.items():
                label = f"{prefix}.{key}" if prefix else str(key)
                visit(nested, label)
            return
        if isinstance(value, (list, tuple, set)):
            for nested in value:
                visit(nested, prefix)
            return
        text = str(value or "").strip()
        if not text:
            return
        messages.append(f"{prefix}: {text}" if prefix else text)

    visit(detail)
    return messages or ["Preview cannot be computed until the required axes are complete."]


def _effective_packaging_kind(product):
    kind = str(getattr(product, "packaging_kind", "") or "").upper()
    if kind in {"INNER_POUCH", "SHEET"}:
        return kind
    fixed = getattr(product, "fixed_attributes", None) or {}
    if isinstance(fixed, dict):
        fg_type = str(fixed.get("fg_type") or "").upper()
        if fg_type == "ROLL":
            return "SHEET"
        if fg_type == "POUCH":
            return "INNER_POUCH"
    return ""


def _variant_inventory_link_error(product, target):
    product_kind = str(getattr(product, "product_kind", "") or "").upper()
    target_category = str(getattr(target, "category", "") or "").upper()

    if product_kind == "PACKAGING":
        expected_kind = _effective_packaging_kind(product)
        if expected_kind not in {"INNER_POUCH", "SHEET"}:
            return "PACKAGING masters must set packaging_kind to INNER_POUCH or SHEET before linking catalog SKUs."
        if target_category != "PACKAGING":
            return f"category mismatch: PACKAGING masters can only link to PACKAGING catalog SKUs, not {target.category or 'blank'}."
        target_kind = str(getattr(target, "packaging_kind", "") or "").upper()
        if target_kind != expected_kind:
            return f"packaging_kind mismatch: this master is {expected_kind}, but catalog SKU {target.code} is {target_kind or 'blank'}."
        return None

    if product_kind == "POD":
        if target_category != "POD":
            return f"category mismatch: POD masters can only link to POD catalog SKUs, not {target.category or 'blank'}."
        return None

    return "Only PACKAGING and POD Product Masters can link variants to catalog SKUs."


def _catalog_ref(axis_values, axis_def):
    key = str((axis_def or {}).get("axis") or "").strip()
    if not key:
        return None
    aliases = {
        "pod_variant": ("pod_variant", "pod", "pod_ref"),
        "pod": ("pod", "pod_variant", "pod_ref"),
        "packaging_inner": ("packaging_inner", "packaging", "packaging_ref", "primary_inner_pack"),
        "packaging_outer": ("packaging_outer", "packaging_outer_ref", "final_outer_pack"),
        "packaging": ("packaging", "packaging_inner", "packaging_ref"),
        "addons": ("addons", "addon", "addon_ref"),
    }
    for candidate in aliases.get(key, (key,)):
        value = (axis_values or {}).get(candidate)
        if value not in (None, "", [], {}):
            return value
    return (axis_def or {}).get("default_value")


def _catalog_refs(axis_values, axis_def):
    ref = _catalog_ref(axis_values, axis_def)
    if isinstance(ref, (list, tuple)):
        return [item for item in ref if item not in (None, "", [], {})]
    return [ref] if ref not in (None, "", [], {}) else []


def _catalog_axis_defs(product, axis_values):
    """
    Return V3.3 catalog-backed axis definitions.

    New ProductMaster rows persist `master_data_source` directly. Older local
    rows used `pod_ref` / `packaging_ref`; infer the same contract so preview
    and submit stay compatible while data is migrated.
    """
    defs = []
    seen = set()
    explicit_inner_outer = bool((axis_values or {}).get("packaging_inner") or (axis_values or {}).get("packaging_outer"))

    def add(axis_name, source, base=None, **defaults):
        key = str(axis_name or "").strip()
        if not key or key in seen:
            return
        row = dict(base or {})
        row["axis"] = key
        row["master_data_source"] = row.get("master_data_source") or source
        for default_key, default_value in defaults.items():
            row.setdefault(default_key, default_value)
        defs.append(row)
        seen.add(key)

    for raw in product.variant_axes or []:
        if not isinstance(raw, dict):
            continue
        axis_name = str(raw.get("axis") or "").strip()
        axis_type = str(raw.get("type") or "").strip()
        if raw.get("master_data_source"):
            add(axis_name, raw.get("master_data_source"), raw)
            continue
        if axis_type == "pod_ref" or axis_name in {"pod", "pod_variant"}:
            add(
                "pod_variant",
                "pod_sku_variant",
                raw,
                qty_per_pcs=1,
                auto_demand_in_house=True,
            )
        elif axis_type == "packaging_ref" or axis_name in {"packaging", "packaging_inner", "packaging_outer"}:
            if explicit_inner_outer and axis_name == "packaging":
                continue
            add(
                "packaging_inner" if axis_name == "packaging" else axis_name,
                "packaging_material",
                raw,
                qty_formula="ceil(total_pouches / pcs_per_inner)",
                auto_demand_in_house=True,
            )
        elif axis_type in {"addon", "addon_ref", "multi_enum"} or axis_name in {"addons", "addon"}:
            add("addons", "addon", raw, qty_per_pcs=1)

    if (axis_values or {}).get("packaging_inner"):
        add(
            "packaging_inner",
            "packaging_material",
            None,
            master_data_filter={"packaging_kind": "INNER_POUCH"},
            qty_formula="ceil(total_pouches / pcs_per_inner)",
            auto_demand_in_house=True,
        )
    if (axis_values or {}).get("packaging_outer"):
        add("packaging_outer", "packaging_material", None, qty_per_pcs=0)
    if (axis_values or {}).get("pod_variant") or (axis_values or {}).get("pod"):
        add("pod_variant", "pod_sku_variant", None, qty_per_pcs=1, auto_demand_in_house=True)
    if (axis_values or {}).get("addons"):
        add("addons", "addon", None, qty_per_pcs=1)

    return defs


def _packaging_material_from_ref(ref, filters=None):
    queryset = InventoryMaterial.objects.filter(category="PACKAGING", status="ACTIVE")
    if isinstance(filters, dict) and filters.get("packaging_kind"):
        kind_filter = filters.get("packaging_kind")
        if isinstance(kind_filter, (list, tuple, set)):
            kinds = [str(kind).upper() for kind in kind_filter if str(kind).strip()]
            queryset = queryset.filter(packaging_kind__in=kinds)
        else:
            queryset = queryset.filter(packaging_kind=str(kind_filter).upper())
    ref_uuid = _safe_uuid(ref)
    if ref_uuid:
        return queryset.filter(id=ref_uuid).first()
    return queryset.filter(code__iexact=str(ref or "")).first()


def _addon_material_from_ref(ref):
    queryset = InventoryMaterial.objects.filter(category="ADDON", status="ACTIVE")
    ref_uuid = _safe_uuid(ref)
    if ref_uuid:
        return queryset.filter(id=ref_uuid).first()
    return queryset.filter(code__iexact=str(ref or "")).first()


def _pod_variant_from_ref(ref):
    queryset = PodSkuVariant.objects.select_related("material", "pod_sku").filter(active=True)
    ref_uuid = _safe_uuid(ref)
    if ref_uuid:
        return queryset.filter(id=ref_uuid).first()
    return queryset.filter(code__iexact=str(ref or "")).first()


def _formula_context(total_pouches, material=None, overlay=None):
    defaults = getattr(material, "packaging_defaults_json", {}) if material is not None else {}
    defaults = defaults if isinstance(defaults, dict) else {}
    overlay_defaults = overlay if isinstance(overlay, dict) else {}
    pcs_per_inner = (
        overlay_defaults.get("pcs_per_inner")
        or defaults.get("pcs_per_inner")
        or defaults.get("pcs_per_pack")
        or defaults.get("pcs_per_carton")
        or 1
    )
    return {
        "fixed_qty": 1,
        "pcs_per_inner": _safe_float(pcs_per_inner, 1),
        "total_kg": _safe_float(overlay_defaults.get("total_kg"), 0),
        "total_pouches": _safe_float(total_pouches, 0),
        "total_pcs": _safe_float(total_pouches, 0),
    }


def _quantity_for_axis(axis_def, total_pouches, *, material=None, overlay=None):
    if (axis_def or {}).get("qty_formula"):
        qty = evaluate_qty_formula(axis_def.get("qty_formula"), _formula_context(total_pouches, material, overlay))
    elif (axis_def or {}).get("qty_per_pcs") is not None:
        qty = _safe_float(total_pouches, 0) * _safe_float(axis_def.get("qty_per_pcs"), 0)
    else:
        qty = 1
    if (axis_def or {}).get("auto_demand_in_house"):
        import math

        qty = math.ceil(qty)
    return max(qty, 0)


class MaterialLibraryViewSet(viewsets.ReadOnlyModelViewSet):
    """Unified read-only library for BOM selection across all categories"""
    queryset = InventoryMaterial.objects.all().order_by('category', 'name')
    serializer_class = InventoryMaterialSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category', 'is_extrudable']
    search_fields = ['name', 'code']

    @action(detail=False, methods=["get"], url_path="bom-lookup")
    def bom_lookup(self, request):
        """V37 BOM picker — return materials filtered by category list with
        rate + density + on-hand stock attached.

        Query params:
          - category=FILM_FAMILY,FILM_VARIANT (comma-separated)
          - search=PET
          - page_size=50
        """
        from decimal import Decimal
        try:
            from apps.costing.models import MaterialCostSnapshot
        except Exception:  # pragma: no cover
            MaterialCostSnapshot = None
        try:
            from apps.inventory.models import StockBalance
        except Exception:  # pragma: no cover
            StockBalance = None

        categories_param = (request.query_params.get("category") or "").strip()
        categories = [c.strip().upper() for c in categories_param.split(",") if c.strip()]
        search = (request.query_params.get("search") or "").strip()
        try:
            page_size = int(request.query_params.get("page_size") or 50)
        except Exception:
            page_size = 50
        page_size = max(1, min(page_size, 200))

        qs = InventoryMaterial.objects.filter(status="ACTIVE")
        if categories:
            qs = qs.filter(category__in=categories)
        if search:
            qs = qs.filter(
                models.Q(name__icontains=search) | models.Q(code__icontains=search)
            )
        qs = qs.order_by("category", "name")[:page_size]

        rate_map = {}
        if MaterialCostSnapshot is not None:
            for snap in MaterialCostSnapshot.objects.filter(material__in=list(qs)):
                rate_map[str(snap.material_id)] = snap.avg_rate_per_kg

        stock_map = {}
        if StockBalance is not None:
            try:
                rows = StockBalance.objects.filter(material__in=list(qs)).values(
                    "material_id"
                ).annotate(total=models.Sum("qty"))
                for row in rows:
                    stock_map[str(row["material_id"])] = float(row.get("total") or 0)
            except Exception:
                pass

        out = []
        for mat in qs:
            mid = str(mat.id)
            density = float(mat.density_gcm3) if mat.density_gcm3 else None
            sub_count = 0
            if mat.category == "FILM_FAMILY":
                try:
                    sub_count = InventoryMaterial.objects.filter(
                        parent_family_id=mat.id, status="ACTIVE"
                    ).count()
                except Exception:
                    sub_count = 0
            out.append({
                "id": mid,
                "code": mat.code,
                "name": mat.name,
                "category": mat.category,
                "category_display": mat.get_category_display(),
                "base_uom": mat.base_uom,
                "density_gcm3": density,
                "avg_cost": float(rate_map.get(mid) or 0),
                "stock_qty": stock_map.get(mid, 0.0),
                "substitutes_count": sub_count,
            })

        return Response({"results": out, "count": len(out)})


class CommercialFamilyViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_COMMERCIAL_FAMILY"
    queryset = CommercialFamily.objects.all().order_by('name')
    serializer_class = CommercialFamilySerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['default_form', 'default_reporting_group', 'active']
    search_fields = ['name', 'code']


class ProductMasterViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_PRODUCT"
    serializer_class = ProductMasterSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['product_kind', 'default_reporting_group', 'reusable_policy', 'active', 'commercial_family']
    search_fields = ['name', 'code', 'description', 'commercial_family__name']

    def get_queryset(self):
        queryset = (
            ProductMaster.objects.select_related('template', 'default_template', 'commercial_family')
            .annotate(overlay_count=Count('customer_overlays'))
            .order_by('name', 'code')
        )
        q = str(self.request.query_params.get("q") or "").strip()
        if q:
            queryset = queryset.filter(
                models.Q(name__icontains=q)
                | models.Q(code__icontains=q)
                | models.Q(description__icontains=q)
                | models.Q(commercial_family__name__icontains=q)
            )
        return queryset

    def get_object(self):
        """
        Product Master codes are used heavily in the UI and handoffs. Accept
        either the UUID primary key or the stable product code for detail/action
        routes so stale links do not crash nested endpoints.
        """
        lookup = self.kwargs.get(self.lookup_url_kwarg or self.lookup_field)
        queryset = self.filter_queryset(self.get_queryset())
        try:
            uuid.UUID(str(lookup))
            obj = get_object_or_404(queryset, pk=lookup)
        except (TypeError, ValueError):
            obj = get_object_or_404(queryset, code__iexact=str(lookup or ""))
        self.check_object_permissions(self.request, obj)
        return obj

    @action(detail=True, methods=["get", "post"])
    def sizes(self, request, pk=None):
        product = self.get_object()
        if request.method == "POST":
            serializer = ProductMasterSizeSerializer(data={**request.data, "product_master": str(product.id)})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=201)
        queryset = product.sizes.all()
        active = request.query_params.get("active")
        if active is not None:
            queryset = queryset.filter(active=str(active).lower() not in {"0", "false", "no"})
        return Response(ProductMasterSizeSerializer(queryset, many=True).data)

    @action(detail=True, methods=["get", "post"])
    def variants(self, request, pk=None):
        product = self.get_object()
        if request.method == "POST":
            serializer = ProductVariantSerializer(data={**request.data, "master": str(product.id)})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=201)
        queryset = product.variants.all()
        active = request.query_params.get("active")
        if active is not None:
            queryset = queryset.filter(active=str(active).lower() not in {"0", "false", "no"})
        return Response(ProductVariantSerializer(queryset, many=True).data)

    @action(detail=True, methods=["post"], url_path=r"variants/(?P<variant_id>[^/.]+)/link-inventory")
    def link_variant_inventory(self, request, pk=None, variant_id=None):
        """
        Manually link a ProductVariant to a specific InventoryMaterial row in
        the packaging or POD catalog. PACKAGING/POD variants never create
        catalog SKUs automatically; the admin must point each variant to an
        existing fixed catalog row.

        Body:
          {"inventory_material_id": "uuid"}  -- the catalog row to link to
          {"inventory_material_id": null}    -- unlink (won't unlink another variant's link)

        Side effect: if there was already an inventory row linked to this
        variant, it is unlinked first so we keep the 1:1 invariant.
        """
        product = self.get_object()
        try:
            variant = ProductVariant.objects.get(id=variant_id, master=product)
        except ProductVariant.DoesNotExist:
            return Response({"error": "Variant not found on this master."}, status=404)

        product_kind = str(product.product_kind or "").upper()
        target_id = request.data.get("inventory_material_id") or None
        pod_sku_variant_id = request.data.get("pod_sku_variant_id") or None
        new_link = None
        pod_sku_variant = None
        if target_id or pod_sku_variant_id:
            if pod_sku_variant_id:
                if product_kind != "POD":
                    return Response({"error": "pod_sku_variant_id can only be used for POD Product Masters."}, status=400)
                try:
                    pod_sku_variant = PodSkuVariant.objects.select_related("material", "pod_sku").get(id=pod_sku_variant_id, active=True)
                except PodSkuVariant.DoesNotExist:
                    return Response({"error": "PodSkuVariant not found."}, status=404)
                target = pod_sku_variant.material
            else:
                try:
                    target = InventoryMaterial.objects.get(id=target_id)
                except InventoryMaterial.DoesNotExist:
                    return Response({"error": "InventoryMaterial not found."}, status=404)
            validation_error = _variant_inventory_link_error(product, target)
            if validation_error:
                return Response({"error": validation_error}, status=400)
            # Don't yank a target that's already linked to another variant of
            # a different master — would silently break that master's audit.
            existing = target.produced_by_product_variant
            if existing and existing.id != variant.id:
                return Response(
                    {"error": f"Catalog SKU {target.code} is already linked to variant {existing.code} on master {existing.master.code}. Unlink there first."},
                    status=400,
                )
            InventoryMaterial.objects.filter(produced_by_product_variant=variant).exclude(id=target.id).update(produced_by_product_variant=None)
            target.produced_by_product_variant = variant
            target.status = "ACTIVE"
            update_fields = ["produced_by_product_variant", "status"]
            if product_kind == "PACKAGING" and str(target.packaging_supply_mode or "").upper() == "PURCHASED":
                # Preserve the fact that this fixed SKU can still be bought.
                # Manual PM link adds in-house capability; it should not turn a
                # purchased SKU into in-house-only.
                target.packaging_supply_mode = "BOTH"
                update_fields.append("packaging_supply_mode")
            if product_kind == "POD":
                if target.base_uom != "KG":
                    target.base_uom = "KG"
                    update_fields.append("base_uom")
                if not target.pod_is_inhouse_produced:
                    target.pod_is_inhouse_produced = True
                    update_fields.append("pod_is_inhouse_produced")
                if not target.pod_type:
                    target.pod_type = "SINGLE"
                    update_fields.append("pod_type")
                if target.pod_fixed_height_mm is None:
                    target.pod_fixed_height_mm = 200
                    update_fields.append("pod_fixed_height_mm")
                if target.pod_thickness_micron is None:
                    target.pod_thickness_micron = 30
                    update_fields.append("pod_thickness_micron")
                if target.pod_panel_count is None:
                    target.pod_panel_count = 1
                    update_fields.append("pod_panel_count")
                if target.density_gcm3 is None:
                    target.density_gcm3 = 0.92
                    update_fields.append("density_gcm3")
            target.save(update_fields=update_fields + ["updated_at"])
            new_link = target
            if product_kind == "POD" and pod_sku_variant is None:
                pod_sku_variant = PodSkuVariant.objects.select_related("pod_sku").filter(material_id=target.id, active=True).order_by("pod_sku__code", "code").first()
        else:
            InventoryMaterial.objects.filter(produced_by_product_variant=variant).update(produced_by_product_variant=None)
        return Response({
            "variant_id": str(variant.id),
            "inventory_link": (
                {
                    "id": str(new_link.id),
                    "code": new_link.code,
                    "name": new_link.name or "",
                    "category": new_link.category,
                    "packaging_kind": new_link.packaging_kind or "",
                    "base_uom": new_link.base_uom,
                    "pod_sku_variant_id": str(pod_sku_variant.id) if pod_sku_variant else None,
                    "pod_sku_variant_code": pod_sku_variant.code if pod_sku_variant else None,
                    "pod_sku_code": pod_sku_variant.pod_sku.code if pod_sku_variant else None,
                }
                if new_link else None
            ),
        })

    @action(detail=True, methods=["post"], url_path="variants/find-or-create")
    def find_or_create_variant(self, request, pk=None):
        product = self.get_object()
        axis_values = request.data.get("axis_values") or {}
        from django.core.exceptions import ValidationError as DjangoValidationError
        from rest_framework.exceptions import ValidationError
        from .services_product_variant import find_or_create_product_variant

        try:
            variant, created = find_or_create_product_variant(
                product,
                axis_values,
                code=request.data.get("code"),
            )
        except DjangoValidationError as exc:
            raise ValidationError(getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc))
        return Response(
            {"variant": ProductVariantSerializer(variant).data, "created": created},
            status=201 if created else 200,
        )

    @action(detail=True, methods=["post"], url_path="preview-bom")
    def preview_bom(self, request, pk=None):
        from django.core.exceptions import ValidationError as DjangoValidationError

        from apps.sales.services.bom_preview import BOMPreviewService

        product = self.get_object()
        try:
            preview = BOMPreviewService.for_line({**request.data, "product_master": str(product.id)})
            return Response(preview, status=status.HTTP_200_OK)
        except DjangoValidationError as exc:
            detail = getattr(exc, "message_dict", None) or getattr(exc, "messages", None) or str(exc)
            blockers = _flatten_preview_validation_errors(detail)
            return Response(
                {
                    "variant_status": "NEW",
                    "invariant_signature": product.invariant_signature or product.code,
                    "geometry_snapshot": {},
                    "layer_snapshot": [],
                    "bom": {"planning_lines": [], "is_complete": False, "errors": blockers},
                    "bom_by_step": [],
                    "packaging_lines": [],
                    "pod_lines": [],
                    "is_complete": False,
                    "blockers": blockers,
                    "checks": [{"label": blocker, "ok": False, "tone": "error"} for blocker in blockers],
                    "errors": blockers,
                    "detail": detail,
                },
                status=status.HTTP_200_OK,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["get", "post"], url_path="catalog-bom-preview")
    def catalog_bom_preview(self, request, pk=None):
        """
        Side-effect free V3.3 preview for catalog-backed axes.
        POD, inner pack, outer pack, and add-on axes resolve to the same catalog
        rows that sales submit will snapshot and planner auto-demand will use.
        """
        product = self.get_object()
        payload = request.data if request.method == "POST" else request.query_params
        axis_values = payload.get("axis_values") or {}
        if isinstance(axis_values, str):
            import json

            try:
                axis_values = json.loads(axis_values)
            except Exception:
                axis_values = {}
        total_pouches = (
            payload.get("total_pouches")
            or payload.get("total_pcs")
            or payload.get("quantity")
            or 0
        )
        overlay = payload.get("overlay") if isinstance(payload.get("overlay"), dict) else {}

        lines = []
        for axis_def in _catalog_axis_defs(product, axis_values):
            if not isinstance(axis_def, dict) or not axis_def.get("master_data_source"):
                continue
            axis_name = str(axis_def.get("axis") or "").strip()
            refs = _catalog_refs(axis_values, axis_def)
            if not axis_name or not refs:
                continue
            for ref in refs:
                source = str(axis_def.get("master_data_source") or "").strip()
                catalog_obj = None
                material = None
                catalog_id = None
                catalog_code = str(ref)
                catalog_name = str(ref)
                uom = "PCS"
                in_house = False
                basis = "FORMULA"

                if source == "packaging_material":
                    material = _packaging_material_from_ref(ref, axis_def.get("master_data_filter"))
                    if not material:
                        return Response(
                            {"detail": f"{axis_name} catalog value '{ref}' was not found."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    catalog_obj = material
                    catalog_id = str(material.id)
                    catalog_code = material.code
                    catalog_name = material.name
                    uom = material.base_uom or "PCS"
                    in_house = str(material.packaging_supply_mode or "").upper() in {"IN_HOUSE", "BOTH"}
                    if (
                        axis_name == "packaging_outer"
                        or _safe_float(axis_def.get("qty_per_pcs"), None) == 0
                        or str(material.packaging_kind or "").upper() in {"GONNY", "BOX", "OUTER_BAG"}
                    ):
                        basis = "COUNTED_AT_PACKING"
                elif source == "pod_sku_variant":
                    variant = _pod_variant_from_ref(ref)
                    if not variant:
                        return Response(
                            {"detail": f"{axis_name} catalog value '{ref}' was not found."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    catalog_obj = variant
                    material = variant.material
                    catalog_id = str(variant.id)
                    catalog_code = variant.code
                    catalog_name = variant.name
                    uom = getattr(material, "base_uom", None) or "KG"
                    in_house = bool(getattr(material, "pod_is_inhouse_produced", False))
                elif source == "addon":
                    material = _addon_material_from_ref(ref)
                    if not material:
                        return Response(
                            {"detail": f"{axis_name} catalog value '{ref}' was not found."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    catalog_obj = material
                    catalog_id = str(material.id)
                    catalog_code = material.code
                    catalog_name = material.name
                    uom = material.base_uom or "PCS"
                    in_house = False
                else:
                    return Response(
                        {"detail": f"{axis_name} uses unsupported master_data_source '{source}'."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                try:
                    required_qty = 0 if basis == "COUNTED_AT_PACKING" else _quantity_for_axis(
                        axis_def,
                        total_pouches,
                        material=material,
                        overlay=overlay,
                    )
                except Exception as exc:
                    return Response(
                        {"detail": f"{axis_name} qty formula failed: {exc}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                auto_demand = bool(axis_def.get("auto_demand_in_house") and in_house and required_qty > 0)
                lines.append(
                    {
                        "axis": axis_name,
                        "catalog_source": source,
                        "catalog_id": catalog_id or str(getattr(catalog_obj, "id", "")),
                        "catalog_code": catalog_code,
                        "catalog_name": catalog_name,
                        "required_qty": required_qty,
                        "uom": uom,
                        "basis": basis,
                        "formula": axis_def.get("qty_formula") or None,
                        "auto_demand_in_house": bool(axis_def.get("auto_demand_in_house")),
                        "in_house": in_house,
                        "would_create_demand": auto_demand,
                    }
                )
        return Response({"lines": lines, "count": len(lines), "total_pouches": _safe_float(total_pouches, 0)})

    @action(detail=True, methods=["get", "post"])
    def overlays(self, request, pk=None):
        product = self.get_object()
        if request.method == "POST":
            serializer = CustomerProductOverlaySerializer(data={**request.data, "product_master": str(product.id)})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=201)
        queryset = CustomerProductOverlay.objects.select_related("product_master", "customer", "default_artwork").filter(product_master=product)
        customer = request.query_params.get("customer")
        if customer:
            queryset = queryset.filter(customer_id=customer)
        return Response(CustomerProductOverlaySerializer(queryset.order_by("customer__name", "size_variant_code", "customer_item_code"), many=True).data)

    @action(detail=True, methods=["get"])
    def template(self, request, pk=None):
        product = self.get_object()
        template = product.template or product.default_template
        if not template:
            return Response({"template": None, "route_steps": []})
        steps = []
        for index, step in enumerate(getattr(template, "process_steps", []).all() if hasattr(template, "process_steps") else []):
            process = getattr(step, "process", None)
            steps.append({
                "index": index + 1,
                "name": getattr(step, "process_name", "") or getattr(process, "name", "") or getattr(step, "name", "") or str(process or ""),
                "process_code": getattr(step, "process_code", "") or getattr(process, "code", ""),
                "transition": getattr(step, "transition", "") or getattr(process, "transition", ""),
                "roll_behavior": getattr(step, "roll_behavior", "") or getattr(process, "roll_behavior", ""),
                "has_artwork": bool(getattr(step, "has_artwork", False) or getattr(process, "has_artwork", False)),
            })
        return Response({
            "template": {"id": str(template.id), "name": template.name, "fg_type": template.fg_type, "status": template.status},
            "route_steps": steps,
        })

    @action(detail=True, methods=["get"], url_path="planner-stock")
    def planner_stock(self, request, pk=None):
        from apps.production.models import PlannedStockOrder
        from apps.production.serializers import PlannedStockOrderSerializer

        product = self.get_object()
        queryset = PlannedStockOrder.objects.select_related("template", "plant", "product_master", "committed_customer", "committed_artwork").filter(product_master=product).order_by("-created_at")[:50]
        return Response(PlannedStockOrderSerializer(queryset, many=True).data)

    @action(detail=True, methods=["get"], url_path="saved-presets")
    def saved_presets(self, request, pk=None):
        from apps.sales.models import SalesSku
        from apps.sales.serializers_orders import SalesSkuSerializer

        product = self.get_object()
        queryset = SalesSku.objects.select_related("template", "product_master", "commercial_family").prefetch_related("variants").filter(product_master=product).order_by("name", "code")
        return Response(SalesSkuSerializer(queryset, many=True).data)

    @action(detail=True, methods=["get"])
    def consumers(self, request, pk=None):
        product = self.get_object()
        needles = {str(product.id).lower(), str(product.code or "").lower(), str(product.name or "").lower()}
        needles.discard("")

        def contains_reference(value):
            if value is None:
                return False
            if isinstance(value, dict):
                return any(contains_reference(child) for child in value.values())
            if isinstance(value, (list, tuple)):
                return any(contains_reference(child) for child in value)
            if isinstance(value, str):
                normalized = value.lower()
                return normalized in needles
            return False

        consumers = []
        queryset = (
            ProductMaster.objects.select_related("template", "default_template", "commercial_family")
            .annotate(overlay_count=Count("customer_overlays"))
            .exclude(id=product.id)
            .order_by("name", "code")
        )
        for candidate in queryset:
            if any(
                contains_reference(source)
                for source in (
                    candidate.layer_template,
                    candidate.canonical_layer_stack,
                    candidate.variant_axes,
                    candidate.fixed_attributes,
                )
            ):
                consumers.append(candidate)
        return Response(ProductMasterSerializer(consumers, many=True).data)

    @action(detail=True, methods=["get"])
    def audit(self, request, pk=None):
        product = self.get_object()
        return Response([
            {"at": product.updated_at, "event": "Product Master ready", "detail": "Used by sales as configurable master; sizes/artwork stay below it."}
        ])

    # ─────────────────────────── BOM (quotation workspace) ───────────────────
    # The quotation workspace catalog flow needs to hydrate a Product Master's
    # full Bill of Materials — film layers, adhesive, ink, addons, feature
    # toggle defaults — so the sales operator can tweak per-quote without
    # creating a new master. The PM stores the canonical BOM hints under
    # `layer_template` (film stack) and `fixed_attributes["bom_defaults"]`
    # (everything else). This action consolidates both into a single
    # consumer-friendly payload.
    DEFAULT_FEATURE_OPTIONS = [
        {"key": "has_zipper", "label": "Zipper"},
        {"key": "has_valve", "label": "One-way valve"},
        {"key": "has_window", "label": "Window patch"},
        {"key": "has_tear_notch", "label": "Tear notch"},
        {"key": "has_hang_hole", "label": "Hang hole"},
        {"key": "finish_matte", "label": "Matte finish"},
        {"key": "has_white_ink_layer", "label": "White ink underlay"},
        {"key": "has_metallised_layer", "label": "Metallised layer"},
    ]

    @action(detail=True, methods=["get"], url_path="bom")
    def bom(self, request, pk=None):
        """Return the canonical BOM hydration payload for the quotation
        workspace catalog flow.

        Shape:
            {
              "product_master_id": ..., "product_master_code": ...,
              "default_pouch_style_id": ..., "default_pouch_style_code": ...,
              "sizes": [{id, code, label, width_mm, height_mm, gusset_mm, flap_mm, pouch_style_id}],
              "layers": [{position, material_id, material_code, material_name, micron, gsm, rate_per_kg, density_gcm3}],
              "adhesive": {material_id, code, name, gsm, rate_per_kg},
              "ink": {material_id, code, name, gsm, rate_per_kg, coverage},
              "addons": [{material_id, code, name, qty_per_pouch, rate_per_kg}],
              "feature_options": [{key, label, default}],
              "feature_defaults": {...},
            }
        """
        product = self.get_object()
        bom_defaults = {}
        if isinstance(product.fixed_attributes, dict):
            raw = product.fixed_attributes.get("bom_defaults")
            if isinstance(raw, dict):
                bom_defaults = raw

        # ── Hydrate layer rows from `layer_template` + InventoryMaterial ──
        layers_out = []
        layer_template = product.layer_template or product.canonical_layer_stack or []
        try:
            material_codes = [
                str(row.get("material_code") or row.get("film_variant_code") or "").strip()
                for row in layer_template
                if isinstance(row, dict)
            ]
            material_codes = [c for c in material_codes if c]
            material_map = {}
            if material_codes:
                for mat in InventoryMaterial.objects.filter(code__in=material_codes):
                    material_map[mat.code] = mat
        except Exception:
            material_map = {}

        # rate-per-kg helper — uses MaterialCostSnapshot if available, falls back to 0
        try:
            from apps.costing.models import MaterialCostSnapshot
        except Exception:  # pragma: no cover
            MaterialCostSnapshot = None
        rate_map = {}
        if MaterialCostSnapshot is not None and material_map:
            for snap in MaterialCostSnapshot.objects.filter(material__in=list(material_map.values())):
                rate_map[str(snap.material_id)] = float(snap.avg_rate_per_kg or 0)

        for idx, row in enumerate(layer_template or []):
            if not isinstance(row, dict):
                continue
            code = str(row.get("material_code") or row.get("film_variant_code") or "").strip()
            mat = material_map.get(code) if code else None
            micron = row.get("thickness_micron") or row.get("micron") or 0
            density = None
            if mat and mat.density_gcm3 is not None:
                density = float(mat.density_gcm3)
            elif row.get("density_gcm3") is not None:
                density = float(row.get("density_gcm3"))
            gsm = float(micron) * density if (density and micron) else (row.get("gsm") or 0)
            layers_out.append({
                "position": row.get("role") or f"L{idx + 1}",
                "material_id": str(mat.id) if mat else (row.get("material_id") or None),
                "material_code": code,
                "material_name": mat.name if mat else (row.get("name") or code),
                "micron": float(micron or 0),
                "gsm": float(gsm or 0),
                "rate_per_kg": float((rate_map.get(str(mat.id)) if mat else None) or row.get("rate_per_kg") or 0),
                "density_gcm3": density,
            })

        # Layers may also live under bom_defaults.layers (preferred when set).
        if isinstance(bom_defaults.get("layers"), list) and bom_defaults["layers"]:
            layers_out = bom_defaults["layers"]

        # ── Sizes ──
        sizes_qs = product.sizes.filter(active=True).order_by("sort_order", "label", "code")
        sizes_out = []
        first_pouch_style_id = None
        for s in sizes_qs:
            ps_id = str(s.pouch_style_master_id) if s.pouch_style_master_id else None
            if ps_id and not first_pouch_style_id:
                first_pouch_style_id = ps_id
            geom = s.geometry_config if isinstance(s.geometry_config, dict) else {}
            sizes_out.append({
                "id": str(s.id),
                "code": s.code,
                "label": s.label,
                "width_mm": float(s.width_mm) if s.width_mm is not None else None,
                "height_mm": float(s.height_mm) if s.height_mm is not None else None,
                "gusset_mm": float(s.gusset_mm) if s.gusset_mm is not None else None,
                "flap_mm": float(geom.get("flap_mm") or 0) or None,
                "qty_uom": s.qty_uom,
                "standard_qty": float(s.standard_qty) if s.standard_qty is not None else None,
                "pouch_style_id": ps_id,
                "child_target_width_mm": float(s.child_target_width_mm) if s.child_target_width_mm is not None else None,
            })

        adhesive = bom_defaults.get("adhesive") if isinstance(bom_defaults.get("adhesive"), dict) else {
            "name": "Standard PU adhesive",
            "gsm": 4.0,
            "rate_per_kg": 280.0,
        }
        ink = bom_defaults.get("ink") if isinstance(bom_defaults.get("ink"), dict) else {
            "name": "Solvent ink",
            "gsm": 3.2,
            "rate_per_kg": 410.0,
            "coverage": "MEDIUM",
        }
        addons = bom_defaults.get("addons") if isinstance(bom_defaults.get("addons"), list) else []

        feature_options = list(self.DEFAULT_FEATURE_OPTIONS)
        custom_features = bom_defaults.get("feature_options")
        if isinstance(custom_features, list) and custom_features:
            feature_options = [f for f in custom_features if isinstance(f, dict) and f.get("key")]
        feature_defaults = bom_defaults.get("feature_defaults") if isinstance(bom_defaults.get("feature_defaults"), dict) else {}

        return Response({
            "product_master_id": str(product.id),
            "product_master_code": product.code,
            "product_master_name": product.name,
            "default_pouch_style_id": first_pouch_style_id,
            "sizes": sizes_out,
            "layers": layers_out,
            "adhesive": adhesive,
            "ink": ink,
            "addons": addons,
            "feature_options": feature_options,
            "feature_defaults": feature_defaults,
        })

    @action(detail=True, methods=["post"], url_path="update-bom")
    def update_bom(self, request, pk=None):
        """Promote a modified BOM (from a quote line) back to the master.

        Gated by `master.manage` (enforced globally by the perm registry on
        POST /api/master/). Body matches the shape returned by `bom` —
        `layers`, `adhesive`, `ink`, `addons`, `feature_defaults`.
        """
        product = self.get_object()
        payload = request.data or {}
        bom_defaults = {}
        if isinstance(product.fixed_attributes, dict):
            bom_defaults = dict(product.fixed_attributes)
        else:
            bom_defaults = {}

        new_defaults = dict(bom_defaults.get("bom_defaults") or {})
        for key in ("layers", "adhesive", "ink", "addons", "feature_defaults", "feature_options"):
            if key in payload:
                new_defaults[key] = payload[key]
        bom_defaults["bom_defaults"] = new_defaults
        product.fixed_attributes = bom_defaults

        # Also write `layer_template` from layers for backward compatibility.
        layers = payload.get("layers")
        if isinstance(layers, list) and layers:
            template_rows = []
            for idx, layer in enumerate(layers):
                if not isinstance(layer, dict):
                    continue
                template_rows.append({
                    "role": layer.get("position") or f"L{idx + 1}",
                    "material_code": layer.get("material_code") or "",
                    "thickness_micron": layer.get("micron") or 0,
                    "gsm": layer.get("gsm") or 0,
                })
            if template_rows:
                product.layer_template = template_rows

        product.save(update_fields=["fixed_attributes", "layer_template", "updated_at"])
        return Response(ProductMasterSerializer(product).data)


class ProductMasterSizeViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_PRODUCT_SIZE"
    serializer_class = ProductMasterSizeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["product_master", "active", "qty_uom"]
    search_fields = ["code", "label", "notes", "product_master__code", "product_master__name"]

    def get_queryset(self):
        return ProductMasterSize.objects.select_related("product_master").order_by("product_master__name", "sort_order", "label")


class CustomerProductOverlayViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_CUSTOMER_PRODUCT_OVERLAY"
    serializer_class = CustomerProductOverlaySerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['product_master', 'customer', 'active', 'default_price_basis']
    search_fields = [
        'customer_item_code',
        'customer_display_name',
        'customer__name',
        'customer__code',
        'product_master__name',
        'product_master__code',
    ]

    def get_queryset(self):
        return CustomerProductOverlay.objects.select_related(
            'product_master',
            'customer',
            'default_artwork',
        ).order_by('customer__name', 'product_master__name', 'customer_item_code')


class PODViewSet(viewsets.ModelViewSet):
    queryset = InventoryMaterial.objects.filter(category='POD').select_related('produced_by_product_variant__master').order_by('name')
    serializer_class = PODSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.code.startswith('POD-'):
            from rest_framework.exceptions import ValidationError
            immutable = {}
            if 'code' in serializer.validated_data and serializer.validated_data.get('code') != instance.code:
                immutable['code'] = "Core POD code cannot be changed."
            if 'category' in serializer.validated_data and serializer.validated_data.get('category') != instance.category:
                immutable['category'] = "Core POD category cannot be changed."
            if 'base_uom' in serializer.validated_data and serializer.validated_data.get('base_uom') != instance.base_uom:
                immutable['base_uom'] = "Core POD base_uom cannot be changed."
            if immutable:
                raise ValidationError(immutable)
        serializer.save()

    def perform_destroy(self, instance):
        if instance.code.startswith('POD-'):
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Core POD materials cannot be deleted.")
        instance.delete()


class FilmFamilyViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_FILM_FAMILY"
    queryset = InventoryMaterial.objects.filter(category='FILM_FAMILY').order_by('name')
    serializer_class = FilmFamilySerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name']

class FilmVariantViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_FILM_VARIANT"
    queryset = InventoryMaterial.objects.filter(category='FILM_VARIANT').order_by('name')
    serializer_class = FilmVariantSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['parent_family', 'is_extrudable']
    search_fields = ['name', 'code']
    @action(detail=False, methods=['get'])
    def grades(self, request):
        from apps.recipes.models import RecipeGrade
        # If variant_id is provided in query params, we could filter, 
        # but the request is for global grades from master.
        variant_id = request.query_params.get('variant_id')
        grades = RecipeGrade.objects.all()
        return Response([{"id": str(g.id), "name": g.name} for g in grades])

class GranuleViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_GRANULE"
    queryset = InventoryMaterial.objects.filter(category='GRANULE').prefetch_related('quality_codes').order_by('name')
    serializer_class = GranuleSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']


class GranuleQualityCodeViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_GRANULE_CODE"
    queryset = GranuleQualityCode.objects.select_related('granule').order_by('granule__name', 'code')
    serializer_class = GranuleQualityCodeSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['granule', 'status']
    search_fields = ['code', 'granule__name', 'granule__code']

class InkViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_INK"
    queryset = InkMaterial.objects.all().order_by('color_name')
    serializer_class = InkSerializer
    filter_backends = [filters.SearchFilter, DjangoFilterBackend]
    filterset_fields = ['base_type']
    search_fields = ['color_name', 'code', 'name']
    def create(self, request, *args, **kwargs):
        try:
            return super().create(request, *args, **kwargs)
        except Exception as e:
            if "unique constraint" in str(e).lower() or "integrity" in str(e).lower():
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"detail": f"Ink with this Base Type and Color Name already exists."})
            raise e

class AdhesiveSolventViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    """
    Adhesive and solvent masters used by Product Master chemistry defaults.
    """
    audit_area = "MASTER_ADHESIVE_SOLVENT"
    queryset = InventoryMaterial.objects.filter(
        category__in=['ADHESIVE', 'SOLVENT'],
    ).order_by('category', 'name')
    serializer_class = AdhesiveSolventSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['category']
    search_fields = ['name', 'code']

class AddonViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_ADDON"
    queryset = InventoryMaterial.objects.filter(category='ADDON').order_by('name')
    serializer_class = AddonSerializer
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']


class PackagingViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_PACKAGING"
    queryset = InventoryMaterial.objects.filter(category='PACKAGING').select_related('produced_by_product_variant__master').order_by('name')
    serializer_class = PackagingSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['packaging_kind', 'packaging_supply_mode', 'base_uom', 'status']
    search_fields = ['name', 'code']


class PodSkuViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_POD_SKU"
    queryset = PodSku.objects.prefetch_related('variants__material').order_by('name', 'code')
    serializer_class = PodSkuSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['active', 'family']
    search_fields = ['name', 'code', 'family']


class PodSkuVariantViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    audit_area = "MASTER_POD_SKU_VARIANT"
    serializer_class = PodSkuVariantSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['active', 'pod_sku', 'material']
    search_fields = ['name', 'code', 'pod_sku__name', 'pod_sku__code', 'material__name', 'material__code']

    def get_queryset(self):
        queryset = PodSkuVariant.objects.select_related(
            'pod_sku',
            'material',
            'material__produced_by_product_variant__master',
        ).order_by('pod_sku__name', 'name', 'code')
        pod_sku_id = str(
            self.request.query_params.get('pod_sku')
            or self.request.query_params.get('pod_sku_id')
            or ''
        ).strip()
        if pod_sku_id:
            queryset = queryset.filter(pod_sku_id=pod_sku_id)
        return queryset


# ─────────────────────────────────────────────────────────────────────────────
# Pouch style master
# ─────────────────────────────────────────────────────────────────────────────


class PouchStyleMasterViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    """CRUD + preview endpoint for PouchStyleMaster.

    Versioning:
      - PATCH on a `locked` style creates a NEW row with `version + 1`
        (same code) and returns it. Original stays unchanged so old sizes
        keep their snapshot.
      - PATCH on an unlocked style updates in place.

    Disable instead of delete:
      - DELETE just sets `deprecated = True` so historical FKs survive.
    """

    audit_area = "MASTER_POUCH_STYLE"
    serializer_class = PouchStyleSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["formula_kind", "deprecated", "locked"]
    search_fields = ["code", "name", "description", "notes"]

    def get_queryset(self):
        qs = PouchStyleMaster.objects.all().order_by("sort_order", "name", "-version")
        # For detail/update/destroy/custom-action calls (`pk` in URL kwargs),
        # never filter — every version must be reachable by id.
        if self.kwargs.get("pk"):
            return qs
        # On list endpoints, show only the latest version per code unless the
        # caller passes ?all_versions=1.
        if str(self.request.query_params.get("all_versions") or "").strip() not in {"1", "true", "yes"}:
            latest_ids = []
            seen_codes = set()
            for row in qs:
                if row.code in seen_codes:
                    continue
                seen_codes.add(row.code)
                latest_ids.append(row.id)
            qs = PouchStyleMaster.objects.filter(id__in=latest_ids).order_by("sort_order", "name")
        return qs

    def perform_create(self, serializer):
        instance = serializer.save(
            created_by=self.request.user if self.request.user.is_authenticated else None,
            updated_by=self.request.user if self.request.user.is_authenticated else None,
        )
        return instance

    def update(self, request, *args, **kwargs):
        """If the target style is locked, spawn a new version instead of mutating it."""
        instance = self.get_object()
        if instance.locked:
            return self._spawn_new_version(instance, request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.locked:
            return self._spawn_new_version(instance, request)
        return super().partial_update(request, *args, **kwargs)

    def _spawn_new_version(self, instance, request):
        """
        Build a new PouchStyleMaster row directly from the existing instance +
        the incoming PATCH payload. Bypasses the serializer's
        UniqueTogetherValidator on (code, version) which would falsely flag
        the spawn during validation.
        """
        from django.db.models import Max
        latest_v = (
            PouchStyleMaster.objects.filter(code=instance.code).aggregate(Max("version"))["version__max"]
            or instance.version
        )
        body = dict(request.data or {})

        def pick(field, fallback):
            v = body.get(field, None)
            return fallback if v is None else v

        new_instance = PouchStyleMaster.objects.create(
            code=instance.code,
            name=pick("name", instance.name),
            description=pick("description", instance.description),
            version=int(latest_v) + 1,
            locked=False,
            visual_emoji=pick("visual_emoji", instance.visual_emoji),
            visual_svg=pick("visual_svg", instance.visual_svg),
            default_roll_axis=pick("default_roll_axis", instance.default_roll_axis),
            default_stock_form=pick("default_stock_form", instance.default_stock_form),
            default_width_basis=pick("default_width_basis", instance.default_width_basis),
            default_slit_policy=pick("default_slit_policy", instance.default_slit_policy),
            stock_form_options=pick("stock_form_options", instance.stock_form_options),
            allowed_fields=pick("allowed_fields", instance.allowed_fields),
            field_adjustments=pick("field_adjustments", instance.field_adjustments),
            formula_kind=pick("formula_kind", instance.formula_kind),
            formula_params=pick("formula_params", instance.formula_params),
            formula_ast=pick("formula_ast", instance.formula_ast),
            formula_expression=pick("formula_expression", instance.formula_expression),
            deprecated=bool(pick("deprecated", instance.deprecated)),
            sort_order=int(pick("sort_order", instance.sort_order) or 0),
            notes=pick("notes", instance.notes),
            created_by=request.user if request.user.is_authenticated else None,
            updated_by=request.user if request.user.is_authenticated else None,
        )
        return Response(PouchStyleSerializer(new_instance).data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        instance = serializer.save(
            updated_by=self.request.user if self.request.user.is_authenticated else None,
        )
        return instance

    def destroy(self, request, *args, **kwargs):
        """Soft-delete via deprecated flag — preserves historical FKs."""
        instance = self.get_object()
        instance.deprecated = True
        instance.save(update_fields=["deprecated", "updated_at"])
        return Response(PouchStyleSerializer(instance).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reactivate")
    def reactivate(self, request, pk=None):
        instance = self.get_object()
        instance.deprecated = False
        instance.save(update_fields=["deprecated", "updated_at"])
        return Response(PouchStyleSerializer(instance).data)

    @action(detail=False, methods=["get"], url_path="by-code/(?P<code>[^/.]+)")
    def by_code(self, request, code=None):
        rows = PouchStyleMaster.objects.filter(code__iexact=code).order_by("-version")
        return Response(PouchStyleSerializer(rows, many=True).data)

    @action(detail=False, methods=["post"], url_path="preview")
    def preview(self, request):
        """Live preview — compute stock width + film-area width without persisting.

        Body:
            {
              "formula_kind": "GUSSETED_BOTTOM",
              "formula_params": {"trim_mm": 5, "bottom_factor": 1.0},
              "formula_ast": {},
              "field_adjustments": {},
              "inputs": {"W": 127, "H": 203, "gusset": 80}
            }
        """
        from .services_pouch_style import compute_stock_geometry

        body = PouchStylePreviewSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        payload = body.validated_data

        class _StyleStub:
            formula_kind = (payload.get("formula_kind") or "SIMPLE_DOUBLE").upper()
            formula_params = payload.get("formula_params") or {}
            formula_ast = payload.get("formula_ast") or {}
            field_adjustments = payload.get("field_adjustments") or {}
            default_stock_form = payload.get("stock_form") or "OPEN_WEB"
            default_width_basis = ""
            default_slit_policy = ""
            stock_form_options = {}

        try:
            geometry = compute_stock_geometry(_StyleStub, payload.get("inputs") or {}, stock_form=payload.get("stock_form"))
        except Exception as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            "child_target_width_mm": float(geometry["child_target_width_mm"]),
            "stock_width_mm": float(geometry["stock_width_mm"]),
            "film_area_width_mm": float(geometry["film_area_width_mm"]),
            "stock_form": geometry["stock_form"],
            "width_basis": geometry["width_basis"],
            "slit_policy": geometry["slit_policy"],
            "film_area_factor": float(geometry["film_area_factor"]),
        })


# ─────────────────────────────────────────────────────────────────────────────
# Web-width policy
# ─────────────────────────────────────────────────────────────────────────────


class WebWidthPolicyViewSet(MasterDataAuditMixin, viewsets.ModelViewSet):
    """CRUD endpoints for WebWidthPolicy + helper to fetch the default."""

    audit_area = "MASTER_WEB_WIDTH_POLICY"
    serializer_class = WebWidthPolicySerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["is_default", "deprecated", "scope_type", "parent_width_strategy"]
    search_fields = ["code", "name", "description", "notes", "scope_ref"]

    def get_queryset(self):
        return WebWidthPolicy.objects.all().order_by("-is_default", "name")

    @action(detail=False, methods=["get"], url_path="default")
    def get_default(self, request):
        instance = resolve_web_width_policy({})
        if instance is None:
            return Response({"error": "No web-width policy configured yet."}, status=status.HTTP_404_NOT_FOUND)
        return Response(WebWidthPolicySerializer(instance).data)

    @action(detail=False, methods=["get"], url_path="resolve")
    def resolve(self, request):
        context = {
            "product_master_id": request.query_params.get("product_master_id") or request.query_params.get("product_master"),
            "product_master_code": request.query_params.get("product_master_code"),
            "product_kind": request.query_params.get("product_kind"),
            "pouch_style": request.query_params.get("pouch_style"),
            "process_id": request.query_params.get("process_id") or request.query_params.get("process"),
            "process_code": request.query_params.get("process_code"),
            "machine_id": request.query_params.get("machine_id") or request.query_params.get("machine"),
            "machine_code": request.query_params.get("machine_code"),
        }
        context = {k: str(v).strip() for k, v in context.items() if v not in (None, "")}
        instance = resolve_web_width_policy(context)
        if instance is None:
            return Response({"error": "No web-width policy configured yet."}, status=status.HTTP_404_NOT_FOUND)

        payload = {
            "policy": WebWidthPolicySerializer(instance).data,
            "context": context,
        }
        if request.query_params.get("child_width_mm"):
            try:
                plan = evaluate_web_width_plan(
                    request.query_params.get("child_width_mm"),
                    request.query_params.get("lane_count") or 1,
                    policy=instance,
                    context=context,
                )
            except Exception as exc:
                return Response({"policy": payload["policy"], "context": context, "error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            plan.pop("policy", None)
            payload["plan"] = plan
        return Response(payload)
