type AnyRecord = Record<string, any>

export type ProductSpecLayer = {
  index: number
  variantCode: string
  variantName: string
  grade: string
  thicknessMicron: number | null
  widthMm: number | null
  label: string
}

export type ProductSpec = {
  customerName: string
  orderNumber: string
  productName: string
  templateName: string
  variantCode: string
  variantName: string
  size: {
    widthMm: number | null
    heightMm: number | null
    gussetMm: number | null
    label: string
    formLabel?: string
    finishedGoodType?: string
  }
  layers: ProductSpecLayer[]
  pouchStyle: string
  podLabels: string[]
  addonLabels: string[]
  hasPod: boolean
  hasAddons: boolean
  qtyValue: number | null
  qtyUom: string
  searchText: string
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const raw = String(value ?? "").trim()
    if (raw && raw !== "—" && !["null", "undefined", "nan"].includes(raw.toLowerCase())) return raw
  }
  return ""
}

function num(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compact(value: number | null): string {
  if (value === null) return ""
  if (Number.isInteger(value)) return String(value)
  const fixed = value.toFixed(3)
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed
}

function layerLabelPartsFromText(label: unknown): string[] {
  return text(label)
    .split(/\s*·\s*/)
    .map((part) => text(part))
    .filter((part) => {
      if (!part) return false
      if (/^L\d+$/i.test(part)) return false
      if (/^\d+(?:\.\d+)?\s*mm$/i.test(part)) return false
      if (/^\d+(?:\.\d+)?\s*mm\s*(?:web|roll)$/i.test(part)) return false
      return true
    })
}

function rollSizeLabel(widthMm: number | null, heightMm: number | null, rollForm: string): string {
    const width = compact(widthMm)
    const height = compact(heightMm)
    const form = rollFormLabel(rollForm)
    if (width && height && height !== "0") return `${width} x ${height} mm${form ? ` · ${form}` : ""}`
    if (width) return `${width} mm roll${form ? ` · ${form}` : ""}`
    return form ? `${form} roll` : "Roll size not captured"
}

function rollFormLabel(rollForm: unknown): string {
    const raw = text(rollForm)
    const key = raw.toUpperCase().replace(/[\s-]+/g, "_")
    if (["FLAT", "SHEET", "OPEN_WEB", "OPENWEB", "OPEN_WEB_WIDTH"].includes(key)) return "Open web"
    if (["TUBE", "LAYFLAT_TUBE", "LAY_FLAT_TUBE", "LAYFLAT", "LAY_FLAT"].includes(key)) return "Lay-flat tube"
    if (["FOLDED", "FOLDED_WEB"].includes(key)) return "Folded web"
    return raw
}

function list(value: unknown): AnyRecord[] {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") as AnyRecord[] : []
}

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {}
}

function sizeFrom(rawGeometry: AnyRecord): ProductSpec["size"] {
  const geometry = object(rawGeometry)
  const base = object(geometry.base)
  const source = Object.keys(base).length ? base : geometry
  const widthMm = num(source.width_mm ?? source.width)
  const heightMm = num(source.height_mm ?? source.height)
  const gussetMm = num(source.gusset_mm ?? source.gusset)
  const fgType = text(geometry.finished_good_type).toUpperCase()
  const rollForm = text(geometry.roll_form)

  let label = "Size not captured"
  if (fgType === "ROLL") {
    label = rollSizeLabel(widthMm, heightMm, rollForm)
  } else if (widthMm !== null || heightMm !== null) {
    const parts = [compact(widthMm) || "—", compact(heightMm) || "—"]
    if (gussetMm !== null && gussetMm > 0) parts.push(compact(gussetMm))
    label = `${parts.join(" x ")} mm`
  }

  return { widthMm, heightMm, gussetMm, label, formLabel: rollForm, finishedGoodType: fgType || undefined }
}

