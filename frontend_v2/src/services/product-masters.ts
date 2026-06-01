import { api } from "@/lib/api"

type MaybePaginated<T> = T[] | { results?: T[] } | unknown

function unwrapList<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[]
    }
    return []
}

export type ProductKind = "POUCH" | "ROLL" | "PACKAGING" | "POD" | "OTHER"
export type ReusablePolicy = "CONFIGURABLE" | "PRESET_ONLY" | "CUSTOMER_SPECIFIC"

export interface ProductMasterLayerTemplateRow {
    role?: string
    name?: string
    material_code?: string
    film_variant_code?: string
    thickness_micron?: number | string | null
    thickness_um?: number | string | null
    default_thickness_micron?: number | string | null
    default_thickness_um?: number | string | null
    default_grade?: string
    default_grade_id?: string | null
    grade_options?: Array<string | Record<string, any>>
    allowed_film_variant_codes?: string[]
    alternate_film_variant_codes?: string[]
    allowed_material_codes?: string[]
    thickness_share?: number | string | null
    percent_of_total?: number | string | null
    [key: string]: any
}

export interface ProductMasterAxis {
    axis: string
    type: string
    required?: boolean
    options?: any[]
    scope?: "per_layer" | "per_stack" | "order" | string
    default_from_overlay?: boolean
    allow_custom?: boolean
    [key: string]: any
}

export interface ProductMaster {
    id: string
    code: string
    name: string
    product_kind: ProductKind
    default_template?: string | null
    default_template_name?: string | null
    template?: string | null
    template_name?: string | null
    extrusion_recipe?: string | null
    commercial_family?: string | null
    commercial_family_name?: string | null
    default_reporting_group?: string
    reusable_policy: ReusablePolicy
    canonical_layer_stack?: ProductMasterLayerTemplateRow[]
    layer_template?: ProductMasterLayerTemplateRow[]
    variant_axes?: ProductMasterAxis[]
    fixed_attributes?: Record<string, any>
    invariant_signature?: string
    description?: string
    active: boolean
    overlay_count?: number
    overlays_count?: number
    sizes_count?: number
    variants_count?: number
    created_at?: string
    updated_at?: string
}

export type ProductMasterInput = Partial<Omit<ProductMaster, "id" | "created_at" | "updated_at" | "overlay_count" | "default_template_name" | "template_name" | "commercial_family_name">>

export interface ProductMasterEditorSize {
    id?: string
    code: string
    label: string
    width_mm?: number | string | null
    height_mm?: number | string | null
    gusset_mm?: number | string | null
    roll_width_mm?: number | string | null
    thickness_micron?: number | string | null
    trim_loss_mm?: number | string | null
    trim_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string
    flap_tape_mm?: number | string | null
    gusset_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string
    gusset_factor?: number | string | null
    pouch_style?: string
    pouch_style_master_code?: string | null
    pouch_style_roll_axis?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string | null
    roll_form?: string
    adjustments?: Array<Record<string, any>>
    multipliers?: Record<string, any>
    geometry_config?: Record<string, any>
    standard_qty?: number | string | null
    qty_uom?: "KG" | "PCS" | "METER" | string
    active?: boolean
    sort_order?: number
}

export interface ProductVariant {
    id: string
    master: string
    master_code?: string
    master_name?: string
    code: string
    axis_values?: Record<string, any>
    geometry_snapshot?: Record<string, any>
    layer_snapshot?: Array<Record<string, any>>
    bom_signature?: string
    active: boolean
    created_at?: string
}

