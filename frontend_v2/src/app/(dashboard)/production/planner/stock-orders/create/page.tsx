"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Package, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { plannerService } from "@/services/planner"
import { masterDataService } from "@/services/master-data"
import { salesService } from "@/services/sales"
import { api } from "@/lib/api"

const steps = ["Intent", "Spec Capture", "Packaging", "Review"]

type Line = { material_id: string; qty: number; uom?: string; basis?: string }
type StockStrategy = "FINAL_STOCK" | "INTERMEDIATE_POOL" | "PACKAGING_STOCK"
type LauncherMode = "FINAL_ROLL" | "SHARED_INVARIANT" | "BASE_UPSTREAM" | "POD_STOCK" | "PACKAGING_STOCK"

export default function CreateStockOrderWizardPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [step, setStep] = useState(0)
  const [launcherMode, setLauncherMode] = useState<LauncherMode>("FINAL_ROLL")

  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState("")
  const [plantId, setPlantId] = useState("")
  const [quantity, setQuantity] = useState(1000)
  const [quantityUom, setQuantityUom] = useState<"KG" | "PCS" | "METER">("KG")
  const [stockPurpose, setStockPurpose] = useState<"PRODUCT" | "PACKAGING">("PRODUCT")
  const [stockStrategy, setStockStrategy] = useState<StockStrategy>("FINAL_STOCK")
  const [packagingMaterialId, setPackagingMaterialId] = useState("")
  const [startStepIndex, setStartStepIndex] = useState(0)
  const [stopStepIndex, setStopStepIndex] = useState<number | undefined>(undefined)

  const [fgType, setFgType] = useState<"POUCH" | "ROLL">("POUCH")
  const [rollForm, setRollForm] = useState<"FLAT" | "FOLDED" | "TUBING">("FLAT")

  const [widthMm, setWidthMm] = useState(0)
  const [heightMm, setHeightMm] = useState(0)
  const [faces, setFaces] = useState(1)

  const [layers, setLayers] = useState<Array<{ family_id: string; variant_id: string; thickness_micron: number; roll_width_mm?: number; grade_id?: string | null }>>([
    { family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0, grade_id: null },
  ])

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

  const templatesQuery = useQuery({
    queryKey: ["planner-create-stock-templates"],
    queryFn: async () => {
      const { data } = await api.get("/api/templates/")
      return Array.isArray(data) ? data : []
    },
  })

  const plantsQuery = useQuery({
    queryKey: ["planner-create-stock-plants"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/plants/")
      return Array.isArray(data) ? data : []
    },
  })

  const routeStepsQuery = useQuery({
    queryKey: ["planner-create-stock-route", templateId],
    queryFn: () => plannerService.getRouteSteps(templateId),
    enabled: !!templateId,
  })

  const familiesQuery = useQuery({ queryKey: ["film-families"], queryFn: masterDataService.getFilmFamilies })
  const variantsQuery = useQuery({ queryKey: ["film-variants"], queryFn: masterDataService.getFilmVariants })
  const addonsMasterQuery = useQuery({ queryKey: ["addons"], queryFn: masterDataService.getAddons })
  const packagingMaterialsQuery = useQuery({ queryKey: ["master-packaging"], queryFn: masterDataService.getPackaging })

  const templates = Array.isArray(templatesQuery.data) ? templatesQuery.data : []
  const plants = Array.isArray(plantsQuery.data) ? plantsQuery.data : []
  const routeSteps = Array.isArray(routeStepsQuery.data) ? routeStepsQuery.data : []
  const families = Array.isArray(familiesQuery.data) ? familiesQuery.data : []
  const variants = Array.isArray(variantsQuery.data) ? variantsQuery.data : []
  const addonsMaster = Array.isArray(addonsMasterQuery.data) ? addonsMasterQuery.data : []
  const packagingMaterials = Array.isArray(packagingMaterialsQuery.data) ? packagingMaterialsQuery.data : []
  const selectedPackagingMaterial = useMemo(
    () => packagingMaterials.find((row: any) => String(row.id) === String(packagingMaterialId || "")) || null,
    [packagingMaterials, packagingMaterialId]
  )
  const packagingOutputUom = String(selectedPackagingMaterial?.base_uom || "").toUpperCase()
  const selectedTemplate = useMemo(
    () => templates.find((row: any) => String(row.id) === String(templateId || "")) || null,
    [templates, templateId]
  )
  const finalProductType = stockPurpose === "PRODUCT"
    ? String(selectedTemplate?.fg_type || "POUCH").toUpperCase()
    : null
  const routeLastIndex = routeSteps.length ? Number(routeSteps[routeSteps.length - 1]?.index ?? routeSteps.length - 1) : 0
  const plannedOutputType = stockPurpose === "PACKAGING"
    ? "PACKAGING_STOCK"
    : (!templateId
      ? "—"
      : ((stopStepIndex ?? routeLastIndex) < routeLastIndex
        ? "WIP_ROLL"
        : (finalProductType === "POUCH" ? "FG_POUCH" : "FG_ROLL")))
  const stopsAtFinalStep = Number(stopStepIndex ?? routeLastIndex) >= routeLastIndex
  const recommendedStockStrategy: StockStrategy = useMemo(() => {
    if (stockPurpose === "PACKAGING") return "PACKAGING_STOCK"
    if (!stopsAtFinalStep) return "INTERMEDIATE_POOL"
    const templateDefault = String(selectedTemplate?.default_stock_strategy || "").toUpperCase()
    if (templateDefault === "INTERMEDIATE_POOL" || templateDefault === "FINAL_STOCK") {
      return templateDefault as StockStrategy
    }
    return "FINAL_STOCK"
  }, [selectedTemplate, stockPurpose, stopsAtFinalStep])

  const selectLauncherMode = (mode: LauncherMode) => {
    setLauncherMode(mode)
    if (mode === "PACKAGING_STOCK") {
      setStockPurpose("PACKAGING")
      setStockStrategy("PACKAGING_STOCK")
      if (routeSteps.length) setStopStepIndex(routeLastIndex)
      return
    }

    setStockPurpose("PRODUCT")
    if (mode === "FINAL_ROLL") {
      setStockStrategy("FINAL_STOCK")
      if (routeSteps.length) setStopStepIndex(routeLastIndex)
      return
    }
    if (mode === "SHARED_INVARIANT") {
      setStockStrategy("INTERMEDIATE_POOL")
      if (routeSteps.length) setStopStepIndex(routeLastIndex)
      return
    }
    if (mode === "BASE_UPSTREAM") {
      setStockStrategy("INTERMEDIATE_POOL")
      if (routeSteps.length) setStopStepIndex(Math.max(Number(startStepIndex || 0), routeLastIndex > 0 ? routeLastIndex - 1 : 0))
      return
    }
    if (mode === "POD_STOCK") {
      setStockStrategy("FINAL_STOCK")
      if (routeSteps.length) setStopStepIndex(routeLastIndex)
    }
  }

  const lookupErrors = [
    templatesQuery.isError ? `Templates: ${String((templatesQuery.error as any)?.response?.data?.detail || (templatesQuery.error as Error)?.message || "Failed to load.")}` : null,
    plantsQuery.isError ? `Plants: ${String((plantsQuery.error as any)?.response?.data?.detail || (plantsQuery.error as Error)?.message || "Failed to load.")}` : null,
    routeStepsQuery.isError ? `Route steps: ${String((routeStepsQuery.error as any)?.response?.data?.detail || (routeStepsQuery.error as Error)?.message || "Failed to load.")}` : null,
    familiesQuery.isError ? `Film families: ${String((familiesQuery.error as any)?.response?.data?.detail || (familiesQuery.error as Error)?.message || "Failed to load.")}` : null,
    variantsQuery.isError ? `Film variants: ${String((variantsQuery.error as any)?.response?.data?.detail || (variantsQuery.error as Error)?.message || "Failed to load.")}` : null,
    addonsMasterQuery.isError ? `Addons: ${String((addonsMasterQuery.error as any)?.response?.data?.detail || (addonsMasterQuery.error as Error)?.message || "Failed to load.")}` : null,
    packagingMaterialsQuery.isError ? `Packaging materials: ${String((packagingMaterialsQuery.error as any)?.response?.data?.detail || (packagingMaterialsQuery.error as Error)?.message || "Failed to load.")}` : null,
  ].filter(Boolean) as string[]

  useEffect(() => {
    if (!routeSteps.length) return
    const routeLast = Number(routeSteps[routeSteps.length - 1].index)
    setStopStepIndex(routeLast)
  }, [routeSteps])

  useEffect(() => {
    if (stockPurpose === "PACKAGING") {
      if (stockStrategy !== "PACKAGING_STOCK") {
        setStockStrategy("PACKAGING_STOCK")
      }
      return
    }
    if (!stopsAtFinalStep && stockStrategy !== "INTERMEDIATE_POOL") {
      setStockStrategy("INTERMEDIATE_POOL")
      return
    }
    if (!stockStrategy || !["FINAL_STOCK", "INTERMEDIATE_POOL", "PACKAGING_STOCK"].includes(stockStrategy)) {
      setStockStrategy(recommendedStockStrategy)
    }
  }, [recommendedStockStrategy, stockPurpose, stopsAtFinalStep, stockStrategy])

  useEffect(() => {
    if (stockPurpose === "PRODUCT" && (finalProductType === "ROLL" || finalProductType === "POUCH")) {
      if (fgType !== finalProductType) {
        setFgType(finalProductType as "POUCH" | "ROLL")
      }
    }
  }, [stockPurpose, finalProductType, fgType])

  useEffect(() => {
    if (finalProductType === "ROLL") {
      if (quantityUom !== "KG") {
        setQuantityUom("KG")
      }
      if (heightMm !== 0) {
        setHeightMm(0)
      }
    }
  }, [finalProductType, quantityUom, heightMm])

  useEffect(() => {
    if (stockPurpose !== "PACKAGING") return
    const uom = packagingOutputUom
    if (uom === "KG" || uom === "PCS") {
      setQuantityUom(uom as any)
    } else if (uom === "METER") {
      setQuantityUom("METER")
    }
  }, [stockPurpose, packagingOutputUom])

  const packagingSnapshot = useMemo(() => {
    if (stockPurpose === "PACKAGING") return {}
    return {
      primary_inner_pack: {
        enabled: primaryEnabled,
        material_id: primaryMaterialId || null,
        pcs_per_pack: pcsPerPack,
      },
      roll_dispatch_pack: {
        enabled: rollPackEnabled,
        lines: rollPackLines,
      },
    }
  }, [
    stockPurpose,
    primaryEnabled,
    primaryMaterialId,
    pcsPerPack,
    rollPackEnabled,
    rollPackLines,
  ])

  const payload = useMemo(() => {
    const normalizedLayers = (layers || []).filter((l) => l.family_id && l.variant_id)
    const primaryRollWidthMm = Number(normalizedLayers[0]?.roll_width_mm || 0)
    const normalizedAddons = (addons || [])
      .filter((a) => a.addon_id)
      .map((a) => {
        const master = (addonsMaster || []).find((m: any) => String(m.id) === String(a.addon_id))
        return {
          addon_id: a.addon_id,
          qty: Number(a.qty || 0),
          applies_to: a.applies_to,
          weight_mode: String(master?.weight_mode || "FIXED"),
          weight_value: Number(master?.weight_value || 0),
        }
      })

    return {
      template_id: templateId,
      name: name || undefined,
      preferred_plant_id: plantId || undefined,
      quantity: Number(quantity || 0),
      quantity_uom: quantityUom,
      stock_purpose: stockPurpose,
      stock_strategy: stockStrategy,
      packaging_material_id: stockPurpose === "PACKAGING" ? packagingMaterialId || undefined : undefined,
      roll_form: finalProductType === "ROLL" ? rollForm : undefined,
      start_step_index: Number(startStepIndex || 0),
      stop_step_index: stopStepIndex,
      geometry_override: {
        width_mm: finalProductType === "POUCH" ? Number(widthMm || 0) : 0,
        height_mm: finalProductType === "POUCH" ? Number(heightMm || 0) : 0,
      },
      geometry: {
        base: {
          width_mm: finalProductType === "ROLL" ? primaryRollWidthMm : Number(widthMm || 0),
          height_mm: finalProductType === "POUCH" ? Number(heightMm || 0) : 0,
        },
        adjustments: [],
        multipliers: { faces: Number(faces || 1) },
        finished_good_type: finalProductType || fgType,
        roll_form: finalProductType === "ROLL" ? rollForm : undefined,
      },
      film_layers: normalizedLayers,
      printing: printingEnabled
        ? {
            enabled: true,
            type: printType,
            substrate_mode: substrateMode,
            front_colors_count: Number(frontColorsCount || 0),
            back_colors_count: Number(backColorsCount || 0),
            ink_gsm_total: Number(inkGsmTotal || 0),
            artwork_id: artworkId || null,
            chemicals: {
              adhesive_gsm: Number(adhesiveGsm || 0),
              solvent_gsm: Number(solventGsm || 0),
            },
          }
        : { enabled: false },
      chemicals: {
        adhesive_gsm: Number(adhesiveGsm || 0),
        solvent_gsm: Number(solventGsm || 0),
      },
      addons: normalizedAddons,
      packaging_snapshot: packagingSnapshot,
    }
  }, [
    templateId,
    name,
    plantId,
    quantity,
    quantityUom,
    stockPurpose,
    stockStrategy,
    packagingMaterialId,
    rollForm,
    startStepIndex,
    stopStepIndex,
    widthMm,
    heightMm,
    faces,
    layers,
    printingEnabled,
    printType,
    substrateMode,
    frontColorsCount,
    backColorsCount,
    inkGsmTotal,
    adhesiveGsm,
    solventGsm,
    artworkId,
    addons,
    addonsMaster,
    packagingSnapshot,
    finalProductType,
  ])

  const refreshPreview = async () => {
    try {
      setPreviewing(true)
      setPreviewError(null)
      const normalizedLayers = (payload.film_layers || []).filter((l: any) => l.family_id && l.variant_id)
      const hasPreviewableLayers = normalizedLayers.some((layer: any) => {
        const hasThickness = Number(layer?.thickness_micron || 0) > 0
        if (!hasThickness) return false
        if (finalProductType === "ROLL") {
          return Number(layer?.roll_width_mm || 0) > 0
        }
        return Number(payload.geometry?.base?.width_mm || 0) > 0 && Number(payload.geometry?.base?.height_mm || 0) > 0
      })
      if (!templateId || !normalizedLayers.length || !hasPreviewableLayers) {
        setPreview(null)
        setPreviewError(
          finalProductType === "ROLL"
            ? "Preview needs a complete Layer 1 roll spec (family, variant, thickness, roll width)."
            : "Preview needs at least one valid layer plus pouch width and height."
        )
        return
      }
      const p = await salesService.previewItem({
        finished_good_type: finalProductType || fgType,
        geometry: payload.geometry,
        film_layers: normalizedLayers,
        printing: payload.printing,
        chemicals: payload.chemicals,
        addons: payload.addons,
        order_qty: Number(quantity || 0),
        uom: quantityUom as any,
      } as any)
      setPreview(p)
      setPreviewError(null)
    } catch (err: any) {
      setPreview(null)
      setPreviewError(
        String(err?.response?.data?.detail || err?.response?.data?.error || err?.message || "Preview could not be refreshed.")
      )
    } finally {
      setPreviewing(false)
    }
  }

  const createOrder = async () => {
    try {
      setCreating(true)
      await plannerService.createStockOrder(payload as any)
      toast({ title: "Stock order created", description: "Order was added to planner queue." })
      router.push("/production/planner")
    } catch (err: any) {
      toast({ title: "Create failed", description: err?.response?.data?.error || "Could not create stock order", variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  const previewRoll = preview?.roll_preview || preview?.physics?.roll_preview || null
  const previewRollMathError = finalProductType === "ROLL" && preview && !previewRoll?.derived_area_m2
    ? "Roll math incomplete: width, thickness, or density is missing."
    : null

  const canNext = () => {
    if (step === 0) {
      if (!templateId || Number(quantity) <= 0) return false
      if (stockPurpose === "PACKAGING" && !packagingMaterialId) return false
      return true
    }
    return true
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.14),_transparent_28%),linear-gradient(180deg,#f8fbff_0%,#f7f5ef_100%)] p-6 lg:p-8">
      <div className="max-w-[1500px] mx-auto space-y-6">
        <section className="overflow-hidden rounded-[2.2rem] border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_48%,#f7f8ec_100%)] px-6 py-6 shadow-[0_30px_80px_-52px_rgba(15,23,42,0.26)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Button variant="ghost" className="pl-0 text-slate-500 hover:bg-transparent hover:text-slate-700" onClick={() => router.push("/production/planner")}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Planner
            </Button>
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-700">Planner Stock Launcher</div>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Create Stock Order</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Start with the stock intent, choose the route stop, and reveal only the fields that matter for that exact replenishment lane.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-right text-xs font-semibold text-slate-500">
              {launcherMode === "PACKAGING_STOCK"
                ? "Packaging replenishment"
                : launcherMode === "POD_STOCK"
                  ? "Planner POD replenishment"
                  : "Route-based stock order"}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          <div className="xl:col-span-2 space-y-6">
            {lookupErrors.length > 0 && (
              <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                    <div className="space-y-2">
                      <div className="font-bold text-amber-800">Some setup lookups failed.</div>
                      <div className="text-sm text-amber-700">
                        The wizard stays usable, but affected controls may be limited until those lookups recover.
                      </div>
                      <div className="space-y-1 text-xs text-amber-800">
                        {lookupErrors.map((message) => (
                          <div key={message}>{message}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
              <CardHeader>
                <CardTitle className="text-sm uppercase tracking-wide">Planner flow</CardTitle>
                <CardDescription>Choose intent first, keep technical capture secondary, and review only what the selected lane needs.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-2 flex-wrap">
                {steps.map((s, idx) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`h-8 px-3 rounded-full text-xs font-black flex items-center ${idx <= step ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"}`}>
                      {idx < step ? <Check className="h-3 w-3 mr-1" /> : null}
                      {idx + 1}. {s}
                    </div>
                    {idx < steps.length - 1 ? <ArrowRight className="h-3 w-3 text-slate-300" /> : null}
                  </div>
                ))}
              </CardContent>
            </Card>

            {step === 0 && (
              <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
              <CardHeader>
                <CardTitle>Choose stock intent first</CardTitle>
                <CardDescription>Start from the replenishment lane. The page should feel like five clear launches, not one long technical wizard.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    {([
                      ["FINAL_ROLL", "Final Roll", "Direct finished stock for compatible demand."],
                      ["SHARED_INVARIANT", "Shared Invariant Roll", "Reusable semi-finished pool for downstream continuation."],
                      ["BASE_UPSTREAM", "Base / Upstream Roll", "Stop earlier and hold upstream stock."],
                      ["POD_STOCK", "POD Stock Order", "Planner-owned POD replenishment."],
                      ["PACKAGING_STOCK", "Packaging Stock", "Packaging replenishment outside sales fulfilment."],
                    ] as const).map(([value, title, description]) => {
                      const selected = launcherMode === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => selectLauncherMode(value)}
                          className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${selected ? "border-indigo-300 bg-indigo-50 shadow-[0_18px_45px_-36px_rgba(79,70,229,0.25)]" : "border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white"}`}
                        >
                          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                            {value === "POD_STOCK" ? "Planner Flow" : value === "PACKAGING_STOCK" ? "Packaging" : "Stock Intent"}
                          </div>
                          <div className="mt-2 text-base font-black text-slate-950">{title}</div>
                          <div className="mt-2 text-sm leading-6 text-slate-600">{description}</div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Current intent</div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        {launcherMode === "FINAL_ROLL"
                          ? "Final Roll"
                          : launcherMode === "SHARED_INVARIANT"
                            ? "Shared Invariant Roll"
                            : launcherMode === "BASE_UPSTREAM"
                              ? "Base / Upstream Roll"
                              : launcherMode === "POD_STOCK"
                                ? "POD Stock Order"
                                : "Packaging Stock"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Planner lane</div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        {stockPurpose === "PACKAGING"
                          ? "Packaging-only archive"
                          : stockStrategy === "INTERMEDIATE_POOL"
                            ? "Continue from WIP"
                            : "Use Existing FG"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Route stop</div>
                      <div className="mt-2 text-sm font-black text-slate-900">
                        {templateId ? `Step ${stopStepIndex ?? routeLastIndex} of ${routeLastIndex}` : "Select template"}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/60 p-4">
                      <div className="mb-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Core setup</div>
                        <div className="mt-1 text-sm font-semibold text-slate-700">Name the order, choose the route, set quantity, and stop at the exact route step you want to stock.</div>
                      </div>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <Label>Name</Label>
                          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Stock order name" />
                        </div>
                        <div>
                          <Label>Template</Label>
                          <Select value={templateId} onValueChange={setTemplateId} disabled={templatesQuery.isError}>
                            <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                            <SelectContent>
                              {templates.map((t: any) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Plant (optional)</Label>
                          <Select value={plantId} onValueChange={setPlantId} disabled={plantsQuery.isError}>
                            <SelectTrigger><SelectValue placeholder="Auto" /></SelectTrigger>
                            <SelectContent>
                              {plants.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Purpose</Label>
                          <Select value={stockPurpose} onValueChange={(v: any) => setStockPurpose(v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PRODUCT">PRODUCT</SelectItem>
                              <SelectItem value="PACKAGING">PACKAGING MATERIAL</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Quantity</Label>
                          <Input type="number" value={quantity} onChange={(e) => setQuantity(Number(e.target.value || 0))} />
                        </div>
                        <div>
                          <Label>Quantity UOM</Label>
                          <Select value={quantityUom} onValueChange={(v: any) => setQuantityUom(v)} disabled={stockPurpose === "PACKAGING" && !!packagingOutputUom}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {stockPurpose === "PACKAGING" && packagingOutputUom ? (
                                <SelectItem value={packagingOutputUom}>{packagingOutputUom}</SelectItem>
                              ) : (
                                <>
                                  <SelectItem value="KG">KG</SelectItem>
                                  {stockPurpose !== "PRODUCT" && <SelectItem value="PCS">PCS</SelectItem>}
                                  {stockPurpose !== "PRODUCT" && <SelectItem value="METER">METER</SelectItem>}
                                  {stockPurpose === "PRODUCT" && finalProductType !== "ROLL" && <SelectItem value="PCS">PCS</SelectItem>}
                                  {stockPurpose === "PRODUCT" && finalProductType !== "ROLL" && <SelectItem value="METER">METER</SelectItem>}
                                </>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label>Start Step</Label>
                          <Select
                            value={String(startStepIndex)}
                            onValueChange={(v) => setStartStepIndex(Number(v || 0))}
                            disabled={Boolean(templateId) && routeStepsQuery.isError}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">0 - Raw Start</SelectItem>
                                {routeSteps.map((step: any) => (
                                <SelectItem key={`start-${step.index}`} value={String(step.index)}>
                                  {step.label || `${step.index} - ${step.name}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Stop Step</Label>
                          <Select
                            value={String(stopStepIndex ?? routeLastIndex)}
                            onValueChange={(v) => setStopStepIndex(Number(v || routeLastIndex))}
                            disabled={Boolean(templateId) && routeStepsQuery.isError}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {routeSteps.map((step: any) => (
                                <SelectItem key={`stop-${step.index}`} value={String(step.index)}>
                                  {step.label || `${step.index} - ${step.name}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-[1.6rem] border border-indigo-200 bg-indigo-50/70 p-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-600">Planner meaning</div>
                        <div className="mt-2 text-lg font-black text-slate-950">
                          {launcherMode === "FINAL_ROLL"
                            ? "Final Roll"
                            : launcherMode === "SHARED_INVARIANT"
                              ? "Shared Invariant Roll"
                              : launcherMode === "BASE_UPSTREAM"
                                ? "Base / Upstream Roll"
                                : launcherMode === "POD_STOCK"
                                  ? "POD Stock Order"
                                  : "Packaging Stock"}
                        </div>
                        <div className="mt-2 text-sm text-slate-600">
                          {stockPurpose === "PACKAGING"
                            ? "Packaging supply stays outside the sales fulfilment pool."
                            : stockStrategy === "INTERMEDIATE_POOL"
                              ? "Planner will surface this output only in Continue from WIP when invariant signatures match."
                              : "Planner will surface this output as direct-consumable finished stock when final specs match."}
                        </div>
                        <div className="mt-4 space-y-2 text-xs">
                          <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-white px-3 py-2">
                            <span className="font-black uppercase tracking-[0.18em] text-slate-500">Lane</span>
                            <span className="font-semibold text-slate-900">
                              {stockPurpose === "PACKAGING"
                                ? "Packaging-only archive"
                                : stockStrategy === "INTERMEDIATE_POOL"
                                  ? "Continue from WIP"
                                  : "Use Existing FG"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-white px-3 py-2">
                            <span className="font-black uppercase tracking-[0.18em] text-slate-500">Route stop</span>
                            <span className="font-semibold text-slate-900">{templateId ? `Step ${stopStepIndex ?? routeLastIndex} of ${routeLastIndex}` : "Select template"}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-xl border border-indigo-200 bg-white px-3 py-2">
                            <span className="font-black uppercase tracking-[0.18em] text-slate-500">Output type</span>
                            <span className="font-semibold text-slate-900">{plannedOutputType}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[1.6rem] border border-slate-200 bg-white p-4">
                        <Label>How will this stock be consumed later?</Label>
                        <Select
                          value={stockStrategy}
                          onValueChange={(value: StockStrategy) => setStockStrategy(value)}
                          disabled={stockPurpose === "PACKAGING" || !stopsAtFinalStep}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {stockPurpose === "PACKAGING" ? (
                              <SelectItem value="PACKAGING_STOCK">Packaging stock</SelectItem>
                            ) : !stopsAtFinalStep ? (
                              <SelectItem value="INTERMEDIATE_POOL">Intermediate pool</SelectItem>
                            ) : (
                              <>
                                <SelectItem value="FINAL_STOCK">Direct finished stock</SelectItem>
                                <SelectItem value="INTERMEDIATE_POOL">Intermediate pool for later continuation</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                        <p className="mt-2 text-xs text-slate-500">
                          {stockPurpose === "PACKAGING"
                            ? "Packaging stock stays outside sales fulfilment sourcing."
                            : !stopsAtFinalStep
                            ? "This order stops before the final route step, so it must remain an intermediate pool."
                            : stockStrategy === "INTERMEDIATE_POOL"
                            ? "Planner will surface this output only in Continue from WIP when invariant signatures match."
                            : "Planner will surface this output as direct-consumable finished stock when final specs match."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {stockPurpose === "PACKAGING" && (
                    <>
                      <div className="md:col-span-2">
                        <Label>Output Packaging Material</Label>
                        <Select value={packagingMaterialId} onValueChange={setPackagingMaterialId} disabled={packagingMaterialsQuery.isError}>
                          <SelectTrigger><SelectValue placeholder="Select packaging material" /></SelectTrigger>
                          <SelectContent>
                            {packagingMaterials.map((m: any) => (
                              <SelectItem key={m.id} value={String(m.id)}>{m.code} - {m.name} ({m.base_uom})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {selectedPackagingMaterial ? (
                        <div className="md:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div><span className="font-black uppercase text-emerald-700">Output Material:</span> <span className="font-bold text-emerald-900">{selectedPackagingMaterial.code} - {selectedPackagingMaterial.name}</span></div>
                            <div><span className="font-black uppercase text-emerald-700">Output UOM:</span> <span className="font-bold text-emerald-900">{packagingOutputUom || "—"}</span></div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}

                  {templateId && (
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div><span className="font-black uppercase text-slate-500">Final Product Type:</span> <span className="font-bold text-slate-800">{stockPurpose === "PACKAGING" ? "PACKAGING STOCK" : finalProductType}</span></div>
                        <div><span className="font-black uppercase text-slate-500">Planned Output Type:</span> <span className="font-bold text-slate-800">{plannedOutputType}</span></div>
                        <div><span className="font-black uppercase text-slate-500">Stock Strategy:</span> <span className="font-bold text-slate-800">{stockStrategy.replaceAll("_", " ")}</span></div>
                        <div><span className="font-black uppercase text-slate-500">Consumption Rule:</span> <span className="font-bold text-slate-800">{stockStrategy === "INTERMEDIATE_POOL" ? "Continue from WIP only" : stockStrategy === "PACKAGING_STOCK" ? "Packaging only" : "Use Existing FG / direct consume"}</span></div>
                        {stockPurpose === "PACKAGING" && selectedPackagingMaterial ? (
                          <>
                            <div><span className="font-black uppercase text-slate-500">Output Material:</span> <span className="font-bold text-slate-800">{selectedPackagingMaterial.code} - {selectedPackagingMaterial.name}</span></div>
                            <div><span className="font-black uppercase text-slate-500">Output UOM:</span> <span className="font-bold text-slate-800">{packagingOutputUom || "—"}</span></div>
                          </>
                        ) : null}
                      </div>
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                        Template defines the final product type. Start and stop step define physical manufacturing progress. Stock strategy defines whether planner treats the output as final stock, intermediate pool, or packaging-only supply.
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Route Plan</div>
                        <div className="space-y-1">
                          {routeSteps.map((routeStep: any) => {
                            const idx = Number(routeStep.index || 0)
                            const inSpan = idx >= startStepIndex && idx <= Number(stopStepIndex ?? routeLastIndex)
                            const beforeSpan = idx < startStepIndex
                            return (
                              <div
                                key={String(routeStep.index)}
                                className={`rounded-lg border px-3 py-2 text-xs ${
                                  inSpan
                                    ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                                    : beforeSpan
                                    ? "border-slate-200 bg-slate-50 text-slate-400"
                                    : "border-slate-200 bg-white text-slate-500"
                                }`}
                              >
                                <div className="font-bold">{routeStep.label || `Step ${idx} - ${routeStep.name}`}</div>
                                <div className="text-[10px] uppercase">
                                  {String(routeStep.input_form || "BULK")} → {String(routeStep.output_form || "ROLL")}
                                  {routeStep.roll_behavior ? ` • ${String(routeStep.roll_behavior)}` : ""}
                                </div>
                              </div>
                            )
                          })}
                          {!routeSteps.length && (
                            <div className="text-xs text-slate-400 italic">Route will appear once template routing loads.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {step === 1 && (
              <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
                <CardHeader>
                  <CardTitle>Spec Capture</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[10px] font-black uppercase text-slate-500">Final Product Type</div>
                      <div className="text-sm font-bold text-slate-900">{stockPurpose === "PACKAGING" ? "PACKAGING STOCK" : finalProductType}</div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[10px] font-black uppercase text-slate-500">Planned Output Type</div>
                      <div className="text-sm font-bold text-slate-900">{plannedOutputType}</div>
                    </div>
                    {stockPurpose === "PACKAGING" && selectedPackagingMaterial && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <div className="text-[10px] font-black uppercase text-emerald-700">Packaging Output</div>
                        <div className="text-sm font-bold text-emerald-900">{selectedPackagingMaterial.code} • {packagingOutputUom || "—"}</div>
                      </div>
                    )}
                    {finalProductType === "ROLL" && (
                      <div>
                        <Label>Roll Form</Label>
                        <Select value={rollForm} onValueChange={(v: any) => setRollForm(v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FLAT">FLAT</SelectItem>
                            <SelectItem value="FOLDED">FOLDED</SelectItem>
                            <SelectItem value="TUBING">TUBING</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {finalProductType === "POUCH" ? (
                      <div><Label>Width (mm)</Label><Input type="number" value={widthMm} onChange={(e) => setWidthMm(Number(e.target.value || 0))} /></div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 flex items-center">
                        Roll width is taken from Layer 1 in the layer stack below.
                      </div>
                    )}
                    {finalProductType === "POUCH" ? (
                      <div><Label>Height (mm)</Label><Input type="number" value={heightMm} onChange={(e) => setHeightMm(Number(e.target.value || 0))} /></div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500 flex items-center">Roll length is derived from KG + width + thickness + density.</div>
                    )}
                    {finalProductType === "POUCH" && <div><Label>Faces</Label><Input type="number" value={faces} onChange={(e) => setFaces(Number(e.target.value || 1))} /></div>}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Film Layers</Label>
                      <Button variant="outline" size="sm" onClick={() => setLayers((prev) => [...prev, { family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0, grade_id: null }])}>Add Layer</Button>
                    </div>
                    {layers.map((layer, idx) => (
                      <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <Select value={layer.family_id} onValueChange={(v) => setLayers((prev) => prev.map((it, i) => i === idx ? { ...it, family_id: v } : it))}>
                          <SelectTrigger><SelectValue placeholder="Family" /></SelectTrigger>
                          <SelectContent>{families.map((f: any) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={layer.variant_id} onValueChange={(v) => setLayers((prev) => prev.map((it, i) => i === idx ? { ...it, variant_id: v } : it))}>
                          <SelectTrigger><SelectValue placeholder="Variant" /></SelectTrigger>
                          <SelectContent>
                            {variants
                              .filter((v: any) => String(v?.parent_family?.id || v?.parent_family || "") === String(layer.family_id || ""))
                              .map((v: any) => <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" placeholder="Thickness" value={layer.thickness_micron} onChange={(e) => setLayers((prev) => prev.map((it, i) => i === idx ? { ...it, thickness_micron: Number(e.target.value || 0) } : it))} />
                        <Input type="number" placeholder="Roll width" value={layer.roll_width_mm || 0} onChange={(e) => setLayers((prev) => prev.map((it, i) => i === idx ? { ...it, roll_width_mm: Number(e.target.value || 0) } : it))} />
                        <Button variant="ghost" onClick={() => setLayers((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between border rounded-lg p-3">
                      <div>
                        <Label>Printing</Label>
                        <p className="text-xs text-slate-500">Enable if this product requires print BOM.</p>
                      </div>
                      <Switch checked={printingEnabled} onCheckedChange={setPrintingEnabled} />
                    </div>
                    {printingEnabled && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Select value={printType} onValueChange={(v: any) => setPrintType(v)}>
                          <SelectTrigger><SelectValue placeholder="Print type" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="FLEXO">FLEXO</SelectItem>
                            <SelectItem value="ROTO">ROTO</SelectItem>
                            <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={substrateMode} onValueChange={(v: any) => setSubstrateMode(v)}>
                          <SelectTrigger><SelectValue placeholder="Substrate" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SHEET">SHEET</SelectItem>
                            <SelectItem value="TUBING">TUBING</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input placeholder="Artwork ID (optional)" value={artworkId} onChange={(e) => setArtworkId(e.target.value)} />
                        <Input type="number" placeholder="Front colors" value={frontColorsCount} onChange={(e) => setFrontColorsCount(Number(e.target.value || 0))} />
                        <Input type="number" placeholder="Back colors" value={backColorsCount} onChange={(e) => setBackColorsCount(Number(e.target.value || 0))} />
                        <Input type="number" step="0.01" placeholder="Ink GSM total" value={inkGsmTotal} onChange={(e) => setInkGsmTotal(Number(e.target.value || 0))} />
                        <Input type="number" step="0.01" placeholder="Adhesive GSM" value={adhesiveGsm} onChange={(e) => setAdhesiveGsm(Number(e.target.value || 0))} />
                        <Input type="number" step="0.01" placeholder="Solvent GSM" value={solventGsm} onChange={(e) => setSolventGsm(Number(e.target.value || 0))} />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div>
                    <CardTitle>Packaging</CardTitle>
                    <CardDescription>Snapshot carried with the order and enforced during operations.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/master/packaging">Manage Packaging SKUs</Link>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-5">
                  {stockPurpose === "PACKAGING" ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                      Packaging-purpose order selected. Output packaging material will be credited to PackagingStock at completion.
                    </div>
                  ) : (
                    <>
                      {finalProductType === "POUCH" && (
                        <div className="space-y-3 rounded-xl border p-4">
                          <div className="flex items-center justify-between">
                            <Label>Primary Inner Pack</Label>
                            <Switch checked={primaryEnabled} onCheckedChange={setPrimaryEnabled} />
                          </div>
                          {primaryEnabled && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <Select value={primaryMaterialId} onValueChange={setPrimaryMaterialId} disabled={packagingMaterialsQuery.isError}>
                                <SelectTrigger><SelectValue placeholder="INNER_POUCH material" /></SelectTrigger>
                                <SelectContent>
                                  {packagingMaterials.filter((m: any) => m.packaging_kind === "INNER_POUCH").map((m: any) => (
                                    <SelectItem key={m.id} value={String(m.id)}>{m.code} - {m.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Input type="number" value={pcsPerPack} onChange={(e) => setPcsPerPack(Number(e.target.value || 0))} placeholder="PCS per pack" />
                            </div>
                          )}
                        </div>
                      )}

                      {finalProductType === "ROLL" && (
                        <div className="space-y-3 rounded-xl border p-4">
                          <div className="flex items-center justify-between">
                            <Label>Roll Dispatch Packaging</Label>
                            <Switch checked={rollPackEnabled} onCheckedChange={setRollPackEnabled} />
                          </div>
                          {rollPackEnabled && (
                            <div className="space-y-2">
                              {rollPackLines.map((line, idx) => (
                                <div key={idx} className="grid grid-cols-4 gap-2">
                                  <Input value={line.material_id} onChange={(e) => setRollPackLines((prev) => prev.map((it, i) => i === idx ? { ...it, material_id: e.target.value } : it))} placeholder="material_id" />
                                  <Input type="number" value={line.qty} onChange={(e) => setRollPackLines((prev) => prev.map((it, i) => i === idx ? { ...it, qty: Number(e.target.value || 0) } : it))} placeholder="qty" />
                                  <Input value={line.uom || "PCS"} onChange={(e) => setRollPackLines((prev) => prev.map((it, i) => i === idx ? { ...it, uom: e.target.value } : it))} placeholder="uom" />
                                  <Button variant="ghost" onClick={() => setRollPackLines((prev) => prev.filter((_, i) => i !== idx))}>Remove</Button>
                                </div>
                              ))}
                              <Button variant="outline" size="sm" onClick={() => setRollPackLines((prev) => [...prev, { material_id: "", qty: 0, uom: "PCS", basis: "PER_ROLL" }])}>Add Line</Button>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
                <CardHeader>
                  <CardTitle>Review</CardTitle>
                  <CardDescription>Verify signatures, preview and payload before create.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div><strong>Template:</strong> {templates.find((t: any) => t.id === templateId)?.name || "-"}</div>
                    <div><strong>Purpose:</strong> {stockPurpose}</div>
                    <div><strong>Final Product Type:</strong> {stockPurpose === "PACKAGING" ? "PACKAGING STOCK" : finalProductType}</div>
                    <div><strong>Planned Output Type:</strong> {plannedOutputType}</div>
                    {stockPurpose === "PACKAGING" && selectedPackagingMaterial ? (
                      <>
                        <div><strong>Output Material:</strong> {selectedPackagingMaterial.code} - {selectedPackagingMaterial.name}</div>
                        <div><strong>Output UOM:</strong> {packagingOutputUom || "-"}</div>
                      </>
                    ) : null}
                    <div><strong>Start/Stop:</strong> {startStepIndex} / {stopStepIndex}</div>
                    <div><strong>Quantity:</strong> {quantity} {quantityUom}</div>
                  </div>
                  <div className="rounded-xl bg-slate-900 text-slate-100 p-4 text-xs overflow-auto">
                    <pre>{JSON.stringify(payload, null, 2)}</pre>
                  </div>
                  <Button onClick={createOrder} disabled={creating} className="w-full h-12 font-black uppercase tracking-wide">
                    {creating ? "Creating..." : "Create Stock Order"}
                  </Button>
                </CardContent>
              </Card>
            )}

            <div className="flex items-center justify-between">
              <Button variant="outline" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Previous
              </Button>
              <Button disabled={step >= steps.length - 1 || !canNext()} onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}>
                Next <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>

          <div className="xl:col-span-1 sticky top-6 space-y-4">
            <Card className="rounded-[1.9rem] border-slate-200/80 bg-white/92 shadow-[0_24px_64px_-48px_rgba(15,23,42,0.24)]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4" /> Physics + BOM Preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Button variant="outline" className="w-full" onClick={refreshPreview} disabled={previewing}>
                  {previewing ? "Refreshing..." : "Refresh Preview"}
                </Button>
                {previewError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    {previewError}
                  </div>
                ) : null}
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">{finalProductType === "ROLL" ? "Weight (kg)" : "Unit Weight (g)"}</div>
                  <div className="font-black text-slate-900">{finalProductType === "ROLL" ? (previewRoll?.weight_kg ?? preview?.total_weight_kg ?? "-") : (preview?.unit_weight_g ?? "-")}</div>
                </div>
                {finalProductType === "ROLL" && preview ? (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-slate-500">Derived Length (m)</div>
                    <div className="font-black text-slate-900">{previewRoll?.derived_length_m ?? "-"}</div>
                  </div>
                ) : null}
                {finalProductType === "ROLL" && preview ? (
                  <div className="rounded-lg border p-3">
                    <div className="text-xs text-slate-500">Derived Area (m²)</div>
                    <div className="font-black text-slate-900">{previewRoll?.derived_area_m2 ?? "-"}</div>
                  </div>
                ) : null}
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500">Total Weight (kg)</div>
                  <div className="font-black text-slate-900">{preview?.total_weight_kg ?? "-"}</div>
                </div>
                {previewRollMathError ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
                    {previewRollMathError}
                  </div>
                ) : null}
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500 mb-2">Theoretical</div>
                  <div className="space-y-1 max-h-56 overflow-auto">
                    {(preview?.bom_preview?.theoretical_lines || []).map((c: any, idx: number) => (
                      <div key={`${c.material_name}-${idx}`} className="flex justify-between gap-2 text-xs">
                        <span className="text-slate-600">{c.material_name}</span>
                        <span className="font-bold">{Number(c.theoretical_qty || 0).toFixed(3)} {c.uom}</span>
                      </div>
                    ))}
                    {(!preview?.bom_preview?.theoretical_lines || preview?.bom_preview?.theoretical_lines?.length === 0) && (
                      <div className="text-xs text-slate-400">No preview yet.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-slate-500 mb-2">Planned Issue</div>
                  <div className="space-y-1 max-h-56 overflow-auto">
                    {(preview?.bom_preview?.planned_issue_lines || []).map((c: any, idx: number) => (
                      <div key={`planned-${c.material_name}-${idx}`} className="space-y-1 rounded-md border border-slate-100 bg-slate-50 p-2 text-xs">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium text-slate-700">{c.material_name}</span>
                          <span className="font-bold">{Number(c.planned_issue_qty || 0).toFixed(3)} {c.uom}</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Default {c.template_issue_policy_mode}
                          {c.override_issue_policy_mode ? ` • Override ${c.override_issue_policy_mode}` : ""}
                          {c.policy_source ? ` • ${c.policy_source}` : ""}
                        </div>
                      </div>
                    ))}
                    {(!preview?.bom_preview?.planned_issue_lines || preview?.bom_preview?.planned_issue_lines?.length === 0) && (
                      <div className="text-xs text-slate-400">No planned issue lines yet.</div>
                    )}
                  </div>
                </div>
                {stockPurpose === "PACKAGING" && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-700 flex items-center gap-2">
                    <Package className="h-4 w-4" /> This creates PACKAGING stock
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
