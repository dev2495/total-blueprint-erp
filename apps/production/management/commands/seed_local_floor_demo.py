"""
Local demo floor: realistic orders at every stage so the stack can be used end to end.

Configuration (processes, work centres, machines, films, granules, templates) follows the live
catalogue by name; customers, orders and quantities are invented. Everything runs through the real
services (confirm, release, roll allocation, machine start, output logging, step completion,
packing check, dispatch) exactly like the route walkthrough tests, so the data is consistent with
the rules the floor uses. Refuses to run on a production settings profile.

    python manage.py seed_local_floor_demo
"""
from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.artwork.models import Artwork
from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation, InventoryRoll
from apps.inventory.services.bulk_service import BulkService
from apps.inventory.services.packaging_service import PackagingService
from apps.materials.models import InventoryMaterial, WebWidthPolicy
from apps.production.models import FinishedGoodsBatch, ProductionJob, WorkCenterAssignment
from apps.production.services.dispatch_service import FGDispatchService
from apps.production.services.job_services import JobService, WCManagerService
from apps.production.services.operator_service import OperatorService
from apps.production.services.packing_service import PackingService, PackingVerificationService
from apps.production.services.services_execution import ExecutionService
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent, RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import Customer, SalesOrder, SalesOrderItem
from apps.sales.services.order_service import SalesOrderService
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

D = Decimal

# Live process codes (apps.factory.Process.code) and their contracts.
PROCESS_DEFS = {
    "EXT": ("Extrution", "BULK", "ROLL", "CREATE_NEW", {}),
    "PRT": ("Roto Printing", "ROLL", "ROLL", "MODIFY_EXISTING", {"has_artwork": True, "print_capable": True}),
    "Lam": ("Lamination", "ROLL", "ROLL", "MULTI_INPUT_COMBINE", {}),
    "Slt": ("Slitting", "ROLL", "ROLL", "SPLIT", {}),
    "Pch": ("Pouching", "ROLL", "BULK", "NONE", {}),
    "SS": ("Side Sealing", "ROLL", "BULK", "NONE", {}),
    "Bottom": ("Bottom Sealing", "ROLL", "BULK", "NONE", {}),
}

# Live work centres (code, name, plant, processes, machines like live).
WORK_CENTERS = [
    ("MLD", "Multilayer LD Plant", "01", ["EXT"], [("MLD-MC-01", "Mamata machine"), ("MLD-MC-02", "shubham machine 1"), ("MLD-MC-03", "shubham machine 2")]),
    ("PRT- ROTO", "Roto printing", "01", ["PRT"], [("PRT-MC-01", "Polygraph"), ("PRT-MC-02", "Francis"), ("PRT-MC-03", "C Trivedi")]),
    ("Lamination", "Lamination & Slitting Plant", "01", ["Lam", "Slt"], [("LAM-MC-01", "Solventless laminator"), ("LAM-MC-02", "Slitter 1"), ("LAM-MC-03", "Slitter 2")]),
    ("Pouching-1", "Pouching plant", "01", ["Pch"], [("PCH-MC-01", "Mamata pouch 1"), ("PCH-MC-02", "Mamata pouch 2"), ("PCH-MC-03", "Zipper line")]),
    ("SS", "Side Sealing Plant", "01", ["SS"], [("SS-MC-01", "Shree machinery 1"), ("SS-MC-02", "Shree machinery 2")]),
    ("Bottom", "Bottom Sealing plant", "01", ["Bottom"], [("BTM-MC-01", "Bottom seal 1")]),
]

CUSTOMERS = [
    ("WF", "Walkthrough Foods Pvt Ltd", "Plot 12, GIDC Vatva, Ahmedabad", "Warehouse 2, Changodar"),
    ("SNS", "Shree Namkeen & Snacks", "Rakhial Road, Ahmedabad", "Rakhial Road, Ahmedabad"),
    ("MDF", "Mahadev Dry Fruits", "Kalupur, Ahmedabad", "Kalupur, Ahmedabad"),
    ("GEO", "Gujarat E-Commerce Logistics", "Aslali, Ahmedabad", "Aslali hub"),
    ("ANN", "Annapurna Masala Udyog", "Odhav, Ahmedabad", "Odhav, Ahmedabad"),
    ("PRM", "Premium Tea Traders", "Naroda, Ahmedabad", "Naroda, Ahmedabad"),
]


def json_ready(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_ready(v) for v in value]
    return value


