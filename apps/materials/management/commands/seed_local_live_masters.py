"""
Load a master-configuration export (processes, work centres, machines, materials, recipes,
routes, templates, pouch styles, lane policies and product masters with sizes) into a LOCAL
database, so the local stack shows the same products the factory really makes.

The export is plain JSON made by a read-only probe of master tables only: no customers, orders,
artworks, customer items, users, stock or ledgers. Rows are matched by code or name; anything
that already exists locally is left as it is, so local demo orders and jobs keep working.
Live record ids inside JSON fields (layer films, adhesive/solvent, template work centres) are
mapped to the matching local records. Refuses to run on a production settings profile.

    python manage.py seed_local_live_masters --catalog /path/to/live-config.json [--all-masters]
"""
from __future__ import annotations

import json
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import models, transaction
from django.db.models import Q

from apps.factory.models import Machine, Plant, Process, WorkCenter, WorkCenterProcess
from apps.inventory.models import InventoryLocation
from apps.materials.models import InventoryMaterial, PouchStyleMaster, ProductMaster, ProductMasterSize, WebWidthPolicy
from apps.recipes.models import ExtrusionRecipe, ExtrusionRecipeComponent, RecipeGrade
from apps.routing.models import RoutingRule
from apps.sales.models import SalesOrderItem
from apps.templates.models import TemplateBlueprint, TemplateProcessStep

try:  # the same code normaliser the models apply on save
    from apps.materials.naming import normalize_code as _normalize_code
except ImportError:  # pragma: no cover
    _normalize_code = None


def norm(code: Any) -> str:
    text = str(code or "")
    if _normalize_code is not None:
        try:
            text = _normalize_code(text, max_length=80)
        except TypeError:
            text = _normalize_code(text)
    return text.upper()

SKIP_FIELDS = {"_pk", "id", "created_at", "updated_at", "created_by", "updated_by", "approved_by"}