export interface ProductMasterSize {
    id: string
    product_master: string
    product_master_code?: string
    product_master_name?: string
    code: string
    label: string
    width_mm?: number | string | null
    height_mm?: number | string | null
    gusset_mm?: number | string | null
    roll_width_mm?: number | string | null
    thickness_micron?: number | string | null
    standard_qty?: number | string | null
    qty_uom: "KG" | "PCS" | "METER" | string
    pouch_style_master?: string | null
    pouch_style_master_code?: string | null
    pouch_style_roll_axis?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string | null
    pouch_style_version?: number | string | null
    child_target_width_mm?: number | string | null
    child_target_override?: boolean
    stock_form?: "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB" | string | null
    width_basis?: "OPEN_WEB_WIDTH" | "LAYFLAT_WIDTH" | "FOLDED_WIDTH" | string | null
    film_area_width_mm?: number | string | null
    slit_policy?: "SLIT_ALLOWED" | "EXACT_ONLY" | string | null
    pouch_style?: string
    roll_form?: string
    trim_loss_mm?: number | string | null
    trim_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string
    flap_tape_mm?: number | string | null
    gusset_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string
    gusset_factor?: number | string | null
    adjustments?: Array<Record<string, any>>
    multipliers?: Record<string, any>
    geometry_config?: Record<string, any>
    notes?: string
    active: boolean
    sort_order?: number
    created_at?: string
    updated_at?: string
}

export type ProductMasterSizeInput = Partial<Omit<ProductMasterSize, "id" | "created_at" | "updated_at" | "product_master_code" | "product_master_name">>

export interface CustomerProductOverlay {
    id: string
    product_master: string
    product_master_code?: string
    product_master_name?: string
    customer: string
    customer_name?: string
    size_variant_code?: string
    axis_values?: Record<string, any>
    customer_item_code?: string
    customer_display_name?: string
    default_packing_note?: string
    default_packing_recipe?: Record<string, any>
    default_price_basis?: "PCS" | "KG" | "METER" | string
    moq_kg?: number | string | null
    default_artwork?: string | null
    default_artwork_design_code?: string | null
    notes?: string
    active: boolean
    created_at?: string
    updated_at?: string
}

export type CustomerProductOverlayInput = Partial<Omit<CustomerProductOverlay, "id" | "created_at" | "updated_at" | "product_master_code" | "product_master_name" | "customer_name" | "default_artwork_design_code">>

const SIZE_GEOMETRY_FLAT_KEYS = [
    "pouch_style",
    "roll_form",
    "trim_loss_mm",
    "trim_apply_to",
    "flap_tape_mm",
    "gusset_apply_to",
    "gusset_factor",
    "adjustments",
] as const

function normalizeSize(row: ProductMasterSize): ProductMasterSize {
    const geometry = row.geometry_config || {}
    const multipliers = geometry.multipliers && typeof geometry.multipliers === "object" ? geometry.multipliers : {}
    return {
        ...row,
        pouch_style: row.pouch_style ?? geometry.pouch_style,
        roll_form: row.roll_form ?? geometry.roll_form,
        trim_loss_mm: row.trim_loss_mm ?? geometry.trim_loss_mm,
        trim_apply_to: row.trim_apply_to ?? geometry.trim_apply_to,
        flap_tape_mm: row.flap_tape_mm ?? geometry.flap_tape_mm,
        gusset_apply_to: row.gusset_apply_to ?? geometry.gusset_apply_to,
        gusset_factor: row.gusset_factor ?? geometry.gusset_factor,
        adjustments: row.adjustments ?? geometry.adjustments,
        multipliers: row.multipliers ?? multipliers,
        stock_form: row.stock_form ?? geometry.stock_form,
        width_basis: row.width_basis ?? geometry.width_basis,
        film_area_width_mm: row.film_area_width_mm ?? geometry.film_area_width_mm,
        slit_policy: row.slit_policy ?? geometry.slit_policy,
    }
}

function sizePayload(payload: ProductMasterSizeInput): ProductMasterSizeInput {
    const next = { ...(payload as Record<string, any>) }
    const geometry = { ...(payload.geometry_config || {}) } as Record<string, any>
    for (const key of SIZE_GEOMETRY_FLAT_KEYS) {
        const value = (payload as any)[key]
        if (value !== undefined) geometry[key] = value
        delete next[key]
    }
    const existingMultipliers = geometry.multipliers && typeof geometry.multipliers === "object" ? geometry.multipliers : {}
    const flatMultipliers = payload.multipliers && typeof payload.multipliers === "object" ? payload.multipliers : {}
    const multipliers = { ...existingMultipliers, ...flatMultipliers }
    delete next.faces
    delete next.multipliers
    delete multipliers.faces
    if (Object.keys(multipliers).length) geometry.multipliers = multipliers
    if (Object.keys(geometry).length) next.geometry_config = geometry
    return next as ProductMasterSizeInput
}

