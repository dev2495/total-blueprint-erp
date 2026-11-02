from collections import defaultdict
from decimal import Decimal, InvalidOperation

from django.db.models import Q, Sum

from apps.inventory.models import InventoryBulk, InventoryLocation
from apps.materials.models import GranuleQualityCode


class GranuleStockConflict(ValueError):
    """Raised when stock changed after the operator loaded the issue screen."""


def _q4(value):
    try:
        return Decimal(str(value or 0)).quantize(Decimal("0.0001"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Granule allocation quantity must be a valid number.") from exc


def _kg(value):
    return f"{Decimal(str(value or 0)):,.3f}"


CLOSED_JOB_STATES = ("COMPLETED", "CANCELLED")
HELD_JOBS_SHOWN = 5


class GranuleAvailabilityService:
    """Single source of truth for granule code/source issue eligibility."""

    @staticmethod
    def job_stock_location_id(job):
        """The store a job's step consumes from: release moves coded issue here, output consumes it here."""
        if job.from_location_id:
            return job.from_location_id
        work_center = getattr(job, "work_center", None)
        return getattr(work_center, "default_wip_location_id", None) if work_center else None

    @classmethod
    def held_by_open_jobs(cls, material_ids, *, exclude_job_id=None):
        """
        Coded granule a WCM issued to open jobs that their current step has not consumed yet.

        Returns {(stock location id, code id): {"qty": Decimal, "jobs": [job numbers]}}. Stock on hand stays in
        the store until output consumes it, so without this every issue was checked against the full balance
        and many jobs could be issued the same kilograms; the later ones then failed at output. A job holds
        min(issued, required - consumed) of each requirement, split over its codes in the issued proportion
        (the same split output consumption uses), at its own issue store.
        """
        from apps.production.models import JobMaterialRequirement, ProductionJob

        material_ids = {str(material_id) for material_id in material_ids or []}
        held = defaultdict(lambda: {"qty": Decimal("0"), "jobs": []})
        if not material_ids:
            return held
        jobs = (
            ProductionJob.objects.exclude(job_state__in=CLOSED_JOB_STATES)
            .exclude(status__in=CLOSED_JOB_STATES)
            .exclude(current_step_material_confirmations=[])
            .exclude(current_step_material_confirmations__isnull=True)
            .select_related("work_center")
            .only(
                "id", "job_number", "current_step_index", "from_location_id",
                "work_center__default_wip_location_id", "current_step_material_confirmations",
            )
        )
        if exclude_job_id:
            jobs = jobs.exclude(id=exclude_job_id)
        rows = []
        for job in jobs:
            confirmations = job.current_step_material_confirmations
            if not isinstance(confirmations, list):
                continue
            for row in confirmations:
                if not isinstance(row, dict):
                    continue
                allocations = row.get("granule_code_allocations") or row.get("code_allocations") or []
                if allocations and isinstance(allocations, list) and row.get("requirement_id"):
                    rows.append((job, row, allocations))
        if not rows:
            return held
        requirements = {
            str(req["id"]): req
            for req in JobMaterialRequirement.objects.filter(
                id__in={str(row.get("requirement_id")) for _job, row, _allocations in rows},
                material_id__in=material_ids,
            ).values("id", "production_job_id", "required_qty", "consumed_qty", "process_step__sequence_number")
        }
        for job, row, allocations in rows:
            req = requirements.get(str(row.get("requirement_id")))
            if not req or str(req["production_job_id"]) != str(job.id):
                continue
            # Only the current step's issue holds stock; an earlier step's rows are history.
            if req["process_step__sequence_number"] != int(job.current_step_index or 0) + 1:
                continue
            parts = []
            for allocation in allocations:
                if not isinstance(allocation, dict):
                    continue
                code_id = str(allocation.get("granule_code_id") or allocation.get("id") or "").strip()
                qty = _q4(allocation.get("qty_kg") or allocation.get("quantity"))
                if code_id and qty > 0:
                    parts.append((code_id, qty))
            issued = sum((qty for _code, qty in parts), Decimal("0"))
            still_to_use = min(issued, max(Decimal("0"), _q4(req["required_qty"]) - _q4(req["consumed_qty"])))
            location_id = cls.job_stock_location_id(job)
            if issued <= 0 or still_to_use <= 0 or not location_id:
                continue
            for code_id, qty in parts:
                entry = held[(str(location_id), code_id)]
                entry["qty"] += (still_to_use * qty / issued).quantize(Decimal("0.0001"))
                if job.job_number not in entry["jobs"]:
                    entry["jobs"].append(job.job_number)
        return held

    @staticmethod
    def _held_text(entry):
        jobs = entry["jobs"]
        shown = ", ".join(jobs[:HELD_JOBS_SHOWN]) + (f" +{len(jobs) - HELD_JOBS_SHOWN} more" if len(jobs) > HELD_JOBS_SHOWN else "")
        return f"{_kg(entry['qty'])} kg is issued to {len(jobs)} open job{'' if len(jobs) == 1 else 's'} ({shown}) and not used yet"

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
    def options(cls, material, *, issue_location_id=None, issue_plant_id=None, exclude_job_id=None):
        return cls.options_many([material], issue_location_id=issue_location_id,
                                issue_plant_id=issue_plant_id, exclude_job_id=exclude_job_id).get(str(material.pk), [])

    @classmethod
    def options_many(cls, materials, *, issue_location_id=None, issue_plant_id=None, exclude_job_id=None):
        """
        Load exact code/source availability for the whole step. ``available_qty_kg`` is what can still be
        issued: stock on hand less what other open jobs were issued and have not used (``exclude_job_id`` is
        the job being issued, so its own issue does not count against it).
        """
        material_ids = {str(material.pk) for material in materials}
        if not material_ids:
            return {}
        codes = list(
            GranuleQualityCode.objects.filter(granule_id__in=material_ids)
            .select_related("merged_into")
            .order_by("status", "code", "created_at")
        )
        stocks = list(
            InventoryBulk.objects.filter(
                material_id__in=material_ids,
                granule_code__isnull=False,
                qty_kg__gt=0,
            )
            .select_related("granule_code", "granule_code__merged_into", "location", "plant")
            .order_by("granule_code__code", "plant__name", "location__name")
        )
        # Holds only matter where there is coded stock to hold.
        held = cls.held_by_open_jobs(material_ids, exclude_job_id=exclude_job_id) if stocks else {}
        stocks_by_code = defaultdict(list)
        for stock in stocks:
            stocks_by_code[str(stock.granule_code_id)].append(stock)

        by_material = {material_id: [] for material_id in material_ids}
        for code in codes:
            options = by_material[str(code.granule_id)]
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
                    "on_hand_qty_kg": 0.0,
                    "held_qty_kg": 0.0,
                    "held_by_jobs": [],
                    "held_job_count": 0,
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
                on_hand = _q4(stock.qty_kg)
                hold = held.get((str(stock.location_id), str(code.id)))
                held_qty = min(on_hand, hold["qty"]) if hold else Decimal("0")
                free = max(Decimal("0"), on_hand - held_qty)
                if hold and hold["qty"] > 0 and (can_allocate or transfer_required):
                    if free <= 0:
                        eligibility_status, can_allocate, transfer_required = "HELD", False, False
                        reason = f"All {_kg(on_hand)} kg is spoken for: {cls._held_text(hold)}."
                    else:
                        reason = f"{reason} {_kg(free)} kg free; {cls._held_text(hold)}."
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
                    "available_qty_kg": float(free),
                    "on_hand_qty_kg": float(on_hand),
                    "held_qty_kg": float(hold["qty"]) if hold else 0.0,
                    "held_by_jobs": list(hold["jobs"][:HELD_JOBS_SHOWN]) if hold else [],
                    "held_job_count": len(hold["jobs"]) if hold else 0,
                    "location_id": str(stock.location_id),
                    "location_name": stock.location.name if stock.location else "",
                    "plant_id": str(stock.plant_id),
                    "plant_name": stock.plant.name if stock.plant else "",
                    "allocation_scope": allocation_scope,
                    "can_allocate": can_allocate,
                    "transfer_required": transfer_required,
                })
        return by_material

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
        exclude_job_id=None,
    ):
        """
        Check a WCM code split against free stock: on hand less what other open jobs were issued and have
        not used. ``exclude_job_id`` is the job being issued (a re-issue does not compete with itself).
        """
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
        # Read after the balance rows are locked, so a parallel issue of the same code is already visible.
        held = cls.held_by_open_jobs([material.pk], exclude_job_id=exclude_job_id)
        for source_key, qty in allocated_by_source_code.items():
            available = available_by_source_code[source_key]
            code_label = code_labels.get(source_key[1], "Selected code")
            hold = held.get(source_key)
            free = max(Decimal("0"), available - hold["qty"]) if hold else available
            if qty > free and hold and hold["qty"] > 0:
                raise GranuleStockConflict(
                    f"{code_label} for {material.name}: {qty} kg asked, {_kg(available)} kg in the store but "
                    f"{cls._held_text(hold)}. Free to issue: {_kg(free)} kg. Pick another code or split it."
                )
            if qty > available:
                raise GranuleStockConflict(
                    f"{code_label} stock changed: requested {qty} kg, only {available} kg remains at that source."
                )
        return dict(allocated_by_source_code)

    @classmethod
    def short_code_message(cls, *, job, material, code_id, needed_qty, location_id):
        """
        Plain words for output that needs more of an issued code than the store holds, with what to do and the
        codes that are free instead. None when the code is not short (the caller keeps its own error).
        """
        needed = _q4(needed_qty)
        on_hand = InventoryBulk.objects.filter(
            material_id=material.pk, granule_code_id=code_id, location_id=location_id, qty_kg__gt=0,
        ).aggregate(total=Sum("qty_kg")).get("total") or Decimal("0")
        if _q4(on_hand) >= needed:
            return None
        code = GranuleQualityCode.objects.filter(id=code_id).values_list("code", flat=True).first() or "the issued code"
        location = InventoryLocation.objects.filter(id=location_id).only("name", "plant_id").first()
        store = location.name if location else "the store"
        free_codes = [
            option for option in cls.options(
                material,
                issue_location_id=location_id,
                issue_plant_id=getattr(location, "plant_id", None),
                exclude_job_id=job.id,
            )
            if option["can_allocate"] and option["available_qty_kg"] > 0 and option["granule_code_id"] != str(code_id)
        ]
        free_codes.sort(key=lambda option: option["available_qty_kg"], reverse=True)
        free_text = ", ".join(f"{option['code']} {_kg(option['available_qty_kg'])} kg" for option in free_codes[:3])
        return (
            f"{material.name}: this output needs {_kg(needed)} kg of code {code}, but {store} has only "
            f"{_kg(on_hand)} kg of {code}. Ask the WCM to change the code split for this job "
            f"(Work center · Issue · Change codes){f'; free now: {free_text}' if free_text else ''}. "
            f"Or the store must first receive the missing {code}."
        )
