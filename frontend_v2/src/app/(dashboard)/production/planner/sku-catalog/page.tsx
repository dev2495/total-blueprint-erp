"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  Package,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Workflow,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  SalesOverflowChipGroup,
  SalesSavedViewsBar,
  SalesSmartRangeFilter,
  SALES_GRADE_PRIORITY,
  SALES_MATERIAL_PRIORITY,
  salesMaterialFilterLabel,
  salesSortChipOptions,
  salesUniqueText,
  type SalesOverflowChipOption,
  type SalesSavedViewFilters,
} from "@/components/sales/sales-flow-ui"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { masterDataService } from "@/services/master-data"
import { plannerService, type PlannerSkuPreset, type PlannerSkuVariantPreset } from "@/services/planner"
import { recipeService } from "@/services/recipes"
import styles from "./planner-sku-catalog.module.css"

type LaunchKind = PlannerSkuVariantPreset["launch_kind"]
type QuantityUom = PlannerSkuVariantPreset["quantity_uom"]
type StockPurpose = PlannerSkuVariantPreset["stock_purpose"]
type StockStrategy = PlannerSkuVariantPreset["stock_strategy"]
type PlannerStockClass = PlannerSkuVariantPreset["planner_stock_class"]
type FgType = "POUCH" | "ROLL"
type RollForm = "FLAT" | "FOLDED" | "TUBING"
type PlannerOutputClass = "FG" | "INVARIANT" | "WIP" | "POD" | "PACKAGING"

type LayerDraft = {
  family_id: string
  variant_id: string
  thickness_micron: number
  roll_width_mm: number
}

type AddonDraft = {
  addon_id: string
  qty: number
  applies_to: "WIDTH" | "HEIGHT" | "NONE"
}

type PackagingLineDraft = {
  material_id: string
  qty: number
  uom: "PCS" | "KG" | "METER"
  basis: "PER_ROLL"
}

type VariantDraft = {
  id?: string
  code: string
  name: string
  active: boolean
  launch_kind: LaunchKind
  template: string
  default_plant: string
  default_qty: number
  quantity_uom: QuantityUom
  stock_purpose: StockPurpose
  stock_strategy: StockStrategy
  planner_stock_class: PlannerStockClass
  start_step_index: number
  stop_step_index?: number | null
  finished_good_type: FgType
  roll_form: RollForm
  width_mm: number
  height_mm: number
  faces: number
  layer_snapshot: LayerDraft[]
  printing_enabled: boolean
  printing_type: "FLEXO" | "ROTO" | "DIGITAL"
  substrate_mode: "SHEET" | "TUBING"
  front_colors_count: number
  back_colors_count: number
  ink_gsm_total: number
  artwork_id: string
  adhesive_gsm: number
  solvent_gsm: number
  addons_snapshot: AddonDraft[]
  primary_inner_pack_enabled: boolean
  primary_inner_pack_material_id: string
  primary_inner_pack_pcs: number
  roll_dispatch_pack_enabled: boolean
  roll_dispatch_pack_lines: PackagingLineDraft[]
  packaging_material: string
  pod_sku_variant: string
}

type FamilyDraft = {
  id?: string
  code: string
  name: string
  template: string
  default_plant: string
  notes: string
  active: boolean
}

const launchKindLabel: Record<string, string> = {
  FINAL_ROLL: "Final roll / pouch",
  SHARED_INVARIANT_ROLL: "Shared invariant roll",
  BASE_UPSTREAM_ROLL: "Base / upstream WIP",
  PACKAGING_STOCK: "Packaging stock",
  POD_STOCK: "POD stock",
}

function outputClassLabel(output: PlannerOutputClass) {
  if (output === "FG") return "Final roll / pouch"
  if (output === "INVARIANT") return "Invariant roll"
  if (output === "WIP") return "WIP for roll / pouch"
  if (output === "POD") return "POD stock"
  return "Packaging stock"
}

function outputClassForLaunchKind(kind: LaunchKind): PlannerOutputClass {
  if (kind === "FINAL_ROLL") return "FG"
  if (kind === "SHARED_INVARIANT_ROLL") return "INVARIANT"
  if (kind === "BASE_UPSTREAM_ROLL") return "WIP"
  if (kind === "POD_STOCK") return "POD"
  return "PACKAGING"
}

function launchKindForOutputClass(output: PlannerOutputClass): LaunchKind {
  if (output === "FG") return "FINAL_ROLL"
  if (output === "INVARIANT") return "SHARED_INVARIANT_ROLL"
  if (output === "WIP") return "BASE_UPSTREAM_ROLL"
  if (output === "POD") return "POD_STOCK"
  return "PACKAGING_STOCK"
}

function plannerUiStateForOutput(output: PlannerOutputClass) {
  if (output === "FG") {
    return {
      launch_kind: "FINAL_ROLL" as LaunchKind,
      stock_purpose: "PRODUCT" as StockPurpose,
      stock_strategy: "FINAL_STOCK" as StockStrategy,
    }
  }
  if (output === "INVARIANT") {
    return {
      launch_kind: "SHARED_INVARIANT_ROLL" as LaunchKind,
      stock_purpose: "PRODUCT" as StockPurpose,
      stock_strategy: "INTERMEDIATE_POOL" as StockStrategy,
    }
  }
  if (output === "WIP") {
    return {
      launch_kind: "BASE_UPSTREAM_ROLL" as LaunchKind,
      stock_purpose: "PRODUCT" as StockPurpose,
      stock_strategy: "INTERMEDIATE_POOL" as StockStrategy,
    }
  }
  if (output === "POD") {
    return {
      launch_kind: "POD_STOCK" as LaunchKind,
      stock_purpose: "PRODUCT" as StockPurpose,
      stock_strategy: "FINAL_STOCK" as StockStrategy,
    }
  }
  return {
    launch_kind: "PACKAGING_STOCK" as LaunchKind,
    stock_purpose: "PACKAGING" as StockPurpose,
    stock_strategy: "PACKAGING_STOCK" as StockStrategy,
  }
}

function kindTone(kind?: string) {
  const normalized = String(kind || "").toUpperCase()
  if (normalized === "SHARED_INVARIANT_ROLL") return "border-blue-200 bg-blue-50 text-blue-700"
  if (normalized === "BASE_UPSTREAM_ROLL") return "border-amber-200 bg-amber-50 text-amber-700"
  if (normalized === "PACKAGING_STOCK") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (normalized === "POD_STOCK") return "border-sky-200 bg-sky-50 text-sky-700"
  return "border-slate-200 bg-slate-100 text-slate-700"
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parsePlannerSkuRange(value: string) {
  const raw = value.trim()
  if (!raw) return { min: null as number | null, max: null as number | null }
  const parts = raw.split(/[,-]/).map((part) => Number(part.trim())).filter(Number.isFinite)
  if (!parts.length) return { min: null, max: null }
  if (parts.length === 1) return { min: parts[0], max: parts[0] }
  return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) }
}

function plannerSkuNumberMatches(value: number | null | undefined, rangeText: string) {
  const { min, max } = parsePlannerSkuRange(rangeText)
  if (min === null && max === null) return true
  const num = Number(value)
  if (!Number.isFinite(num)) return false
  if (min !== null && max !== null && min === max) return Math.round(num) === Math.round(min)
  if (min !== null && num < min) return false
  if (max !== null && num > max) return false
  return true
}

function makePlannerSkuRangePresets(values: Array<number | null | undefined>, suffix: string) {
  const counts = new Map<number, number>()
  values.forEach((value) => {
    const num = Number(value)
    if (!Number.isFinite(num) || num <= 0) return
    const rounded = Math.round(num)
    counts.set(rounded, (counts.get(rounded) || 0) + 1)
  })
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, 10)
    .map(([value, count]) => ({ value: String(value), label: `${value} ${suffix}`, count }))
}

function uniquePlannerSkuText(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}

function makeLayer(): LayerDraft {
  return { family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0 }
}

function ensureLayerSlots(current: LayerDraft[], count: number, widthMm = 0) {
  const next = [...current]
  while (next.length < count) {
    next.push({ ...makeLayer(), roll_width_mm: widthMm > 0 ? widthMm : 0 })
  }
  return next
}

function makeAddon(): AddonDraft {
  return { addon_id: "", qty: 1, applies_to: "NONE" }
}

function makePackagingLine(): PackagingLineDraft {
  return { material_id: "", qty: 0, uom: "PCS", basis: "PER_ROLL" }
}

function derivePlannerStockClass(
  launchKind: LaunchKind,
  stockPurpose: StockPurpose,
  finishedGoodType: FgType,
): PlannerStockClass {
  if (stockPurpose === "PACKAGING" || launchKind === "PACKAGING_STOCK") return "PACKAGING_STOCK"
  if (launchKind === "SHARED_INVARIANT_ROLL") return "SHARED_INVARIANT_ROLL"
  if (launchKind === "BASE_UPSTREAM_ROLL") return "EXTRUDED_BASE_ROLL"
  if (finishedGoodType === "ROLL") return "FINAL_PLAIN_ROLL"
  return "FINAL_PRODUCT"
}

