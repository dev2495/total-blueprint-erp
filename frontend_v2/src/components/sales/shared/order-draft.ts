import {
    type PreviewResult,
    type RepeatLineCandidate,
    type SalesSku,
    type SalesSkuVariant,
} from "@/services/sales"

export type OrderDraftSource = "SKU" | "REPEAT" | "CUSTOM"

export type AdjustmentDraft = {
    localId: string
    name: string
    value: number
    impact: "WIDTH" | "HEIGHT" | "BOTH"
}

export type LayerDraft = {
    localId: string
    family_id: string
    variant_id: string
    grade_id?: string | null
    thickness_micron: number
    roll_width_mm: number
}

export type AddonDraft = {
    localId: string
    addon_id: string
    qty: number
    applies_to: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | "PER_PIECE" | "FIXED"
}

export type PackagingLine = {
    material_id: string
    qty: number
    uom: "PCS" | "KG" | "METER"
    basis: "PER_ROLL"
}

export type OrderItemDraft = {
    localId: string
    sourceType: OrderDraftSource
    advancedUnlocked: boolean
    skuVariantId: string
    repeatSourceItemId: string
    template_id: string
    line_name: string
    finished_good_type: "POUCH" | "ROLL"
    roll_form: "FLAT" | "FOLDED" | "TUBING" | ""
    qty_value: number
    qty_uom: "PCS" | "KG"
    price_basis: "PCS" | "KG"
    unit_price: number
    geometry: {
        base: {
            width_mm: number
            height_mm: number
        }
        pouch_style?: string
        gusset_mm?: number
        trim_loss_mm?: number
        flap_tape_mm?: number
        adjustments: AdjustmentDraft[]
        multipliers: {
            faces: number
        }
    }
    film_layers: LayerDraft[]
    printing: {
        enabled: boolean
        type: "FLEXO" | "ROTO" | "DIGITAL"
        substrate_mode: "SHEET" | "TUBING"
        front_colors_count: number
        back_colors_count: number
        ink_gsm_total: number
        artwork_id: string
        defer_artwork_to_planner: boolean
    }
    chemicals: {
        adhesive_gsm: number
        solvent_gsm: number
    }
    addons: AddonDraft[]
    packaging_snapshot: {
        primary_inner_pack: {
            enabled: boolean
            material_id: string
            pcs_per_pack: number
        }
        pod: {
            enabled: boolean
            pod_profile_id: string
            pod_sku_variant_id?: string
            pod_sku_code?: string
            pod_sku_name?: string
        }
        roll_dispatch_pack: {
            enabled: boolean
            lines: PackagingLine[]
        }
    }
    savedPreview?: PreviewResult | null
}

export function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
    return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function asNumber(value: unknown, fallback = 0) {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
}

