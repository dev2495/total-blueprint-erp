/**
 * Product Master V3 service.
 *
 * Backed by /api/master/products/ and friends per the V3 blueprint
 * (docs/SALES_PRODUCT_MASTER_V3_FRONTEND_BLUEPRINT_2026-05-06.md).
 *
 * The production UI must show live ERP data only. The older in-memory seed is
 * retained below as documentation/sample data, but API failures now surface to
 * the caller instead of being masked by mock records.
 */
import { api } from "@/lib/api";
import type { Artwork } from "@/services/engineering";

type MaybePaginated<T> = T[] | { results?: T[] } | unknown;

function unwrap<T>(data: MaybePaginated<T>): T[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray((data as any).results)) {
        return (data as any).results as T[];
    }
    return [];
}

// ---------- Types -----------------------------------------------------------

export type ProductKind = "POUCH" | "ROLL" | "PACKAGING" | "POD" | "OTHER";

// Subtype for PACKAGING masters only. INNER_POUCH = inner pouch carrier
// (lives in the sales-pickable axis pool with kind=INNER_POUCH).
// SHEET = roll-form packing sheet/wrap. Null for non-PACKAGING masters.
export type PackagingMasterKind = "INNER_POUCH" | "SHEET" | null;
export type ReportingGroup = "FILM" | "PRINTED" | "LAMINATED" | "SEMI_FG" | "FG" | "PACKAGING" | "POD" | "OTHER";
export type ReusablePolicy = "CONFIGURABLE" | "PRESET_ONLY" | "CUSTOMER_SPECIFIC";

export interface LayerTemplateRow {
    role: string;
    film_variant_code: string;
    film_variant_id?: string | null;
    thickness_micron: number;
    thickness_options?: number[];
    default_grade?: string;
    grade_options?: string[];
    grade_apportion?: "fixed" | "variable";
    grade_mode?: string;
    thickness_apportion?: "fixed_um" | "per_layer";
    default_input_roll_width_mm?: number | null;
    notes?: string;
}

/**
 * V3.3: An axis can declare that its allowed values come from a master-data catalog.
 * The detail/sales UI then renders a Select sourced from that catalog instead of free-text.
 *
 *   pod_sku_variant         — POD film catalog (PodSkuVariant)
 *   packaging_material      — Packaging catalog (PackagingMaterial); use master_data_filter to scope by packaging_kind
 *   addon                   — Addon catalog
 */
export type AxisCatalogSource = "pod_sku_variant" | "packaging_material" | "addon";

export interface VariantAxisDef {
    axis: "size" | "layer_thicknesses" | "layer_grades" | "layer_widths" | "addons" | "packaging" | "pod" | "pod_variant" | "packaging_inner" | "packaging_outer" | "artwork_mode" | string;
    type:
        | "geometry"
        | "per_layer_number"
        | "per_layer_enum"
        | "multi_enum"
        | "packaging_ref"
        | "pod_ref"
        | "catalog_ref"
        | "enum";
    required?: boolean;
    label?: string;
    /**
     * V3.3: when set, this axis's allowed values are pulled from a master-data catalog.
     * The variant tuple stores the catalog row's `code` (e.g. "POD-220-30U-GP" or "INNER-POUCH-24").
     * BOM lines on sales submit consume that same code, no parallel registry.
     */
    master_data_source?: AxisCatalogSource;
    /** Optional filter applied to the catalog query (e.g. {packaging_kind: "INNER_POUCH"}). */
    master_data_filter?: Record<string, any>;
    /**
     * Quantity formula for BOM consumption. Tokens: total_pouches, total_pcs, total_kg, pcs_per_inner, fixed_qty.
     * If omitted, default is 1 unit per parent pouch.
     */
    qty_formula?: string;
    /** Simpler alternative to qty_formula — shortcut for "consume N units per parent piece". */
    qty_per_pcs?: number;
    /** Default catalog code to suggest when sales picks the axis (e.g. "INNER-POUCH-24"). */
    default_value?: string;
    /** When true and stock is short, auto-demand fires an in-house stock launcher. */
    auto_demand_in_house?: boolean;
}

// V3.3 model: Axis-level catalog linkage.
//
// POD is a TYPE OF FILM — extruded, sits on top of the pouch's layer stack as a printable web.
// Inner-pack is a manufactured pouch used to bundle finished pouches in-house.
//
// Both live in master-data catalogs (PodSkuVariant, PackagingMaterial). The ProductMaster
// declares an axis (e.g. "pod_variant", "packaging_inner") whose allowed values come from
// the catalog via `master_data_source`. The pouch's variant tuple stores the chosen catalog
// code, and on sales submit the BOM consumes that exact code. If stock is short for a
// catalog item flagged `pod_is_inhouse_produced=true` (or similar), auto-demand fires
// an in-house stock launcher for that catalog identity.
//
// No parallel registry, no requirement-rule indirection — just one axis = one catalog dropdown.

export interface ProductMaster {
    id: string;
    code: string;
    name: string;
    version_group?: string;
    version?: number;
    is_current_version?: boolean;
    superseded_by?: string | null;
    product_kind: ProductKind;
    /** Sub-type when product_kind=PACKAGING. INNER_POUCH or SHEET (= "roll for packing"). Null otherwise. */
    packaging_kind?: PackagingMasterKind;
    template?: string | null;
    template_name?: string | null;
    default_template?: string | null;
    extrusion_recipe?: string | null;
    commercial_family?: string | null;
    default_reporting_group: ReportingGroup;
    reusable_policy: ReusablePolicy;
    layer_template: LayerTemplateRow[];
    canonical_layer_stack?: LayerTemplateRow[];
    variant_axes: VariantAxisDef[];
    fixed_attributes: Record<string, any>;
    invariant_signature?: string;
    description?: string;
    active: boolean;
    sizes_count?: number;
    variants_count?: number;
    overlays_count?: number;
    catalog_links_count?: number;
    artworks_count?: number;
    planner_pools_count?: number;
    saved_presets_count?: number;
    created_at?: string;
    updated_at?: string;
}

export interface ProductMasterClonePayload extends Partial<ProductMaster> {
    disable_source?: boolean;
    copy_sizes?: boolean;
    copy_variants?: boolean;
    sizes?: Array<Partial<ProductMasterSize>>;
}

export interface ProductMasterCloneResponse extends ProductMaster {
    source_disabled_id?: string | null;
    copied_sizes_count?: number;
    copied_variants_count?: number;
    open_line_rebase_summary?: {
        updated: number;
        skipped: number;
        failed: number;
        details?: Array<{ item_id?: string; order_number?: string; status?: string; reason?: string }>;
    };
}

export interface CompatibleArtworksResponse {
    count: number;
    results: Artwork[];
    context: {
        print_type?: string | null;
        substrate_mode?: string | null;
    };
    needs_size?: boolean;
    reason?: string;
}

/**
 * Validate that a master is ready to activate.
 * Product Masters need a live route template before sales/planner can safely use them.
 */
export function isReadyForActivation(master: Pick<ProductMaster, "product_kind" | "code" | "name" | "template" | "default_template">): { ok: boolean; reason?: string } {
    if (!master.code?.trim()) return { ok: false, reason: "Master code is required." };
    if (!master.name?.trim()) return { ok: false, reason: "Master name is required." };
    if (!master.template && !master.default_template) return { ok: false, reason: "Live route template is required." };
    return { ok: true };
}

/**
 * True if the master has at least one axis backed by a master-data catalog
 * (POD or packaging). These axes drive auto-BOM-line + auto-demand at sales submit.
 */
export function hasCatalogBackedAxis(master: Pick<ProductMaster, "variant_axes">): boolean {
    return (master.variant_axes || []).some((a) => Boolean(a.master_data_source));
}

function graftCatalogAxes(master: ProductMaster, lookupId?: string): ProductMaster {
    const seed = STATE.masters.find((m) => m.id === lookupId || m.id === master.id || m.code === master.code);
    if (!seed) return master;

    const seedAxes = seed.variant_axes || [];
    const liveAxes = master.variant_axes || [];
    const seedHasCatalogBacking = seedAxes.some((a) => a.master_data_source);
    const liveHasCatalogBacking = liveAxes.some((a) => a.master_data_source);

    if (!seedHasCatalogBacking || liveHasCatalogBacking) return master;

    const liveAxisNames = new Set(liveAxes.map((a) => String(a.axis)));
    const additions = seedAxes.filter((a) => a.master_data_source && !liveAxisNames.has(String(a.axis)));
    return additions.length ? { ...master, variant_axes: [...liveAxes, ...additions] } : master;
}

