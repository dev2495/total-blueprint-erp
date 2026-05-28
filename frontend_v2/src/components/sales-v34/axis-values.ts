import type { LayerRowState } from "@/components/erp-v3/axis-layer-matrix"
import type { ProductMaster, VariantAxisDef } from "@/services/product-master"

import type { SalesOrderLine } from "./types"

type SizeLike = {
    code?: string
}

export interface SalesAxisBuildResult {
    axisValues: Record<string, any>
    missingRequired: string[]
    missingLabels: string[]
    previewBlocker?: {
        variant_status: "NEW"
        invariant_signature: string
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
        previewBlocker: missingLabels.length && master ? buildPreviewBlocker(master, missingLabels) : undefined,
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

function buildPreviewBlocker(master: ProductMaster, blockers: string[]) {
    return {
        variant_status: "NEW" as const,
        invariant_signature: master.invariant_signature || master.code,
        geometry_snapshot: {},
        layer_snapshot: [],
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