function emptyFamilyDraft(initial?: Partial<FamilyDraft>): FamilyDraft {
  return {
    id: initial?.id,
    code: initial?.code || "",
    name: initial?.name || "",
    template: initial?.template || "",
    default_plant: initial?.default_plant || "",
    notes: initial?.notes || "",
    active: initial?.active ?? true,
  }
}

function emptyVariantDraft(family?: PlannerSkuPreset | null): VariantDraft {
  return {
    code: "",
    name: "",
    active: true,
    launch_kind: "FINAL_ROLL",
    template: family?.template || "",
    default_plant: family?.default_plant || "",
    default_qty: 1000,
    quantity_uom: "PCS",
    stock_purpose: "PRODUCT",
    stock_strategy: "FINAL_STOCK",
    planner_stock_class: derivePlannerStockClass("FINAL_ROLL", "PRODUCT", "POUCH"),
    start_step_index: 0,
    stop_step_index: null,
    finished_good_type: "POUCH",
    roll_form: "FLAT",
    width_mm: 120,
    height_mm: 180,
    faces: 1,
    layer_snapshot: [makeLayer()],
    printing_enabled: false,
    printing_type: "FLEXO",
    substrate_mode: "SHEET",
    front_colors_count: 0,
    back_colors_count: 0,
    ink_gsm_total: 0,
    artwork_id: "",
    adhesive_gsm: 0,
    solvent_gsm: 0,
    addons_snapshot: [],
    primary_inner_pack_enabled: false,
    primary_inner_pack_material_id: "",
    primary_inner_pack_pcs: 100,
    roll_dispatch_pack_enabled: false,
    roll_dispatch_pack_lines: [],
    packaging_material: "",
    pod_sku_variant: "",
  }
}

function variantDraftFromPreset(preset: PlannerSkuVariantPreset): VariantDraft {
  const geometry = preset.geometry_snapshot || {}
  const base = geometry.base || geometry || {}
  const printing = preset.printing_snapshot || {}
  const chemicals = printing.chemicals || {}
  const packaging = preset.packaging_snapshot || {}
  return {
    id: preset.id,
    code: preset.code || "",
    name: preset.name || "",
    active: preset.active,
    launch_kind: preset.launch_kind,
    template: String(preset.template || ""),
    default_plant: String(preset.default_plant || ""),
    default_qty: asNumber(preset.default_qty, 0),
    quantity_uom: preset.quantity_uom,
    stock_purpose: preset.stock_purpose,
    stock_strategy: preset.stock_strategy,
    planner_stock_class: preset.planner_stock_class,
    start_step_index: asNumber(preset.start_step_index, 0),
    stop_step_index: preset.stop_step_index ?? null,
    finished_good_type: (String(geometry.finished_good_type || "POUCH").toUpperCase() as FgType),
    roll_form: (String(geometry.roll_form || "FLAT").toUpperCase() as RollForm),
    width_mm: asNumber(base.width_mm || geometry.width_mm, 0),
    height_mm: asNumber(base.height_mm || geometry.height_mm, 0),
    faces: asNumber(geometry?.multipliers?.faces, 1),
    layer_snapshot: Array.isArray(preset.layer_snapshot) && preset.layer_snapshot.length
      ? preset.layer_snapshot.map((layer: any) => ({
          family_id: String(layer.family_id || ""),
          variant_id: String(layer.variant_id || ""),
          thickness_micron: asNumber(layer.thickness_micron, 0),
          roll_width_mm: asNumber(layer.roll_width_mm || layer.width_mm, 0),
        }))
      : [makeLayer()],
    printing_enabled: Boolean(printing.enabled),
    printing_type: (String(printing.type || "FLEXO").toUpperCase() as VariantDraft["printing_type"]),
    substrate_mode: (String(printing.substrate_mode || "SHEET").toUpperCase() as VariantDraft["substrate_mode"]),
    front_colors_count: asNumber(printing.front_colors_count, 0),
    back_colors_count: String(printing.substrate_mode || "SHEET").toUpperCase() === "TUBING" ? asNumber(printing.back_colors_count, 0) : 0,
    ink_gsm_total: asNumber(printing.ink_gsm_total, 0),
    artwork_id: String(printing.artwork_id || ""),
    adhesive_gsm: asNumber(chemicals.adhesive_gsm, 0),
    solvent_gsm: asNumber(chemicals.solvent_gsm, 0),
    addons_snapshot: Array.isArray(preset.addons_snapshot)
      ? preset.addons_snapshot.map((addon: any) => ({
          addon_id: String(addon.addon_id || ""),
          qty: asNumber(addon.qty, 1),
          applies_to: (String(addon.applies_to || "NONE").toUpperCase() as AddonDraft["applies_to"]),
        }))
      : [],
    primary_inner_pack_enabled: Boolean(packaging.primary_inner_pack?.enabled),
    primary_inner_pack_material_id: String(packaging.primary_inner_pack?.material_id || ""),
    primary_inner_pack_pcs: asNumber(packaging.primary_inner_pack?.pcs_per_pack, 100),
    roll_dispatch_pack_enabled: Boolean(packaging.roll_dispatch_pack?.enabled),
    roll_dispatch_pack_lines: Array.isArray(packaging.roll_dispatch_pack?.lines)
      ? packaging.roll_dispatch_pack.lines.map((line: any) => ({
          material_id: String(line.material_id || ""),
          qty: asNumber(line.qty, 0),
          uom: (String(line.uom || "PCS").toUpperCase() as PackagingLineDraft["uom"]),
          basis: "PER_ROLL",
        }))
      : [],
    packaging_material: String(preset.packaging_material || ""),
    pod_sku_variant: String(preset.pod_sku_variant || ""),
  }
}

function buildVariantPayload(draft: VariantDraft, familyId: string) {
  const finishedGoodType = draft.finished_good_type
  const geometry = {
    base: {
      width_mm: finishedGoodType === "ROLL"
        ? asNumber(draft.layer_snapshot[0]?.roll_width_mm, 0)
        : asNumber(draft.width_mm, 0),
      height_mm: finishedGoodType === "POUCH" ? asNumber(draft.height_mm, 0) : 0,
    },
    adjustments: [],
    multipliers: { faces: Math.max(1, asNumber(draft.faces, 1)) },
    finished_good_type: finishedGoodType,
    roll_form: finishedGoodType === "ROLL" ? draft.roll_form : undefined,
  }
  const layerSnapshot = draft.layer_snapshot
    .filter((layer) => layer.family_id && layer.variant_id)
    .map((layer) => ({
      family_id: layer.family_id,
      variant_id: layer.variant_id,
      thickness_micron: asNumber(layer.thickness_micron, 0),
      roll_width_mm: asNumber(layer.roll_width_mm, 0),
    }))
  const printing = draft.printing_enabled
    ? {
        enabled: true,
        type: draft.printing_type,
        substrate_mode: draft.substrate_mode,
        front_colors_count: asNumber(draft.front_colors_count, 0),
        back_colors_count: draft.substrate_mode === "TUBING" ? asNumber(draft.back_colors_count, 0) : 0,
        ink_gsm_total: asNumber(draft.ink_gsm_total, 0),
        artwork_id: draft.artwork_id || null,
        chemicals: {
          adhesive_gsm: asNumber(draft.adhesive_gsm, 0),
          solvent_gsm: asNumber(draft.solvent_gsm, 0),
        },
      }
    : { enabled: false }
  const addons = draft.addons_snapshot
    .filter((addon) => addon.addon_id)
    .map((addon) => ({
      addon_id: addon.addon_id,
      qty: asNumber(addon.qty, 0),
      applies_to: addon.applies_to,
    }))
  const packaging_snapshot = {
    primary_inner_pack: {
      enabled: draft.primary_inner_pack_enabled,
      material_id: draft.primary_inner_pack_enabled ? draft.primary_inner_pack_material_id || null : null,
      pcs_per_pack: draft.primary_inner_pack_enabled ? asNumber(draft.primary_inner_pack_pcs, 100) : 0,
    },
    roll_dispatch_pack: {
      enabled: draft.roll_dispatch_pack_enabled,
      lines: draft.roll_dispatch_pack_enabled
        ? draft.roll_dispatch_pack_lines
            .filter((line) => line.material_id)
            .map((line) => ({
              material_id: line.material_id,
              qty: asNumber(line.qty, 0),
              uom: line.uom,
              basis: "PER_ROLL",
            }))
        : [],
    },
  }

  return {
    sku: familyId,
    code: draft.code.trim().toUpperCase(),
    name: draft.name.trim(),
    active: draft.active,
    launch_kind: draft.launch_kind,
    template: draft.template || null,
    default_plant: draft.default_plant || null,
    default_qty: asNumber(draft.default_qty, 0),
    quantity_uom: draft.quantity_uom,
    stock_purpose: draft.stock_purpose,
    stock_strategy: draft.stock_strategy,
    planner_stock_class: draft.planner_stock_class,
    start_step_index: asNumber(draft.start_step_index, 0),
    stop_step_index: draft.stop_step_index === null || draft.stop_step_index === undefined ? null : asNumber(draft.stop_step_index, 0),
    geometry_snapshot: geometry,
    layer_snapshot: layerSnapshot,
    printing_snapshot: printing,
    addons_snapshot: addons,
    packaging_snapshot,
    packaging_material: draft.stock_purpose === "PACKAGING" ? draft.packaging_material || null : null,
    pod_sku_variant: draft.launch_kind === "POD_STOCK" ? draft.pod_sku_variant || null : null,
    planner_origin_meta: {
      source_lane: "PLANNER_SKU_STUDIO",
      launch_kind: draft.launch_kind,
    },
  }
}