function pouchStyleFrom(source: AnyRecord, context: AnyRecord, backend: AnyRecord, summary: AnyRecord): string {
  const geometry = object(context.job?.geometry || source.geometry || source.geometry_snapshot)
  const base = object(geometry.base)
  const backendSize = object(backend.size)
  return text(
    backend.pouch_style_label,
    backend.pouch_style_name,
    backend.pouch_style_master_code,
    backend.pouch_style_code,
    backend.pouch_style,
    backendSize.pouch_style_label,
    backendSize.pouch_style_name,
    backendSize.pouch_style_master_code,
    backendSize.pouch_style_code,
    backendSize.pouch_style,
    summary.pouch_style_label,
    summary.pouch_style_name,
    summary.pouch_style_master_code,
    summary.pouch_style_code,
    summary.pouch_style,
    geometry.pouch_style_label,
    geometry.pouch_style_name,
    geometry.pouch_style_master_code,
    geometry.pouch_style_code,
    geometry.pouch_style,
    base.pouch_style_label,
    base.pouch_style_name,
    base.pouch_style_master_code,
    base.pouch_style_code,
    base.pouch_style,
    source.pouch_style_label,
    source.pouch_style_name,
    source.pouch_style_master_code,
    source.pouch_style_code,
    source.pouch_style,
  )
}

function layerFrom(row: AnyRecord, index: number, fallbackWidth: number | null): ProductSpecLayer {
  let thickness = num(row.thickness_micron ?? row.thickness)
  const width = num(row.width_mm ?? row.roll_width_mm ?? row.width ?? fallbackWidth)
  const variantCode = text(row.variant_code, row.material_code, row.family_code, row.code)
  const variantName = text(row.variant_name, row.material_name, row.family_name, row.name, variantCode, `Layer ${index}`)
  const grade = text(row.grade_name, row.grade_code, row.grade)
  if (thickness === null) {
    const match = (variantCode || variantName).match(/(\d+(?:\.\d+)?)$/)
    if (match) thickness = num(match[1])
  }
  const labelParts = [variantCode || variantName]
  if (grade && !labelParts.join(" ").toLowerCase().includes(grade.toLowerCase())) labelParts.push(grade)
  if (thickness !== null) labelParts.push(`${compact(thickness)}µ`)
  const fallbackLabelParts = layerLabelPartsFromText(row.label)
  return {
    index,
    variantCode,
    variantName,
    grade,
    thicknessMicron: thickness,
    widthMm: width,
    label: labelParts.filter(Boolean).join(" · ") || fallbackLabelParts.join(" · "),
  }
}

function podLabelsFrom(source: AnyRecord, context?: AnyRecord): string[] {
  const labels: string[] = []
  const candidates = [
    object(source.product_spec).pod_labels,
    object(source.item_summary).pod_labels,
    object(object(source.item_summary).spec_facets).pod_labels,
    object(context?.product_spec).pod_labels,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) labels.push(...candidate.map((entry) => text(entry)).filter(Boolean))
  }

  const packagingPod = object(source.packaging_snapshot?.pod ?? source.bom_snapshot?.pod ?? source.geometry?.pod)
  if (packagingPod.enabled || packagingPod.pod_sku_code || packagingPod.pod_sku_name) {
    labels.push(text(packagingPod.pod_sku_code, packagingPod.pod_sku_name, "POD"))
  }
  if (source.item_summary?.pod_enabled && !labels.length) labels.push("POD")
  return Array.from(new Set(labels.filter(Boolean)))
}

function addonLabelsFrom(source: AnyRecord, context?: AnyRecord): string[] {
  const labels: string[] = []
  const directLists = [
    object(source.product_spec).addon_labels,
    object(source.item_summary).addon_labels,
    object(object(source.item_summary).spec_facets).addon_labels,
    source.addons,
    source.addons_snapshot,
    source.bom_snapshot?.addons,
    context?.job?.addons,
  ]
  for (const candidate of directLists) {
    if (!Array.isArray(candidate)) continue
    for (const row of candidate) {
      labels.push(typeof row === "string" ? row : text(row?.name, row?.addon_name, row?.code, row?.material_name, row?.label))
    }
  }
  return Array.from(new Set(labels.filter(Boolean)))
}

