"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Sparkles, Lock, ExternalLink } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { pouchStyleService, computeChildTargetWidthMm, type PouchStyle } from "@/services/pouch-style"
import type { ProductMasterSize } from "@/services/product-master"

interface PouchStyleBindingProps {
    row: ProductMasterSize
    onPatch: (patch: Partial<ProductMasterSize>) => void
    className?: string
}

/**
 * Renders a Pouch-Style binding card at the top of the size editor.
 * - Dropdown of all PouchStyleMaster rows
 * - Lists style's `allowed_fields` so operator knows what to fill below
 * - Shows live-computed child_target_width_mm from the formula
 * - Override toggle that lets operator type the target manually
 */
export function PouchStyleBinding({ row, onPatch, className }: PouchStyleBindingProps) {
    const { data: styles = [], isLoading } = useQuery({
        queryKey: ["pouch-styles", "for-size"],
        queryFn: () => pouchStyleService.list({ page_size: 200 }),
        staleTime: 60_000,
    })

    const selectedId = String(row.pouch_style_master || "")
    const selected: PouchStyle | undefined = styles.find((s) => s.id === selectedId)
    const geometryConfig = row.geometry_config && typeof row.geometry_config === "object" ? row.geometry_config : {}
    const customFormulaInputs = geometryConfig.pouch_formula_inputs && typeof geometryConfig.pouch_formula_inputs === "object"
        ? geometryConfig.pouch_formula_inputs as Record<string, any>
        : {}

    // Build the input dict from the row (W, H, gusset, flap, …)
    const previewInputs = React.useMemo(() => {
        const out: Record<string, number> = {}
        if (row.width_mm != null) out.W = Number(row.width_mm)
        if (row.height_mm != null) out.H = Number(row.height_mm)
        if (row.gusset_mm != null) {
            out.gusset = Number(row.gusset_mm)
            out.G = Number(row.gusset_mm)
        }
        if (row.flap_tape_mm != null) {
            out.flap = Number(row.flap_tape_mm)
            out.flap_mm = Number(row.flap_tape_mm)
        }
        if (row.child_target_width_mm != null) out.override_width = Number(row.child_target_width_mm)
        for (const [key, value] of Object.entries(customFormulaInputs)) {
            const numeric = Number(value)
            if (Number.isFinite(numeric)) out[key] = numeric
        }
        for (const [key, def] of Object.entries(selected?.allowed_fields || {})) {
            if (out[key] != null) continue
            if (def && def.default != null && def.default !== "") {
                const numeric = Number(def.default)
                if (Number.isFinite(numeric)) out[key] = numeric
            }
        }
        return out
    }, [row.width_mm, row.height_mm, row.gusset_mm, row.flap_tape_mm, row.child_target_width_mm, customFormulaInputs, selected])

    const patchFormulaInput = (key: string, value: string) => {
        const nextInputs = { ...customFormulaInputs }
        if (value === "") delete nextInputs[key]
        else nextInputs[key] = Number(value)
        onPatch({
            geometry_config: {
                ...geometryConfig,
                pouch_formula_inputs: nextInputs,
            },
        })
    }

    const liveTarget = React.useMemo(() => {
        if (!selected) return null
        try {
            return computeChildTargetWidthMm(
                {
                    formula_kind: selected.formula_kind,
                    formula_params: selected.formula_params || {},
                    formula_ast: selected.formula_ast as any,
                    field_adjustments: selected.field_adjustments || {},
                },
                previewInputs,
            )
        } catch {
            return null
        }
    }, [selected, previewInputs])

    // Auto-compute and persist target when not in override mode and any input changes.
    React.useEffect(() => {
        if (!selected) return
        if (row.child_target_override) return
        if (liveTarget == null) return
        if (Number(row.child_target_width_mm || 0) === liveTarget) return
        onPatch({ child_target_width_mm: liveTarget })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected?.id, liveTarget, row.child_target_override, row.width_mm, row.height_mm, row.gusset_mm, row.flap_tape_mm])

    return (
        <section className={cn("rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 p-4", className)}>
            <header className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-white">
                        <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Pouch style</h3>
                        <p className="text-[10px] text-slate-500">Pick a style master · formula auto-computes the target child web width.</p>
                    </div>
                </div>
                <Link href="/master/pouch-styles" className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 hover:underline">
                    Manage styles <ExternalLink className="h-3 w-3" />
                </Link>
            </header>

            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pouch style master</div>
                    <Select
                        value={selectedId || "__none__"}
                        onValueChange={(v) => {
                            if (v === "__none__") {
                                onPatch({ pouch_style_master: null, pouch_style_version: 0 })
                                return
                            }
                            const next = styles.find((s) => s.id === v)
                            onPatch({
                                pouch_style_master: v,
                                pouch_style_version: next?.version || 1,
                            })
                        }}
                    >
                        <SelectTrigger className="mt-1 h-9">
                            <SelectValue placeholder={isLoading ? "Loading…" : "Pick a pouch style"} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none__">— None (manual entry) —</SelectItem>
                            {styles.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                    <span className="mr-1">{s.visual_emoji}</span> {s.code} · {s.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {selected ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-800">
                                v{selected.version}
                            </Badge>
                            <span className="font-mono text-[10px] text-slate-700">{selected.formula_kind}</span>
                            {selected.locked ? (
                                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[9px] text-emerald-700">
                                    <Lock className="mr-0.5 h-2.5 w-2.5" /> locked
                                </Badge>
                            ) : null}
                        </div>
                    ) : null}
                    {selected ? (
                        <div className="mt-2 rounded-lg bg-white p-2 ring-1 ring-indigo-200 text-[11px]">
                            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Allowed inputs</div>
                            <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                                {Object.entries(selected.allowed_fields || {}).map(([k, def]) => (
                                    <span
                                        key={k}
                                        className={cn(
                                            "rounded px-1.5 py-0.5 font-mono ring-1",
                                            def.required ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-50 text-slate-700 ring-slate-200",
                                        )}
                                    >
                                        {k}{def.required ? " *" : ""}
                                    </span>
                                ))}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-slate-600">{selected.formula_expression || ""}</div>
                            <FormulaInputGrid
                                style={selected}
                                values={previewInputs}
                                onPatch={patchFormulaInput}
                            />
                        </div>
                    ) : null}
                </div>

                <div className="space-y-2">
                    {/* AUTO computed (always shown) */}
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Auto child width (from formula)</div>
                        <div className={cn(
                            "mt-1 rounded-xl p-3 text-white",
                            row.child_target_override ? "bg-slate-400" : "bg-emerald-600",
                        )}>
                            <div className="font-display text-3xl font-extrabold">
                                {liveTarget != null ? liveTarget.toFixed(2) : "—"}
                                <span className="ml-1 text-base font-bold">mm</span>
                            </div>
                            <div className="text-[10px] text-white/90">
                                {selected
                                    ? row.child_target_override
                                        ? "auto value · NOT used (override active)"
                                        : "auto value · this is what will be used"
                                    : "no style picked — pick one above"}
                            </div>
                        </div>
                    </div>

                    {/* OVERRIDE input (always visible) */}
                    <div>
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Override (optional)</div>
                            {row.child_target_override ? (
                                <button
                                    type="button"
                                    onClick={() => onPatch({ child_target_override: false, child_target_width_mm: liveTarget })}
                                    className="text-[10px] font-bold text-rose-700 underline hover:text-rose-900"
                                >Clear override</button>
                            ) : null}
                        </div>
                        <Input
                            type="number"
                            min={0}
                            step="any"
                            value={row.child_target_override ? Number(row.child_target_width_mm || 0) : ""}
                            placeholder="leave blank to use auto"
                            onChange={(e) => {
                                const v = e.target.value
                                if (v === "") {
                                    onPatch({ child_target_override: false, child_target_width_mm: liveTarget })
                                } else {
                                    onPatch({ child_target_override: true, child_target_width_mm: Number(v) })
                                }
                            }}
                            className={cn(
                                "mt-1 h-9 font-mono",
                                row.child_target_override ? "border-amber-400 ring-1 ring-amber-200" : "",
                            )}
                        />
                        <div className="mt-1 text-[10px] text-slate-500">
                            {row.child_target_override
                                ? "Override active. Lane/slit logic uses this value, not the auto."
                                : "Blank = use auto value above. Type a number to override per-size."}
                        </div>
                    </div>

                    {/* Final value used downstream */}
                    <div className="rounded-xl border-2 border-indigo-300 bg-indigo-50/60 p-2.5">
                        <div className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Final width used downstream</div>
                        <div className="mt-1 font-mono text-lg font-extrabold text-indigo-900">
                            {(row.child_target_override
                                ? Number(row.child_target_width_mm || 0)
                                : (liveTarget ?? 0)
                            ).toFixed(2)} mm
                        </div>
                        <div className="mt-0.5 text-[10px] text-indigo-700">
                            Drives lane-up math, planned parent width, allocator tiers, slit confirm.
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

const STANDARD_FORMULA_FIELDS = new Set(["W", "H", "G", "gusset", "gusset_mm", "flap", "flap_mm", "override_width"])

function FormulaInputGrid({
    style,
    values,
    onPatch,
}: {
    style: PouchStyle
    values: Record<string, number>
    onPatch: (key: string, value: string) => void
}) {
    const extras = Object.entries(style.allowed_fields || {}).filter(([key]) => !STANDARD_FORMULA_FIELDS.has(key))
    if (extras.length === 0) return null

    return (
        <div className="mt-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/30 p-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Formula extras</div>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
                {extras.map(([key, def]) => (
                    <label key={key} className="block">
                        <div className="mb-0.5 flex items-center justify-between gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{def.label || key}</span>
                            <span className="font-mono text-[9px] text-slate-400">{key}</span>
                        </div>
                        <Input
                            type="number"
                            step="any"
                            value={values[key] ?? ""}
                            onChange={(event) => onPatch(key, event.target.value)}
                            placeholder={def.default != null ? String(def.default) : "0"}
                            className="h-8 bg-white font-mono text-xs"
                        />
                    </label>
                ))}
            </div>
            <div className="mt-1 text-[10px] text-indigo-700/80">
                These values are saved on this size and feed the pouch-style formula together with W/H/gusset/flap.
            </div>
        </div>
    )
}
