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
import { Badge } from "@/components/ui/badge"
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
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { VariantsMatrixV37, VariantLiveRail } from "./variants-matrix"
import { LiveBomRail } from "@/components/erp/live-bom-rail"
import { ProductMasterCloneDialog } from "./product-master-clone-dialog"

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
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const searchParams = useSearchParams()
    const initialTab = ((): TabKey => {
        const t = searchParams?.get("tab") || ""
        return (TABS.find((x) => x.id === t)?.id) || "overview"
    })()
    const [tab, setTab] = React.useState<TabKey>(initialTab)
    const [overlayOpen, setOverlayOpen] = React.useState(false)
    const [cloneOpen, setCloneOpen] = React.useState(false)

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
        queryFn: () => templateService.getLiveTemplateOptions(),
        staleTime: 5 * 60_000,
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        meta: { suppressGlobalError: true },
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
    const toggleActiveMutation = useMutation({
        mutationFn: () => {
            if (!master) throw new Error("Product master is not loaded.")
            return master.active ? productMasterService.disable(master.id) : productMasterService.restore(master.id)
        },
        onSuccess: async (updated) => {
            await queryClient.invalidateQueries({ queryKey: ["product-master", productId] })
            await queryClient.invalidateQueries({ queryKey: ["product-masters"] })
            toast({
                title: updated.active ? "Product master restored" : "Product master disabled",
                description: updated.active ? "It is back in the active catalog." : "It remains reachable from Disabled / audit for historical orders.",
            })
        },
        onError: (err: any) => {
            toast({ title: "Action failed", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    // PACKAGING + POD = production masters → hide Customer overlays tab.
    // Computed up front (hooks must run before any early return).
    const _earlyMasterKind = String(master?.product_kind || "").toUpperCase()
    const _earlyIsProductionMaster = _earlyMasterKind === "PACKAGING" || _earlyMasterKind === "POD"
    const _earlyHiddenTabs: Set<TabKey> = _earlyIsProductionMaster ? new Set<TabKey>(["overlays"]) : new Set<TabKey>()
    React.useEffect(() => {
        if (_earlyHiddenTabs.has(tab)) setTab("overview")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [_earlyIsProductionMaster, tab])

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

    // Use the early-computed hidden tab set (declared before early-returns
    // so the useEffect hook order is stable).
    const hiddenTabs = _earlyHiddenTabs

    return (
        <div className="space-y-4 pb-12">
            <TopBar
                master={master}
                onEdit={() => router.push(`/master/products/${productId}/edit`)}
                onClone={() => setCloneOpen(true)}
                onToggleActive={() => toggleActiveMutation.mutate()}
                isToggling={toggleActiveMutation.isPending}
            />
            <Tabs tab={tab} setTab={setTab} counts={counts} hiddenTabs={hiddenTabs} />

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
            <ProductMasterCloneDialog open={cloneOpen} onOpenChange={setCloneOpen} source={master} />
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// Top bar
// ──────────────────────────────────────────────────────────────────

function TopBar({ master, onEdit, onClone, onToggleActive, isToggling }: { master: ProductMaster; onEdit: () => void; onClone: () => void; onToggleActive: () => void; isToggling: boolean }) {
    return (
        <header className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-r from-white via-indigo-50/40 to-violet-50/40 px-5 py-3 shadow-sm ring-1 ring-white/40 backdrop-blur">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-indigo-500 via-violet-500 to-fuchsia-500" />
            <div className="relative flex items-center gap-3 min-w-0 pl-2">
                <Link href="/master/products" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/70 text-indigo-600 ring-1 ring-indigo-100 hover:bg-white hover:text-indigo-700 hover:ring-indigo-200 transition" title="Back to list">
                    <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <div className="text-[10px] font-black tracking-[0.22em] text-indigo-600 uppercase">Master data › Product master</div>
                    <div className="font-display text-base font-black text-slate-900 truncate tracking-tight">{master.name}</div>
                </div>
            </div>
            <div className="relative flex items-center gap-2 flex-wrap">
                <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black tracking-wide ring-1 shadow-sm",
                    master.active
                        ? "bg-gradient-to-r from-emerald-50 to-emerald-100/60 text-emerald-800 ring-emerald-200"
                        : "bg-gradient-to-r from-rose-50 to-rose-100/60 text-rose-800 ring-rose-200",
                )}>
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full", master.active ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
                    {master.active ? "ACTIVE" : "INACTIVE"}
                </span>
                <button onClick={onClone} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-white hover:ring-indigo-300 hover:text-indigo-700 transition">
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                </button>
                <button
                    onClick={onToggleActive}
                    disabled={isToggling}
                    className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/80 px-3 text-[11px] font-bold ring-1 transition disabled:opacity-60",
                        master.active
                            ? "text-amber-700 ring-amber-200 hover:bg-white hover:ring-amber-300"
                            : "text-emerald-700 ring-emerald-200 hover:bg-white hover:ring-emerald-300"
                    )}
                >
                    {isToggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
                    {master.active ? "Disable" : "Restore"}
                </button>
                <button onClick={onEdit} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-3.5 text-[11px] font-black text-white shadow-md hover:shadow-lg hover:from-indigo-700 hover:via-violet-700 hover:to-fuchsia-700 transition">
                    <Edit3 className="h-3.5 w-3.5" /> Edit
                </button>
            </div>
        </header>
    )
}

// ──────────────────────────────────────────────────────────────────
// Tab strip
// ──────────────────────────────────────────────────────────────────

const TAB_TONES: Record<TabKey, { active: string; hover: string; chip: string }> = {
    overview: {
        active: "bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-md ring-1 ring-violet-300/50",
        hover: "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700",
        chip: "bg-white/25 text-white",
    },
    layer: {
        active: "bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md ring-1 ring-blue-300/50",
        hover: "text-slate-600 hover:bg-blue-50 hover:text-blue-700",
        chip: "bg-white/25 text-white",
    },
    variants: {
        active: "bg-gradient-to-r from-violet-600 to-purple-600 text-white shadow-md ring-1 ring-violet-300/50",
        hover: "text-slate-600 hover:bg-violet-50 hover:text-violet-700",
        chip: "bg-white/25 text-white",
    },
    sizes: {
        active: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md ring-1 ring-emerald-300/50",
        hover: "text-slate-600 hover:bg-emerald-50 hover:text-emerald-700",
        chip: "bg-white/25 text-white",
    },
    overlays: {
        active: "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md ring-1 ring-amber-300/50",
        hover: "text-slate-600 hover:bg-amber-50 hover:text-amber-700",
        chip: "bg-white/25 text-white",
    },
    artworks: {
        active: "bg-gradient-to-r from-fuchsia-600 to-pink-600 text-white shadow-md ring-1 ring-fuchsia-300/50",
        hover: "text-slate-600 hover:bg-fuchsia-50 hover:text-fuchsia-700",
        chip: "bg-white/25 text-white",
    },
    audit: {
        active: "bg-gradient-to-r from-slate-800 to-slate-900 text-white shadow-md ring-1 ring-slate-700/50",
        hover: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        chip: "bg-white/25 text-white",
    },
}

function Tabs({ tab, setTab, counts, hiddenTabs }: { tab: TabKey; setTab: (k: TabKey) => void; counts: { variants: number; sizes: number; overlays: number; artworks: number }; hiddenTabs?: Set<TabKey> }) {
    const visible = TABS.filter((t) => !hiddenTabs?.has(t.id))
    return (
        <div className="rounded-2xl border border-slate-200 bg-white/80 p-1.5 shadow-sm backdrop-blur overflow-x-auto ring-1 ring-white/40">
            <div className="inline-flex gap-1 min-w-max">
                {visible.map((t) => {
                    const active = t.id === tab
                    const count = t.id === "variants" ? counts.variants : t.id === "sizes" ? counts.sizes : t.id === "overlays" ? counts.overlays : t.id === "artworks" ? counts.artworks : undefined
                    const tone = TAB_TONES[t.id]
                    return (
                        <button key={t.id} onClick={() => setTab(t.id)} className={cn(
                            "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition",
                            active ? tone.active : tone.hover,
                        )}>
                            {t.label}
                            {typeof count === "number" ? (
                                <span className={cn("ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black tabular-nums ring-1 ring-inset", active ? `${tone.chip} ring-white/30` : "bg-slate-100 text-slate-600 ring-slate-200")}>
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
    const kind = String(master.product_kind || "").toUpperCase()
    const isProductionMaster = kind === "PACKAGING" || kind === "POD"
    return (
        <div className="space-y-4">
            {/* Rich gradient hero + 4-KPI strip side-by-side */}
            <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 via-white to-fuchsia-50/60 px-6 py-5 shadow-lg ring-1 ring-white/40">
                    {/* Decorative blurred blobs */}
                    <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-fuchsia-300/30 blur-3xl" />
                    <div aria-hidden className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-indigo-300/30 blur-3xl" />
                    <div aria-hidden className="pointer-events-none absolute top-10 right-1/3 h-32 w-32 rounded-full bg-violet-200/40 blur-2xl" />
                    {/* Left accent stripe */}
                    <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-b from-indigo-500 via-violet-500 to-fuchsia-500 shadow-[0_0_18px_2px_rgba(139,92,246,0.45)]" />
                    <div className="relative pl-3">
                        <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-100 to-violet-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-violet-800 ring-1 ring-violet-200 shadow-sm">
                                <Sparkles className="h-3 w-3" />
                                {master.product_kind}
                            </span>
                            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">· Product master</span>
                        </div>
                        <h1 className="font-display text-3xl sm:text-4xl font-black text-slate-900 mt-2 tracking-tight bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-800 bg-clip-text text-transparent">
                            {master.name}
                        </h1>
                        {master.description ? <p className="mt-2 text-sm text-slate-700 max-w-3xl leading-relaxed">{master.description}</p> : null}
                        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <FactCell label="Master code" tone="indigo" value={<span className="font-mono font-black text-indigo-900">{master.code}</span>} />
                            <FactCell label="Family" tone="violet" value={<span className="font-bold text-violet-900">{master.default_reporting_group} · {master.product_kind}</span>} />
                            <FactCell label="Reusable policy" tone="emerald" value={<span className="font-bold text-emerald-900 capitalize">{master.reusable_policy.toLowerCase()}</span>} />
                            <FactCell label="Template" tone="fuchsia" value={<span className="font-bold text-fuchsia-900 truncate">{templateName}</span>} />
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                    <KpiTile label="Variants" value={variants.length} sub={`${variants.filter((v) => v.active).length} active`} icon="🌀" tone="violet" />
                    <KpiTile label="Sizes" value={sizes.length} sub={sizes.length ? `${sizes[0].code} → ${sizes[sizes.length - 1].code}` : "—"} icon="📐" tone="emerald" />
                    <KpiTile label="Overlays" value={overlays.length} sub={`${overlays.filter((o) => o.active).length} active`} icon="👥" tone="amber" />
                    <KpiTile label="Artworks" value={artworks.length} sub={artworks.length ? `${artworks.length} approved` : "—"} icon="🎨" tone="fuchsia" />
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
                    {(() => {
                        // PACKAGING + POD = production masters → no sales-pickable section.
                        // Instead surface the Catalog map (variant ↔ /master/packaging|/master/pod row).
                        if (isProductionMaster) {
                            return <ProductionCatalogMapCard master={master} variants={variants} />
                        }
                        return <PackagingContractCard master={master} packagingMaterials={packagingMaterials} podVariants={podVariants} />
                    })()}
                    {!isProductionMaster ? <AddonsContractCard master={master} addons={addons} /> : null}
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

const FACT_TONES: Record<string, { bg: string; ring: string; label: string }> = {
    indigo: { bg: "bg-gradient-to-br from-white to-indigo-50/80", ring: "ring-indigo-200", label: "text-indigo-600" },
    violet: { bg: "bg-gradient-to-br from-white to-violet-50/80", ring: "ring-violet-200", label: "text-violet-600" },
    emerald: { bg: "bg-gradient-to-br from-white to-emerald-50/80", ring: "ring-emerald-200", label: "text-emerald-600" },
    fuchsia: { bg: "bg-gradient-to-br from-white to-fuchsia-50/80", ring: "ring-fuchsia-200", label: "text-fuchsia-600" },
    slate: { bg: "bg-white/90", ring: "ring-slate-200", label: "text-slate-500" },
}

function FactCell({ label, value, tone = "slate" }: { label: string; value: React.ReactNode; tone?: keyof typeof FACT_TONES }) {
    const t = FACT_TONES[tone] || FACT_TONES.slate
    return (
        <div className={cn("rounded-xl px-3 py-2 ring-1 shadow-sm backdrop-blur", t.bg, t.ring)}>
            <div className={cn("text-[9px] font-black uppercase tracking-[0.16em]", t.label)}>{label}</div>
            <div className="mt-0.5 truncate">{value}</div>
        </div>
    )
}

const KPI_TONES: Record<string, { wrap: string; iconBg: string; label: string; value: string; sub: string; stripe: string }> = {
    violet: {
        wrap: "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-purple-50/60",
        iconBg: "bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md",
        label: "text-violet-700",
        value: "text-violet-900",
        sub: "text-violet-700/70",
        stripe: "bg-gradient-to-r from-violet-500 to-purple-500",
    },
    emerald: {
        wrap: "border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50/60",
        iconBg: "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md",
        label: "text-emerald-700",
        value: "text-emerald-900",
        sub: "text-emerald-700/70",
        stripe: "bg-gradient-to-r from-emerald-500 to-teal-500",
    },
    amber: {
        wrap: "border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50/60",
        iconBg: "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md",
        label: "text-amber-700",
        value: "text-amber-900",
        sub: "text-amber-700/70",
        stripe: "bg-gradient-to-r from-amber-500 to-orange-500",
    },
    fuchsia: {
        wrap: "border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 via-white to-pink-50/60",
        iconBg: "bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-md",
        label: "text-fuchsia-700",
        value: "text-fuchsia-900",
        sub: "text-fuchsia-700/70",
        stripe: "bg-gradient-to-r from-fuchsia-500 to-pink-500",
    },
    indigo: {
        wrap: "border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-blue-50/60",
        iconBg: "bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-md",
        label: "text-indigo-700",
        value: "text-indigo-900",
        sub: "text-indigo-700/70",
        stripe: "bg-gradient-to-r from-indigo-500 to-blue-500",
    },
}

function KpiTile({ label, value, sub, icon, tone = "indigo" }: { label: string; value: number | string; sub?: string; icon?: string; tone?: keyof typeof KPI_TONES }) {
    const t = KPI_TONES[tone] || KPI_TONES.indigo
    return (
        <div className={cn("relative overflow-hidden rounded-2xl border p-3 shadow-sm ring-1 ring-white/40", t.wrap)}>
            <div className={cn("absolute inset-x-0 top-0 h-1", t.stripe)} />
            <div className="flex items-start justify-between">
                <div className={cn("text-[10px] font-black uppercase tracking-[0.16em]", t.label)}>{label}</div>
                {icon ? (
                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-xl text-sm", t.iconBg)}>{icon}</span>
                ) : null}
            </div>
            <div className={cn("mt-1.5 font-display text-3xl font-black tabular-nums tracking-tight", t.value)}>{value}</div>
            {sub ? <div className={cn("text-[10px] font-bold truncate", t.sub)}>{sub}</div> : null}
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
    const kind = String(master.product_kind || "").toUpperCase()
    const isProductionMaster = kind === "PACKAGING" || kind === "POD"
    // Filter out deprecated axes for the v37 model:
    //   - packaging_outer: outer packing (gunny/sheet/tape/etc) is no longer on
    //     the master — packing yard ticks per order at EOD.
    //   - packaging_inner: only meaningful for POUCH masters.
    //   - artwork_mode: derived from the Printing 2-knob contract.
    const axes = (master.variant_axes || []).filter((a) => {
        const key = canonicalAxisKey(String(a.axis || ""))
        if (isProductionMaster && PRODUCTION_MASTER_CATALOG_AXES.has(key)) return false
        if (key === "packaging_outer" || key === "packaging_inner" && kind !== "POUCH") return false
        if (key === "packaging_inner") return kind === "POUCH"
        if (key === "artwork_mode") return false
        return true
    })
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Workflow className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Variant axes · {axes.length} axes</h3>
                        <div className="text-[10px] text-slate-500">
                            {isProductionMaster ? "These axes define produced variants; catalog SKU is linked manually after variant creation" : "Each axis becomes one dropdown sales/planner sees while configuring"}
                        </div>
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

const AXIS_ALIAS: Record<string, string> = {
    pod: "pod_variant",
    pod_ref: "pod_variant",
    packaging: "packaging_inner",
    packaging_ref: "packaging_inner",
}

const PRODUCTION_MASTER_CATALOG_AXES = new Set(["packaging_inner", "packaging_outer", "pod_variant", "addons"])

function canonicalAxisKey(value: unknown) {
    const key = String(value || "").trim().toLowerCase()
    return AXIS_ALIAS[key] || key
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
    const kind = String(master.product_kind || "").toUpperCase()
    const isPackOrPod = kind === "PACKAGING" || kind === "POD"
    const totalStockQty = isPackOrPod
        ? variants.reduce((sum, v) => sum + Number(v.inventory_link?.stock_qty || 0), 0)
        : 0
    const linkedVariants = isPackOrPod ? variants.filter((v) => v.inventory_link).length : 0
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
                {isPackOrPod ? (
                    <div className="flex items-center gap-2 text-[10px]">
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-bold text-emerald-700 ring-1 ring-emerald-200">
                            {linkedVariants}/{variants.length} linked
                        </span>
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 font-bold text-violet-700 ring-1 ring-violet-200">
                            {totalStockQty.toLocaleString()} in stock
                        </span>
                    </div>
                ) : null}
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
    // For PACKAGING + POD masters the variant is manually linked to a fixed
    // catalog row. Surface the link + stock count so the admin sees "this
    // variant -> SKU X · Y units in stock" at a glance.
    const link = variant.inventory_link || null
    const kind = String(master.product_kind || "").toUpperCase()
    const isPackOrPod = kind === "PACKAGING" || kind === "POD"
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
            {/* ── Inventory linkage · PACKAGING + POD masters only ──── */}
            {isPackOrPod ? (
                <VariantInventoryLinkPanel variant={variant} master={master} link={link} />
            ) : null}
        </div>
    )
}

/**
 * VariantInventoryLinkPanel — surfaces the current catalog link + stock and
 * provides a manual "Change link" dialog so admin can repoint this variant
 * to a different existing catalog row (in /master/packaging or /master/pod).
 */
function VariantInventoryLinkPanel({ variant, master, link }: {
    variant: ProductVariant
    master: ProductMaster
    link: ProductVariant["inventory_link"] | null | undefined
}) {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const kind = String(master.product_kind || "").toUpperCase()
    const expectedCategory = kind === "PACKAGING" ? "PACKAGING" : "POD"
    const fixedFgType = String((master.fixed_attributes as any)?.fg_type || "").toUpperCase()
    const expectedPackagingKind = kind === "PACKAGING"
        ? (String(master.packaging_kind || "").toUpperCase() || (fixedFgType === "ROLL" ? "SHEET" : "INNER_POUCH"))
        : ""
    const [pickerOpen, setPickerOpen] = React.useState(false)
    const [picker, setPicker] = React.useState("")
    const scalarId = React.useCallback((value: any) => {
        if (value && typeof value === "object") return String(value.id || value.uuid || "")
        return value == null ? "" : String(value)
    }, [])

    // Pool of candidate catalog rows the admin can link to. Packaging links
    // direct InventoryMaterial rows; POD links through PodSkuVariant so this
    // picker shows the same fixed POD SKU catalog used by sales/planner.
    const { data: pool = [] } = useQuery({
        queryKey: ["catalog-pool", expectedCategory, expectedPackagingKind],
        queryFn: () =>
            expectedCategory === "PACKAGING"
                ? masterDataService.getPackaging()
                : masterDataService.getPodSkuVariants({ active: true }).then((rows: PodSkuVariant[]) =>
                    rows.map((row) => {
                        const materialId = scalarId((row as any).material)
                        return {
                            ...row,
                            id: materialId || row.id,
                            material_id: materialId,
                            pod_sku_variant_id: row.id,
                            code: row.code,
                            name: row.name || row.material_name || row.pod_sku_name || row.code,
                            base_uom: row.material_base_uom || "KG",
                            product_master_link: row.material_product_master_link || null,
                        } as any
                    }),
                ),
        enabled: pickerOpen,
        staleTime: 60_000,
    })

    const filtered = (pool as any[]).filter((m) => {
        if (String(m.status || m.material_status || "ACTIVE").toUpperCase() === "INACTIVE") return false
        const linked = m.product_master_link || m.material_product_master_link
        const linkedVariantId = String(linked?.variant_id || "")
        if (linkedVariantId && linkedVariantId !== variant.id) return false
        if (expectedCategory === "PACKAGING") {
            const rowKind = String(m.packaging_kind || "").toUpperCase()
            if (expectedPackagingKind && rowKind !== expectedPackagingKind) return false
        }
        if (!picker.trim()) return true
        const q = picker.trim().toLowerCase()
        return (
            String(m.code || "").toLowerCase().includes(q) ||
            String(m.name || "").toLowerCase().includes(q) ||
            String(m.material_code || "").toLowerCase().includes(q) ||
            String(m.pod_sku_code || "").toLowerCase().includes(q)
        )
    }).slice(0, 30)

    const linkMut = useMutation({
        mutationFn: (payload: { inventoryMaterialId: string | null; podSkuVariantId?: string | null }) =>
            productMasterService.linkVariantInventory(master.id, variant.id, payload.inventoryMaterialId, payload.podSkuVariantId),
        onSuccess: () => {
            toast({ title: "Catalog link updated", description: variant.code })
            queryClient.invalidateQueries({ queryKey: ["product-master-variants", master.id] })
            setPickerOpen(false)
        },
        onError: (err: any) => {
            toast({
                title: "Could not relink",
                description: err?.response?.data?.error || err?.message || "Try again",
                variant: "destructive",
            })
        },
    })

    return (
        <>
            {link ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-gradient-to-r from-emerald-50 via-white to-teal-50/40 px-2 py-1.5 ring-1 ring-emerald-100">
                    <div className="min-w-0">
                        <div className="text-[9px] font-black uppercase tracking-wider text-emerald-700">Catalog SKU</div>
                        <div className="font-mono text-[10px] font-bold text-emerald-900 truncate">{link.pod_sku_variant_code || link.code}</div>
                        {link.pod_sku_variant_code ? <div className="font-mono text-[9px] text-emerald-700 truncate">{link.code}</div> : null}
                    </div>
                    <div className="text-right">
                        <div className="text-[9px] font-black uppercase tracking-wider text-emerald-700">In stock</div>
                        <div className="font-mono text-[11px] font-black text-emerald-900 tabular-nums">
                            {Number(link.stock_qty || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                            <span className="ml-0.5 text-[9px] font-medium text-emerald-700">{link.base_uom || ""}</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="ml-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700 hover:bg-emerald-100"
                        title="Change which catalog SKU this variant maps to"
                    >
                        Change
                    </button>
                </div>
            ) : (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-amber-50/60 px-2 py-1.5 ring-1 ring-amber-100 text-[10px] text-amber-900">
                    <span><span className="font-bold">No catalog link.</span> Pick an existing fixed SKU.</span>
                    <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white hover:bg-amber-600"
                    >
                        Link SKU
                    </button>
                </div>
            )}

            <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="font-display text-base font-black">
                            Link variant <span className="font-mono text-violet-700">{variant.code}</span>
                        </DialogTitle>
                        <DialogDescription className="text-[11px]">
                            Pick an unlinked fixed SKU in <strong>{expectedCategory === "PACKAGING" ? "/master/packaging" : "/master/pod"}</strong>, or keep the current link. {expectedPackagingKind ? `This master only accepts ${expectedPackagingKind.replaceAll("_", " ")} rows. ` : ""}No SKU is created automatically.
                        </DialogDescription>
                    </DialogHeader>
                    <Input
                        value={picker}
                        onChange={(e) => setPicker(e.target.value)}
                        placeholder="Search code or name…"
                        className="h-9 rounded-xl"
                    />
                    <div className="max-h-[300px] overflow-y-auto space-y-1">
                        {filtered.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-3 text-center text-xs text-slate-500">
                                No unlinked matching catalog rows.
                            </div>
                        ) : filtered.map((m: any) => (
                            <button
                                key={m.pod_sku_variant_id || m.id}
                                type="button"
                                onClick={() => {
                                    const podSkuVariantId = m.pod_sku_variant_id ? String(m.pod_sku_variant_id) : null
                                    linkMut.mutate({
                                        inventoryMaterialId: podSkuVariantId ? null : String(m.id),
                                        podSkuVariantId,
                                    })
                                }}
                                disabled={linkMut.isPending}
                                className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50/40",
                                    link?.id === m.id ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200" : "border-slate-200 bg-white",
                                )}
                            >
                                <div className="min-w-0">
                                    <div className="font-mono text-xs font-black text-slate-900 truncate">{m.code}</div>
                                    {m.name && m.name !== m.code ? <div className="text-[10px] text-slate-500 truncate">{m.name}</div> : null}
                                </div>
                                <div className="text-right text-[10px] text-slate-500">
                                    {m.packaging_kind || m.pod_sku_code || m.pod_type || ""}<br />
                                    {m.material_code ? `${m.material_code} · ` : ""}{m.base_uom || ""}
                                </div>
                            </button>
                        ))}
                    </div>
                    <DialogFooter className="gap-2">
                        {link ? (
                            <Button
                                variant="outline"
                                onClick={() => linkMut.mutate({ inventoryMaterialId: null })}
                                disabled={linkMut.isPending}
                                className="rounded-xl text-rose-700 hover:bg-rose-50"
                            >
                                Unlink
                            </Button>
                        ) : null}
                        <Button variant="outline" onClick={() => setPickerOpen(false)} className="rounded-xl">
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
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
    // Production masters (PACKAGING / POD) don't surface "Open in Sales create"
    // because sales never sells these — the Stock Launcher launches them. We
    // also surface a direct link to the catalog page for the linked SKU pool.
    const kind = String(master.product_kind || "").toUpperCase()
    const isProductionMaster = kind === "PACKAGING" || kind === "POD"
    return (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <header className="border-b border-slate-100 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Quick links</div>
            </header>
            <div className="p-4 space-y-2 text-[11px]">
                {!isProductionMaster ? (
                    <Link href={`/sales/orders/create?master=${master.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                        Open in Sales create <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                ) : (
                    <Link
                        href={kind === "PACKAGING" ? "/master/packaging" : "/master/pod"}
                        className="flex items-center justify-between rounded-lg bg-gradient-to-r from-violet-50 to-fuchsia-50 hover:from-violet-100 hover:to-fuchsia-100 px-3 py-2 font-bold text-violet-700 ring-1 ring-violet-100"
                    >
                        Open catalog · {kind === "PACKAGING" ? "/master/packaging" : "/master/pod"} <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                )}
                <Link href={`/production/planner/stock-launcher?master=${master.id}`} className="flex items-center justify-between rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 font-bold text-slate-700">
                    {isProductionMaster ? "Launch in-house production" : "Launch planner stock"} <ArrowRight className="h-3.5 w-3.5" />
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
            <TabBanner
                tone="blue"
                eyebrow="Layer template"
                title="Engineering stack · identity, thickness & grade"
                subtitle={`${(master.layer_template || []).length} layers · identity locked at master · thickness/grade can be fixed or variable`}
                icon={<Layers className="h-5 w-5" />}
            />
            <LayerTemplateCard master={master} />
            <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-cyan-50/50 p-5 text-[12px] text-blue-900 shadow-sm">
                <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-cyan-200/40 blur-3xl" />
                <div className="relative flex items-start gap-3">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md"><BookOpen className="h-4 w-4" /></span>
                    <div>
                        <div className="font-display font-black text-sm text-blue-900 mb-1">How thickness &amp; grade work</div>
                        <p className="leading-relaxed text-blue-900/80">
                            Layer identity (film) is fixed. Thickness is fixed unless declared variable. Grade options apply only to extruded layers; purchased films skip grade input. Per-layer values for variable layers are picked while creating an order.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}

type BannerTone = "blue" | "violet" | "emerald" | "amber" | "fuchsia" | "slate"

function TabBanner({ tone, eyebrow, title, subtitle, icon, right }: {
    tone: BannerTone
    eyebrow: string
    title: string
    subtitle?: string
    icon: React.ReactNode
    right?: React.ReactNode
}) {
    const BANNER: Record<BannerTone, { wrap: string; stripe: string; iconBg: string; eyebrow: string; subtitle: string; blob: string }> = {
        blue: {
            wrap: "border-blue-100 bg-gradient-to-br from-blue-50/80 via-white to-cyan-50/60",
            stripe: "bg-gradient-to-b from-blue-500 to-cyan-500",
            iconBg: "bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-md",
            eyebrow: "text-blue-700",
            subtitle: "text-blue-900/70",
            blob: "bg-cyan-200/30",
        },
        violet: {
            wrap: "border-violet-100 bg-gradient-to-br from-violet-50/80 via-white to-purple-50/60",
            stripe: "bg-gradient-to-b from-violet-500 to-purple-500",
            iconBg: "bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md",
            eyebrow: "text-violet-700",
            subtitle: "text-violet-900/70",
            blob: "bg-violet-200/30",
        },
        emerald: {
            wrap: "border-emerald-100 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/60",
            stripe: "bg-gradient-to-b from-emerald-500 to-teal-500",
            iconBg: "bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md",
            eyebrow: "text-emerald-700",
            subtitle: "text-emerald-900/70",
            blob: "bg-emerald-200/30",
        },
        amber: {
            wrap: "border-amber-100 bg-gradient-to-br from-amber-50/80 via-white to-orange-50/60",
            stripe: "bg-gradient-to-b from-amber-500 to-orange-500",
            iconBg: "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md",
            eyebrow: "text-amber-700",
            subtitle: "text-amber-900/70",
            blob: "bg-amber-200/30",
        },
        fuchsia: {
            wrap: "border-fuchsia-100 bg-gradient-to-br from-fuchsia-50/80 via-white to-pink-50/60",
            stripe: "bg-gradient-to-b from-fuchsia-500 to-pink-500",
            iconBg: "bg-gradient-to-br from-fuchsia-500 to-pink-500 text-white shadow-md",
            eyebrow: "text-fuchsia-700",
            subtitle: "text-fuchsia-900/70",
            blob: "bg-fuchsia-200/30",
        },
        slate: {
            wrap: "border-slate-200 bg-gradient-to-br from-slate-50/80 via-white to-slate-50/60",
            stripe: "bg-gradient-to-b from-slate-600 to-slate-800",
            iconBg: "bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-md",
            eyebrow: "text-slate-700",
            subtitle: "text-slate-700/70",
            blob: "bg-slate-300/30",
        },
    }
    const t = BANNER[tone]
    return (
        <section className={cn("relative overflow-hidden rounded-2xl border px-5 py-4 shadow-sm ring-1 ring-white/40", t.wrap)}>
            <div aria-hidden className={cn("pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full blur-3xl", t.blob)} />
            <div className={cn("absolute inset-y-0 left-0 w-1.5", t.stripe)} />
            <div className="relative flex items-start justify-between gap-3 pl-2">
                <div className="flex items-start gap-3 min-w-0">
                    <span className={cn("flex h-10 w-10 flex-none items-center justify-center rounded-xl", t.iconBg)}>{icon}</span>
                    <div className="min-w-0">
                        <div className={cn("text-[10px] font-black uppercase tracking-[0.22em]", t.eyebrow)}>{eyebrow}</div>
                        <div className="font-display text-lg font-black text-slate-900 tracking-tight">{title}</div>
                        {subtitle ? <div className={cn("mt-0.5 text-[11px]", t.subtitle)}>{subtitle}</div> : null}
                    </div>
                </div>
                {right ? <div className="flex-none">{right}</div> : null}
            </div>
        </section>
    )
}

// ──────────────────────────────────────────────────────────────────
// VARIANTS TAB
// ──────────────────────────────────────────────────────────────────

function VariantsTab({ master, variants, sizes, routeInfo, templateName }: { master: ProductMaster; variants: ProductVariant[]; sizes: ProductMasterSize[]; routeInfo?: any; templateName?: string }) {
    const activeCount = variants.filter((v) => v.active).length
    return (
        <div className="space-y-4">
        <TabBanner
            tone="violet"
            eyebrow={`Variants · ${variants.length}`}
            title="Axis tuples — every shippable configuration"
            subtitle={`${activeCount} active · pivot any 2 axes · click a cell for live BOM`}
            icon={<Workflow className="h-5 w-5" />}
            right={(
                <Link href={`/master/products/${master.id}/variants/new`} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 px-3.5 text-[11px] font-black text-white shadow-md hover:shadow-lg hover:from-violet-700 hover:to-purple-700 transition">
                    <Plus className="h-3.5 w-3.5" /> Create variant
                </Link>
            )}
        />
        <MaterialBreakdownBoundary master={master} variants={variants} sizes={sizes} />
        <section className="rounded-2xl border border-violet-100 bg-white shadow-sm overflow-hidden ring-1 ring-white/40">
            <header className="flex items-center justify-end gap-2 border-b border-violet-100 bg-gradient-to-r from-white via-violet-50/40 to-purple-50/30 px-5 py-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> live preview
                </span>
            </header>
            <div className="p-5">
                <VariantsMatrixV37 productMasterId={master.id} rows={variants} axes={master.variant_axes || []} master={master} routeSteps={routeInfo?.route_steps || []} templateName={templateName || master.template_name || undefined} />
            </div>
        </section>
        </div>
    )
}

class MaterialBreakdownBoundary extends React.Component<
    { master: ProductMaster; variants: ProductVariant[]; sizes: ProductMasterSize[] },
    { failed: boolean }
> {
    constructor(props: any) {
        super(props)
        this.state = { failed: false }
    }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: any) {
        if (typeof console !== "undefined") console.error("MaterialBreakdown error:", error)
    }
    render() {
        if (this.state.failed) return null
        try {
            return <MaterialBreakdownSection {...this.props} />
        } catch (err) {
            return null
        }
    }
}

function MaterialBreakdownSection({ master, variants, sizes }: { master: ProductMaster; variants: ProductVariant[]; sizes: ProductMasterSize[] }) {
    const safeVariants = Array.isArray(variants) ? variants : []
    const safeSizes = Array.isArray(sizes) ? sizes : []
    const top = safeVariants.slice(0, 4)
    if (!top.length) return null
    const kind = String(master?.product_kind || "").toUpperCase()
    const isPackOrPod = kind === "PACKAGING" || kind === "POD"
    return (
        <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/30 shadow-sm overflow-hidden ring-1 ring-white/40">
            <header className="flex items-center justify-between border-b border-emerald-100 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">📊</span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Material breakdown · top {top.length} variant{top.length === 1 ? "" : "s"}</h3>
                        <p className="text-[10px] text-slate-500">Per-variant layer table · pouch math · roll math · live stock chip</p>
                    </div>
                </div>
                {variants.length > top.length ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                        +{variants.length - top.length} more in matrix
                    </Badge>
                ) : null}
            </header>
            <div className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-2">
                {top.map((v) => (
                    <MaterialBreakdownCard
                        key={v.id}
                        master={master}
                        variant={v}
                        sizes={safeSizes}
                        showLink={isPackOrPod}
                    />
                ))}
            </div>
        </section>
    )
}

function MaterialBreakdownCard({ master, variant, sizes, showLink }: {
    master: ProductMaster
    variant: ProductVariant
    sizes: ProductMasterSize[]
    showLink: boolean
}) {
    const safeSizes = Array.isArray(sizes) ? sizes : []
    const layerSnapshot = (variant as any)?.layer_snapshot
    const masterLayers = Array.isArray((master as any)?.layer_template) ? (master as any).layer_template : []
    const layers: any[] = Array.isArray(layerSnapshot) && layerSnapshot.length
        ? layerSnapshot
        : masterLayers.map((row: any, i: number) => ({
            role: row?.role,
            film_variant_code: row?.film_variant_code,
            thickness_micron: row?.thickness_micron,
            grade: row?.default_grade,
            layer_index: i + 1,
        }))
    const totalThickness = layers.reduce((s, l) => s + Number(l?.thickness_micron || 0), 0)
    const geom = (variant as any)?.geometry_snapshot || {}
    const axisValues = (variant as any)?.axis_values || {}
    const unitG = Number(geom?.unit_weight_g || (variant as any)?.unit_weight_g || 0)
    const sizeRow = safeSizes.find((s) => String(axisValues?.size || "") === s?.code) || safeSizes[0]
    const rollWidth = Number(sizeRow?.roll_width_mm || geom?.roll_width_mm || 0)
    const widthMm = Number(sizeRow?.width_mm || geom?.width_mm || 0)
    const heightMm = Number(sizeRow?.height_mm || geom?.height_mm || 0)
    const gussetMm = Number(sizeRow?.gusset_mm || geom?.gusset_mm || 0)
    // jumbos per 1000 pouches: assume 1000 pouches × unitG / typical jumbo kg (50kg default)
    const standardOrderKg = 500
    const expectedKgFor1000 = (unitG * 1000) / 1000
    const expectedJumbos = unitG > 0 ? Math.max(1, Math.ceil(standardOrderKg / 50)) : 0
    const layerToneList = [
        "bg-indigo-50 text-indigo-700 border-indigo-200",
        "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
        "bg-emerald-50 text-emerald-700 border-emerald-200",
        "bg-amber-50 text-amber-700 border-amber-200",
        "bg-sky-50 text-sky-700 border-sky-200",
        "bg-rose-50 text-rose-700 border-rose-200",
    ]
    const link = variant.inventory_link || null
    return (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-indigo-700">{variant.code}</span>
                    <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1",
                        variant.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                    )}>
                        {variant.active ? "active" : "inactive"}
                    </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-500">
                    <span>{totalThickness} µ total</span>
                    {unitG > 0 ? (<><span>·</span><span>{unitG.toFixed(2)} g/pouch</span></>) : null}
                </div>
            </header>

            {/* Layer table */}
            <div className="px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Layer stack (top → bottom)</div>
                <div className="space-y-1.5">
                    {layers.map((l, idx) => {
                        const tone = layerToneList[idx % layerToneList.length]
                        const thk = Number(l.thickness_micron || 0)
                        const widthPct = totalThickness > 0 ? Math.max(8, (thk / totalThickness) * 100) : 0
                        return (
                            <div key={idx} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5", tone)}>
                                <span className="font-mono text-[10px] font-bold">L{l.layer_index || idx + 1}</span>
                                <span className="font-mono text-[10px]">{l.film_variant_code || l.role || "?"}</span>
                                <span className="text-[10px] opacity-70">{l.role}</span>
                                {l.grade ? <span className="text-[10px] opacity-70">· {l.grade}</span> : null}
                                <div className="ml-auto flex items-center gap-2">
                                    <div className="h-1 w-16 overflow-hidden rounded-full bg-white/70">
                                        <div className="h-full bg-current opacity-60" style={{ width: `${widthPct}%` }} />
                                    </div>
                                    <span className="font-mono text-[10px] font-bold">{thk} µ</span>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Geometry */}
            <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-2">Geometry preview</div>
                <div className="flex items-center gap-3">
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white">
                        {widthMm && heightMm ? (
                            <div
                                className="bg-gradient-to-br from-indigo-100 to-violet-100 ring-1 ring-indigo-300"
                                style={{
                                    width: `${Math.min(48, widthMm / 6)}px`,
                                    height: `${Math.min(54, heightMm / 6)}px`,
                                }}
                            />
                        ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                        )}
                    </div>
                    <div className="grid flex-1 grid-cols-2 gap-1 text-[10px]">
                        <div className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                            <div className="font-bold text-slate-700">W × H</div>
                            <div className="font-mono">{widthMm || "—"} × {heightMm || "—"} mm</div>
                        </div>
                        <div className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                            <div className="font-bold text-slate-700">Gusset</div>
                            <div className="font-mono">{gussetMm || "—"} mm</div>
                        </div>
                        <div className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                            <div className="font-bold text-slate-700">Roll width</div>
                            <div className="font-mono">{rollWidth || "—"} mm</div>
                        </div>
                        <div className="rounded bg-white px-2 py-1 ring-1 ring-slate-200">
                            <div className="font-bold text-slate-700">Jumbos / {standardOrderKg}kg</div>
                            <div className="font-mono">{expectedJumbos || "—"}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stock linkage */}
            {showLink ? (
                <div className="border-t border-slate-100 bg-emerald-50/30 px-4 py-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Catalog link</span>
                            {link ? (
                                <span className="font-mono text-[11px] font-bold text-emerald-800">{link.code}</span>
                            ) : (
                                <span className="text-[10px] text-amber-700">unlinked</span>
                            )}
                        </div>
                        {link?.stock_qty != null ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                {Number(link.stock_qty).toLocaleString()} in stock
                            </span>
                        ) : null}
                    </div>
                </div>
            ) : (
                <div className="border-t border-slate-100 bg-violet-50/30 px-4 py-2.5">
                    <div className="text-[11px] text-violet-800">
                        <span className="font-bold">Auto-generated</span> on order confirm — InventoryMaterial code derived from variant
                    </div>
                </div>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// SIZES TAB
// ──────────────────────────────────────────────────────────────────

function SizesTab({ sizes, master }: { sizes: ProductMasterSize[]; master: ProductMaster }) {
    const isRoll = master.product_kind === "ROLL" || master.product_kind === "POD"
    return (
        <div className="space-y-4">
            <TabBanner
                tone="emerald"
                eyebrow={`Sizes · ${sizes.length}`}
                title={isRoll ? "Roll geometry catalog" : "Pouch geometry catalog"}
                subtitle={isRoll ? "Roll width + stock form + trim" : "W × H + gusset + pouch style + film-area width"}
                icon={<span className="text-lg">📐</span>}
            />
            <section className="rounded-2xl border border-emerald-100 bg-white shadow-sm overflow-hidden ring-1 ring-white/40">
                {sizes.length === 0 ? (
                    <div className="p-10 text-center">
                        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center text-2xl">📐</div>
                        <div className="mt-3 text-sm font-bold text-slate-700">No sizes defined yet</div>
                        <div className="mt-1 text-xs text-slate-500">Add sizes from PM Edit to surface them here.</div>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-xs">
                            <thead className="border-b border-emerald-200 bg-gradient-to-r from-emerald-50 via-teal-50/40 to-cyan-50/30 text-emerald-800">
                                <tr>
                                    <th className="px-4 py-3 text-left font-black uppercase tracking-[0.14em] text-[9px]">Code</th>
                                    <th className="px-4 py-3 text-left font-black uppercase tracking-[0.14em] text-[9px]">Label</th>
                                    <th className="px-4 py-3 text-right font-black uppercase tracking-[0.14em] text-[9px]">W (mm)</th>
                                    <th className="px-4 py-3 text-right font-black uppercase tracking-[0.14em] text-[9px]">H (mm)</th>
                                    <th className="px-4 py-3 text-right font-black uppercase tracking-[0.14em] text-[9px]">Gusset</th>
                                    <th className="px-4 py-3 text-right font-black uppercase tracking-[0.14em] text-[9px]">Roll W</th>
                                    <th className="px-4 py-3 text-left font-black uppercase tracking-[0.14em] text-[9px]">{isRoll ? "Form" : "Style"}</th>
                                    <th className="px-4 py-3 text-right font-black uppercase tracking-[0.14em] text-[9px]">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-emerald-50">
                                {sizes.map((s: any, idx: number) => (
                                    <tr key={s.id || s.code} className={cn("transition-colors hover:bg-emerald-50/40", idx % 2 === 1 ? "bg-slate-50/30" : "bg-white")}>
                                        <td className="px-4 py-2.5 font-mono font-black text-emerald-900">{s.code}</td>
                                        <td className="px-4 py-2.5 text-slate-700">{s.label}</td>
                                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{s.width_mm}</td>
                                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">{s.height_mm || (isRoll ? "—" : 0)}</td>
                                        <td className="px-4 py-2.5 text-right font-mono text-slate-700">{s.gusset_mm || "—"}</td>
                                        <td className="px-4 py-2.5 text-right font-mono text-slate-700">{s.roll_width_mm || <span className="italic text-slate-400">auto</span>}</td>
                                        <td className="px-4 py-2.5 text-[10px]">
                                            <span className="rounded-md bg-gradient-to-r from-teal-50 to-cyan-50 px-2 py-0.5 font-bold text-teal-800 ring-1 ring-teal-200">{isRoll ? (s.roll_form || "—") : (s.pouch_style || "—")}</span>
                                        </td>
                                        <td className="px-4 py-2.5 text-right">
                                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1", s.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                                                <span className={cn("inline-block h-1 w-1 rounded-full", s.active ? "bg-emerald-500" : "bg-rose-500")} />
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
        </div>
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
        <div className="space-y-4">
        <TabBanner
            tone="amber"
            eyebrow={`Customer overlays · ${overlays.length}`}
            title="Customer-specific defaults for sales entry"
            subtitle="Still uses master's engineering BOM · click a card for the live preview"
            icon={<Users className="h-5 w-5" />}
            right={(
                <button onClick={onAdd} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3.5 text-[11px] font-black text-white shadow-md hover:shadow-lg hover:from-amber-600 hover:to-orange-600 transition">
                    <Plus className="h-3.5 w-3.5" /> Add overlay
                </button>
            )}
        />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="rounded-2xl border border-amber-100 bg-white shadow-sm overflow-hidden ring-1 ring-white/40">
                <header className="flex items-center justify-between border-b border-amber-100 bg-gradient-to-r from-amber-50/40 via-white to-orange-50/30 px-5 py-2.5">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Cards · click for live BOM preview</div>
                    <button onClick={onAdd} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 text-[11px] font-bold text-white shadow-sm hover:shadow-md transition">
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
            <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-slate-50 p-10 text-center shadow-sm">
                <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-slate-200/40 blur-3xl" />
                <Palette className="relative mx-auto h-10 w-10 text-slate-300" />
                <div className="relative mt-3 font-display text-sm font-bold text-slate-700">Not print-capable</div>
                <p className="relative mt-1 text-xs text-slate-500 max-w-md mx-auto">Enable printing on the master to surface approved artworks.</p>
            </div>
        )
    }
    return (
        <div className="space-y-4">
            <TabBanner
                tone="fuchsia"
                eyebrow={`Approved artworks · ${artworks.length}`}
                title="Live colorways for this master"
                subtitle="Sales can pick any of these on print-capable orders"
                icon={<Palette className="h-5 w-5" />}
            />
            <section className="rounded-2xl border border-fuchsia-100 bg-white shadow-sm overflow-hidden ring-1 ring-white/40">
                {artworks.length === 0 ? (
                    <div className="p-10 text-center">
                        <div className="mx-auto h-12 w-12 rounded-2xl bg-gradient-to-br from-fuchsia-100 to-pink-100 flex items-center justify-center"><Palette className="h-5 w-5 text-fuchsia-600" /></div>
                        <div className="mt-3 text-sm font-bold text-slate-700">No approved artworks yet</div>
                        <div className="mt-1 text-xs text-slate-500">Approved artworks from Engineering will surface here.</div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-5">
                        {artworks.map((a) => (
                            <div key={a.id} className="group relative overflow-hidden rounded-2xl border border-fuchsia-100 bg-gradient-to-br from-white via-fuchsia-50/40 to-pink-50/40 p-4 shadow-sm transition hover:shadow-lg hover:border-fuchsia-300 hover:-translate-y-0.5">
                                <div aria-hidden className="pointer-events-none absolute -top-10 -right-10 h-24 w-24 rounded-full bg-pink-200/30 blur-2xl transition group-hover:bg-pink-300/40" />
                                <div className="relative flex items-center justify-between">
                                    <span className="font-mono text-xs font-black text-fuchsia-800 truncate">{(a as any).design_code || a.id}</span>
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">
                                        <span className="inline-block h-1 w-1 rounded-full bg-emerald-500" /> approved
                                    </span>
                                </div>
                                <div className="relative mt-1.5 text-sm font-bold text-slate-800 truncate">{a.name || "—"}</div>
                                <div className="relative mt-2 flex flex-wrap gap-1">
                                    {(a as any).print_type ? <span className="rounded-md bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-800 ring-1 ring-fuchsia-200">{(a as any).print_type}</span> : null}
                                    {(a as any).substrate_mode ? <span className="rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-bold text-pink-800 ring-1 ring-pink-200">{(a as any).substrate_mode}</span> : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// AUDIT TAB (placeholder · existing audit centre lives at /system/audit)
// ──────────────────────────────────────────────────────────────────

function AuditPlaceholder({ masterId }: { masterId: string }) {
    return (
        <div className="space-y-4">
            <TabBanner
                tone="slate"
                eyebrow="Audit trail"
                title="Every change · with who, when & diff"
                subtitle="Master / variant / overlay edits all stream into the system audit centre"
                icon={<ShieldCheck className="h-5 w-5" />}
            />
            <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 p-10 text-center shadow-sm ring-1 ring-white/40">
                <div aria-hidden className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full bg-indigo-200/30 blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-slate-300/30 blur-3xl" />
                <div className="relative">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-md">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div className="mt-4 font-display text-base font-black text-slate-900">Audit trail</div>
                    <p className="mt-1 text-xs text-slate-600 max-w-md mx-auto leading-relaxed">All master/variant/overlay changes for this product master are logged in the system audit centre with before/after diffs, actor and timestamp.</p>
                    <Link href={`/system/audit?ref=product-master&id=${masterId}`} className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-slate-800 to-slate-900 px-4 py-2 text-[11px] font-black text-white shadow-md hover:shadow-lg hover:from-slate-900 hover:to-black transition">
                        Open audit centre <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                </div>
            </section>
        </div>
    )
}

// ──────────────────────────────────────────────────────────────────
// PACKAGING CONTRACT CARD (Overview)
// ──────────────────────────────────────────────────────────────────

/**
 * ProductionCatalogMapCard — shown on PM Detail Overview for PACKAGING + POD
 * (production) masters instead of the sales-pickable PackagingContractCard.
 *
     * Surfaces the manual variant <-> catalog-row map the production-master
     * model relies on. Every variant should be linked by an admin to one fixed
     * SKU in `/master/packaging` or `/master/pod`.
 */
function ProductionCatalogMapCard({ master, variants }: { master: ProductMaster; variants: ProductVariant[] }) {
    const kind = String(master.product_kind || "").toUpperCase()
    const catalogHref = kind === "PACKAGING" ? "/master/packaging" : "/master/pod"
    const linked = variants.filter((v) => v.inventory_link && v.inventory_link.id)
    const totalStock = linked.reduce((s, v) => s + Number(v.inventory_link?.stock_qty || 0), 0)
    const uomCounts: Record<string, number> = {}
    for (const v of linked) {
        const u = String(v.inventory_link?.base_uom || "").toUpperCase() || "PCS"
        uomCounts[u] = (uomCounts[u] || 0) + Number(v.inventory_link?.stock_qty || 0)
    }
    const stockSummary = Object.entries(uomCounts)
        .map(([uom, qty]) => `${Number(qty).toLocaleString("en-IN", { maximumFractionDigits: 0 })} ${uom}`)
        .join(" · ") || "—"
    const sample = linked.slice(0, 4)
    return (
        <section className="rounded-2xl border border-violet-100 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50/40 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white shadow-sm">
                        <Database className="h-4 w-4" />
                    </span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Catalog map · variant ↔ SKU</h3>
                        <div className="text-[10px] text-slate-500">
                            Every variant of this {kind} master must be manually linked to one fixed catalog row in <Link href={catalogHref} className="font-bold text-violet-700 underline-offset-2 hover:underline">{catalogHref}</Link> — that row is the stock, purchase, and consumption identity.
                        </div>
                    </div>
                </div>
                <Link href={catalogHref} className="inline-flex h-8 items-center gap-1 rounded-lg bg-white px-2.5 text-[10px] font-black text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50">
                    Open catalog <ArrowRight className="h-3 w-3" />
                </Link>
            </header>
            <div className="p-5 space-y-3">
                {/* KPI strip */}
                <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/60 to-white px-3 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-violet-700">Variants</div>
                        <div className="mt-0.5 font-display text-lg font-black text-slate-900 tabular-nums">{variants.length}</div>
                    </div>
                    <div className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-white px-3 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-emerald-700">Linked SKUs</div>
                        <div className="mt-0.5 font-display text-lg font-black text-slate-900 tabular-nums">{linked.length}</div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-white px-3 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-amber-700">Total stock</div>
                        <div className="mt-0.5 font-display text-sm font-black text-slate-900 tabular-nums">{stockSummary}</div>
                    </div>
                </div>

                {/* Sample of linked variants */}
                {sample.length > 0 ? (
                    <div className="space-y-1.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Sample · first {sample.length} of {linked.length}</div>
                        {sample.map((v) => (
                            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 hover:border-violet-200 hover:bg-violet-50/30">
                                <div className="min-w-0 flex-1">
                                    <div className="font-mono text-[11px] font-black text-violet-800 truncate">{v.code}</div>
                                </div>
                                <ArrowRight className="h-3 w-3 text-slate-300 flex-none" />
                                <div className="min-w-0 text-right">
                                    <div className="font-mono text-[11px] font-black text-emerald-800 truncate">{v.inventory_link?.pod_sku_variant_code || v.inventory_link?.code}</div>
                                    <div className="text-[10px] font-mono text-slate-500">
                                        {Number(v.inventory_link?.stock_qty || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} {v.inventory_link?.base_uom || ""}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : variants.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-3 py-2.5 text-[11px] text-slate-500">
                        No variants yet. Create the production variants first, then link each one to an existing fixed SKU in <Link href={catalogHref} className="font-bold text-violet-700 underline-offset-2 hover:underline">{catalogHref}</Link>.
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/30 px-3 py-2.5 text-[11px] text-amber-900">
                        Variants exist but are not linked to catalog SKUs yet. Use the variant card&apos;s Link SKU action and choose an existing unlinked row.
                    </div>
                )}

                <div className="rounded-xl bg-slate-50/60 px-3 py-2 text-[10px] text-slate-600">
                    <strong>How it works:</strong> The Product Master variant is the in-house production contract. The catalog SKU is created and maintained separately in <code className="font-mono bg-white px-1 py-0.5 rounded ring-1 ring-slate-200">{catalogHref}</code>. Manual linking joins the two; production runs and consumption use the linked catalog row.
                </div>
            </div>
        </section>
    )
}

function PackagingContractCard({ master, packagingMaterials, podVariants }: { master: ProductMaster; packagingMaterials: PackagingMaterial[]; podVariants: PodSkuVariant[] }) {
    const kind = String(master.product_kind || "").toUpperCase()
    const variantAxes = master.variant_axes || []
    const axisAllowedCodes = (a: VariantAxisDef): string[] => {
        const opts = (a as any).options as any[] | undefined
        if (!Array.isArray(opts)) return []
        return opts.map((o) => typeof o === "string" || typeof o === "number" ? String(o) : String(o?.code || o?.value || o?.id || "")).filter(Boolean)
    }
    // Inner pouch — POUCH masters only, sales-pickable axis.
    const innerAxis = kind === "POUCH"
        ? variantAxes.find((a) => {
            const k = String(a.axis).toUpperCase()
            return k === "PACKAGING_INNER" || k === "PACKAGING"
        })
        : undefined
    const innerCodes = innerAxis ? axisAllowedCodes(innerAxis) : []
    // POD axis — applies to all kinds.
    const podAxis = variantAxes.find((a) => {
        const k = String(a.axis).toUpperCase()
        return a.master_data_source === "pod_sku_variant" || ["POD", "POD_VARIANT", "POD_SKU_VARIANT"].includes(k)
    })
    const podCodes = podAxis ? axisAllowedCodes(podAxis) : []
    const printCapable = Boolean((master.fixed_attributes as any)?.print_capable)

    return (
        <section className="rounded-2xl border border-emerald-100 bg-white shadow-sm overflow-hidden">
            <header className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-r from-emerald-50 via-white to-teal-50/40 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-sm"><Package className="h-4 w-4" /></span>
                    <div>
                        <h3 className="font-display text-sm font-bold text-slate-900">Inner pouch &amp; POD · sales-pickable</h3>
                        <div className="text-[10px] text-slate-500">All outer packing (gunny / sheet / tape / label / tag) is tagged per order at EOD — not on this master.</div>
                    </div>
                </div>
                <div className="flex items-center gap-1.5">
                    {printCapable ? <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700 ring-1 ring-fuchsia-200">print capable</span> : null}
                </div>
            </header>
            <div className="p-5 space-y-3">
                {/* Inner pouch — POUCH only */}
                {kind === "POUCH" ? (
                    innerCodes.length > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/30 px-3 py-2.5 ring-1 ring-amber-100">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] font-black uppercase tracking-wider text-amber-800">
                                    Inner pouch · axis-pickable
                                </div>
                                <span className="text-[10px] font-bold text-amber-700/80">
                                    {innerAxis?.required ? "required" : "optional"}
                                    {(innerAxis as any)?.auto_demand_in_house ? " · auto-demand" : ""}
                                    {" · "}{innerCodes.length} allowed
                                </span>
                            </div>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                                {innerCodes.map((code) => {
                                    const material = packagingMaterials.find((m: any) => m.code === code || m.id === code)
                                    return (
                                        <span key={code} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-900 ring-1 ring-amber-200">
                                            {code}
                                            {material?.name && material.name !== code ? <span className="text-[9px] font-medium text-amber-700/80">· {material.name}</span> : null}
                                        </span>
                                    )
                                })}
                            </div>
                            <div className="mt-1.5 text-[10px] text-amber-700/80">
                                Sales picks 1 per order · BOM = ceil(total_pouches / pcs_per_inner) · customer overlay can override pcs_per_inner.
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/30 px-3 py-2 text-[11px] text-amber-800">
                            Inner pouch axis not configured on this POUCH master. Open <strong>Edit → Sales-pickable menu</strong> to allow inner-pouch SKUs.
                        </div>
                    )
                ) : null}

                {/* POD — all kinds */}
                {podCodes.length > 0 ? (
                    <div className="rounded-xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50/60 via-white to-pink-50/30 px-3 py-2.5 ring-1 ring-fuchsia-100">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] font-black uppercase tracking-wider text-fuchsia-800">
                                POD · axis-pickable · sales picks per order
                            </div>
                            <span className="text-[10px] font-bold text-fuchsia-700/80">
                                {podAxis?.required ? "required" : "optional"}
                                {(podAxis as any)?.auto_demand_in_house ? " · auto-demand" : ""}
                                {" · "}{podCodes.length} allowed
                            </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                            {podCodes.map((code) => {
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

                {/* Outer / EOD-tagged · informational, never editable from this page */}
                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/80 via-white to-slate-50/50 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white">
                            <Package className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-wider text-slate-600">Outer + EOD extras · packing yard tags per order</div>
                            <div className="mt-0.5 text-[11px] text-slate-600">
                                Gunny / sheet / tape / label / tag are not on the master. Each order&apos;s actual consumption is captured at end of day via the <Link href="/logistics/packing/order-ticks" className="font-bold text-violet-700 underline-offset-2 hover:underline">per-order tick</Link> flow and shown in the <Link href="/logistics/packing/audit" className="font-bold text-violet-700 underline-offset-2 hover:underline">audit trail</Link>.
                            </div>
                        </div>
                    </div>
                </div>

                {kind !== "POUCH" && podCodes.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-3 text-center text-[11px] text-slate-500">
                        No sales-pickable inner-pouch or POD options on this master.
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
    // Customer-specific override for pcs-per-inner-pouch. Only takes effect
    // when an inner-pouch default is also picked. Empty = use the master's
    // fallback (from packaging material's packaging_defaults_json.pcs_per_pack).
    const [pcsPerInnerOverride, setPcsPerInnerOverride] = React.useState<string>("")
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
        setPcsPerInnerOverride("")
        setDefaultSizeCode("")
        setDefaultAddons([])
        setNotes("")
        setOverrideValues({})
    }, [])

    // Which catalog rows are even allowed by this master?
    const catalogAxes = (master.variant_axes || []).filter((a) => axisCatalogSource(a))
    // Only INNER-pouch packaging axes appear in customer overlays now. Outer
    // packing (gunny / sheet / tape / label / tag) is no longer on the master
    // — packing yard ticks it per order at EOD via /logistics/packing/order-ticks.
    const packagingAxes = catalogAxes
        .filter((a) => axisCatalogSource(a) === "packaging_material")
        .filter((a) => packagingAxisRole(a, master) === "inner")
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

    // Any axes left that aren't already covered by the size lock / POD / inner / addons / artwork rows?
    // Deprecated axes are explicitly excluded so they never surface as "Other axis defaults":
    //   - packaging_outer / packaging: outer packing is no longer on the master
    //     (packing yard tags it at EOD per order)
    //   - artwork_mode: derived from the Printing 2-knob contract
    //   - per-layer μ + grade + roll widths: engineering specs, not customer
    //     preferences — handled by the variant tuple system (see overlay
    //     design doc). Customer overrides happen on the order line.
    const handledAxisKeys = new Set([
        "size",
        "pod_variant", "pod",
        "addons", "addon",
        "artwork_mode",
        "packaging_outer", "packaging",   // dropped from PM model
    ])
    packagingAxes.forEach((axis) => handledAxisKeys.add(String(axis.axis)))
    const otherAxes = (master.variant_axes || []).filter((a) => !handledAxisKeys.has(String(a.axis)))
    // For per-layer numeric/enum axes, we show an info chip only (engineering
    // specs vary per-variant — customer doesn't get a master-level override).
    const perLayerAxes = otherAxes.filter((a) => a.type === "per_layer_number" || a.type === "per_layer_enum")
    // Genuine "other" axes the overlay can override — anything left after
    // dropping handled + per-layer.
    const overrideAxes = otherAxes.filter((a) => a.type !== "per_layer_number" && a.type !== "per_layer_enum")
    const [overrideValues, setOverrideValues] = React.useState<Record<string, string>>({})
    const patchOverride = React.useCallback((key: string, value: string) => {
        setOverrideValues((prev) => ({ ...prev, [key]: value }))
    }, [])

    const createMutation = useMutation({
        mutationFn: () => {
            const packingAxisValues = Object.fromEntries(Object.entries(packingDefaults).filter(([, v]) => v && v.length))
            const defaultPackingRecipe = buildOverlayPackingRecipe(packingAxisValues, packagingMaterials, master, packagingAxes)
            // Apply the customer-specific pcs_per_inner override if set.
            // Wins over the master fallback when the recipe BOM is computed
            // (auto · ceil(total_pouches / pcs_per_inner)).
            const overridePcs = Number(pcsPerInnerOverride || 0)
            if (overridePcs > 0 && defaultPackingRecipe?.primary_inner_pack?.enabled) {
                defaultPackingRecipe.primary_inner_pack.pcs_per_pack = overridePcs
                if (Array.isArray(defaultPackingRecipe.packaging_lines)) {
                    defaultPackingRecipe.packaging_lines = defaultPackingRecipe.packaging_lines.map((ln: any) =>
                        ln?.role === "PRIMARY_INNER" ? { ...ln, pcs_per_pack: overridePcs } : ln,
                    )
                }
            }
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

                        {/* 2. Customer order defaults — only the master's enabled axes show below. */}
                        <OverlaySection eyebrow="2 · Customer order defaults" title="What sales auto-picks for this customer">
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
                                <div className="mt-3 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/30 p-3 shadow-sm">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Inner pouch (only packing on master)</div>
                                        <span className="text-[10px] text-slate-500">Outer / sheet / tape / label / tag → packing yard EOD ticks</span>
                                    </div>
                                    {packagingAxes.map((axis) => {
                                        const allowed = resolveAxisValues(axis, master, sizes, packagingMaterials, podVariants, [] as any)
                                        const key = String(axis.axis)
                                        const value = packingDefaults[key] || ""
                                        // Resolve the master fallback pcs_per_inner from the selected material's
                                        // packaging_defaults_json so we can show it as a "default" hint.
                                        const pickedMaterial = packagingMaterials.find((m) => normalizeCode(m.code) === normalizeCode(value))
                                        const masterPcsPerInner = Number(
                                            (pickedMaterial?.packaging_defaults_json as any)?.pcs_per_pack
                                            ?? (pickedMaterial?.packaging_defaults_json as any)?.pcs_per_inner
                                            ?? 0,
                                        )
                                        return (
                                            <div key={key} className="space-y-2">
                                                <div>
                                                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Default inner pouch SKU</Label>
                                                    <Select value={value || "__none"} onValueChange={(v) => {
                                                        patchPackingDefault(key, v === "__none" ? "" : v)
                                                        // Reset override when changing SKU so the master default reapplies.
                                                        setPcsPerInnerOverride("")
                                                    }}>
                                                        <SelectTrigger className="mt-1 h-10 rounded-xl bg-white"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="__none">— Sales picks on order —</SelectItem>
                                                            {allowed.map((opt) => <SelectItem key={opt.code} value={opt.code}>{opt.label}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                    <div className="mt-1 text-[10px] text-slate-500">{allowed.length} allowed from this master</div>
                                                </div>
                                                {value ? (
                                                    <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <Label className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                                                                pcs_per_inner override for this customer
                                                            </Label>
                                                            <span className="text-[10px] text-slate-500 font-mono">
                                                                master default · {masterPcsPerInner > 0 ? `${masterPcsPerInner} pcs` : "not set"}
                                                            </span>
                                                        </div>
                                                        <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center">
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                placeholder={masterPcsPerInner > 0 ? `e.g. ${masterPcsPerInner}` : "e.g. 50"}
                                                                value={pcsPerInnerOverride}
                                                                onChange={(e) => setPcsPerInnerOverride(e.target.value)}
                                                                className="h-10 rounded-xl font-mono"
                                                            />
                                                            {pcsPerInnerOverride && Number(pcsPerInnerOverride) > 0 ? (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-black text-white shadow-sm">
                                                                    OVERRIDE WINS
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600 ring-1 ring-slate-200">
                                                                    USING MASTER
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="mt-1 text-[10px] text-slate-500">
                                                            BOM uses <strong>ceil(total_pouches / pcs_per_inner)</strong>. Leave blank to inherit the master default.
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        )
                                    })}
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

                        {/* 3. Artwork — only when master is print-capable. */}
                        {master.fixed_attributes?.print_capable ? (
                            <OverlaySection eyebrow="3 · Artwork" title="Customer-facing approved artwork">
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
                                <div className="mt-1 text-[10px] text-slate-500">
                                    {artworks.length} approved artwork{artworks.length === 1 ? "" : "s"} available for this master ·{" "}
                                    {master.fixed_attributes?.artwork_required
                                        ? <span className="font-bold text-fuchsia-700">artwork REQUIRED · default pre-fills the line</span>
                                        : <span className="font-bold text-amber-700">artwork OPTIONAL · warning-print run when not picked</span>}
                                </div>
                            </OverlaySection>
                        ) : null}

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
