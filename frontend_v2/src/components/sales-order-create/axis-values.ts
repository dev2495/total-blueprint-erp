import type { LayerRowState } from "@/components/erp/axis-layer-matrix"
import type { ProductMaster, VariantAxisDef } from "@/services/product-master"

import type { SalesOrderLine } from "./types"

type SizeLike = {
    code?: string
    width_mm?: number | string | null
    height_mm?: number | string | null
    roll_width_mm?: number | string | null
    child_target_width_mm?: number | string | null
    target_child_width_mm?: number | string | null
    gusset_mm?: number | string | null
    bottom_gusset_mm?: number | string | null
    flap_tape_mm?: number | string | null
    flap_mm?: number | string | null
    trim_loss_mm?: number | string | null
    pouch_style?: string | null
    pouch_style_master?: string | null
    pouch_style_master_code?: string | null
    pouch_style_roll_axis?: string | null
    stock_form?: string | null
    width_basis?: string | null
    film_area_width_mm?: number | string | null
    roll_form?: string | null
}

export interface SalesAxisBuildResult {
    axisValues: Record<string, any>
    missingRequired: string[]
    missingLabels: string[]
    previewBlocker?: SalesPreviewBlocker
}

export interface SalesPreviewBlocker {
        variant_status: "NEW"
        invariant_signature: string
        source?: "AXIS_BLOCKER" | "PREVIEW_API_ERROR"
        geometry_snapshot: Record<string, any>
        layer_snapshot: any[]
        bom: { planning_lines: any[]; is_complete: false; errors: string[] }
        bom_by_step: any[]
        packaging_lines: any[]
        pod_lines: any[]
        is_complete: false
        blockers: string[]
        checks: Array<{ label: string; ok: false; tone: "error" }>
        errors: string[]
}

const STRUCTURED_AXIS_KEYS = new Set([
    "layer_thicknesses",
    "layer_grades",
    "layer_material_overrides",
    "layer_materials",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
])

const GENERATED_AXIS_KEYS = new Set([
    "size",
    "layer_thicknesses",
    "layer_grades",
    "layer_widths",
    "layer_roll_widths",
    "layer_material_overrides",
    "layer_materials",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
])

export function buildSalesAxisValues(master: ProductMaster | undefined, line: SalesOrderLine, selectedSize?: SizeLike | null): SalesAxisBuildResult {
    const axisValues = sanitizeAxisValues(line.axis_values)
    filterAxisValuesForMaster(axisValues, master)
    const sizeCode = String(line.size_code || axisValues.size || selectedSize?.code || "").trim()
    if (sizeCode) axisValues.size = sizeCode

    const layerThicknesses: Record<string, number> = {}
    const layerGrades: Record<string, string> = {}
    const layerMaterials: Record<string, string> = {}

    ;(master?.layer_template || []).forEach((row, index) => {
        const key = String(index + 1)
        const state = ((line.layer_values || {}) as Record<string, LayerRowState>)[key] || {}
        const filmCode = String(state.film_variant_code || row.film_variant_code || "").trim()
        if (filmCode) layerMaterials[key] = filmCode

        const thickness = Number(state.thickness_micron || row.thickness_micron)
        if (Number.isFinite(thickness) && thickness > 0) layerThicknesses[key] = thickness

        const grade = String(state.grade || row.default_grade || "").trim()
        if (grade) layerGrades[key] = grade
    })

    if (Object.keys(layerThicknesses).length) axisValues.layer_thicknesses = layerThicknesses
    if (Object.keys(layerGrades).length) axisValues.layer_grades = layerGrades
    if (line.addons.length) axisValues.addons = line.addons

    for (const axis of master?.variant_axes || []) {
        const key = String(axis.axis || "").trim()
        if (!key || axisValues[key] !== undefined) continue
        const canonical = normalizeCode(key)

        if (canonical === "ADDONS" || canonical === "ADDON") {
            const defaultValue = defaultAxisValue(axis)
            if (defaultValue) axisValues[key] = [defaultValue]
            continue
        }

        if (canonical === "ARTWORK_MODE") {
            const mode = String(line.artwork_mode || axisValues.artwork_mode || "DEFER").trim()
            if (mode) {
                axisValues[key] = mode
                axisValues.artwork_mode = mode
            }
            continue
        }

        if (canonical === "LAYER_THICKNESSES") {
            if (Object.keys(layerThicknesses).length) axisValues[key] = layerThicknesses
            continue
        }
        if (canonical === "LAYER_GRADES") {
            if (Object.keys(layerGrades).length) axisValues[key] = layerGrades
            continue
        }
        if (canonical === "LAYER_WIDTHS" || canonical === "LAYER_ROLL_WIDTHS") {
            continue
        }
        if (isLayerMaterialAxis(axis)) {
            if (Object.keys(layerMaterials).length) axisValues[key] = layerMaterials
            continue
        }
        const positionalLayer = canonical.match(/^LAYER[_-]?(\d+)$/)
        if (positionalLayer) {
            const filmCode = layerMaterials[String(Number(positionalLayer[1]))]
            if (filmCode) axisValues[key] = filmCode
            continue
        }

        const defaultValue = defaultAxisValue(axis)
        if (defaultValue) axisValues[key] = defaultValue
    }

    const missingRequired = requiredAxisIssues(master, axisValues)
    const missingLabels = missingRequired.map((axisKey) => {
        const axis = (master?.variant_axes || []).find((item) => String(item.axis || "") === axisKey)
        return `${axis?.label || axisKey.replace(/_/g, " ")} is required`
    })

    return {
        axisValues,
        missingRequired,
        missingLabels,
        previewBlocker: missingLabels.length && master
            ? buildPreviewBlocker(master, missingLabels, selectedSize, line)
            : undefined,
    }
}