class Command(BaseCommand):
    help = "Load live master configuration (JSON export) into a local database (never on production)."

    def add_arguments(self, parser):
        parser.add_argument("--catalog", required=True, help="Path to the master-configuration JSON export")
        parser.add_argument("--all-masters", action="store_true", help="Also load inactive product masters")

    def handle(self, *args, **options):
        if getattr(settings, "IS_PRODUCTION", False) or str(getattr(settings, "DJANGO_ENV", "")).lower().startswith("prod"):
            raise CommandError("Refusing to load master configuration on a production settings profile.")
        with open(options["catalog"], encoding="utf-8") as handle:
            self.data = json.load(handle)
        self.ids: dict[str, str] = {}  # live pk -> local pk
        self.counts: dict[str, list[int]] = {}
        with transaction.atomic():
            self._plants()
            self._processes()
            self._work_centers()
            self._machines()
            self._grades()
            self._materials()
            self._recipes()
            self._routes()
            self._pouch_styles()
            self._lane_policies()
            self._templates()
            self._product_masters(include_inactive=options["all_masters"])
        for key, (created, existing) in self.counts.items():
            self.stdout.write(f"{key}: {created} created, {existing} already local")

    # ------------------------------------------------------------------ helpers
    def _count(self, key: str, created: bool):
        row = self.counts.setdefault(key, [0, 0])
        row[0 if created else 1] += 1

    def _remember(self, live_row: dict, obj: models.Model):
        if live_row.get("_pk"):
            self.ids[str(live_row["_pk"])] = str(obj.pk)

    def _remap(self, value: Any) -> Any:
        """Swap live record ids found anywhere inside a JSON value for the local ids."""
        if isinstance(value, str):
            return self.ids.get(value, value)
        if isinstance(value, list):
            return [self._remap(v) for v in value]
        if isinstance(value, dict):
            return {k: self._remap(v) for k, v in value.items()}
        return value

    def _fields(self, model, row: dict, *, exclude: set[str] = frozenset()) -> dict:
        """Plain fields copied as they are; foreign keys only when the target is already mapped."""
        out: dict[str, Any] = {}
        for field in model._meta.concrete_fields:
            name = field.name
            if name in SKIP_FIELDS or name in exclude or name not in row or field.primary_key:
                continue
            value = row[name]
            if isinstance(field, models.ForeignKey):
                mapped = self.ids.get(str(value)) if value else None
                if mapped:
                    out[f"{name}_id"] = mapped
                elif field.null:
                    out[f"{name}_id"] = None
                continue
            if isinstance(field, models.JSONField):
                value = self._remap(value)
            out[name] = value
        return out

    def _upsert(self, key: str, model, lookup: dict, row: dict, *, exclude: set[str] = frozenset(), extra: dict | None = None):
        # Codes are stored upper-case by some models, so match them without case.
        # Some masters (processes) keep codes as typed, others normalise them, so try both.
        query = {k: v for k, v in lookup.items() if k != "code"}
        found = model.objects.filter(**query)
        if "code" in lookup:
            raw = str(lookup["code"] or "")
            found = found.filter(Q(code__iexact=raw) | Q(code__iexact=norm(raw)))
        obj = found.first()
        if obj is not None:
            self._remember(row, obj)
            self._count(key, False)
            return obj, False
        values = {**self._fields(model, row, exclude=exclude | set(lookup)), **(extra or {}), **lookup}
        obj = model.objects.create(**values)
        self._remember(row, obj)
        self._count(key, True)
        return obj, True

    # ------------------------------------------------------------------ sections
    def _plants(self):
        for row in self.data.get("plants", []):
            self._upsert("plants", Plant, {"code": row["code"]}, row)

    def _processes(self):
        for row in self.data.get("processes", []):
            self._upsert("processes", Process, {"code": row["code"]}, row)

    def _wip_location(self, plant: Plant) -> InventoryLocation:
        found = InventoryLocation.objects.filter(plant=plant, type="WIP").order_by("-is_system", "code").first()
        return found or InventoryLocation.objects.create(plant=plant, code=f"WIP-{plant.code}", name=f"WIP {plant.code}", type="WIP", is_system=True)

    def _work_centers(self):
        plants = {p.code: p for p in Plant.objects.all()}
        for row in self.data.get("work_centers", []):
            plant = plants.get(row.get("plant_code") or "")
            if plant is None:
                continue
            self._upsert("work_centers", WorkCenter, {"code": row["code"]}, row, exclude={"plant", "default_wip_location"},
                         extra={"plant": plant, "default_wip_location": self._wip_location(plant)})
        wcs = {w.code: w for w in WorkCenter.objects.all()}
        procs = {p.code: p for p in Process.objects.all()}
        for link in self.data.get("work_center_processes", []):
            wc, proc = wcs.get(link["wc"]), procs.get(link["process"])
            if wc and proc:
                WorkCenterProcess.objects.get_or_create(work_center=wc, process=proc)

    def _machines(self):
        wcs = {w.code: w for w in WorkCenter.objects.all()}
        for row in self.data.get("machines", []):
            wc = wcs.get(row.get("wc_code") or "")
            if wc is None:
                continue
            # Machine codes repeat across work centres (MC-01 in MLD, SLD, EXT-1…): a machine is work centre + code.
            self._upsert("machines", Machine, {"code": row["code"], "work_center": wc}, row, exclude={"work_center", "assigned_operator"})

    def _grades(self):
        for row in self.data.get("recipe_grades", []):
            self._upsert("recipe_grades", RecipeGrade, {"name": row["name"]}, row)

    def _materials(self):
        rows = self.data.get("materials", [])
        # Families first so variants can point at them.
        for row in sorted(rows, key=lambda r: 0 if r.get("category") == "FILM_FAMILY" else 1):
            self._upsert("materials", InventoryMaterial, {"code": row["code"]}, row, exclude={"parent_family", "commercial_family"})
        by_code = {norm(m.code): m for m in InventoryMaterial.objects.all()}
        for row in rows:
            fam_code = norm(row.get("parent_family_code")) if row.get("parent_family_code") else ""
            mat = by_code.get(norm(row["code"]))
            if fam_code and mat and mat.parent_family_id is None and fam_code in by_code:
                mat.parent_family = by_code[fam_code]
                mat.save(update_fields=["parent_family"])

    def _recipes(self):
        films = {norm(m.code): m for m in InventoryMaterial.objects.filter(category="FILM_VARIANT")}
        granules = {norm(m.code): m for m in InventoryMaterial.objects.filter(category="GRANULE")}
        grades = {g.name: g for g in RecipeGrade.objects.all()}
        for row in self.data.get("recipes", []):
            film = films.get(norm(row.get("film_code")))
            grade = grades.get(row.get("grade_name") or "")
            if film is None:
                continue
            band = {"thickness_min_micron": row.get("thickness_min_micron") or 0, "thickness_max_micron": row.get("thickness_max_micron") or 200}
            recipe = ExtrusionRecipe.objects.filter(film_variant=film, grade=grade, **band).first()
            if recipe is not None:
                self._count("recipes", False)
                continue
            recipe = ExtrusionRecipe.objects.create(film_variant=film, grade=grade, is_active=bool(row.get("is_active", True)), **band)
            for comp in row.get("components", []):
                granule = granules.get(norm(comp["granule"]))
                if granule:
                    ExtrusionRecipeComponent.objects.create(recipe=recipe, granule=granule, percentage=comp["pct"])
            self._count("recipes", True)

    def _routes(self):
        for row in self.data.get("routing_rules", []):
            local = RoutingRule.objects.filter(name=row["name"]).first()
            if local is not None and list(local.ordered_processes or []) != list(row.get("ordered_processes") or []):
                # A local demo route took a live name with different steps: keep it under a demo name
                # (its orders and jobs keep pointing at it) and load the live route under the live name.
                local.name = f"{row['name']} · local demo"[:255]
                local.save(update_fields=["name"])
                self._count("routing_rules_kept_as_local_demo", True)
            self._upsert("routing_rules", RoutingRule, {"name": row["name"]}, row)

    def _pouch_styles(self):
        for row in self.data.get("pouch_styles", []):
            self._upsert("pouch_styles", PouchStyleMaster, {"code": row["code"]}, row)

    def _lane_policies(self):
        for row in self.data.get("web_width_policies", []):
            exists = WebWidthPolicy.objects.filter(code=row["code"]).exists()
            # Keep a single default policy locally.
            extra = {"is_default": False} if not exists and WebWidthPolicy.objects.filter(is_default=True).exists() else None
            self._upsert("web_width_policies", WebWidthPolicy, {"code": row["code"]}, row, extra=extra)

    def _templates(self):
        routes = {r.name: r for r in RoutingRule.objects.all()}
        procs = {p.code: p for p in Process.objects.all()}
        wcs = {w.code: w for w in WorkCenter.objects.all()}
        # A name can carry a LIVE version and a newer draft; the LIVE one is what orders use.
        rank = {"LIVE": 0, "APPROVED": 1, "DRAFT": 2}
        rows = sorted(self.data.get("templates", []), key=lambda r: (rank.get(r.get("status"), 3), -(r.get("version") or 0)))
        for row in rows:
            if row.get("status") == "OBSOLETE":
                continue
            route = routes.get(row.get("routing_rule_name") or "")
            template, created = self._upsert("templates", TemplateBlueprint, {"name": row["name"]}, row,
                                             exclude={"routing_rule", "source_template", "superseded_by", "commercial_family"},
                                             extra={"routing_rule": route})
            if not created:
                # Point a live template at the live route when an earlier run linked it to a demo route
                # that took the same name; only while no order line uses the template yet.
                if (route is not None and template.routing_rule_id != route.id and template.routing_rule is not None
                        and template.routing_rule.name.endswith(" · local demo")
                        and not SalesOrderItem.objects.filter(template=template).exists()):
                    template.routing_rule = route
                    template.save(update_fields=["routing_rule"])
                    self._count("templates_relinked_to_live_route", True)
                continue
            for step in row.get("steps", []):
                process = procs.get(step.get("process_code") or "")
                if process is None:
                    continue
                values = self._fields(TemplateProcessStep, step, exclude={"template", "process", "default_work_center", "cost_absorption_group"})
                values["allowed_work_center_ids"] = [self.ids[x] for x in (step.get("allowed_work_center_ids") or []) if x in self.ids]
                default_wc = wcs.get(step.get("default_wc_code") or "")
                TemplateProcessStep.objects.create(template=template, process=process, default_work_center=default_wc, **values)

    def _product_masters(self, *, include_inactive: bool):
        templates = {t.name: t for t in TemplateBlueprint.objects.filter(is_current_version=True)}
        films = {norm(m.code): m for m in InventoryMaterial.objects.all()}
        styles = {norm(s.code): s for s in PouchStyleMaster.objects.all()}
        for row in self.data.get("product_masters", []):
            if not row.get("active") and not include_inactive:
                continue
            layers = []
            for layer in row.get("layer_template") or []:
                layer = dict(layer)
                film = films.get(norm(layer.get("film_variant_code")))
                layer["film_variant_id"] = str(film.id) if film else None
                layers.append(layer)
            fixed = self._remap(dict(row.get("fixed_attributes") or {}))
            for key in list(fixed):
                if key.endswith("_material_id"):
                    code = norm(fixed.get(key.replace("_material_id", "_material_code")))
                    if code in films:
                        fixed[key] = str(films[code].id)
            extra = {
                "template": templates.get(row.get("template_name") or ""),
                "default_template": templates.get(row.get("default_template_name") or ""),
                "layer_template": layers,
                "canonical_layer_stack": self._remap(row.get("canonical_layer_stack") or []),
                "fixed_attributes": fixed,
            }
            master, created = self._upsert("product_masters", ProductMaster, {"code": row["code"]}, row,
                                           exclude={"template", "default_template", "extrusion_recipe", "superseded_by", "commercial_family",
                                                    "layer_template", "canonical_layer_stack", "fixed_attributes"},
                                           extra=extra)
            if not created:
                self._fill_missing_links(master, layers, fixed)
                continue
            for size in row.get("sizes") or []:
                values = self._fields(ProductMasterSize, size, exclude={"product_master", "pouch_style_master"})
                values["pouch_style_master"] = styles.get(norm(size.get("pouch_style_code")))
                ProductMasterSize.objects.create(product_master=master, **values)
                self._count("product_master_sizes", True)

    def _fill_missing_links(self, master, layers, fixed):
        """An earlier run may have left a film or chemistry link empty (a live code it could not match
        yet). Fill only links that are empty locally; never overwrite one that is set."""
        changed = []
        current = list(master.layer_template or [])
        if len(current) == len(layers):
            for here, there in zip(current, layers):
                if not here.get("film_variant_id") and there.get("film_variant_id") and here.get("film_variant_code") == there.get("film_variant_code"):
                    here["film_variant_id"] = there["film_variant_id"]
                    changed.append("layer_template")
        attrs = dict(master.fixed_attributes or {})
        for key, value in fixed.items():
            if key.endswith("_material_id") and value and not attrs.get(key):
                attrs[key] = value
                changed.append("fixed_attributes")
        if changed:
            master.layer_template = current
            master.fixed_attributes = attrs
            master.save(update_fields=sorted(set(changed)))
            self._count("product_master_links_filled", True)