export default function PlannerSkuCatalogPage() {
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [search, setSearch] = useState("")
  const [launchFilter, setLaunchFilter] = useState<string>("ALL")
  const [materialFilter, setMaterialFilter] = useState("")
  const [gradeFilter, setGradeFilter] = useState("")
  const [widthFilter, setWidthFilter] = useState("")
  const [heightFilter, setHeightFilter] = useState("")
  const [thicknessFilter, setThicknessFilter] = useState("")
  const [selectedSkuId, setSelectedSkuId] = useState("")
  const [familyDialogOpen, setFamilyDialogOpen] = useState(false)
  const [familyDraft, setFamilyDraft] = useState<FamilyDraft>(emptyFamilyDraft())
  const [variantDialogOpen, setVariantDialogOpen] = useState(false)
  const [variantDraft, setVariantDraft] = useState<VariantDraft>(emptyVariantDraft(null))
  const [editingVariant, setEditingVariant] = useState<PlannerSkuVariantPreset | null>(null)
  const [queryVariantDialogOpened, setQueryVariantDialogOpened] = useState(false)
  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  const skuQuery = useQuery({
    queryKey: ["planner-skus", "catalog"],
    queryFn: () => plannerService.getPlannerSkus({ active: true }),
    staleTime: 60_000,
  })
  const templatesQuery = useQuery({
    queryKey: ["planner-sku-catalog-templates"],
    queryFn: async () => {
      const { data } = await api.get("/api/templates/")
      return Array.isArray(data) ? data : []
    },
    staleTime: 60_000,
  })
  const plantsQuery = useQuery({
    queryKey: ["planner-sku-catalog-plants"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/plants/")
      return Array.isArray(data) ? data : []
    },
    staleTime: 60_000,
  })
  const familiesQuery = useQuery({ queryKey: ["planner-sku-catalog-families"], queryFn: masterDataService.getFilmFamilies, staleTime: 60_000 })
  const variantsQuery = useQuery({ queryKey: ["planner-sku-catalog-variants"], queryFn: masterDataService.getFilmVariants, staleTime: 60_000 })
  const addonsQuery = useQuery({ queryKey: ["planner-sku-catalog-addons"], queryFn: masterDataService.getAddons, staleTime: 60_000 })
  const packagingQuery = useQuery({ queryKey: ["planner-sku-catalog-packaging"], queryFn: masterDataService.getPackaging, staleTime: 60_000 })
  const gradesQuery = useQuery({ queryKey: ["recipe-grades"], queryFn: () => recipeService.getGrades(), staleTime: 60_000 })
  const podQuery = useQuery({
    queryKey: ["planner-sku-catalog-pod"],
    queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
    staleTime: 60_000,
  })
  const routeStepsQuery = useQuery({
    queryKey: ["planner-sku-catalog-route-steps", variantDraft.template],
    queryFn: () => plannerService.getRouteSteps(variantDraft.template),
    enabled: Boolean(variantDraft.template),
  })

  const plannerSkus = Array.isArray(skuQuery.data) ? skuQuery.data : []
  const templates = Array.isArray(templatesQuery.data) ? templatesQuery.data : []
  const plants = Array.isArray(plantsQuery.data) ? plantsQuery.data : []
  const filmFamilies = Array.isArray(familiesQuery.data) ? familiesQuery.data : []
  const filmVariants = Array.isArray(variantsQuery.data) ? variantsQuery.data : []
  const masterGrades = Array.isArray(gradesQuery.data) ? gradesQuery.data : []
  const addonsMaster = Array.isArray(addonsQuery.data) ? addonsQuery.data : []
  const packagingMaterials = Array.isArray(packagingQuery.data) ? packagingQuery.data : []
  const podSkuVariants = Array.isArray(podQuery.data) ? podQuery.data : []
  const routeSteps = Array.isArray(routeStepsQuery.data) ? routeStepsQuery.data : []

  const launchKindOptions = useMemo<SalesOverflowChipOption[]>(() => {
    const kinds = ["FINAL_ROLL", "SHARED_INVARIANT_ROLL", "BASE_UPSTREAM_ROLL", "PACKAGING_STOCK", "POD_STOCK"] as const
    return kinds.map((kind) => ({
      value: kind,
      label: outputClassLabel(outputClassForLaunchKind(kind)),
      count: plannerSkus.reduce((sum, sku) => sum + (sku.variants || []).filter((variant) => variant.launch_kind === kind).length, 0),
      tone: kind === "FINAL_ROLL"
        ? "fgRoll"
        : kind === "SHARED_INVARIANT_ROLL"
          ? "template"
          : kind === "BASE_UPSTREAM_ROLL"
            ? "fgPouch"
            : kind === "PACKAGING_STOCK"
              ? "pack"
              : "material",
    }))
  }, [plannerSkus])
  const filmFamilyById = useMemo(
    () => new Map(filmFamilies.map((family: any) => [String(family.id), family])),
    [filmFamilies]
  )
  const filmVariantById = useMemo(
    () => new Map(filmVariants.map((variant: any) => [String(variant.id), variant])),
    [filmVariants]
  )
  const plannerVariantLens = useMemo(() => (
    plannerSkus.flatMap((sku) =>
      (sku.variants || []).map((variant) => {
        const geometry = variant.geometry_snapshot || {}
        const layers = Array.isArray(variant.layer_snapshot) ? variant.layer_snapshot : []
        const layerMaterials = layers.flatMap((layer: any) => {
          const family = filmFamilyById.get(String(layer.family_id || ""))
          const filmVariant = filmVariantById.get(String(layer.variant_id || ""))
          return [
            layer.family_name,
            layer.variant_name,
            (family as any)?.name,
            (family as any)?.code,
            (filmVariant as any)?.name,
            (filmVariant as any)?.code,
          ]
        })
        const grades = layers.flatMap((layer: any) => {
          const filmVariant = filmVariantById.get(String(layer.variant_id || ""))
          return [
            layer.grade,
            layer.grade_name,
            (filmVariant as any)?.grade,
            (filmVariant as any)?.grade_name,
            (filmVariant as any)?.grade_display_name,
          ]
        })
        const widths = [
          asNumber((variant as any).width_mm || geometry.width_mm, 0),
          ...layers.map((layer: any) => asNumber(layer.roll_width_mm || layer.width_mm, 0)),
        ].filter((value) => value > 0)
        const heights = [asNumber((variant as any).height_mm || geometry.height_mm, 0)].filter((value) => value > 0)
        const thicknesses = layers.map((layer: any) => asNumber(layer.thickness_micron, 0)).filter((value) => value > 0)
        const searchText = [
          sku.code,
          sku.name,
          sku.template_name,
          variant.code,
          variant.name,
          variant.template_name,
          variant.planner_stock_class,
          variant.launch_kind,
          geometry.roll_form,
          ...layerMaterials,
          ...grades,
          ...widths.map((value) => `${value}mm`),
          ...heights.map((value) => `${value}mm`),
          ...thicknesses.map((value) => `${value}u`),
        ].filter(Boolean).join(" ").toLowerCase()
        return { sku, variant, layerMaterials: uniquePlannerSkuText(layerMaterials as any), grades: uniquePlannerSkuText(grades as any), widths, heights, thicknesses, searchText }
      })
    )
  ), [filmFamilyById, filmVariantById, plannerSkus])
  const plannerVariantLensById = useMemo(
    () => new Map(plannerVariantLens.map((entry) => [String(entry.variant.id), entry])),
    [plannerVariantLens]
  )
  const materialOptions = useMemo<SalesOverflowChipOption[]>(() => {
    const labels = salesUniqueText([
      ...SALES_MATERIAL_PRIORITY,
      ...filmFamilies.flatMap((family: any) => [family?.code, family?.name]),
      ...filmVariants.flatMap((variant: any) => [variant?.family_code, variant?.family_name, variant?.parent_family_name]),
      ...plannerVariantLens.flatMap((entry) => entry.layerMaterials.map(salesMaterialFilterLabel)),
    ])
      .map(salesMaterialFilterLabel)
      .filter((label) => label && !/^LAYER\s+\d+$/i.test(label) && !/^L\d+$/i.test(label))
    return salesSortChipOptions(
      salesUniqueText(labels).map((material) => ({
        value: material,
        label: material,
        count: plannerVariantLens.filter((entry) => {
          const normalized = salesMaterialFilterLabel(material).toLowerCase()
          return entry.layerMaterials.map((label) => salesMaterialFilterLabel(label).toLowerCase()).includes(normalized)
        }).length,
        tone: "material" as const,
      })),
      SALES_MATERIAL_PRIORITY
    )
  }, [filmFamilies, filmVariants, plannerVariantLens])
  const gradeOptions = useMemo<SalesOverflowChipOption[]>(() => (
    salesSortChipOptions(
      uniquePlannerSkuText([
        ...SALES_GRADE_PRIORITY,
        ...masterGrades.map((grade: any) => grade?.name || grade?.code),
        ...plannerVariantLens.flatMap((entry) => entry.grades),
      ])
        .map((grade) => ({
        value: grade,
        label: grade,
        count: plannerVariantLens.filter((entry) => entry.grades.some((value) => value.toLowerCase().includes(grade.toLowerCase()))).length,
        tone: "grade" as const,
      })),
      SALES_GRADE_PRIORITY
    )
  ), [masterGrades, plannerVariantLens])
  const widthPresets = useMemo(() => makePlannerSkuRangePresets(plannerVariantLens.flatMap((entry) => entry.widths), "mm"), [plannerVariantLens])
  const heightPresets = useMemo(() => makePlannerSkuRangePresets(plannerVariantLens.flatMap((entry) => entry.heights), "mm"), [plannerVariantLens])
  const thicknessPresets = useMemo(() => makePlannerSkuRangePresets(plannerVariantLens.flatMap((entry) => entry.thicknesses), "μ"), [plannerVariantLens])

  function plannerVariantPassesFilters(variant: PlannerSkuVariantPreset) {
    const lens = plannerVariantLensById.get(String(variant.id))
    if (!lens) return true
    if (materialFilter && !lens.layerMaterials.map((label) => salesMaterialFilterLabel(label).toLowerCase()).includes(salesMaterialFilterLabel(materialFilter).toLowerCase())) return false
    if (gradeFilter && !lens.grades.some((value) => value.toLowerCase().includes(gradeFilter.toLowerCase()))) return false
    if (widthFilter && !lens.widths.some((value) => plannerSkuNumberMatches(value, widthFilter))) return false
    if (heightFilter && !lens.heights.some((value) => plannerSkuNumberMatches(value, heightFilter))) return false
    if (thicknessFilter && !lens.thicknesses.some((value) => plannerSkuNumberMatches(value, thicknessFilter))) return false
    return true
  }

  const plannerSkuSavedFilters: SalesSavedViewFilters = {
    search,
    launchFilter,
    materialFilter,
    gradeFilter,
    widthFilter,
    heightFilter,
    thicknessFilter,
  }

  function applyPlannerSkuSavedFilters(filters: SalesSavedViewFilters) {
    setSearch(String(filters.search || ""))
    setLaunchFilter(String(filters.launchFilter || "ALL"))
    setMaterialFilter(String(filters.materialFilter || ""))
    setGradeFilter(String(filters.gradeFilter || ""))
    setWidthFilter(String(filters.widthFilter || ""))
    setHeightFilter(String(filters.heightFilter || ""))
    setThicknessFilter(String(filters.thicknessFilter || ""))
  }

  const filteredSkus = useMemo(() => {
    return plannerSkus.filter((sku) => {
      const variantMatches = (sku.variants || []).filter((variant) => {
        if (launchFilter !== "ALL" && String(variant.launch_kind || "") !== launchFilter) return false
        if (!plannerVariantPassesFilters(variant)) return false
        if (!deferredSearch) return true
        return [variant.code, variant.name, variant.template_name, variant.planner_stock_class]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(deferredSearch))
      })
      if (launchFilter !== "ALL" && variantMatches.length === 0) return false
      if (!deferredSearch) return true
      return [sku.code, sku.name, sku.template_name, ...(sku.variants || []).flatMap((variant) => [variant.code, variant.name])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(deferredSearch))
    })
  }, [deferredSearch, gradeFilter, heightFilter, launchFilter, materialFilter, plannerSkus, plannerVariantLensById, thicknessFilter, widthFilter])

  useEffect(() => {
    if (!filteredSkus.length) {
      setSelectedSkuId("")
      return
    }
    if (!selectedSkuId || !filteredSkus.some((sku) => String(sku.id) === String(selectedSkuId))) {
      setSelectedSkuId(String(filteredSkus[0].id))
    }
  }, [filteredSkus, selectedSkuId])

  const selectedSku = filteredSkus.find((sku) => String(sku.id) === String(selectedSkuId)) || null
  const selectedVariants = useMemo(() => {
    const variants = selectedSku?.variants || []
    return variants.filter((variant) => {
      if (launchFilter !== "ALL" && String(variant.launch_kind || "") !== launchFilter) return false
      return plannerVariantPassesFilters(variant)
    })
  }, [gradeFilter, heightFilter, launchFilter, materialFilter, plannerVariantLensById, selectedSku, thicknessFilter, widthFilter])

  useEffect(() => {
    if (!variantDraft.template || !routeSteps.length) return
    const routeLastIndex = routeSteps[routeSteps.length - 1]?.index ?? 0
    const normalizedStop = variantDraft.stop_step_index === null || variantDraft.stop_step_index === undefined
      ? routeLastIndex
      : Math.min(Number(variantDraft.stop_step_index), routeLastIndex)
    if (normalizedStop !== variantDraft.stop_step_index) {
      setVariantDraft((current) => ({ ...current, stop_step_index: normalizedStop }))
    }
  }, [routeSteps, variantDraft.stop_step_index, variantDraft.template])

  const familyMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        code: familyDraft.code.trim().toUpperCase(),
        name: familyDraft.name.trim(),
        template: familyDraft.template,
        default_plant: familyDraft.default_plant || null,
        notes: familyDraft.notes.trim(),
        active: familyDraft.active,
      }
      if (familyDraft.id) return plannerService.updatePlannerSku(familyDraft.id, payload)
      return plannerService.createPlannerSku(payload)
    },
    onSuccess: async (sku) => {
      await queryClient.invalidateQueries({ queryKey: ["planner-skus", "catalog"] })
      setFamilyDialogOpen(false)
      setFamilyDraft(emptyFamilyDraft())
      setSelectedSkuId(String(sku.id))
      toast({
        title: familyDraft.id ? "Planner family updated" : "Planner family created",
        description: `${sku.code} is ready for reusable planner variants.`,
      })
    },
    onError: (error: any) => {
      toast({
        title: "Planner family could not be saved",
        description: String(error?.response?.data?.detail || error?.response?.data?.code?.[0] || error?.message || "Try again."),
        variant: "destructive",
      })
    },
  })

  const variantMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSku) throw new Error("Select a planner family first.")
      const payload = buildVariantPayload(variantDraft, selectedSku.id)
      if (variantDraft.id) return plannerService.updatePlannerSkuVariant(variantDraft.id, payload)
      return plannerService.createPlannerSkuVariant(payload)
    },
    onSuccess: async (variant) => {
      await queryClient.invalidateQueries({ queryKey: ["planner-skus", "catalog"] })
      setVariantDialogOpen(false)
      setEditingVariant(null)
      toast({
        title: variantDraft.id ? "Planner variant updated" : "Planner variant created",
        description: `${variant.code} is ready to launch from the planner stock studio.`,
      })
    },
    onError: (error: any) => {
      toast({
        title: "Planner variant could not be saved",
        description: String(error?.response?.data?.detail || error?.response?.data?.code?.[0] || error?.message || "Try again."),
        variant: "destructive",
      })
    },
  })

  function openFamilyDialog(sku?: PlannerSkuPreset | null) {
    setFamilyDraft(emptyFamilyDraft(sku ? {
      id: sku.id,
      code: sku.code,
      name: sku.name,
      template: sku.template,
      default_plant: sku.default_plant || "",
      notes: sku.notes || "",
      active: sku.active,
    } : undefined))
    setFamilyDialogOpen(true)
  }

  function openVariantSheet(variant?: PlannerSkuVariantPreset | null) {
    setEditingVariant(variant || null)
    setVariantDraft(variant ? variantDraftFromPreset(variant) : emptyVariantDraft(selectedSku))
    setVariantDialogOpen(true)
  }

  useEffect(() => {
    if (queryVariantDialogOpened) return
    if (searchParams?.get("create_variant") !== "1") return
    if (!selectedSku) return
    setQueryVariantDialogOpened(true)
    openVariantSheet(null)
  }, [queryVariantDialogOpened, searchParams, selectedSku])

  function patchVariant(patch: Partial<VariantDraft>) {
    setVariantDraft((current) => ({ ...current, ...patch }))
  }

  function syncOutputClass(nextOutput: PlannerOutputClass) {
    setVariantDraft((current) => {
      const nextState = plannerUiStateForOutput(nextOutput)
      const nextFinishedGoodType = current.finished_good_type
      const widthSeed = nextFinishedGoodType === "ROLL"
        ? asNumber(current.layer_snapshot[0]?.roll_width_mm || current.width_mm, 0)
        : asNumber(current.width_mm, 0)
      const nextQuantityUom: QuantityUom =
        nextOutput === "POD"
          ? "KG"
          : current.quantity_uom
      return {
        ...current,
        launch_kind: nextState.launch_kind,
        stock_purpose: nextState.stock_purpose,
        finished_good_type: nextFinishedGoodType,
        quantity_uom: nextQuantityUom,
        stock_strategy: nextState.stock_strategy,
        planner_stock_class: derivePlannerStockClass(nextState.launch_kind, nextState.stock_purpose, nextFinishedGoodType),
        roll_form: nextFinishedGoodType === "ROLL" ? current.roll_form || "FLAT" : "FLAT",
        layer_snapshot: ensureLayerSlots(current.layer_snapshot, 1, widthSeed),
        packaging_material: nextOutput === "PACKAGING" ? current.packaging_material : "",
        pod_sku_variant: nextOutput === "POD" ? current.pod_sku_variant : "",
      }
    })
  }

  function syncFinishedGoodType(nextType: FgType) {
    setVariantDraft((current) => ({
      ...current,
      finished_good_type: nextType,
      quantity_uom: current.stock_purpose === "PACKAGING" ? current.quantity_uom : nextType === "ROLL" ? "KG" : "PCS",
      planner_stock_class: derivePlannerStockClass(current.launch_kind, current.stock_purpose, nextType),
    }))
  }

  const routeLastIndex = routeSteps.length ? routeSteps[routeSteps.length - 1]?.index ?? 0 : 0
  const selectedFamilyTemplate = templates.find((template: any) => String(template.id) === String(selectedSku?.template || ""))
  const variantTemplate = templates.find((template: any) => String(template.id) === String(variantDraft.template || ""))
  const variantOutputClass = outputClassForLaunchKind(variantDraft.launch_kind)
  const requiredLayerCount = 1
  const validLayerCount = variantDraft.layer_snapshot.filter((layer) => layer.family_id && layer.variant_id).length

  if (skuQuery.isLoading) {
    return (
      <div className={styles.shell} data-testid="planner-sku-catalog-page">
        <section className={styles.pageHeader}>
          <div className={styles.headerCopy}>
            <div className={styles.eyebrow}>
              <Sparkles className="h-3.5 w-3.5" />
              Production / Planner
            </div>
            <h1 className={styles.title}>Planner SKU Studio</h1>
          </div>
        </section>
        <div className={styles.emptyWorkspace}>Loading planner SKU studio…</div>
      </div>
    )
  }

  if (skuQuery.isError) {
    return (
      <div className={styles.shell} data-testid="planner-sku-catalog-page">
        <section className={styles.pageHeader}>
          <div className={styles.headerCopy}>
            <div className={styles.eyebrow}>
              <Sparkles className="h-3.5 w-3.5" />
              Production / Planner
            </div>
            <h1 className={styles.title}>Planner SKU Studio</h1>
          </div>
        </section>
        <div className={styles.emptyWorkspace}>Failed to load planner SKU families.</div>
      </div>
    )
  }

  return (
    <div className={styles.shell} data-testid="planner-sku-catalog-page">
      <section className={styles.pageHeader}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrow}>
            <Sparkles className="h-3.5 w-3.5" />
            Production / Planner
          </div>
          <h1 className={styles.title}>Planner SKU Studio</h1>
          <p className={styles.description}>
            Build reusable planner families and launch-ready presets for final stock, shared invariant rolls, upstream base rolls, POD stock, and packaging stock.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/production/planner">Open Control Tower</Link>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/production/planner/stock-orders/create">Open Stock Launcher</Link>
          </Button>
          <Button variant="outline" className="rounded-full" onClick={() => openFamilyDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Create Family
          </Button>
          <Button className="rounded-full bg-slate-950 text-white hover:bg-slate-800" onClick={() => openVariantSheet()}>
            <Workflow className="mr-2 h-4 w-4" />
            New Variant
          </Button>
        </div>
      </section>

      <section className={styles.kpiStrip}>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Families</div>
          <div className={styles.kpiValue}>{plannerSkus.length}</div>
        </div>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Launch presets</div>
          <div className={styles.kpiValue}>{plannerSkus.reduce((sum, sku) => sum + (sku.variants?.length || 0), 0)}</div>
        </div>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Selected template</div>
          <div className={styles.kpiValueSm}>{selectedFamilyTemplate?.name || "Choose a family"}</div>
        </div>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Filtered mode</div>
          <div className={styles.kpiValueSm}>{launchFilter === "ALL" ? "All launch kinds" : launchKindLabel[launchFilter] || launchFilter}</div>
        </div>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Visible families</div>
          <div className={styles.kpiValue}>{filteredSkus.length}</div>
        </div>
        <div className={styles.kpiChip}>
          <div className={styles.kpiLabel}>Visible presets</div>
          <div className={styles.kpiValue}>{filteredSkus.reduce((sum, sku) => sum + (sku.variants?.length || 0), 0)}</div>
        </div>
      </section>

      <SalesSavedViewsBar
        scope="planner_sku"
        currentFilters={plannerSkuSavedFilters}
        onApply={applyPlannerSkuSavedFilters}
        viewCounts={{
          "Active presets": plannerSkus.reduce((sum, sku) => sum + (sku.variants?.length || 0), 0),
          "Final roll / pouch": launchKindOptions.find((option) => option.value === "FINAL_ROLL")?.count || 0,
          "Invariant rolls": launchKindOptions.find((option) => option.value === "SHARED_INVARIANT_ROLL")?.count || 0,
          "POD stock": launchKindOptions.find((option) => option.value === "POD_STOCK")?.count || 0,
          "Packaging stock": launchKindOptions.find((option) => option.value === "PACKAGING_STOCK")?.count || 0,
        }}
      />

      <section className="rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.35)]">
        <div className="mb-3 grid gap-3 xl:grid-cols-[minmax(18rem,1fr)_auto] xl:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10 text-sm font-semibold"
              placeholder="Search family, preset, template, material, grade..."
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-full bg-white px-5 text-xs font-black uppercase tracking-[0.12em]"
            onClick={() => {
              setSearch("")
              setLaunchFilter("ALL")
              setMaterialFilter("")
              setGradeFilter("")
              setWidthFilter("")
              setHeightFilter("")
              setThicknessFilter("")
            }}
          >
            Reset spec filters
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
          <SalesSmartRangeFilter label="Width" value={widthFilter} onChange={setWidthFilter} placeholder="440 / 1070" suffix="mm" presets={widthPresets} />
          <SalesSmartRangeFilter label="Height" value={heightFilter} onChange={setHeightFilter} placeholder="200-320" suffix="mm" presets={heightPresets} />
          <SalesSmartRangeFilter label="Thickness" value={thicknessFilter} onChange={setThicknessFilter} placeholder="20-80" suffix="μ" presets={thicknessPresets} />
          <SalesOverflowChipGroup label="Material" value={materialFilter} onChange={setMaterialFilter} options={materialOptions} maxInline={4} allValue="" />
          <SalesOverflowChipGroup label="Grade" value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} maxInline={4} allValue="" />
          <SalesOverflowChipGroup
            label="Launch kind"
            value={launchFilter}
            onChange={setLaunchFilter}
            allValue="ALL"
            options={launchKindOptions}
            maxInline={3}
          />
        </div>
      </section>

      <section className={styles.layoutGrid}>
        <aside className={styles.skuRail}>
          <div className={styles.railHeader}>
            <div className={styles.sectionEyebrow}>
              <Package className="h-3.5 w-3.5" />
              Planner families
            </div>
          </div>
          <div className={styles.railSearchNote}>Use the command filters above, then pick a family here.</div>
          <ScrollArea className={styles.railScroll}>
            <div className={styles.skuList}>
              {filteredSkus.map((sku) => {
                const active = String(sku.id) === String(selectedSkuId)
                return (
                  <button
                    key={sku.id}
                    type="button"
                    onClick={() => setSelectedSkuId(String(sku.id))}
                    className={cn(styles.skuCard, active && styles.skuCardActive)}
                  >
                    <div className={styles.skuCardMeta}>{sku.template_name || "Planner family"}</div>
                    <div className={styles.skuCardCode}>{sku.code}</div>
                    <div className={styles.skuCardName}>{sku.name}</div>
                    <div className={styles.skuCardFooter}>
                      <span>{sku.variants?.length || 0} presets</span>
                      <span>{sku.default_plant_name || "Multi-plant"}</span>
                    </div>
                  </button>
                )
              })}
              {!filteredSkus.length ? (
                <div className={styles.emptyState}>
                  No planner families match this view. Clear the search or save a narrower view after changing the launch filter.
                </div>
              ) : null}
            </div>
          </ScrollArea>
        </aside>

        <main className={styles.workspace}>
          {selectedSku ? (
            <>
              <section className={styles.familyHeader}>
                <div className={styles.familyCopy}>
                  <div className={styles.sectionEyebrow}>Selected family</div>
                  <h2 className={styles.familyTitle}>{selectedSku.code}</h2>
                  <p className={styles.familyDescription}>{selectedSku.name}</p>
                </div>
                <div className={styles.familyMeta}>
                  <div className={styles.metaBlock}>
                    <div className={styles.metaLabel}>Template</div>
                    <div className={styles.metaValue}>{selectedSku.template_name || "No template"}</div>
                  </div>
                  <div className={styles.metaBlock}>
                    <div className={styles.metaLabel}>Default plant</div>
                    <div className={styles.metaValue}>{selectedSku.default_plant_name || "Auto plant"}</div>
                  </div>
                  <div className={styles.metaActions}>
                    <div className={styles.familyActionRow}>
                      <Button variant="outline" className="rounded-full" onClick={() => openFamilyDialog(selectedSku)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit family
                      </Button>
                      <Button className="rounded-full bg-slate-950 text-white hover:bg-slate-800" onClick={() => openVariantSheet()}>
                        <Plus className="mr-2 h-4 w-4" />
                        New variant
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.variantSection}>
                <div className={styles.variantSectionHeader}>
                  <div>
                    <div className={styles.sectionEyebrow}>Launchable presets</div>
                    <h3 className={styles.sectionTitle}>Planner Variants</h3>
                    <p className={styles.variantHint}>
                      Each preset stores the exact route, geometry, layers, printing, add-ons, and packaging/POD inputs required to launch stock fast without rebuilding the manufacturing definition every time.
                    </p>
                  </div>
                </div>
                <div className={styles.variantGrid}>
                  {selectedVariants.map((variant) => (
                    <div key={variant.id} className={styles.variantCard}>
                      <div className={styles.variantTopRow}>
                        <div>
                          <div className={cn(styles.kindPill, kindTone(variant.launch_kind))}>
                            {outputClassLabel(outputClassForLaunchKind(variant.launch_kind))}
                          </div>
                          <div className={styles.variantCode}>{variant.code}</div>
                          <div className={styles.variantName}>{variant.name}</div>
                        </div>
                        <Badge variant="outline" className="bg-white">
                          {variant.default_qty} {variant.quantity_uom}
                        </Badge>
                      </div>
                      <div className={styles.variantStats}>
                        <div className={styles.variantStat}>
                          <span>Planner class</span>
                          <strong>{variant.planner_stock_class.replaceAll("_", " ")}</strong>
                        </div>
                        <div className={styles.variantStat}>
                          <span>Route stop</span>
                          <strong>Step {variant.stop_step_index ?? "final"}</strong>
                        </div>
                        <div className={styles.variantStat}>
                          <span>Spec depth</span>
                          <strong>
                            {Array.isArray(variant.layer_snapshot) ? variant.layer_snapshot.length : 0} layer
                            {Array.isArray(variant.layer_snapshot) && variant.layer_snapshot.length === 1 ? "" : "s"}
                          </strong>
                        </div>
                        <div className={styles.variantStat}>
                          <span>Packaging / POD</span>
                          <strong>
                            {variant.packaging_material_name
                              ? "Packaging"
                              : variant.pod_sku_variant_name
                                ? "POD"
                                : variant.packaging_snapshot?.primary_inner_pack?.enabled || variant.packaging_snapshot?.roll_dispatch_pack?.enabled
                                  ? "Dispatch pack"
                                  : "None"}
                          </strong>
                        </div>
                      </div>
                      <div className={styles.variantFooterRow}>
                        <Button variant="outline" className="rounded-full" onClick={() => openVariantSheet(variant)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                        <Button asChild className="rounded-full bg-blue-600 text-white hover:bg-blue-500">
                          <Link href={`/production/planner/stock-orders/create?preset=${variant.id}`}>
                            Launch
                            <ArrowRight className="ml-2 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                {!selectedVariants.length ? (
                  <div className={styles.emptyWorkspace}>No presets match the current filter for this family.</div>
                ) : null}
              </section>
            </>
          ) : (
            <section className={styles.emptyWorkspace}>
              Select a planner SKU family to author or launch its presets.
            </section>
          )}
        </main>
      </section>

      <Dialog open={familyDialogOpen} onOpenChange={setFamilyDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{familyDraft.id ? "Edit Planner Family" : "Create Planner Family"}</DialogTitle>
            <DialogDescription>
              Planner families group reusable internal presets for invariant, upstream, POD, packaging, and repeat finished stock flows.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.createGrid}>
            <div>
              <Label>Planner family code</Label>
              <Input value={familyDraft.code} onChange={(event) => setFamilyDraft((current) => ({ ...current, code: event.target.value }))} placeholder="INV-ROLL-CORE" />
            </div>
            <div>
              <Label>Family name</Label>
              <Input value={familyDraft.name} onChange={(event) => setFamilyDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Shared Invariant Roll" />
            </div>
            <div>
              <Label>Template</Label>
              <Select value={familyDraft.template} onValueChange={(value) => setFamilyDraft((current) => ({ ...current, template: value }))}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((template: any) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default plant</Label>
              <Select value={familyDraft.default_plant || "NONE"} onValueChange={(value) => setFamilyDraft((current) => ({ ...current, default_plant: value === "NONE" ? "" : value }))}>
                <SelectTrigger><SelectValue placeholder="Auto plant" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Auto plant</SelectItem>
                  {plants.map((plant: any) => (
                    <SelectItem key={plant.id} value={String(plant.id)}>
                      {plant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={styles.createNotes}>
              <Label>Planner note</Label>
              <Textarea value={familyDraft.notes} onChange={(event) => setFamilyDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Reusable family for invariant, packaging, POD, or repeat internal replenishment." />
            </div>
            <div className={styles.inlineSwitchRow}>
              <div>
                <div className={styles.metaLabel}>Active</div>
                <div className={styles.inlineHint}>Inactive families stay historical but disappear from fast launcher selection.</div>
              </div>
              <Switch checked={familyDraft.active} onCheckedChange={(checked) => setFamilyDraft((current) => ({ ...current, active: checked }))} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <div className={styles.dialogHint}>
              Family metadata stays lean. Author the actual production preset on the next step using <strong>planner variants</strong>.
            </div>
            <Button
              onClick={() => familyMutation.mutate()}
              disabled={!familyDraft.code.trim() || !familyDraft.name.trim() || !familyDraft.template || familyMutation.isPending}
              className="rounded-full bg-slate-950 text-white hover:bg-slate-800"
            >
              {familyMutation.isPending ? "Saving..." : familyDraft.id ? "Save Family" : "Create Family"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={variantDialogOpen} onOpenChange={setVariantDialogOpen}>
        <DialogContent data-testid="planner-variant-builder" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border bg-[linear-gradient(180deg,#fbfbfd_0%,#f5f7fb_100%)] p-0 sm:h-auto sm:max-h-[96vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(46rem,calc(100vw-1rem))] sm:rounded-[2rem]">
          <div className={styles.sheetShell}>
            <DialogHeader className="sr-only">
              <DialogTitle>{editingVariant ? "Edit Planner Variant" : "Create Planner Variant"}</DialogTitle>
              <DialogDescription>
                Build a launch-ready planner preset with the same route, geometry, material stack, printing, add-ons, packaging, and POD detail required to manufacture it correctly.
              </DialogDescription>
            </DialogHeader>

            <section className={styles.variantHero}>
              <div className={styles.variantHeroCopy}>
                <div className={styles.sectionEyebrow}>{editingVariant ? "Edit planner preset" : "New planner preset"}</div>
                <h3>{variantDraft.code || "Preset code"} • {variantDraft.name || "Preset name"}</h3>
                <p>
                  Route-aware stock recipe with the exact geometry, film layers, printing, chemistry, add-ons, packaging, and POD rules needed before release.
                </p>
                <div className={styles.summaryRibbon}>
                  <span>{outputClassLabel(variantOutputClass)}</span>
                  <span>{variantDraft.finished_good_type === "ROLL" ? `${variantDraft.roll_form} roll` : "Pouch output"}</span>
                  <span>{validLayerCount}/{requiredLayerCount} layers ready</span>
                  <span>{variantDraft.printing_enabled ? `${variantDraft.printing_type} print` : "No print"}</span>
                </div>
              </div>
              <div className={styles.variantHeroPanel}>
                <div className={styles.heroMetric}>
                  <span>Family</span>
                  <strong>{selectedSku ? selectedSku.code : "Select family"}</strong>
                  <small>{selectedSku?.name || "Pick a planner family first"}</small>
                </div>
                <div className={styles.heroMetric}>
                  <span>Template</span>
                  <strong>{variantTemplate?.name || selectedFamilyTemplate?.name || "Choose template"}</strong>
                  <small>{variantTemplate?.status || selectedFamilyTemplate?.status || "Route source pending"}</small>
                </div>
                <div className={styles.heroMetric}>
                  <span>Stock route</span>
                  <strong>{variantDraft.launch_kind.replaceAll("_", " ")}</strong>
                  <small>Finished goods are roll or pouch only.</small>
                </div>
                <div className={styles.heroMetric}>
                  <span>Active</span>
                  <Switch checked={variantDraft.active} onCheckedChange={(checked) => patchVariant({ active: checked })} />
                  <small>Launchable from stock studio.</small>
                </div>
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Identity</div>
                  <h3 className={styles.sheetSectionTitle}>Preset header</h3>
                </div>
              </div>
              <div className={styles.formGrid}>
                <div>
                  <Label>Family</Label>
                  <div className={styles.readonlyField}>{selectedSku ? `${selectedSku.code} · ${selectedSku.name}` : "Select a family from the rail"}</div>
                </div>
                <div>
                  <Label>Stock route</Label>
                  <Select value={variantOutputClass} onValueChange={(value: PlannerOutputClass) => syncOutputClass(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FG">Final roll / pouch</SelectItem>
                      <SelectItem value="INVARIANT">Invariant roll</SelectItem>
                      <SelectItem value="WIP">WIP for roll / pouch</SelectItem>
                      <SelectItem value="POD">POD stock</SelectItem>
                      <SelectItem value="PACKAGING">Packaging stock</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className={styles.inlineHint}>
                    Route class controls stock intent. Finished goods are only roll or pouch.
                  </div>
                </div>
                <div>
                  <Label>Preset code</Label>
                  <Input value={variantDraft.code} onChange={(event) => patchVariant({ code: event.target.value })} placeholder="INV-ROLL-520" />
                </div>
                <div>
                  <Label>Preset name</Label>
                  <Input value={variantDraft.name} onChange={(event) => patchVariant({ name: event.target.value })} placeholder="Shared invariant 520" />
                </div>
                <div>
                  <Label>Template</Label>
                  <Select value={variantDraft.template || "NONE"} onValueChange={(value) => patchVariant({ template: value === "NONE" ? "" : value })}>
                    <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No template</SelectItem>
                      {templates.map((template: any) => (
                        <SelectItem key={template.id} value={String(template.id)}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default plant</Label>
                  <Select value={variantDraft.default_plant || "NONE"} onValueChange={(value) => patchVariant({ default_plant: value === "NONE" ? "" : value })}>
                    <SelectTrigger><SelectValue placeholder="Auto plant" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Auto plant</SelectItem>
                      {plants.map((plant: any) => (
                        <SelectItem key={plant.id} value={String(plant.id)}>
                          {plant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Default quantity</Label>
                  <Input type="number" value={variantDraft.default_qty} onChange={(event) => patchVariant({ default_qty: Number(event.target.value || 0) })} />
                </div>
                <div>
                  <Label>Quantity UOM</Label>
                  <Select value={variantDraft.quantity_uom} onValueChange={(value: QuantityUom) => patchVariant({ quantity_uom: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KG">KG</SelectItem>
                      <SelectItem value="PCS">PCS</SelectItem>
                      <SelectItem value="METER">METER</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Production logic</div>
                  <h3 className={styles.sheetSectionTitle}>Route, stock, and output</h3>
                </div>
              </div>
              <div className={styles.formGrid}>
                <div>
                  <Label>Finished good</Label>
                  <Select value={variantDraft.finished_good_type} onValueChange={(value: FgType) => syncFinishedGoodType(value)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="POUCH">Pouch</SelectItem>
                      <SelectItem value="ROLL">Roll</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Route start</Label>
                  <Select value={String(variantDraft.start_step_index)} onValueChange={(value) => patchVariant({ start_step_index: Number(value || 0) })} disabled={!routeSteps.length}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Start at raw</SelectItem>
                      {routeSteps.map((step: any) => (
                        <SelectItem key={`start-${step.index}`} value={String(step.index)}>
                          {step.label || `Step ${step.index} · ${step.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Route stop</Label>
                  <Select value={String(variantDraft.stop_step_index ?? routeLastIndex)} onValueChange={(value) => patchVariant({ stop_step_index: Number(value || routeLastIndex) })} disabled={!routeSteps.length}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {routeSteps.map((step: any) => (
                        <SelectItem key={`stop-${step.index}`} value={String(step.index)}>
                          {step.label || `Step ${step.index} · ${step.name}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {variantDraft.finished_good_type === "ROLL" ? (
                  <div>
                    <Label>Roll form</Label>
                    <Select value={variantDraft.roll_form} onValueChange={(value: RollForm) => patchVariant({ roll_form: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FLAT">Flat</SelectItem>
                        <SelectItem value="FOLDED">Folded</SelectItem>
                        <SelectItem value="TUBING">Tubing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
              <div className={styles.summaryRibbon}>
                <span>{outputClassLabel(variantOutputClass)}</span>
                <span>{variantDraft.finished_good_type === "ROLL" ? `${variantDraft.roll_form} roll` : "Pouch output"}</span>
                <span>{variantDraft.stock_strategy.replaceAll("_", " ")}</span>
                <span>{variantDraft.planner_stock_class.replaceAll("_", " ")}</span>
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Geometry</div>
                  <h3 className={styles.sheetSectionTitle}>Dimensions and physics inputs</h3>
                </div>
              </div>
              <div className={styles.formGrid}>
                <div>
                  <Label>Width (mm)</Label>
                  <Input type="number" value={variantDraft.width_mm} onChange={(event) => patchVariant({ width_mm: Number(event.target.value || 0) })} disabled={variantDraft.finished_good_type === "ROLL"} />
                </div>
                <div>
                  <Label>Height (mm)</Label>
                  <Input type="number" value={variantDraft.height_mm} onChange={(event) => patchVariant({ height_mm: Number(event.target.value || 0) })} disabled={variantDraft.finished_good_type === "ROLL"} />
                </div>
                <div>
                  <Label>Faces</Label>
                  <Input type="number" value={variantDraft.faces} onChange={(event) => patchVariant({ faces: Number(event.target.value || 1) })} />
                </div>
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Layer stack</div>
                  <h3 className={styles.sheetSectionTitle}>Material structure</h3>
                  <div className={styles.inlineHint}>
                    {variantOutputClass === "POD"
                      ? "POD presets can use any real layer stack needed for the required stock. Save the actual consuming film structure here."
                      : variantOutputClass === "PACKAGING"
                        ? "Packaging presets can use any real pouch or roll material stack. Save the exact consuming layers here."
                        : "Use the real production stack here so launches consume the correct film materials."}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => patchVariant({ layer_snapshot: [...variantDraft.layer_snapshot, makeLayer()] })}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add layer
                </Button>
              </div>
              <div className={styles.stackRows}>
                {variantDraft.layer_snapshot.map((layer, index) => (
                  <div key={`layer-${index}`} className={styles.stackRow}>
                    <Select value={layer.family_id || "NONE"} onValueChange={(value) => {
                      const next = [...variantDraft.layer_snapshot]
                      next[index] = { ...next[index], family_id: value === "NONE" ? "" : value, variant_id: "" }
                      patchVariant({ layer_snapshot: next })
                    }}>
                      <SelectTrigger><SelectValue placeholder="Family" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select family</SelectItem>
                        {filmFamilies.map((family: any) => (
                          <SelectItem key={family.id} value={String(family.id)}>
                            {family.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={layer.variant_id || "NONE"} onValueChange={(value) => {
                      const next = [...variantDraft.layer_snapshot]
                      next[index] = { ...next[index], variant_id: value === "NONE" ? "" : value }
                      patchVariant({ layer_snapshot: next })
                    }}>
                      <SelectTrigger><SelectValue placeholder="Variant" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select variant</SelectItem>
                        {filmVariants
                          .filter((variant: any) => String(variant?.parent_family?.id || variant?.parent_family || "") === String(layer.family_id || ""))
                          .map((variant: any) => (
                            <SelectItem key={variant.id} value={String(variant.id)}>
                              {variant.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" value={layer.thickness_micron} onChange={(event) => {
                      const next = [...variantDraft.layer_snapshot]
                      next[index] = { ...next[index], thickness_micron: Number(event.target.value || 0) }
                      patchVariant({ layer_snapshot: next })
                    }} placeholder="Thickness" />
                    <Input type="number" value={layer.roll_width_mm} onChange={(event) => {
                      const next = [...variantDraft.layer_snapshot]
                      next[index] = { ...next[index], roll_width_mm: Number(event.target.value || 0) }
                      patchVariant({ layer_snapshot: next })
                    }} placeholder="Roll width" />
                    <Button variant="ghost" size="sm" onClick={() => patchVariant({ layer_snapshot: variantDraft.layer_snapshot.filter((_, rowIndex) => rowIndex !== index) || [makeLayer()] })}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Printing</div>
                  <h3 className={styles.sheetSectionTitle}>Artwork, color, and ink inputs</h3>
                  <div className={styles.inlineHint}>Printing is optional. Lamination chemistry is managed in the next card.</div>
                </div>
                <Switch checked={variantDraft.printing_enabled} onCheckedChange={(checked) => patchVariant({ printing_enabled: checked })} />
              </div>
              {variantDraft.printing_enabled ? (
                <div className={styles.formGrid}>
                  <div>
                    <Label>Print type</Label>
                    <Select value={variantDraft.printing_type} onValueChange={(value: VariantDraft["printing_type"]) => patchVariant({ printing_type: value })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FLEXO">FLEXO</SelectItem>
                        <SelectItem value="ROTO">ROTO</SelectItem>
                        <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Film type</Label>
                    <Select value={variantDraft.substrate_mode} onValueChange={(value: VariantDraft["substrate_mode"]) => patchVariant({ substrate_mode: value, back_colors_count: value === "TUBING" ? variantDraft.back_colors_count : 0 })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="SHEET">Sheet</SelectItem>
                        <SelectItem value="TUBING">Tubing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Front colors</Label>
                    <Input type="number" value={variantDraft.front_colors_count} onChange={(event) => patchVariant({ front_colors_count: Number(event.target.value || 0) })} />
                  </div>
                  {variantDraft.substrate_mode === "TUBING" ? (
                  <div>
                    <Label>Back colors</Label>
                    <Input type="number" value={variantDraft.back_colors_count} onChange={(event) => patchVariant({ back_colors_count: Number(event.target.value || 0) })} />
                  </div>
                  ) : null}
                  <div>
                    <Label>Ink GSM total</Label>
                    <Input type="number" value={variantDraft.ink_gsm_total} onChange={(event) => patchVariant({ ink_gsm_total: Number(event.target.value || 0) })} />
                  </div>
                  <div>
                    <Label>Artwork ID</Label>
                    <Input value={variantDraft.artwork_id} onChange={(event) => patchVariant({ artwork_id: event.target.value })} placeholder="Optional artwork reference" />
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>No printing required for this preset.</div>
              )}
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Chemistry and lamination</div>
                  <h3 className={styles.sheetSectionTitle}>Adhesive and solvent inputs</h3>
                  <div className={styles.inlineHint}>Use this for lamination even when printing is disabled.</div>
                </div>
              </div>
              {variantDraft.layer_snapshot.length > 1 ? (
                <div className={styles.formGrid}>
                  <div>
                    <Label>Adhesive GSM</Label>
                    <Input type="number" value={variantDraft.adhesive_gsm} onChange={(event) => patchVariant({ adhesive_gsm: Number(event.target.value || 0) })} />
                  </div>
                  <div>
                    <Label>Solvent GSM</Label>
                    <Input type="number" value={variantDraft.solvent_gsm} onChange={(event) => patchVariant({ solvent_gsm: Number(event.target.value || 0) })} />
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>Single-layer presets do not need lamination chemistry.</div>
              )}
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Add-ons</div>
                  <h3 className={styles.sheetSectionTitle}>Extra physical operations</h3>
                </div>
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => patchVariant({ addons_snapshot: [...variantDraft.addons_snapshot, makeAddon()] })}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add add-on
                </Button>
              </div>
              <div className={styles.stackRows}>
                {variantDraft.addons_snapshot.length ? variantDraft.addons_snapshot.map((addon, index) => (
                  <div key={`addon-${index}`} className={styles.stackRow}>
                    <Select value={addon.addon_id || "NONE"} onValueChange={(value) => {
                      const next = [...variantDraft.addons_snapshot]
                      next[index] = { ...next[index], addon_id: value === "NONE" ? "" : value }
                      patchVariant({ addons_snapshot: next })
                    }}>
                      <SelectTrigger><SelectValue placeholder="Add-on" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select add-on</SelectItem>
                        {addonsMaster.map((addonOption: any) => (
                          <SelectItem key={addonOption.id} value={String(addonOption.id)}>
                            {addonOption.code} · {addonOption.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input type="number" value={addon.qty} onChange={(event) => {
                      const next = [...variantDraft.addons_snapshot]
                      next[index] = { ...next[index], qty: Number(event.target.value || 0) }
                      patchVariant({ addons_snapshot: next })
                    }} placeholder="Qty" />
                    <Select value={addon.applies_to} onValueChange={(value: AddonDraft["applies_to"]) => {
                      const next = [...variantDraft.addons_snapshot]
                      next[index] = { ...next[index], applies_to: value }
                      patchVariant({ addons_snapshot: next })
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None</SelectItem>
                        <SelectItem value="WIDTH">Width</SelectItem>
                        <SelectItem value="HEIGHT">Height</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" onClick={() => patchVariant({ addons_snapshot: variantDraft.addons_snapshot.filter((_, rowIndex) => rowIndex !== index) })}>
                      Remove
                    </Button>
                  </div>
                )) : <div className={styles.emptyState}>No add-ons linked to this preset.</div>}
              </div>
            </section>

            <section className={styles.sheetSection}>
              <div className={styles.sheetSectionHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Packaging and POD</div>
                  <h3 className={styles.sheetSectionTitle}>Dispatch and auxiliary stock detail</h3>
                </div>
              </div>
              {variantOutputClass === "PACKAGING" ? (
                <div className={styles.formGrid}>
                  <div>
                    <Label>Packaging output material</Label>
                    <Select value={variantDraft.packaging_material || "NONE"} onValueChange={(value) => patchVariant({ packaging_material: value === "NONE" ? "" : value })}>
                      <SelectTrigger><SelectValue placeholder="Packaging material" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select packaging output</SelectItem>
                        {packagingMaterials.map((material: any) => (
                          <SelectItem key={material.id} value={String(material.id)}>
                            {material.code} · {material.name} ({material.base_uom})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={styles.readonlyField}>Packaging stock uses the same route, geometry, and layer snapshot as any other planner-built stock order.</div>
                </div>
              ) : variantOutputClass === "POD" ? (
                <div className={styles.formGrid}>
                  <div>
                    <Label>POD SKU variant</Label>
                    <Select value={variantDraft.pod_sku_variant || "NONE"} onValueChange={(value) => patchVariant({ pod_sku_variant: value === "NONE" ? "" : value })}>
                      <SelectTrigger><SelectValue placeholder="Select POD linkage" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">Select POD linkage</SelectItem>
                        {podSkuVariants.map((variant: any) => (
                          <SelectItem key={variant.id} value={String(variant.id)}>
                            {variant.code} · {variant.name || variant.pod_sku_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={styles.readonlyField}>POD stock stays first-class production output and keeps its own route and consuming layer truth.</div>
                </div>
              ) : (
                <>
                  <div className={styles.inlineSwitchRow}>
                    <div>
                      <div className={styles.metaLabel}>Primary inner pack</div>
                      <div className={styles.inlineHint}>Attach commercial packaging rules for finished-goods launches.</div>
                    </div>
                    <Switch checked={variantDraft.primary_inner_pack_enabled} onCheckedChange={(checked) => patchVariant({ primary_inner_pack_enabled: checked })} />
                  </div>
                  {variantDraft.primary_inner_pack_enabled ? (
                    <div className={styles.formGrid}>
                      <div>
                        <Label>Primary material</Label>
                        <Select value={variantDraft.primary_inner_pack_material_id || "NONE"} onValueChange={(value) => patchVariant({ primary_inner_pack_material_id: value === "NONE" ? "" : value })}>
                          <SelectTrigger><SelectValue placeholder="Select packaging material" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Select material</SelectItem>
                            {packagingMaterials.map((material: any) => (
                              <SelectItem key={material.id} value={String(material.id)}>
                                {material.code} · {material.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>PCS per pack</Label>
                        <Input type="number" value={variantDraft.primary_inner_pack_pcs} onChange={(event) => patchVariant({ primary_inner_pack_pcs: Number(event.target.value || 0) })} />
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.inlineSwitchRow}>
                    <div>
                      <div className={styles.metaLabel}>Roll dispatch pack</div>
                      <div className={styles.inlineHint}>Mark which pack materials can be used. Actual qty is captured later in Packing Yard or dispatch release.</div>
                    </div>
                    <Switch checked={variantDraft.roll_dispatch_pack_enabled} onCheckedChange={(checked) => patchVariant({ roll_dispatch_pack_enabled: checked })} />
                  </div>
                  {variantDraft.roll_dispatch_pack_enabled ? (
                    <div className={styles.stackRows}>
                      {variantDraft.roll_dispatch_pack_lines.map((line, index) => (
                        <div key={`pack-${index}`} className={styles.stackRow}>
                          <Select value={line.material_id || "NONE"} onValueChange={(value) => {
                            const nextMaterialId = value === "NONE" ? "" : value
                            const selectedMaterial = packagingMaterials.find((material: any) => String(material.id) === nextMaterialId)
                            const inferredUom = (String(selectedMaterial?.base_uom || line.uom || "PCS").toUpperCase() as PackagingLineDraft["uom"])
                            const next = [...variantDraft.roll_dispatch_pack_lines]
                            next[index] = { ...next[index], material_id: nextMaterialId, qty: 0, uom: inferredUom }
                            patchVariant({ roll_dispatch_pack_lines: next })
                          }}>
                            <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">Select material</SelectItem>
                              {packagingMaterials.map((material: any) => (
                                <SelectItem key={material.id} value={String(material.id)}>
                                  {material.code} · {material.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className={styles.stackRowMeta}>
                            {line.material_id ? `${line.uom} actual at packing` : "Select material first"}
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => patchVariant({ roll_dispatch_pack_lines: variantDraft.roll_dispatch_pack_lines.filter((_, rowIndex) => rowIndex !== index) })}>
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => patchVariant({ roll_dispatch_pack_lines: [...variantDraft.roll_dispatch_pack_lines, makePackagingLine()] })}>
                        <Plus className="mr-2 h-3.5 w-3.5" />
                        Add allowed material
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            <div className={styles.sheetFooter}>
              <div className={styles.sheetFooterMeta}>
                <strong>Route:</strong> Step {variantDraft.start_step_index} to {(variantDraft.stop_step_index ?? routeLastIndex) || "final"} ·
                <strong> Output:</strong> {variantDraft.finished_good_type === "ROLL" ? `${variantDraft.roll_form} roll` : "Pouch"} ·
                <strong> Layers:</strong> {validLayerCount} ready
              </div>
              <div className={styles.sheetFooterActions}>
                <Button variant="outline" className="rounded-full" onClick={() => setVariantDialogOpen(false)}>
                  Close
                </Button>
                <Button
                  className="rounded-full bg-slate-950 text-white hover:bg-slate-800"
                  onClick={() => variantMutation.mutate()}
                  disabled={
                    !selectedSku ||
                    !variantDraft.code.trim() ||
                    !variantDraft.name.trim() ||
                    !variantDraft.template ||
                    validLayerCount < requiredLayerCount ||
                    (variantOutputClass === "PACKAGING" && !variantDraft.packaging_material) ||
                    (variantOutputClass === "POD" && !variantDraft.pod_sku_variant) ||
                    variantMutation.isPending
                  }
                >
                  {variantMutation.isPending ? "Saving..." : editingVariant ? "Save Variant" : "Create Variant"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