function requiredAxisIssues(master: ProductMaster | undefined, axisValues: Record<string, any>) {
    const missing: string[] = []
    for (const axis of master?.variant_axes || []) {
        const key = String(axis.axis || "").trim()
        if (!key || !axis.required) continue
        const canonical = normalizeCode(key)
        if (GENERATED_AXIS_KEYS.has(key) || GENERATED_AXIS_KEYS.has(key.toLowerCase()) || canonical === "LAYER_ROLL_WIDTHS") continue
        if (canonical === "ADDONS" || canonical === "ADDON") {
            if (!axisValuePresent(axisValues[key]) && !axisValuePresent(axisValues.addons) && !axisValuePresent(axisValues.addon)) missing.push(key)
            continue
        }
        if (!axisValuePresent(axisValues[key])) missing.push(key)
    }
    return missing
}

function axisValuePresent(value: unknown) {
    if (value === undefined || value === null || value === "") return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(axisValuePresent)
    return true
}

function isLayerMaterialAxis(axis: VariantAxisDef) {
    const key = normalizeCode(axis.axis)
    const type = normalizeCode((axis as any).type)
    return [
        "LAYER_MATERIAL_OVERRIDES",
        "LAYER_MATERIALS",
        "FILM_VARIANT_BY_LAYER",
        "LAYER_FILM_VARIANTS",
        "MATERIAL_BY_LAYER",
    ].includes(key) || ["LAYER_MATERIAL_ENUM", "PER_LAYER_MATERIAL_ENUM", "LAYER_FILM_VARIANT_ENUM", "PER_LAYER_FILM_VARIANT_ENUM"].includes(type)
}

function defaultAxisValue(axis: VariantAxisDef) {
    const raw = (axis as any).default_value
    const scalar = axisScalarValue(raw)
    return scalar === undefined || scalar === "" ? "" : String(scalar)
}

function axisScalarValue(value: unknown): any {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value)) return value.map(axisScalarValue).filter((v) => v !== undefined && v !== "")
    if (typeof value === "object") {
        const row = value as Record<string, unknown>
        return axisScalarValue(row.code || row.value || row.id || row.material_code || row.pod_sku_code || row.addon_code || row.size_code)
    }
    return value
}

function sanitizeAxisValues(raw: unknown): Record<string, any> {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : {}
    const out: Record<string, any> = {}
    Object.entries(src).forEach(([key, value]) => {
        if (STRUCTURED_AXIS_KEYS.has(key) && value && typeof value === "object") {
            out[key] = value
            return
        }
        const scalar = axisScalarValue(value)
        if (scalar === undefined || scalar === "" || (Array.isArray(scalar) && scalar.length === 0)) return
        out[key] = scalar
    })
    return out
}