export function formatMoney(value: number | undefined) {
    return `₹${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function makeAdjustment(): AdjustmentDraft {
    return { localId: makeId(), name: "", value: 0, impact: "WIDTH" }
}

export function makeLayer(): LayerDraft {
    return { localId: makeId(), family_id: "", variant_id: "", grade_id: null, thickness_micron: 0, roll_width_mm: 0 }
}

export function makeAddon(): AddonDraft {
    return { localId: makeId(), addon_id: "", qty: 1, applies_to: "PER_PIECE" }
}

export function normalizePouchStyle(value: unknown) {
    return String(value || "").trim().toUpperCase()
}

export function isGussetStyle(style: unknown) {
    return ["STAND_UP", "SIDE_GUSSET", "QUAD_SEAL", "FLAT_BOTTOM", "SPOUT"].includes(normalizePouchStyle(style))
}

export function isSpoutStyle(style: unknown) {
    return normalizePouchStyle(style) === "SPOUT"
}

function resolvePouchStyleFallback(
    finishedGoodType: OrderItemDraft["finished_good_type"],
    ...candidates: unknown[]
) {
    if (String(finishedGoodType || "POUCH").toUpperCase() !== "POUCH") return ""
    for (const candidate of candidates) {
        const normalized = normalizePouchStyle(candidate)
        if (normalized) return normalized
    }
    return "PILLOW"
}

export function classifyAddonMaster(addon: any) {
    const code = String(addon?.code || addon?.name || "").toUpperCase()
    const isSpoutCompatible = ["SPOUT", "FITMENT", "VALVE"].some((token) => code.includes(token))
    return {
        code: String(addon?.code || ""),
        isSpoutCompatible,
        weight_mode: String(addon?.weight_mode || "PER_PIECE").toUpperCase(),
        weight_value: asNumber(addon?.weight_value, 0),
    }
}

export function getOrderItemContractIssues(
    item: OrderItemDraft,
    addonsMaster: any[],
    templatePouchStyle = ""
) {
    const issues: string[] = []
    const fgType = String(item.finished_good_type || "POUCH").toUpperCase()
    const lockedPouchStyle = normalizePouchStyle(templatePouchStyle || item.geometry.pouch_style)

    if (!item.template_id) {
        issues.push("Link a LIVE template before preview or save.")
    }

    if (fgType === "POUCH") {
        if (!lockedPouchStyle) {
            issues.push("Pouch style is missing from the linked LIVE template.")
        }
        if (asNumber(item.geometry.base.width_mm, 0) <= 0) {
            issues.push("Width must be greater than zero.")
        }
        if (asNumber(item.geometry.base.height_mm, 0) <= 0) {
            issues.push("Height must be greater than zero.")
        }
        if (asNumber(item.geometry.trim_loss_mm, 0) < 0) {
            issues.push("Trim loss cannot be negative.")
        }
        if (asNumber(item.geometry.flap_tape_mm, 0) < 0) {
            issues.push("Flap or tape allowance cannot be negative.")
        }
        if (isGussetStyle(lockedPouchStyle) && asNumber(item.geometry.gusset_mm, 0) <= 0) {
            issues.push(`${lockedPouchStyle.replaceAll("_", " ")} requires gusset.`)
        }
        if (item.addons.some((addon) => addon.addon_id && asNumber(addon.qty, 0) <= 0)) {
            issues.push("Add-on quantity must be greater than zero.")
        }
        if (item.addons.some((addon) => !addon.addon_id && asNumber(addon.qty, 0) > 0)) {
            issues.push("Choose an approved add-on master for every add-on row.")
        }
        if (isSpoutStyle(lockedPouchStyle)) {
            const hasSpoutAddon = item.addons.some((addon) => {
                if (!addon.addon_id) return false
                const meta = addonsMaster.find((row: any) => String(row.id) === String(addon.addon_id))
                return classifyAddonMaster(meta).isSpoutCompatible
            })
            if (!hasSpoutAddon) {
                issues.push("Spout style requires a spout, fitment, or valve add-on.")
            }
        }
    }

    const requiresExplicitLayerContract = item.sourceType === "CUSTOM" || item.advancedUnlocked
    if (requiresExplicitLayerContract) {
        const incompleteLayerIndex = item.film_layers.findIndex((layer) => !layer.family_id || !layer.variant_id)
        if (incompleteLayerIndex >= 0) {
            issues.push(`Layer ${incompleteLayerIndex + 1} must include both film family and film variant.`)
        }
        if (item.film_layers.some((layer) => asNumber(layer.thickness_micron, 0) <= 0)) {
            issues.push("Each film layer must have thickness greater than zero.")
        }
        if (item.film_layers.some((layer) => asNumber(layer.roll_width_mm, 0) <= 0)) {
            issues.push("Each film layer must have roll width greater than zero.")
        }
    }

    return Array.from(new Set(issues))
}

function hydrateGeometry(sourceGeometry: any, fallbackStyle = ""): OrderItemDraft["geometry"] {
    const geometry = sourceGeometry || {}
    const base = geometry?.base || {}
    return {
        base: {
            width_mm: asNumber(base?.width_mm || geometry?.width_mm, 0),
            height_mm: asNumber(base?.height_mm || geometry?.height_mm, 0),
        },
        pouch_style: normalizePouchStyle(geometry?.pouch_style || fallbackStyle),
        gusset_mm: asNumber(geometry?.gusset_mm, 0),
        trim_loss_mm: asNumber(geometry?.trim_loss_mm, 0),
        flap_tape_mm: asNumber(geometry?.flap_tape_mm, 0),
        adjustments: Array.isArray(geometry?.adjustments)
            ? geometry.adjustments.map((row: any) => ({
                localId: makeId(),
                name: String(row?.name || ""),
                value: asNumber(row?.value, 0),
                impact: (String(row?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"]),
            }))
            : [],
        multipliers: { faces: asNumber(geometry?.multipliers?.faces, 1) },
    }
}

export function normalizePackagingSnapshot(snapshot: any): OrderItemDraft["packaging_snapshot"] {
    const source = snapshot || {}
    const primary = source?.primary_inner_pack || {}
    const pod = source?.pod || {}
    const rollDispatch = source?.roll_dispatch_pack || {}
    return {
        primary_inner_pack: {
            enabled: Boolean(primary?.enabled),
            material_id: String(primary?.material_id || ""),
            pcs_per_pack: asNumber(primary?.pcs_per_pack, 100),
        },
        pod: {
            enabled: Boolean(pod?.enabled),
            pod_profile_id: String(pod?.pod_profile_id || ""),
            pod_sku_variant_id: String(pod?.pod_sku_variant_id || ""),
            pod_sku_code: String(pod?.pod_sku_code || ""),
            pod_sku_name: String(pod?.pod_sku_name || ""),
        },
        roll_dispatch_pack: {
            enabled: Boolean(rollDispatch?.enabled),
            lines: Array.isArray(rollDispatch?.lines)
                ? rollDispatch.lines.map((row: any) => ({
                    material_id: String(row?.material_id || ""),
                    qty: asNumber(row?.qty, 1),
                    uom: (String(row?.uom || "PCS").toUpperCase() as PackagingLine["uom"]),
                    basis: "PER_ROLL",
                }))
                : [],
        },
    }
}

export function createEmptyOrderItemDraft(sourceType: OrderDraftSource = "CUSTOM"): OrderItemDraft {
    return {
        localId: makeId(),
        sourceType,
        advancedUnlocked: sourceType === "CUSTOM",
        skuVariantId: "",
        repeatSourceItemId: "",
        template_id: "",
        line_name: sourceType === "CUSTOM" ? "Custom order" : "New order",
        finished_good_type: "POUCH",
        roll_form: "",
        qty_value: 1000,
        qty_uom: "PCS",
        price_basis: "PCS",
        unit_price: 0,
        geometry: {
            base: { width_mm: 120, height_mm: 180 },
            pouch_style: "",
            gusset_mm: 0,
            trim_loss_mm: 0,
            flap_tape_mm: 0,
            adjustments: [],
            multipliers: { faces: 1 },
        },
        film_layers: [makeLayer()],
        printing: {
            enabled: false,
            type: "FLEXO",
            substrate_mode: "SHEET",
            front_colors_count: 0,
            back_colors_count: 0,
            ink_gsm_total: 0,
            artwork_id: "",
            defer_artwork_to_planner: false,
        },
        chemicals: { adhesive_gsm: 0, solvent_gsm: 0 },
        addons: [],
        packaging_snapshot: {
            primary_inner_pack: { enabled: false, material_id: "", pcs_per_pack: 100 },
            pod: { enabled: false, pod_profile_id: "", pod_sku_variant_id: "", pod_sku_code: "", pod_sku_name: "" },
            roll_dispatch_pack: { enabled: false, lines: [] },
        },
        savedPreview: null,
    }
}

export function cloneOrderItemDraft(item: OrderItemDraft): OrderItemDraft {
    return {
        ...item,
        localId: makeId(),
        line_name: `${item.line_name} Copy`,
        savedPreview: null,
        geometry: {
            ...item.geometry,
            adjustments: item.geometry.adjustments.map((row) => ({ ...row, localId: makeId() })),
        },
        film_layers: item.film_layers.map((row) => ({ ...row, localId: makeId() })),
        addons: item.addons.map((row) => ({ ...row, localId: makeId() })),
        packaging_snapshot: {
            ...item.packaging_snapshot,
            roll_dispatch_pack: {
                ...item.packaging_snapshot.roll_dispatch_pack,
                lines: item.packaging_snapshot.roll_dispatch_pack.lines.map((row) => ({ ...row })),
            },
        },
    }
}

export function orderItemFromVariant(sku: SalesSku, variant: SalesSkuVariant): OrderItemDraft {
    const geometry = variant.geometry_snapshot || {}
    const printing = variant.printing_snapshot || {}
    const chemicals = variant.chemicals_snapshot || printing?.chemicals || {}
    const finishedGoodType = (variant.finished_good_type || "POUCH") as "POUCH" | "ROLL"
    return {
        localId: makeId(),
        sourceType: "SKU",
        advancedUnlocked: false,
        skuVariantId: variant.id,
        repeatSourceItemId: "",
        template_id: variant.template || sku.template,
        line_name: variant.name || sku.default_line_name || sku.name,
        finished_good_type: finishedGoodType,
        roll_form: (variant.roll_form || "") as OrderItemDraft["roll_form"],
        qty_value: 1000,
        qty_uom: finishedGoodType === "ROLL" ? "KG" : "PCS",
        price_basis: finishedGoodType === "ROLL" ? "KG" : "PCS",
        unit_price: 0,
        geometry: hydrateGeometry(geometry, resolvePouchStyleFallback(finishedGoodType, geometry?.pouch_style)),
        film_layers: Array.isArray(variant.layer_snapshot) && variant.layer_snapshot.length
            ? variant.layer_snapshot.map((row: any) => ({
                localId: makeId(),
                family_id: String(row?.family_id || ""),
                variant_id: String(row?.variant_id || ""),
                grade_id: row?.grade_id ? String(row.grade_id) : null,
                thickness_micron: asNumber(row?.thickness_micron, 0),
                roll_width_mm: asNumber(row?.roll_width_mm || row?.width_mm, 0),
            }))
            : [makeLayer()],
        printing: {
            enabled: Boolean(printing?.enabled),
            type: (String(printing?.type || "FLEXO").toUpperCase() as OrderItemDraft["printing"]["type"]),
            substrate_mode: (String(printing?.substrate_mode || "SHEET").toUpperCase() as OrderItemDraft["printing"]["substrate_mode"]),
            front_colors_count: asNumber(printing?.front_colors_count, 0),
            back_colors_count: asNumber(printing?.back_colors_count, 0),
            ink_gsm_total: asNumber(printing?.ink_gsm_total, 0),
            artwork_id: String(printing?.artwork_id || ""),
            defer_artwork_to_planner: Boolean(printing?.defer_artwork_to_planner),
        },
        chemicals: {
            adhesive_gsm: asNumber(chemicals?.adhesive_gsm, 0),
            solvent_gsm: asNumber(chemicals?.solvent_gsm, 0),
        },
        addons: Array.isArray(variant.addons_snapshot)
            ? variant.addons_snapshot.map((row: any) => ({
                localId: makeId(),
                addon_id: String(row?.addon_id || ""),
                qty: asNumber(row?.qty, 1),
                applies_to: (String(row?.applies_to || row?.weight_mode || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"]),
            }))
            : [],
        packaging_snapshot: normalizePackagingSnapshot(variant.packaging_snapshot),
        savedPreview: null,
    }
}

export function orderItemFromRepeat(candidate: RepeatLineCandidate): OrderItemDraft {
    const geometry = candidate.geometry_snapshot || {}
    const printing = candidate.printing_snapshot || {}
    const templatePouchStyle = String(candidate.summary?.pouch_style || "")
    const finishedGoodType = (candidate.summary?.finished_good_type || "POUCH") as "POUCH" | "ROLL"
    return {
        localId: makeId(),
        sourceType: "REPEAT",
        advancedUnlocked: false,
        skuVariantId: candidate.sku_variant_id || "",
        repeatSourceItemId: candidate.id,
        template_id: candidate.template_id,
        line_name: candidate.line_name || candidate.template_name,
        finished_good_type: finishedGoodType,
        roll_form: (candidate.summary?.roll_form || "") as OrderItemDraft["roll_form"],
        qty_value: asNumber(candidate.qty_value, 0),
        qty_uom: candidate.qty_uom,
        price_basis: candidate.price_basis,
        unit_price: asNumber(candidate.unit_price, 0),
        geometry: hydrateGeometry(
            geometry,
            resolvePouchStyleFallback(finishedGoodType, templatePouchStyle, geometry?.pouch_style),
        ),
        film_layers: Array.isArray(candidate.layer_snapshot) && candidate.layer_snapshot.length
            ? candidate.layer_snapshot.map((row: any) => ({
                localId: makeId(),
                family_id: String(row?.family_id || ""),
                variant_id: String(row?.variant_id || ""),
                grade_id: row?.grade_id ? String(row.grade_id) : null,
                thickness_micron: asNumber(row?.thickness_micron, 0),
                roll_width_mm: asNumber(row?.roll_width_mm || row?.width_mm, 0),
            }))
            : [makeLayer()],
        printing: {
            enabled: Boolean(printing?.enabled),
            type: (String(printing?.type || "FLEXO").toUpperCase() as OrderItemDraft["printing"]["type"]),
            substrate_mode: (String(printing?.substrate_mode || "SHEET").toUpperCase() as OrderItemDraft["printing"]["substrate_mode"]),
            front_colors_count: asNumber(printing?.front_colors_count, 0),
            back_colors_count: asNumber(printing?.back_colors_count, 0),
            ink_gsm_total: asNumber(printing?.ink_gsm_total, 0),
            artwork_id: String(printing?.artwork_id || ""),
            defer_artwork_to_planner: Boolean(printing?.defer_artwork_to_planner),
        },
        chemicals: {
            adhesive_gsm: asNumber(candidate.chemicals_snapshot?.adhesive_gsm, 0),
            solvent_gsm: asNumber(candidate.chemicals_snapshot?.solvent_gsm, 0),
        },
        addons: Array.isArray(candidate.addons_snapshot)
            ? candidate.addons_snapshot.map((row: any) => ({
                localId: makeId(),
                addon_id: String(row?.addon_id || ""),
                qty: asNumber(row?.qty, 1),
                applies_to: (String(row?.applies_to || row?.weight_mode || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"]),
            }))
            : [],
        packaging_snapshot: normalizePackagingSnapshot(candidate.packaging_snapshot),
        savedPreview: null,
    }
}

export function buildPreviewPayload(item: OrderItemDraft, families: any[], variants: any[], addonsMaster: any[]) {
    const payload = buildOrderItemPayload(item, families, variants, addonsMaster)
    return {
        template_id: payload.template_id,
        finished_good_type: payload.fg_type,
        geometry: payload.geometry,
        film_layers: payload.film_layers,
        printing: payload.printing,
        chemicals: payload.chemicals,
        addons: payload.addons,
        packaging_snapshot: payload.packaging_snapshot,
        roll_form: payload.roll_form,
        order_qty: payload.qty_value,
        uom: payload.qty_uom,
    }
}

export function buildOrderItemPayload(item: OrderItemDraft, families: any[], variants: any[], addonsMaster: any[]) {
    const normalizedAdjustments = item.geometry.adjustments.map((adjustment) => ({
        name: adjustment.name,
        value: asNumber(adjustment.value, 0),
        impact: adjustment.impact,
    }))
    const fgType = String(item.finished_good_type || "POUCH").toUpperCase() as "POUCH" | "ROLL"
    const qtyUom = fgType === "ROLL" ? "KG" : item.qty_uom
    const priceBasis = fgType === "ROLL" ? "KG" : item.price_basis
    const pouchHeight = asNumber(item.geometry.base.height_mm, 0)
    const primaryRollWidth = asNumber(item.film_layers[0]?.roll_width_mm, 0)

    const filmLayers = item.film_layers.map((layer) => {
        const family = families.find((row: any) => String(row.id) === String(layer.family_id))
        const variant = variants.find((row: any) => String(row.id) === String(layer.variant_id))
        const density = asNumber(variant?.density_gcm3 ?? family?.density_gcm3, 0)
        return {
            family_id: layer.family_id || null,
            variant_id: layer.variant_id || null,
            grade_id: layer.grade_id || null,
            thickness_micron: asNumber(layer.thickness_micron, 0),
            density_g_cm3: density,
            roll_width_mm: asNumber(layer.roll_width_mm, 0),
        }
    })

    const chemicals = item.film_layers.length > 1 ? {
        adhesive_gsm: asNumber(item.chemicals.adhesive_gsm, 0),
        solvent_gsm: asNumber(item.chemicals.solvent_gsm, 0),
    } : {}

    const printing = item.printing.enabled ? {
        enabled: true,
        type: item.printing.type,
        substrate_mode: item.printing.substrate_mode,
        front_colors_count: asNumber(item.printing.front_colors_count, 0),
        back_colors_count: asNumber(item.printing.back_colors_count, 0),
        ink_gsm_total: asNumber(item.printing.ink_gsm_total, 0),
        artwork_id: item.printing.defer_artwork_to_planner ? null : (item.printing.artwork_id || null),
        defer_artwork_to_planner: Boolean(item.printing.defer_artwork_to_planner),
        chemicals,
    } : { enabled: false }

    const addons = item.addons
        .filter((addon) => Boolean(addon.addon_id))
        .map((addon) => {
            const master = addonsMaster.find((row: any) => String(row.id) === String(addon.addon_id))
            const masterMode = String(master?.weight_mode || "PER_PIECE").toUpperCase()
            const finalWeightMode = masterMode === "PER_MM" ? "PER_MM" : masterMode === "FIXED" ? "FIXED" : "PER_PIECE"
            const finalAppliesTo = finalWeightMode === "PER_MM"
                ? (addon.applies_to === "HEIGHT" ? "HEIGHT" : addon.applies_to === "BOTH" ? "BOTH" : "WIDTH")
                : "NONE"
            return {
                addon_id: addon.addon_id,
                code: String(master?.code || ""),
                name: String(master?.name || ""),
                applies_to: finalAppliesTo,
                qty: asNumber(addon.qty, 0),
                weight_mode: finalWeightMode,
                weight_value: asNumber(master?.weight_value, 0),
            }
        })

    const mode = item.sourceType === "CUSTOM" ? "CUSTOM" : item.sourceType === "REPEAT" ? "REPEAT" : "TEMPLATE"

    return {
        template_id: item.template_id,
        sku_variant_id: item.skuVariantId || undefined,
        repeat_source_item_id: item.repeatSourceItemId || undefined,
        mode,
        line_name: item.line_name,
        qty_value: asNumber(item.qty_value, 0),
        qty_uom: qtyUom,
        price_basis: priceBasis,
        unit_price: asNumber(item.unit_price, 0),
        fg_type: fgType,
        roll_form: fgType === "ROLL" ? (item.roll_form || "FLAT") : null,
        geometry: {
            base: {
                width_mm: fgType === "ROLL" ? primaryRollWidth : asNumber(item.geometry.base.width_mm, 0),
                height_mm: fgType === "POUCH" ? pouchHeight : 0,
            },
            pouch_style: fgType === "POUCH" ? normalizePouchStyle(item.geometry.pouch_style) : "",
            gusset_mm: fgType === "POUCH" ? asNumber(item.geometry.gusset_mm, 0) : 0,
            trim_loss_mm: fgType === "POUCH" ? asNumber(item.geometry.trim_loss_mm, 0) : 0,
            flap_tape_mm: fgType === "POUCH" ? asNumber(item.geometry.flap_tape_mm, 0) : 0,
            adjustments: normalizedAdjustments,
            multipliers: {
                faces: Math.max(1, asNumber(item.geometry.multipliers.faces, 1)),
            },
            finished_good_type: fgType,
            roll_form: fgType === "ROLL" ? (item.roll_form || "FLAT") : undefined,
        },
        film_layers: filmLayers,
        printing,
        chemicals,
        addons,
        packaging_snapshot: {
            primary_inner_pack: {
                enabled: fgType === "POUCH" ? Boolean(item.packaging_snapshot.primary_inner_pack.enabled) : false,
                material_id: fgType === "POUCH" && item.packaging_snapshot.primary_inner_pack.enabled ? (item.packaging_snapshot.primary_inner_pack.material_id || null) : null,
                pcs_per_pack: fgType === "POUCH" ? asNumber(item.packaging_snapshot.primary_inner_pack.pcs_per_pack, 0) : 0,
            },
            pod: {
                enabled: fgType === "POUCH" ? Boolean(item.packaging_snapshot.pod.enabled) : false,
                pod_profile_id: fgType === "POUCH" && item.packaging_snapshot.pod.enabled ? (item.packaging_snapshot.pod.pod_profile_id || null) : null,
                pod_sku_variant_id: fgType === "POUCH" && item.packaging_snapshot.pod.enabled ? (item.packaging_snapshot.pod.pod_sku_variant_id || null) : null,
                pod_sku_code: fgType === "POUCH" && item.packaging_snapshot.pod.enabled ? (item.packaging_snapshot.pod.pod_sku_code || null) : null,
                pod_sku_name: fgType === "POUCH" && item.packaging_snapshot.pod.enabled ? (item.packaging_snapshot.pod.pod_sku_name || null) : null,
            },
            roll_dispatch_pack: {
                enabled: fgType === "ROLL" ? Boolean(item.packaging_snapshot.roll_dispatch_pack.enabled) : false,
                lines: fgType === "ROLL"
                    ? item.packaging_snapshot.roll_dispatch_pack.lines
                        .filter((row) => row.material_id && asNumber(row.qty, 0) > 0)
                        .map((row) => ({
                            material_id: row.material_id,
                            qty: asNumber(row.qty, 0),
                            uom: row.uom || "PCS",
                            basis: "PER_ROLL",
                        }))
                    : [],
            },
        },
    }
}
