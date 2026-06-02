import { api } from "@/lib/api"

export type PouchFormulaKind = "LINEAR" | "SHAPED_OVERRIDE" | "CUSTOM_AST"

/** One multiplicand inside a term — either a number or a field reference. */
export interface PouchFormulaFactor {
    kind: "NUMBER" | "FIELD"
    value?: number
    field?: string
}

/**
 * A term in the linear formula. Modern form is a product chain (`factors`):
 *
 *   factors: [{NUMBER 2}, {FIELD W}, {FIELD bottom_factor}]   →   2 × W × bottom_factor
 *
 * Legacy form (`field` + `coefficient`) is still read for backwards compat.
 * Total formula = Σ term + trim_mm.
 */
export interface PouchFormulaTerm {
    factors?: PouchFormulaFactor[]
    field?: string
    coefficient?: number
}

export type PouchAxis = "WIDTH" | "HEIGHT" | "BOTH" | "NONE"

export interface PouchFieldDef {
    required?: boolean
    label?: string
    min?: number
    max?: number
    default?: number | string
    /**
     * Which physical axis this field's value contributes to in the formula.
     * "WIDTH" → adds to the roll's width axis. "HEIGHT" → height axis.
     * "BOTH" → adds to both. "NONE" → informational only.
     * For W and H themselves this is implicit (WIDTH and HEIGHT respectively).
     */
    applies_to?: "WIDTH" | "HEIGHT" | "BOTH" | "NONE"
    /** Default coefficient suggestion for the formula builder. */
    default_coefficient?: number
}

export interface PouchFieldAdjustments {
    gusset_axis?: PouchAxis
    trim_axis?: PouchAxis
    trim_default_mm?: number
    default_roll_axis?: PouchAxis
    [k: string]: any
}

export interface PouchAstNode {
    op: "+" | "-" | "*" | "/" | "NUM" | "VAR" | "PARAM"
    value?: number
    name?: string
    left?: PouchAstNode
    right?: PouchAstNode
}

export interface PouchStyle {
    id: string
    code: string
    name: string
    description: string
    version: number
    locked: boolean
    visual_emoji: string
    visual_svg: string
    default_stock_form?: "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB" | string
    default_width_basis?: "OPEN_WEB_WIDTH" | "LAYFLAT_WIDTH" | "FOLDED_WIDTH" | string
    default_slit_policy?: "SLIT_ALLOWED" | "EXACT_ONLY" | string
    stock_form_options?: Record<string, any>
    default_roll_axis: PouchAxis
    allowed_fields: Record<string, PouchFieldDef>
    field_adjustments: PouchFieldAdjustments
    formula_kind: PouchFormulaKind
    formula_params: Record<string, any>
    formula_ast: PouchAstNode | Record<string, never>
    formula_expression: string
    deprecated: boolean
    sort_order: number
    notes: string
    sizes_count?: number
    created_by_name?: string
    updated_by_name?: string
    created_at?: string
    updated_at?: string
}

export interface PouchStylePayload {
    code: string
    name: string
    description?: string
    visual_emoji?: string
    visual_svg?: string
    default_stock_form?: "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB" | string
    default_width_basis?: "OPEN_WEB_WIDTH" | "LAYFLAT_WIDTH" | "FOLDED_WIDTH" | string
    default_slit_policy?: "SLIT_ALLOWED" | "EXACT_ONLY" | string
    stock_form_options?: Record<string, any>
    default_roll_axis?: PouchAxis
    allowed_fields?: Record<string, PouchFieldDef>
    field_adjustments?: PouchFieldAdjustments
    formula_kind: PouchFormulaKind
    formula_params?: Record<string, any>
    formula_ast?: PouchAstNode | Record<string, never>
    formula_expression?: string
    deprecated?: boolean
    sort_order?: number
    notes?: string
}

export interface PreviewBody {
    formula_kind: PouchFormulaKind
    formula_params?: Record<string, any>
    formula_ast?: PouchAstNode | Record<string, never>
    field_adjustments?: PouchFieldAdjustments
    inputs?: Record<string, number>
    stock_form?: string
}

export interface PouchStylePreviewResult {
    child_target_width_mm: number
    stock_width_mm: number
    film_area_width_mm: number
    stock_form: string
    width_basis: string
    slit_policy: string
    film_area_factor: number
}

export const pouchStyleService = {
    list: async (params?: Record<string, any>) => {
        const { data } = await api.get("/api/master/pouch-styles/", { params })
        if (Array.isArray(data)) return data as PouchStyle[]
        if (data && Array.isArray((data as any).results)) return (data as any).results as PouchStyle[]
        return [] as PouchStyle[]
    },
    get: async (id: string) => {
        const { data } = await api.get<PouchStyle>(`/api/master/pouch-styles/${id}/`)
        return data
    },
    create: async (body: PouchStylePayload) => {
        const { data } = await api.post<PouchStyle>("/api/master/pouch-styles/", body)
        return data
    },
    update: async (id: string, body: Partial<PouchStylePayload>) => {
        const { data } = await api.patch<PouchStyle>(`/api/master/pouch-styles/${id}/`, body)
        return data
    },
    /** Explicit approval gate. Only approved/locked styles are selectable on product sizes. */
    approve: async (id: string) => {
        const { data } = await api.post<PouchStyle>(`/api/master/pouch-styles/${id}/approve/`)
        return data
    },
    /** Soft-delete · toggles deprecated=true (preserves historical FKs). */
    disable: async (id: string) => {
        const { data } = await api.delete<PouchStyle>(`/api/master/pouch-styles/${id}/`)
        return data
    },
    /** Re-enable a disabled style. */
    reactivate: async (id: string) => {
        const { data } = await api.post<PouchStyle>(`/api/master/pouch-styles/${id}/reactivate/`)
        return data
    },
    /** All versions of one code, newest first. */
    versions: async (code: string) => {
        const { data } = await api.get<PouchStyle[]>(`/api/master/pouch-styles/by-code/${encodeURIComponent(code)}/`)
        return Array.isArray(data) ? data : []
    },
    preview: async (body: PreviewBody) => {
        const { data } = await api.post<PouchStylePreviewResult>(
            "/api/master/pouch-styles/preview/",
            body,
        )
        return data
    },
}

