import type { ProductKind, ProductMasterSize } from "@/services/product-master"

export type DimensionImpact = "WIDTH" | "HEIGHT" | "BOTH" | "NONE"

const IMPACTS: DimensionImpact[] = ["WIDTH", "HEIGHT", "BOTH", "NONE"]

function asNumber(value: unknown, fallback = 0) {
    const next = Number(value)
    return Number.isFinite(next) ? next : fallback
}

export function normalizeDimensionImpact(value: unknown, fallback: DimensionImpact = "WIDTH"): DimensionImpact {
    const raw = String(value || fallback).toUpperCase().trim()
    const aliases: Record<string, DimensionImpact> = {
        W: "WIDTH",
        H: "HEIGHT",
        ALL: "BOTH",
        BOTH_AXES: "BOTH",
        OFF: "NONE",
        NO: "NONE",
    }
    const impact = aliases[raw] || raw
    return IMPACTS.includes(impact as DimensionImpact) ? (impact as DimensionImpact) : fallback
}

export function defaultGussetRule(pouchStyle?: string): { applyTo: DimensionImpact; factor: number } {
    const style = String(pouchStyle || "").toUpperCase()
    if (style === "STAND_UP") return { applyTo: "HEIGHT", factor: 1 }
    if (style === "QUAD_SEAL" || style === "FLAT_BOTTOM") return { applyTo: "WIDTH", factor: 2 }
    if (style === "SIDE_GUSSET" || style === "SPOUT") return { applyTo: "WIDTH", factor: 1 }
    return { applyTo: "NONE", factor: 1 }
}

function applyDelta(width: number, height: number, value: number, impact: DimensionImpact) {
    if (!Number.isFinite(value) || value <= 0) return { width, height }
    if (impact === "WIDTH") return { width: width + value, height }
    if (impact === "HEIGHT") return { width, height: height + value }
    if (impact === "BOTH") return { width: width + value, height: height + value }
    return { width, height }
}

function geometryValue(row: Partial<ProductMasterSize>, key: string) {
    const geometry = row.geometry_config && typeof row.geometry_config === "object" ? row.geometry_config : {}
    return (row as Record<string, unknown>)[key] ?? geometry[key]
}

export function computeProductGeometry(row: Partial<ProductMasterSize> | undefined, kind: ProductKind | string) {
    const source = row || {}
    const productKind = String(kind || "POUCH").toUpperCase()
    const isRollOutput = productKind === "ROLL" || productKind === "POD"
    const width = asNumber(source.width_mm)
    const height = asNumber(source.height_mm)
    const pouchStyle = String(geometryValue(source, "pouch_style") || "STAND_UP").toUpperCase()
    const trimLoss = asNumber(geometryValue(source, "trim_loss_mm"), 10)
    const trimApplyTo = normalizeDimensionImpact(geometryValue(source, "trim_apply_to"), "WIDTH")
    const flapTape = asNumber(geometryValue(source, "flap_tape_mm"))
    const gusset = asNumber(source.gusset_mm)
    const defaultGusset = defaultGussetRule(pouchStyle)
    const gussetApplyTo = normalizeDimensionImpact(geometryValue(source, "gusset_apply_to"), defaultGusset.applyTo)
    const gussetFactor = Math.max(0, asNumber(geometryValue(source, "gusset_factor"), defaultGusset.factor))
    const multipliers =
        source.multipliers && typeof source.multipliers === "object"
            ? source.multipliers
            : source.geometry_config && typeof source.geometry_config === "object"
              ? (source.geometry_config.multipliers as Record<string, unknown> | undefined)
              : undefined
    const faces = Math.max(1, asNumber(source.faces ?? multipliers?.faces, isRollOutput ? 1 : 2))
    const adjustments = Array.isArray(source.adjustments)
        ? source.adjustments
        : Array.isArray(source.geometry_config?.adjustments)
          ? source.geometry_config.adjustments
          : []

    let widthAdjustment = 0
    let heightAdjustment = 0
    for (const adjustment of adjustments) {
        if (!adjustment || typeof adjustment !== "object") continue
        const value = asNumber((adjustment as Record<string, unknown>).value)
        const impact = normalizeDimensionImpact(
            (adjustment as Record<string, unknown>).impact || (adjustment as Record<string, unknown>).affects_dimension,
            "WIDTH"
        )
        if (impact === "WIDTH") widthAdjustment += value
        if (impact === "HEIGHT") heightAdjustment += value
        if (impact === "BOTH") {
            widthAdjustment += value
            heightAdjustment += value
        }
    }

    let effectiveWidthMm = width + widthAdjustment
    let effectiveHeightMm = isRollOutput ? 0 : height + heightAdjustment + flapTape
    ;({ width: effectiveWidthMm, height: effectiveHeightMm } = applyDelta(effectiveWidthMm, effectiveHeightMm, trimLoss, trimApplyTo))
    if (!isRollOutput) {
        ;({ width: effectiveWidthMm, height: effectiveHeightMm } = applyDelta(
            effectiveWidthMm,
            effectiveHeightMm,
            gusset * gussetFactor,
            gussetApplyTo
        ))
    }

    const fallbackRollWidthMm = width > 0 ? effectiveWidthMm * faces : 0
    const explicitRollWidthMm = asNumber(source.roll_width_mm)

    return {
        widthMm: width,
        heightMm: height,
        effectiveWidthMm,
        effectiveHeightMm,
        fallbackRollWidthMm,
        resolvedRollWidthMm: explicitRollWidthMm > 0 ? explicitRollWidthMm : fallbackRollWidthMm,
        explicitRollWidthMm,
        faces,
        trimLossMm: trimLoss,
        trimApplyTo,
        flapTapeMm: flapTape,
        gussetMm: gusset,
        gussetApplyTo,
        gussetFactor,
        pouchStyle,
        widthAdjustmentMm: widthAdjustment,
        heightAdjustmentMm: heightAdjustment,
    }
}

export function autoRollWidthMm(row: Partial<ProductMasterSize> | undefined, kind: ProductKind | string) {
    const value = computeProductGeometry(row, kind).fallbackRollWidthMm
    return Number.isFinite(value) && value > 0 ? value : 0
}

export function resolvedRollWidthMm(row: Partial<ProductMasterSize> | undefined, kind: ProductKind | string) {
    const value = computeProductGeometry(row, kind).resolvedRollWidthMm
    return Number.isFinite(value) && value > 0 ? value : 0
}