function normalizeCode(value: unknown) {
    return String(value || "").trim().toUpperCase()
}

export function buildPreviewBlocker(
    master: ProductMaster,
    blockers: string[],
    selectedSize?: SizeLike | null,
    line?: SalesOrderLine,
    source: SalesPreviewBlocker["source"] = "AXIS_BLOCKER",
) {
    const size = selectedSize || {}
    const layerValues = (line?.layer_values || {}) as Record<string, LayerRowState>
    const widthMm = numberOrNull(size.width_mm)
    const heightMm = numberOrNull(size.height_mm)
    const childWidthMm = numberOrNull(size.child_target_width_mm ?? size.target_child_width_mm ?? size.roll_width_mm)
    const rollWidthMm = numberOrNull(size.roll_width_mm ?? childWidthMm)
    const layerSnapshot = (master.layer_template || []).map((row, index) => {
        const key = String(index + 1)
        const state = layerValues[key] || {}
        return {
            role: row.role || `L${index + 1}`,
            film_variant_code: state.film_variant_code || row.film_variant_code || "",
            thickness_micron: numberOrNull(state.thickness_micron ?? row.thickness_micron),
            grade: state.grade || row.default_grade || "",
        }
    }).filter((row) => row.film_variant_code || row.thickness_micron || row.grade)

    return {
        variant_status: "NEW" as const,
        invariant_signature: master.invariant_signature || master.code,
        source,
        geometry_snapshot: {
            product_kind: master.product_kind,
            fg_type: (master as any).fixed_attributes?.fg_type,
            kind: (master as any).fixed_attributes?.fg_type || master.product_kind,
            size_code: size.code || line?.size_code || "",
            width_mm: widthMm,
            height_mm: heightMm,
            roll_width_mm: rollWidthMm,
            child_target_width_mm: childWidthMm,
            target_child_width_mm: childWidthMm,
            gusset_mm: numberOrNull(size.gusset_mm),
            bottom_gusset_mm: numberOrNull(size.bottom_gusset_mm),
            flap_tape_mm: numberOrNull(size.flap_tape_mm ?? size.flap_mm),
            trim_loss_mm: numberOrNull(size.trim_loss_mm),
            pouch_style: size.pouch_style,
            pouch_style_master: size.pouch_style_master,
            pouch_style_master_code: size.pouch_style_master_code,
            pouch_style_roll_axis: size.pouch_style_roll_axis,
            stock_form: size.stock_form,
            width_basis: size.width_basis,
            film_area_width_mm: numberOrNull(size.film_area_width_mm),
            roll_form: size.roll_form,
        },
        layer_snapshot: layerSnapshot,
        bom: { planning_lines: [], is_complete: false as const, errors: blockers },
        bom_by_step: [],
        packaging_lines: [],
        pod_lines: [],
        is_complete: false as const,
        blockers,
        checks: blockers.map((label) => ({ label, ok: false as const, tone: "error" as const })),
        errors: blockers,
    }
}

function filterAxisValuesForMaster(axisValues: Record<string, any>, master: ProductMaster | undefined) {
    if (!master) return
    const declared = new Set((master.variant_axes || []).map((axis) => String(axis.axis || "").trim()).filter(Boolean))
    const declaredCanonical = new Set(Array.from(declared).map(normalizeCode))
    Object.keys(axisValues).forEach((key) => {
        const canonical = normalizeCode(key)
        if (GENERATED_AXIS_KEYS.has(key) || GENERATED_AXIS_KEYS.has(key.toLowerCase()) || GENERATED_AXIS_KEYS.has(canonical)) return
        if (canonical === "ADDONS" || canonical === "ADDON" || canonical === "ARTWORK_MODE") return
        if (declared.has(key) || declaredCanonical.has(canonical)) return
        delete axisValues[key]
    })
}

function numberOrNull(value: unknown) {
    const next = Number(value)
    return Number.isFinite(next) && next > 0 ? next : null
}
