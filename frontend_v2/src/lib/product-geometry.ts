import type { ProductKind, ProductMasterSize } from "@/services/product-master"

export type DimensionImpact = "WIDTH" | "HEIGHT" | "BOTH" | "NONE"
export type ProductOutputKind = "POUCH" | "ROLL" | "OTHER"

const IMPACTS: DimensionImpact[] = ["WIDTH", "HEIGHT", "BOTH", "NONE"]

export function resolveProductOutputKind(
    kind?: ProductKind | string | null,
    packagingKind?: string | null,
    fixedFgType?: string | null,
): ProductOutputKind {
    const productKind = String(kind || "").toUpperCase()
    const packKind = String(packagingKind || "").toUpperCase()
    const fgType = String(fixedFgType || "").toUpperCase()

    if (fgType === "ROLL" || fgType === "POUCH") return fgType
    if (productKind === "ROLL" || productKind === "POD") return "ROLL"
    if (productKind === "POUCH") return "POUCH"
    if (productKind === "PACKAGING") {
        if (packKind === "SHEET") return "ROLL"
        if (packKind === "INNER_POUCH") return "POUCH"
        return "OTHER"
    }
    return "OTHER"
}

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
    if (style === "CENTER_SEAL") return { applyTo: "NONE", factor: 0 }
    return { applyTo: "NONE", factor: 1 }
}

/**
 * CENTER_SEAL (form-fill-seal pillow) wraps around the H axis, so the roll
 * width must come from H — not W. Other styles use W. Anywhere we compute
 * roll-width or print the formula chip, this gate decides which dimension
 * to use.
 */
export function pouchUsesHeightForRoll(pouchStyle?: string) {
    return String(pouchStyle || "").toUpperCase() === "CENTER_SEAL"
}

/**
 * Geometry-field visibility per pouch style. Hides fields that don't apply so
 * the size editor stays minimal — gusset isn't shown on flat pouches, flap/tape
 * is only relevant where there's a closure tape, etc.
 */
export function pouchStyleFields(pouchStyle: string | undefined): {
    gusset: boolean
    gussetFactor: boolean
    gussetAffects: boolean
    flapTape: boolean
    trimLoss: boolean
} {
    const s = String(pouchStyle || "").toUpperCase()
    // No gusset: pillow, 3-side seal, centre seal, sachet, stick pack, plain
    if (s === "PILLOW" || s === "THREE_SIDE_SEAL" || s === "CENTER_SEAL" || s === "SACHET" || s === "STICK_PACK") {
        return { gusset: false, gussetFactor: false, gussetAffects: false, flapTape: false, trimLoss: true }
    }
    // Has gusset + factor + direction
    if (s === "STAND_UP" || s === "SIDE_GUSSET" || s === "QUAD_SEAL" || s === "FLAT_BOTTOM" || s === "SPOUT") {
        return { gusset: true, gussetFactor: true, gussetAffects: true, flapTape: s === "STAND_UP" || s === "SPOUT", trimLoss: true }
    }
    // SHAPED / fallback — show everything so admin can configure
    return { gusset: true, gussetFactor: true, gussetAffects: true, flapTape: true, trimLoss: true }
}

/**
 * Plain-English roll-width formula per pouch style — what Auto roll width
 * resolves to before any override. Surfaced as a chip under the pouch style
 * dropdown so the operator can sanity-check the math (and override it via
 * `roll_width_mm` if the press needs a different feed).
 */
export function rollWidthFormula(pouchStyle: string | undefined): string {
    const style = String(pouchStyle || "").toUpperCase()
    if (style === "CENTER_SEAL") return `child width from H-axis · pitch W`
    if (style === "STAND_UP" || style === "SPOUT") return `child width from pouch-style formula · pitch H`
    if (style === "QUAD_SEAL" || style === "FLAT_BOTTOM") return `child width includes gusset formula · pitch H`
    if (style === "SIDE_GUSSET") return `child width includes side-gusset formula · pitch H`
    if (style === "PILLOW" || style === "THREE_SIDE_SEAL") return `child width from W-axis · pitch H`
    if (style === "SACHET" || style === "STICK_PACK") return `child width from pouch-style formula`
    if (style === "SHAPED") return `manual child stock width`
    return `child width from pouch-style formula`
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

    // Effective finished geometry = the actual product (pouch) dimensions
    // including width / height adjustments + flap-tape + gusset.
    let effectiveWidthMm = width + widthAdjustment
    let effectiveHeightMm = isRollOutput ? 0 : height + heightAdjustment + flapTape
    if (!isRollOutput) {
        ;({ width: effectiveWidthMm, height: effectiveHeightMm } = applyDelta(
            effectiveWidthMm,
            effectiveHeightMm,
            gusset * gussetFactor,
            gussetApplyTo
        ))
    }

    // Final model: ProductMasterSize carries child_target_width_mm for physical
    // stock matching and film_area_width_mm for BOM/costing weight. Legacy rows
    // without those fields fall back to an open-web two-wall estimate.
    const usesHeightForRoll = pouchUsesHeightForRoll(pouchStyle)
    const rollAxis = usesHeightForRoll ? effectiveHeightMm : effectiveWidthMm
    const rollAxisBase = usesHeightForRoll ? height : width
    // Add trim only on the axis it applies to (matches user's trim_affects pick).
    // BOTH applies trim to both axes; NONE doesn't add anywhere.
    const trimOnRollAxis = (() => {
        if (trimApplyTo === "BOTH") return trimLoss
        if (trimApplyTo === "WIDTH" && !usesHeightForRoll) return trimLoss
        if (trimApplyTo === "HEIGHT" && usesHeightForRoll) return trimLoss
        return 0
    })()
    const childTargetWidthMm = asNumber(source.child_target_width_mm ?? geometryValue(source, "child_target_width_mm"))
    const filmAreaWidthMm = asNumber(source.film_area_width_mm ?? geometryValue(source, "film_area_width_mm"))
    const legacyWidthMultiplier = isRollOutput ? 1 : 2
    const legacyOpenWebWidthMm = rollAxisBase > 0 ? rollAxis * legacyWidthMultiplier + trimOnRollAxis : 0
    const fallbackRollWidthMm = childTargetWidthMm > 0 ? childTargetWidthMm : legacyOpenWebWidthMm
    const explicitRollWidthMm = asNumber(source.roll_width_mm)

    return {
        widthMm: width,
        heightMm: height,
        effectiveWidthMm,
        effectiveHeightMm,
        fallbackRollWidthMm,
        resolvedRollWidthMm: explicitRollWidthMm > 0 ? explicitRollWidthMm : fallbackRollWidthMm,
        explicitRollWidthMm,
        childTargetWidthMm,
        filmAreaWidthMm: filmAreaWidthMm > 0 ? filmAreaWidthMm : fallbackRollWidthMm,
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