export const productMasterService = {
    getProducts: async (params?: { product_kind?: string; active?: boolean | string; q?: string; search?: string }) => {
        const { data } = await api.get<MaybePaginated<ProductMaster>>("/api/master/products/", { params })
        return unwrapList<ProductMaster>(data)
    },
    createProduct: async (payload: ProductMasterInput) => {
        const { data } = await api.post<ProductMaster>("/api/master/products/", payload)
        return data
    },
    updateProduct: async (id: string, payload: ProductMasterInput) => {
        const { data } = await api.patch<ProductMaster>(`/api/master/products/${id}/`, payload)
        return data
    },
    getProduct: async (id: string, params?: { customer?: string }) => {
        const { data } = await api.get<ProductMaster>(`/api/master/products/${id}/`, { params })
        return data
    },
    deleteProduct: async (id: string) => {
        await api.delete(`/api/master/products/${id}/`)
    },
    getProductSizes: async (productId: string, params?: { active?: boolean | string }) => {
        const { data } = await api.get<MaybePaginated<ProductMasterSize>>(`/api/master/products/${productId}/sizes/`, { params })
        return unwrapList<ProductMasterSize>(data).map(normalizeSize)
    },
    createProductSize: async (productId: string, payload: ProductMasterSizeInput) => {
        const { data } = await api.post<ProductMasterSize>(`/api/master/products/${productId}/sizes/`, sizePayload(payload))
        return normalizeSize(data)
    },
    updateProductSize: async (id: string, payload: ProductMasterSizeInput) => {
        const { data } = await api.patch<ProductMasterSize>(`/api/master/product-sizes/${id}/`, sizePayload(payload))
        return normalizeSize(data)
    },
    getProductVariants: async (productId: string, params?: { active?: boolean | string }) => {
        const { data } = await api.get<MaybePaginated<ProductVariant>>(`/api/master/products/${productId}/variants/`, { params })
        return unwrapList<ProductVariant>(data)
    },
    createProductVariant: async (productId: string, payload: Partial<ProductVariant>) => {
        const { data } = await api.post<ProductVariant>(`/api/master/products/${productId}/variants/`, payload)
        return data
    },
    findOrCreateVariant: async (productId: string, axisValues: Record<string, any>, code?: string) => {
        const { data } = await api.post<{ variant: ProductVariant; created: boolean }>(`/api/master/products/${productId}/variants/find-or-create/`, { axis_values: axisValues, code })
        return data
    },
    getProductPlannerStock: async (productId: string) => {
        const { data } = await api.get<MaybePaginated<any>>(`/api/master/products/${productId}/planner-stock/`)
        return unwrapList<any>(data)
    },
    getProductSavedPresets: async (productId: string) => {
        const { data } = await api.get<MaybePaginated<any>>(`/api/master/products/${productId}/saved-presets/`)
        return unwrapList<any>(data)
    },
    getProductAudit: async (productId: string) => {
        const { data } = await api.get<MaybePaginated<any>>(`/api/master/products/${productId}/audit/`)
        return unwrapList<any>(data)
    },
    getCustomerOverlays: async (params?: { product_master?: string; customer?: string; active?: boolean | string }) => {
        const { data } = await api.get<MaybePaginated<CustomerProductOverlay>>("/api/master/customer-product-overlays/", { params })
        return unwrapList<CustomerProductOverlay>(data)
    },
    createCustomerOverlay: async (payload: CustomerProductOverlayInput) => {
        const { data } = await api.post<CustomerProductOverlay>("/api/master/customer-product-overlays/", payload)
        return data
    },
    updateCustomerOverlay: async (id: string, payload: CustomerProductOverlayInput) => {
        const { data } = await api.patch<CustomerProductOverlay>(`/api/master/customer-product-overlays/${id}/`, payload)
        return data
    },
    deleteCustomerOverlay: async (id: string) => {
        await api.delete(`/api/master/customer-product-overlays/${id}/`)
    },
}
