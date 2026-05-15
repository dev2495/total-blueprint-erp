"use client"

/**
 * V3.7 Product Master detail — fresh build matching
 *   docs/mockups/pm-v37-detail-refresh.html
 *   docs/mockups/pm-v37-variants-preview.html
 *
 * Reads only existing service endpoints. No field, schema, or mutation change.
 *
 * Layout:
 *   - Sticky top bar (breadcrumb · status · action buttons)
 *   - Tab strip (Overview / Layer template / Variants / Sizes / Overlays / Artworks / Audit)
 *   - Body per tab:
 *       Overview        — Subtle hero + 4-KPI right side, then 2-col layout
 *                          left = Layer template, Variant axes, Recent variants peek
 *                          right side rail = activity, quick links, ownership
 *       Layer template  — list of layers with thickness/grade chips
 *       Variants        — pivot matrix + cards + table (delegates to VariantsMatrixV37)
 *       Sizes           — table of sizes
 *       Overlays        — table of customer overlays
 *       Artworks        — approved artwork grid
 *       Audit           — placeholder linking to /system/audit
 */

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowLeft,
    ArrowRight,
    Archive,
    BookOpen,
    Calendar,
    Copy,
    Database,
    Edit3,
    Eye,
    FileText,
    Layers,
    Loader2,
    Package,
    Palette,
    Pencil,
    Plus,
    Printer,
    Route,
    ShieldCheck,
    Sparkles,
    Users,
    Workflow,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api"
import {
    productMasterService,
    type ProductMaster,
    type ProductMasterSize,
    type ProductVariant,
    type CustomerProductOverlay,
    type VariantAxisDef,
} from "@/services/product-master"
import { templateService } from "@/services/templates"
import { engineeringService, type Artwork } from "@/services/engineering"
import { masterDataService, type Customer, type PackagingMaterial, type PodSkuVariant, type Addon } from "@/services/master-data"
import { useToast } from "@/hooks/use-toast"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { VariantsMatrixV37, VariantLiveRail } from "./variants-matrix-v37"
import { LiveBomRail } from "@/components/erp-v3/live-bom-rail"

interface Props {
    productId: string
}

type TabKey = "overview" | "layer" | "variants" | "sizes" | "overlays" | "artworks" | "audit"

const TABS: Array<{ id: TabKey; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "layer", label: "Layer template" },
    { id: "variants", label: "Variants" },
    { id: "sizes", label: "Sizes" },
    { id: "overlays", label: "Customer overlays" },
    { id: "artworks", label: "Artworks" },
    { id: "audit", label: "Audit trail" },
]