export interface ProductMasterSize {
    id: string;
    product_master: string;
    code: string;
    label: string;
    width_mm: number;
    height_mm: number;
    gusset_mm?: number;
    roll_width_mm?: number | null;
    thickness_micron?: number | null;
    standard_qty?: number | null;
    qty_uom?: "KG" | "PCS" | "METER";
    pouch_style?: string;
    /** UUID of the PouchStyleMaster bound to this size (final model). */
    pouch_style_master?: string | null;
    /** Pouch style code and roll axis snapshot used for child-web/pitch math. */
    pouch_style_master_code?: string | null;
    pouch_style_roll_axis?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | string | null;
    /** Snapshot of the bound pouch style's version at the time of binding. */
    pouch_style_version?: number;
    /** Final pouch web requirement. Auto-computed from formula, optionally overridden. */
    child_target_width_mm?: number | null;
    /** Physical stock form required for this size row. */
    stock_form?: "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB" | string | null;
    /** Meaning of width_mm / child_target_width_mm for physical roll matching. */
    width_basis?: "OPEN_WEB_WIDTH" | "LAYFLAT_WIDTH" | "FOLDED_WIDTH" | string | null;
    /** Width used for film area and weight calculation. Tube normally equals lay-flat width × 2. */
    film_area_width_mm?: number | null;
    /** Whether WCM allocation can slit wider parent rolls for this stock form. */
    slit_policy?: "SLIT_ALLOWED" | "EXACT_ONLY" | string | null;
    /** True when the operator manually set child_target_width_mm. */
    child_target_override?: boolean;
    roll_form?: string;
    flap_tape_mm?: number;
    trim_loss_mm?: number;
    trim_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE";
    gusset_apply_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE";
    gusset_factor?: number;
    adjustments?: Array<Record<string, any>>;
    multipliers?: Record<string, any>;
    geometry_config?: Record<string, any>;
    notes?: string;
    active: boolean;
    sort_order?: number;
}

export interface CustomerProductOverlay {
    id: string;
    product_master: string;
    product_master_name?: string;
    product_master_code?: string;
    customer: string;
    customer_name?: string;
    customer_code?: string;
    axis_values?: Record<string, any>;
    size_variant_code?: string;
    customer_item_code?: string;
    customer_display_name?: string;
    default_packing_note?: string;
    default_packing_recipe?: any;
    default_price_basis?: "KG" | "PCS";
    moq_kg?: number | null;
    default_artwork?: string | null;
    default_artwork_design_code?: string | null;
    notes?: string;
    active: boolean;
}

export interface ProductVariant {
    id: string;
    master: string;
    code: string;
    axis_values: Record<string, any>;
    geometry_snapshot: any;
    layer_snapshot: any[];
    bom_signature: string;
    invariant_signature?: string;
    active: boolean;
    /**
     * For PACKAGING + POD masters: the manually linked fixed catalog SKU plus
     * its current stock total. Null until an admin links this variant to an
     * existing Packaging/POD catalog row.
     */
    inventory_link?: {
        id: string;
        code: string;
        name: string;
        category: "PACKAGING" | "POD" | string;
        packaging_kind: string;
        base_uom: "KG" | "PCS" | "METER" | string;
        stock_qty: number;
        pod_sku_variant_id?: string | null;
        pod_sku_variant_code?: string | null;
        pod_sku_code?: string | null;
    } | null;
}

export interface PreviewBomRequest {
    customer_id?: string;
    product_master: string;
    template_id?: string | null;
    axis_values: Record<string, any>;
    quantity?: number;
    quantity_uom?: "KG" | "PCS" | "METER";
    price_basis?: "KG" | "PCS";
    wip_roll_width_mm?: number | null;
    target_roll_width_mm?: number | null;
    printing?: any;
    packaging?: any;
    packaging_snapshot?: any;
}

export interface PreviewBomResult {
    variant_status: "EXISTS" | "NEW";
    variant_id?: string;
    variant_code?: string;
    invariant_signature: string;
    geometry_snapshot: any;
    layer_snapshot: any[];
    printing_snapshot?: any;
    packaging_snapshot?: any;
    addons_snapshot?: any[];
    bom?: any;
    bom_snapshot?: any;
    bom_by_step?: BomByStep[];
    packaging_lines?: any[];
    pod_lines?: any[];
    overlay_match?: {
        source: "EXACT_AXIS" | "SIZE" | "GENERIC" | "NONE";
        overlay_id?: string;
        customer_item_code?: string;
        customer_display_name?: string;
        default_price_basis?: "KG" | "PCS";
        default_packing_note?: string;
    };
    stock_source_preview?: {
        exact_fg?: number;
        shared_wip?: number;
        fresh_route?: number;
    };
    unit_weight_g?: number;
    total_weight_kg?: number;
    blockers?: string[];
    warnings?: string[];
    checks?: { label: string; ok: boolean; tone?: "ok" | "warn" | "error" }[];
}

export interface BomByStep {
    index: number;
    step_label: string;
    step_kind: string;
    description?: string;
    materials?: { material_code: string; qty: number; uom: string; waste_percent?: number }[];
    print_capable?: boolean;
}

// ---------- Mock seed (matches blueprint examples) --------------------------

const ISO_NOW = "2026-05-06T11:30:00Z";

