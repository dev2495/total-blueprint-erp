import logging
from typing import Dict, List, Any
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


def _dec(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value in (None, ""):
            return default
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


class PhysicsEngine:
    @staticmethod
    def roll_area_m2(weight_kg, thickness_m, density_kg_m3):
        weight = _dec(weight_kg)
        thickness = _dec(thickness_m)
        density = _dec(density_kg_m3)
        if weight <= 0 or thickness <= 0 or density <= 0:
            return Decimal("0")
        return weight / (thickness * density)

    @staticmethod
    def roll_length_m(area_m2, width_m):
        area = _dec(area_m2)
        width = _dec(width_m)
        if area <= 0 or width <= 0:
            return Decimal("0")
        return area / width

    @staticmethod
    def _resolve_roll_invariants(data: Dict[str, Any]) -> Dict[str, Decimal]:
        geometry = data.get("geometry") or {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        layers = data.get("film_layers") if isinstance(data.get("film_layers"), list) else []
        first_layer = layers[0] if layers and isinstance(layers[0], dict) else {}

        width_mm = _dec(
            first_layer.get("roll_width_mm")
            or first_layer.get("width_mm")
            or base.get("width_mm")
            or geometry.get("width_mm")
            or 0
        )
        thickness_micron = _dec(first_layer.get("thickness_micron") or 0)
        density_gcm3 = _dec(first_layer.get("density_g_cm3") or first_layer.get("density_gcm3") or 0)

        order_qty = _dec(data.get("order_qty") or data.get("weight_kg") or 0)
        qty_uom = str(data.get("uom") or "KG").upper()
        weight_kg = order_qty if qty_uom == "KG" else _dec(data.get("weight_kg") or 0)

        thickness_m = thickness_micron / Decimal("1000000") if thickness_micron > 0 else Decimal("0")
        density_kg_m3 = density_gcm3 * Decimal("1000") if density_gcm3 > 0 else Decimal("0")
        width_m = width_mm / Decimal("1000") if width_mm > 0 else Decimal("0")

        derived_area_m2 = PhysicsEngine.roll_area_m2(weight_kg, thickness_m, density_kg_m3)
        derived_length_m = PhysicsEngine.roll_length_m(derived_area_m2, width_m)

        return {
            "weight_kg": weight_kg,
            "width_mm": width_mm,
            "width_m": width_m,
            "thickness_micron": thickness_micron,
            "thickness_m": thickness_m,
            "density_gcm3": density_gcm3,
            "density_kg_m3": density_kg_m3,
            "derived_area_m2": derived_area_m2,
            "derived_length_m": derived_length_m,
        }

    @staticmethod
    def calculate_total_area(data: Dict[str, Any]) -> Decimal:
        """
        For pouches: per-piece effective area.
        For rolls: total derived area from authoritative mass invariants.
        """
        fg_type = str(data.get("finished_good_type") or "POUCH").upper()
        if fg_type == "ROLL":
            return PhysicsEngine._resolve_roll_invariants(data).get("derived_area_m2", Decimal("0"))

        geometry = data.get("geometry") or {}
        base = geometry.get("base") or {}

        base_width = _dec(base.get("width_mm") or 0)
        base_height = _dec(base.get("height_mm") or 0)

        adjustment_list = geometry.get("adjustments", [])
        width_adj = Decimal("0")
        height_adj = Decimal("0")

        for adj in adjustment_list:
            val = _dec(adj.get("value", 0))
            impact = adj.get("impact") or adj.get("affects_dimension", "WIDTH")
            if impact == "WIDTH":
                width_adj += val
            elif impact == "HEIGHT":
                height_adj += val
            elif impact == "BOTH":
                width_adj += val
                height_adj += val

        multipliers = geometry.get("multipliers") or {}
        faces = _dec(multipliers.get("faces") or 1)

        trim_loss = _dec(geometry.get("trim_loss_mm") or 0)

        effective_width = base_width + width_adj + trim_loss
        effective_height = base_height + height_adj

        if effective_width <= 0 or effective_height <= 0:
            return Decimal("0")

        area_mm2 = effective_width * effective_height * faces
        return area_mm2 / Decimal("1000000")

    @staticmethod
    def calculate_ink_consumption(
        data: Dict[str, Any],
        total_qty: Decimal = Decimal("1"),
        area_override_m2: Decimal | None = None,
    ) -> List[Dict[str, Any]]:
        """
        Ink consumption is always GSM x area.
        For pouch, area is per-piece and multiplied by total_qty.
        For roll, pass area_override_m2 as total derived area and keep total_qty=1.
        """
        printing = data.get("printing") or {}
        if not printing.get("enabled", False):
            return []

        method = str(printing.get("method") or printing.get("type") or "").upper()
        if method:
            printing["method"] = method
            printing["type"] = method

        colors = printing.get("color_names") or []
        if not isinstance(colors, list):
            colors = []
        if not colors:
            colors = [str(c).strip() for c in (printing.get("front_colors") or []) if str(c).strip()]
            colors += [str(c).strip() for c in (printing.get("back_colors") or []) if str(c).strip()]
        if not colors:
            side_count = int(printing.get("front_colors_count") or 0) + int(printing.get("back_colors_count") or 0)
            colors = [f"COLOR-{idx + 1}" for idx in range(max(0, side_count))]

        total_color_count = len(colors)
        ink_gsm_total = _dec(printing.get("ink_gsm_total") or printing.get("ink_gsm") or 0)
        gsm = _dec(printing.get("gsm_per_color") or 0)
        if gsm <= 0 and ink_gsm_total > 0 and total_color_count > 0:
            gsm = ink_gsm_total / _dec(total_color_count)

        area = _dec(area_override_m2) if area_override_m2 is not None else PhysicsEngine.calculate_total_area(data)
        multiplier = Decimal("1") if area_override_m2 is not None else _dec(total_qty, Decimal("1"))

        film_layers = data.get("film_layers") or []
        is_pet_structure = False
        for layer in film_layers:
            density = _dec(layer.get("density_g_cm3") or 0)
            if density >= Decimal("1.4"):
                is_pet_structure = True
                break

        base = "PET" if is_pet_structure else "POLY"
        per_color_kg = (area * gsm * multiplier) / Decimal("1000")
        consumptions = []
        from apps.inventory.models import InkMaterial
        mapping = printing.get("color_mapping") or {}

        for color in colors:
            ink = None
            try:
                material_id = mapping.get(color) or mapping.get(str(color).upper())
                if material_id:
                    ink = InkMaterial.objects.get(id=material_id)
                else:
                    ink = InkMaterial.objects.get(base_type=base, color_name=color.upper())

                consumptions.append(
                    {
                        "material_id": str(ink.id),
                        "material_code": ink.code,
                        "color": color,
                        "weight_kg": float(round(per_color_kg, 6)),
                    }
                )
            except Exception:
                consumptions.append(
                    {
                        "material_id": None,
                        "material_code": f"INK-{base}-{str(color).upper()} (UNMAPPED)",
                        "color": color,
                        "weight_kg": float(round(per_color_kg, 6)),
                    }
                )

        return consumptions

    @staticmethod
    def calculate_pod_consumption(data: Dict[str, Any], total_qty: Decimal = Decimal("1")) -> Dict[str, Any] | None:
        """
        POD film is only meaningful for discrete pouch flows.
        Master-authoritative profile:
        - fixed height (mm)
        - thickness (micron)
        - density (g/cm3)
        - panel count
        Width always derives from pouch effective width.
        """
        fg_type = str(data.get("finished_good_type") or "POUCH").upper()
        if fg_type == "ROLL":
            return None

        packaging_snapshot = data.get("packaging_snapshot") if isinstance(data.get("packaging_snapshot"), dict) else {}
        pod_cfg = packaging_snapshot.get("pod") if isinstance(packaging_snapshot.get("pod"), dict) else {}

        pod_enabled = bool(
            data.get("pod_enabled")
            if data.get("pod_enabled") is not None
            else pod_cfg.get("enabled")
        )
        pod_profile_id = str(
            data.get("pod_profile_id")
            or pod_cfg.get("pod_profile_id")
            or ""
        ).strip()

        if not pod_enabled:
            return None
        if not pod_profile_id:
            return None

        from apps.materials.models import InventoryMaterial

        profile = (
            InventoryMaterial.objects.filter(
                id=pod_profile_id,
                category="POD",
                status="ACTIVE",
            )
            .only(
                "id",
                "code",
                "name",
                "pod_type",
                "pod_fixed_height_mm",
                "pod_thickness_micron",
                "pod_panel_count",
                "density_gcm3",
            )
            .first()
        )

        if profile is None:
            return None

        geometry = data.get("geometry") or {}
        base = geometry.get("base") if isinstance(geometry.get("base"), dict) else {}
        base_width = _dec(base.get("width_mm") or geometry.get("width_mm") or 0)
        adjustment_list = geometry.get("adjustments") or []
        width_adj = Decimal("0")
        for adj in adjustment_list:
            val = _dec(adj.get("value", 0))
            impact = adj.get("impact") or adj.get("affects_dimension", "WIDTH")
            if impact in ["WIDTH", "BOTH"]:
                width_adj += val

        effective_width_mm = base_width + width_adj
        pod_type = str(getattr(profile, "pod_type", "") or "NONE").upper()
        fixed_height_mm = _dec(getattr(profile, "pod_fixed_height_mm", 0))
        thickness_micron = _dec(getattr(profile, "pod_thickness_micron", 0))
        density_gcm3 = _dec(getattr(profile, "density_gcm3", 0))
        panel_count = _dec(getattr(profile, "pod_panel_count", 1), Decimal("1"))

        if effective_width_mm <= 0:
            return None
        if fixed_height_mm <= 0 or thickness_micron <= 0 or density_gcm3 <= 0 or panel_count <= 0:
            return None

        width_m = effective_width_mm / Decimal("1000")
        height_m = fixed_height_mm / Decimal("1000")
        thickness_m = thickness_micron / Decimal("1000000")
        density_kg_m3 = density_gcm3 * Decimal("1000")
        area_m2_per_piece = width_m * height_m * panel_count
        pod_kg = area_m2_per_piece * thickness_m * density_kg_m3 * _dec(total_qty, Decimal("1"))

        return {
            "material_id": str(profile.id),
            "pod_type": pod_type,
            "material_code": str(profile.code),
            "profile_name": str(profile.name or profile.code),
            "profile_id": str(profile.id),
            "panel_count": float(panel_count),
            "fixed_height_mm": float(round(fixed_height_mm, 2)),
            "thickness_micron": float(round(thickness_micron, 4)),
            "density_gcm3": float(round(density_gcm3, 4)),
            "weight_kg": float(round(pod_kg, 6)),
            "area_m2": float(round(area_m2_per_piece, 6)),
        }

    @staticmethod
    def _calculate_roll(data: Dict[str, Any]) -> Dict[str, Any]:
        invariants = PhysicsEngine._resolve_roll_invariants(data)
        weight_kg = invariants["weight_kg"]
        area_m2 = invariants["derived_area_m2"]
        derived_length_m = invariants["derived_length_m"]

        film_layers_input = data.get("film_layers") or []
        film_layers_output = []
        total_film_weight_g = Decimal("0")
        for layer in film_layers_input:
            thickness_micron = _dec(layer.get("thickness_micron") or 0)
            density_gcm3 = _dec(layer.get("density_g_cm3") or 0)
            if area_m2 <= 0 or thickness_micron <= 0 or density_gcm3 <= 0:
                film_layers_output.append({"weight_g": 0.0})
                continue
            layer_weight_kg = (area_m2 * thickness_micron * density_gcm3) / Decimal("1000")
            film_layers_output.append({"weight_g": float(round(layer_weight_kg * Decimal("1000"), 4))})
            total_film_weight_g += layer_weight_kg * Decimal("1000")

        ink_consumptions = PhysicsEngine.calculate_ink_consumption(
            data,
            total_qty=Decimal("1"),
            area_override_m2=area_m2,
        )
        total_ink_weight_g = sum(_dec(i.get("weight_kg") or 0) for i in ink_consumptions) * Decimal("1000")
        inks_output = []
        for inc in ink_consumptions:
            w_kg = _dec(inc.get("weight_kg") or 0)
            inks_output.append(
                {
                    "color": str(inc.get("color", "Unknown")),
                    "material_code": str(inc.get("material_code", "UNMAPPED")),
                    "weight_g": float(round(w_kg * Decimal("1000"), 4)),
                    "weight_kg": float(round(w_kg, 6)),
                }
            )

        chemicals = data.get("chemicals") if isinstance(data.get("chemicals"), dict) else {}
        adh_gsm = _dec(chemicals.get("adhesive_gsm") or 0)
        sol_gsm = _dec(chemicals.get("solvent_gsm") or 0)
        chemicals_output = []
        total_chem_weight_g = Decimal("0")
        if area_m2 > 0 and adh_gsm > 0:
            adh_kg = (area_m2 * adh_gsm) / Decimal("1000")
            chemicals_output.append({"type": "ADHESIVE", "gsm": float(adh_gsm), "weight_g": float(round(adh_kg * Decimal("1000"), 4))})
            total_chem_weight_g += adh_kg * Decimal("1000")
        if area_m2 > 0 and sol_gsm > 0:
            sol_kg = (area_m2 * sol_gsm) / Decimal("1000")
            chemicals_output.append({"type": "SOLVENT", "gsm": float(sol_gsm), "weight_g": float(round(sol_kg * Decimal("1000"), 4))})
            total_chem_weight_g += sol_kg * Decimal("1000")

        return {
            "geometry_snapshot": {
                "finished_good_type": "ROLL",
                "effective_width_mm": float(round(invariants["width_mm"], 2)),
                "effective_height_mm": 0.0,
                "area_m2": float(round(area_m2, 6)),
                "pod_type": "NONE",
            },
            "roll_preview": {
                "weight_kg": float(round(weight_kg, 4)),
                "width_mm": float(round(invariants["width_mm"], 2)),
                "thickness_micron": float(round(invariants["thickness_micron"], 4)),
                "density_gcm3": float(round(invariants["density_gcm3"], 6)),
                "derived_area_m2": float(round(area_m2, 6)),
                "derived_length_m": float(round(derived_length_m, 6)),
            },
            "breakdown": {
                "film_layers": film_layers_output,
                "inks": inks_output,
                "chemicals": chemicals_output,
                "addons": [],
                "pod": None,
            },
            "standard_unit_weight_g": 0.0,
            "pod_unit_weight_g": 0.0,
            "unit_weight_g": 0.0,
            "total_weight_g": float(round(weight_kg * Decimal("1000"), 4)),
            "total_weight_kg": float(round(weight_kg, 4)),
            "total_film_weight": float(round(total_film_weight_g, 4)),
            "total_ink_weight": float(round(total_ink_weight_g, 4)),
            "total_chem_weight": float(round(total_chem_weight_g, 4)),
            "total_addon_weight": 0.0,
        }

    @staticmethod
    def _calculate_pouch(data: Dict[str, Any]) -> Dict[str, Any]:
        area_m2 = PhysicsEngine.calculate_total_area(data)

        geometry = data.get("geometry") or {}
        base = geometry.get("base") or {}
        base_width = _dec(base.get("width_mm") or 0)
        base_height = _dec(base.get("height_mm") or 0)
        adjustment_list = geometry.get("adjustments") or []
        width_adj = Decimal("0")
        height_adj = Decimal("0")
        for adj in adjustment_list:
            val = _dec(adj.get("value") or 0)
            impact = adj.get("impact") or adj.get("affects_dimension") or "WIDTH"
            if impact == "WIDTH":
                width_adj += val
            elif impact == "HEIGHT":
                height_adj += val
            elif impact in ["BOTH", "ALL"]:
                width_adj += val
                height_adj += val

        trim_loss = _dec(geometry.get("trim_loss_mm") or 0)
        effective_width = base_width + width_adj + trim_loss
        effective_height = base_height + height_adj

        total_qty = _dec(data.get("order_qty") or 1, Decimal("1"))
        if total_qty <= 0:
            total_qty = Decimal("1")

        film_layers_input = data.get("film_layers") or []
        film_layers_output = []
        total_film_weight = Decimal("0")
        for layer in film_layers_input:
            thickness = _dec(layer.get("thickness_micron") or 0)
            density = _dec(layer.get("density_g_cm3") or 0)
            if thickness <= 0 or density <= 0:
                film_layers_output.append({"weight_g": 0.0})
                continue
            weight = area_m2 * thickness * density * total_qty
            film_layers_output.append({"weight_g": float(round(weight, 4))})
            total_film_weight += weight

        pod_res = PhysicsEngine.calculate_pod_consumption(data, total_qty)
        pod_weight_g = Decimal("0")
        if pod_res:
            pod_weight_g = _dec(pod_res.get("weight_kg") or 0) * Decimal("1000")

        ink_consumptions = PhysicsEngine.calculate_ink_consumption(data, total_qty)
        total_ink_weight = sum(_dec(i.get("weight_kg") or 0) for i in ink_consumptions) * Decimal("1000")
        inks_output = []
        for inc in ink_consumptions:
            w_kg = _dec(inc.get("weight_kg") or 0)
            inks_output.append(
                {
                    "color": str(inc.get("color", "Unknown")),
                    "material_code": str(inc.get("material_code", "UNMAPPED")),
                    "weight_g": float(round(w_kg * Decimal("1000"), 4)),
                    "weight_kg": float(round(w_kg, 6)),
                }
            )

        chemicals = data.get("chemicals") or {}
        total_chem_weight = Decimal("0")
        chemicals_output = []
        if len(film_layers_input) > 0:
            adh_gsm = _dec(chemicals.get("adhesive_gsm") or 0)
            sol_gsm = _dec(chemicals.get("solvent_gsm") or 0)
            adh_weight = area_m2 * adh_gsm * total_qty
            sol_weight = area_m2 * sol_gsm * total_qty
            if adh_gsm > 0:
                chemicals_output.append({"type": "ADHESIVE", "gsm": float(adh_gsm), "weight_g": float(round(adh_weight, 4))})
            if sol_gsm > 0:
                chemicals_output.append({"type": "SOLVENT", "gsm": float(sol_gsm), "weight_g": float(round(sol_weight, 4))})
            total_chem_weight = adh_weight + sol_weight

        addons_input = data.get("addons") or []
        addons_output = []
        total_addon_weight = Decimal("0")
        for addon in addons_input:
            mode = str(addon.get("type") or addon.get("weight_mode") or "FIXED").upper()
            weight_value = _dec(addon.get("weight_value") or 0)
            applies_to = str(addon.get("applies_to") or addon.get("affects_dimension") or "NONE").upper()
            weight = Decimal("0")
            qty = _dec(addon.get("quantity") or addon.get("qty") or 1, Decimal("1"))
            if mode == "PER_MM":
                if applies_to not in ["WIDTH", "HEIGHT", "BOTH"]:
                    applies_to = "WIDTH"
                if applies_to == "WIDTH":
                    weight = weight_value * effective_width * qty
                elif applies_to == "HEIGHT":
                    weight = weight_value * effective_height * qty
                elif applies_to == "BOTH":
                    weight = weight_value * (effective_width + effective_height) * qty
            elif mode in ["PER_PIECE", "FIXED"]:
                weight = weight_value * qty

            weight *= total_qty
            addons_output.append({"weight_g": float(round(weight, 4))})
            total_addon_weight += weight

        total_weight_g = total_film_weight + total_ink_weight + total_chem_weight + total_addon_weight + pod_weight_g
        std_unit_w = (total_weight_g - pod_weight_g) / total_qty if total_qty > 0 else Decimal("0")
        pod_unit_w = pod_weight_g / total_qty if total_qty > 0 else Decimal("0")

        return {
            "geometry_snapshot": {
                "finished_good_type": "POUCH",
                "effective_width_mm": float(round(effective_width, 2)),
                "effective_height_mm": float(round(effective_height, 2)),
                "area_m2": float(round(area_m2, 6)),
                "pod_type": str(pod_res.get("pod_type", "NONE")) if pod_res else "NONE",
            },
            "breakdown": {
                "film_layers": film_layers_output,
                "inks": inks_output,
                "chemicals": chemicals_output,
                "addons": addons_output,
                "pod": pod_res,
            },
            "standard_unit_weight_g": float(std_unit_w),
            "pod_unit_weight_g": float(pod_unit_w),
            "unit_weight_g": float(std_unit_w + pod_unit_w),
            "total_weight_g": float(total_weight_g),
            "total_weight_kg": float(total_weight_g / Decimal("1000")),
            "total_film_weight": float(total_film_weight),
            "total_ink_weight": float(total_ink_weight),
            "total_chem_weight": float(total_chem_weight),
            "total_addon_weight": float(total_addon_weight),
        }

    @staticmethod
    def calculate(data: Dict[str, Any]) -> Dict[str, Any]:
        """
        POUCH:
        - per-piece physics and discrete unit weights.
        ROLL:
        - KG-authoritative preview only.
        - length is derived and never authoritative.
        """
        try:
            fg_type = str(data.get("finished_good_type") or "POUCH").upper()
            if fg_type == "ROLL":
                return PhysicsEngine._calculate_roll(data)
            return PhysicsEngine._calculate_pouch(data)
        except Exception:
            logger.exception("Physics calculation failed")
            return {
                "geometry_snapshot": {
                    "finished_good_type": "ERROR",
                    "area_m2": 0.0,
                },
                "breakdown": {"film_layers": [], "inks": [], "chemicals": [], "addons": [], "pod": None},
                "unit_weight_g": 0.0,
                "total_weight_kg": 0.0,
                "error": "PHYSICS_CALCULATION_FAILED",
            }