class Command(BaseCommand):
    help = "Seed a realistic local demo floor (never on production)."

    def add_arguments(self, parser):
        parser.add_argument("--user", default="admin", help="Username that performs the floor actions (default admin)")

    # ------------------------------------------------------------------ entry
    def handle(self, *args, **options):
        if getattr(settings, "IS_PRODUCTION", False) or str(getattr(settings, "DJANGO_ENV", "")).lower().startswith("prod"):
            raise CommandError("Refusing to seed demo data on a production settings profile.")
        self.user = get_user_model().objects.filter(username=options["user"]).first()
        if self.user is None:
            raise CommandError(f"User {options['user']} not found.")
        self.report: dict = {}
        with transaction.atomic():
            self._config()
            self._materials()
            self._templates()
            self._customers()
        self._orders()
        for key, value in self.report.items():
            self.stdout.write(f"{key}: {value}")

    # ------------------------------------------------------------------ configuration like live
    def _config(self):
        self.plants = {}
        for code, name in (("01", "Unit 01"), ("03", "Unit 03")):
            plant, _ = Plant.objects.get_or_create(code=code, defaults={"name": name})
            self.plants[code] = plant
        self.plant = self.plants["01"]

        def system_location(plant, kind, code, name):
            found = InventoryLocation.objects.filter(plant=plant, type=kind).order_by("-is_system", "code").first()
            return found or InventoryLocation.objects.create(plant=plant, code=code, name=name, type=kind, is_system=True)

        self.loc = {}
        for pcode, plant in self.plants.items():
            self.loc[pcode] = {
                "RM": system_location(plant, "RM", f"RM-{pcode}", f"RM store {pcode}"),
                "WIP": system_location(plant, "WIP", f"WIP-{pcode}", f"WIP {pcode}"),
                "FG": system_location(plant, "FG", f"FG-{pcode}", f"FG store {pcode}"),
            }
        self.pack_store, _ = InventoryLocation.objects.get_or_create(plant=self.plant, code="PKS", defaults={"name": "Packing store", "type": "RM"})

        self.processes = {}
        for code, (name, inp, out, beh, extra) in PROCESS_DEFS.items():
            process, _ = Process.objects.get_or_create(code=code, defaults={"name": name, "input_form": inp, "output_form": out, "roll_behavior": beh, **extra})
            self.processes[code] = process

        self.work_centers = {}
        self.machines = {}
        for code, name, pcode, pcodes, machines in WORK_CENTERS:
            plant = self.plants[pcode]
            wip_loc = self.loc[pcode]["RM"] if "EXT" in pcodes else self.loc[pcode]["WIP"]
            wc, created = WorkCenter.objects.get_or_create(code=code, defaults={"plant": plant, "name": name, "default_wip_location": wip_loc})
            if not created and (wc.plant_id != plant.id or wc.default_wip_location_id != wip_loc.id):
                # One plant for the demo floor: rolls move between work centres without an inter-plant receipt.
                wc.plant = plant
                wc.default_wip_location = wip_loc
                wc.save(update_fields=["plant", "default_wip_location"])
            for p in pcodes:
                WorkCenterProcess.objects.get_or_create(work_center=wc, process=self.processes[p])
                self.work_centers[p] = wc
            for mcode, mname in machines:
                machine, _ = Machine.objects.get_or_create(code=mcode, defaults={"work_center": wc, "name": mname})
                self.machines.setdefault(wc.code, []).append(machine)
        self.report["work_centers"] = WorkCenter.objects.count()
        self.report["machines"] = Machine.objects.count()

    def _materials(self):
        def family(code, name, density):
            fam, _ = InventoryMaterial.objects.get_or_create(code=code, defaults={"name": name, "category": "FILM_FAMILY", "base_uom": "KG", "density_gcm3": D(density)})
            return fam

        def variant(code, name, fam, **kw):
            var, _ = InventoryMaterial.objects.get_or_create(code=code, defaults={"name": name, "category": "FILM_VARIANT", "base_uom": "KG", "parent_family": fam, **kw})
            return var

        pet_fam = family("PET-FAM", "PET", "1.40")
        ld_fam = family("MULTILAYER-LD-FAM", "MULTILAYER LD", "0.92")
        self.pet = variant("PET-12", "PET 12 micron", pet_fam, is_purchasable=True, is_extrudable=False)
        self.metpet = variant("MET-PET-12", "MET FINISH POLYESTER 12", pet_fam, is_purchasable=True, is_extrudable=False)
        self.grade, _ = RecipeGrade.objects.get_or_create(name="FOOD", defaults={"is_active": True})
        self.ld_mw = variant("LDMW-MULTILAYER", "LD MW - Multilayer (milky)", ld_fam, is_extrudable=True, is_purchasable=False, grade=self.grade)
        self.ld_nat = variant("LDNAT-MULTILAYER", "LD Nat - Multilayer", ld_fam, is_extrudable=True, is_purchasable=False, grade=self.grade)
        self.ld_bought = variant("LDNAT-BOUGHT", "LD Nat - purchased", ld_fam, is_purchasable=True, is_extrudable=False)

        def granule(code, name):
            g, _ = InventoryMaterial.objects.get_or_create(code=code, defaults={"name": name, "category": "GRANULE", "base_uom": "KG"})
            return g

        self.ldpe = granule("LDPE-SLIP", "LDPE - Slip")
        self.lldpe = granule("LLDPE-SLIP", "LLDPE - Slip")
        self.metallocene = granule("METALLOCENE-SLIP", "METALLOCENE - Slip")
        for film, comps in ((self.ld_mw, [(self.ldpe, 70), (self.lldpe, 30)]), (self.ld_nat, [(self.ldpe, 50), (self.lldpe, 30), (self.metallocene, 20)])):
            recipe, created = ExtrusionRecipe.objects.get_or_create(film_variant=film, grade=self.grade, defaults={"thickness_min_micron": 20, "thickness_max_micron": 120, "is_active": True})
            if created:
                for granule_obj, pct in comps:
                    ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=granule_obj, percentage=pct)
        self.adhesive, _ = InventoryMaterial.objects.get_or_create(code="AD-ADHESIVE", defaults={"name": "Lamination adhesive", "category": "ADHESIVE", "base_uom": "KG"})
        self.ink, _ = InventoryMaterial.objects.get_or_create(code="INK-PET", defaults={"name": "PET Ink Pool", "category": "INK", "base_uom": "KG"})
        self.inner, _ = InventoryMaterial.objects.get_or_create(
            code="INNER-100", defaults={"name": "Inner pouch of 100", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "INNER_POUCH", "packaging_supply_mode": "IN_HOUSE",
                                        "packaging_defaults_json": {"pcs_per_pack": 100, "weight_kg_per_base_uom": "0.012"}})
        self.gonny, _ = InventoryMaterial.objects.get_or_create(
            code="GONNY", defaults={"name": "GONNY", "category": "PACKAGING", "base_uom": "PCS", "packaging_kind": "GONNY", "packaging_supply_mode": "PURCHASED",
                                    "packaging_defaults_json": {"weight_kg_per_base_uom": "0.220"}})

        rm01, wip01 = self.loc["01"]["RM"], self.loc["01"]["WIP"]
        rm03, wip03 = self.loc["03"]["RM"], self.loc["03"]["WIP"]
        if not self.report.get("stock_added"):
            BulkService.add_bulk(material_id=self.ldpe.id, qty=D("6000"), plant_id=self.plant.id, location_id=rm01.id, cost=D("112"), reference="opening stock")
            BulkService.add_bulk(material_id=self.lldpe.id, qty=D("2500"), plant_id=self.plant.id, location_id=rm01.id, cost=D("124"), reference="opening stock")
            BulkService.add_bulk(material_id=self.metallocene.id, qty=D("800"), plant_id=self.plant.id, location_id=rm01.id, cost=D("168"), reference="opening stock")
            BulkService.add_bulk(material_id=self.ink.id, qty=D("180"), plant_id=self.plant.id, location_id=rm01.id, cost=D("650"), reference="opening stock")
            for plant_code, rm, wip in (("01", rm01, wip01), ("03", rm03, wip03)):
                BulkService.add_bulk(material_id=self.adhesive.id, qty=D("400"), plant_id=self.plants[plant_code].id, location_id=rm.id, cost=D("410"), reference="opening stock")
                BulkService.add_bulk(material_id=self.adhesive.id, qty=D("200"), plant_id=self.plants[plant_code].id, location_id=wip.id, cost=D("410"), reference="opening stock")
            PackagingService.add_packaging_stock(material_id=self.inner.id, qty=D("4000"), location_id=self.pack_store.id, cost=D("2"))
            PackagingService.add_packaging_stock(material_id=self.gonny.id, qty=D("150"), location_id=self.pack_store.id, cost=D("15"))
            # Purchased PET / met-PET / LD rolls in the Unit 01 RM store (jumbo rolls like a supplier GRN).
            for i, (mat, micron, kg) in enumerate([(self.pet, 12, 320), (self.pet, 12, 318), (self.pet, 12, 305), (self.pet, 12, 299), (self.pet, 12, 330), (self.pet, 12, 312),
                                                   (self.metpet, 12, 240), (self.metpet, 12, 236), (self.ld_bought, 50, 410), (self.ld_bought, 50, 395), (self.ld_bought, 50, 402)], start=1):
                self._raw_roll(mat, micron, kg, f"GRN-{mat.code}-{i:02d}", location=rm01)
            self.report["stock_added"] = True
        if not WebWidthPolicy.objects.filter(is_default=True).exists():
            WebWidthPolicy.objects.create(code="STANDARD", name="Standard slit · 1-up to 3-up", is_default=True, allowed_lanes=[1, 2, 3],
                                          slitting_waste_rule={"inter_cut_mm": 5, "edge_trim_mm": 2, "formula": "PER_CUT"})

    def _raw_roll(self, material, micron, kg, label, *, location, width=989):
        return InventoryRoll.objects.get_or_create(
            label_id=label,
            defaults=dict(material=material, thickness_micron=D(str(micron)), width_mm=D(str(width)), plant=location.plant, location=location,
                          original_weight_kg=D(str(kg)), weight_kg=D(str(kg)), net_weight_kg=D(str(kg)), status="AVAILABLE", stage_index=0,
                          current_step_index=0, completed_step_index=0, meta_json={"roll_role": "RAW_MATERIAL"}),
        )[0]

    def _route(self, name, codes, parallel_roots=(), pouch_style="THREE_SIDE_SEAL"):
        existing = TemplateBlueprint.objects.filter(name=name).first()
        if existing:
            return existing
        nodes = []
        for idx, code in enumerate(codes):
            nodes.append({"id": f"step_{idx + 1}_{code}", "label": code, "process_code": code, "route_index": idx, "template_step_index": None, "branch_key": "MAIN"})
        if parallel_roots:
            root_ids = [n["id"] for n in nodes if n["process_code"] in parallel_roots and nodes.index(n) < len(parallel_roots)]
            join = next(n for n in nodes if n["id"] not in root_ids)
            for i, _rid in enumerate(root_ids):
                nodes[i]["route_index"] = 0
                nodes[i]["branch_key"] = f"B{i + 1}"
            join["join_key"] = "JOIN"
            join["predecessor_node_ids"] = root_ids
            rest = [n for n in nodes if n["id"] not in root_ids]
            for k, node in enumerate(rest):
                node["route_index"] = k + 1
                if k > 0:
                    node["predecessor_node_ids"] = [rest[k - 1]["id"]]
        else:
            for k, node in enumerate(nodes):
                node["route_index"] = k
                if k > 0:
                    node["predecessor_node_ids"] = [nodes[k - 1]["id"]]
        rule = RoutingRule.objects.create(name=name, ordered_processes=list(codes), route_graph={"nodes": nodes})
        template = TemplateBlueprint.objects.create(name=name, fg_type="POUCH", status="LIVE", routing_rule=rule, pouch_style=pouch_style,
                                                    batch_execution_policy={"default_batch_size_kg": 100000})
        for index, code in enumerate(codes, start=1):
            TemplateProcessStep.objects.create(template=template, sequence_number=index, process=self.processes[code])
        return template

    def _templates(self):
        self.t_standup = self._route("Stand UP Pouches - Roto PRT", ["EXT", "PRT", "Lam", "Slt", "Pch"], parallel_roots=("EXT", "PRT"), pouch_style="STAND_UP")
        self.t_2ply_prt = self._route("3 Side Seal Pouch - 2 PLY - Printed (PURCHASE)", ["PRT", "Lam", "Slt", "Pch"])
        self.t_3ply_plain = self._route("3 Side Seal Pouch - 3 PLY - Plain", ["Lam", "Lam", "Slt", "Pch"])
        self.t_courier = self._route("COURIER BAG PLN", ["EXT", "SS"], pouch_style="PILLOW")
        self.t_bottom = self._route("ROTO PRINITNG (BOTTOM SEALING )", ["EXT", "PRT", "Bottom"], pouch_style="PILLOW")
        self.report["templates"] = TemplateBlueprint.objects.filter(status="LIVE").count()

    def _customers(self):
        self.customers = {}
        for code, name, bill, ship in CUSTOMERS:
            cust, _ = Customer.objects.get_or_create(code=f"DEMO-{code}", defaults={"name": name, "billing_address": bill, "shipping_address": ship, "mailing_state": "Gujarat", "mailing_country": "India"})
            self.customers[code] = cust

    # ------------------------------------------------------------------ orders
    def _layer(self, material, micron, density, width=980, grade=None):
        row = {"family_id": str(material.parent_family_id), "variant_id": str(material.id), "thickness_micron": micron, "density_g_cm3": density, "roll_width_mm": width, "name": material.name}
        if grade:
            row["grade_id"] = str(grade.id)
        return row

    def _order(self, template, layers, *, customer, printed, qty, width_mm, height_mm, gusset=0, pouch_style="THREE_SIDE_SEAL", lanes=2, child=490, parent=989,
               price=D("1.20"), po_ref="", note="", bill_to="", ship_to="", confirm=True, packaging=None, delivery_days=12, line_name=None):
        from datetime import date, timedelta

        geometry = {"fg_type": "POUCH", "finished_good_type": "POUCH", "pouch_style": pouch_style, "substrate_mode": "SHEET",
                    "base": {"width_mm": width_mm, "height_mm": height_mm}, "gusset_mm": gusset, "multipliers": {"faces": 2}, "adjustments": [],
                    "roll_width_mm": parent - 9, "child_target_width_mm": child, "target_child_width_mm": child}
        printing = {"enabled": printed, "method": "ROTO", "substrate_mode": "SHEET", "ink_gsm_total": 1.5 if printed else 0,
                    "color_names": ["WHITE", "RED", "BLUE"] if printed else [], "colors": 3 if printed else 0}
        chemicals = {"adhesive_gsm": 2.5, "adhesive_material_id": str(self.adhesive.id)} if len(layers) > 1 else {}
        if chemicals:
            printing["chemicals"] = chemicals
        packaging = packaging or {}
        preview = SalesOrderService.preview_sales_item({
            "finished_good_type": "POUCH", "geometry": geometry, "film_layers": layers, "printing": printing, "chemicals": chemicals,
            "addons": [], "packaging_snapshot": packaging, "order_qty": int(qty), "uom": "PCS",
        })
        bom = preview["bom"]
        if not bom.get("is_complete", True):
            raise CommandError(f"BOM incomplete for {template.name}: {bom.get('errors')}")
        order = SalesOrder.objects.create(
            customer=customer, customer_name=customer.name, order_name=line_name or template.name, order_type="MTO", status="DRAFT", geometry_override=geometry,
            customer_po_reference=po_ref, remarks=note, bill_to_address=bill_to or customer.billing_address, ship_to_address=ship_to or customer.shipping_address,
            payment_terms="30 days", delivery_terms="Delivered", delivery_date=date.today() + timedelta(days=delivery_days),
        )
        item = SalesOrderItem.objects.create(
            sales_order=order, template=template, mode="TEMPLATE", line_name=line_name or template.name, geometry_snapshot=geometry, layer_snapshot=layers,
            printing_snapshot=json_ready({**(preview.get("printing_snapshot") or {}), **printing}), addons_snapshot=[], packaging_snapshot=packaging,
            bom_snapshot=json_ready(bom), unit_weight_g=D(str(preview["unit_weight_g"])), total_weight_kg=D(str(preview["total_weight_kg"])),
            qty_uom="PCS", qty_value=D(str(qty)), price_basis="PCS", unit_price=price, preferred_lane_count=lanes, lane_count_source="OPERATOR_CHOICE",
        )
        if not confirm:
            return order, item, {}
        SalesOrderService.confirm_sales_order(order.id)
        item.refresh_from_db()
        if printed:
            # Confirm rebuilds the line; the approved artwork is assigned after it, before jobs are made.
            artwork = Artwork.objects.create(design_code=f"ART-{order.id.hex[:6].upper()}", name=f"{customer.name} artwork", print_type="ROTO", substrate_mode="SHEET",
                                             colorway_name="Std", front_colors=["WHITE", "RED", "BLUE"], front_colors_count=3, back_colors=[], back_colors_count=0,
                                             color_list=["WHITE", "RED", "BLUE"], colors_count=3, ink_gsm_total=D("1.50"), file_path=f"/artwork/{order.id.hex[:6]}.pdf", status="APPROVED")
            item.assigned_artwork = artwork
            item.save(update_fields=["assigned_artwork"])
        if not ProductionJob.objects.filter(sales_order_item=item).exists():
            JobService.create_jobs_for_so_item(item)
        jobs = {j.route_node_id: j for j in ProductionJob.objects.filter(sales_order_item=item)}
        return order, item, jobs

    # --- floor helpers (same calls the WCM/operator screens make) ---
    def _ready(self, job):
        job.refresh_from_db()
        if job.job_state == "WAITING":
            JobService.release_ready_frontier_jobs(ProductionJob.objects.filter(sales_order_item=job.sales_order_item))
            job.refresh_from_db()
        if job.job_state in {"PLANNED", "WAITING"}:
            JobService.release_job(job.id)
            job.refresh_from_db()
        return job

    def _run(self, job, roll_ids=()):
        self._ready(job)
        assignment = WorkCenterAssignment.objects.get(production_job=job)
        machine = self.machines[assignment.work_center.code][0]
        if roll_ids:
            WCManagerService.assign_rolls(assignment.id, [str(r) for r in roll_ids], user=self.user)
        WCManagerService.assign_machine(assignment.id, str(machine.id), user=self.user)
        job.refresh_from_db()
        if job.job_state != "EXECUTING":
            OperatorService.start_job(str(job.id), self.user)
        job.refresh_from_db()
        if job.job_state != "EXECUTING":
            raise CommandError(f"{job.job_number} did not start ({job.job_state})")
        return job

    def _outputs(self, job, role="OUTPUT"):
        return list(InventoryRoll.objects.filter(created_by_job=job, meta_json__roll_role=role).order_by("created_at"))

    def _target(self, job):
        job.refresh_from_db()
        return D(str(ExecutionService.get_step_execution_profile(str(job.id), job=job)["step_target_total_kg"]))

    def _extrude(self, job, rolls=4, granules=None, complete=True):
        self._run(job)
        per = (self._target(job) / rolls).quantize(D("0.01"))
        OperatorService.log_output_step(str(job.id), float(per * rolls), self.user, roll_outputs=[{"width_mm": 989, "weight_kg": str(per)} for _ in range(rolls)])
        if complete:
            confirmations = [{"material_id": str(g.id), "actual_issued_qty": str((per * rolls * D(str(share)) / 100 + D("1")).quantize(D("0.01"))), "actual_returned_qty": "0"} for g, share in (granules or [])]
            JobService.complete_step(job, user=self.user, material_confirmations=confirmations or None)
        return self._outputs(job)

    def _print(self, job, material, micron, rolls=2, complete=True):
        target = self._target(job)
        stock = list(InventoryRoll.objects.filter(material=material, status="AVAILABLE", meta_json__roll_role="RAW_MATERIAL").order_by("-weight_kg"))
        inputs = stock[:rolls] if len(stock) >= rolls else stock
        if len(inputs) < rolls:
            for i in range(rolls - len(inputs)):
                inputs.append(self._raw_roll(material, micron, (target / rolls).quantize(D("0.01")) + D("2"), f"GRN-{material.code}-X{i}", location=self.loc["01"]["RM"]))
        self._run(job, roll_ids=[r.id for r in inputs])
        for roll in inputs:
            out = min(D(str(roll.weight_kg)) - D("1"), (target / rolls).quantize(D("0.01")))
            OperatorService.log_output_step(str(job.id), float(out), self.user, roll_outputs=[{"weight_kg": str(out), "width_mm": 989}], scrap_qty=1)
        if complete:
            JobService.complete_step(job, user=self.user)
        return self._outputs(job)

    def _stock_for_lane(self, job, material, micron, rolls, label):
        self._ready(job)
        requirement = ExecutionService._roll_requirement(job)
        lane = next(l for l in requirement["lanes"] if l.get("material_name") == material.name)
        per = (D(str(lane["need_kg"])) / rolls * D("1.02")).quantize(D("0.01"))
        return [self._raw_roll(material, micron, per, f"{label}-{i}", location=self.loc["01"]["RM"]) for i in range(1, rolls + 1)]

    def _laminate(self, job, lane_rolls, entries=2, complete=True):
        self._ready(job)
        self._run(job, roll_ids=[r.id for rolls in lane_rolls for r in rolls])
        requirement = ExecutionService._roll_requirement(job)

        def lane_loaded(lane):
            for rolls in lane_rolls:
                first = rolls[0]
                is_lam = bool((first.meta_json or {}).get("is_laminate"))
                if (lane.get("material_name") == "Laminate from earlier pass" and is_lam) or (not is_lam and lane.get("material_name") == first.material.name):
                    return sum((D(str(r.weight_kg)) for r in rolls), D("0"))
            raise CommandError(f"no rolls loaded for lane {lane.get('label')}")

        capacity = min(lane_loaded(l) / D(str(l["share"])) for l in requirement["lanes"])
        total_out = min(capacity * D("0.98"), D(str(requirement["remaining_kg"])))
        per_entry = (total_out / entries).quantize(D("0.01"))
        for _ in range(entries):
            OperatorService.log_output_step(str(job.id), float(per_entry), self.user, roll_outputs=[{"weight_kg": str(per_entry), "width_mm": 989}])
        if complete:
            adhesive_req = job.material_requirements.filter(material=self.adhesive).first()
            confirmations = [{"material_id": str(self.adhesive.id), "actual_issued_qty": str((D(str(adhesive_req.required_qty)) * D("0.97")).quantize(D("0.01"))), "actual_returned_qty": "0"}] if adhesive_req else None
            JobService.complete_step(job, user=self.user, material_confirmations=confirmations)
        return self._outputs(job)

    def _slit(self, job, parents, child_width=490, complete=True):
        self._ready(job)
        self._run(job, roll_ids=[r.id for r in parents])
        for parent in parents:
            parent.refresh_from_db()
            half = (D(str(parent.weight_kg)) / 2 - D("0.5")).quantize(D("0.001"))
            OperatorService.log_output_step(str(job.id), float(half * 2), self.user, split_outputs=[{"width_mm": child_width, "weight_kg": str(half)}] * 2, trim_qty=1)
        if complete:
            JobService.complete_step(job, user=self.user)
        return self._outputs(job, role="SPLIT_OUTPUT")

    def _pouch(self, job, rolls, item, entries=3, complete=True, fraction=D("0.98")):
        self._ready(job)
        self._run(job, roll_ids=[r.id for r in rolls])
        unit_g = D(str(item.unit_weight_g))
        film = sum((D(str(r.weight_kg)) for r in rolls), D("0"))
        pcs_total = int(min(film * fraction * 1000 / unit_g, D(str(item.qty_value))) // 1000 * 1000)
        per = pcs_total // entries // 1000 * 1000
        made = 0
        for i in range(entries):
            pcs = per if i < entries - 1 else pcs_total - made
            kg = (D(pcs) * unit_g / 1000).quantize(D("0.001"))
            OperatorService.log_output_step(str(job.id), float(kg), self.user, output_pcs=pcs, scrap_qty=0.4)
            made += pcs
        if complete:
            JobService.complete_step(job, user=self.user)
        return list(FinishedGoodsBatch.objects.filter(production_job=job).order_by("created_at"))

    def _pack_and_dispatch(self, order, batches, *, dispatch=True):
        units = []
        for batch in batches:
            remaining = int(batch.qty_pcs)
            while remaining > 0:
                pcs = min(10000, remaining)
                unit = PackingService.create_gonny(str(batch.id), pcs, self.user, gonny_material_id=str(self.gonny.id), content_mode="PRIMARY_PACKS")
                PackingService.seal_gonny(str(unit.id), unit.expected_gross_weight_kg, self.user, extras=[])
                units.append(unit)
                remaining -= pcs
        for batch in batches:
            PackingVerificationService.close(batch.id, user=self.user)
        if not dispatch:
            return units, None
        for unit in units:
            FGDispatchService.release_gonny_to_dispatch(str(unit.id), user=self.user)
        challan = FGDispatchService.create_challan(
            customer_name=order.customer_name, plant_id=str(self.plant.id), sales_order_id=str(order.id), vehicle_no="GJ-01-TP-4521",
            driver_name="Ramesh Patel", driver_phone="9898000000", transporter_name="Shree Logistics", ship_to_address_snapshot={"location": order.ship_to_address or "Ahmedabad"},
            gonny_ids=[str(u.id) for u in units], user=self.user,
        )
        # The vehicle leaves: the challan is dispatched and its slip snapshot (incl. the client note) is frozen.
        FGDispatchService.dispatch_challan(str(challan.id), user=self.user)
        return units, challan

    def _orders(self):
        if SalesOrder.objects.filter(order_name__startswith="DEMO ·").exists():
            self.report["orders"] = "already seeded (DEMO · …) — skipped"
            return
        inner_pack = {"primary_inner_pack": {"enabled": True, "material_id": str(self.inner.id), "pcs_per_pack": 100},
                      "final_outer_pack": {"enabled": True, "material_id": str(self.gonny.id), "counted_at_packing": True}}
        made = []

        # A. Stand-up printed, full route, packed and dispatched.
        order, item, jobs = self._order(
            self.t_standup, [self._layer(self.pet, 12, 1.40), self._layer(self.ld_mw, 50, 0.92, grade=self.grade)], customer=self.customers["WF"], printed=True, qty=100000,
            width_mm=160, height_mm=230, gusset=80, pouch_style="STAND_UP", po_ref="WF/PO/2026/118", note="Deliver before 11 am. Call Ramesh at the gate; keep cartons upright.",
            packaging=inner_pack, delivery_days=7, line_name="DEMO · Stand-up pouch 160×230 printed · dispatched",
        )
        ld_rolls = self._extrude(jobs["step_1_EXT"], rolls=6, granules=[(self.ldpe, 70), (self.lldpe, 30)])
        printed = self._print(jobs["step_2_PRT"], self.pet, 12, rolls=4)
        laminates = self._laminate(jobs["step_3_Lam"], [printed, ld_rolls], entries=3)
        children = self._slit(jobs["step_4_Slt"], laminates)
        batches = self._pouch(jobs["step_5_Pch"], children, item, entries=3)
        self._pack_and_dispatch(order, batches, dispatch=True)
        made.append(order.order_number)

        # B. Same product, lamination done, slitting waiting (laminate rolls in WIP).
        order, item, jobs = self._order(
            self.t_standup, [self._layer(self.pet, 12, 1.40), self._layer(self.ld_mw, 50, 0.92, grade=self.grade)], customer=self.customers["SNS"], printed=True, qty=60000,
            width_mm=140, height_mm=200, gusset=60, pouch_style="STAND_UP", po_ref="SNS/0912", packaging=inner_pack, delivery_days=10, line_name="DEMO · Stand-up pouch 140×200 printed · at slitting",
        )
        ld_rolls = self._extrude(jobs["step_1_EXT"], rolls=4, granules=[(self.ldpe, 70), (self.lldpe, 30)])
        printed = self._print(jobs["step_2_PRT"], self.pet, 12, rolls=3)
        self._laminate(jobs["step_3_Lam"], [printed, ld_rolls], entries=2)
        self._ready(jobs["step_4_Slt"])
        made.append(order.order_number)

        # C. Purchased 2-ply printed: printing done, lamination next with bought LD in stock.
        order, item, jobs = self._order(
            self.t_2ply_prt, [self._layer(self.pet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)], customer=self.customers["MDF"], printed=True, qty=50000,
            width_mm=150, height_mm=200, note="Pack 50 per inner pouch, dry fruit grade.", packaging=inner_pack, delivery_days=14, line_name="DEMO · 3-side seal 150×200 printed · at lamination",
        )
        self._print(jobs["step_1_PRT"], self.pet, 12, rolls=2)
        self._ready(jobs["step_2_Lam"])
        made.append(order.order_number)

        # D. Plain 3-ply purchase: confirmed and released, nothing started (planner view).
        order, item, jobs = self._order(
            self.t_3ply_plain, [self._layer(self.pet, 12, 1.40), self._layer(self.metpet, 12, 1.40), self._layer(self.ld_bought, 50, 0.92)], customer=self.customers["ANN"], printed=False, qty=40000,
            width_mm=120, height_mm=180, delivery_days=18, line_name="DEMO · 3-side seal 120×180 plain 3-ply · released",
        )
        self._ready(jobs["step_1_Lam"])
        made.append(order.order_number)

        # E. Courier bag: extrusion done, side sealing running with one entry logged.
        order, item, jobs = self._order(
            self.t_courier, [self._layer(self.ld_nat, 60, 0.92, grade=self.grade)], customer=self.customers["GEO"], printed=False, qty=20000,
            width_mm=300, height_mm=400, pouch_style="PILLOW", lanes=1, child=600, parent=600, delivery_days=5, line_name="DEMO · Courier bag 300×400 · side sealing running",
        )
        rolls = self._extrude(jobs["step_1_EXT"], rolls=3, granules=[(self.ldpe, 50), (self.lldpe, 30), (self.metallocene, 20)])
        self._pouch(jobs["step_2_SS"], rolls, item, entries=1, complete=False, fraction=D("0.35"))
        made.append(order.order_number)

        # F. Bottom-seal roto: draft, not confirmed (composer / quotation demo).
        order, item, _ = self._order(
            self.t_bottom, [self._layer(self.ld_mw, 60, 0.92, grade=self.grade)], customer=self.customers["PRM"], printed=True, qty=30000,
            width_mm=200, height_mm=300, pouch_style="PILLOW", lanes=1, child=600, parent=600, confirm=False, delivery_days=21, line_name="DEMO · Tea pouch 200×300 roto bottom seal · draft",
        )
        made.append(order.order_number)
        self.report["orders"] = made
        self.report["jobs"] = ProductionJob.objects.filter(sales_order_item__sales_order__order_name__startswith="DEMO ·").count()
        self.report["fg_batches"] = FinishedGoodsBatch.objects.filter(sales_order_item__sales_order__order_name__startswith="DEMO ·").count()