const MOCK_MASTERS: ProductMaster[] = [
    {
        id: "pm-dry-pet-ld",
        code: "PM-DRY-PET-LD",
        name: "Dry Fruit Standup Pouch — PET/LD food-grade",
        product_kind: "POUCH",
        template: "tpl-roll-to-bulk",
        template_name: "ROLL_TO_BULK route",
        default_reporting_group: "FG",
        reusable_policy: "CONFIGURABLE",
        layer_template: [
            {
                role: "print-web",
                film_variant_code: "PET-12",
                thickness_micron: 12,
                default_grade: "",
                grade_options: [],
                thickness_apportion: "fixed_um",
                notes: "Print surface layer",
            },
            {
                role: "sealant",
                film_variant_code: "LD-NAT-ML",
                thickness_micron: 65,
                default_grade: "FOOD-A",
                grade_options: ["FOOD-A", "GP"],
                thickness_apportion: "per_layer",
                notes: "Heat seal layer",
            },
        ],
        // V3.3: catalog-backed axes — POD and inner-pack values come from master-data catalogs.
        // Sales picks a value from the catalog dropdown; BOM consumes that exact code; auto-demand
        // fires an in-house stock launcher if pool is short.
        variant_axes: [
            { axis: "size", type: "geometry", required: true },
            { axis: "layer_thicknesses", type: "per_layer_number", required: false },
            { axis: "layer_grades", type: "per_layer_enum", required: false },
            { axis: "layer_widths", type: "per_layer_number", required: false },
            { axis: "addons", type: "multi_enum", required: false },
            {
                axis: "pod_variant",
                type: "catalog_ref",
                required: false,
                label: "POD film",
                master_data_source: "pod_sku_variant",
                qty_per_pcs: 1,
                auto_demand_in_house: true,
            },
            {
                axis: "packaging_inner",
                type: "catalog_ref",
                required: false,
                label: "Inner pack pouch",
                master_data_source: "packaging_material",
                master_data_filter: { packaging_kind: "INNER_POUCH" },
                qty_formula: "ceil(total_pouches / pcs_per_inner)",
                default_value: "INNER-POUCH-24",
                auto_demand_in_house: true,
            },
            {
                axis: "packaging_outer",
                type: "catalog_ref",
                required: false,
                label: "Outer pack",
                master_data_source: "packaging_material",
                master_data_filter: { packaging_kind: ["GONNY", "SHEET"] },
                qty_per_pcs: 0, // counted on packing yard, not derived
            },
            { axis: "artwork_mode", type: "enum", required: false },
        ],
        fixed_attributes: {
            fg_type: "POUCH",
            default_pouch_style: "STAND_UP",
            print_capable: true,
            print_type: "ROTO",
            film_type: "SHEET",
            artwork_required: true,
        },
        invariant_signature: "INV-PM-DRY-PET-LD",
        description:
            "One master, many axis combinations. Size, per-layer thickness, grade, packaging, POD, and artwork sit on top without multiplying SKUs.",
        active: true,
        sizes_count: 3,
        variants_count: 12,
        overlays_count: 8,
        artworks_count: 5,
        planner_pools_count: 4,
        saved_presets_count: 3,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
    {
        id: "pm-mld-ldnat-roll",
        code: "PM-MLD-LDNAT-ROLL",
        name: "MLD LD Natural Roll",
        product_kind: "ROLL",
        template: "tpl-bulk-to-roll",
        template_name: "BULK_TO_ROLL route",
        default_reporting_group: "FILM",
        reusable_policy: "CONFIGURABLE",
        layer_template: [
            {
                role: "film-web",
                film_variant_code: "LD-NAT-ML",
                thickness_micron: 55,
                default_grade: "GP",
                grade_options: ["GP", "FOOD-A"],
                thickness_apportion: "per_layer",
            },
        ],
        variant_axes: [
            { axis: "size", type: "geometry", required: true },
            { axis: "layer_thicknesses", type: "per_layer_number", required: true },
            { axis: "layer_grades", type: "per_layer_enum", required: true },
            { axis: "layer_widths", type: "per_layer_number", required: false },
        ],
        fixed_attributes: {
            fg_type: "ROLL",
            roll_form: "FLAT",
            print_capable: false,
        },
        invariant_signature: "INV-PM-MLD-LDNAT-ROLL",
        description:
            "Generic LD Natural roll. Width, thickness, and grade vary per order. No SKU explosion.",
        active: true,
        sizes_count: 4,
        variants_count: 9,
        overlays_count: 2,
        artworks_count: 0,
        planner_pools_count: 6,
        saved_presets_count: 1,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
    {
        id: "pm-pack-ld-roll",
        code: "PM-PACK-LD-ROLL",
        name: "LD Packaging Roll (in-house)",
        product_kind: "PACKAGING",
        template: "tpl-pack-roll",
        template_name: "PACKAGING route",
        default_reporting_group: "PACKAGING",
        reusable_policy: "CONFIGURABLE",
        layer_template: [
            {
                role: "packaging-web",
                film_variant_code: "LD-PACK-60",
                thickness_micron: 60,
                default_grade: "GP",
                grade_options: ["GP"],
                thickness_apportion: "per_layer",
            },
        ],
        variant_axes: [
            { axis: "size", type: "geometry", required: true },
            { axis: "layer_widths", type: "per_layer_number", required: false },
        ],
        fixed_attributes: {
            fg_type: "ROLL",
            roll_form: "FLAT",
            print_capable: false,
        },
        invariant_signature: "INV-PM-PACK-LD-ROLL",
        description: "In-house packaging roll consumed via packaging recipe.",
        active: true,
        sizes_count: 2,
        variants_count: 5,
        overlays_count: 0,
        artworks_count: 0,
        planner_pools_count: 3,
        saved_presets_count: 0,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
    {
        id: "pm-pod-ldnat",
        code: "PM-POD-LDNAT",
        name: "POD · LD natural sleeve",
        product_kind: "POD",
        template: "tpl-pod-roll",
        template_name: "POD extrusion + slitting",
        default_reporting_group: "POD",
        reusable_policy: "CONFIGURABLE",
        layer_template: [
            {
                role: "pod-web",
                film_variant_code: "LD-NAT",
                thickness_micron: 30,
                default_grade: "GP",
                grade_options: ["GP", "FOOD-A"],
                thickness_apportion: "per_layer",
            },
        ],
        // POD masters use normal roll axes, but the produced variant must be
        // manually linked to one fixed POD SKU row before stock/consumption.
        variant_axes: [
            { axis: "layer_widths", type: "per_layer_number", required: true, label: "Width (mm)" },
            { axis: "layer_thicknesses", type: "per_layer_number", required: false, label: "Thickness (μ)" },
            { axis: "layer_grades", type: "per_layer_enum", required: false, label: "Grade" },
        ],
        fixed_attributes: {
            fg_type: "ROLL",
            roll_form: "FLAT",
            print_capable: false,
            consumes_as: "POD",
        },
        invariant_signature: "INV-PM-POD-LDNAT",
        description: "Stable POD roll recipe. Create the variant in Product Master, then manually link it to an existing fixed POD SKU row before using it for stock or consumption.",
        active: true,
        sizes_count: 0,
        variants_count: 0,
        overlays_count: 0,
        artworks_count: 0,
        planner_pools_count: 2,
        saved_presets_count: 0,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
    {
        id: "pm-inner-pack-ld",
        code: "PM-INNER-PACK-LD",
        name: "Inner pack · LD pouch",
        product_kind: "PACKAGING",
        template: "tpl-packaging",
        template_name: "PACKAGING route",
        default_reporting_group: "PACKAGING",
        reusable_policy: "CONFIGURABLE",
        layer_template: [
            { role: "sealant", film_variant_code: "LD-PE-60", thickness_micron: 60, default_grade: "GP", grade_options: ["GP"], thickness_apportion: "per_layer" },
        ],
        // Packaging masters use normal axes, but the produced variant must be
        // manually linked to one fixed packaging SKU row before stock/consumption.
        variant_axes: [
            { axis: "addons", type: "multi_enum", required: true, label: "Inner capacity (pcs)" },
            { axis: "layer_thicknesses", type: "per_layer_number", required: false, label: "Thickness (μ)" },
            { axis: "layer_grades", type: "per_layer_enum", required: false, label: "Grade" },
        ],
        fixed_attributes: {
            fg_type: "PACKAGING",
            print_capable: false,
            consumes_as: "PACKAGING_INNER",
            standard_inner_capacities: [12, 24, 48],
        },
        invariant_signature: "INV-PM-INNER-PACK-LD",
        description: "Stable inner-pack pouch recipe. Variants like PM-INNER-PACK-LD-24-60U-GP resolve at sales submit from the pouch master's requirement rule.",
        active: true,
        sizes_count: 0,
        variants_count: 0,
        overlays_count: 0,
        artworks_count: 0,
        planner_pools_count: 1,
        saved_presets_count: 0,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
    {
        id: "pm-laminate-pet-bopp",
        code: "PM-LAMINATE-PET-BOPP",
        name: "PET/BOPP Laminate Pouch — confectionery",
        product_kind: "POUCH",
        template: "tpl-roll-to-bulk",
        template_name: "ROLL_TO_BULK route",
        default_reporting_group: "FG",
        reusable_policy: "PRESET_ONLY",
        layer_template: [
            { role: "print-web", film_variant_code: "PET-12", thickness_micron: 12, thickness_apportion: "fixed_um" },
            { role: "barrier", film_variant_code: "MET-BOPP-20", thickness_micron: 20, thickness_apportion: "fixed_um" },
            { role: "sealant", film_variant_code: "LD-PE-50", thickness_micron: 50, default_grade: "FOOD-A", grade_options: ["FOOD-A"], thickness_apportion: "per_layer" },
        ],
        variant_axes: [
            { axis: "size", type: "geometry", required: true },
            { axis: "addons", type: "multi_enum" },
            { axis: "packaging", type: "packaging_ref" },
        ],
        fixed_attributes: {
            fg_type: "POUCH",
            default_pouch_style: "PILLOW",
            print_capable: true,
            print_type: "FLEXO",
            film_type: "TUBING",
            artwork_required: true,
        },
        invariant_signature: "INV-PM-LAMINATE-PET-BOPP",
        description: "Three-layer laminate pouch with metallised barrier.",
        active: true,
        sizes_count: 2,
        variants_count: 4,
        overlays_count: 3,
        artworks_count: 6,
        planner_pools_count: 1,
        saved_presets_count: 2,
        created_at: ISO_NOW,
        updated_at: ISO_NOW,
    },
];

const MOCK_SIZES: Record<string, ProductMasterSize[]> = {
    "pm-dry-pet-ld": [
        {
            id: "sz-snk-100",
            product_master: "pm-dry-pet-ld",
            code: "SNK-100",
            label: "100g",
            width_mm: 100,
            height_mm: 150,
            gusset_mm: 30,
            roll_width_mm: 320,
            pouch_style: "STAND_UP",
            child_target_width_mm: 320,
            film_area_width_mm: 320,
            standard_qty: 1000,
            qty_uom: "KG",
            active: true,
            sort_order: 1,
        },
        {
            id: "sz-snk-250",
            product_master: "pm-dry-pet-ld",
            code: "SNK-250",
            label: "250g",
            width_mm: 140,
            height_mm: 210,
            gusset_mm: 35,
            roll_width_mm: 420,
            pouch_style: "STAND_UP",
            child_target_width_mm: 420,
            film_area_width_mm: 420,
            standard_qty: 1000,
            qty_uom: "KG",
            active: true,
            sort_order: 2,
        },
        {
            id: "sz-snk-500",
            product_master: "pm-dry-pet-ld",
            code: "SNK-500",
            label: "500g",
            width_mm: 180,
            height_mm: 280,
            gusset_mm: 45,
            roll_width_mm: 520,
            pouch_style: "STAND_UP",
            child_target_width_mm: 520,
            film_area_width_mm: 520,
            standard_qty: 1000,
            qty_uom: "KG",
            active: true,
            sort_order: 3,
        },
    ],
    "pm-mld-ldnat-roll": [
        { id: "sz-1050", product_master: "pm-mld-ldnat-roll", code: "1050W", label: "1050 mm roll", width_mm: 1050, height_mm: 0, roll_width_mm: 1050, roll_form: "FLAT", standard_qty: 500, qty_uom: "KG", active: true, sort_order: 1 },
        { id: "sz-1220", product_master: "pm-mld-ldnat-roll", code: "1220W", label: "1220 mm roll", width_mm: 1220, height_mm: 0, roll_width_mm: 1220, roll_form: "FLAT", active: true, sort_order: 2 },
        { id: "sz-1260", product_master: "pm-mld-ldnat-roll", code: "1260W", label: "1260 mm roll", width_mm: 1260, height_mm: 0, roll_width_mm: 1260, roll_form: "FLAT", active: true, sort_order: 3 },
        { id: "sz-1500", product_master: "pm-mld-ldnat-roll", code: "1500W", label: "1500 mm roll", width_mm: 1500, height_mm: 0, roll_width_mm: 1500, roll_form: "FLAT", active: true, sort_order: 4 },
    ],
};

const MOCK_OVERLAYS: Record<string, CustomerProductOverlay[]> = {
    "pm-dry-pet-ld": [
        {
            id: "ov-acme-250",
            product_master: "pm-dry-pet-ld",
            customer: "cust-acme",
            customer_name: "Acme Foods Ltd",
            axis_values: { size: "SNK-250" },
            customer_item_code: "ACME-SNK-250",
            customer_display_name: "Acme Almond Standup 250g",
            default_packing_note: "24 pouches per inner pouch, final in gunny",
            default_price_basis: "PCS",
            moq_kg: 250,
            default_packing_recipe: {
                packaging_lines: [
                    { role: "PRIMARY_INNER", material_code: "INNER-POUCH-24", basis: "PCS_PER_PACK", pcs_per_pack: 24 },
                    { role: "FINAL_GUNNY", material_code: "GUNNY-25KG", basis: "PER_GUNNY", qty: 1 },
                ],
            },
            active: true,
        },
        {
            id: "ov-blueoak",
            product_master: "pm-dry-pet-ld",
            customer: "cust-blueoak",
            customer_name: "Blue Oak Snacks",
            axis_values: { size: "SNK-500" },
            customer_item_code: "BO-SNK-500",
            customer_display_name: "Blue Oak Cashew 500g",
            default_price_basis: "KG",
            moq_kg: 500,
            active: true,
        },
    ],
};

const MOCK_VARIANTS: Record<string, ProductVariant[]> = {
    "pm-dry-pet-ld": [
        {
            id: "pv-snk250-foodA",
            master: "pm-dry-pet-ld",
            code: "PV-SNK250-PET12-LD65-FOODA-Z",
            axis_values: {
                size: "SNK-250",
                layer_thicknesses: { 1: 12, 2: 65 },
                layer_grades: { 1: "", 2: "FOOD-A" },
                layer_widths: { 1: 420, 2: 420 },
                addons: ["ZIPPER"],
                packaging: "INNER-24-GUNNY",
            },
            geometry_snapshot: { width_mm: 140, height_mm: 210, gusset_mm: 35, child_target_width_mm: 420, film_area_width_mm: 420, roll_width_mm: 420, thickness_um: 77 },
            layer_snapshot: [
                { role: "print-web", film_variant_code: "PET-12", thickness_micron: 12, roll_width_mm: 420 },
                { role: "sealant", film_variant_code: "LD-NAT-ML", thickness_micron: 65, grade: "FOOD-A", roll_width_mm: 420 },
            ],
            bom_signature: "BS-SNK250-FOODA-ZIP-INNER24",
            active: true,
        },
    ],
};

// ---------- Helpers ---------------------------------------------------------

async function tryRequest<T>(fn: () => Promise<T>, fallback: () => T): Promise<T> {
    try {
        const result = await fn();
        return result;
    } catch (err: any) {
        const status = err?.response?.status ?? err?.status;
        // Mock Product Masters are useful during local backend bring-up, but
        // production must never show seed rows that the live backend cannot resolve.
        if (mockFallbackAllowed() && (status === 404 || status === 405 || status === undefined)) {
            return fallback();
        }
        throw err;
    }
}

function mockFallbackAllowed() {
    if (typeof window === "undefined") return process.env.NODE_ENV !== "production";
    const host = window.location.hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function isPersistedId(id?: string | null): id is string {
    if (!id) return false;
    if (id.startsWith("tmp-")) return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function stripTransient<T extends Record<string, any>>(payload: T, keys: string[] = ["id"]): Partial<T> {
    const next = { ...payload };
    for (const key of keys) delete next[key];
    return next;
}

const SIZE_GEOMETRY_FLAT_KEYS = [
    "pouch_style",
    "roll_form",
    "trim_loss_mm",
    "trim_apply_to",
    "flap_tape_mm",
    "gusset_apply_to",
    "gusset_factor",
    "adjustments",
] as const;

function normalizeSize(row: ProductMasterSize): ProductMasterSize {
    const geometry = row.geometry_config || {};
    const multipliers = geometry.multipliers && typeof geometry.multipliers === "object" ? geometry.multipliers : {};
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
    };
}

function sizePayload(payload: Partial<ProductMasterSize>): Partial<ProductMasterSize> {
    const next = stripTransient(payload as Record<string, any>, [
        "id",
        "product_master_code",
        "product_master_name",
        "pouch_style",
        "roll_form",
        "trim_loss_mm",
        "trim_apply_to",
        "flap_tape_mm",
        "gusset_apply_to",
        "gusset_factor",
        "adjustments",
        "multipliers",
    ]) as Record<string, any>;
    const geometry = { ...(payload.geometry_config || {}) } as Record<string, any>;
    for (const key of SIZE_GEOMETRY_FLAT_KEYS) {
        const value = (payload as any)[key];
        if (value !== undefined) geometry[key] = value;
    }
    const flatMultipliers = payload.multipliers && typeof payload.multipliers === "object" ? payload.multipliers : {};
    const existingMultipliers = geometry.multipliers && typeof geometry.multipliers === "object" ? geometry.multipliers : {};
    const multipliers = { ...existingMultipliers, ...flatMultipliers };
    delete multipliers.faces;
    if (Object.keys(multipliers).length) geometry.multipliers = multipliers;
    if (Object.keys(geometry).length) next.geometry_config = geometry;
    return next as Partial<ProductMasterSize>;
}

function generateId(prefix: string) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

// In-memory mutation store for the seed
const STATE = {
    masters: clone(MOCK_MASTERS),
    sizes: clone(MOCK_SIZES),
    overlays: clone(MOCK_OVERLAYS),
    variants: clone(MOCK_VARIANTS),
};

// ---------- Service --------------------------------------------------------

export const productMasterService = {
    list: async (params?: { q?: string; product_kind?: ProductKind; active?: boolean; for_sales?: boolean; for_planner?: boolean; all_versions?: boolean; current_only?: boolean }) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<ProductMaster>>("/api/master/products/", { params });
                return unwrap<ProductMaster>(data).map((row) => graftCatalogAxes(row));
            },
            () => {
                const list = clone(STATE.masters);
                let filtered = list;
                const currentOnly = params?.all_versions ? false : params?.current_only !== false;
                if (params?.q) {
                    const q = params.q.toLowerCase();
                    filtered = filtered.filter(
                        (m) => m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
                    );
                }
                if (params?.product_kind) filtered = filtered.filter((m) => m.product_kind === params.product_kind);
                if (typeof params?.active === "boolean") filtered = filtered.filter((m) => m.active === params.active);
                if (currentOnly) filtered = filtered.filter((m) => m.active !== false && m.is_current_version !== false);
                return filtered.map((row) => graftCatalogAxes(row));
            }
        );
    },

    get: async (id: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<ProductMaster>(`/api/master/products/${id}/`);
                // V3.3: graft catalog-backed axes from seed when backend variant_axes lack
                // `master_data_source` yet. Becomes a no-op once backend rows carry it.
                return data ? graftCatalogAxes(data, id) : data;
            },
            () => {
                const found = STATE.masters.find((m) => m.id === id);
                if (!found) throw new Error("Product master not found");
                return clone(found);
            }
        );
    },

    create: async (payload: Partial<ProductMaster>) => {
        return tryRequest(
            async () => {
                const { data } = await api.post<ProductMaster>("/api/master/products/", payload);
                return data;
            },
            () => {
                const id = `pm-${Math.random().toString(36).slice(2, 8)}`;
                const created: ProductMaster = {
                    id,
                    code: payload.code || `PM-${id.toUpperCase()}`,
                    name: payload.name || "Untitled Master",
                    product_kind: (payload.product_kind || "POUCH") as ProductKind,
                    template: payload.template ?? null,
                    template_name: payload.template_name ?? null,
                    default_reporting_group: (payload.default_reporting_group || "FG") as ReportingGroup,
                    reusable_policy: (payload.reusable_policy || "CONFIGURABLE") as ReusablePolicy,
                    layer_template: payload.layer_template || [],
                    variant_axes: payload.variant_axes || [],
                    fixed_attributes: payload.fixed_attributes || {},
                    active: payload.active ?? true,
                    description: payload.description || "",
                    version_group: payload.version_group || payload.code || `PM-${id.toUpperCase()}`,
                    version: payload.version || 1,
                    is_current_version: payload.is_current_version ?? true,
                    superseded_by: payload.superseded_by || null,
                    sizes_count: 0,
                    variants_count: 0,
                    overlays_count: 0,
                    artworks_count: 0,
                    planner_pools_count: 0,
                    saved_presets_count: 0,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };
                STATE.masters.unshift(created);
                STATE.sizes[id] = [];
                STATE.variants[id] = [];
                STATE.overlays[id] = [];
                return clone(created);
            }
        );
    },

    update: async (id: string, payload: Partial<ProductMaster>) => {
        return tryRequest(
            async () => {
                const { data } = await api.patch<ProductMaster>(`/api/master/products/${id}/`, payload);
                return data ? graftCatalogAxes(data, id) : data;
            },
            () => {
                const idx = STATE.masters.findIndex((m) => m.id === id);
                if (idx === -1) throw new Error("Product master not found");
                STATE.masters[idx] = { ...STATE.masters[idx], ...payload, updated_at: new Date().toISOString() };
                return clone(STATE.masters[idx]);
            }
        );
    },

    clone: async (id: string, payload: ProductMasterClonePayload = {}) => {
        return tryRequest(
            async () => {
                const { data } = await api.post<ProductMasterCloneResponse>(`/api/master/products/${id}/clone/`, payload);
                return data ? graftCatalogAxes(data, id) as ProductMasterCloneResponse : data;
            },
            () => {
                const source = STATE.masters.find((m) => m.id === id);
                if (!source) throw new Error("Product master not found");
                const nextId = `pm-${Math.random().toString(36).slice(2, 8)}`;
                const copyMaster: ProductMasterCloneResponse = {
                    ...clone(source),
                    ...payload,
                    id: nextId,
                    code: payload.code || `${source.code}-COPY`,
                    name: payload.name || `${source.name} copy`,
                    active: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    source_disabled_id: payload.disable_source ? source.id : null,
                    copied_sizes_count: 0,
                    copied_variants_count: 0,
                    version_group: source.version_group || source.code,
                    version: payload.disable_source ? (Number(source.version || 1) + 1) : 1,
                    is_current_version: true,
                    superseded_by: null,
                };
                STATE.masters.unshift(copyMaster);
                copyMaster.open_line_rebase_summary = { updated: 0, skipped: 0, failed: 0, details: [] };
                const submittedSizes = Array.isArray(payload.sizes) ? payload.sizes : null;
                STATE.sizes[nextId] = submittedSizes
                    ? submittedSizes.map((size, index) => ({ ...(size as ProductMasterSize), id: generateId("size"), product_master: nextId, active: size.active ?? true, sort_order: size.sort_order ?? index + 1 }))
                    : clone(STATE.sizes[id] || []).map((size) => ({ ...size, id: generateId("size"), product_master: nextId }));
                copyMaster.copied_sizes_count = STATE.sizes[nextId].length;
                STATE.variants[nextId] = payload.copy_variants === false ? [] : clone(STATE.variants[id] || []).map((variant) => ({ ...variant, id: generateId("var"), master: nextId }));
                copyMaster.copied_variants_count = STATE.variants[nextId].length;
                STATE.overlays[nextId] = [];
                if (payload.disable_source) {
                    const sourceIndex = STATE.masters.findIndex((m) => m.id === id);
                    if (sourceIndex >= 0) STATE.masters[sourceIndex] = { ...STATE.masters[sourceIndex], active: false, is_current_version: false, superseded_by: nextId };
                }
                return clone(copyMaster);
            }
        );
    },

    compatibleArtworks: async (
        id: string,
        params: {
            status?: string;
            axis_values?: Record<string, any> | string;
            size?: string;
            size_code?: string;
            front_colors_count?: number;
            back_colors_count?: number;
        } = {},
    ): Promise<CompatibleArtworksResponse> => {
        return tryRequest(
            async () => {
                const query: Record<string, any> = { ...params };
                if (query.axis_values && typeof query.axis_values !== "string") {
                    query.axis_values = JSON.stringify(query.axis_values);
                }
                const { data } = await api.get<CompatibleArtworksResponse>(
                    `/api/master/products/${id}/compatible-artworks/`,
                    { params: query },
                );
                return {
                    count: Number((data as any)?.count || 0),
                    results: Array.isArray((data as any)?.results) ? (data as any).results : [],
                    context: (data as any)?.context || {},
                    needs_size: Boolean((data as any)?.needs_size),
                    reason: String((data as any)?.reason || ""),
                };
            },
            () => ({
                count: 0,
                results: [],
                context: { print_type: null, substrate_mode: null },
                needs_size: false,
                reason: "Compatible artwork lookup is unavailable in offline mode.",
            }),
        );
    },

    disable: async (id: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.post<ProductMaster>(`/api/master/products/${id}/disable/`, {});
                return data ? graftCatalogAxes(data, id) : data;
            },
            () => {
                const idx = STATE.masters.findIndex((m) => m.id === id);
                if (idx === -1) throw new Error("Product master not found");
                STATE.masters[idx] = { ...STATE.masters[idx], active: false, updated_at: new Date().toISOString() };
                return clone(STATE.masters[idx]);
            }
        );
    },

    restore: async (id: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.post<ProductMaster>(`/api/master/products/${id}/restore/`, {});
                return data ? graftCatalogAxes(data, id) : data;
            },
            () => {
                const idx = STATE.masters.findIndex((m) => m.id === id);
                if (idx === -1) throw new Error("Product master not found");
                STATE.masters[idx] = { ...STATE.masters[idx], active: true, updated_at: new Date().toISOString() };
                return clone(STATE.masters[idx]);
            }
        );
    },

    /**
     * V3.3 BOM resolver for catalog-backed axes.
     * Walks the master's variant_axes; for each axis where a value was chosen and `master_data_source`
     * is set, computes the consumed qty per the axis's qty_formula or qty_per_pcs.
     * Returns BOM lines that the backend will allocate from stock or trigger auto-demand for.
     */
    resolveCatalogBom: async (params: {
        master: Pick<ProductMaster, "id" | "variant_axes">;
        axis_values: Record<string, any>;
        total_pouches?: number;
        overlay?: Record<string, any>;
    }): Promise<Array<{ axis: string; catalog_source: string; catalog_code: string; required_qty: number; auto_demand_in_house: boolean; formula?: string }>> => {
        const { master, axis_values, total_pouches = 0, overlay } = params;
        const localResolve = () => {
            const lines: Array<any> = [];
            for (const def of master.variant_axes || []) {
                if (!def.master_data_source) continue;
                const code = axis_values[String(def.axis)] ?? def.default_value;
                if (!code) continue;
                let qty = 0;
                if (def.qty_per_pcs != null) {
                    qty = Math.ceil(total_pouches * def.qty_per_pcs);
                } else if (def.qty_formula) {
                    try {
                        const pcsPerInner = Number(overlay?.pcs_per_inner ?? 24);
                        const tokens: Record<string, number> = {
                            total_pouches: total_pouches,
                            total_pcs: total_pouches,
                            pcs_per_inner: pcsPerInner,
                        };
                        const safe = def.qty_formula.replace(/[a-z_][a-z0-9_]*/gi, (m) => (tokens[m] !== undefined ? String(tokens[m]) : "0"));
                        const ceiled = safe.replace(/ceil\(([^)]+)\)/gi, "Math.ceil($1)").replace(/floor\(([^)]+)\)/gi, "Math.floor($1)").replace(/round\(([^)]+)\)/gi, "Math.round($1)");
                        // eslint-disable-next-line no-new-func
                        qty = Number(new Function(`return (${ceiled || 0});`)());
                        if (!Number.isFinite(qty)) qty = 0;
                    } catch {
                        qty = 0;
                    }
                }
                lines.push({
                    axis: String(def.axis),
                    catalog_source: def.master_data_source,
                    catalog_code: code,
                    required_qty: qty,
                    auto_demand_in_house: !!def.auto_demand_in_house,
                    formula: def.qty_formula,
                });
            }
            return lines;
        };
        if (!master.id || master.id.startsWith("tmp-")) return localResolve();
        return tryRequest(
            async () => {
                const { data } = await api.post<{ lines?: Array<any> } | Array<any>>(
                    `/api/master/products/${master.id}/catalog-bom-preview/`,
                    { axis_values, total_pouches, overlay }
                );
                return Array.isArray(data) ? data : (data.lines || []);
            },
            localResolve
        );
    },

    /**
     * Return all PMs that consume this PM as upstream WIP (BOM linkage).
     * Used by the Product Master right-rail "Used by" panel.
     */
    listConsumers: async (id: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<ProductMaster>>(`/api/master/products/${id}/consumers/`);
                return unwrap<ProductMaster>(data);
            },
            () => {
                const target = STATE.masters.find((m) => m.id === id);
                if (!target) return [];
                // Mock: scan layer_template film_variant_codes for any code we own.
                const ourCodes = new Set<string>([target.code, ...target.layer_template.map((l) => l.film_variant_code)].filter(Boolean));
                return clone(
                    STATE.masters.filter(
                        (m) => m.id !== id && m.layer_template.some((l) => ourCodes.has(l.film_variant_code))
                    )
                );
            }
        );
    },

    listSizes: async (productId: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<ProductMasterSize>>(
                    `/api/master/products/${productId}/sizes/`
                );
                return unwrap<ProductMasterSize>(data).map(normalizeSize);
            },
            () => clone(STATE.sizes[productId] || [])
        );
    },

    saveSize: async (productId: string, payload: Partial<ProductMasterSize>) => {
        const normalizedPayload = sizePayload(payload);
        if (isPersistedId(payload.id)) {
            const { data } = await api.patch<ProductMasterSize>(
                `/api/master/product-sizes/${payload.id}/`,
                normalizedPayload
            );
            return normalizeSize(data);
        }
        const { data } = await api.post<ProductMasterSize>(
            `/api/master/products/${productId}/sizes/`,
            normalizedPayload
        );
        return normalizeSize(data);
    },

    deleteSize: async (sizeId: string) => {
        if (!isPersistedId(sizeId)) return;
        await api.delete(`/api/master/product-sizes/${sizeId}/`);
    },

    listOverlays: async (productId: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<CustomerProductOverlay>>(
                    `/api/master/products/${productId}/overlays/`
                );
                return unwrap<CustomerProductOverlay>(data);
            },
            () => clone(STATE.overlays[productId] || [])
        );
    },

    listCustomerOverlays: async (params?: { customer?: string; product_master?: string; active?: boolean; q?: string }) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<CustomerProductOverlay>>(
                    "/api/master/customer-product-overlays/",
                    { params }
                );
                return unwrap<CustomerProductOverlay>(data);
            },
            () => {
                const rows = Object.values(STATE.overlays).flat();
                return clone(rows).filter((row) => {
                    if (params?.customer && row.customer !== params.customer) return false;
                    if (params?.product_master && row.product_master !== params.product_master) return false;
                    if (typeof params?.active === "boolean" && row.active !== params.active) return false;
                    if (params?.q) {
                        const q = params.q.toLowerCase();
                        const haystack = [
                            row.customer_item_code,
                            row.customer_display_name,
                            row.customer_name,
                            row.product_master_code,
                            row.product_master_name,
                        ].join(" ").toLowerCase();
                        if (!haystack.includes(q)) return false;
                    }
                    return true;
                });
            }
        );
    },

    getCustomerOverlay: async (id: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<CustomerProductOverlay>(
                    `/api/master/customer-product-overlays/${id}/`
                );
                return data;
            },
            () => {
                const row = Object.values(STATE.overlays).flat().find((item) => item.id === id);
                if (!row) throw new Error("Customer overlay not found");
                return clone(row);
            }
        );
    },

    createOverlay: async (productId: string, payload: Partial<CustomerProductOverlay>) => {
        const { data } = await api.post<CustomerProductOverlay>(
            `/api/master/products/${productId}/overlays/`,
            payload
        );
        return data;
    },

    listVariants: async (productId: string) => {
        return tryRequest(
            async () => {
                const { data } = await api.get<MaybePaginated<ProductVariant>>(
                    `/api/master/products/${productId}/variants/`
                );
                return unwrap<ProductVariant>(data);
            },
            () => clone(STATE.variants[productId] || [])
        );
    },

    findOrCreateVariant: async (
        productId: string,
        payload: { axis_values: Record<string, any> }
    ) => {
        const { data } = await api.post<ProductVariant | { variant: ProductVariant; created: boolean }>(
            `/api/master/products/${productId}/variants/find-or-create/`,
            payload
        );
        return (data as any)?.variant || data;
    },

    /**
     * Manually link (or unlink) a ProductVariant of a PACKAGING / POD master
     * to a specific fixed InventoryMaterial row in /master/packaging or /master/pod.
     * This call never creates a catalog SKU; pass `inventory_material_id: null` to unlink.
     */
    linkVariantInventory: async (
        productId: string,
        variantId: string,
        inventoryMaterialId: string | null,
        podSkuVariantId?: string | null,
    ) => {
        const payload = podSkuVariantId
            ? { inventory_material_id: null, pod_sku_variant_id: podSkuVariantId }
            : { inventory_material_id: inventoryMaterialId, pod_sku_variant_id: null }
        const { data } = await api.post<{
            variant_id: string
            inventory_link: {
                id: string
                code: string
                name: string
                category: string
                packaging_kind: string
                base_uom: string
            } | null
        }>(
            `/api/master/products/${productId}/variants/${variantId}/link-inventory/`,
            payload,
        )
        return data
    },

    previewBom: async (payload: PreviewBomRequest) => {
        const { data } = await api.post<PreviewBomResult>(
            `/api/master/products/${payload.product_master}/preview-bom/`,
            payload
        );
        return data;
    },

    getTemplate: async (productId: string) => {
        const { data } = await api.get<{
            template: { id: string; name: string; fg_type?: string; status?: string } | null;
            route_steps: Array<{
                index: number;
                name: string;
                process_code?: string;
                transition?: string;
                roll_behavior?: string;
                has_artwork?: boolean;
                route_node_id?: string;
                branch_key?: string;
                join_key?: string;
                parallel_group?: string;
                predecessor_node_ids?: string[];
                successor_node_ids?: string[];
                is_join?: boolean;
                is_parallel_start?: boolean;
            }>;
        }>(`/api/master/products/${productId}/template/`);
        return data;
    },
};

