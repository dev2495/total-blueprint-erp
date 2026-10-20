"""Seed demo stock and sales orders on top of the live product masters (local stacks only).

Run after ``seed_local_live_masters`` so the live product masters, films, granules, inks and
packaging exist locally. This command then adds:

* a few synthetic demo customers (invented names, code prefix ``DEMO-``);
* opening stock for what those masters consume: purchased film rolls, granules for the
  extrusion recipes, inks, adhesive and solvent, packaging and purchased add-ons;
* demo sales orders on the live masters, built like the order composer builds them and
  saved through ``SalesOrderService`` exactly as the create-order API does (placed orders go
  to the planner, the rest stay as drafts).

It never reads production data and refuses to run on a production settings profile. It is
safe to re-run: customers and orders are matched by code / order name, and stock is added
once (rolls are labelled ``LIVE-DEMO-``).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal as D

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.factory.models import Plant
from apps.inventory.models import InventoryLocation, InventoryMaterial, InventoryRoll
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import ProductMaster
from apps.sales.models import Customer, SalesOrder
from apps.sales.services.order_service import SalesOrderService

ROLL_PREFIX = "LIVE-DEMO-"


def film_cost_per_kg(material) -> str:
    """A typical local purchase cost, so challan and stock values are not zero on demo rolls."""
    code = f"{getattr(material, 'code', '')} {getattr(material, 'name', '')}".upper()
    if "MET" in code:
        return "182.00"
    if "BOPP" in code:
        return "148.00"
    if "PET" in code or "POLY" in code:
        return "156.00"
    if "NY" in code:
        return "310.00"
    return "128.00"
STOCK_REFERENCE = "local demo opening stock"
ORDER_PREFIX = "DEMO LIVE · "

CUSTOMERS = [
    ("WF", "Walkthrough Foods Pvt Ltd", "Plot 12, GIDC Vatva, Ahmedabad", "Warehouse 2, Changodar"),
    ("SNS", "Shree Namkeen & Snacks", "Rakhial Road, Ahmedabad", "Rakhial Road, Ahmedabad"),
    ("MDF", "Mahadev Dry Fruits", "Kalupur, Ahmedabad", "Kalupur, Ahmedabad"),
    ("GEO", "Gujarat E-Commerce Logistics", "Aslali, Ahmedabad", "Aslali hub"),
    ("ANN", "Annapurna Masala Udyog", "Odhav, Ahmedabad", "Odhav, Ahmedabad"),
    ("PRM", "Premium Tea Traders", "Naroda, Ahmedabad", "Naroda, Ahmedabad"),
    ("RKS", "Rajkot Kitchen Spices", "Aji GIDC, Rajkot", "Aji GIDC, Rajkot"),
    ("SFC", "Surat Fashion Couriers", "Udhna Magdalla Road, Surat", "Sachin GIDC, Surat"),
    ("VHP", "Vadodara Home Products", "Makarpura GIDC, Vadodara", "Makarpura GIDC, Vadodara"),
    ("BKB", "Baroda Bakers Co-op", "Alkapuri, Vadodara", "Alkapuri, Vadodara"),
]

# (order name, customer key, place it?, due in days, remarks, lines)
# line = (master code, size index, qty, price, extra) — qty/price are per piece; sizes sold by the
# kilo get a kilo quantity and rate instead (extra "kg" = (qty, rate) overrides the default).
# extra may also carry "thickness", "addon", "line_name".
ORDERS = [
    ("Namkeen 2-ply printed pouch", "SNS", True, 12, "", [
        ("3-SIDE-SEAL-POUCH-2PLY-PRT", 0, 25000, "2.85", {}),
    ]),
    ("Courier bags · two sizes", "GEO", True, 7, "Pack 500 per bundle", [
        ("COURIER-BAG-PLAN-V5", 0, 50000, "1.10", {}),
        ("COURIER-BAG-PLAN-V5", 3, 30000, "1.35", {}),
    ]),
    ("Silver BOPP bags", "WF", True, 10, "", [
        ("SILVER-BOPP-BAG-PLN-V20", 0, 30000, "0.95", {}),
    ]),
    ("Flexo side-seal bags", "RKS", True, 9, "", [
        ("FLEXO-PRT-SIDE-SEAL-V2", 0, 20000, "1.40", {}),
    ]),
    ("Roto bottom-seal bags", "VHP", True, 14, "", [
        ("ROTO-PRT-BOTTOM-SEALING-V2", 0, 15000, "1.75", {}),
    ]),
    ("Mono LD tubing", "ANN", True, 6, "", [
        ("LD-MONO-V2", 0, 800, "165", {}),
    ]),
    ("Multilayer sheet roll", "PRM", True, 8, "", [
        ("MULTILAYER-SHEET-V30", 0, 1200, "172", {"thickness": 60}),
    ]),
    ("Plain 2-ply pouch", "MDF", True, 11, "", [
        ("3-SIDE-SEAL-PLAIN-POUCH-2-PLY-V3", 0, 40000, "1.20", {}),
    ]),
    ("Laminated roto side-seal bag", "BKB", True, 15, "", [
        ("ROTO-SIDE-SEAL-BAG-PRT", 0, 18000, "2.40", {"addon": True}),
    ]),
    ("2-ply roto sheet", "SNS", True, 13, "", [
        ("2-PLY-SHEET-ROTO-PRT-3", 0, 22000, "2.10", {}),
    ]),
    ("Centre-seal printed pouch", "WF", False, 16, "Waiting for the customer's final artwork", [
        ("CENTER-SEALING-POUCH-PRT-V2", 0, 35000, "1.95", {}),
    ]),
    ("BOPP flexo printed bags", "SFC", False, 18, "", [
        ("BOPP-FLEXO-PRT-V4", 0, 25000, "1.15", {}),
    ]),
    ("Courier bags · printed mix", "SFC", False, 20, "", [
        ("COURIER-BAG-FLEXO-PRINT", 0, 40000, "1.30", {}),
        ("COURIER_ROTO-PRT", 0, 20000, "1.60", {}),
    ]),
]


class Command(BaseCommand):
    help = "Seed demo customers, opening stock and sales orders on the live masters (local only)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Build everything, report, then roll back.")
        parser.add_argument("--plant", default="01", help="Plant that holds the opening stock (default 01, the live floor).")

    def handle(self, *args, **options):
        if getattr(settings, "IS_PRODUCTION", False) or str(getattr(settings, "DJANGO_ENV", "")).lower().startswith("prod"):
            raise CommandError("Refusing to seed demo data on a production settings profile.")
        self.plant = Plant.objects.filter(code=options["plant"]).first()
        if self.plant is None:
            raise CommandError(f"Plant {options['plant']} not found. Run seed_local_live_masters first.")
        self.report: list[str] = []
        try:
            with transaction.atomic():
                self._customers()
                self._stock()
                self._work_center_chemistry()
                self._orders()
                self._order_film_rolls()
                self._film_costs()
                if options["dry_run"]:
                    raise _DryRun()
        except _DryRun:
            self.report.append("dry run: rolled back")
        for line in self.report:
            self.stdout.write(line)

    # ------------------------------------------------------------------ customers
    def _customers(self):
        self.customers = {}
        created = 0
        for key, name, bill, ship in CUSTOMERS:
            cust, made = Customer.objects.get_or_create(
                code=f"DEMO-{key}",
                defaults={"name": name, "billing_address": bill, "shipping_address": ship, "mailing_state": "Gujarat", "mailing_country": "India"},
            )
            created += int(made)
            self.customers[key] = cust
        self.report.append(f"customers: {created} created, {len(CUSTOMERS) - created} already local")

    # ------------------------------------------------------------------ stock
    def _film_costs(self):
        """Older demo rolls were made without a cost; give them the same typical cost."""
        fixed = 0
        for roll in InventoryRoll.objects.filter(label_id__startswith=ROLL_PREFIX).select_related("material"):
            meta = dict(roll.meta_json or {})
            if meta.get("unit_cost_per_kg"):
                continue
            meta["unit_cost_per_kg"] = film_cost_per_kg(roll.material)
            InventoryRoll.objects.filter(id=roll.id).update(meta_json=meta)
            fixed += 1
        self.report.append(f"film roll costs: {fixed} demo rolls given a purchase cost")

    def _location(self, kind: str) -> InventoryLocation:
        found = InventoryLocation.objects.filter(plant=self.plant, type=kind).order_by("-is_system", "code").first()
        return found or InventoryLocation.objects.create(plant=self.plant, code=f"{kind}-{self.plant.code}", name=f"{kind} {self.plant.code}", type=kind, is_system=True)

    def _stock(self):
        if InventoryRoll.objects.filter(label_id__startswith=ROLL_PREFIX).exists():
            self.report.append("stock: already added (rolls labelled LIVE-DEMO- exist)")
            return
        rm = self._location("RM")
        masters = list(ProductMaster.objects.filter(active=True))

        # Purchased films the masters laminate or print on: a few rolls in two widths.
        films: dict[str, tuple[InventoryMaterial, D]] = {}
        for pm in masters:
            for layer in pm.layer_template or []:
                mat = self._material(layer.get("film_variant_code"), category="FILM_VARIANT")
                micron = D(str(layer.get("thickness_micron") or 0)).quantize(D("0.1"))
                if mat is None or mat.is_extrudable or not mat.is_purchasable or micron <= 0:
                    continue
                films.setdefault(f"{mat.code}|{micron}", (mat, micron))
        rolls = 0
        for index, (mat, micron) in enumerate(sorted(films.values(), key=lambda x: (x[0].code, x[1]))):
            for width in (1000, 1250):
                for n in range(1, 3):
                    kg = D(320 + 40 * ((index + n) % 4))
                    InventoryRoll.objects.create(
                        label_id=f"{ROLL_PREFIX}{mat.code}-{int(micron)}-{width}-{n}",
                        material=mat, thickness_micron=micron, width_mm=D(width), plant=self.plant, location=rm,
                        original_weight_kg=kg, weight_kg=kg, net_weight_kg=kg, status="AVAILABLE",
                        stage_index=0, current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL", "unit_cost_per_kg": film_cost_per_kg(mat)},
                    )
                    rolls += 1

        def bulk(category: str, qty: str, cost: str, **filters) -> int:
            count = 0
            for mat in InventoryMaterial.objects.filter(category=category, **filters).exclude(status="ARCHIVED"):
                BulkService.add_bulk(material_id=mat.id, qty=D(qty), plant_id=self.plant.id, location_id=rm.id, cost=D(cost), reference=STOCK_REFERENCE)
                count += 1
            return count

        granules = bulk("GRANULE", "3000", "118")
        inks = bulk("INK", "60", "640")
        chemistry = bulk("ADHESIVE", "400", "410") + bulk("SOLVENT", "400", "95")
        addons = bulk("ADDON", "5000", "0.6", addon_is_purchased=True)

        packaging = 0
        for mat in InventoryMaterial.objects.filter(category="PACKAGING").exclude(status="ARCHIVED"):
            qty = D("300") if (mat.base_uom or "").upper() == "KG" else D("4000")
            PackagingService.add_packaging_stock(material_id=mat.id, qty=qty, location_id=rm.id, cost=D("2"), reference=STOCK_REFERENCE)
            packaging += 1
        self.report.append(
            f"stock in {self.plant.code}/{rm.code}: {rolls} film rolls ({len(films)} film/micron pairs), {granules} granules, "
            f"{inks} inks, {chemistry} adhesive/solvent, {addons} purchased add-ons, {packaging} packaging materials"
        )

    def _work_center_chemistry(self):
        """Machines draw adhesive, solvent and ink from their work centre's own location (stores issue
        them there), so each work centre that is not the store itself gets a working stock."""
        from apps.factory.models import WorkCenter

        from apps.inventory.models import BulkTransaction

        rm = self._location("RM")
        locations = {wc.default_wip_location for wc in WorkCenter.objects.filter(plant=self.plant).select_related("default_wip_location")
                     if wc.default_wip_location_id and wc.default_wip_location_id != rm.id}
        if BulkTransaction.objects.filter(location__in=locations, reference=STOCK_REFERENCE).exists():
            self.report.append("work-centre stock: already added")
            return
        materials = list(InventoryMaterial.objects.filter(category__in=["ADHESIVE", "SOLVENT", "INK"]).exclude(status="ARCHIVED"))
        for location in locations:
            for mat in materials:
                qty = D("40") if mat.category == "INK" else D("250")
                cost = D("640") if mat.category == "INK" else D("410") if mat.category == "ADHESIVE" else D("95")
                BulkService.add_bulk(material_id=mat.id, qty=qty, plant_id=self.plant.id, location_id=location.id, cost=cost, reference=STOCK_REFERENCE)
        self.report.append(f"work-centre stock: adhesive, solvent and {sum(1 for m in materials if m.category == 'INK')} inks at {len(locations)} work-centre location(s)")

    def _order_film_rolls(self):
        """Stores buy film at the web width an order needs: for every DEMO LIVE line, two rolls of
        each bought-in film layer at the line's planned web width (roll pickers refuse rolls >10 % wider)."""
        from apps.sales.models import SalesOrderItem

        rm = self._location("RM")
        made = 0
        items = SalesOrderItem.objects.filter(sales_order__order_name__startswith=ORDER_PREFIX).select_related("product_master", "sales_order")
        for item in items:
            width = D(str(item.planned_parent_width_mm or 0))
            if width <= 0 or item.product_master is None:
                continue
            layers = item.product_master.layer_template or []
            for index, layer in enumerate(layers, start=1):
                mat = self._material(layer.get("film_variant_code"), category="FILM_VARIANT")
                micron = D(str(layer.get("thickness_micron") or 0)).quantize(D("0.1"))
                if mat is None or mat.is_extrudable or not mat.is_purchasable or micron <= 0:
                    continue
                share = micron / sum((D(str(l.get("thickness_micron") or 0)) for l in layers), D("0")) if layers else D("1")
                kg = max(D("120"), (D(str(item.total_weight_kg or 0)) * share * D("0.65")).quantize(D("1")))
                for n in (1, 2):
                    label = f"{ROLL_PREFIX}{item.sales_order.order_number}-L{index}-{n}"
                    if InventoryRoll.objects.filter(label_id=label).exists():
                        continue
                    InventoryRoll.objects.create(
                        label_id=label, material=mat, thickness_micron=micron, width_mm=width, plant=self.plant, location=rm,
                        original_weight_kg=kg, weight_kg=kg, net_weight_kg=kg, status="AVAILABLE",
                        stage_index=0, current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL", "unit_cost_per_kg": film_cost_per_kg(mat)},
                    )
                    made += 1
        self.report.append(f"order-width film rolls: {made} added for DEMO LIVE lines")

    def _material(self, code, *, category=None):
        if not code:
            return None
        qs = InventoryMaterial.objects.filter(code__iexact=str(code).strip())
        if category:
            qs = qs.filter(category=category)
        found = qs.first()
        if found is None and " " in str(code):
            found = InventoryMaterial.objects.filter(code__iexact=str(code).strip().replace(" ", "-")).first()
        return found

    # ------------------------------------------------------------------ orders
    def _orders(self):
        placed = drafts = skipped = 0
        for name, cust_key, place, due_days, remarks, lines in ORDERS:
            order_name = f"{ORDER_PREFIX}{name}"
            if SalesOrder.objects.filter(order_name=order_name).exists():
                skipped += 1
                continue
            customer = self.customers[cust_key]
            try:
                items = [self._line(*line) for line in lines]
                with transaction.atomic():
                    # Same two calls the create-order API makes (views_orders.SalesOrderViewSet.create).
                    order = SalesOrderService.create_sales_order({
                        "customer": str(customer.id),
                        "ship_to_customer": str(customer.id),
                        "order_name": order_name,
                        "delivery_date": (date.today() + timedelta(days=due_days)).isoformat(),
                        "remarks": remarks,
                        "items": items,
                    })
                    if place:
                        order = SalesOrderService.confirm_sales_order(order.id)
            except Exception as exc:  # report and keep seeding the rest
                self.report.append(f"  ! {order_name}: {exc}")
                continue
            if place:
                placed += 1
            else:
                drafts += 1
            self.report.append(f"  {order.order_number or order.id} · {order_name} · {order.status} · {len(items)} line(s)")
        self.report.append(f"orders: {placed} placed, {drafts} drafts, {skipped} already local")

    def _line(self, master_code: str, size_index: int, qty: int, price: str, extra: dict) -> dict:
        master = ProductMaster.objects.filter(code=master_code, active=True).first()
        if master is None:
            raise CommandError(f"product master {master_code} is not local")
        sizes = list(master.sizes.filter(active=True).order_by("sort_order", "code"))
        if not sizes:
            raise CommandError(f"{master_code} has no active sizes")
        size = sizes[min(size_index, len(sizes) - 1)]
        fixed = master.fixed_attributes or {}
        is_roll = (master.product_kind or "").upper() in ("ROLL", "POD")
        uom = "KG" if is_roll else (size.qty_uom or "PCS")
        if uom == "KG" and not is_roll:
            # Pieces → kilos at roughly 20 g a bag, rounded to the nearest 10 kg; printed film costs more a kilo.
            kg_qty, kg_rate = extra.get("kg") or (max(150, round(qty / 50 / 10) * 10), "235" if (master.fixed_attributes or {}).get("print_capable") else "192")
            qty, price = kg_qty, kg_rate

        thicknesses, grades = {}, {}
        for i, layer in enumerate(master.layer_template or [], start=1):
            micron = layer.get("thickness_micron") or size.thickness_micron or extra.get("thickness")
            if extra.get("thickness") and not layer.get("thickness_micron"):
                micron = extra["thickness"]
            if micron:
                thicknesses[str(i)] = float(micron)
            if layer.get("default_grade"):
                grades[str(i)] = str(layer["default_grade"]).strip()

        axis_values: dict = {"size": size.code, "layer_thicknesses": thicknesses}
        if grades:
            axis_values["layer_grades"] = grades
        for axis in master.variant_axes or []:
            key = str(axis.get("axis") or "")
            options = axis.get("options") or []
            if key == "artwork_mode" and fixed.get("print_capable"):
                axis_values["artwork_mode"] = "DEFER"
            elif key == "packaging_inner":
                # The composer offers the axis options, else the packaging catalogue filtered by kind.
                kind = (axis.get("master_data_filter") or {}).get("packaging_kind") or "INNER_POUCH"
                pick = options[0] if options else InventoryMaterial.objects.filter(
                    category="PACKAGING", packaging_kind=kind).exclude(status="ARCHIVED").order_by("code").values_list("code", flat=True).first()
                if pick:
                    axis_values["packaging_inner"] = pick
            elif key == "addons" and extra.get("addon") and options:
                axis_values["addons"] = [options[0]]

        if fixed.get("print_capable"):
            print_type = str(fixed.get("print_type") or "FLEXO").upper()
            printing = {
                "enabled": True,
                "print_type": print_type,
                "film_type": _film_type(size, fixed),
                "defer_artwork_to_planner": True,
                "artwork_id": None,
                "cylinder_required": print_type == "ROTO",
            }
        else:
            printing = {"enabled": False}

        return {
            "product_master": str(master.id),
            "line_name": extra.get("line_name") or f"{master.name} · {size.label or size.code}",
            "axis_values": axis_values,
            "qty_value": qty,
            "qty_uom": uom,
            "price_basis": uom,
            "unit_price": price,
            "printing": printing,
            "issue_policy_overrides": [],
            "remarks": "",
        }


def _film_type(size, fixed: dict) -> str:
    """Same rule as the composer's filmTypeForSize: the size's stock form decides sheet or tubing."""
    stock = str(size.stock_form or (size.geometry_config or {}).get("roll_form") or size.width_basis or "").upper()
    if any(word in stock for word in ("TUBE", "TUBING", "LAYFLAT")):
        return "TUBING"
    if any(word in stock for word in ("SHEET", "OPEN", "FOLDED")):
        return "SHEET"
    return str(fixed.get("film_type") or "SHEET").upper()


class _DryRun(Exception):
    pass
