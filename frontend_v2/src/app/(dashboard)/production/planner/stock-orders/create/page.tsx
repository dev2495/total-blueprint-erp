"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CopyPlus,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import { masterDataService } from "@/services/master-data"
import { plannerService, type CreateStockOrderPayload } from "@/services/planner"
import { salesService } from "@/services/sales"
import styles from "./stock-order-create.module.css"

type Line = { material_id: string; qty: number; uom?: string; basis?: string }
type StockStrategy = "FINAL_STOCK" | "INTERMEDIATE_POOL" | "PACKAGING_STOCK"
type LauncherMode = "FINAL_ROLL" | "SHARED_INVARIANT_ROLL" | "BASE_UPSTREAM_ROLL" | "POD_STOCK" | "PACKAGING_STOCK"
type LaunchLane = "SALES" | "PLANNER" | "CUSTOM"
type PlannerOutputClass = "FG" | "INVARIANT" | "WIP" | "POD" | "PACKAGING"
type CartLineStatus = "draft" | "submitting" | "released" | "failed"

type PlannerPresetSeed = {
  selectedPlannerSkuId: string
  selectedPlannerSkuCode: string
  selectedPlannerSkuName: string
  selectedSalesSkuCode: string
  selectedSalesSkuName: string
  selectedTemplateName: string
  lineLabel: string
  notes: string
  templateId: string
  plantId: string
  quantity: number
  quantityUom: "KG" | "PCS" | "METER"
  stockPurpose: "PRODUCT" | "PACKAGING"
  stockStrategy: StockStrategy
  packagingMaterialId: string
  podSkuVariantId: string
  launcherMode: LauncherMode
  launchLane: LaunchLane
  finalProductType: "POUCH" | "ROLL" | null
  startStepIndex: number
  stopStepIndex?: number
  selectedSalesSkuVariantId: string
}

type PlannerCartLine = {
  localId: string
  name: string
  lane: LaunchLane
  outputClass: PlannerOutputClass
  outputLabel: string
  sourceLabel: string
  templateName: string
  routeLabel: string
  routeDetail: string
  quantity: number
  quantityUom: "KG" | "PCS" | "METER"
  estimatedKg: number | null
  estimatedPcs: number | null
  previewWidthMm: number | null
  previewHeightMm: number | null
  previewLengthM: number | null
  previewAreaM2: number | null
  payload: CreateStockOrderPayload
  notes: string
  finalProductType: "POUCH" | "ROLL" | null
  previewError: string | null
  submitStatus: CartLineStatus
  submitError: string
  createdOrderId: string
  createdOrderNumber: string
  createdOrderKind: "stock" | "bulk" | ""
  saveAsPlannerPreset: boolean
  presetSeed: PlannerPresetSeed
}