// Local preview builder uses sizes + layers from the seed to produce a
// convincing BOM preview while the backend is being implemented.
function buildLocalPreview(payload: PreviewBomRequest): PreviewBomResult {
    const master = STATE.masters.find((m) => m.id === payload.product_master);
    if (!master) {
        return {
            variant_status: "NEW",
            invariant_signature: "INV-UNKNOWN",
            geometry_snapshot: {},
            layer_snapshot: [],
            blockers: ["Product master not found"],
            checks: [{ label: "Product master", ok: false, tone: "error" }],
        };
    }
    const sizeRows = STATE.sizes[master.id] || [];
    const sizeCode = payload.axis_values?.size as string | undefined;
    const sizeRow = sizeRows.find((s) => s.code === sizeCode) || sizeRows[0];
    const layerThicknesses = (payload.axis_values?.layer_thicknesses || {}) as Record<string, number>;
    const layerGrades = (payload.axis_values?.layer_grades || {}) as Record<string, string>;
    const layerWidths = (payload.axis_values?.layer_widths || {}) as Record<string, number>;
    const requestedWipRollWidthMm = Number(payload.wip_roll_width_mm || payload.target_roll_width_mm || 0) || 0;

    const layerSnapshot = master.layer_template.map((row, i) => {
        const idx = String(i + 1);
        const t = layerThicknesses[idx] ?? row.thickness_micron;
        const g = layerGrades[idx] ?? row.default_grade ?? "";
        const w = requestedWipRollWidthMm || (layerWidths[idx] ?? sizeRow?.roll_width_mm ?? row.default_input_roll_width_mm ?? 0);
        return {
            role: row.role,
            film_variant_code: row.film_variant_code,
            thickness_micron: t,
            grade: g,
            roll_width_mm: w,
        };
    });

    const totalThickness = layerSnapshot.reduce((sum, l) => sum + (l.thickness_micron || 0), 0);
    const geometryConfig = (sizeRow?.geometry_config || {}) as Record<string, any>;
    const geometryMultipliers = (sizeRow?.multipliers || geometryConfig.multipliers || {}) as Record<string, any>;
    const geometryAdjustments = Array.isArray(sizeRow?.adjustments)
        ? sizeRow.adjustments
        : Array.isArray(geometryConfig.adjustments)
          ? geometryConfig.adjustments
          : [];
    const adjustmentDelta = (dimension: "WIDTH" | "HEIGHT") =>
        geometryAdjustments.reduce((sum, row) => {
            const impact = String(row?.impact || row?.affects_dimension || "WIDTH").toUpperCase();
            if (impact !== dimension && impact !== "BOTH" && impact !== "ALL") return sum;
            return sum + (Number(row?.value || 0) || 0);
        }, 0);
    const pouchStyle = String(sizeRow?.pouch_style || geometryConfig.pouch_style || master.fixed_attributes?.default_pouch_style || "").toUpperCase();
    const trimLossMm = Number(sizeRow?.trim_loss_mm ?? geometryConfig.trim_loss_mm ?? 0) || 0;
    const flapTapeMm = Number(sizeRow?.flap_tape_mm ?? geometryConfig.flap_tape_mm ?? 0) || 0;
    const gussetMm = Number(sizeRow?.gusset_mm || 0) || 0;
    let effectiveWidthMm = Number(sizeRow?.width_mm || 0) + adjustmentDelta("WIDTH") + trimLossMm;
    const effectiveHeightMm = Number(sizeRow?.height_mm || 0) + adjustmentDelta("HEIGHT") + flapTapeMm;
    if (gussetMm > 0) {
        if (["STAND_UP", "SIDE_GUSSET", "SPOUT"].includes(pouchStyle)) effectiveWidthMm += gussetMm;
        if (["QUAD_SEAL", "FLAT_BOTTOM"].includes(pouchStyle)) effectiveWidthMm += gussetMm * 2;
    }
    const childTargetWidthMm = Number(sizeRow?.child_target_width_mm ?? geometryConfig.child_target_width_mm ?? 0) || 0;
    const filmAreaWidthMm = Number(sizeRow?.film_area_width_mm ?? geometryConfig.film_area_width_mm ?? 0) || 0;
    const legacyOpenWebWidthMm = master.product_kind === "ROLL" ? effectiveWidthMm : effectiveWidthMm * 2;
    const rollWidthMm = requestedWipRollWidthMm || Number(sizeRow?.roll_width_mm || 0) || childTargetWidthMm || legacyOpenWebWidthMm;
    const bomAreaWidthMm = filmAreaWidthMm || rollWidthMm;
    const qty = payload.quantity || 0;
    const pitchMm = master.product_kind === "ROLL" ? 1 : (Number(sizeRow?.height_mm || 0) || effectiveHeightMm || 0);
    const unitWeightG = sizeRow ? Math.round(((bomAreaWidthMm * pitchMm * totalThickness * 1.4) / 1_000_000) * 10) / 10 : undefined;
    const totalWeightKg = unitWeightG ? Math.round(((unitWeightG / 1000) * qty) * 100) / 100 : undefined;

    const overlays = STATE.overlays[master.id] || [];
    const overlay = overlays.find((o) => {
        if (!payload.customer_id) return false;
        if (o.customer !== payload.customer_id) return false;
        if (sizeCode && o.axis_values?.size && o.axis_values.size !== sizeCode) return false;
        return true;
    });

    const printing = payload.printing || {};
    const printCapable = master.fixed_attributes?.print_capable;
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (printCapable && printing.defer_artwork_to_planner) {
        warnings.push("Planner must assign approved artwork & cylinder before release.");
    }
    if (printCapable && printing.print_type === "ROTO" && printing.cylinder_required === false) {
        warnings.push("ROTO print requires cylinder readiness.");
    }

    const bomBySteps: BomByStep[] = printCapable
        ? [
              {
                  index: 1,
                  step_label: "Printing",
                  step_kind: "ROTO",
                  description: "Printing inks, solvents, cylinders, plates",
                  print_capable: true,
                  materials: [
                      { material_code: "INK-CMYK-SET", qty: 0.6, uom: "KG" },
                      { material_code: "SOLVENT-EA", qty: 0.4, uom: "KG" },
                  ],
              },
              {
                  index: 2,
                  step_label: "Lamination",
                  step_kind: "LAMINATION",
                  description: "Adhesive 2 GSM, solvent 1 GSM",
                  materials: [
                      { material_code: "ADH-2K", qty: 0.2, uom: "KG" },
                      { material_code: "SOLV-EA", qty: 0.1, uom: "KG" },
                  ],
              },
              {
                  index: 3,
                  step_label: "Pouching",
                  step_kind: "POUCHING",
                  description: `${master.fixed_attributes?.default_pouch_style || "POUCH"} conversion, zipper, labor, QA`,
                  materials: [
                      { material_code: "ZIPPER", qty: 0.05, uom: "KG" },
                  ],
              },
          ]
        : [
              {
                  index: 1,
                  step_label: "Extrusion",
                  step_kind: "EXTRUSION",
                  description: "LLDPE Natural Granule",
                  materials: [{ material_code: "LDPE-NATURAL", qty: 528, uom: "KG", waste_percent: 5.6 }],
              },
              {
                  index: 2,
                  step_label: "Slitting",
                  step_kind: "SLITTING",
                  description: "Roll handling & trim",
                  materials: [{ material_code: "TRIM", qty: 5, uom: "KG", waste_percent: 1 }],
              },
          ];

    return {
        variant_status: "NEW",
        invariant_signature: master.invariant_signature || "INV-DERIVED",
        geometry_snapshot: sizeRow
            ? {
                  finished_good_type: master.fixed_attributes?.fg_type || master.product_kind,
                  size_code: sizeRow.code,
                  size_label: sizeRow.label,
                  width_mm: sizeRow.width_mm,
                  height_mm: sizeRow.height_mm,
                  gusset_mm: sizeRow.gusset_mm,
                  roll_width_mm: rollWidthMm,
                  thickness_um: totalThickness,
                  trim_loss_mm: trimLossMm,
                  flap_tape_mm: flapTapeMm,
                  adjustments: geometryAdjustments,
                  multipliers: geometryMultipliers,
                  effective_width_mm: effectiveWidthMm,
                  effective_height_mm: effectiveHeightMm,
                  child_target_width_mm: childTargetWidthMm || rollWidthMm,
                  film_area_width_mm: bomAreaWidthMm,
              }
            : {},
        layer_snapshot: layerSnapshot,
        printing_snapshot: printing,
        packaging_snapshot: payload.packaging || {},
        bom_by_step: bomBySteps,
        overlay_match: overlay
            ? {
                  source: "EXACT_AXIS",
                  overlay_id: overlay.id,
                  customer_item_code: overlay.customer_item_code,
                  customer_display_name: overlay.customer_display_name,
                  default_price_basis: overlay.default_price_basis,
                  default_packing_note: overlay.default_packing_note,
              }
            : { source: "NONE" },
        stock_source_preview: {
            exact_fg: 0,
            shared_wip: master.product_kind === "POUCH" ? 1 : 0,
            fresh_route: 1,
        },
        unit_weight_g: unitWeightG,
        total_weight_kg: totalWeightKg,
        blockers,
        warnings,
        checks: [
            { label: "Customer ready", ok: Boolean(payload.customer_id), tone: payload.customer_id ? "ok" : "warn" },
            { label: "Product selected", ok: true, tone: "ok" },
            { label: "Preview valid", ok: blockers.length === 0, tone: blockers.length === 0 ? "ok" : "error" },
            { label: "Variant", ok: true, tone: "ok" },
            {
                label: "Artwork",
                ok: !printCapable || !!printing.artwork_id || !!printing.defer_artwork_to_planner,
                tone: !printCapable ? "ok" : printing.defer_artwork_to_planner ? "warn" : printing.artwork_id ? "ok" : "warn",
            },
        ],
    };
}

