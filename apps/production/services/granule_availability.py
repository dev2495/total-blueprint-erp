from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.db.models import Q

from apps.inventory.models import InventoryBulk
from apps.materials.models import GranuleQualityCode


class GranuleStockConflict(ValueError):
    """Raised when stock changed after the operator loaded the issue screen."""


def _q4(value):
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.0001"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Granule allocation quantity must be a valid number.") from exc


class GranuleAvailabilityService:
    """Single source of truth for granule code/source issue eligibility."""

    @staticmethod
    def _stock_status(stock, *, issue_location_id=None, issue_plant_id=None):
        location = stock.location
        code = stock.granule_code
        if str(code.status or "").upper() != "ACTIVE" or code.merged_into_id:
            return "INACTIVE", False, False, "Inactive code; use its canonical replacement."
        if not location or not location.is_active:
            return "INACTIVE_LOCATION", False, False, "Stock location is inactive."
        if str(location.code or "").upper() == "IN_TRANSIT" or str(location.type or "").upper() == "TRANSIT":
            return "IN_TRANSIT", False, False, "Stock is in transit and cannot be issued."
        if issue_location_id and str(stock.location_id) == str(issue_location_id):
            return "ALLOCATABLE", True, False, "Ready at the job issue store."
        if issue_plant_id and str(stock.plant_id) == str(issue_plant_id):
            return "ALLOCATABLE", True, False, "Ready in the same plant; WCM will move it to the issue store."
        return "OTHER_PLANT", False, True, "Available at another plant; transfer and receipt are required."

    @classmethod
    def options(cls, material, *, issue_location_id=None, issue_plant_id=None):
        codes = list(
            GranuleQualityCode.objects.filter(granule=material)
            .select_related("merged_into")
            .order_by("status", "code", "created_at")
        )
        stocks = list(
            InventoryBulk.objects.filter(
                material=material,
                granule_code__isnull=False,
                qty_kg__gt=0,
            )
            .select_related("granule_code", "granule_code__merged_into", "location", "plant")
            .order_by("granule_code__code", "plant__name", "location__name")
        )
        stocks_by_code = defaultdict(list)
        for stock in stocks:
            stocks_by_code[str(stock.granule_code_id)].append(stock)

        options = []
        for code in codes:
            code_stocks = stocks_by_code.get(str(code.id), [])
            if not code_stocks:
                inactive = str(code.status or "").upper() != "ACTIVE" or bool(code.merged_into_id)
                replacement = code.merged_into.code if code.merged_into_id and code.merged_into else ""
                options.append({
                    "granule_code_id": str(code.id),
                    "code": code.code,
                    "canonical_key": code.canonical_key,
                    "master_status": code.status,
                    "eligibility_status": "INACTIVE" if inactive else "ZERO_STOCK",
                    "status_reason": (
                        f"Merged into {replacement}." if replacement else
                        "Inactive internal code." if inactive else
                        "No physical stock has been received against this exact code."
                    ),
                    "available_qty_kg": 0.0,
                    "location_id": None,
                    "location_name": "",
                    "plant_id": None,
                    "plant_name": "",
                    "allocation_scope": "UNAVAILABLE",
                    "can_allocate": False,
                    "transfer_required": False,
                })
                continue

            for stock in code_stocks:
                eligibility_status, can_allocate, transfer_required, reason = cls._stock_status(
                    stock,
                    issue_location_id=issue_location_id,
                    issue_plant_id=issue_plant_id,
                )
                if can_allocate:
                    allocation_scope = (
                        "ISSUE_LOCATION"
                        if issue_location_id and str(stock.location_id) == str(issue_location_id)
                        else "SAME_PLANT"
                    )
                elif transfer_required:
                    allocation_scope = "OTHER_PLANT"
                else:
                    allocation_scope = "UNAVAILABLE"
                options.append({
                    "granule_code_id": str(code.id),
                    "code": code.code,
                    "canonical_key": code.canonical_key,
                    "master_status": code.status,
                    "eligibility_status": eligibility_status,
                    "status_reason": reason,
                    "available_qty_kg": float(stock.qty_kg or 0),
                    "location_id": str(stock.location_id),
                    "location_name": stock.location.name if stock.location else "",
                    "plant_id": str(stock.plant_id),
                    "plant_name": stock.plant.name if stock.plant else "",
                    "allocation_scope": allocation_scope,
                    "can_allocate": can_allocate,
                    "transfer_required": transfer_required,
                })
        return options

    @classmethod
    def validate_allocations(
        cls,
        *,
        material,
        issued_qty,
        allocations,
        issue_location_id=None,
        issue_plant_id=None,
        lock=False,
    ):
        issued = _q4(issued_qty)
        raw_allocations = allocations or []
        if issued <= 0:
            return {}
        if not isinstance(raw_allocations, list) or not raw_allocations:
            raise ValueError(f"Select at least one active grade/code for {material.name}.")

        stock_qs = InventoryBulk.objects.filter(
            material=material,
            granule_code__isnull=False,
            granule_code__status="ACTIVE",
            granule_code__merged_into__isnull=True,
            qty_kg__gt=0,
            location__is_active=True,
        ).exclude(Q(location__code="IN_TRANSIT") | Q(location__type="TRANSIT"))
        if issue_plant_id:
            stock_qs = stock_qs.filter(plant_id=issue_plant_id)
        elif issue_location_id:
            stock_qs = stock_qs.filter(location_id=issue_location_id)
        if lock:
            # Only the bulk-balance row owns the quantity being validated.
            # Related code/location joins are intentionally not locked; some
            # of those relations are nullable and PostgreSQL rejects a row
            # lock applied to the nullable side of an OUTER JOIN.
            stock_qs = stock_qs.select_for_update(of=("self",))

        available_by_source_code = defaultdict(lambda: Decimal("0"))
        code_labels = {}
        for stock in stock_qs.select_related("granule_code", "location"):
            key = (str(stock.location_id), str(stock.granule_code_id))
            available_by_source_code[key] += _q4(stock.qty_kg)
            code_labels[str(stock.granule_code_id)] = stock.granule_code.code

        allocated_by_source_code = defaultdict(lambda: Decimal("0"))
        for allocation in raw_allocations:
            code_id = str(allocation.get("granule_code_id") or allocation.get("id") or "").strip()
            location_id = str(
                allocation.get("source_location_id")
                or allocation.get("location_id")
                or issue_location_id
                or ""
            ).strip()
            qty = _q4(allocation.get("qty_kg") or allocation.get("quantity"))
            if not code_id or not location_id or qty <= 0:
                raise ValueError(f"Every {material.name} allocation needs a code, source store and positive quantity.")
            source_key = (location_id, code_id)
            if source_key not in available_by_source_code:
                code = GranuleQualityCode.objects.filter(id=code_id, granule=material).first()
                if not code:
                    raise ValueError(
                        f"Selected code is not available for {material.name}; it does not belong to this granule family."
                    )
                if str(code.status or "").upper() != "ACTIVE" or code.merged_into_id:
                    replacement = code.merged_into.code if code.merged_into_id and code.merged_into else "the active canonical code"
                    raise ValueError(f"{code.code} is inactive. Select {replacement}.")
                off_plant = InventoryBulk.objects.filter(
                    material=material,
                    granule_code=code,
                    location_id=location_id,
                    qty_kg__gt=0,
                ).exclude(plant_id=issue_plant_id).exists()
                if off_plant:
                    raise ValueError(
                        f"{code.code} is at another plant. Complete an inter-plant transfer and receipt before release."
                    )
                raise GranuleStockConflict(
                    f"{code.code} is no longer available at the selected source. Refresh availability and allocate again."
                )
            allocated_by_source_code[source_key] += qty

        allocated_total = sum(allocated_by_source_code.values(), Decimal("0")).quantize(Decimal("0.0001"))
        if allocated_total != issued:
            raise ValueError(
                f"Code split for {material.name} must total {issued} kg, got {allocated_total} kg."
            )
        for source_key, qty in allocated_by_source_code.items():
            available = available_by_source_code[source_key]
            if qty > available:
                code_label = code_labels.get(source_key[1], "Selected code")
                raise GranuleStockConflict(
                    f"{code_label} stock changed: requested {qty} kg, only {available} kg remains at that source."
                )
        return dict(allocated_by_source_code)
