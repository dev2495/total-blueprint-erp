from decimal import Decimal
from typing import Dict, List, Any
import uuid
from apps.artwork.print_contract import resolve_ink_contract
from apps.materials.models import InventoryMaterial
from apps.recipes.models import ExtrusionRecipe, RecipeGrade
from django.core.exceptions import ObjectDoesNotExist

class BOMResolverService:
    @staticmethod
    def resolve(template_snapshot: Dict[str, Any], physics_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        """
        Explodes materials for a given physics snapshot and technical template.
        Zero inference, zero routing.
        """
        film_layers_bom = []
        extrusion_bom = []
        inks_bom = []
        chemicals_bom = []
        addons_bom = []
        errors = []
        
        # 1. Physics & Geometry Context (Strict Design Baseline)
        geo_snap = physics_snapshot['geometry_snapshot']
        
        # Normalize dimensions to METERS immediately for unit stability.
        # Roll orders are KG-authoritative; their usable area comes from the
        # physics engine's derived roll preview, not from any stored height.
        fg_type = str(geo_snap.get('finished_good_type', 'POUCH') or 'POUCH').upper()
        # Unit Area (m2)
        if fg_type == 'ROLL':
            roll_preview = physics_snapshot.get('roll_preview') or {}
            area_m2_unit = Decimal(
                str(
                    roll_preview.get('derived_area_m2')
                    or geo_snap.get('area_m2')
                    or 0
                )
            )
        else:
            area_m2_unit = _pouch_area_m2_from_physics_or_geometry(geo_snap, template_snapshot)
            if area_m2_unit <= 0:
                errors.append("Pouch film area is zero; verify stock/web width and consumption pitch.")

        qty_uom = str(template_snapshot.get('uom', 'PCS') or 'PCS').upper()
        order_qty = Decimal(str(template_snapshot.get('order_qty', 1)))
        if order_qty <= 0: order_qty = Decimal('1')
        is_roll_kg_mode = fg_type == 'ROLL' and qty_uom == 'KG' and order_qty > 0
        
        # 2. Layer Resolution
        layers_input = template_snapshot.get('film_layers', [])
        for idx, layer in enumerate(layers_input):
            try:
                family_id = layer.get('family_id')
                variant_id = layer.get('variant_id')
                thickness = Decimal(str(layer.get('thickness_micron', 0)))
                grade_id = layer.get('grade_id')
                payload_density = Decimal(str(layer.get('density_g_cm3', 0)))
                if thickness <= 0:
                    raise ValueError(f"Layer {idx + 1} thickness must be greater than zero.")

                # Case A: Variant Selected (Specific Resolution)
                if variant_id:
                    try:
                        variant = InventoryMaterial.objects.get(id=uuid_to_str(variant_id), category='FILM_VARIANT')
                    except (ObjectDoesNotExist, ValueError):
                        raise ValueError(f"Invalid Film Variant: {variant_id}")

                    effective_density = payload_density or Decimal(
                        str(
                            getattr(variant, "density_gcm3", None)
                            or getattr(getattr(variant, "parent_family", None), "density_gcm3", None)
                            or 0
                        )
                    )
                    if effective_density <= 0:
                        raise ValueError(f"Film density is missing for {variant.code}.")
                    # DESIGN-FIRST: calculate the unrounded per-unit mass.
                    # m2 x micron x g/cm3 = grams; divide by 1000 for kg.
                    weight_kg = (area_m2_unit * thickness * effective_density) / Decimal('1000')

                    layer_info = {
                        "family_id": family_id,
                        "variant_id": str(variant.id),
                        "code": variant.code,
                        "thickness_micron": thickness,
                        "weight_kg": float(round(weight_kg, 12)),
                        "name": variant.name,
                        "_gsm": float(round((thickness * effective_density), 12)),
                    }

                    # Determine effective source based on source_mode override
                    source_override = layer.get('source_mode', 'AUTO')
                    is_dual_capable = variant.is_extrudable and getattr(variant, 'is_purchasable', True)
                    
                    if source_override == 'PURCHASE':
                        effective_source = 'PURCHASE'
                    elif source_override == 'EXTRUDE' or grade_id:
                        effective_source = 'EXTRUDE'
                    else:  # AUTO
                        # For dual-capable variants: default to PURCHASE if no grade selected
                        # For extrude-only variants: default to EXTRUDE
                        # For purchase-only variants: default to PURCHASE
                        if is_dual_capable:
                            effective_source = 'PURCHASE'  
                        else:
                            effective_source = 'EXTRUDE' if variant.is_extrudable else 'PURCHASE'
                    
                    layer_info["source"] = effective_source

                    # Only resolve granules/recipe if effective source is EXTRUDE
                    if effective_source == 'EXTRUDE':
                        if not grade_id:
                            raise ValueError(f"Missing Grade for extruded layer: {variant.code}")
                        
                        # Match Recipe
                        recipe = ExtrusionRecipe.objects.filter(
                            film_variant=variant,
                            grade_id=uuid_to_str(grade_id),
                            thickness_min_micron__lte=thickness,
                            thickness_max_micron__gte=thickness,
                            is_active=True
                        ).first()

                        if not recipe:
                            raise ValueError(
                                f"No recipe for {variant.code} ({grade_id}, {thickness}μ)"
                            )

                        layer_info["grade"] = recipe.grade.name
                        
                        for comp in recipe.components.all():
                            comp_weight_kg = weight_kg * Decimal(str(comp.percentage)) / Decimal('100')
                            extrusion_bom.append({
                                "granule_id": str(comp.granule.id),
                                "code": comp.granule.code,
                                "name": comp.granule.name,
                                "percentage": comp.percentage,
                                "weight_kg": float(round(comp_weight_kg, 12)),
                                "layer_index": idx + 1
                            })

                # Case B: Family Only (Generic Resolution)
                elif family_id:
                    try:
                        family = InventoryMaterial.objects.get(id=uuid_to_str(family_id), category='FILM_FAMILY')
                    except (ObjectDoesNotExist, ValueError):
                        raise ValueError(f"Invalid Film Family: {family_id}")
                    effective_density = payload_density or Decimal(str(family.density_gcm3 or 0))
                    if effective_density <= 0:
                        raise ValueError(f"Film density is missing for {family.code}.")
                    weight_kg = (area_m2_unit * thickness * effective_density) / Decimal('1000')
                    
                    layer_info = {
                        "family_id": str(family.id),
                        "variant_id": None,
                        "code": family.code,
                        "thickness_micron": thickness,
                        "weight_kg": float(round(weight_kg, 12)),
                        "source": "PURCHASE",
                        "_gsm": float(round((thickness * effective_density), 12)),
                    }
                
                else:
                    raise ValueError(f"Layer {idx+1} missing Family/Variant.")

                film_layers_bom.append(layer_info)
            except Exception as e:
                errors.append(str(e))

        # 3. Printing & Inks
        printing = template_snapshot.get('printing', {})
        if not isinstance(printing, dict):
            printing = {}

        # Ink BOM is gated on TWO conditions:
        #   (1) printing.enabled is true (master is print-capable + sales picked print)
        #   (2) an approved artwork is assigned OR the caller already passed a
        #       frozen artwork contract with explicit colors, mapping, and GSM.
        # Without either source there is no authoritative ink GSM — we refuse to
        # invent one. The line still goes to production as unprinted unless
        # the master's artwork_required flag forces a block upstream.
        artwork_id = printing.get('artwork_id') or printing.get('approved_artwork_id') or printing.get('artwork')
        has_frozen_ink_contract = Decimal(str(printing.get('ink_gsm_total') or printing.get('ink_gsm') or 0)) > 0 and bool(
            printing.get("color_names") or printing.get("front_colors") or printing.get("back_colors")
        )
        is_printing = bool(printing.get('enabled', False)) and (bool(artwork_id) or has_frozen_ink_contract)
        if is_printing:
            ink_gsm_total = Decimal(str(printing.get('ink_gsm_total') or printing.get('ink_gsm') or 0))
            front_colors = [str(c).strip().upper() for c in (printing.get('front_colors') or []) if str(c).strip()]
            back_colors = [str(c).strip().upper() for c in (printing.get('back_colors') or []) if str(c).strip()]
            color_names = [str(c).strip().upper() for c in (printing.get('color_names') or []) if str(c).strip()]
            if not color_names:
                color_names = front_colors + back_colors

            front_count = int(printing.get('front_colors_count') or 0)
            back_count = int(printing.get('back_colors_count') or 0)
            side_colors_count = front_count + back_count
            colors_count = int(printing.get('colors') or len(color_names) or side_colors_count or 0)
            if not color_names and colors_count > 0:
                color_names = [f"FRONT-{idx + 1}" for idx in range(max(front_count, 0))]
                color_names += [f"BACK-{idx + 1}" for idx in range(max(back_count, 0))]
                if not color_names:
                    color_names = [f"COLOR-{idx + 1}" for idx in range(colors_count)]
            if colors_count <= 0 and color_names:
                colors_count = len(color_names)

            if ink_gsm_total > 0:
                ink_contract = resolve_ink_contract(
                    color_names=color_names,
                    layer_snapshot=layers_input,
                    strict=False,
                )
                base_tag = ink_contract["ink_base_family"]
                ink_weight = (area_m2_unit * ink_gsm_total) / Decimal('1000')
                inks_bom.append({
                    "material_id": None,
                    "code": "INK-THEORY",
                    "name": "Theoretical printing ink",
                    "color": "TOTAL",
                    "gsm_total": float(round(ink_gsm_total, 6)),
                    "gsm_per_color": None,
                    "weight_kg": float(round(ink_weight, 12)),
                    "ink_base_family": base_tag,
                    "colors": color_names,
                    "_gsm": float(round(ink_gsm_total, 6)),
                })

        # 4. Chemistry Resolution
        num_layers = len(layers_input)
        chemicals = template_snapshot.get('chemicals', {})
        if not isinstance(chemicals, dict):
            chemicals = {}
            
        print_method = str(printing.get('method') or printing.get('type') or '').upper()
        if num_layers > 1 or (is_printing and print_method == 'ROTO'):
            adh_gsm = Decimal(str(chemicals.get('adhesive_gsm', 0)))
            sol_gsm = Decimal(str(chemicals.get('solvent_gsm', 0)))

            if adh_gsm > 0:
                adh_mat = _chemical_material(chemicals, "adhesive", "ADHESIVE", fallback_code="AD-ADHESIVE")
                if adh_mat is not None:
                    chemicals_bom.append({
                        "material_id": str(adh_mat.id),
                        "code": adh_mat.code,
                        "name": adh_mat.name,
                        "type": "ADHESIVE",
                        "gsm": float(round(adh_gsm, 6)),
                        "weight_kg": float(round((area_m2_unit * adh_gsm) / Decimal('1000'), 12)),
                        "_gsm": float(round(adh_gsm, 6)),
                    })
                else:
                    errors.append("Adhesive GSM is set but no active adhesive master was selected.")

            if sol_gsm > 0:
                sol_mat = _chemical_material(chemicals, "solvent", "SOLVENT", fallback_code="AD-SOLVENT")
                if sol_mat is not None:
                    chemicals_bom.append({
                        "material_id": str(sol_mat.id),
                        "code": sol_mat.code,
                        "name": sol_mat.name,
                        "type": "SOLVENT",
                        "gsm": float(round(sol_gsm, 6)),
                        "weight_kg": float(round((area_m2_unit * sol_gsm) / Decimal('1000'), 12)),
                        "_gsm": float(round(sol_gsm, 6)),
                    })
                else:
                    errors.append("Solvent GSM is set but no active solvent master was selected.")

        # 5. Add-on Resolution
        addons_input = template_snapshot.get('addons', [])
        # order_qty defined above
        eff_width = Decimal(str(geo_snap.get('effective_width_mm', geo_snap.get('width_mm', 0))))
        eff_height = Decimal(str(geo_snap.get('effective_height_mm', geo_snap.get('height_mm', 0))))

        for addon_in in addons_input:
            if not isinstance(addon_in, dict): continue
            addon_id = addon_in.get('addon_id')
            if not addon_id: continue
            
            try:
                addon_mat = InventoryMaterial.objects.get(id=uuid_to_str(addon_id), category='ADDON')
                weight_val = Decimal(str(addon_mat.weight_value or 0))
                addon_item_qty = Decimal(str(addon_in.get('qty') or addon_in.get('quantity') or 1))
                addon_weight_unit_g = Decimal('0')
                applies_to = str(addon_in.get('applies_to') or '').upper() or 'NONE'
                if addon_mat.weight_mode == 'PER_MM':
                    if applies_to not in {'WIDTH', 'HEIGHT', 'BOTH'}:
                        applies_to = 'WIDTH'
                    if applies_to == 'WIDTH':
                        dim = eff_width
                    elif applies_to == 'HEIGHT':
                        dim = eff_height
                    elif applies_to == 'BOTH':
                        dim = eff_width + eff_height
                    else:
                        dim = Decimal('0')
                    addon_weight_unit_g = weight_val * dim * addon_item_qty
                elif addon_mat.weight_mode == 'PER_PIECE':
                    addon_weight_unit_g = weight_val * addon_item_qty
                elif addon_mat.weight_mode == 'FIXED':
                    addon_weight_unit_g = weight_val * addon_item_qty
                else:
                    addon_weight_unit_g = Decimal('0')

                stock_uom = str(getattr(addon_mat, 'addon_purchase_uom', None) or getattr(addon_mat, 'base_uom', None) or 'KG').upper()
                if stock_uom not in {'KG', 'PCS', 'METER'}:
                    stock_uom = 'KG'
                if stock_uom == 'METER':
                    if addon_mat.weight_mode == 'PER_MM' and dim > 0:
                        stock_qty_unit = (dim / Decimal('1000')) * addon_item_qty
                    else:
                        # For non PER_MM meter-stock add-ons, quantity is interpreted
                        # as meters per finished unit.
                        stock_qty_unit = addon_item_qty
                elif stock_uom == 'PCS':
                    stock_qty_unit = addon_item_qty
                else:
                    stock_qty_unit = addon_weight_unit_g / Decimal('1000')

                addons_bom.append({
                    "addon_id": str(addon_mat.id),
                    "code": addon_mat.code,
                    "name": addon_mat.name,
                    "quantity": float(addon_item_qty),
                    "weight_kg": float(round(addon_weight_unit_g / Decimal('1000'), 12)),
                    "stock_qty": float(round(stock_qty_unit, 12)),
                    "stock_uom": stock_uom,
                    "uom": stock_uom,
                    "weight_mode": addon_mat.weight_mode,
                    "weight_value": float(weight_val),
                    "applies_to": applies_to,
                    "applied_dimension_mm": float(round(dim, 6)) if addon_mat.weight_mode == 'PER_MM' else 0.0,
                })
            except (ObjectDoesNotExist, ValueError): continue

        # 5b. Roll invariant explosion:
        # For ROLL orders provided directly in KG, geometry height/length may be absent.
        # In that case, distribute total order KG by GSM shares so mass stays physically invariant.
        if is_roll_kg_mode:
            weighted_rows = []
            total_gsm = Decimal('0')

            for row_set in (film_layers_bom, inks_bom, chemicals_bom):
                for row in row_set:
                    gsm_val = Decimal(str(row.get('_gsm') or 0))
                    if gsm_val <= 0:
                        continue
                    weighted_rows.append((row, gsm_val))
                    total_gsm += gsm_val

            if total_gsm > 0:
                for row, gsm_val in weighted_rows:
                    row_weight = (order_qty * gsm_val) / total_gsm
                    row["weight_kg"] = float(round(row_weight, 6))

                # Recompute extrusion component weights from distributed film layer weights.
                layer_weights = {}
                for idx, film in enumerate(film_layers_bom, start=1):
                    layer_weights[idx] = Decimal(str(film.get("weight_kg") or 0))

                for comp in extrusion_bom:
                    try:
                        layer_idx = int(comp.get("layer_index") or 0)
                    except Exception:
                        layer_idx = 0
                    pct = Decimal(str(comp.get("percentage") or 0))
                    if layer_idx <= 0 or pct <= 0:
                        continue
                    base_layer_weight = layer_weights.get(layer_idx, Decimal('0'))
                    comp_weight = (base_layer_weight * pct) / Decimal('100')
                    comp["weight_kg"] = float(round(comp_weight, 6))
            else:
                errors.append("ROLL KG invariant explosion failed: total GSM is zero.")

        # 6. POD Resolution
        pod_bom = []
        pod_phy = physics_snapshot.get('breakdown', {}).get('pod')
        if pod_phy:
            pod_weight_total = Decimal(str(pod_phy.get('weight_kg', 0)))
            # Physics returns POD weight at order scope; BOM theoretical line must keep
            # that full-order quantity (not per-piece normalization).
            pod_weight_kg = pod_weight_total if pod_weight_total > 0 else Decimal("0")
            pod_material_id = str(pod_phy.get("material_id") or "").strip()
            pod_code = str(pod_phy.get('material_code') or "").strip()
            pod_mat = None
            if pod_material_id:
                pod_mat = InventoryMaterial.objects.filter(id=pod_material_id).first()
            if pod_mat is None and pod_code:
                pod_mat = InventoryMaterial.objects.filter(code=pod_code).first()
            if pod_mat is not None:
                pod_bom.append({
                    "material_id": str(pod_mat.id),
                    "code": pod_mat.code,
                    "name": pod_mat.name,
                    "weight_kg": float(round(pod_weight_kg, 6))
                })
            else:
                if pod_material_id:
                    errors.append(f"POD Material '{pod_material_id}' not found in Master Data.")
                elif pod_code:
                    errors.append(f"POD Material '{pod_code}' not found in Master Data.")
                else:
                    errors.append("POD Material mapping missing in physics POD breakdown.")

        for rows in (film_layers_bom, inks_bom, chemicals_bom, addons_bom, pod_bom):
            for row in rows:
                if isinstance(row, dict):
                    row.pop("_gsm", None)

        summary_unit_weight = Decimal(str(physics_snapshot.get('unit_weight_g', 0)))
        summary_total_weight_g = Decimal(str(physics_snapshot.get('total_weight_g', 0)))
        summary_total_weight_kg = Decimal(str(physics_snapshot.get('total_weight_kg', 0)))
        if fg_type == 'ROLL':
            summary_unit_weight = Decimal('0')

        return {
            "films": film_layers_bom,
            "granules": extrusion_bom,  # Granule breakdown from extrusion recipes
            "inks": inks_bom,
            "chemicals": chemicals_bom,
            "addons": addons_bom,
            "pod": pod_bom,
            "is_complete": len(film_layers_bom) > 0 and len(errors) == 0 and (not is_printing or len(inks_bom) > 0),
            "errors": errors,
            "summary": {
                "unit_weight_g": float(round(summary_unit_weight, 6)),
                "total_weight_g": float(round(summary_total_weight_g, 6)),
                "total_weight_kg": float(round(summary_total_weight_kg, 6)),
            }
        }

def uuid_to_str(val):
    if not val: return None
    try:
        return str(uuid.UUID(str(val)))
    except Exception:
        return None


def _pouch_area_m2_from_physics_or_geometry(geo_snap: Dict[str, Any], template_snapshot: Dict[str, Any]) -> Decimal:
    """
    Use the same web/tube area basis that PhysicsEngine already resolved.

    Pouch-style records now express stock width separately from film-area width:
    open web uses child width directly, while lay-flat tube stores the physical
    lay-flat width and doubles it for film area. If an old snapshot has no
    explicit web-basis fields, use the same legacy open-web two-wall fallback
    as PhysicsEngine instead of the old finished-size rectangle.
    """
    area_m2 = Decimal(str(geo_snap.get("area_m2") or 0))
    if area_m2 > 0:
        return area_m2

    web_width = Decimal(
        str(
            geo_snap.get("film_area_width_mm")
            or geo_snap.get("consumption_web_width_mm")
            or geo_snap.get("child_target_width_mm")
            or geo_snap.get("target_child_width_mm")
            or 0
        )
    )
    pitch = Decimal(str(geo_snap.get("consumption_pitch_mm") or 0))
    if web_width > 0 and pitch > 0:
        return (web_width * pitch) / Decimal("1000000")

    w_mm = Decimal(str(geo_snap.get("effective_width_mm", 0)))
    h_mm = Decimal(str(geo_snap.get("effective_height_mm", 0)))
    if w_mm <= 0 or h_mm <= 0:
        return Decimal("0")
    return (w_mm * Decimal("2") * h_mm) / Decimal("1000000")


def _chemical_material(chemicals: Dict[str, Any], family: str, category: str, *, fallback_code: str) -> InventoryMaterial | None:
    material_id = uuid_to_str(chemicals.get(f"{family}_material_id") or chemicals.get(f"{family}_id"))
    material_code = str(
        chemicals.get(f"{family}_material_code")
        or chemicals.get(f"{family}_code")
        or ""
    ).strip()
    qs = InventoryMaterial.objects.filter(category=category, status="ACTIVE")
    if material_id:
        found = qs.filter(id=material_id).first()
        if found is not None:
            return found
    if material_code:
        found = qs.filter(code__iexact=material_code).first()
        if found is not None:
            return found
    return qs.filter(code__iexact=fallback_code).first()