// ---------- Stock launcher (planner V3) ------------------------------------

export type CommitmentScope = "GENERIC" | "CUSTOMER" | "ARTWORK" | "CUSTOMER_ARTWORK";
export type LaunchMode = "GENERIC" | "CUSTOMER" | "ARTWORK" | "CUSTOMER_ARTWORK" | "PACKAGING" | "POD" | "POD_STOCK";

export interface ValidateStockPoolPayload {
    product_master: string;
    template_id?: string | null;
    axis_values: Record<string, any>;
    quantity?: number;
    quantity_uom?: "KG" | "PCS" | "METER";
    commitment_scope: CommitmentScope;
    committed_customer?: string | null;
    committed_artwork?: string | null;
    start_step_index: number;
    stop_step_index: number;
    launcher_mode?: LaunchMode | "POD_STOCK" | string;
    stock_purpose?: "PRODUCT" | "PACKAGING" | "POD";
    packaging_material?: string | null;
    packaging_material_id?: string | null;
    pod_sku_variant?: string | null;
    pod_sku_variant_id?: string | null;
    wip_roll_width_mm?: number | null;
    target_roll_width_mm?: number | null;
    printing?: any;
    packaging?: any;
    packaging_snapshot?: any;
    addons?: any;
}

export interface ValidateStockPoolResult {
    valid: boolean;
    reasons: string[];
    blockers?: string[];
    eligible_demand?: {
        computed?: boolean;
        eligible_orders: number;
        exact_match: number;
        widening_allowed: number;
        wrong_artwork: number;
    };
    commitment_safety?: {
        customer_lock?: string;
        artwork_lock?: string;
        match_window?: string;
    };
    bom_by_step?: BomByStep[];
    bom_snapshot?: any;
    geometry_snapshot?: any;
    layer_snapshot?: any[];
    invariant_signature?: string;
    required_material?: { code: string; name: string; grade?: string; thickness_micron?: number; width_mm?: number | null; target_qty: number; uom: string };
}