export function PmDetailV37({ productId }: Props) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const initialTab = ((): TabKey => {
        const t = searchParams?.get("tab") || ""
        return (TABS.find((x) => x.id === t)?.id) || "overview"
    })()
    const [tab, setTab] = React.useState<TabKey>(initialTab)
    const [overlayOpen, setOverlayOpen] = React.useState(false)

    const { data: master, isLoading: masterLoading, error: masterError } = useQuery({
        queryKey: ["product-master", productId],
        queryFn: () => productMasterService.get(productId),
        enabled: !!productId,
    })
    const { data: sizes = [] } = useQuery({
        queryKey: ["product-master-sizes", productId],
        queryFn: () => productMasterService.listSizes(productId),
        enabled: !!productId,
    })
    const { data: variants = [] } = useQuery({
        queryKey: ["product-master-variants", productId],
        queryFn: () => productMasterService.listVariants(productId),
        enabled: !!productId,
    })
    const { data: overlays = [] } = useQuery({
        queryKey: ["product-master-overlays", productId],
        queryFn: () => productMasterService.listOverlays(productId),
        enabled: !!productId,
    })
    const { data: routeInfo } = useQuery({
        queryKey: ["product-master-template", productId, master?.template || master?.default_template || null],
        queryFn: () => productMasterService.getTemplate(productId),
        enabled: !!productId && !!(master?.template || master?.default_template),
        staleTime: 60_000,
    })
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" }),
        staleTime: 60_000,
    })
    const { data: artworks = [] } = useQuery({
        queryKey: ["product-master-artworks", productId, "approved-any-method"],
        queryFn: () => engineeringService.getArtworks({ status: "APPROVED" }),
        enabled: !!productId && !!master?.fixed_attributes?.print_capable,
        staleTime: 60_000,
    })

    // Catalog look-ups for showing real axis allowed values + overlay defaults.
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["master-packaging-materials"],
        queryFn: masterDataService.getPackaging,
        staleTime: 60_000,
    })
    const { data: podVariants = [] } = useQuery({
        queryKey: ["master-pod-sku-variants", "active"],
        queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
        staleTime: 60_000,
    })
    const { data: addons = [] } = useQuery({
        queryKey: ["master-addons"],
        queryFn: masterDataService.getAddons,
        staleTime: 60_000,
    })
    const { data: customers = [] } = useQuery({
        queryKey: ["sales-customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })

    if (masterLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin text-slate-400" /> Loading product master…
            </div>
        )
    }
    if (masterError || !master) {
        return (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                <div className="font-bold">Could not load product master.</div>
                <div className="mt-1 text-xs">{describeApiError(masterError, "Check that the ID is correct.")}</div>
                <Button onClick={() => router.push("/master/products")} className="mt-3 rounded-xl bg-rose-700 hover:bg-rose-800 text-white" size="sm">
                    Back to list
                </Button>
            </div>
        )
    }

    const templateName = master.template_name || templates.find((t: any) => t.id === master.template)?.name || master.template_name || "—"
    const counts = {
        variants: master.variants_count ?? variants.length,
        sizes: master.sizes_count ?? sizes.length,
        overlays: master.overlays_count ?? overlays.length,
        artworks: master.artworks_count ?? 0,
    }

    return (
        <div className="space-y-4 pb-12">
            <TopBar master={master} onEdit={() => router.push(`/master/products/${productId}/edit`)} />
            <Tabs tab={tab} setTab={setTab} counts={counts} />

            {tab === "overview" ? (
                <OverviewTab
                    master={master}
                    sizes={sizes}
                    variants={variants}
                    overlays={overlays}
                    routeInfo={routeInfo}
                    templateName={templateName}
                    artworks={artworks}
                    packagingMaterials={packagingMaterials}
                    podVariants={podVariants}
                    addons={addons}
                />
            ) : null}
            {tab === "layer" ? <LayerTab master={master} /> : null}
            {tab === "variants" ? <VariantsTab master={master} variants={variants} sizes={sizes} routeInfo={routeInfo} templateName={templateName} /> : null}
            {tab === "sizes" ? <SizesTab sizes={sizes} master={master} /> : null}
            {tab === "overlays" ? (
                <OverlaysTab
                    master={master}
                    variants={variants}
                    overlays={overlays}
                    routeInfo={routeInfo}
                    templateName={templateName}
                    onAdd={() => setOverlayOpen(true)}
                />
            ) : null}
            {tab === "artworks" ? <ArtworksTab artworks={artworks} master={master} /> : null}
            {tab === "audit" ? <AuditPlaceholder masterId={productId} /> : null}

            <CreateOverlayDialog
                open={overlayOpen}
                onOpenChange={setOverlayOpen}
                master={master}
                sizes={sizes}
                customers={customers}
                artworks={artworks}
                packagingMaterials={packagingMaterials}
                podVariants={podVariants}
                addons={addons}
            />
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// Top bar
// ──────────────────────────────────────────────────────────────────

function TopBar({ master, onEdit }: { master: ProductMaster; onEdit: () => void }) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
                <Link href="/master/products" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700" title="Back to list">
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <div className="text-[10px] font-black tracking-[0.22em] text-slate-500 uppercase">Master data › Product master</div>
                    <div className="font-display text-sm font-bold text-slate-900 truncate">{master.name}</div>
                </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold ring-1", master.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                    {master.active ? "● ACTIVE" : "● INACTIVE"}
                </span>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                    <Archive className="h-3.5 w-3.5" /> Archive
                </button>
                <button onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-700">
                    <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
            </div>
        </header>
    )
}

// ──────────────────────────────────────────────────────────────────
// Tab strip
// ──────────────────────────────────────────────────────────────────

function Tabs({ tab, setTab, counts }: { tab: TabKey; setTab: (k: TabKey) => void; counts: { variants: number; sizes: number; overlays: number; artworks: number } }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm overflow-x-auto">
            <div className="inline-flex gap-1 min-w-max">
                {TABS.map((t) => {
                    const active = t.id === tab
                    const count = t.id === "variants" ? counts.variants : t.id === "sizes" ? counts.sizes : t.id === "overlays" ? counts.overlays : t.id === "artworks" ? counts.artworks : undefined
                    return (
                        <button key={t.id} onClick={() => setTab(t.id)} className={cn(
                            "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold",
                            active ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                        )}>
                            {t.label}
                            {typeof count === "number" ? (
                                <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black tabular-nums", active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600")}>
                                    {count}
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ──────────────────────────────────────────────────────────────────

function OverviewTab({ master, sizes, variants, overlays, routeInfo, templateName, artworks, packagingMaterials, podVariants, addons }: { master: ProductMaster; sizes: ProductMasterSize[]; variants: ProductVariant[]; overlays: CustomerProductOverlay[]; routeInfo: any; templateName: string; artworks: Artwork[]; packagingMaterials: PackagingMaterial[]; podVariants: PodSkuVariant[]; addons: Addon[] }) {
    return (
        <div className="space-y-4">
            {/* Subtle hero + 4-KPI strip side-by-side */}
            <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/40 to-indigo-50/30 px-5 py-4 shadow-sm">
                    <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-400 via-violet-400 to-fuchsia-400" />
                    <div className="relative pl-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600">Product kind · {master.product_kind}</div>
                        <h1 className="font-display text-2xl font-black text-slate-900 mt-0.5 tracking-tight">{master.name}</h1>
                        {master.description ? <p className="mt-1 text-xs text-slate-600 max-w-3xl">{master.description}</p> : null}
                        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <FactCell label="Master code" value={<span className="font-mono font-bold text-slate-900">{master.code}</span>} />
                            <FactCell label="Family" value={<span className="font-bold text-slate-900">{master.default_reporting_group} · {master.product_kind}</span>} />
                            <FactCell label="Reusable policy" value={<span className="font-bold text-slate-900 capitalize">{master.reusable_policy.toLowerCase()}</span>} />
                            <FactCell label="Template" value={<span className="font-bold text-slate-900 truncate">{templateName}</span>} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <KpiTile label="Variants" value={variants.length} sub={`${variants.filter((v) => v.active).length} active`} icon="🌀" />
                    <KpiTile label="Sizes" value={sizes.length} sub={sizes.length ? `${sizes[0].code} → ${sizes[sizes.length - 1].code}` : "—"} icon="📐" />
                    <KpiTile label="Overlays" value={overlays.length} sub={`${overlays.filter((o) => o.active).length} active`} icon="👥" />
                    <KpiTile label="Artworks" value={artworks.length} sub={artworks.length ? `${artworks.length} approved` : "—"} icon="🎨" />
                </div>
            </section>

            {/* Live route preview ribbon */}
            <RoutePreviewCard master={master} routeInfo={routeInfo} templateName={templateName} />

            {/* 2-col body */}
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-4">
                    <LayerTemplateCard master={master} />
                    {master.layer_template.length > 1 ? <ChemistryDefaultsCard master={master} /> : null}
                    <VariantAxesCard master={master} sizes={sizes} packagingMaterials={packagingMaterials} podVariants={podVariants} addons={addons} />
                    <PackagingContractCard master={master} packagingMaterials={packagingMaterials} podVariants={podVariants} />
                    <AddonsContractCard master={master} addons={addons} />
                    <RecentVariantsCard variants={variants} master={master} />
                </div>
                <aside className="space-y-3">
                    <RecentActivityCard master={master} routeInfo={routeInfo} />
                    <QuickLinksCard master={master} />
                    <OwnershipCard master={master} variants={variants} />
                </aside>
            </section>
        </div>
    )
}

function FactCell({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
            <div className="text-[9px] font-black uppercase text-slate-500">{label}</div>
            <div className="mt-0.5 truncate">{value}</div>
        </div>
    )
}

function KpiTile({ label, value, sub, icon }: { label: string; value: number | string; sub?: string; icon?: string }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</div>
                {icon ? <span className="text-base">{icon}</span> : null}
            </div>
            <div className="mt-1 font-display text-2xl font-black text-slate-900 tabular-nums">{value}</div>
            {sub ? <div className="text-[10px] text-slate-500 truncate">{sub}</div> : null}
        </div>
    )
}

// ─── Overview · Layer template card ───────────────────────────────

function LayerTemplateCard({ master }: { master: ProductMaster }) {
    const layers = master.layer_template || []
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Layers className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Layer template</h3>
                        <div className="text-[10px] text-slate-500">{layers.length} layer{layers.length === 1 ? "" : "s"} · identity fixed · thickness/grade configurable per variant</div>
                    </div>
                </div>
            </header>
            {layers.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 italic">No layers defined yet.</div>
            ) : (
                <div className="p-5 space-y-2">
                    {layers.map((l: any, i: number) => {
                        const gradeOptions: string[] = Array.isArray(l.grade_options) ? l.grade_options : []
                        const variable = gradeOptions.length > 1 || l.thickness_apportion === "variable"
                        return (
                            <div key={i} className={cn("rounded-xl border p-3", variable ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 bg-slate-50/40")}>
                                <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-black", variable ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800")}>L{i + 1}</span>
                                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">{l.role || `layer-${i + 1}`}{variable ? " · variable" : ""}</span>
                                    </div>
                                    <span className={cn("font-mono text-[11px]", variable ? "text-emerald-700" : "text-slate-500")}>
                                        {variable ? "apportioned per variant" : "fixed"}
                                    </span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <FieldSlot label="Film">
                                        <span className="font-mono font-bold text-slate-900">{l.film_variant_code || "—"}</span>
                                    </FieldSlot>
                                    <FieldSlot label={gradeOptions.length > 1 ? "Thickness options" : "Thickness"}>
                                        <span className="font-mono font-bold text-slate-900">{l.thickness_micron || 0} μ</span>
                                    </FieldSlot>
                                    <FieldSlot label={gradeOptions.length > 1 ? "Grade options" : "Grade"}>
                                        {gradeOptions.length > 0 ? (
                                            <div className="flex flex-wrap gap-1">
                                                {gradeOptions.map((g: string) => (
                                                    <span key={g} className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold ring-1", g === l.default_grade ? "bg-emerald-100 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200")}>{g}</span>
                                                ))}
                                            </div>
                                        ) : (
                                            <span className="font-mono text-slate-500">{l.default_grade || "—"}</span>
                                        )}
                                    </FieldSlot>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </section>
    )
}

function ChemistryDefaultsCard({ master }: { master: ProductMaster }) {
    const fixed: any = master.fixed_attributes || {}
    const rows = [
        {
            label: "Adhesive",
            code: fixed.adhesive_material_code,
            name: fixed.adhesive_material_name,
            gsm: fixed.adhesive_gsm,
            tone: "emerald",
        },
        {
            label: "Solvent",
            code: fixed.solvent_material_code,
            name: fixed.solvent_material_name,
            gsm: fixed.solvent_gsm,
            tone: "cyan",
        },
    ]
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Database className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Adhesive & solvent defaults</h3>
                        <div className="text-[10px] text-slate-500">Fixed master chemistry · one selected material each · GSM included in live BOM</div>
                    </div>
                </div>
            </header>
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
                {rows.map((row) => {
                    const configured = Boolean(row.code && Number(row.gsm || 0) > 0)
                    return (
                        <div key={row.label} className={cn(
                            "rounded-xl border p-3",
                            configured && row.tone === "emerald" && "border-emerald-200 bg-emerald-50/40",
                            configured && row.tone === "cyan" && "border-cyan-200 bg-cyan-50/40",
                            !configured && "border-slate-200 bg-slate-50/60"
                        )}>
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{row.label}</div>
                            <div className="mt-1 font-mono text-sm font-black text-slate-900">{row.code || "Not set"}</div>
                            <div className="mt-0.5 truncate text-[11px] text-slate-500">{row.name || "No material selected"}</div>
                            <div className="mt-2 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-700 ring-1 ring-slate-200">
                                {Number(row.gsm || 0) > 0 ? `${row.gsm} GSM` : "No GSM"}
                            </div>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

function FieldSlot({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="text-[9px] font-bold uppercase text-slate-500">{label}</div>
            <div className="mt-0.5">{children}</div>
        </div>
    )
}

// ─── Overview · Variant axes card ─────────────────────────────────

function VariantAxesCard({ master, sizes, packagingMaterials, podVariants, addons }: { master: ProductMaster; sizes: ProductMasterSize[]; packagingMaterials: PackagingMaterial[]; podVariants: PodSkuVariant[]; addons: Addon[] }) {
    const axes = master.variant_axes || []
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Workflow className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Variant axes · {axes.length} axes</h3>
                        <div className="text-[10px] text-slate-500">Each axis becomes one dropdown sales/planner sees while configuring</div>
                    </div>
                </div>
            </header>
            {axes.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 italic">No variant axes defined.</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-5">
                    {axes.map((axis: VariantAxisDef, i: number) => (
                        <AxisCard
                            key={`${axis.axis}-${i}`}
                            axis={axis}
                            master={master}
                            sizes={sizes}
                            packagingMaterials={packagingMaterials}
                            podVariants={podVariants}
                            addons={addons}
                        />
                    ))}
                </div>
            )}
        </section>
    )
}

/**
 * Resolves the allowed values for an axis as { code, label } pairs by walking
 * the master + linked catalogs. This is the source of truth for what sales
 * will see in the configure-line dropdowns.
 */
function resolveAxisValues(
    axis: VariantAxisDef,
    master: ProductMaster,
    sizes: ProductMasterSize[],
    packagingMaterials: PackagingMaterial[],
    podVariants: PodSkuVariant[],
    addons: Addon[],
): Array<{ code: string; label: string }> {
    const axisName = String(axis.axis)
    const catalogSource = axisCatalogSource(axis)

    // Explicit `options` on the axis definition (some axes pin a fixed list).
    const explicit = (axis as any).options as any[] | undefined
    const explicitAllowed = new Set(
        Array.isArray(explicit)
            ? explicit.map((o) => {
                if (typeof o === "string" || typeof o === "number") return String(o)
                return String(o?.code || o?.material_code || o?.value || o?.id || "")
            }).filter(Boolean).map((code) => normalizeCode(code))
            : [],
    )
    if (Array.isArray(explicit) && explicit.length && !catalogSource) {
        return explicit.map((o) => {
            if (typeof o === "string" || typeof o === "number") return { code: String(o), label: String(o) }
            const code = String(o.code || o.value || o.id || "")
            const label = String(o.label || o.name || code)
            return { code, label }
        }).filter((row) => row.code)
    }

    // size axis → master sizes
    if (axisName === "size") {
        return sizes
            .filter((s) => s.active !== false)
            .map((s) => ({ code: s.code, label: `${s.code} · ${s.width_mm}×${s.height_mm || 0}` }))
    }

    // layer_thicknesses → flatten layer thickness_micron values + grade_options
    if (axisName === "layer_thicknesses") {
        const set = new Set<number>()
        for (const l of master.layer_template || []) {
            const t = Number((l as any).thickness_micron || 0)
            if (t > 0) set.add(t)
        }
        return Array.from(set).sort((a, b) => a - b).map((t) => ({ code: `${t}`, label: `${t}μ` }))
    }
    if (axisName === "layer_grades") {
        const set = new Set<string>()
        for (const l of master.layer_template || []) {
            const opts: string[] = Array.isArray((l as any).grade_options) ? (l as any).grade_options : []
            for (const g of opts) if (g) set.add(String(g))
        }
        return Array.from(set).sort().map((g) => ({ code: g, label: g }))
    }

    // Catalog-backed axes
    if (catalogSource) {
        const filter = axis.master_data_filter || {}
        if (catalogSource === "packaging_material") {
            const rawKindFilter = filter.packaging_kind
            const kindFilters = Array.isArray(rawKindFilter)
                ? rawKindFilter.map((kind) => String(kind || "").toUpperCase()).filter(Boolean)
                : String(rawKindFilter || "").toUpperCase()
            return packagingMaterials
                .filter((m) => !m.status || String(m.status).toUpperCase() === "ACTIVE")
                .filter((m) => !explicitAllowed.size || explicitAllowed.has(normalizeCode(m.code)))
                .filter((m) => packagingMaterialAllowedForAxis(m, axis, master))
                .filter((m) => {
                    const kind = String(m.packaging_kind || "").toUpperCase()
                    return Array.isArray(kindFilters) ? !kindFilters.length || kindFilters.includes(kind) : !kindFilters || kind === kindFilters
                })
                .map((m) => ({ code: m.code, label: `${m.code}${m.name && m.name !== m.code ? ` · ${m.name}` : ""}` }))
        }
        if (catalogSource === "pod_sku_variant") {
            return podVariants
                .filter((v: any) => v.active !== false)
                .filter((v: any) => !explicitAllowed.size || explicitAllowed.has(normalizeCode(v.code)))
                .map((v: any) => ({ code: v.code, label: `${v.code}${v.name && v.name !== v.code ? ` · ${v.name}` : ""}` }))
        }
        if (catalogSource === "addon") {
            return addons
                .filter((a: any) => a.status !== "INACTIVE")
                .filter((a: any) => !explicitAllowed.size || explicitAllowed.has(normalizeCode(a.code)))
                .map((a: any) => ({ code: a.code, label: `${a.code}${a.name && a.name !== a.code ? ` · ${a.name}` : ""}` }))
        }
    }

    // addons axis (multi-enum) without master_data_source
    if (axisName === "addons") {
        return addons
            .filter((a: any) => a.status !== "INACTIVE")
            .map((a: any) => ({ code: a.code, label: `${a.code}${a.name && a.name !== a.code ? ` · ${a.name}` : ""}` }))
    }

    return []
}

function AxisCard({ axis, master, sizes, packagingMaterials, podVariants, addons }: {
    axis: VariantAxisDef
    master: ProductMaster
    sizes: ProductMasterSize[]
    packagingMaterials: PackagingMaterial[]
    podVariants: PodSkuVariant[]
    addons: Addon[]
}) {
    const isCatalog = !!axisCatalogSource(axis)
    const isRequired = axis.required
    const isSize = String(axis.axis) === "size"
    const accent = isCatalog
        ? "border-violet-200 bg-violet-50/30"
        : isSize
            ? "border-blue-200 bg-blue-50/30"
            : "border-slate-200 bg-slate-50/30"
    const eyebrowTone = isCatalog ? "text-violet-700" : isSize ? "text-blue-700" : "text-slate-700"
    const chipTone = isCatalog
        ? "bg-violet-100 text-violet-800 ring-violet-200"
        : isSize
            ? "bg-blue-100 text-blue-800 ring-blue-200"
            : "bg-indigo-50 text-indigo-800 ring-indigo-200"
    const allowed = resolveAxisValues(axis, master, sizes, packagingMaterials, podVariants, addons)
    const visible = allowed.slice(0, 5)
    const more = Math.max(0, allowed.length - visible.length)
    const description = axisDescription(axis)
    return (
        <div className={cn("rounded-xl border p-3", accent)}>
            <div className="flex items-center justify-between mb-1">
                <div className="font-bold text-sm text-slate-900">
                    {axis.label || axis.axis}
                    <span className={cn("text-[10px] font-bold uppercase ml-1", eyebrowTone)}>{prettyAxisType(axis)}</span>
                </div>
                <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold ring-1",
                    isRequired ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200",
                )}>
                    {isRequired ? "required" : "optional"}
                </span>
            </div>
            {description ? (
                <div className={cn("text-[11px]", isCatalog ? "text-violet-800" : "text-slate-600")}>{description}</div>
            ) : null}
            {axis.default_value ? (
                <div className="mt-1 text-[10px] font-mono font-bold text-emerald-700">default · {axis.default_value}</div>
            ) : null}
            {axis.qty_per_pcs ? (
                <div className="mt-1 text-[10px] font-mono text-slate-600">qty · {axis.qty_per_pcs} per pc</div>
            ) : null}
            {/* Allowed-values chip row */}
            {visible.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                    {visible.map((opt) => (
                        <span key={opt.code} className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ring-1", chipTone)} title={opt.label}>
                            {opt.code}
                        </span>
                    ))}
                    {more > 0 ? (
                        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ring-1", chipTone)}>+{more}</span>
                    ) : null}
                </div>
            ) : isCatalog || isSize || axis.axis === "addons" ? (
                <div className="mt-2 text-[10px] italic text-slate-400">No allowed values configured yet.</div>
            ) : null}
            {isCatalog && allowed.length > 0 ? (
                <div className="mt-2 text-[10px] font-bold text-violet-700">{allowed.length} allowed · auto-demand on shortage</div>
            ) : null}
        </div>
    )
}

function axisDescription(axis: VariantAxisDef): string {
    const name = String(axis.axis)
    if (name === "size") return "Drives W×H + gusset. Values come from the Sizes sub-section."
    if (name === "layer_thicknesses") return "Per-layer thickness. Fixed for fixed layers, picked per variant for variable layers."
    if (name === "layer_grades") return "Per-layer grade. Picked from the layer's grade options."
    if (name === "layer_widths") return "Per-layer roll width override. Defaults to auto-calculated width."
    if (name === "addons") return "Multi-select addons applied per piece (e.g. zipper, valve, spout)."
    if (name === "artwork_mode") return "How artwork is chosen — auto, customer overlay, or deferred."
    const source = axisCatalogSource(axis)
    if (source) return `Values pulled live from the ${source} catalog.`
    return ""
}

function prettyAxisType(axis: VariantAxisDef): string {
    const source = axisCatalogSource(axis)
    if (source) return `catalog ref · ${source}`
    if (axis.type === "geometry") return "geometry"
    if (axis.type === "per_layer_number") return "per-layer numbers"
    if (axis.type === "per_layer_enum") return "per-layer enum"
    if (axis.type === "multi_enum") return "multi-enum"
    return axis.type
}

function normalizeCode(value: unknown) {
    return String(value || "").trim().toUpperCase()
}

function axisValuePresent(value: any): boolean {
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === "object") return Object.values(value).some((nested) => nested !== "" && nested !== null && nested !== undefined)
    return value !== "" && value !== null && value !== undefined
}

function axisCatalogSource(axis?: VariantAxisDef): "pod_sku_variant" | "packaging_material" | "addon" | "" {
    if (!axis) return ""
    if (axis.master_data_source) return axis.master_data_source as any
    const axisName = normalizeCode(axis.axis)
    const axisType = normalizeCode((axis as any).type)
    if (axisType === "PACKAGING_REF" || ["PACKAGING", "PACKAGING_REF", "PACKAGING_INNER", "PACKAGING_OUTER", "PACKAGING_OTHER", "PACKAGING_EXTRA"].includes(axisName)) {
        return "packaging_material"
    }
    if (axisType === "POD_REF" || ["POD", "POD_REF", "POD_VARIANT", "POD_SKU_VARIANT"].includes(axisName)) {
        return "pod_sku_variant"
    }
    return ""
}

function packagingKind(material?: PackagingMaterial | Record<string, any> | null) {
    const raw = normalizeCode((material as any)?.packaging_kind || (material as any)?.kind)
    if (raw === "GUNNY") return "GONNY"
    if (raw === "CARTON") return "BOX"
    return raw
}

function packagingAxisRole(axis: VariantAxisDef, master: ProductMaster): "inner" | "outer" | "other" | "generic" {
    const product = normalizeCode(master.product_kind)
    const axisName = normalizeCode(axis.axis)
    const label = normalizeCode(axis.label)
    const type = normalizeCode((axis as any).type)
    const combined = `${axisName} ${label} ${type}`
    if (combined.includes("INNER")) return "inner"
    if (combined.includes("OUTER") || combined.includes("GUNNY") || combined.includes("GONNY") || combined.includes("SHEET") || combined.includes("ROLL_DISPATCH")) return "outer"
    if (combined.includes("OTHER") || combined.includes("EXTRA") || combined.includes("EOD") || combined.includes("TAPE") || combined.includes("LABEL") || combined.includes("TAG")) return "other"
    if (axisName === "PACKAGING" && product === "POUCH") return "inner"
    return "generic"
}

function packagingMaterialAllowedForAxis(material: PackagingMaterial, axis: VariantAxisDef, master: ProductMaster) {
    const product = normalizeCode(master.product_kind)
    const kind = packagingKind(material)
    const role = packagingAxisRole(axis, master)
    if (role === "inner") return product === "POUCH" && kind === "INNER_POUCH"
    if (role === "outer") {
        if (product === "ROLL" || product === "POD") return kind === "SHEET"
        if (product === "POUCH") return ["GONNY", "SHEET"].includes(kind)
    }
    if (role === "other") return !["INNER_POUCH", "GONNY", "SHEET"].includes(kind)
    if (product === "ROLL" || product === "POD") return kind === "SHEET"
    if (product === "POUCH") return ["INNER_POUCH", "GONNY", "SHEET"].includes(kind)
    return true
}

function overlayPackagingLabel(axis: VariantAxisDef, master: ProductMaster) {
    const role = packagingAxisRole(axis, master)
    if (role === "inner") return "Default inner pouch"
    if (role === "outer") return normalizeCode(master.product_kind) === "ROLL" ? "Default roll sheet" : "Default outer / sheet"
    if (role === "other") return "Default EOD / other packing"
    if (normalizeCode(master.product_kind) === "ROLL") return "Default roll sheet"
    return "Default packing"
}

function buildOverlayPackingRecipe(
    axisValues: Record<string, string>,
    packagingMaterials: PackagingMaterial[],
    master: ProductMaster,
    packagingAxes: VariantAxisDef[],
) {
    const recipe: Record<string, any> = {}
    const packagingLines: any[] = []
    packagingAxes.forEach((axis) => {
        const code = axisValues[String(axis.axis)]
        if (!code) return
        const material = packagingMaterials.find((row) => normalizeCode(row.code) === normalizeCode(code))
        const role = overlayPackagingRole(axis, material, master)
        const line = overlayPackagingLine(material, code, role)
        packagingLines.push(line)

        if (role === "PRIMARY_INNER") {
            recipe.primary_inner_pack = {
                enabled: true,
                material_id: material?.id,
                material_code: material?.code || code,
                material_name: material?.name || code,
                pcs_per_pack: line.pcs_per_pack || undefined,
                basis: line.basis,
            }
        } else if (role === "ROLL_DISPATCH") {
            const current = recipe.roll_dispatch_pack?.lines || []
            recipe.roll_dispatch_pack = { enabled: true, lines: [...current, line] }
        } else if (role === "FINAL_GUNNY") {
            recipe.final_outer_pack = {
                enabled: true,
                material_id: material?.id,
                material_code: material?.code || code,
                material_name: material?.name || code,
                packaging_kind: material?.packaging_kind,
                basis: line.basis,
                inners_per_outer: line.inners_per_outer || undefined,
                counted_at_packing: true,
            }
        }
    })
    if (packagingLines.length) recipe.packaging_lines = packagingLines
    return recipe
}

function overlayPackagingRole(axis: VariantAxisDef, material: PackagingMaterial | undefined, master: ProductMaster) {
    const axisRole = packagingAxisRole(axis, master)
    const kind = packagingKind(material)
    const product = normalizeCode(master.product_kind)
    if (axisRole === "inner" || kind === "INNER_POUCH") return "PRIMARY_INNER"
    if (product === "ROLL" && kind === "SHEET") return "ROLL_DISPATCH"
    if (axisRole === "outer" || ["GONNY", "SHEET", "OUTER_BAG", "BOX"].includes(kind)) return kind === "SHEET" && product === "ROLL" ? "ROLL_DISPATCH" : "FINAL_GUNNY"
    return "EXTRA"
}

function overlayPackagingLine(material: PackagingMaterial | undefined, code: string, role: string) {
    const defaults = material?.packaging_defaults_json || {}
    const kind = packagingKind(material)
    const pcsPerPack = Number(defaults.pcs_per_pack || defaults.pcs_per_carton || 0)
    const kgPerPack = Number(defaults.kg_per_pack || defaults.kg_per_bag || 0)
    const basis = String(defaults.basis || (pcsPerPack > 0 ? "PCS_PER_PACK" : kgPerPack > 0 ? "KG_PER_PACK" : kind === "SHEET" ? "PER_ROLL" : "PER_ORDER")).toUpperCase()
    return {
        material_id: material?.id,
        material_code: material?.code || code,
        material_name: material?.name || code,
        role,
        basis,
        qty: Number(defaults.qty || defaults.target_qty || (basis === "PER_ROLL" ? 1 : 0)),
        uom: material?.base_uom || "PCS",
        pcs_per_pack: pcsPerPack || undefined,
        kg_per_pack: kgPerPack || undefined,
        inners_per_outer: Number(defaults.inners_per_outer || defaults.inners_per_gunny || 0) || undefined,
        packaging_kind: material?.packaging_kind,
        supply_mode: material?.packaging_supply_mode,
    }
}

// ─── Overview · Recent variants peek ──────────────────────────────

function RoutePreviewCard({ master, routeInfo, templateName }: { master: ProductMaster; routeInfo: any; templateName: string }) {
    const steps: Array<{ index: number; name: string; process_code?: string; transition?: string; has_artwork?: boolean }> = routeInfo?.route_steps || []
    const STEP_TONE: Record<string, { bg: string; ring: string; text: string; dot: string }> = {
        EXTRUSION: { bg: "bg-blue-50", ring: "ring-blue-300", text: "text-blue-800", dot: "bg-blue-500" },
        PRINTING: { bg: "bg-rose-50", ring: "ring-rose-300", text: "text-rose-800", dot: "bg-rose-500" },
        ROTO: { bg: "bg-rose-50", ring: "ring-rose-300", text: "text-rose-800", dot: "bg-rose-500" },
        LAMINATION: { bg: "bg-amber-50", ring: "ring-amber-300", text: "text-amber-800", dot: "bg-amber-500" },
        SLITTING: { bg: "bg-cyan-50", ring: "ring-cyan-300", text: "text-cyan-800", dot: "bg-cyan-500" },
        POUCHING: { bg: "bg-emerald-50", ring: "ring-emerald-300", text: "text-emerald-800", dot: "bg-emerald-500" },
        PACKING: { bg: "bg-violet-50", ring: "ring-violet-300", text: "text-violet-800", dot: "bg-violet-500" },
        DEFAULT: { bg: "bg-slate-50", ring: "ring-slate-200", text: "text-slate-700", dot: "bg-slate-400" },
    }
    const toneFor = (name?: string, code?: string) => {
        const key = (code || name || "").toUpperCase()
        return STEP_TONE[key] || Object.entries(STEP_TONE).find(([k]) => key.includes(k))?.[1] || STEP_TONE.DEFAULT
    }
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-sm">⇆</span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Live route · {templateName || master.template_name || "live template"}</h3>
                        <div className="text-[10px] text-slate-500">Process names come from the live template · highlights the artwork-bearing step</div>
                    </div>
                </div>
                <span className="text-[10px] font-bold text-slate-500">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
            </header>
            <div className="p-5">
                {steps.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-xs text-slate-500">
                        No route steps published yet — link a LIVE template to surface the production route.
                    </div>
                ) : (
                    <div className="flex flex-wrap items-stretch gap-2">
                        <div className="flex h-14 min-w-[64px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-3 text-[10px] font-black uppercase tracking-wider text-slate-500">
                            <span>🚩</span>
                            <span className="mt-0.5">Start</span>
                        </div>
                        {steps.map((s, i) => {
                            const tone = toneFor(s.name, s.process_code)
                            return (
                                <React.Fragment key={`route-${s.index}-${i}`}>
                                    <span className="flex items-center text-slate-300 font-bold text-[14px]">›</span>
                                    <div className={cn("flex h-14 min-w-[120px] flex-col items-start justify-center rounded-xl px-3 ring-1", tone.bg, tone.ring)}>
                                        <div className="flex items-center gap-1.5">
                                            <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white", tone.dot)}>{s.index ?? i + 1}</span>
                                            <span className={cn("text-[12px] font-bold capitalize", tone.text)}>{(s.name || s.process_code || `step ${i + 1}`).toLowerCase()}</span>
                                            {s.has_artwork ? <span className="ml-0.5 inline-flex h-4 items-center rounded-full bg-fuchsia-600 px-1 text-[9px] font-black text-white">art</span> : null}
                                        </div>
                                        <div className="mt-0.5 text-[10px] font-mono text-slate-600">{s.transition || "—"}</div>
                                    </div>
                                </React.Fragment>
                            )
                        })}
                        <span className="flex items-center text-slate-300 font-bold text-[14px]">›</span>
                        <div className="flex h-14 min-w-[64px] flex-col items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50/40 px-3 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                            <span>🏁</span>
                            <span className="mt-0.5">End</span>
                        </div>
                    </div>
                )}
            </div>
        </section>
    )
}

function RecentVariantsCard({ variants, master }: { variants: ProductVariant[]; master: ProductMaster }) {
    const recent = variants.slice(0, 6)
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">🌀</span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Recent variants · {Math.min(recent.length, variants.length)} of {variants.length} shown</h3>
                        <div className="text-[10px] text-slate-500">Open Variants tab for matrix / cards / table views</div>
                    </div>
                </div>
            </header>
            {recent.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 italic">No variants yet — they appear as sales/planner configures axis tuples.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 p-5">
                    {recent.map((v) => (
                        <VariantPeekCard key={v.id} variant={v} master={master} />
                    ))}
                </div>
            )}
        </section>
    )
}

function VariantPeekCard({ variant, master }: { variant: ProductVariant; master: ProductMaster }) {
    const axisEntries = Object.entries(variant.axis_values || {})
        .filter(([, vv]) => vv !== null && vv !== undefined && vv !== "")
        .slice(0, 3)
    const unitG = Number((variant as any).geometry_snapshot?.unit_weight_g || (variant as any).unit_weight_g || 0)
    const layers = (variant as any).layer_snapshot
    const matCount = Array.isArray(layers) ? layers.length : (master.layer_template?.length || 0)
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 hover:border-indigo-300 hover:shadow-md">
            <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold text-indigo-700 truncate">{variant.code}</span>
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1", variant.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                    {variant.active ? "active" : "inactive"}
                </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
                {axisEntries.map(([k, vv]) => {
                    const val = typeof vv === "object" ? (vv as any).code || (vv as any).value || JSON.stringify(vv) : String(vv)
                    return <span key={k} className="rounded bg-blue-50 text-blue-800 ring-1 ring-blue-200 px-1.5 py-0.5 text-[10px] font-mono">{val}</span>
                })}
            </div>
            <div className="mt-2 font-mono text-[10px] text-slate-700">
                {unitG > 0 ? <><span className="font-bold">{unitG}g</span> per pouch</> : "—"}
                <span className="ml-2 text-slate-500">· {matCount} layer{matCount === 1 ? "" : "s"}</span>
            </div>
        </div>
    )
}

// ─── Side rail · Recent activity ──────────────────────────────────

function RecentActivityCard({ master, routeInfo }: { master: ProductMaster; routeInfo: any }) {
    const items: Array<{ icon: React.ReactNode; bg: string; title: string; sub: string }> = []
    items.push({ icon: "+", bg: "bg-emerald-100 text-emerald-700", title: `${master.name} created`, sub: master.created_at ? formatRelative(master.created_at) : "—" })
    if (master.updated_at && master.updated_at !== master.created_at) {
        items.push({ icon: "✎", bg: "bg-amber-100 text-amber-700", title: "Master updated", sub: formatRelative(master.updated_at) })
    }
    if (routeInfo?.route_steps?.length) {
        items.push({ icon: "↻", bg: "bg-slate-100 text-slate-700", title: `Route · ${routeInfo.route_steps.length} steps`, sub: master.template_name || "live template" })
    }
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Recent activity</div>
                <h3 className="font-display text-sm font-bold text-slate-900">Latest changes</h3>
            </header>
            <ol className="p-4 space-y-3 text-[11px]">
                {items.map((it, i) => (
                    <li key={i} className="flex gap-2">
                        <span className={cn("flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold", it.bg)}>{it.icon}</span>
                        <div>
                            <div className="font-bold text-slate-800">{it.title}</div>
                            <div className="text-[10px] text-slate-500">{it.sub}</div>
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    )
}

function formatRelative(iso: string): string {
    try {
        const d = new Date(iso)
        const diffMs = Date.now() - d.getTime()
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
        if (days <= 0) return `today · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
        if (days === 1) return "yesterday"
        if (days < 7) return `${days} days ago`
        return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    } catch {
        return "—"
    }
}

// ─── Side rail · Quick links ──────────────────────────────────────

function QuickLinksCard({ master }: { master: ProductMaster }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Quick links</div>
            </header>
            <div className="p-4 space-y-2 text-[11px]">
                <Link href={`/sales/orders/create?master=${master.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                    Open in Sales create <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href={`/production/planner/stock-launcher?master=${master.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                    Launch planner stock <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link href="/engineering/routing" className="flex items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                    Open Routing studio <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <button className="flex w-full items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                    <span className="flex items-center gap-2"><Printer className="h-3.5 w-3.5" /> Print spec sheet</span>
                </button>
            </div>
        </section>
    )
}

// ─── Side rail · Ownership ────────────────────────────────────────

function OwnershipCard({ master, variants }: { master: ProductMaster; variants: ProductVariant[] }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Ownership</div>
            </header>
            <div className="p-4 space-y-2 text-[11px]">
                <Row label="Reusable" value={master.reusable_policy} />
                <Row label="Reporting group" value={master.default_reporting_group} />
                <Row label="Created" value={master.created_at ? new Date(master.created_at).toLocaleDateString() : "—"} />
                <Row label="Last edit" value={master.updated_at ? new Date(master.updated_at).toLocaleDateString() : "—"} />
                <Row label="Active variants" value={`${variants.filter((v) => v.active).length} / ${variants.length}`} />
                <Row label="Invariant" value={master.invariant_signature ? <span className="font-mono text-[10px] text-slate-700 truncate">{master.invariant_signature.slice(0, 12)}…</span> : "—"} />
            </div>
        </section>
    )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-slate-500">{label}</span>
            <span className="font-bold text-slate-800 truncate text-right">{value}</span>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// LAYER TAB
// ──────────────────────────────────────────────────────────────────

function LayerTab({ master }: { master: ProductMaster }) {
    return (
        <div className="space-y-4">
            <LayerTemplateCard master={master} />
            <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4 text-[11px] text-blue-900">
                <div className="font-bold mb-1">How thickness &amp; grade work</div>
                Layer identity (film) is fixed. Thickness is fixed unless declared variable. Grade options apply only to extruded layers; purchased films skip grade input. Per-layer values for variable layers are picked while creating an order.
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// VARIANTS TAB
// ──────────────────────────────────────────────────────────────────

function VariantsTab({ master, variants, sizes: _sizes, routeInfo, templateName }: { master: ProductMaster; variants: ProductVariant[]; sizes: ProductMasterSize[]; routeInfo?: any; templateName?: string }) {
    const activeCount = variants.filter((v) => v.active).length
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">🌀</span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Variants · {variants.length}</h3>
                        <div className="text-[10px] text-slate-500">{activeCount} active · auto-deduped axis tuples · pivot any 2 axes · click a cell for live BOM</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> live preview
                    </span>
                    <Link href={`/master/products/${master.id}/variants/new`} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-bold text-white shadow-sm hover:bg-violet-700">
                        <Plus className="h-3.5 w-3.5" /> Create variant
                    </Link>
                </div>
            </header>
            <div className="p-5">
                <VariantsMatrixV37 productMasterId={master.id} rows={variants} axes={master.variant_axes || []} master={master} routeSteps={routeInfo?.route_steps || []} templateName={templateName || master.template_name || undefined} />
            </div>
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// SIZES TAB
// ──────────────────────────────────────────────────────────────────

function SizesTab({ sizes, master }: { sizes: ProductMasterSize[]; master: ProductMaster }) {
    const isRoll = master.product_kind === "ROLL" || master.product_kind === "POD"
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">📐</span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Sizes · {sizes.length}</h3>
                        <div className="text-[10px] text-slate-500">{isRoll ? "Roll geometry · roll width + faces + trim + form" : "Pouch geometry · W × H + gusset + faces + style"}</div>
                    </div>
                </div>
            </header>
            {sizes.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 italic">No sizes defined yet.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                        <thead className="bg-slate-50/60 border-b border-slate-200 text-slate-500">
                            <tr>
                                <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Code</th>
                                <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-[9px]">Label</th>
                                <th className="px-4 py-2 text-right font-bold uppercase tracking-wider text-[9px]">W (mm)</th>
                                <th className="px-4 py-2 text-right font-bold uppercase tracking-wider text-[9px]">H (mm)</th>
                                <th className="px-4 py-2 text-right font-bold uppercase tracking-wider text-[9px]">Gusset</th>
                                <th className="px-4 py-2 text-right font-bold uppercase tracking-wider text-[9px]">Roll W</th>
                                <th className="px-4 py-2 text-left font-bold uppercase tracking-wider text-[9px]">{isRoll ? "Form" : "Style"}</th>
                                <th className="px-4 py-2 text-right font-bold uppercase tracking-wider text-[9px]">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sizes.map((s: any) => (
                                <tr key={s.id || s.code} className="hover:bg-slate-50/40">
                                    <td className="px-4 py-2 font-mono font-bold text-slate-900">{s.code}</td>
                                    <td className="px-4 py-2 text-slate-700">{s.label}</td>
                                    <td className="px-4 py-2 text-right font-mono">{s.width_mm}</td>
                                    <td className="px-4 py-2 text-right font-mono">{s.height_mm || (isRoll ? "—" : 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-slate-700">{s.gusset_mm || "—"}</td>
                                    <td className="px-4 py-2 text-right font-mono text-slate-700">{s.roll_width_mm || "auto"}</td>
                                    <td className="px-4 py-2 text-[10px]">
                                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">{isRoll ? (s.roll_form || "—") : (s.pouch_style || "—")}</span>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1", s.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                                            {s.active ? "active" : "inactive"}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// OVERLAYS TAB
// ──────────────────────────────────────────────────────────────────

function OverlaysTab({ master, variants, overlays, routeInfo, templateName, onAdd }: { master: ProductMaster; variants: ProductVariant[]; overlays: CustomerProductOverlay[]; routeInfo?: any; templateName?: string; onAdd: () => void }) {
    const [selected, setSelected] = React.useState<CustomerProductOverlay | null>(null)

    // Resolve a variant to drive the live preview: match overlay's size_variant_code, else first active variant
    const overlayVariant = React.useMemo<ProductVariant | null>(() => {
        if (!selected) return null
        if (selected.size_variant_code) {
            const v = variants.find((x) => axisValueMatch(x, "size", selected.size_variant_code!))
            if (v) return v
        }
        return variants.find((v) => v.active) || variants[0] || null
    }, [selected, variants])

    return (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                    <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Users className="h-4 w-4" /></span>
                        <div>
                            <h3 className="font-display text-sm font-bold text-slate-900">Customer overlays · {overlays.length}</h3>
                            <div className="text-[10px] text-slate-500">Customer-facing defaults · still uses master&apos;s engineering BOM · click a card for live preview</div>
                        </div>
                    </div>
                    <button onClick={onAdd} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[11px] font-bold text-white shadow-sm hover:bg-blue-700">
                        <Plus className="h-3.5 w-3.5" /> Add overlay
                    </button>
                </header>
                {overlays.length === 0 ? (
                    <div className="p-8 text-center">
                        <Users className="mx-auto h-8 w-8 text-slate-300" />
                        <div className="mt-2 text-sm font-semibold text-slate-700">No customer overlays yet</div>
                        <div className="mt-1 text-xs text-slate-500 max-w-md mx-auto">Add a customer overlay to pre-fill artwork, packing or size defaults when sales picks this customer.</div>
                        <button onClick={onAdd} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
                            <Plus className="h-3.5 w-3.5" /> Add overlay
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-5">
                        {overlays.map((o) => {
                            const isSelected = selected?.id === o.id
                            return (
                                <button
                                    key={o.id}
                                    onClick={() => setSelected(o)}
                                    className={cn(
                                        "text-left rounded-2xl border p-3",
                                        isSelected ? "border-blue-400 bg-blue-50/40 ring-2 ring-blue-200" : o.active ? "border-slate-200 bg-white hover:border-blue-300" : "border-rose-200 bg-rose-50/40",
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-sm text-slate-900 truncate">{o.customer_name || "Unnamed customer"}</div>
                                            {o.customer_item_code ? <div className="font-mono text-[10px] text-slate-500">{o.customer_item_code}</div> : null}
                                        </div>
                                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1", o.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                                            {o.active ? "active" : "inactive"}
                                        </span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                                        {o.default_price_basis ? <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-700">basis · {o.default_price_basis}</span> : null}
                                        {o.moq_kg ? <span className="rounded bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-1.5 py-0.5 font-bold">MOQ · {o.moq_kg} kg</span> : null}
                                        {o.default_artwork_design_code ? <span className="rounded bg-fuchsia-50 text-fuchsia-700 ring-1 ring-fuchsia-200 px-1.5 py-0.5 font-bold">art · {o.default_artwork_design_code}</span> : null}
                                        {o.size_variant_code ? <span className="rounded bg-blue-50 text-blue-700 ring-1 ring-blue-200 px-1.5 py-0.5 font-bold">size · {o.size_variant_code}</span> : null}
                                    </div>
                                    {o.notes ? <div className="mt-2 text-[10px] text-slate-500 truncate">{o.notes}</div> : null}
                                </button>
                            )
                        })}
                    </div>
                )}
            </section>
            <div>
                <VariantLiveRail
                    productMasterId={master.id}
                    variant={overlayVariant}
                    axes={master.variant_axes || []}
                    customerId={selected?.customer || undefined}
                    master={master}
                    scope="order"
                    routeSteps={routeInfo?.route_steps || []}
                    templateName={templateName || master.template_name || undefined}
                />
            </div>
        </div>
    )
}

function axisValueMatch(v: ProductVariant, axis: string, want: string): boolean {
    const got = v?.axis_values?.[axis]
    if (got === null || got === undefined) return false
    const code = typeof got === "object" ? ((got as any).code || (got as any).value || "") : String(got)
    return String(code) === String(want)
}

// ──────────────────────────────────────────────────────────────────
// ARTWORKS TAB
// ──────────────────────────────────────────────────────────────────

function ArtworksTab({ artworks, master }: { artworks: Artwork[]; master: ProductMaster }) {
    if (!master.fixed_attributes?.print_capable) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
                This master is not print-capable. Enable printing on the master to surface approved artworks.
            </div>
        )
    }
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-600"><Palette className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Approved artworks · {artworks.length}</h3>
                        <div className="text-[10px] text-slate-500">Live colorways assignable to this master&apos;s print orders</div>
                    </div>
                </div>
            </header>
            {artworks.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-400 italic">No approved artworks yet.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-5">
                    {artworks.map((a) => (
                        <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-3 hover:shadow-md">
                            <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-bold text-fuchsia-700 truncate">{(a as any).design_code || a.id}</span>
                                <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-1.5 py-0.5 text-[9px] font-bold">approved</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-700 truncate">{a.name || "—"}</div>
                            <div className="mt-1 text-[10px] text-slate-500 truncate">{(a as any).print_type || "—"} · {(a as any).substrate_mode || "—"}</div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// AUDIT TAB (placeholder · existing audit centre lives at /system/audit)
// ──────────────────────────────────────────────────────────────────

function AuditPlaceholder({ masterId }: { masterId: string }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <ShieldCheck className="mx-auto h-8 w-8 text-slate-300" />
            <div className="mt-3 font-display text-sm font-bold text-slate-900">Audit trail</div>
            <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">All master/variant/overlay changes for this product master are logged in the system audit centre with before/after diffs and user.</p>
            <Link href={`/system/audit?ref=product-master&id=${masterId}`} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white">
                Open audit centre <ArrowRight className="h-3.5 w-3.5" />
            </Link>
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// PACKAGING CONTRACT CARD (Overview)
// ──────────────────────────────────────────────────────────────────

function PackagingContractCard({ master, packagingMaterials, podVariants }: { master: ProductMaster; packagingMaterials: PackagingMaterial[]; podVariants: PodSkuVariant[] }) {
    const fixed: any = master.fixed_attributes || {}
    const packagingLines: any[] = Array.isArray(fixed.packaging_lines) ? fixed.packaging_lines : []
    // POD is only locked when BOTH pod_enabled is true (or absent — default-on for legacy)
    // AND a code is set. If the admin toggled "POD required" off in section 6, pod_enabled
    // is false → no lock.
    const podEnabled = fixed.pod_enabled !== false && (fixed.pod_variant_code || fixed.pod_variant)
    const podCode = podEnabled ? (fixed.pod_variant_code || fixed.pod_variant) : null
    const podMeta = podVariants.find((v: any) => v.code === podCode || v.id === podCode)
    const printCapable = Boolean(fixed.print_capable)
    const PACKAGING_ROLE_META: Record<string, { label: string; basis: string; tone: string }> = {
        PRIMARY_INNER: { label: "Inner pouch", basis: "auto · ceil(total / pcs_per_inner)", tone: "bg-amber-50 ring-amber-200 text-amber-900" },
        FINAL_GUNNY: { label: "Gunny / outer", basis: "Packing Yard seal count", tone: "bg-violet-50 ring-violet-200 text-violet-900" },
        ROLL_DISPATCH: { label: "Sheet / roll wrap", basis: "EOD packing count", tone: "bg-blue-50 ring-blue-200 text-blue-900" },
        EXTRA: { label: "Other EOD items", basis: "EOD packing count", tone: "bg-slate-50 ring-slate-200 text-slate-900" },
    }
    // Pull axis-driven allowed codes too — masters using variant_axes.options for
    // packaging/POD instead of fixed_attributes.packaging_lines show their codes
    // here so the user has one consolidated view of "what flows into BOM".
    const variantAxes = master.variant_axes || []
    const packagingAxes = variantAxes.filter((a) => {
        const k = String(a.axis).toUpperCase()
        return a.master_data_source === "packaging_material" || ["PACKAGING", "PACKAGING_INNER", "PACKAGING_OUTER"].includes(k)
    })
    const podAxes = variantAxes.filter((a) => {
        const k = String(a.axis).toUpperCase()
        return a.master_data_source === "pod_sku_variant" || ["POD", "POD_VARIANT", "POD_SKU_VARIANT"].includes(k)
    })
    const axisAllowedCodes = (a: VariantAxisDef): string[] => {
        const opts = (a as any).options as any[] | undefined
        if (!Array.isArray(opts)) return []
        return opts.map((o) => typeof o === "string" || typeof o === "number" ? String(o) : String(o?.code || o?.value || o?.id || "")).filter(Boolean)
    }
    const PACKAGING_AXIS_META: Record<string, { label: string; tone: string }> = {
        PACKAGING_INNER: { label: "Inner pouch · axis-pickable", tone: "bg-amber-50 ring-amber-200 text-amber-900" },
        PACKAGING: { label: "Inner pouch · axis-pickable", tone: "bg-amber-50 ring-amber-200 text-amber-900" },
        PACKAGING_OUTER: { label: "Outer / gunny · axis-pickable", tone: "bg-violet-50 ring-violet-200 text-violet-900" },
    }
    const podAllowed = podAxes.flatMap(axisAllowedCodes)
    const hasAnyContent = packagingLines.length > 0 || podCode || packagingAxes.some((a) => axisAllowedCodes(a).length > 0) || podAllowed.length > 0
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><Package className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Packaging &amp; POD contract</h3>
                        <div className="text-[10px] text-slate-500">Locked SKUs + axis-pickable catalog codes · consumption rules · no manual per-order qty here</div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    {printCapable ? <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700 ring-1 ring-fuchsia-200">print capable</span> : null}
                    {podCode ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">POD locked</span> : null}
                </div>
            </header>
            <div className="p-5 space-y-3">
                {!hasAnyContent ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-xs text-slate-500">
                        No packaging SKUs, POD lock, or axis-allowed options yet. Add inner-pouch / gunny / sheet / tape options on the edit page or set up packaging/POD axes.
                    </div>
                ) : null}

                {packagingLines.length > 0 || podCode ? (
                    <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Locked at master · consumed every order</div>
                        {packagingLines.map((line: any, i: number) => {
                            const role = String(line.role || "EXTRA").toUpperCase()
                            const meta = PACKAGING_ROLE_META[role] || PACKAGING_ROLE_META.EXTRA
                            const code = String(line.material_code || line.code || line.material || "")
                            const material = packagingMaterials.find((m: any) => m.code === code || m.id === code)
                            return (
                                <div key={i} className={cn("rounded-xl ring-1 px-3 py-2.5 flex items-center justify-between gap-3", meta.tone)}>
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-wider opacity-80">{meta.label}</div>
                                        <div className="font-mono font-bold text-slate-900 mt-0.5 text-sm">{code || "—"}</div>
                                        {material?.name && material.name !== code ? <div className="text-[10px] opacity-70 truncate">{material.name}</div> : null}
                                    </div>
                                    <div className="text-right text-[10px]">
                                        <div className="font-bold opacity-80">{meta.basis}</div>
                                        {line.pcs_per_pack ? <div className="font-mono opacity-70 mt-0.5">{line.pcs_per_pack} pcs / pack</div> : null}
                                        {line.uom ? <div className="font-mono opacity-70">UOM · {line.uom}</div> : null}
                                    </div>
                                </div>
                            )
                        })}
                        {podCode ? (
                            <div className="rounded-xl ring-1 ring-fuchsia-200 bg-fuchsia-50/40 px-3 py-2.5 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-700">POD lock</div>
                                    <div className="font-mono font-bold text-slate-900 mt-0.5 text-sm">{podCode}</div>
                                    {podMeta?.name && podMeta.name !== podCode ? <div className="text-[10px] text-fuchsia-700/80 truncate">{podMeta.name}</div> : null}
                                </div>
                                <div className="text-right text-[10px]">
                                    <div className="font-bold text-fuchsia-700/80">1 per pouch · same on every order</div>
                                    {podMeta?.pod_is_inhouse_produced ? <div className="mt-0.5"><span className="rounded-full bg-fuchsia-100 px-1.5 py-0.5 text-[9px] font-bold text-fuchsia-700 ring-1 ring-fuchsia-200">in-house</span></div> : null}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {packagingAxes.some((a) => axisAllowedCodes(a).length > 0) ? (
                    <div className="space-y-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Axis-pickable · sales picks one per order</div>
                        {packagingAxes.map((axis) => {
                            const codes = axisAllowedCodes(axis)
                            if (codes.length === 0) return null
                            const axisKey = String(axis.axis).toUpperCase()
                            const meta = PACKAGING_AXIS_META[axisKey] || { label: `${axis.label || axis.axis} · axis-pickable`, tone: "bg-slate-50 ring-slate-200 text-slate-800" }
                            return (
                                <div key={String(axis.axis)} className={cn("rounded-xl ring-1 px-3 py-2.5", meta.tone)}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="text-[10px] font-black uppercase tracking-wider opacity-80">{meta.label}</div>
                                        <span className="text-[10px] font-bold opacity-70">
                                            {axis.required ? "required" : "optional"}
                                            {axis.auto_demand_in_house ? " · auto-demand" : ""}
                                            {" · "}{codes.length} allowed
                                        </span>
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {codes.map((code) => {
                                            const material = packagingMaterials.find((m: any) => m.code === code || m.id === code)
                                            return (
                                                <span key={code} className="inline-flex items-center gap-1 rounded-md bg-white/80 px-1.5 py-0.5 text-[10px] font-mono font-bold ring-1 ring-white">
                                                    {code}
                                                    {material?.name && material.name !== code ? <span className="text-[9px] font-medium opacity-70">· {material.name}</span> : null}
                                                </span>
                                            )
                                        })}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : null}

                {!podCode && podAllowed.length > 0 ? (
                    <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-700">POD · axis-pickable · sales picks per order</div>
                            <span className="text-[10px] font-bold text-fuchsia-700/80">{podAllowed.length} allowed</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                            {podAllowed.map((code) => {
                                const meta = podVariants.find((v: any) => v.code === code || v.id === code)
                                return (
                                    <span key={code} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold text-fuchsia-800 ring-1 ring-fuchsia-200">
                                        {code}
                                        {meta?.name && meta.name !== code ? <span className="text-[9px] font-medium text-fuchsia-700/80">· {meta.name}</span> : null}
                                    </span>
                                )
                            })}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    )
}

function AddonsContractCard({ master, addons }: { master: ProductMaster; addons: Addon[] }) {
    const addonAxes = (master.variant_axes || []).filter((a) => {
        const k = String(a.axis).toUpperCase()
        return a.master_data_source === "addon" || ["ADDON", "ADDONS"].includes(k)
    })
    if (addonAxes.length === 0) return null
    const axisAllowedCodes = (a: VariantAxisDef): string[] => {
        const opts = (a as any).options as any[] | undefined
        if (!Array.isArray(opts)) return []
        return opts.map((o) => typeof o === "string" || typeof o === "number" ? String(o) : String(o?.code || o?.value || o?.id || "")).filter(Boolean)
    }
    const hasAny = addonAxes.some((a) => axisAllowedCodes(a).length > 0 || a.required)
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Sparkles className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Add-ons contract</h3>
                        <div className="text-[10px] text-slate-500">Optional per-piece add-ons (zipper, valve, spout, etc.) sales can attach to a line</div>
                    </div>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                    {addonAxes.some((a) => a.required) ? "required axis" : "optional axis"}
                </span>
            </header>
            <div className="p-5 space-y-2">
                {!hasAny ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-xs text-slate-500">
                        Addons axis declared but no allowed codes yet. Add allowed catalog codes on the edit page.
                    </div>
                ) : null}
                {addonAxes.map((axis) => {
                    const codes = axisAllowedCodes(axis)
                    return (
                        <div key={String(axis.axis)} className="rounded-xl bg-amber-50/50 ring-1 ring-amber-200 px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-amber-900">
                                    {axis.label || axis.axis}
                                </div>
                                <span className="text-[10px] font-bold text-amber-800/80">
                                    {axis.required ? "required · sales must pick" : "optional · sales may skip"}
                                    {axis.auto_demand_in_house ? " · auto-demand" : ""}
                                    {codes.length > 0 ? ` · ${codes.length} allowed` : ""}
                                </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {codes.length > 0 ? codes.map((code) => {
                                    const meta = addons.find((a: any) => a.code === code || a.id === code)
                                    return (
                                        <span key={code} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-900 ring-1 ring-amber-200">
                                            {code}
                                            {meta?.name && meta.name !== code ? <span className="text-[9px] font-medium text-amber-800/80">· {meta.name}</span> : null}
                                        </span>
                                    )
                                }) : (
                                    <span className="text-[10px] italic text-amber-800/70">No allowed codes locked — all active catalog add-ons are pickable.</span>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// CREATE OVERLAY DIALOG
// ──────────────────────────────────────────────────────────────────

function CreateOverlayDialog({ open, onOpenChange, master, sizes, customers, artworks, packagingMaterials, podVariants, addons }: {
    open: boolean
    onOpenChange: (open: boolean) => void
    master: ProductMaster
    sizes: ProductMasterSize[]
    customers: Customer[]
    artworks: Artwork[]
    packagingMaterials: PackagingMaterial[]
    podVariants: PodSkuVariant[]
    addons: Addon[]
}) {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [customer, setCustomer] = React.useState("")
    const [customerItemCode, setCustomerItemCode] = React.useState("")
    const [customerDisplayName, setCustomerDisplayName] = React.useState("")
    const [priceBasis, setPriceBasis] = React.useState<"KG" | "PCS">("KG")
    const [moqKg, setMoqKg] = React.useState("")
    const [defaultArtwork, setDefaultArtwork] = React.useState("")
    const [defaultPod, setDefaultPod] = React.useState("")
    const [packingDefaults, setPackingDefaults] = React.useState<Record<string, string>>({})
    const [defaultSizeCode, setDefaultSizeCode] = React.useState("")
    const [defaultAddons, setDefaultAddons] = React.useState<string[]>([])
    const [notes, setNotes] = React.useState("")

    const reset = React.useCallback(() => {
        setCustomer("")
        setCustomerItemCode("")
        setCustomerDisplayName("")
        setPriceBasis("KG")
        setMoqKg("")
        setDefaultArtwork("")
        setDefaultPod("")
        setPackingDefaults({})
        setDefaultSizeCode("")
        setDefaultAddons([])
        setNotes("")
        setOverrideValues({})
    }, [])

    // Which catalog rows are even allowed by this master?
    const catalogAxes = (master.variant_axes || []).filter((a) => axisCatalogSource(a))
    const packagingAxes = catalogAxes.filter((a) => axisCatalogSource(a) === "packaging_material")
    const podAxis = catalogAxes.find((a) => axisCatalogSource(a) === "pod_sku_variant" && ["POD_VARIANT", "POD", "POD_REF", "POD_SKU_VARIANT"].includes(normalizeCode(a.axis)))
    const addonsAxis = (master.variant_axes || []).find((a) => {
        const k = String(a.axis).toUpperCase()
        return axisCatalogSource(a) === "addon" || k === "ADDONS" || k === "ADDON"
    })
    const podAllowed = podAxis ? resolveAxisValues(podAxis, master, sizes, packagingMaterials, podVariants, [] as any) : []
    const addonsAllowed = addonsAxis ? resolveAxisValues(addonsAxis, master, sizes, packagingMaterials, podVariants, addons) : []
    const patchPackingDefault = React.useCallback((key: string, value: string) => {
        setPackingDefaults((prev) => {
            const next = { ...prev }
            if (value) next[key] = value
            else delete next[key]
            return next
        })
    }, [])
    const toggleAddon = React.useCallback((code: string) => {
        setDefaultAddons((prev) => prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code])
    }, [])

    // Any axes left that aren't already covered by the size lock / POD / inner / outer / addons / artwork rows?
    const handledAxisKeys = new Set([
        "size",
        "pod_variant", "pod",
        "addons", "addon",
        "artwork_mode",
    ])
    packagingAxes.forEach((axis) => handledAxisKeys.add(String(axis.axis)))
    const otherAxes = (master.variant_axes || []).filter((a) => !handledAxisKeys.has(String(a.axis)))
    // For per-layer numeric/enum axes, we show an info chip (they vary per-layer, defaults stay at master)
    const perLayerAxes = otherAxes.filter((a) => a.type === "per_layer_number" || a.type === "per_layer_enum")
    const overrideAxes = otherAxes.filter((a) => a.type !== "per_layer_number" && a.type !== "per_layer_enum")
    const [overrideValues, setOverrideValues] = React.useState<Record<string, string>>({})
    const patchOverride = React.useCallback((key: string, value: string) => {
        setOverrideValues((prev) => ({ ...prev, [key]: value }))
    }, [])

    const createMutation = useMutation({
        mutationFn: () => {
            const packingAxisValues = Object.fromEntries(Object.entries(packingDefaults).filter(([, v]) => v && v.length))
            const defaultPackingRecipe = buildOverlayPackingRecipe(packingAxisValues, packagingMaterials, master, packagingAxes)
            return productMasterService.createOverlay(master.id, {
                customer,
                customer_item_code: customerItemCode || undefined,
                customer_display_name: customerDisplayName || undefined,
                default_price_basis: priceBasis,
                moq_kg: moqKg ? Number(moqKg) : null,
                default_artwork: defaultArtwork || null,
                default_packing_recipe: Object.keys(defaultPackingRecipe).length ? defaultPackingRecipe : undefined,
                notes: notes || undefined,
                active: true,
                axis_values: {
                    ...(defaultSizeCode ? { size: defaultSizeCode } : {}),
                    ...(defaultPod ? { pod_variant: defaultPod, pod: defaultPod } : {}),
                    ...packingAxisValues,
                    ...(defaultAddons.length ? { addons: defaultAddons } : {}),
                    ...Object.fromEntries(Object.entries(overrideValues).filter(([, v]) => v && v.length)),
                },
            } as any)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["product-master-overlays", master.id] })
            queryClient.invalidateQueries({ queryKey: ["product-master", master.id] })
            toast({ title: "Overlay added", description: "Customer defaults are ready for sales order entry." })
            reset()
            onOpenChange(false)
        },
        onError: (err: any) => {
            toast({ title: "Could not add overlay", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    // Live preview of what this overlay's defaults would produce on a sample order
    // (uses MOQ qty if set, else 1000 KG as a representative size). Drives the rail
    // so the admin sees the exact BOM math that will fire when sales picks this
    // overlay on a real order.
    const sampleQty = Number(moqKg) > 0 ? Number(moqKg) : 1000
    const draftAxisValues = React.useMemo(() => ({
        ...(defaultSizeCode ? { size: defaultSizeCode } : {}),
        ...(defaultPod ? { pod_variant: defaultPod, pod: defaultPod } : {}),
        ...Object.fromEntries(Object.entries(packingDefaults).filter(([, v]) => v && v.length)),
        ...(defaultAddons.length ? { addons: defaultAddons } : {}),
        ...Object.fromEntries(Object.entries(overrideValues).filter(([, v]) => v && v.length)),
    }), [defaultSizeCode, defaultPod, packingDefaults, defaultAddons, overrideValues])
    const previewAxisValues = React.useMemo(() => {
        const values: Record<string, any> = { ...draftAxisValues }
        const firstSize = sizes.find((s) => s.active !== false) || sizes[0]
        if (!values.size && firstSize?.code) values.size = firstSize.code
        for (const axis of master.variant_axes || []) {
            const key = String(axis.axis || "")
            const normalized = normalizeCode(key)
            if (!key || normalized === "SIZE" || values[key] !== undefined) continue
            if (normalized === "LAYER_THICKNESSES") {
                values[key] = Object.fromEntries((master.layer_template || []).map((row: any, idx: number) => [String(idx + 1), row.thickness_micron || 0]))
                continue
            }
            if (normalized === "LAYER_GRADES") {
                const allowed = new Set((Array.isArray((axis as any).options) ? (axis as any).options : []).map((option: unknown) => String(option || "").trim()).filter(Boolean))
                const gradeEntries = (master.layer_template || [])
                    .map((row: any, idx: number) => [String(idx + 1), String(row.default_grade || "").trim()] as const)
                    .filter(([, grade]) => grade && (!allowed.size || allowed.has(grade)))
                if (gradeEntries.length) values[key] = Object.fromEntries(gradeEntries)
                continue
            }
            if (normalized === "LAYER_WIDTHS") {
                values[key] = Object.fromEntries((master.layer_template || []).map((row: any, idx: number) => [String(idx + 1), row.default_input_roll_width_mm || firstSize?.roll_width_mm || firstSize?.width_mm || 0]))
                continue
            }
            if (normalized === "ADDONS" || normalized === "ADDON") {
                values[key] = defaultAddons
                continue
            }
            const allowed = resolveAxisValues(axis, master, sizes, packagingMaterials, podVariants, addons)
            const suggested = String((axis as any).default_value || allowed[0]?.code || "")
            if (suggested) values[key] = suggested
        }
        return values
    }, [draftAxisValues, sizes, master, packagingMaterials, podVariants, addons, defaultAddons])
    const previewAxesReady = React.useMemo(() => {
        return (master.variant_axes || []).every((axis) => !axis.required || axisValuePresent(previewAxisValues[String(axis.axis || "")]))
    }, [master.variant_axes, previewAxisValues])

    const { data: livePreview, isLoading: previewLoading } = useQuery({
        queryKey: ["overlay-preview-bom", master.id, customer || "_no_cust_", previewAxisValues, sampleQty, priceBasis],
        queryFn: () => productMasterService.previewBom({
            product_master: master.id,
            customer_id: customer || undefined,
            template_id: master.template || master.default_template || null,
            axis_values: previewAxisValues,
            quantity: sampleQty,
            quantity_uom: priceBasis === "PCS" ? "PCS" : "KG",
            price_basis: priceBasis,
            printing: master.fixed_attributes?.print_capable
                ? { enabled: true, artwork_id: defaultArtwork || undefined, defer_artwork_to_planner: !defaultArtwork }
                : { enabled: false },
        }),
        enabled: open && !!master.id && !!previewAxisValues.size && previewAxesReady,
        staleTime: 0,
        retry: false,
    })

    const customerMeta = customers.find((c) => c.id === customer)
    const customerInitials = customerMeta?.name?.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase() || "—"
    const masterFlags = {
        print_capable: !!master.fixed_attributes?.print_capable,
        pod_locked: !!(master.fixed_attributes?.pod_enabled && (master.fixed_attributes?.pod_variant_code || master.fixed_attributes?.pod_variant)),
        addons_axis: ((master.variant_axes || []).find((a) => String(a.axis) === "addons" || String(a.axis) === "addon")?.required ? "required" : (master.variant_axes || []).some((a) => String(a.axis) === "addons" || String(a.axis) === "addon") ? "optional" : "off") as "off" | "optional" | "required",
    }

    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o) }}>
            <DialogContent className="max-w-6xl max-h-[92vh] rounded-2xl p-0 overflow-hidden flex flex-col">
                {/* Gradient header */}
                <div className="flex-none border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-emerald-50/40 px-6 py-4">
                    <DialogHeader>
                        <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-emerald-500 text-white shadow-sm"><Users className="h-4 w-4" /></span>
                            <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Customer overlay</div>
                                <DialogTitle className="font-display text-lg font-bold text-slate-900">
                                    {customerMeta ? `Defaults for ${customerMeta.name}` : "Add customer overlay"}
                                </DialogTitle>
                                <DialogDescription className="text-[11px] text-slate-600 mt-0.5">
                                    Customer-specific item code, price basis, axis defaults &amp; packing. The live BOM rail on the right shows the exact math sales gets when this customer orders this master.
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                </div>

                {/* 2-col body — flex-1 so footer always shows. Inner columns scroll. */}
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px] flex-1 min-h-0 overflow-hidden">
                    {/* ─── LEFT: form ─── */}
                    <div className="overflow-y-auto px-6 py-5 space-y-5">
                        {/* 1. Customer identity */}
                        <OverlaySection eyebrow="1 · Customer" title="Who is this overlay for?">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Customer <span className="text-rose-600">*</span></Label>
                                    <Select value={customer} onValueChange={setCustomer}>
                                        <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Pick a customer" /></SelectTrigger>
                                        <SelectContent>
                                            {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.code ? ` · ${c.code}` : ""}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Customer item code</Label>
                                    <Input value={customerItemCode} onChange={(e) => setCustomerItemCode(e.target.value.toUpperCase())} placeholder="e.g. ACME-SNK-250" className="mt-1 h-10 rounded-xl font-mono" />
                                </div>
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Display name (customer-facing)</Label>
                                    <Input value={customerDisplayName} onChange={(e) => setCustomerDisplayName(e.target.value)} placeholder="Customer-facing label" className="mt-1 h-10 rounded-xl" />
                                </div>
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Price basis</Label>
                                    <Select value={priceBasis} onValueChange={(v) => setPriceBasis(v as "KG" | "PCS")}>
                                        <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="KG">Per kg</SelectItem>
                                            <SelectItem value="PCS">Per pcs</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Minimum order (kg)</Label>
                                    <Input type="number" value={moqKg} onChange={(e) => setMoqKg(e.target.value)} placeholder="Optional · drives sample size in preview" className="mt-1 h-10 rounded-xl font-mono" />
                                </div>
                                {customerMeta ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 flex items-center gap-2">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700 font-bold text-xs">{customerInitials}</span>
                                        <div className="min-w-0">
                                            <div className="text-[11px] font-bold text-slate-900 truncate">{customerMeta.name}</div>
                                            <div className="font-mono text-[10px] text-slate-500 truncate">{customerMeta.code || "—"}{customerMeta.gst_no ? ` · GST ${customerMeta.gst_no}` : ""}</div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </OverlaySection>

                        {/* 2. Engineering defaults */}
                        <OverlaySection eyebrow="2 · Engineering defaults" title="What does this customer pick by default?">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Default size lock</Label>
                                    <Select value={defaultSizeCode || "__none"} onValueChange={(v) => setDefaultSizeCode(v === "__none" ? "" : v)}>
                                        <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="No size lock" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">— No size lock —</SelectItem>
                                            {sizes.filter((s) => s.active !== false).map((s) => (
                                                <SelectItem key={s.code} value={s.code}>{s.code} · {s.width_mm}×{s.height_mm || 0}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {podAllowed.length > 0 ? (
                                    <div>
                                        <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Default POD</Label>
                                        <Select value={defaultPod || "__none"} onValueChange={(v) => setDefaultPod(v === "__none" ? "" : v)}>
                                            <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="__none">— Sales picks on order —</SelectItem>
                                                {podAllowed.map((opt) => <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : null}
                            </div>
                            {packagingAxes.length > 0 ? (
                                <div className="mt-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700 mb-1.5">Packaging defaults</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {packagingAxes.map((axis) => {
                                            const allowed = resolveAxisValues(axis, master, sizes, packagingMaterials, podVariants, [] as any)
                                            const key = String(axis.axis)
                                            const value = packingDefaults[key] || ""
                                            return (
                                                <div key={key}>
                                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{overlayPackagingLabel(axis, master)}</Label>
                                                    <Select value={value || "__none"} onValueChange={(v) => patchPackingDefault(key, v === "__none" ? "" : v)}>
                                                        <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__none">— Sales picks on order —</SelectItem>
                                                            {allowed.map((opt) => <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <div className="mt-1 text-[10px] text-slate-500">{allowed.length} allowed from this master</div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : null}
                            {addonsAxis ? (
                                <div className="mt-3">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Default add-ons</div>
                                        <span className="text-[10px] text-slate-500">
                                            {addonsAllowed.length} allowed · {addonsAxis.required ? "required" : "optional"} · sales picks any number per order
                                        </span>
                                    </div>
                                    {addonsAllowed.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {addonsAllowed.map((opt) => {
                                                const active = defaultAddons.includes(opt.code)
                                                return (
                                                    <button
                                                        key={opt.code}
                                                        type="button"
                                                        onClick={() => toggleAddon(opt.code)}
                                                        className={cn(
                                                            "rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 ring-inset",
                                                            active ? "bg-amber-500 text-white ring-amber-600 shadow-sm" : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:ring-amber-200",
                                                        )}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-[11px] text-slate-500">
                                            No allowed add-ons curated for this master yet. Add allowed codes in PM Edit Section 7.
                                        </div>
                                    )}
                                </div>
                            ) : null}
                            {overrideAxes.length > 0 ? (
                                <div className="mt-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-700 mb-1.5">Other axis defaults</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {overrideAxes.map((ax) => {
                                            const allowed = resolveAxisValues(ax, master, sizes, packagingMaterials, podVariants, addons)
                                            const key = String(ax.axis)
                                            const value = overrideValues[key] || ""
                                            return (
                                                <div key={key}>
                                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{ax.label || key}</Label>
                                                    {allowed.length > 0 ? (
                                                        <Select value={value || "__none"} onValueChange={(v) => patchOverride(key, v === "__none" ? "" : v)}>
                                                            <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="__none">— Sales picks on order —</SelectItem>
                                                                {allowed.map((opt) => <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <Input value={value} onChange={(e) => patchOverride(key, e.target.value)} placeholder="Optional" className="mt-1 h-10 rounded-xl" />
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : null}
                            {perLayerAxes.length > 0 ? (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[10px]">
                                    <span className="font-black uppercase tracking-[0.18em] text-slate-600">Per-layer axes</span>
                                    <span className="ml-2 text-slate-600">{perLayerAxes.map((a) => a.label || a.axis).join(", ")} — picked per layer on each order. Master defaults apply unless customer overrides on the line.</span>
                                </div>
                            ) : null}
                        </OverlaySection>

                        {/* 3. Artwork */}
                        <OverlaySection eyebrow="3 · Artwork" title="Customer-facing approved artwork">
                            {master.fixed_attributes?.print_capable ? (
                                <div>
                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Default approved artwork</Label>
                                    <Select value={defaultArtwork || "__none"} onValueChange={(v) => setDefaultArtwork(v === "__none" ? "" : v)}>
                                        <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="No default · sales must pick on each order" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">— No default —</SelectItem>
                                            {artworks.map((a: any) => (
                                                <SelectItem key={a.id} value={a.id}>{a.design_code || a.id}{a.name ? ` · ${a.name}` : ""}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <div className="mt-1 text-[10px] text-slate-500">{artworks.length} approved artworks available for this master</div>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2 text-[11px] text-slate-500">
                                    This master is not print-capable. Artwork doesn&apos;t apply.
                                </div>
                            )}
                        </OverlaySection>

                        {/* 4. Internal notes */}
                        <OverlaySection eyebrow="4 · Internal" title="Staff-only notes" optional>
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional · visible only to staff" className="rounded-xl min-h-[60px]" />
                        </OverlaySection>
                    </div>

                    {/* ─── RIGHT: live BOM rail ─── */}
                    <div className="border-t xl:border-t-0 xl:border-l border-slate-200 bg-slate-50/40 px-4 py-4 overflow-y-auto">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700 mb-2 px-1">
                            Preview · sample {sampleQty.toLocaleString("en-IN")} {priceBasis} order
                        </div>
                        <LiveBomRail
                            title="What sales gets when this customer orders"
                            subtitle={`${master.code} · ${defaultSizeCode || "first size"}${customerMeta ? ` · for ${customerMeta.name}` : ""}`}
                            preview={livePreview || null}
                            loading={previewLoading}
                            scope="order"
                            masterFlags={masterFlags}
                        />
                    </div>
                </div>

                {/* Footer — always visible, never scrolled past */}
                <div className="flex-none border-t border-slate-200 bg-white px-6 py-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] text-slate-500">
                        {customer ? (
                            <span className="inline-flex items-center gap-1.5">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Live BOM updates as you change defaults
                            </span>
                        ) : (
                            <span className="text-amber-700 font-bold">Pick a customer to enable save</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant="outline" onClick={() => { reset(); onOpenChange(false) }} className="rounded-xl">Cancel</Button>
                        <Button
                            disabled={!customer || createMutation.isPending}
                            onClick={() => createMutation.mutate()}
                            className="rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 text-white shadow-md hover:shadow-lg"
                        >
                            {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                            Save overlay
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

function OverlaySection({ eyebrow, title, optional, children }: { eyebrow: string; title: string; optional?: boolean; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="border-b border-slate-100 bg-gradient-to-r from-slate-50/60 via-white to-white px-4 py-2.5 flex items-center justify-between">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">{eyebrow}</div>
                    <div className="text-sm font-bold text-slate-900">{title}</div>
                </div>
                {optional ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">optional</span> : null}
            </header>
            <div className="px-4 py-3">{children}</div>
        </section>
    )
}