export function normalizeProductSpec(sourceInput: unknown, contextInput?: unknown): ProductSpec {
  const source = object(sourceInput)
  const context = object(contextInput)
  const explicitProductSpec = object(source.product_spec)
  const summaryProductSpec = object(source.item_summary?.spec_facets)
  const backend = Object.keys(explicitProductSpec).length ? explicitProductSpec : summaryProductSpec
  const summary = object(source.item_summary)
  const explicitSize = object(backend.size)
  const summarySize = object(summary.size)
  const backendSize = Object.keys(explicitSize).length ? explicitSize : summarySize
  const geometry = object(context.job?.geometry || source.geometry || source.geometry_snapshot || {})
  const backendFgType = text(backendSize.finished_good_type, backendSize.finishedGoodType, geometry.finished_good_type).toUpperCase()
  const backendRollForm = text(backendSize.roll_form, backendSize.rollForm, geometry.roll_form)
  const size = backendSize.label
    ? {
        widthMm: num(backendSize.width_mm ?? backendSize.widthMm),
        heightMm: num(backendSize.height_mm ?? backendSize.heightMm),
        gussetMm: num(backendSize.gusset_mm ?? backendSize.gussetMm),
        label: backendFgType === "ROLL"
          ? rollSizeLabel(
              num(backendSize.width_mm ?? backendSize.widthMm ?? geometry.base?.width_mm ?? geometry.width_mm ?? geometry.width),
              num(backendSize.height_mm ?? backendSize.heightMm ?? geometry.base?.height_mm ?? geometry.height_mm ?? geometry.height),
              backendRollForm
            )
          : text(backendSize.label),
        formLabel: backendRollForm,
        finishedGoodType: backendFgType || undefined,
      }
    : sizeFrom(geometry)

  const backendLayers = list(backend.layers || summary.layers)
  const rawLayers = backendLayers.length
    ? backendLayers
    : (list(context.bom_layers).length ? list(context.bom_layers) : list(source.layers || source.layer_snapshot || summary.layer_labels?.map((label: string) => ({ label }))))
  const layers = rawLayers.map((row, idx) => layerFrom(row, idx + 1, size.widthMm))
  const pouchStyle = pouchStyleFrom(source, context, backend, summary)
  const podLabels = podLabelsFrom(source, context)
  const addonLabels = addonLabelsFrom(source, context)
  const customerName = text(backend.customer_name, source.customer_name, context.job?.customer_name)
  const orderNumber = text(backend.order_number, source.order_number, source.sales_order_no, context.job?.order_number)
  const productName = text(
    backend.display_label,
    backend.line_label,
    source.sales_order_line_label,
    source.line_label,
    source.display_label,
    context.job?.sales_order_line_label,
    context.job?.line_label,
    context.display?.line_label,
    context.display?.display_label,
    backend.product_name,
    source.product_name,
    source.line_name,
    source.order_name,
    summary.variant_name,
    summary.template_name,
    context.display?.template_name,
    context.job?.product_name,
    "Sales product",
  )
  const templateName = text(backend.template_name, source.template_name, summary.template_name, context.display?.template_name)
  const variantCode = text(backend.variant_code, summary.variant_code, source.sku_variant_code, source.variant_code)
  const variantName = text(backend.variant_name, summary.variant_name, source.sku_variant_name, source.variant_name)
  const searchText = [
    backend.search_text,
    customerName,
    orderNumber,
    productName,
    templateName,
    variantCode,
    variantName,
    size.label,
    pouchStyle,
    ...layers.flatMap((layer) => [layer.label, layer.variantCode, layer.variantName, layer.grade, compact(layer.thicknessMicron), compact(layer.widthMm)]),
    ...podLabels,
    ...addonLabels,
  ].join(" ").toLowerCase()

  return {
    customerName,
    orderNumber,
    productName,
    templateName,
    variantCode,
    variantName,
    size,
    layers,
    pouchStyle,
    podLabels,
    addonLabels,
    hasPod: podLabels.length > 0 || Boolean(summary.pod_enabled),
    hasAddons: addonLabels.length > 0 || Number(summary.addons_count || 0) > 0,
    qtyValue: num(backend.qty_value ?? source.quantity ?? source.qty_value),
    qtyUom: text(backend.qty_uom, source.uom, source.qty_uom).toUpperCase(),
    searchText,
  }
}

export function specChipLabel(layer: ProductSpecLayer): string {
  return layer.label
}