export interface CreateStockOrderPayload extends ValidateStockPoolPayload {
    quantity: number;
    quantity_uom: "KG" | "PCS" | "METER";
    stock_strategy?: string;
    planner_stock_class?: string;
    output_type?: string;
    stock_owner?: string;
    auto_release?: boolean;
}

export const stockLauncherService = {
    validate: async (payload: ValidateStockPoolPayload) => {
        const { data } = await api.post<ValidateStockPoolResult>(
            "/api/production/planner/stock-pools/validate/",
            payload
        );
        return data;
    },

    create: async (payload: CreateStockOrderPayload) => {
        const { data } = await api.post(
            "/api/production/planner/create-stock-order/",
            payload
        );
        return data;
    },
};

function buildLocalValidate(payload: ValidateStockPoolPayload): ValidateStockPoolResult {
    const master = STATE.masters.find((m) => m.id === payload.product_master);
    const sizeRows = master ? STATE.sizes[master.id] || [] : [];
    const sizeCode = payload.axis_values?.size as string | undefined;
    const sizeRow = sizeRows.find((s) => s.code === sizeCode) || sizeRows[0];
    const reasons: string[] = [];
    if (payload.commitment_scope === "CUSTOMER" && !payload.committed_customer)
        reasons.push("Customer is required for CUSTOMER scope.");
    if (payload.commitment_scope.includes("ARTWORK") && !payload.committed_artwork)
        reasons.push("Artwork is required for ARTWORK scope.");

    const layerThicknesses = (payload.axis_values?.layer_thicknesses || {}) as Record<string, number>;
    const layerGrades = (payload.axis_values?.layer_grades || {}) as Record<string, string>;
    const layerSnapshot = (master?.layer_template || []).map((row, i) => {
        const idx = String(i + 1);
        return {
            role: row.role,
            film_variant_code: row.film_variant_code,
            thickness_micron: layerThicknesses[idx] ?? row.thickness_micron,
            grade: layerGrades[idx] ?? row.default_grade ?? "",
            roll_width_mm: sizeRow?.roll_width_mm,
        };
    });

    const requiredMaterial = layerSnapshot[0]
        ? {
              code: layerSnapshot[0].film_variant_code || "FILM",
              name: master?.layer_template?.[0]?.role || "Film",
              grade: layerSnapshot[0].grade,
              thickness_micron: layerSnapshot[0].thickness_micron,
              width_mm: layerSnapshot[0].roll_width_mm,
              target_qty: 500,
              uom: "KG",
          }
        : undefined;

    return {
        valid: reasons.length === 0,
        reasons,
        eligible_demand: {
            eligible_orders: 5,
            exact_match: 3,
            widening_allowed: 2,
            wrong_artwork: 0,
        },
        commitment_safety: {
            customer_lock: payload.committed_customer || "None",
            artwork_lock: payload.committed_artwork || "None",
            match_window: payload.commitment_scope === "GENERIC" ? "Before print only" : "Configured",
        },
        bom_by_step: [
            {
                index: 1,
                step_label: "Extrusion",
                step_kind: "EXTRUSION",
                description: "LDPE Natural Granule",
                materials: [{ material_code: requiredMaterial?.code || "FILM", qty: 528, uom: "KG", waste_percent: 5.6 }],
            },
            {
                index: 2,
                step_label: "Slitting",
                step_kind: "SLITTING",
                description: "Roll handling & trim",
                materials: [{ material_code: "TRIM", qty: 5, uom: "KG", waste_percent: 1 }],
            },
        ],
        geometry_snapshot: sizeRow,
        layer_snapshot: layerSnapshot,
        invariant_signature: master?.invariant_signature,
        required_material: requiredMaterial,
    };
}