function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function makeEmptyLayer() {
  return { family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0, grade_id: null as string | null }
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

function stepTitle(step: any) {
  return step?.label || `Step ${step?.index ?? "?"} · ${step?.name || "Route"}`
}

function makeLocalId() {
  return `stock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function launchModeLabel(mode: LauncherMode) {
  if (mode === "FINAL_ROLL") return "Final roll / pouch"
  if (mode === "SHARED_INVARIANT_ROLL") return "Shared invariant"
  if (mode === "BASE_UPSTREAM_ROLL") return "Base / upstream"
  if (mode === "POD_STOCK") return "POD stock"
  return "Packaging stock"
}

function plannerOutputLabel(output: PlannerOutputClass) {
  if (output === "FG") return "Final roll / pouch"
  if (output === "INVARIANT") return "Invariant roll"
  if (output === "WIP") return "WIP for roll / pouch"
  if (output === "POD") return "POD stock"
  return "Packaging stock"
}

function plannerOutputShortLabel(output: PlannerOutputClass) {
  if (output === "FG") return "Roll / Pouch"
  if (output === "INVARIANT") return "Invariant"
  if (output === "WIP") return "WIP"
  if (output === "POD") return "POD"
  return "Packaging"
}

function plannerOutputCopy(output: PlannerOutputClass) {
  if (output === "FG") return "Final roll or pouch stock ready for allocation."
  if (output === "INVARIANT") return "Reusable shared intermediate roll for repeat continuation."
  if (output === "WIP") return "Route-stopped stock held for later roll or pouch continuation."
  if (output === "POD") return "Planner-owned POD replenishment built on the same production engine."
  return "Packaging replenishment using the same route, material, and consumption truth."
}

function normalizePlannerFgType(value: unknown): "POUCH" | "ROLL" {
  return String(value || "").toUpperCase() === "ROLL" ? "ROLL" : "POUCH"
}

function outputClassForMode(mode: LauncherMode): PlannerOutputClass {
  if (mode === "FINAL_ROLL") return "FG"
  if (mode === "SHARED_INVARIANT_ROLL") return "INVARIANT"
  if (mode === "BASE_UPSTREAM_ROLL") return "WIP"
  if (mode === "POD_STOCK") return "POD"
  return "PACKAGING"
}

function modeForOutputClass(output: PlannerOutputClass): LauncherMode {
  if (output === "FG") return "FINAL_ROLL"
  if (output === "INVARIANT") return "SHARED_INVARIANT_ROLL"
  if (output === "WIP") return "BASE_UPSTREAM_ROLL"
  if (output === "POD") return "POD_STOCK"
  return "PACKAGING_STOCK"
}

function firstRollInputStep(routeSteps: Array<{ index: number; input_form?: string }>) {
  const match = routeSteps.find((step) => String(step.input_form || "").toUpperCase() === "ROLL")
  return match ? Number(match.index || 0) : 0
}

function defaultStopForMode(mode: LauncherMode, routeSteps: Array<{ index: number; roll_behavior?: string }>, startStepIndex: number) {
  const routeLastIndex = routeSteps.length ? Number(routeSteps[routeSteps.length - 1]?.index ?? routeSteps.length - 1) : 0
  if (mode === "FINAL_ROLL" || mode === "PACKAGING_STOCK" || mode === "POD_STOCK") {
    return routeLastIndex
  }
  if (mode === "SHARED_INVARIANT_ROLL") {
    const printingLikeStep = routeSteps.find((step) => {
      const behavior = String(step.roll_behavior || "").toUpperCase()
      return Number(step.index || 0) >= startStepIndex && behavior === "MODIFY_EXISTING"
    })
    if (printingLikeStep) return Number(printingLikeStep.index || startStepIndex)
    return Math.max(startStepIndex, routeLastIndex > 0 ? routeLastIndex - 1 : 0)
  }
  return Math.max(startStepIndex, 0)
}

function plannerLaneLabel(lane: LaunchLane) {
  if (lane === "SALES") return "Sales SKU"
  if (lane === "PLANNER") return "Planner SKU"
  return "Custom"
}

function salesVariantMatchesOutput(variant: any, output: PlannerOutputClass) {
  const packaging = variant?.packaging_snapshot || {}
  const hasPodLink = Boolean(
    packaging?.pod?.enabled ||
    packaging?.pod_variant_id ||
    packaging?.pod_sku_variant ||
    variant?.pod_sku_variant
  )
  const hasPackagingRules = Boolean(
    packaging?.primary_inner_pack?.enabled ||
    packaging?.roll_dispatch_pack?.enabled ||
    variant?.packaging_material
  )

  if (output === "POD") return hasPodLink
  if (output === "PACKAGING") return hasPackagingRules
  return true
}

function normalizePackagingSnapshot(
  stockPurpose: "PRODUCT" | "PACKAGING",
  primaryEnabled: boolean,
  primaryMaterialId: string,
  pcsPerPack: number,
  rollPackEnabled: boolean,
  rollPackLines: Line[],
) {
  if (stockPurpose === "PACKAGING") return {}
  return {
    primary_inner_pack: { enabled: primaryEnabled, material_id: primaryMaterialId || null, pcs_per_pack: pcsPerPack },
    roll_dispatch_pack: { enabled: rollPackEnabled, lines: rollPackLines },
  }
}

export default function PlannerStockOrderStudioPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const [launchLane, setLaunchLane] = useState<LaunchLane>("SALES")
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("FINAL_ROLL")
  const [plannerOutputFilter, setPlannerOutputFilter] = useState<PlannerOutputClass>("FG")
  const [selectedSalesSkuId, setSelectedSalesSkuId] = useState("")
  const [selectedSalesSkuVariantId, setSelectedSalesSkuVariantId] = useState("")
  const [selectedPlannerPresetId, setSelectedPlannerPresetId] = useState("")
  const [selectedPlannerSkuId, setSelectedPlannerSkuId] = useState("")
  const [podSkuVariantId, setPodSkuVariantId] = useState("")
  const [saveAsPlannerPreset, setSaveAsPlannerPreset] = useState(false)
  const [showAdvancedCustom, setShowAdvancedCustom] = useState(false)
  const [showTechnicalSnapshot, setShowTechnicalSnapshot] = useState(false)
  const [variantSearch, setVariantSearch] = useState("")
  const [cartLines, setCartLines] = useState<PlannerCartLine[]>([])
  const [submittingCart, setSubmittingCart] = useState(false)

  const [templateId, setTemplateId] = useState("")
  const [plantId, setPlantId] = useState("")
  const [quantity, setQuantity] = useState(1000)
  const [quantityUom, setQuantityUom] = useState<"KG" | "PCS" | "METER">("PCS")
  const [stockPurpose, setStockPurpose] = useState<"PRODUCT" | "PACKAGING">("PRODUCT")
  const [stockStrategy, setStockStrategy] = useState<StockStrategy>("FINAL_STOCK")
  const [packagingMaterialId, setPackagingMaterialId] = useState("")
  const [startStepIndex, setStartStepIndex] = useState(0)
  const [stopStepIndex, setStopStepIndex] = useState<number | undefined>(undefined)

  const [fgType, setFgType] = useState<"POUCH" | "ROLL">("POUCH")
  const [rollForm, setRollForm] = useState<"FLAT" | "FOLDED" | "TUBING">("FLAT")
  const [lineLabel, setLineLabel] = useState("")
  const [widthMm, setWidthMm] = useState(0)
  const [heightMm, setHeightMm] = useState(0)
  const [faces, setFaces] = useState(1)
  const [notes, setNotes] = useState("")

  const [layers, setLayers] = useState<Array<{ family_id: string; variant_id: string; thickness_micron: number; roll_width_mm?: number; grade_id?: string | null }>>([makeEmptyLayer()])
  const [printingEnabled, setPrintingEnabled] = useState(false)
  const [printType, setPrintType] = useState<"FLEXO" | "ROTO" | "DIGITAL">("FLEXO")
  const [substrateMode, setSubstrateMode] = useState<"SHEET" | "TUBING">("SHEET")
  const [frontColorsCount, setFrontColorsCount] = useState(0)
  const [backColorsCount, setBackColorsCount] = useState(0)
  const [inkGsmTotal, setInkGsmTotal] = useState(0)
  const [adhesiveGsm, setAdhesiveGsm] = useState(0)
  const [solventGsm, setSolventGsm] = useState(0)
  const [artworkId, setArtworkId] = useState("")
  const [addons, setAddons] = useState<Array<{ addon_id: string; qty: number; applies_to: "WIDTH" | "HEIGHT" | "NONE" }>>([])
  const [primaryEnabled, setPrimaryEnabled] = useState(false)
  const [primaryMaterialId, setPrimaryMaterialId] = useState("")
  const [pcsPerPack, setPcsPerPack] = useState(100)
  const [rollPackEnabled, setRollPackEnabled] = useState(false)
  const [rollPackLines, setRollPackLines] = useState<Line[]>([])

  const [preview, setPreview] = useState<any>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const launchOutputClass = outputClassForMode(launcherMode)
  const selectedLaneIsSales = launchLane === "SALES"
  const selectedLaneIsPlanner = launchLane === "PLANNER"
  const selectedLaneIsCustom = launchLane === "CUSTOM"
  const selectedOutputClass = selectedLaneIsPlanner ? plannerOutputFilter : launchOutputClass
  const visibleOutputClasses: PlannerOutputClass[] = selectedLaneIsSales
    ? ["FG"]
    : ["FG", "INVARIANT", "WIP", "POD", "PACKAGING"]

  const templatesQuery = useQuery({
    queryKey: ["planner-launch-templates"],
    queryFn: async () => {
      const { data } = await api.get("/api/templates/")
      return Array.isArray(data) ? data : []
    },
  })
  const plantsQuery = useQuery({
    queryKey: ["planner-launch-plants"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/plants/")
      return Array.isArray(data) ? data : []
    },
  })
  const routeStepsQuery = useQuery({
    queryKey: ["planner-launch-route", templateId],
    queryFn: () => plannerService.getRouteSteps(templateId),
    enabled: !!templateId,
  })
  const familiesQuery = useQuery({ queryKey: ["planner-launch-film-families"], queryFn: masterDataService.getFilmFamilies })
  const variantsQuery = useQuery({ queryKey: ["planner-launch-film-variants"], queryFn: masterDataService.getFilmVariants })
  const addonsMasterQuery = useQuery({ queryKey: ["planner-launch-addons"], queryFn: masterDataService.getAddons })
  const packagingMaterialsQuery = useQuery({ queryKey: ["planner-launch-packaging"], queryFn: masterDataService.getPackaging })
  const plannerSkusQuery = useQuery({
    queryKey: ["planner-launch-sku-families"],
    queryFn: () => plannerService.getPlannerSkus({ active: true }),
  })
  const plannerVariantsQuery = useQuery({
    queryKey: ["planner-launch-sku-variants", selectedPlannerSkuId],
    queryFn: () =>
      plannerService.getPlannerSkuVariants({
        sku_id: selectedPlannerSkuId || undefined,
        active: true,
      }),
  })
  const podSkuVariantsQuery = useQuery({
    queryKey: ["planner-launch-pod-variants"],
    queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
  })
  const salesSkusQuery = useQuery({
    queryKey: ["planner-launch-sales-skus"],
    queryFn: () => salesService.getSalesSkus({ active: true }),
    enabled: launchLane === "SALES",
  })
  const salesVariantsQuery = useQuery({
    queryKey: ["planner-launch-sales-variants", selectedSalesSkuId],
    queryFn: () => salesService.getSalesSkuVariants({ sku_id: selectedSalesSkuId || undefined, active: true }),
    enabled: launchLane === "SALES" && !!selectedSalesSkuId,
  })

  const templates = Array.isArray(templatesQuery.data) ? templatesQuery.data : []
  const plants = Array.isArray(plantsQuery.data) ? plantsQuery.data : []
  const routeSteps = Array.isArray(routeStepsQuery.data) ? routeStepsQuery.data : []
  const families = Array.isArray(familiesQuery.data) ? familiesQuery.data : []
  const variants = Array.isArray(variantsQuery.data) ? variantsQuery.data : []
  const addonsMaster = Array.isArray(addonsMasterQuery.data) ? addonsMasterQuery.data : []
  const packagingMaterials = Array.isArray(packagingMaterialsQuery.data) ? packagingMaterialsQuery.data : []
  const plannerSkus = Array.isArray(plannerSkusQuery.data) ? plannerSkusQuery.data : []
  const plannerPresets = Array.isArray(plannerVariantsQuery.data) ? plannerVariantsQuery.data : []
  const podSkuVariants = Array.isArray(podSkuVariantsQuery.data) ? podSkuVariantsQuery.data : []
  const salesSkus = Array.isArray(salesSkusQuery.data) ? salesSkusQuery.data : []
  const salesVariants = Array.isArray(salesVariantsQuery.data) ? salesVariantsQuery.data : []
  const salesLaneSkus = useMemo(() => salesSkus, [salesSkus])
  const salesLaneVariants = useMemo(() => {
    if (selectedOutputClass === "POD" || selectedOutputClass === "PACKAGING") {
      return salesVariants.filter((variant: any) => salesVariantMatchesOutput(variant, selectedOutputClass))
    }
    return salesVariants
  }, [salesVariants, selectedOutputClass])
  const plannerLaneSkus = useMemo(() => plannerSkus, [plannerSkus])
  const filteredPlannerPresets = useMemo(() => {
    const launchKind = modeForOutputClass(selectedOutputClass)
    return plannerPresets.filter((preset: any) => String(preset?.launch_kind || "").toUpperCase() === String(launchKind).toUpperCase())
  }, [plannerPresets, selectedOutputClass])

  const selectedPlannerPreset = useMemo(
    () => filteredPlannerPresets.find((preset) => String(preset.id) === String(selectedPlannerPresetId)) || plannerPresets.find((preset) => String(preset.id) === String(selectedPlannerPresetId)) || null,
    [filteredPlannerPresets, plannerPresets, selectedPlannerPresetId],
  )
  const selectedPlannerSku = useMemo(
    () => plannerLaneSkus.find((sku) => String(sku.id) === String(selectedPlannerSkuId)) || plannerSkus.find((sku) => String(sku.id) === String(selectedPlannerSkuId)) || null,
    [plannerLaneSkus, plannerSkus, selectedPlannerSkuId],
  )
  const selectedSalesSku = useMemo(
    () => salesSkus.find((sku) => String(sku.id) === String(selectedSalesSkuId)) || null,
    [salesSkus, selectedSalesSkuId],
  )
  const selectedSalesVariant = useMemo(
    () => salesLaneVariants.find((variant) => String(variant.id) === String(selectedSalesSkuVariantId)) || salesVariants.find((variant) => String(variant.id) === String(selectedSalesSkuVariantId)) || null,
    [salesLaneVariants, salesVariants, selectedSalesSkuVariantId],
  )
  const selectedPackagingMaterial = useMemo(
    () => packagingMaterials.find((row: any) => String(row.id) === String(packagingMaterialId || "")) || null,
    [packagingMaterials, packagingMaterialId],
  )
  const effectivePackagingMaterialId = useMemo(
    () => String(packagingMaterialId || selectedPlannerPreset?.packaging_material || "").trim(),
    [packagingMaterialId, selectedPlannerPreset],
  )
  const effectivePodSkuVariantId = useMemo(
    () => String(
      podSkuVariantId ||
      selectedPlannerPreset?.pod_sku_variant ||
      (selectedSalesVariant as any)?.packaging_snapshot?.pod?.pod_sku_variant_id ||
      ""
    ).trim(),
    [podSkuVariantId, selectedPlannerPreset, selectedSalesVariant],
  )
  const resolvedPackagingMaterial = useMemo(
    () => packagingMaterials.find((row: any) => String(row.id) === effectivePackagingMaterialId) || null,
    [effectivePackagingMaterialId, packagingMaterials],
  )
  const resolvedPodSkuVariant = useMemo(
    () => podSkuVariants.find((variant: any) => String(variant.id) === effectivePodSkuVariantId) || null,
    [effectivePodSkuVariantId, podSkuVariants],
  )
  const selectedTemplate = useMemo(
    () => templates.find((row: any) => String(row.id) === String(templateId || "")) || null,
    [templates, templateId],
  )
  const outputDisabledReasons = useMemo(() => {
    const reasons: Partial<Record<PlannerOutputClass, string>> = {}
    if (selectedLaneIsSales) {
      reasons.INVARIANT = "Invariant launch is planner-preset only."
      reasons.WIP = "WIP launch is planner-preset only."
      reasons.POD = "POD stock is launched from planner presets."
      reasons.PACKAGING = "Packaging stock is launched from planner presets."
    }
    return reasons
  }, [selectedLaneIsSales])

  const finalProductType = stockPurpose === "PACKAGING" ? null : normalizePlannerFgType(selectedTemplate?.fg_type || fgType)
  const routeLastIndex = routeSteps.length ? Number(routeSteps[routeSteps.length - 1]?.index ?? routeSteps.length - 1) : 0
  const stopsAtFinalStep = Number(stopStepIndex ?? routeLastIndex) >= routeLastIndex
  const packagingOutputUom = String(selectedPackagingMaterial?.base_uom || "").toUpperCase()
  const autoResolvedSalesStartStep = useMemo(() => {
    if (!selectedLaneIsSales || !routeSteps.length) return 0
    const seededLayers = Array.isArray(selectedSalesVariant?.layer_snapshot) ? selectedSalesVariant.layer_snapshot : []
    if (!seededLayers.length) return 0
    const seededVariants = seededLayers
      .map((layer: any) => variants.find((variant: any) => String(variant.id) === String(layer?.variant_id || "")))
      .filter(Boolean) as Array<any>
    if (!seededVariants.length || seededVariants.length !== seededLayers.length) return 0
    const allPurchased = seededVariants.every((variant: any) => !Boolean(variant?.is_extrudable))
    return allPurchased ? firstRollInputStep(routeSteps as any) : 0
  }, [routeSteps, selectedLaneIsSales, selectedSalesVariant, variants])

  const lookupErrors = [
    templatesQuery.isError ? "Templates could not be loaded." : null,
    plantsQuery.isError ? "Plants could not be loaded." : null,
    routeStepsQuery.isError ? "Route steps could not be loaded." : null,
    familiesQuery.isError ? "Film families could not be loaded." : null,
    variantsQuery.isError ? "Film variants could not be loaded." : null,
    addonsMasterQuery.isError ? "Addons could not be loaded." : null,
    packagingMaterialsQuery.isError ? "Packaging materials could not be loaded." : null,
    plannerSkusQuery.isError ? "Planner SKU families could not be loaded." : null,
    plannerVariantsQuery.isError ? "Planner variants could not be loaded." : null,
    podSkuVariantsQuery.isError ? "POD variants could not be loaded." : null,
    salesSkusQuery.isError ? "Sales SKUs could not be loaded." : null,
    salesVariantsQuery.isError ? "Sales variants could not be loaded." : null,
  ].filter(Boolean) as string[]

  const strategySummary = stockPurpose === "PACKAGING"
    ? "Packaging stock"
    : stockStrategy === "INTERMEDIATE_POOL"
      ? "Intermediate pool"
      : "Final finished goods"
  const outputSummary = plannerOutputLabel(selectedOutputClass)

  const packagingSnapshot = useMemo(
    () => normalizePackagingSnapshot(stockPurpose, primaryEnabled, primaryMaterialId, pcsPerPack, rollPackEnabled, rollPackLines),
    [stockPurpose, primaryEnabled, primaryMaterialId, pcsPerPack, rollPackEnabled, rollPackLines],
  )

  const payload = useMemo(() => {
    const normalizedLayers = (layers || []).filter((layer) => layer.family_id && layer.variant_id)
    const primaryRollWidthMm = asNumber(normalizedLayers[0]?.roll_width_mm, 0)
    const normalizedAddons = (addons || [])
      .filter((addon) => addon.addon_id)
      .map((addon) => {
        const master = (addonsMaster || []).find((row: any) => String(row.id) === String(addon.addon_id))
        return {
          addon_id: addon.addon_id,
          qty: asNumber(addon.qty, 0),
          applies_to: addon.applies_to,
          weight_mode: String(master?.weight_mode || "FIXED"),
          weight_value: asNumber(master?.weight_value, 0),
        }
      })
    return {
      template_id: templateId || undefined,
      planner_sku_variant_id: selectedLaneIsPlanner ? selectedPlannerPresetId || undefined : undefined,
      sales_sku_variant_id: selectedLaneIsSales ? selectedSalesSkuVariantId || undefined : undefined,
      launcher_mode: launcherMode,
      pod_sku_variant_id: launcherMode === "POD_STOCK" ? effectivePodSkuVariantId || undefined : undefined,
      preferred_plant_id: plantId || undefined,
      quantity: asNumber(quantity, 0),
      quantity_uom: quantityUom,
      stock_purpose: stockPurpose,
      stock_strategy: stockStrategy,
      packaging_material_id: stockPurpose === "PACKAGING" ? effectivePackagingMaterialId || undefined : undefined,
      roll_form: finalProductType === "ROLL" ? rollForm : undefined,
      start_step_index: asNumber(startStepIndex, 0),
      stop_step_index: stopStepIndex,
      geometry_override: {
        width_mm: finalProductType === "POUCH" ? asNumber(widthMm, 0) : 0,
        height_mm: finalProductType === "POUCH" ? asNumber(heightMm, 0) : 0,
      },
      geometry: {
        base: {
          width_mm: finalProductType === "ROLL" ? primaryRollWidthMm : asNumber(widthMm, 0),
          height_mm: finalProductType === "POUCH" ? asNumber(heightMm, 0) : 0,
        },
        adjustments: [],
        multipliers: { faces: asNumber(faces, 1) },
        finished_good_type: finalProductType || fgType,
        roll_form: finalProductType === "ROLL" ? rollForm : undefined,
      },
      film_layers: normalizedLayers,
      printing: printingEnabled
        ? {
            enabled: true,
            type: printType,
            substrate_mode: substrateMode,
            front_colors_count: asNumber(frontColorsCount, 0),
            back_colors_count: substrateMode === "TUBING" ? asNumber(backColorsCount, 0) : 0,
            ink_gsm_total: asNumber(inkGsmTotal, 0),
            artwork_id: artworkId || null,
            chemicals: { adhesive_gsm: asNumber(adhesiveGsm, 0), solvent_gsm: asNumber(solventGsm, 0) },
          }
        : { enabled: false },
      chemicals: { adhesive_gsm: asNumber(adhesiveGsm, 0), solvent_gsm: asNumber(solventGsm, 0) },
      addons: normalizedAddons,
      packaging_snapshot: packagingSnapshot,
    }
  }, [
    addons,
    addonsMaster,
    adhesiveGsm,
    artworkId,
    backColorsCount,
    faces,
    fgType,
    finalProductType,
    heightMm,
    inkGsmTotal,
    launcherMode,
    layers,
    effectivePackagingMaterialId,
    effectivePodSkuVariantId,
    packagingSnapshot,
    plantId,
    printType,
    printingEnabled,
    primaryEnabled,
    primaryMaterialId,
    pcsPerPack,
    quantity,
    quantityUom,
    rollForm,
    rollPackEnabled,
    rollPackLines,
    selectedLaneIsPlanner,
    selectedLaneIsSales,
    selectedPlannerPresetId,
    selectedSalesSkuVariantId,
    startStepIndex,
    stopStepIndex,
    stockPurpose,
    stockStrategy,
    substrateMode,
    templateId,
    widthMm,
    frontColorsCount,
  ])

  const applyLaunchMode = (mode: LauncherMode) => {
    setLauncherMode(mode)
    const resolvedStartStep = selectedLaneIsSales ? autoResolvedSalesStartStep : asNumber(startStepIndex, 0)
    if (selectedLaneIsSales) {
      setStartStepIndex(resolvedStartStep)
    }
    if (mode === "PACKAGING_STOCK") {
      setStockPurpose("PACKAGING")
      setStockStrategy("PACKAGING_STOCK")
      if (routeSteps.length) setStopStepIndex(defaultStopForMode(mode, routeSteps as any, resolvedStartStep))
      return
    }
    setStockPurpose("PRODUCT")
    if (mode === "FINAL_ROLL") {
      setStockStrategy("FINAL_STOCK")
      if (routeSteps.length) setStopStepIndex(defaultStopForMode(mode, routeSteps as any, resolvedStartStep))
      return
    }
    setStockStrategy("INTERMEDIATE_POOL")
    if (mode === "SHARED_INVARIANT_ROLL") {
      if (routeSteps.length) setStopStepIndex(defaultStopForMode(mode, routeSteps as any, resolvedStartStep))
      return
    }
    if (mode === "BASE_UPSTREAM_ROLL") {
      if (routeSteps.length) setStopStepIndex(defaultStopForMode(mode, routeSteps as any, resolvedStartStep))
      return
    }
    if (mode === "POD_STOCK" && routeSteps.length) {
      setStopStepIndex(defaultStopForMode(mode, routeSteps as any, resolvedStartStep))
    }
  }

  const applyOutputClass = (output: PlannerOutputClass) => {
    applyLaunchMode(modeForOutputClass(output))
  }

  const seedCommonState = (input: {
    templateId?: string | null
    fgType?: string | null
    rollForm?: string | null
    geometry?: any
    layers?: any[]
    printing?: any
    addons?: any[]
    packaging?: any
    defaultQty?: number | null
    quantityUom?: string | null
    startStepIndex?: number | null
    stopStepIndex?: number | null
    stockPurpose?: "PRODUCT" | "PACKAGING"
    stockStrategy?: StockStrategy | string | null
    plantId?: string | null
    lineLabel?: string | null
    podSkuVariantId?: string | null
    packagingMaterialId?: string | null
  }) => {
    const geometry = input.geometry || {}
    const base = geometry.base || {}
    const printing = input.printing || {}
    const chemicals = printing.chemicals || {}
    const nextFgType = normalizePlannerFgType(input.fgType || geometry.finished_good_type)
    const nextRollForm = String(input.rollForm || geometry.roll_form || "FLAT").toUpperCase() as "FLAT" | "FOLDED" | "TUBING"

    setTemplateId(String(input.templateId || ""))
    setPlantId(String(input.plantId || ""))
    setQuantity(asNumber(input.defaultQty, quantity))
    setQuantityUom((String(input.quantityUom || (nextFgType === "ROLL" ? "KG" : "PCS")).toUpperCase() as "KG" | "PCS" | "METER"))
    setStockPurpose(input.stockPurpose || "PRODUCT")
    setStockStrategy((String(input.stockStrategy || (nextFgType === "ROLL" ? "FINAL_STOCK" : stockStrategy)).toUpperCase() as StockStrategy))
    setPackagingMaterialId(String(input.packagingMaterialId || ""))
    setPodSkuVariantId(String(input.podSkuVariantId || ""))
    setStartStepIndex(asNumber(input.startStepIndex, 0))
    setStopStepIndex(
      input.stopStepIndex === null || input.stopStepIndex === undefined
        ? undefined
        : asNumber(input.stopStepIndex, 0)
    )
    setFgType(nextFgType)
    setRollForm(nextRollForm)
    setLineLabel(String(input.lineLabel || ""))
    setWidthMm(asNumber(base.width_mm || geometry.width_mm, 0))
    setHeightMm(asNumber(base.height_mm || geometry.height_mm, 0))
    setFaces(asNumber(geometry?.multipliers?.faces, 1))
    setLayers(
      Array.isArray(input.layers) && input.layers.length
        ? input.layers.map((layer: any) => ({
            family_id: String(layer.family_id || ""),
            variant_id: String(layer.variant_id || ""),
            thickness_micron: asNumber(layer.thickness_micron, 0),
            roll_width_mm: asNumber(layer.roll_width_mm || layer.width_mm, 0),
            grade_id: layer.grade_id || null,
          }))
        : [makeEmptyLayer()],
    )
    setPrintingEnabled(Boolean(printing.enabled))
    setPrintType((String(printing.type || "FLEXO").toUpperCase() as "FLEXO" | "ROTO" | "DIGITAL"))
    const nextSubstrateMode = String(printing.substrate_mode || "SHEET").toUpperCase() as "SHEET" | "TUBING"
    setSubstrateMode(nextSubstrateMode)
    setFrontColorsCount(asNumber(printing.front_colors_count, 0))
    setBackColorsCount(nextSubstrateMode === "TUBING" ? asNumber(printing.back_colors_count, 0) : 0)
    setInkGsmTotal(asNumber(printing.ink_gsm_total, 0))
    setAdhesiveGsm(asNumber(chemicals.adhesive_gsm, 0))
    setSolventGsm(asNumber(chemicals.solvent_gsm, 0))
    setArtworkId(String(printing.artwork_id || ""))
    setAddons(Array.isArray(input.addons) ? input.addons : [])

    const packaging = input.packaging && typeof input.packaging === "object" ? input.packaging : {}
    const primaryPack = packaging.primary_inner_pack || {}
    const rollDispatch = packaging.roll_dispatch_pack || {}
    setPrimaryEnabled(Boolean(primaryPack.enabled))
    setPrimaryMaterialId(String(primaryPack.material_id || ""))
    setPcsPerPack(asNumber(primaryPack.pcs_per_pack, 100))
    setRollPackEnabled(Boolean(rollDispatch.enabled))
    setRollPackLines(Array.isArray(rollDispatch.lines) ? rollDispatch.lines : [])
    setPreview(null)
    setPreviewError(null)
  }

  useEffect(() => {
    if (!searchParams) return
    const presetFromQuery = searchParams.get("preset")
    const plannerSkuFromQuery = searchParams.get("planner_sku_id")
    const sourceFromQuery = String(searchParams.get("source") || "").toLowerCase()

    if (plannerSkuFromQuery) setSelectedPlannerSkuId(plannerSkuFromQuery)
    if (presetFromQuery) {
      setLaunchLane("PLANNER")
      setSelectedPlannerPresetId(presetFromQuery)
    } else if (sourceFromQuery === "planner") {
      setLaunchLane("PLANNER")
    } else if (sourceFromQuery === "sales") {
      setLaunchLane("SALES")
    } else if (sourceFromQuery === "custom") {
      setLaunchLane("CUSTOM")
      setSaveAsPlannerPreset(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (!selectedLaneIsPlanner || !selectedPlannerPreset) return
    setPlannerOutputFilter(outputClassForMode(selectedPlannerPreset.launch_kind as LauncherMode))
  }, [selectedLaneIsPlanner, selectedPlannerPreset])

  useEffect(() => {
    if (!routeSteps.length) return
    setStopStepIndex((current) => {
      if (current === null || current === undefined) return routeLastIndex
      return Math.min(current, routeLastIndex)
    })
  }, [routeLastIndex, routeSteps.length])

  useEffect(() => {
    setVariantSearch("")
  }, [selectedOutputClass])

  useEffect(() => {
    if (!selectedLaneIsSales) return
    if (!outputDisabledReasons[selectedOutputClass]) return
    setLauncherMode("FINAL_ROLL")
  }, [outputDisabledReasons, selectedLaneIsSales, selectedOutputClass])

  useEffect(() => {
    setVariantSearch("")
  }, [launchLane, selectedPlannerSkuId, selectedSalesSkuId])

  useEffect(() => {
    if (!selectedLaneIsPlanner) return
    if (!plannerLaneSkus.length) {
      setSelectedPlannerSkuId("")
      setSelectedPlannerPresetId("")
      return
    }
    if (!selectedPlannerSkuId || !plannerLaneSkus.some((sku: any) => String(sku.id) === String(selectedPlannerSkuId))) {
      setSelectedPlannerSkuId(String(plannerLaneSkus[0].id))
      setSelectedPlannerPresetId("")
    }
  }, [plannerLaneSkus, selectedLaneIsPlanner, selectedPlannerSkuId])

  useEffect(() => {
    if (!selectedLaneIsPlanner) return
    if (!filteredPlannerPresets.length) {
      setSelectedPlannerPresetId("")
      return
    }
    if (!selectedPlannerPresetId || !filteredPlannerPresets.some((preset: any) => String(preset.id) === String(selectedPlannerPresetId))) {
      setSelectedPlannerPresetId(String(filteredPlannerPresets[0].id))
    }
  }, [filteredPlannerPresets, selectedLaneIsPlanner, selectedPlannerPresetId])

  useEffect(() => {
    if (!selectedLaneIsSales) return
    if (!salesLaneSkus.length) {
      setSelectedSalesSkuId("")
      setSelectedSalesSkuVariantId("")
      return
    }
    if (!selectedSalesSkuId || !salesLaneSkus.some((sku: any) => String(sku.id) === String(selectedSalesSkuId))) {
      setSelectedSalesSkuId(String(salesLaneSkus[0].id))
      setSelectedSalesSkuVariantId("")
    }
  }, [salesLaneSkus, selectedLaneIsSales, selectedSalesSkuId])

  useEffect(() => {
    if (!selectedLaneIsSales || !selectedSalesSkuId) return
    if (!salesLaneVariants.length) {
      setSelectedSalesSkuVariantId("")
      return
    }
    if (!selectedSalesSkuVariantId || !salesLaneVariants.some((variant: any) => String(variant.id) === String(selectedSalesSkuVariantId))) {
      setSelectedSalesSkuVariantId(String(salesLaneVariants[0].id))
    }
  }, [salesLaneVariants, selectedLaneIsSales, selectedSalesSkuId, selectedSalesSkuVariantId])

  useEffect(() => {
    if (!selectedPlannerPreset || !selectedLaneIsPlanner) return
    setLauncherMode(selectedPlannerPreset.launch_kind as LauncherMode)
    seedCommonState({
      templateId: selectedPlannerPreset.template,
      fgType: selectedPlannerPreset.geometry_snapshot?.finished_good_type,
      geometry: selectedPlannerPreset.geometry_snapshot,
      layers: selectedPlannerPreset.layer_snapshot,
      printing: selectedPlannerPreset.printing_snapshot,
      addons: selectedPlannerPreset.addons_snapshot,
      packaging: selectedPlannerPreset.packaging_snapshot,
      defaultQty: selectedPlannerPreset.default_qty,
      quantityUom: selectedPlannerPreset.quantity_uom,
      startStepIndex: selectedPlannerPreset.start_step_index,
      stopStepIndex: selectedPlannerPreset.stop_step_index,
      stockPurpose: selectedPlannerPreset.stock_purpose,
      stockStrategy: selectedPlannerPreset.stock_strategy,
      plantId: selectedPlannerPreset.default_plant,
      lineLabel: selectedPlannerPreset.name || selectedPlannerPreset.code,
      podSkuVariantId: selectedPlannerPreset.pod_sku_variant,
      packagingMaterialId: selectedPlannerPreset.packaging_material,
    })
  }, [selectedLaneIsPlanner, selectedPlannerPreset])

  useEffect(() => {
    if (!selectedSalesVariant || !selectedLaneIsSales) return
    seedCommonState({
      templateId: selectedSalesVariant.template || selectedSalesSku?.template,
      fgType: normalizePlannerFgType(selectedSalesVariant.finished_good_type),
      rollForm: selectedSalesVariant.roll_form,
      geometry: selectedSalesVariant.geometry_snapshot,
      layers: selectedSalesVariant.layer_snapshot,
      printing: {
        ...(selectedSalesVariant.printing_snapshot || {}),
        chemicals: selectedSalesVariant.chemicals_snapshot || selectedSalesVariant.printing_snapshot?.chemicals || {},
      },
      addons: selectedSalesVariant.addons_snapshot,
      packaging: selectedSalesVariant.packaging_snapshot,
      quantityUom: normalizePlannerFgType(selectedSalesVariant.finished_good_type) === "ROLL" ? "KG" : "PCS",
      stockPurpose: "PRODUCT",
      stockStrategy: "FINAL_STOCK",
      lineLabel: selectedSalesVariant.name || selectedSalesSku?.name || selectedSalesSku?.code,
    })
  }, [selectedLaneIsSales, selectedSalesSku, selectedSalesVariant])

  useEffect(() => {
    if (!selectedLaneIsSales || !routeSteps.length) return
    setStartStepIndex(autoResolvedSalesStartStep)
    setStopStepIndex(defaultStopForMode(launcherMode, routeSteps as any, autoResolvedSalesStartStep))
  }, [autoResolvedSalesStartStep, launcherMode, routeSteps, selectedLaneIsSales])

  useEffect(() => {
    if (stockPurpose === "PACKAGING") {
      setStockStrategy("PACKAGING_STOCK")
      return
    }
    if (!stopsAtFinalStep) {
      setStockStrategy("INTERMEDIATE_POOL")
      return
    }
    if (!stockStrategy || !["FINAL_STOCK", "INTERMEDIATE_POOL", "PACKAGING_STOCK"].includes(stockStrategy)) {
      setStockStrategy("FINAL_STOCK")
    }
  }, [stockPurpose, stopsAtFinalStep, stockStrategy])

  useEffect(() => {
    if (stockPurpose !== "PACKAGING") return
    if (packagingOutputUom === "KG" || packagingOutputUom === "PCS" || packagingOutputUom === "METER") {
      setQuantityUom(packagingOutputUom as "KG" | "PCS" | "METER")
    }
  }, [packagingOutputUom, stockPurpose])

  const refreshPreview = async () => {
    try {
      setPreviewing(true)
      setPreviewError(null)
      const normalizedLayers = (payload.film_layers || []).filter((layer: any) => layer.family_id && layer.variant_id)
      const hasPreviewableLayers = normalizedLayers.some((layer: any) => {
        const hasThickness = asNumber(layer?.thickness_micron, 0) > 0
        if (!hasThickness) return false
        if (finalProductType === "ROLL") return asNumber(layer?.roll_width_mm, 0) > 0
        return asNumber(payload.geometry?.base?.width_mm, 0) > 0 && asNumber(payload.geometry?.base?.height_mm, 0) > 0
      })
      if (!templateId || !normalizedLayers.length || !hasPreviewableLayers) {
        setPreview(null)
        setPreviewError(
          finalProductType === "ROLL"
            ? "Preview needs Layer 1 roll width, thickness, and quantity."
            : "Preview needs at least one valid film layer plus pouch width and height.",
        )
        return
      }
      const data = await salesService.previewItem({
        finished_good_type: (finalProductType || fgType) as "POUCH" | "ROLL",
        geometry: payload.geometry,
        film_layers: normalizedLayers,
        printing: payload.printing,
        chemicals: payload.chemicals,
        addons: payload.addons,
        order_qty: asNumber(quantity, 0),
        uom: quantityUom as "PCS" | "KG",
      } as any)
      setPreview(data)
    } catch (error: any) {
      setPreview(null)
      setPreviewError(String(error?.response?.data?.detail || error?.response?.data?.error || error?.message || "Preview could not be refreshed."))
    } finally {
      setPreviewing(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!templateId || stockPurpose === "PACKAGING") return
      refreshPreview().catch(() => undefined)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [
    addons,
    frontColorsCount,
    heightMm,
    inkGsmTotal,
    layers,
    quantity,
    quantityUom,
    rollForm,
    selectedLaneIsCustom,
    selectedLaneIsPlanner,
    selectedLaneIsSales,
    stockPurpose,
    templateId,
    widthMm,
    printingEnabled,
  ])

  const canCreate = useMemo(() => {
    if (selectedLaneIsSales) {
      if (!selectedSalesSkuId || !selectedSalesSkuVariantId) return false
    }
    if (selectedLaneIsPlanner && !selectedPlannerPresetId) return false
    if (selectedLaneIsCustom && !templateId) return false
    if (launcherMode === "POD_STOCK" && !effectivePodSkuVariantId) return false
    if (stockPurpose === "PACKAGING" && !effectivePackagingMaterialId) return false
    if (asNumber(quantity, 0) <= 0) return false
    if (!templateId && launcherMode !== "POD_STOCK") return false
    return true
  }, [
    launcherMode,
    effectivePackagingMaterialId,
    effectivePodSkuVariantId,
    quantity,
    selectedLaneIsCustom,
    selectedLaneIsPlanner,
    selectedLaneIsSales,
    selectedPlannerPresetId,
    selectedSalesSkuId,
    selectedSalesSkuVariantId,
    stockPurpose,
    templateId,
  ])

  const variantList = selectedLaneIsPlanner ? filteredPlannerPresets : salesLaneVariants
  const variantListTitle = selectedLaneIsPlanner ? "Launch presets" : "Launch variants"
  const filteredVariantList = useMemo(() => {
    const query = variantSearch.trim().toLowerCase()
    if (!query) return variantList
    return variantList.filter((variant: any) =>
      [variant.code, variant.name, variant.template_name, variant.finished_good_type, variant.launch_kind]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    )
  }, [variantList, variantSearch])
  const selectedVariantSummary = selectedLaneIsPlanner
    ? (selectedPlannerPreset?.code || selectedPlannerPreset?.name || "Choose preset")
    : selectedLaneIsSales
      ? (selectedSalesVariant?.code || selectedSalesVariant?.name || "Choose variant")
      : (selectedTemplate?.name || "Choose template")
  const previewGeometry = preview?.physics?.geometry_snapshot || {}
  const previewRoll = preview?.roll_preview || preview?.physics?.roll_preview || null
  const resolvedPlant = useMemo(
    () => plants.find((plant: any) => String(plant.id) === String(plantId || "")) || null,
    [plants, plantId],
  )
  const seededTemplateName = useMemo(() => {
    if (selectedLaneIsCustom) return selectedTemplate?.name || "Route default"
    if (selectedLaneIsPlanner) return selectedPlannerPreset?.template_name || "Route default"
    if (selectedLaneIsSales) return (selectedSalesVariant as any)?.template_name || (selectedSalesSku as any)?.template_name || "Route default"
    return "Route default"
  }, [selectedLaneIsCustom, selectedLaneIsPlanner, selectedLaneIsSales, selectedPlannerPreset, selectedSalesSku, selectedSalesVariant, selectedTemplate])
  const routeStartLabel = routeSteps.find((step: any) => Number(step.index) === Number(startStepIndex))
  const routeStopLabel = routeSteps.find((step: any) => Number(step.index) === Number(stopStepIndex ?? routeLastIndex))
  const resolvedPlantLabel = resolvedPlant?.name || (selectedLaneIsCustom ? "Resolve from selected route" : "Auto from route")
  const resolvedRouteLabel = routeSteps.length
    ? `Step ${startStepIndex} to ${stopStepIndex ?? routeLastIndex}`
    : "Route resolves from template"
  const showSeededSpecOverrides = selectedLaneIsCustom || showTechnicalSnapshot
  const routeStepsAreEditable = selectedLaneIsCustom || selectedLaneIsSales
  const laneSummaryCopy = selectedLaneIsSales
    ? "Sales SKU gives the approved commercial spec and only launches final roll or pouch stock. Planner presets own invariant, WIP, POD, and packaging stock launches."
    : selectedLaneIsPlanner
      ? "Planner preset already owns route span, stock intent, geometry, and material truth. Confirm quantity, adjust only when needed, and queue the line."
      : "Custom is the full manual path. Use it only when neither a planner preset nor a sales SKU can express the job correctly."
  const seededIdentityLabel = selectedLaneIsPlanner
    ? (selectedPlannerPreset?.name || selectedPlannerPreset?.code || "Choose planner preset")
    : selectedLaneIsSales
      ? (selectedSalesVariant?.name || selectedSalesVariant?.code || "Choose sales variant")
      : (selectedTemplate?.name || "Choose template")
  const currentEstimatedKg = useMemo(() => {
    if (stockPurpose === "PACKAGING") return quantityUom === "KG" ? asNumber(quantity, 0) : null
    if (quantityUom === "KG") return asNumber(quantity, 0)
    return preview ? asNumber(preview.total_weight_kg, 0) : null
  }, [preview, quantity, quantityUom, stockPurpose])
  const currentEstimatedPcs = useMemo(() => {
    if (stockPurpose !== "PRODUCT" || finalProductType === "ROLL") return null
    if (quantityUom === "PCS") return asNumber(quantity, 0)
    const unitWeightG = asNumber(preview?.unit_weight_g, 0)
    if (quantityUom === "KG" && unitWeightG > 0) {
      return Math.round((asNumber(quantity, 0) * 1000) / unitWeightG)
    }
    return null
  }, [finalProductType, preview, quantity, quantityUom, stockPurpose])
  const currentSourceLabel = selectedLaneIsPlanner
    ? [selectedPlannerSku?.code, selectedPlannerPreset?.code].filter(Boolean).join(" / ")
    : selectedLaneIsSales
      ? [selectedSalesSku?.code, selectedSalesVariant?.code].filter(Boolean).join(" / ")
      : "Manual route build"
  const currentLineName = String(lineLabel || seededIdentityLabel || selectedTemplate?.name || "Stock line").trim()
  const currentRouteDetail = routeSteps.length
    ? `${stepTitle(routeStartLabel)} -> ${stepTitle(routeStopLabel)}`
    : "Route resolves from template"
  const normalizedFinalProductType: "POUCH" | "ROLL" | null = finalProductType === "ROLL"
    ? "ROLL"
    : finalProductType === "POUCH"
      ? "POUCH"
      : null
  const queueCounts = useMemo(() => ({
    draft: cartLines.filter((line) => line.submitStatus === "draft").length,
    submitting: cartLines.filter((line) => line.submitStatus === "submitting").length,
    released: cartLines.filter((line) => line.submitStatus === "released").length,
    failed: cartLines.filter((line) => line.submitStatus === "failed").length,
  }), [cartLines])
  const releasableCount = queueCounts.draft + queueCounts.failed
  const canQueue = canCreate

  const updateCartLine = (localId: string, updater: (line: PlannerCartLine) => PlannerCartLine) => {
    setCartLines((current) => current.map((line) => (line.localId === localId ? updater(line) : line)))
  }

  const savePlannerPresetForLine = async (line: PlannerCartLine, createdOrder: any) => {
    if (!line.saveAsPlannerPreset || line.lane === "PLANNER") return
    const seed = line.presetSeed
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12)
    const codeBase = String(
      seed.selectedPlannerSkuCode ||
      seed.selectedSalesSkuCode ||
      seed.selectedTemplateName ||
      "PLANNER",
    )
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toUpperCase() || "PLANNER"

    const fallbackPlannerSku = {
      id: seed.selectedPlannerSkuId,
      code: codeBase,
      name: seed.selectedPlannerSkuName || "Planner",
    }

    const sku = seed.selectedPlannerSkuId
      ? fallbackPlannerSku
      : await plannerService.createPlannerSku({
          code: `PLN-${codeBase}-${stamp}`,
          name: `${seed.selectedTemplateName || seed.selectedSalesSkuName || "Planner"} Preset`,
          template: seed.templateId,
          default_plant: seed.plantId || undefined,
          notes: seed.notes || `Created from planner launch cart (${plannerLaneLabel(seed.launchLane)} / ${launchModeLabel(seed.launcherMode)}).`,
          active: true,
        })

    await plannerService.createPlannerSkuVariant({
      sku: sku.id,
      code: `${codeBase}-${seed.launcherMode}-${stamp}`,
      name: seed.lineLabel || `${seed.selectedTemplateName || seed.selectedSalesSkuName || "Planner"} ${launchModeLabel(seed.launcherMode)}`,
      active: true,
      launch_kind: seed.launcherMode,
      template: seed.templateId || undefined,
      default_plant: seed.plantId || undefined,
      default_qty: seed.quantity,
      quantity_uom: seed.quantityUom,
      stock_purpose: seed.stockPurpose,
      stock_strategy: seed.stockStrategy,
      planner_stock_class:
        seed.stockPurpose === "PACKAGING" ? "PACKAGING_STOCK"
          : seed.launcherMode === "SHARED_INVARIANT_ROLL" ? "SHARED_INVARIANT_ROLL"
            : seed.launcherMode === "BASE_UPSTREAM_ROLL" ? "EXTRUDED_BASE_ROLL"
              : seed.launcherMode === "FINAL_ROLL" ? (seed.finalProductType === "ROLL" ? "FINAL_PLAIN_ROLL" : "FINAL_PRODUCT")
                : "FINAL_PRODUCT",
      start_step_index: seed.startStepIndex,
      stop_step_index: seed.stopStepIndex,
      geometry_snapshot: line.payload.geometry,
      layer_snapshot: line.payload.film_layers,
      printing_snapshot: line.payload.printing,
      addons_snapshot: line.payload.addons,
      packaging_snapshot: line.payload.packaging_snapshot,
      packaging_material: seed.stockPurpose === "PACKAGING" ? seed.packagingMaterialId || undefined : undefined,
      pod_sku_variant: seed.launcherMode === "POD_STOCK" ? seed.podSkuVariantId || undefined : undefined,
      spec_signature: createdOrder?.spec_signature || "",
      invariant_signature: createdOrder?.invariant_signature || "",
      planner_origin_meta: {
        naming_source: "launcher_save",
        launch_kind: seed.launcherMode,
        source_lane: seed.launchLane,
        sales_sku_variant_id: seed.selectedSalesSkuVariantId || undefined,
      },
    })
  }

  const addCurrentLineToCart = () => {
    if (!canQueue) {
      toast({
        title: "Line is incomplete",
        description: "Select a launchable SKU or preset, confirm route inputs, and enter quantity before adding the line.",
        variant: "destructive",
      })
      return
    }

    const nextLine: PlannerCartLine = {
      localId: makeLocalId(),
      name: currentLineName,
      lane: launchLane,
      outputClass: selectedOutputClass,
      outputLabel: outputSummary,
      sourceLabel: currentSourceLabel || plannerLaneLabel(launchLane),
      templateName: seededTemplateName,
      routeLabel: resolvedRouteLabel,
      routeDetail: currentRouteDetail,
      quantity: asNumber(quantity, 0),
      quantityUom,
      estimatedKg: currentEstimatedKg,
      estimatedPcs: currentEstimatedPcs,
      previewWidthMm: asNumber(previewGeometry.effective_width_mm || previewRoll?.width_mm, 0) || null,
      previewHeightMm: finalProductType === "POUCH" ? asNumber(previewGeometry.effective_height_mm || previewGeometry.height_mm, 0) || null : null,
      previewLengthM: previewRoll ? asNumber(previewRoll.derived_length_m, 0) || null : null,
      previewAreaM2: !previewRoll && preview ? asNumber(previewGeometry.area_m2, 0) || null : null,
      payload: deepClone(payload as CreateStockOrderPayload),
      notes,
      finalProductType: normalizedFinalProductType,
      previewError,
      submitStatus: "draft",
      submitError: "",
      createdOrderId: "",
      createdOrderNumber: "",
      createdOrderKind: "",
      saveAsPlannerPreset,
      presetSeed: {
        selectedPlannerSkuId,
        selectedPlannerSkuCode: String(selectedPlannerSku?.code || ""),
        selectedPlannerSkuName: String(selectedPlannerSku?.name || ""),
        selectedSalesSkuCode: String(selectedSalesSku?.code || ""),
        selectedSalesSkuName: String(selectedSalesSku?.name || ""),
        selectedTemplateName: seededTemplateName,
        lineLabel: currentLineName,
        notes,
        templateId,
        plantId,
        quantity: asNumber(quantity, 0),
        quantityUom,
        stockPurpose,
        stockStrategy,
        packagingMaterialId,
        podSkuVariantId,
        launcherMode,
        launchLane,
        finalProductType: normalizedFinalProductType,
        startStepIndex: asNumber(startStepIndex, 0),
        stopStepIndex,
        selectedSalesSkuVariantId,
      },
    }

    setCartLines((current) => [nextLine, ...current])
    setNotes("")
    toast({
      title: "Line queued",
      description: `${nextLine.name} is ready in the release cart.`,
    })
  }

  const releaseQueuedLines = async () => {
    if (!releasableCount) {
      toast({
        title: "Nothing to release",
        description: "Add at least one draft line to the cart first.",
        variant: "destructive",
      })
      return
    }

    const releasableLines = cartLines.filter((line) => ["draft", "failed"].includes(line.submitStatus))

    try {
      setSubmittingCart(true)
      let createdCount = 0
      let failedCount = 0
      const failedLineIds = new Set<string>()

      releasableLines.forEach((line) => {
        updateCartLine(line.localId, (current) => ({
          ...current,
          submitStatus: "submitting",
          submitError: "",
        }))
      })

      let bulkCreated: any[] = []
      try {
        const bulk = await plannerService.createStockOrdersBulk(
          releasableLines.map((line) => line.payload),
          makeLocalId(),
        )
        bulkCreated = Array.isArray(bulk.created) ? bulk.created : []
      } catch (error: any) {
        const failed = error?.response?.data?.failed
        const fallbackError = String(error?.response?.data?.error || error?.message || "Could not create this stock order.")
        releasableLines.forEach((line, index) => {
          const rowError = Array.isArray(failed)
            ? failed.find((row: any) => Number(row?.index) === index)?.error
            : null
          updateCartLine(line.localId, (current) => ({
            ...current,
            submitStatus: "failed",
            submitError: typeof rowError === "string" ? rowError : rowError ? JSON.stringify(rowError) : fallbackError,
          }))
        })
        toast({
          title: "Batch release blocked",
          description: "No orders were created because at least one cart line failed contract validation.",
          variant: "destructive",
        })
        return
      }

      for (const createdOrder of bulkCreated) {
        const line = releasableLines[Number(createdOrder?.index)]
        if (!line) continue
        try {
          const orderId = String(createdOrder?.order_id || createdOrder?.stock_order_id || "")
          if (!orderId) throw new Error("Stock order was created without an order id.")
          const createdOrderNumber = String(createdOrder?.order_number || "")
          const createdOrderKind: "stock" | "bulk" =
            String(createdOrder?.order_kind || "").toLowerCase() === "bulk" || createdOrderNumber.startsWith("PBK-")
              ? "bulk"
              : "stock"
          if (createdOrderKind === "stock") {
            await plannerService.releasePlannedOrder("stock", orderId)
          }
          await savePlannerPresetForLine(line, createdOrder)
          createdCount += 1

          updateCartLine(line.localId, (current) => ({
            ...current,
            submitStatus: "released",
            createdOrderId: orderId,
            createdOrderNumber,
            createdOrderKind,
          }))
        } catch (error: any) {
          failedCount += 1
          failedLineIds.add(line.localId)
          updateCartLine(line.localId, (current) => ({
            ...current,
            submitStatus: "failed",
            submitError: String(error?.response?.data?.error || error?.message || "Could not create and release this stock order."),
          }))
        }
      }

      toast({
        title: "Batch release completed",
        description: failedCount
          ? `${createdCount} order${createdCount === 1 ? "" : "s"} released, ${failedCount} failed. Failed lines stayed in the cart.`
          : `${createdCount} order${createdCount === 1 ? "" : "s"} released. The cart is cleared for the next entry.`,
        variant: failedCount ? "destructive" : "default",
      })
      if (createdCount > 0) {
        const submittedLineIds = new Set(releasableLines.map((line) => line.localId))
        setCartLines((current) => current.filter((line) => !submittedLineIds.has(line.localId) || failedLineIds.has(line.localId)))
      }
    } finally {
      setSubmittingCart(false)
    }
  }

  const removeCartLine = (localId: string) => {
    setCartLines((current) => current.filter((line) => line.localId !== localId))
  }

  const clearDraftLines = () => {
    setCartLines((current) => current.filter((line) => line.submitStatus === "released" || line.submitStatus === "submitting"))
  }

  const statusLabel = (status: CartLineStatus) => {
    if (status === "released") return "Released"
    if (status === "failed") return "Failed"
    if (status === "submitting") return "Submitting"
    return "Draft"
  }

  const showRouteSelectors = routeStepsAreEditable && routeSteps.length > 0
  const previewUnitWeight = asNumber(preview?.unit_weight_g, Number.NaN)
  const previewArea = asNumber(previewGeometry.area_m2 || previewRoll?.area_m2, Number.NaN)
  const previewWidth = asNumber(
    previewGeometry.effective_width_mm ||
      previewGeometry.width_mm ||
      previewRoll?.width_mm ||
      layers[0]?.roll_width_mm ||
      widthMm,
    0,
  )
  const previewHeight = asNumber(
    previewGeometry.effective_height_mm ||
      previewGeometry.height_mm ||
      (finalProductType === "ROLL" ? layers[0]?.roll_width_mm : heightMm),
    0,
  )
  const previewUnitWeightLabel = Number.isFinite(previewUnitWeight) && previewUnitWeight > 0
    ? `${previewUnitWeight.toFixed(2)} g`
    : "—"
  const previewTotalWeightLabel = currentEstimatedKg !== null
    ? `${currentEstimatedKg.toFixed(2)} KG`
    : currentEstimatedPcs !== null
      ? `${currentEstimatedPcs.toLocaleString()} PCS`
      : "—"
  const previewGeometryLabel = finalProductType === "ROLL"
    ? `${previewWidth || "—"} mm roll${rollForm ? ` · ${rollForm}` : ""}`
    : `${previewWidth || "—"} × ${previewHeight || "—"} mm`
  const previewGeometryMeta = finalProductType === "ROLL"
    ? [
        previewRoll?.derived_length_m ? `${asNumber(previewRoll.derived_length_m, 0).toFixed(0)} m derived length` : null,
        Number.isFinite(previewArea) ? `area ${previewArea.toFixed(4)} m2/m` : null,
      ].filter(Boolean).join(" · ") || "Roll output"
    : [
        previewGeometry.style || previewGeometry.pouch_style ? `style ${String(previewGeometry.style || previewGeometry.pouch_style).toUpperCase()}` : null,
        Number.isFinite(previewArea) ? `area ${previewArea.toFixed(4)} m2` : null,
      ].filter(Boolean).join(" · ") || "Finished pouch"
  const previewBom = (preview?.bom || preview?.physics?.bom || {}) as Record<string, any>
  const previewBomCount = (key: string) => (Array.isArray(previewBom?.[key]) ? previewBom[key].length : 0)
  const previewBomRows = [
    { label: "Films", value: Math.max(previewBomCount("films"), (payload as any).film_layers?.length || 0), required: true },
    { label: "Granules", value: previewBomCount("granules"), required: true },
    { label: "Inks", value: previewBomCount("inks"), required: printingEnabled },
    { label: "Chemicals", value: previewBomCount("chemicals"), required: printingEnabled || adhesiveGsm > 0 || solventGsm > 0 },
    { label: "Add-ons", value: Math.max(previewBomCount("addons"), (payload as any).addons?.length || 0), required: Boolean((payload as any).addons?.length) },
  ]
  const previewStatusLabel = previewError ? "Check inputs" : preview ? "Preview ready" : previewing ? "Previewing" : "Waiting for preview"

  return (
    <div className={styles.shell} data-testid="planner-stock-launch-studio">
      {/* ===== HEADER BAR ===== */}
      <header className={styles.headerBar}>
        <button type="button" className={styles.backBtn} onClick={() => router.push("/production/planner")} title="Back to Planner">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>Production · Planner</span>
          <h1 className={styles.title}>Create Stock Order</h1>
          <p className={styles.subtitle}>Launch from sales SKU, planner preset, or custom spec with the same route math.</p>
        </div>
        <div className={styles.headerSpacer} />

        <div className={styles.pillToggle}>
          {(["SALES", "PLANNER", "CUSTOM"] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              data-testid={`planner-stock-lane-${String(lane).toLowerCase()}`}
              className={cn(styles.pillBtn, launchLane === lane && styles.pillBtnActive)}
              onClick={() => {
                setLaunchLane(lane)
                setVariantSearch("")
              }}
            >
              {lane === "SALES" ? "Sales" : lane === "PLANNER" ? "Planner" : "Custom"}
            </button>
          ))}
        </div>

        <div className={styles.pillToggle}>
          {visibleOutputClasses.map((output) => (
            <button
              key={output}
              type="button"
              data-testid={`planner-stock-output-${String(output).toLowerCase()}`}
              className={cn(
                styles.pillBtn,
                selectedOutputClass === output && styles.pillBtnActive,
                outputDisabledReasons[output] && styles.pillBtnDisabled,
              )}
              onClick={() => {
                if (outputDisabledReasons[output]) return
                if (selectedLaneIsPlanner) {
                  setPlannerOutputFilter(output)
                  return
                }
                applyOutputClass(output)
              }}
              disabled={Boolean(outputDisabledReasons[output])}
              title={
                selectedLaneIsPlanner
                  ? "Filter planner presets by output type."
                  : outputDisabledReasons[output] || plannerOutputCopy(output)
              }
            >
              {plannerOutputShortLabel(output)}
            </button>
          ))}
        </div>

        <div className={styles.headerRight}>
          {lookupErrors.length ? (
            <span className={styles.warnDot} title={lookupErrors.join(" ")}>
              <AlertTriangle className="h-3 w-3" />
            </span>
          ) : null}
          <Badge variant="outline" className={styles.cartBadge}>{cartLines.length} in cart</Badge>
          <Button data-testid="planner-stock-release-all-header" size="sm" className={styles.releaseHeaderBtn} onClick={releaseQueuedLines} disabled={!releasableCount || submittingCart || creating}>
            {submittingCart ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : <Rocket className="mr-1 h-3 w-3" />}
            Release all {releasableCount ? `(${releasableCount})` : ""}
          </Button>
        </div>
      </header>

      {/* ===== MAIN LAYOUT ===== */}
      <div className={styles.mainLayout}>
        {/* --- WORK COLUMN --- */}
        <div className={styles.workColumn}>

          {/* SKU Picker */}
          <div className={styles.panel}>
            <div className={styles.panelTopline}>
              <span className={styles.panelLabel}>{plannerLaneLabel(launchLane)} source</span>
              {selectedLaneIsSales ? (
                <button type="button" className={styles.panelActionLink} onClick={() => router.push("/sales/sku-catalog?create_variant=1")}>
                  <Plus className="h-3 w-3" />
                  Create new sales variant
                </button>
              ) : null}
              {selectedLaneIsPlanner ? (
                <button type="button" className={styles.panelActionLink} onClick={() => router.push("/production/planner/sku-catalog?create_variant=1")}>
                  <Plus className="h-3 w-3" />
                  Create planner variant
                </button>
              ) : null}
            </div>
            <div className={styles.skuRow}>
              {selectedLaneIsSales ? (
                <>
                  <div className={cn(styles.skuField)}>
                    <Label>Sales SKU</Label>
                    <Select
                      value={selectedSalesSkuId}
                      onValueChange={(value) => {
                        setSelectedSalesSkuId(value)
                        setSelectedSalesSkuVariantId("")
                        setTemplateId("")
                        setLineLabel("")
                        setPreview(null)
                        setPreviewError(null)
                      }}
                    >
                      <SelectTrigger aria-label="Sales SKU" data-testid="planner-stock-sales-sku">
                        <SelectValue placeholder="Select SKU" />
                      </SelectTrigger>
                      <SelectContent>
                        {salesLaneSkus.map((sku) => (
                          <SelectItem key={sku.id} value={String(sku.id)}>{sku.code} · {sku.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cn(styles.skuField)}>
                    <Label>Variant ({filteredVariantList.length})</Label>
                    <Select value={selectedSalesSkuVariantId} onValueChange={setSelectedSalesSkuVariantId}>
                      <SelectTrigger aria-label="Sales SKU variant" data-testid="planner-stock-sales-variant">
                        <SelectValue placeholder="Select variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredVariantList.map((variant: any) => (
                          <SelectItem key={variant.id} value={String(variant.id)}>
                            {variant.code} · {variant.name} · {normalizePlannerFgType(variant.finished_good_type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    value={variantSearch}
                    onChange={(event) => setVariantSearch(event.target.value)}
                    placeholder="Filter..."
                    aria-label="Filter variants"
                    className={styles.searchInput}
                  />
                </>
              ) : null}

              {selectedLaneIsPlanner ? (
                <>
                  <div className={cn(styles.skuField)}>
                    <Label>SKU Family</Label>
                    <Select
                      value={selectedPlannerSkuId}
                      onValueChange={(value) => {
                        setSelectedPlannerSkuId(value)
                        setSelectedPlannerPresetId("")
                        setTemplateId("")
                        setLineLabel("")
                        setPreview(null)
                        setPreviewError(null)
                      }}
                    >
                      <SelectTrigger aria-label="Planner SKU family" data-testid="planner-stock-planner-family">
                        <SelectValue placeholder="Select SKU" />
                      </SelectTrigger>
                      <SelectContent>
                        {plannerLaneSkus.map((sku) => (
                          <SelectItem key={sku.id} value={String(sku.id)}>{sku.code} · {sku.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cn(styles.skuField)}>
                    <Label>Preset ({filteredVariantList.length})</Label>
                    <Select value={selectedPlannerPresetId} onValueChange={setSelectedPlannerPresetId}>
                      <SelectTrigger aria-label="Planner preset" data-testid="planner-stock-planner-preset">
                        <SelectValue placeholder="Select preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredVariantList.map((preset: any) => (
                          <SelectItem key={preset.id} value={String(preset.id)}>
                            {preset.code} · {preset.name} · {launchModeLabel(preset.launch_kind)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    value={variantSearch}
                    onChange={(event) => setVariantSearch(event.target.value)}
                    placeholder="Filter..."
                    aria-label="Filter planner presets"
                    className={styles.searchInput}
                  />
                </>
              ) : null}

              {selectedLaneIsCustom ? (
                <div className={cn(styles.skuField)}>
                  <Label>Template</Label>
                  <Select value={templateId} onValueChange={setTemplateId}>
                      <SelectTrigger aria-label="Template" data-testid="planner-stock-template">
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template: any) => (
                        <SelectItem key={template.id} value={String(template.id)}>{template.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className={styles.sourceSummary}>{laneSummaryCopy}</div>
            <div className={styles.sourceMetaRow}>
              <span className={styles.sourceMetaChip}>{currentSourceLabel}</span>
              <span className={styles.sourceMetaChip}>{seededTemplateName}</span>
              <span className={styles.sourceMetaChip}>{plannerOutputLabel(selectedOutputClass)}</span>
            </div>
          </div>

          {/* Line Composer */}
          <div className={styles.panel}>
            <div className={styles.composer}>
              {/* Row 1: Label + Quantity + Unit */}
              <div className={styles.formRow}>
                <div className={cn(styles.fieldBlock, styles.fieldFlex)}>
                  <Label>Line label</Label>
                  <Input value={lineLabel} onChange={(event) => setLineLabel(event.target.value)} placeholder={seededIdentityLabel} />
                </div>
                <div className={cn(styles.fieldBlock, styles.fieldQty)}>
                  <Label>Quantity</Label>
                  <Input data-testid="planner-stock-qty" type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value || 0))} />
                </div>
                <div className={cn(styles.fieldBlock, styles.fieldUom)}>
                  <Label>Unit</Label>
                  <Select value={quantityUom} onValueChange={(value: any) => setQuantityUom(value)} disabled={selectedLaneIsPlanner || (stockPurpose === "PACKAGING" && !!packagingOutputUom)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stockPurpose === "PACKAGING" && packagingOutputUom ? (
                        <SelectItem value={packagingOutputUom}>{packagingOutputUom}</SelectItem>
                      ) : (
                        <>
                          <SelectItem value="KG">KG</SelectItem>
                          {finalProductType !== "ROLL" ? <SelectItem value="PCS">PCS</SelectItem> : null}
                          {stockPurpose !== "PRODUCT" ? <SelectItem value="METER">METER</SelectItem> : null}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Row 2: Route (conditional) */}
              {showRouteSelectors ? (
                <div className={styles.formRow}>
                  <div className={cn(styles.fieldBlock, styles.fieldHalf)}>
                    <Label>Route start</Label>
                    <Select value={String(startStepIndex)} onValueChange={(value) => setStartStepIndex(Number(value || 0))} disabled={!routeSteps.length}>
                      <SelectTrigger aria-label="Route start" data-testid="planner-stock-route-start">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Start at raw</SelectItem>
                        {routeSteps.map((step: any) => (
                          <SelectItem key={`start-${step.index}`} value={String(step.index)}>{stepTitle(step)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={cn(styles.fieldBlock, styles.fieldHalf)}>
                    <Label>Route stop</Label>
                    <Select value={String(stopStepIndex ?? routeLastIndex)} onValueChange={(value) => setStopStepIndex(Number(value || routeLastIndex))} disabled={!routeSteps.length}>
                      <SelectTrigger aria-label="Route stop" data-testid="planner-stock-route-stop">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {routeSteps.map((step: any) => (
                          <SelectItem key={`stop-${step.index}`} value={String(step.index)}>{stepTitle(step)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : routeSteps.length ? (
                <div className={styles.routeReadonly}>
                  <span>Route:</span>
                  <strong>{resolvedRouteLabel}</strong>
                  <span className={styles.routeArrow}>|</span>
                  <span>{currentRouteDetail}</span>
                </div>
              ) : null}

              {/* Row 3: Conditional — Packaging or POD */}
              {selectedOutputClass === "PACKAGING" ? (
                <div className={styles.formRow}>
                  <div className={cn(styles.fieldBlock, styles.fieldFlex)}>
                    <Label>Packaging material</Label>
                    <Select value={effectivePackagingMaterialId || "__NONE__"} onValueChange={(value) => setPackagingMaterialId(value === "__NONE__" ? "" : value)}>
                      <SelectTrigger data-testid="planner-stock-packaging-material"><SelectValue placeholder="Select material" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">Select packaging material</SelectItem>
                        {packagingMaterials.map((material: any) => (
                          <SelectItem key={material.id} value={String(material.id)}>{material.code} · {material.name} ({material.base_uom})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {selectedOutputClass === "POD" ? (
                <div className={styles.formRow}>
                  <div className={cn(styles.fieldBlock, styles.fieldFlex)}>
                    <Label>POD SKU variant</Label>
                    <Select value={effectivePodSkuVariantId || "__NONE__"} onValueChange={(value) => setPodSkuVariantId(value === "__NONE__" ? "" : value)}>
                      <SelectTrigger data-testid="planner-stock-pod-variant"><SelectValue placeholder="Select POD variant" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">Select POD variant</SelectItem>
                        {podSkuVariants.map((variant: any) => (
                          <SelectItem key={variant.id} value={String(variant.id)}>{variant.code} · {variant.name || variant.pod_sku_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}

              {/* Row 4: Width/Height overrides */}
              {showSeededSpecOverrides ? (
                <div className={styles.formRow}>
                  <div className={cn(styles.fieldBlock, styles.fieldHalf)}>
                    <Label>{finalProductType === "ROLL" ? "Roll width (mm)" : "Width (mm)"}</Label>
                    <Input
                      type="number"
                      value={finalProductType === "ROLL" ? asNumber(layers[0]?.roll_width_mm, 0) : widthMm}
                      onChange={(event) => {
                        const value = Number(event.target.value || 0)
                        if (finalProductType === "ROLL") {
                          setLayers((current) => current.map((layer, index) => index === 0 ? { ...layer, roll_width_mm: value } : layer))
                          return
                        }
                        setWidthMm(value)
                      }}
                    />
                  </div>
                  <div className={cn(styles.fieldBlock, styles.fieldHalf)}>
                    <Label>{finalProductType === "ROLL" ? "Height (not used)" : "Height (mm)"}</Label>
                    <Input type="number" value={finalProductType === "ROLL" ? 0 : heightMm} onChange={(event) => setHeightMm(Number(event.target.value || 0))} disabled={finalProductType === "ROLL"} />
                  </div>
                </div>
              ) : null}

              <div className={styles.previewCard}>
                <div className={styles.previewCardHeader}>
                  <div>
                    <span className={styles.panelLabel}>Preview · live math from physics engine</span>
                    <p className={styles.previewCopy}>Same preview contract used by sales order and planner stock creation.</p>
                  </div>
                  <Badge variant="outline" className={cn(styles.previewStatus, previewError && styles.previewStatusError)}>
                    {previewing ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : null}
                    {previewStatusLabel}
                  </Badge>
                </div>

                <div className={styles.previewMetricGrid}>
                  <div className={styles.previewMetric}>
                    <span>Unit weight</span>
                    <strong>{previewUnitWeightLabel}</strong>
                  </div>
                  <div className={styles.previewMetric}>
                    <span>Total weight</span>
                    <strong>{previewTotalWeightLabel}</strong>
                  </div>
                  <div className={styles.previewMetric}>
                    <span>Geometry</span>
                    <strong>{previewGeometryLabel}</strong>
                    <small>{previewGeometryMeta}</small>
                  </div>
                  <div className={styles.previewMetric}>
                    <span>Output</span>
                    <strong>{plannerOutputLabel(selectedOutputClass)}</strong>
                    <small>{strategySummary}</small>
                  </div>
                </div>

                <div className={styles.previewStrip}>
                  <span className={cn(styles.previewChip, styles.previewChipKg)}>
                    {currentEstimatedKg !== null ? `${currentEstimatedKg.toFixed(2)} KG` : "— KG"}
                  </span>
                  <span className={cn(styles.previewChip, styles.previewChipPcs)}>
                    {currentEstimatedPcs !== null ? `${currentEstimatedPcs.toLocaleString()} PCS` : "— PCS"}
                  </span>
                  <span className={styles.previewChip}>{resolvedRouteLabel}</span>
                  <span className={styles.previewChip}>{selectedVariantSummary}</span>
                </div>

                <div className={styles.previewBomGrid}>
                  {previewBomRows.map((row) => {
                    const ok = row.value > 0 || !row.required
                    return (
                      <div key={row.label} className={cn(styles.previewBomRow, ok ? styles.previewBomOk : styles.previewBomWarn)}>
                        <span>{row.label}</span>
                        <strong>{row.value ? `${row.value} line${row.value === 1 ? "" : "s"}` : row.required ? "Needed" : "0 lines"}</strong>
                      </div>
                    )
                  })}
                </div>
              </div>

              {previewError ? (
                <div className={styles.inlineAlert}>
                  <AlertTriangle className="h-3 w-3" />
                  <span>{previewError}</span>
                </div>
              ) : null}

              {/* Action row: Notes + Save Preset + Add */}
              <div className={styles.actionRow}>
                <Input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Launch notes (optional)"
                  className={styles.notesInput}
                />
                {!selectedLaneIsPlanner ? (
                  <label className={styles.compactSwitch}>
                    <Switch checked={saveAsPlannerPreset} onCheckedChange={setSaveAsPlannerPreset} />
                    <span>Save as preset</span>
                  </label>
                ) : null}
                <Button data-testid="planner-stock-add-to-cart" className={styles.addBtn} onClick={addCurrentLineToCart} disabled={!canQueue || submittingCart}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add to cart
                </Button>
              </div>

              {/* Spec editor toggle + section */}
              <div className={styles.specToggleRow}>
                <span className={styles.inlineHint}>{strategySummary} · {resolvedPlantLabel} · {seededTemplateName}</span>
                <Button variant="outline" size="sm" className={styles.specToggleBtn} onClick={() => {
                  setShowTechnicalSnapshot((open) => !open)
                  setShowAdvancedCustom((open) => !open)
                }}>
                  {showTechnicalSnapshot ? "Hide spec editor" : "Open spec editor"}
                </Button>
              </div>
            </div>

            {(selectedLaneIsCustom || showAdvancedCustom || showTechnicalSnapshot) ? (
              <div className={styles.specEditor}>
                {(selectedLaneIsCustom || showAdvancedCustom) ? (
                  <div className={styles.specGrid}>
                    <div className={cn(styles.specCard, styles.specCardWide)}>
                      <div className={styles.sectionLabel}>Launch overrides</div>
                      <div className={styles.tightGrid}>
                        <div className={styles.fieldBlock}>
                          <Label>Plant override</Label>
                          <Select value={plantId || "__AUTO__"} onValueChange={(value) => setPlantId(value === "__AUTO__" ? "" : value)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__AUTO__">Auto from route</SelectItem>
                              {plants.map((plant: any) => (
                                <SelectItem key={plant.id} value={String(plant.id)}>
                                  {plant.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className={styles.fieldBlock}>
                          <Label>Selected source</Label>
                          <div className={styles.readonlyValue}>{currentSourceLabel || selectedVariantSummary}</div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.specCard}>
                      <div className={styles.sectionLabel}>Layer stack</div>
                      <div className={styles.stackRows}>
                        {layers.map((layer, index) => (
                          <div key={`layer-${index}`} className={styles.inlineRow}>
                            <Select
                              value={layer.family_id}
                              onValueChange={(value) => setLayers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, family_id: value } : row))}
                            >
                              <SelectTrigger><SelectValue placeholder="Family" /></SelectTrigger>
                              <SelectContent>
                                {families.map((family: any) => (
                                  <SelectItem key={family.id} value={String(family.id)}>{family.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={layer.variant_id}
                              onValueChange={(value) => setLayers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, variant_id: value } : row))}
                            >
                              <SelectTrigger><SelectValue placeholder="Variant" /></SelectTrigger>
                              <SelectContent>
                                {variants
                                  .filter((variant: any) => String(variant?.parent_family?.id || variant?.parent_family || "") === String(layer.family_id || ""))
                                  .map((variant: any) => (
                                    <SelectItem key={variant.id} value={String(variant.id)}>{variant.name}</SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={layer.thickness_micron}
                              onChange={(event) => setLayers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, thickness_micron: Number(event.target.value || 0) } : row))}
                              placeholder="Thickness"
                            />
                            <Input
                              type="number"
                              value={asNumber(layer.roll_width_mm, 0)}
                              onChange={(event) => setLayers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, roll_width_mm: Number(event.target.value || 0) } : row))}
                              placeholder="Roll width"
                            />
                            <Button variant="ghost" size="sm" onClick={() => setLayers((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" onClick={() => setLayers((current) => [...current, makeEmptyLayer()])}>
                          Add layer
                        </Button>
                      </div>
                    </div>

                    <div className={styles.specCard}>
                      <div className={styles.inlineHeader}>
                        <div>
                          <div className={styles.sectionLabel}>Printing</div>
                          <div className={styles.inlineHint}>Artwork, color counts, and ink load only.</div>
                        </div>
                        <Switch checked={printingEnabled} onCheckedChange={setPrintingEnabled} />
                      </div>
                      {printingEnabled ? (
                        <div className={styles.tightGrid}>
                          <div className={styles.fieldBlock}>
                            <Label>Print type</Label>
                            <Select value={printType} onValueChange={(value: any) => setPrintType(value)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="FLEXO">FLEXO</SelectItem>
                                <SelectItem value="ROTO">ROTO</SelectItem>
                                <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className={styles.fieldBlock}>
                            <Label>Film type</Label>
                            <Select value={substrateMode} onValueChange={(value: any) => {
                              setSubstrateMode(value)
                              if (value !== "TUBING") setBackColorsCount(0)
                            }}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="SHEET">SHEET</SelectItem>
                                <SelectItem value="TUBING">TUBING</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className={styles.fieldBlock}>
                            <Label>Front colors</Label>
                            <Input type="number" value={frontColorsCount} onChange={(event) => setFrontColorsCount(Number(event.target.value || 0))} />
                          </div>
                          {substrateMode === "TUBING" ? (
                          <div className={styles.fieldBlock}>
                            <Label>Back colors</Label>
                            <Input type="number" value={backColorsCount} onChange={(event) => setBackColorsCount(Number(event.target.value || 0))} />
                          </div>
                          ) : null}
                          <div className={styles.fieldBlock}>
                            <Label>Ink GSM total</Label>
                            <Input type="number" value={inkGsmTotal} onChange={(event) => setInkGsmTotal(Number(event.target.value || 0))} />
                          </div>
                          <div className={styles.fieldBlock}>
                            <Label>Artwork ID</Label>
                            <Input value={artworkId} onChange={(event) => setArtworkId(event.target.value)} placeholder="Optional" />
                          </div>
                        </div>
                      ) : <div className={styles.emptyState}>No print BOM for this stock order.</div>}
                    </div>

                    <div className={styles.specCard}>
                      <div className={styles.sectionLabel}>Chemistry and lamination</div>
                      <div className={styles.inlineHint}>Adhesive and solvent are separate from printing.</div>
                      {layers.length > 1 ? (
                        <div className={styles.tightGrid}>
                          <div className={styles.fieldBlock}>
                            <Label>Adhesive GSM</Label>
                            <Input type="number" value={adhesiveGsm} onChange={(event) => setAdhesiveGsm(Number(event.target.value || 0))} />
                          </div>
                          <div className={styles.fieldBlock}>
                            <Label>Solvent GSM</Label>
                            <Input type="number" value={solventGsm} onChange={(event) => setSolventGsm(Number(event.target.value || 0))} />
                          </div>
                        </div>
                      ) : <div className={styles.emptyState}>Single-layer stock does not need lamination chemistry.</div>}
                    </div>

                    <div className={styles.specCard}>
                      <div className={styles.inlineHeader}>
                        <div>
                          <div className={styles.sectionLabel}>Add-ons</div>
                          <div className={styles.inlineHint}>Extra operations that affect dimensions or output.</div>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => setAddons((current) => [...current, { addon_id: "", qty: 1, applies_to: "NONE" }])}>
                          Add add-on
                        </Button>
                      </div>
                      <div className={styles.stackRows}>
                        {addons.length ? addons.map((addon, index) => (
                          <div key={`addon-${index}`} className={styles.inlineRow}>
                            <Select
                              value={addon.addon_id}
                              onValueChange={(value) => setAddons((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, addon_id: value } : row))}
                            >
                              <SelectTrigger><SelectValue placeholder="Add-on" /></SelectTrigger>
                              <SelectContent>
                                {addonsMaster.map((item: any) => (
                                  <SelectItem key={item.id} value={String(item.id)}>
                                    {item.code} · {item.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={addon.qty}
                              onChange={(event) => setAddons((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(event.target.value || 0) } : row))}
                              placeholder="Qty"
                            />
                            <Select
                              value={addon.applies_to}
                              onValueChange={(value: any) => setAddons((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, applies_to: value } : row))}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">NONE</SelectItem>
                                <SelectItem value="WIDTH">WIDTH</SelectItem>
                                <SelectItem value="HEIGHT">HEIGHT</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="sm" onClick={() => setAddons((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                              Remove
                            </Button>
                          </div>
                        )) : <div className={styles.emptyState}>No add-ons selected.</div>}
                      </div>
                    </div>

                    <div className={cn(styles.specCard, styles.specCardWide)}>
                      <div className={styles.sectionLabel}>Packaging and dispatch pack</div>
                      {selectedOutputClass === "PACKAGING" ? (
                        <div className={styles.inlineHint}>
                          Packaging output derives dispatch rules from the chosen material, so duplicate pack-entry fields stay hidden.
                        </div>
                      ) : (
                        <div className={styles.stackRows}>
                          <div className={styles.toggleBar}>
                            <span>Primary inner pack</span>
                            <Switch checked={primaryEnabled} onCheckedChange={setPrimaryEnabled} />
                          </div>
                          {primaryEnabled ? (
                            <div className={styles.tightGrid}>
                              <div className={styles.fieldBlock}>
                                <Label>Material</Label>
                                <Select value={primaryMaterialId} onValueChange={setPrimaryMaterialId}>
                                  <SelectTrigger><SelectValue placeholder="Packaging material" /></SelectTrigger>
                                  <SelectContent>
                                    {packagingMaterials.map((material: any) => (
                                      <SelectItem key={material.id} value={String(material.id)}>
                                        {material.code} · {material.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className={styles.fieldBlock}>
                                <Label>PCS per pack</Label>
                                <Input type="number" value={pcsPerPack} onChange={(event) => setPcsPerPack(Number(event.target.value || 0))} />
                              </div>
                            </div>
                          ) : null}

                          <div className={styles.toggleBar}>
                            <span>Roll dispatch pack</span>
                            <Switch checked={rollPackEnabled} onCheckedChange={setRollPackEnabled} />
                          </div>
                          {rollPackEnabled ? (
                            <div className={styles.stackRows}>
                              {rollPackLines.map((line, index) => (
                                <div key={`pack-line-${index}`} className={styles.inlineRow}>
                                  <Select
                                    value={line.material_id}
                                    onValueChange={(value) => setRollPackLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, material_id: value } : row))}
                                  >
                                    <SelectTrigger><SelectValue placeholder="Material" /></SelectTrigger>
                                    <SelectContent>
                                      {packagingMaterials.map((material: any) => (
                                        <SelectItem key={material.id} value={String(material.id)}>
                                          {material.code} · {material.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    type="number"
                                    value={line.qty}
                                    onChange={(event) => setRollPackLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, qty: Number(event.target.value || 0) } : row))}
                                    placeholder="Qty"
                                  />
                                  <Button variant="ghost" size="sm" onClick={() => setRollPackLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}>
                                    Remove
                                  </Button>
                                </div>
                              ))}
                              <Button variant="outline" size="sm" onClick={() => setRollPackLines((current) => [...current, { material_id: "", qty: 0, uom: "PCS" }])}>
                                Add dispatch line
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.inlineHint}>Expand the spec editor to configure layers, printing, and packaging.</div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* --- CART RAIL --- */}
        <aside className={styles.cartRail} data-testid="planner-stock-cart">
          <div className={styles.cartHeader}>
            <span className={styles.cartTitle}>Release cart</span>
            <span className={styles.cartCounts}>
              {queueCounts.draft ? `${queueCounts.draft} draft` : ""}
              {queueCounts.draft && queueCounts.released ? " · " : ""}
              {queueCounts.released ? `${queueCounts.released} ok` : ""}
              {(queueCounts.draft || queueCounts.released) && queueCounts.failed ? " · " : ""}
              {queueCounts.failed ? `${queueCounts.failed} err` : ""}
              {queueCounts.submitting ? ` · ${queueCounts.submitting} sending` : ""}
              {!cartLines.length ? "empty" : ""}
            </span>
          </div>

          <div className={styles.cartScroll}>
            <div className={styles.cartList}>
              {cartLines.length ? cartLines.map((line) => (
                <article key={line.localId} className={styles.cartItem} data-testid={`planner-stock-cart-line-${line.localId}`}>
                  <div className={styles.cartLine1}>
                    <span className={cn(
                      styles.statusDot,
                      line.submitStatus === "draft" && styles.statusDotDraft,
                      line.submitStatus === "submitting" && styles.statusDotSubmitting,
                      line.submitStatus === "released" && styles.statusDotReleased,
                      line.submitStatus === "failed" && styles.statusDotFailed,
                    )} />
                    <span className={styles.cartItemName} data-testid={`planner-stock-cart-line-name-${line.localId}`}>{line.name}</span>
                    <button type="button" className={styles.removeBtn} onClick={() => removeCartLine(line.localId)} disabled={line.submitStatus === "submitting"} title="Remove">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className={styles.cartLine2}>
                    {line.quantity} {line.quantityUom}
                    {` · ${line.estimatedKg !== null ? `${line.estimatedKg.toFixed(2)}kg` : "—kg"}`}
                    {` · ${line.estimatedPcs !== null ? `${line.estimatedPcs}pcs` : "—pcs"}`}
                    {` · ${line.outputLabel}`}
                  </div>
                  <div className={styles.cartLine3}>
                    {line.routeLabel} · {line.templateName}
                  </div>
                  {line.saveAsPlannerPreset ? (
                    <span className={styles.presetBadge}>
                      <CopyPlus className="h-2.5 w-2.5" />
                      save preset
                    </span>
                  ) : null}
                  {line.submitStatus === "released" && line.createdOrderNumber ? (
                    <div className={styles.cartItemSuccess}>
                      <CheckCircle2 className="h-3 w-3" />
                      <span data-testid={`planner-stock-cart-line-order-${line.localId}`}>
                        {line.createdOrderNumber}
                        {line.createdOrderKind === "bulk" ? " · POD replenishment" : ""}
                      </span>
                    </div>
                  ) : null}
                  {line.submitStatus === "failed" && line.submitError ? (
                    <div className={styles.cartItemAlert}>
                      <AlertTriangle className="h-3 w-3" />
                      <span>{line.submitError}</span>
                    </div>
                  ) : null}
                </article>
              )) : (
                <div className={styles.emptyState}>
                  Select SKU, set quantity, click Add to queue lines here.
                </div>
              )}
            </div>
          </div>

          <div className={styles.cartFooter}>
            <span className={styles.cartFooterInfo}>{releasableCount} ready</span>
            <div className={styles.cartFooterActions}>
              <Button variant="outline" size="sm" className={styles.clearBtn} onClick={clearDraftLines} disabled={!releasableCount || submittingCart}>
                Clear drafts
              </Button>
              <Button data-testid="planner-stock-release-all" size="sm" className={styles.releaseBtn} onClick={releaseQueuedLines} disabled={!releasableCount || submittingCart || creating}>
                {submittingCart ? <RefreshCw className="mr-1 h-3 w-3 animate-spin" /> : <Rocket className="mr-1 h-3 w-3" />}
                Release all ({releasableCount})
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