// ─── Pure-frontend resolver (mirrors apps/materials/services_pouch_style.py) ─────

function _f(v: any, d = 0): number {
    if (v == null || v === "") return d
    const n = Number(v)
    return Number.isFinite(n) ? n : d
}

const AST_MAX_DEPTH = 64

export function computeChildTargetWidthMm(
    style: Pick<PouchStyle, "formula_kind" | "formula_params" | "formula_ast" | "field_adjustments">,
    inputs: Record<string, number | string | undefined>,
): number {
    const kind = String(style.formula_kind || "LINEAR").toUpperCase() as PouchFormulaKind
    const params = (style.formula_params || {}) as Record<string, any>
    const adj = (style.field_adjustments || {}) as Record<string, any>

    if (kind === "SHAPED_OVERRIDE") {
        return Math.round(_f(inputs.override_width, 0) * 100) / 100
    }
    if (kind === "CUSTOM_AST") {
        const ast = style.formula_ast as PouchAstNode
        if (!ast || !ast.op) return 0
        return Math.round(evalAst(ast, inputs, params, 0) * 100) / 100
    }

    // LINEAR: sum of term-products + trim
    const terms = Array.isArray(params.terms) ? (params.terms as PouchFormulaTerm[]) : []
    const trim = _f(params.trim_mm, _f(adj.trim_default_mm))
    let total = 0
    for (const t of terms) {
        if (!t) continue
        if (Array.isArray(t.factors) && t.factors.length > 0) {
            let prod = 1
            let saw = false
            for (const f of t.factors) {
                if (!f) continue
                const kind = String(f.kind).toUpperCase()
                if (kind === "NUMBER") { prod *= _f(f.value, 0); saw = true }
                else if (kind === "FIELD" && f.field) { prod *= _f(inputs[f.field]); saw = true }
            }
            if (saw) total += prod
            continue
        }
        if (t.field) {
            const coeff = _f(t.coefficient, 1)
            total += coeff * _f(inputs[t.field])
        }
    }
    total += trim
    return Math.round(total * 100) / 100
}

function evalAst(
    node: PouchAstNode,
    inputs: Record<string, number | string | undefined>,
    params: Record<string, any>,
    depth: number,
): number {
    if (depth > AST_MAX_DEPTH) throw new Error("Formula too deep")
    if (!node || typeof node !== "object") throw new Error("Bad AST node")
    const op = String(node.op).toUpperCase()
    if (op === "NUM") return _f(node.value)
    if (op === "VAR") return _f(inputs[String(node.name || "")])
    if (op === "PARAM") return _f(params[String(node.name || "")])
    if (op === "+" || op === "-" || op === "*" || op === "/") {
        const l = evalAst(node.left as PouchAstNode, inputs, params, depth + 1)
        const r = evalAst(node.right as PouchAstNode, inputs, params, depth + 1)
        if (op === "+") return l + r
        if (op === "-") return l - r
        if (op === "*") return l * r
        return r === 0 ? 0 : l / r
    }
    throw new Error(`Unsupported op: ${op}`)
}

export const FORMULA_KIND_LABELS: Record<PouchFormulaKind, string> = {
    LINEAR: "Linear formula · Σ (coefficient × field) + trim",
    SHAPED_OVERRIDE: "Shaped — operator types target width directly",
    CUSTOM_AST: "Custom — operator builds full expression tree",
}

/** Convenience for the editor: given allowed_fields, build a default terms[] list (product-chain form). */
export function defaultLinearTermsForFields(
    allowed: Record<string, PouchFieldDef>,
): PouchFormulaTerm[] {
    return Object.keys(allowed)
        .filter((k) => k !== "override_width") // exclude override_width — used by SHAPED_OVERRIDE
        .map((field) => {
            const def = allowed[field] || {}
            const coeff = typeof def.default_coefficient === "number" ? def.default_coefficient : 1
            return {
                factors: [
                    { kind: "NUMBER", value: coeff },
                    { kind: "FIELD", field },
                ],
            } as PouchFormulaTerm
        })
}

/** Convenience: build a single-factor field term (used when user clicks +Add term). */
export function makeFieldTerm(field: string, coefficient = 1): PouchFormulaTerm {
    return {
        factors: [
            { kind: "NUMBER", value: coefficient },
            { kind: "FIELD", field },
        ],
    }
}

/** Render a term as a readable math string. */
export function termToString(t: PouchFormulaTerm): string {
    if (Array.isArray(t.factors) && t.factors.length > 0) {
        const parts = t.factors
            .map((f) => {
                if (!f) return ""
                if (f.kind === "NUMBER") return String(f.value ?? 0)
                if (f.kind === "FIELD") return String(f.field || "?")
                return ""
            })
            .filter(Boolean)
        return parts.join(" × ")
    }
    if (t.field) {
        const c = Number(t.coefficient || 0)
        return `${c} × ${t.field}`
    }
    return ""
}
