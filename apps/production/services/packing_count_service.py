from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.inventory.models import InventoryLocation, PackagingStock, PackagingTransaction
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial
from apps.production.models import FinishedGoodsBatch, PackingUnit, RollDispatchPackRecord


QTY_QUANT = Decimal("0.0001")
AUTO_POSTED_PACKING_KINDS = {"INNER_POUCH", "GONNY"}


def q4(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(QTY_QUANT, rounding=ROUND_HALF_UP)


class PackingCountService:
    """
    Timestamped packing material count.

    Operators enter closing physical stock for packing materials. Negative
    variance is treated as packing consumption and allocated to same-day packing
    orders only when the material is allowed by that order's packaging snapshot.
    """

    @staticmethod
    def _is_manual_count_kind(kind: str) -> bool:
        return True

    @staticmethod
    def _virtual_stock_id(*, material_id: str, location_id: str) -> str:
        return f"virtual:{material_id}:{location_id}"

    @staticmethod
    def _decode_virtual_stock_id(stock_id: str) -> tuple[str, str] | None:
        parts = str(stock_id or "").split(":")
        if len(parts) != 3 or parts[0] != "virtual":
            return None
        return parts[1], parts[2]

    @classmethod
    def _stock_row(cls, *, stock=None, material=None, location=None, book_qty=None, avg_cost=None, is_virtual=False):
        material = material or stock.material
        location = location or stock.location
        plant = getattr(location, "plant", None) or getattr(stock, "plant", None)
        return {
            "id": cls._virtual_stock_id(material_id=str(material.id), location_id=str(location.id)) if is_virtual else str(stock.id),
            "material_id": str(material.id),
            "material_code": material.code,
            "material_name": material.name,
            "packaging_kind": material.packaging_kind or "",
            "base_uom": material.base_uom or "",
            "plant_id": str(getattr(plant, "id", "") or ""),
            "plant_name": getattr(plant, "name", "") or "",
            "location_id": str(location.id),
            "location_name": location.name,
            "book_qty": float(book_qty if book_qty is not None else (stock.qty or 0)),
            "avg_cost": float(avg_cost if avg_cost is not None else (stock.avg_cost or 0)),
            "is_virtual": bool(is_virtual),
        }

    @classmethod
    def _resolve_stock_for_count(cls, stock_id: str) -> PackagingStock:
        virtual = cls._decode_virtual_stock_id(stock_id)
        if not virtual:
            return PackagingStock.objects.select_for_update().select_related("material", "location").get(id=stock_id)

        material_id, location_id = virtual
        material = InventoryMaterial.objects.get(id=material_id)
        if str(material.category or "").upper() != "PACKAGING":
            raise ValueError(f"{material.code} is not a packaging material.")
        location = InventoryLocation.objects.select_related("plant").get(id=location_id)
        stock, _ = PackagingStock.objects.select_for_update().get_or_create(
            material=material,
            plant=location.plant,
            location=location,
            defaults={"qty": Decimal("0"), "avg_cost": Decimal("0")},
        )
        return stock

    @staticmethod
    def resolve_count_date(value=None):
        if value:
            parsed = parse_date(str(value))
            if parsed:
                return parsed
        return timezone.localdate()

    @staticmethod
    def resolve_counted_at(value=None):
        if value:
            parsed = parse_datetime(str(value))
            if parsed:
                if timezone.is_naive(parsed):
                    parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
                return parsed
            parsed_date = parse_date(str(value))
            if parsed_date:
                return timezone.make_aware(datetime.combine(parsed_date, time.max), timezone.get_current_timezone())
        return timezone.now()

    @staticmethod
    def day_bounds(count_date):
        tz = timezone.get_current_timezone()
        start = timezone.make_aware(datetime.combine(count_date, time.min), tz)
        return start, start + timedelta(days=1)

    @staticmethod
    def _snapshot_allowed_material_ids(snapshot) -> set[str]:
        payload = snapshot if isinstance(snapshot, dict) else {}
        allowed: set[str] = set()
        for key in ("primary_inner_pack", "final_outer_pack", "secondary_gonny"):
            cfg = payload.get(key) if isinstance(payload.get(key), dict) else {}
            material_id = str(cfg.get("material_id") or "").strip()
            if bool(cfg.get("enabled", True)) and material_id:
                allowed.add(material_id)

        roll_cfg = payload.get("roll_dispatch_pack") if isinstance(payload.get("roll_dispatch_pack"), dict) else {}
        for line in roll_cfg.get("lines") or []:
            if isinstance(line, dict) and str(line.get("material_id") or "").strip():
                allowed.add(str(line.get("material_id")).strip())

        for line in payload.get("packaging_lines") or []:
            if isinstance(line, dict) and str(line.get("material_id") or "").strip():
                allowed.add(str(line.get("material_id")).strip())
        return allowed

    @classmethod
    def _sales_line_allows_material(cls, sales_order_item, material_id: str) -> bool:
        if not sales_order_item:
            return False
        allowed = cls._snapshot_allowed_material_ids(getattr(sales_order_item, "packaging_snapshot", {}) or {})
        return str(material_id) in allowed

    @classmethod
    def throughput_rows(cls, *, count_date=None, location_id=None, start_at=None, end_at=None):
        count_date = cls.resolve_count_date(count_date)
        start, end = cls.day_bounds(count_date)
        if start_at:
            start = start_at
        if end_at:
            end = end_at
        buckets: dict[tuple[str, str], dict] = {}

        def add(sales_order_item, location, units, source, label, marks=None):
            if not sales_order_item or not location:
                return
            key = (str(sales_order_item.id), str(location.id))
            order = getattr(sales_order_item, "sales_order", None)
            row = buckets.setdefault(
                key,
                {
                    "sales_order_item_id": str(sales_order_item.id),
                    "sales_order_id": str(getattr(order, "id", "") or ""),
                    "order_number": getattr(order, "order_number", "") or "",
                    "customer_name": getattr(order, "customer_name", "") or "",
                    "location_id": str(location.id),
                    "location_name": getattr(location, "name", "") or "",
                    "units": Decimal("0"),
                    "sources": [],
                    "_sales_order_item": sales_order_item,
                    "_plant_id": str(getattr(location, "plant_id", "") or ""),
                    "_marks": {},
                },
            )
            row["units"] += Decimal(str(units or 0))
            for mark in marks or []:
                if not isinstance(mark, dict):
                    continue
                material_id = str(mark.get("material_id") or "").strip()
                if not material_id:
                    continue
                try:
                    qty = Decimal(str(mark.get("qty") or 0))
                except Exception:
                    qty = Decimal("0")
                row["_marks"][material_id] = row["_marks"].get(material_id, Decimal("0")) + max(qty, Decimal("0"))
            if len(row["sources"]) < 12:
                row["sources"].append({"source": source, "label": label, "units": float(Decimal(str(units or 0)))})

        gonnies = (
            PackingUnit.objects.select_related("sales_order_item__sales_order", "location")
            .filter(created_at__gte=start, created_at__lt=end, sales_order_item__isnull=False)
        )
        if location_id:
            gonnies = gonnies.filter(location_id=location_id)
        for gonny in gonnies:
            units = gonny.primary_pack_count if gonny.content_mode == "PRIMARY_PACKS" and gonny.primary_pack_count else gonny.qty_pcs
            meta = gonny.meta_json if isinstance(gonny.meta_json, dict) else {}
            marks = [
                *[row for row in (meta.get("packaging_marks") or []) if str((row or {}).get("capture_mode") or "") == "MARKED_FOR_COUNT"],
                *(meta.get("seal_extras") or []),
                *(meta.get("release_extras") or []),
            ]
            add(gonny.sales_order_item, gonny.location, units or 1, "GONNY", gonny.label_id, marks)

        roll_records = (
            RollDispatchPackRecord.objects.select_related("sales_order_item__sales_order", "roll__location")
            .filter(packed_at__gte=start, packed_at__lt=end, sales_order_item__isnull=False)
        )
        if location_id:
            roll_records = roll_records.filter(roll__location_id=location_id)
        for record in roll_records:
            add(record.sales_order_item, record.roll.location, 1, "ROLL", getattr(record.roll, "label_id", "ROLL"), record.lines or [])

        # Inner pouches the machine could not take off stock (stock book gap) are marks for
        # this count: no packed units of their own, so other materials' allocation is unchanged.
        left_for_count = (
            FinishedGoodsBatch.objects.select_related("sales_order_item__sales_order", "location")
            .filter(created_at__gte=start, created_at__lt=end, sales_order_item__isnull=False)
            .filter(meta_json__primary_inner_pack__has_key="left_for_count")
        )
        if location_id:
            left_for_count = left_for_count.filter(location_id=location_id)
        for batch in left_for_count:
            primary = (batch.meta_json or {}).get("primary_inner_pack") or {}
            packs = Decimal(str(primary.get("left_for_count") or 0))
            if packs <= 0 or not primary.get("material_id"):
                continue
            mark = {"material_id": primary["material_id"], "qty": float(packs), "capture_mode": "MARKED_FOR_COUNT", "basis": "INNER_POUCH_LEFT_FOR_COUNT"}
            add(batch.sales_order_item, batch.location, 0, "INNER_POUCH", batch.batch_number, [mark])

        rows = []
        for row in buckets.values():
            rows.append({key: value for key, value in row.items() if not key.startswith("_")} | {"units": float(row["units"])})
        rows.sort(key=lambda item: (item["order_number"], item["location_name"]))
        return rows, buckets

    @classmethod
    def snapshot(cls, *, count_date=None, counted_at=None, plant_id=None, location_id=None):
        counted_at = cls.resolve_counted_at(counted_at or count_date)
        count_date = timezone.localtime(counted_at).date()
        stocks = (
            PackagingStock.objects.select_related("material", "location", "plant")
            .order_by("material__code", "location__name")
        )
        if plant_id:
            stocks = stocks.filter(plant_id=plant_id)
        if location_id:
            stocks = stocks.filter(location_id=location_id)

        throughput, _ = cls.throughput_rows(count_date=count_date, location_id=location_id, end_at=counted_at)
        eod_allocation = cls.eod_allocation_metrics(
            count_date=count_date,
            plant_id=plant_id,
            location_id=location_id,
        )
        stock_rows = []
        existing_material_ids = set()
        for stock in stocks:
            existing_material_ids.add(str(stock.material_id))
            stock_rows.append(cls._stock_row(stock=stock))

        if location_id:
            location = InventoryLocation.objects.select_related("plant").get(id=location_id)
            manual_materials = (
                InventoryMaterial.objects.filter(category="PACKAGING", status="ACTIVE")
                .order_by("packaging_kind", "code")
            )
            for material in manual_materials:
                if str(material.id) in existing_material_ids:
                    continue
                if plant_id and str(location.plant_id) != str(plant_id):
                    continue
                stock_rows.append(
                    cls._stock_row(
                        material=material,
                        location=location,
                        book_qty=Decimal("0"),
                        avg_cost=Decimal("0"),
                        is_virtual=True,
                    )
                )
        stock_rows.sort(key=lambda item: (item["packaging_kind"], item["material_code"], item["location_name"]))
        return {
            "count_date": count_date.isoformat(),
            "counted_at": counted_at.isoformat(),
            "stocks": stock_rows,
            "throughput": throughput,
            "totals": {
                "materials": len(stock_rows),
                "throughput_orders": len(throughput),
                "book_qty": float(sum((q4(row["book_qty"]) for row in stock_rows), Decimal("0"))),
            },
            "eod_allocation": eod_allocation,
        }

    @classmethod
    def eod_allocation_metrics(cls, *, count_date=None, plant_id=None, location_id=None):
        count_date = cls.resolve_count_date(count_date)
        start, end = cls.day_bounds(count_date)
        transactions = (
            PackagingTransaction.objects.select_related("material", "location", "sales_order_item__sales_order")
            .filter(created_at__gte=start, created_at__lt=end, reference__startswith=f"PACKING_EOD_COUNT:{count_date.isoformat()}:")
            .order_by("-created_at")
        )
        if plant_id:
            transactions = transactions.filter(location__plant_id=plant_id)
        if location_id:
            transactions = transactions.filter(location_id=location_id)

        sessions: set[str] = set()
        orders: set[str] = set()
        consumed_qty = Decimal("0")
        mapped_qty = Decimal("0")
        unassigned_qty = Decimal("0")
        tx_count = 0
        material_codes: dict[str, Decimal] = defaultdict(Decimal)
        transaction_rows = []

        for tx in transactions:
            meta = tx.meta_json if isinstance(tx.meta_json, dict) else {}
            session = str(meta.get("packing_count_session") or "").strip()
            if session:
                sessions.add(session)
            if tx.type not in {"CONSUME", "COUNT_SHORT"}:
                continue

            qty = abs(q4(tx.qty))
            consumed_qty += qty
            tx_count += 1
            material_codes[tx.material.code] += qty

            order_number = (
                getattr(getattr(tx.sales_order_item, "sales_order", None), "order_number", "")
                or str(meta.get("allocated_order_number") or "").strip()
            )
            transaction_rows.append(
                {
                    "id": str(tx.id),
                    "created_at": tx.created_at.isoformat() if tx.created_at else None,
                    "session": session,
                    "reference": tx.reference or "",
                    "type": tx.type,
                    "material_code": tx.material.code if tx.material else "",
                    "material_name": tx.material.name if tx.material else "",
                    "location_name": tx.location.name if tx.location else "",
                    "qty": float(tx.qty or 0),
                    "uom": getattr(tx.material, "base_uom", "") if tx.material else "",
                    "order_number": order_number,
                    "allocation_mode": str(meta.get("allocation_mode") or ""),
                    "system_qty_before": meta.get("system_qty_before"),
                    "counted_qty": meta.get("counted_qty"),
                    "delta_qty": meta.get("delta_qty"),
                }
            )
            if order_number:
                orders.add(order_number)
                mapped_qty += qty
            else:
                unassigned_qty += qty

        top_materials = [
            {"material_code": code, "qty": float(qty)}
            for code, qty in sorted(material_codes.items(), key=lambda item: item[1], reverse=True)[:8]
        ]
        return {
            "date": count_date.isoformat(),
            "sessions": len(sessions),
            "transactions": tx_count,
            "transaction_count": tx_count,
            "consumed_qty": float(consumed_qty),
            "mapped_qty": float(mapped_qty),
            "mapped_orders": len(orders),
            "unassigned_qty": float(unassigned_qty),
            "top_materials": top_materials,
            "transaction_rows": transaction_rows[:100],
        }

    @classmethod
    def _allocation_candidates(cls, *, material_id: str, location_id: str, count_date, counted_at=None):
        """Same-day packing that used this material: orders that marked it on a unit, or whose
        packing plan allows it. Packing material often sits in a store away from the packed
        goods, so when nothing was packed at this location the whole plant is used."""

        def pick(buckets):
            marked = []
            allowed = []
            for row in buckets:
                mark_qty = (row.get("_marks") or {}).get(str(material_id), Decimal("0"))
                if mark_qty > 0:
                    marked.append({**row, "units": mark_qty, "allocation_basis": "MARKED"})
                elif row["units"] > 0 and cls._sales_line_allows_material(row.get("_sales_order_item"), material_id):
                    allowed.append({**row, "allocation_basis": "PLAN"})
            return marked or allowed

        _, buckets = cls.throughput_rows(count_date=count_date, location_id=location_id, end_at=counted_at)
        candidates = pick(buckets.values())
        if candidates:
            return candidates
        plant_id = (
            InventoryLocation.objects.filter(id=location_id).values_list("plant_id", flat=True).first()
            if location_id
            else None
        )
        if not plant_id:
            return []
        _, plant_buckets = cls.throughput_rows(count_date=count_date, end_at=counted_at)
        return pick(row for row in plant_buckets.values() if row.get("_plant_id") == str(plant_id))

    PIECE_UOMS = {"PCS", "PC", "NOS", "NO", "PIECE", "PIECES", "UNIT", "UNITS", "EA", "EACH", "SET", "SETS"}

    @classmethod
    def is_piece_uom(cls, uom) -> bool:
        return str(uom or "").strip().upper() in cls.PIECE_UOMS

    @staticmethod
    def split_count_usage(used, weights, *, whole_pieces=False) -> list[Decimal]:
        """Share the counted usage over the order lines that ticked the item, by their ticks.

        Items counted in pieces are shared in whole pieces (largest remainder; ties go to the line
        with more ticks, then the earlier line), so one gonny goes to one line, never 1/14 of a
        gonny to fourteen. A fractional piece left by the count itself stays with the largest share.
        """
        used = q4(used)
        weights = [q4(weight) if weight and weight > 0 else Decimal("0") for weight in weights]
        total = sum(weights, Decimal("0"))
        if used <= 0 or total <= 0:
            return [Decimal("0")] * len(weights)
        if not whole_pieces:
            shares = [q4(used * weight / total) for weight in weights]
            last = max(index for index, weight in enumerate(weights) if weight > 0)
            shares[last] = q4(shares[last] + used - sum(shares, Decimal("0")))
            return shares
        whole_used = Decimal(int(used))
        exact = [whole_used * weight / total for weight in weights]
        shares = [Decimal(int(value)) for value in exact]
        left = int(whole_used - sum(shares, Decimal("0")))
        order = sorted(
            range(len(weights)),
            key=lambda index: (-(exact[index] - shares[index]), -weights[index], index),
        )
        for index in order[:left]:
            shares[index] += 1
        fraction = q4(used - whole_used)
        if fraction > 0:
            biggest = max(range(len(weights)), key=lambda index: (shares[index], weights[index], -index))
            shares[biggest] = q4(shares[biggest] + fraction)
        return [q4(value) for value in shares]

    @classmethod
    @transaction.atomic
    def post_count(cls, *, lines: list[dict], count_date=None, counted_at=None, user=None, notes=""):
        counted_at = cls.resolve_counted_at(counted_at or count_date)
        count_date = timezone.localtime(counted_at).date()
        session_id = f"PKG-EOD-{count_date.isoformat()}-{str(uuid4())[:8].upper()}"
        results = []

        for raw in lines or []:
            stock_id = str(raw.get("stock_id") or raw.get("id") or "").strip()
            if not stock_id:
                continue
            counted_qty = q4(raw.get("counted_qty"))
            stock = cls._resolve_stock_for_count(stock_id)
            system_qty = q4(stock.qty)
            delta = q4(counted_qty - system_qty)
            reference = f"PACKING_EOD_COUNT:{count_date.isoformat()}:{session_id}"
            base_meta = {
                "packing_count_session": session_id,
                "count_date": count_date.isoformat(),
                "counted_at": counted_at.isoformat(),
                "stock_id": str(stock.id),
                "system_qty_before": float(system_qty),
                "counted_qty": float(counted_qty),
                "delta_qty": float(delta),
                "notes": notes,
                "actor": getattr(user, "username", "") if getattr(user, "is_authenticated", False) else "",
            }

            tx_rows = []
            if delta < 0:
                consume_qty = abs(delta)
                candidates = cls._allocation_candidates(
                    material_id=str(stock.material_id),
                    location_id=str(stock.location_id),
                    count_date=count_date,
                    counted_at=counted_at,
                )
                if candidates:
                    shares = cls.split_count_usage(
                        consume_qty,
                        [q4(row["units"]) for row in candidates],
                        whole_pieces=cls.is_piece_uom(stock.material.base_uom),
                    )
                    for row, qty in zip(candidates, shares):
                        if qty <= 0:
                            continue
                        tx = PackagingService.consume_packaging_stock(
                            material_id=str(stock.material_id),
                            qty=qty,
                            location_id=str(stock.location_id),
                            sales_order_item_id=row["sales_order_item_id"],
                            reference=reference,
                            input_uom=stock.material.base_uom,
                            basis="PACKING_EOD_COUNT",
                            meta_json={
                                **base_meta,
                                "allocation_mode": "SAME_DAY_ALLOWED_PACKING_THROUGHPUT",
                                "allocation_basis": row.get("allocation_basis", "PLAN"),
                                "allocation_location_id": row.get("location_id"),
                                "allocated_order_number": row["order_number"],
                                "allocated_units": float(row["units"]),
                                "throughput_sources": row["sources"],
                            },
                        )
                        tx_rows.append({"id": str(tx.id), "type": tx.type, "qty": float(tx.qty), "order_number": row["order_number"]})
                else:
                    tx = PackagingService.consume_packaging_stock(
                        material_id=str(stock.material_id),
                        qty=consume_qty,
                        location_id=str(stock.location_id),
                        reference=reference,
                        input_uom=stock.material.base_uom,
                        basis="PACKING_EOD_COUNT",
                        meta_json={**base_meta, "allocation_mode": "UNASSIGNED_COUNT_SHORT"},
                    )
                    tx.type = "COUNT_SHORT"
                    tx.save(update_fields=["type"])
                    tx_rows.append({"id": str(tx.id), "type": tx.type, "qty": float(tx.qty), "order_number": ""})
            elif delta > 0:
                tx = PackagingService.add_packaging_stock(
                    material_id=str(stock.material_id),
                    qty=delta,
                    location_id=str(stock.location_id),
                    cost=stock.avg_cost or 0,
                    reference=reference,
                    tx_type="COUNT_EXCESS",
                    input_uom=stock.material.base_uom,
                    meta_json={**base_meta, "allocation_mode": "COUNT_EXCESS"},
                )
                tx_rows.append({"id": str(tx.id), "type": tx.type, "qty": float(tx.qty), "order_number": ""})

            results.append(
                {
                    "stock_id": str(stock.id),
                    "material_code": stock.material.code,
                    "location_name": stock.location.name,
                    "system_qty": float(system_qty),
                    "counted_qty": float(counted_qty),
                    "delta_qty": float(delta),
                    "transactions": tx_rows,
                }
            )

        return {
            "session_id": session_id,
            "count_date": count_date.isoformat(),
            "counted_at": counted_at.isoformat(),
            "results": results,
            "posted_transactions": sum(len(row["transactions"]) for row in results),
        }
