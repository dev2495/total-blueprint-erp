"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  Factory,
  PackageCheck,
  Play,
  RefreshCw,
  ShoppingCart,
  Sparkles,
  Split,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import {
  mrpService,
  type MRPPlan,
  type MRPPlanDiff,
  type MRPRequirement,
  type MRPSuggestion,
} from "@/services/mrp";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACTION_COLORS = {
  PURCHASE: "#F59E0B",
  PRODUCE: "#4F46E5",
  TRANSFER: "#10B981",
} as const;

const ACTION_FILTERS = ["ALL", "PURCHASE", "PRODUCE", "TRANSFER"] as const;

function toNumber(value: string | number | null | undefined) {
  return Number(value || 0);
}

function formatKg(value: string | number | null | undefined) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} kg`;
}

function normalizeUom(value: string | null | undefined) {
  return String(value || "KG").trim().toUpperCase() || "KG";
}

function formatQty(value: string | number | null | undefined, unit?: string | null) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} ${normalizeUom(unit).toLowerCase()}`;
}

function requirementUnit(row: MRPRequirement) {
  return normalizeUom(row.unit || row.material_details?.base_uom);
}

function suggestionUnit(row: MRPSuggestion) {
  return normalizeUom(row.unit || row.material_details?.base_uom);
}

function materialCategory(
  row: Pick<MRPRequirement | MRPSuggestion, "material_details">,
) {
  return String(row.material_details?.category || "UNCATEGORISED").trim() || "UNCATEGORISED";
}

function formatMoney(value: string | number | null | undefined) {
  return `₹${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function normalizeAction(value: string | null | undefined) {
  const action = String(value || "").trim().toUpperCase();
  if (action === "MTS_PRODUCE") return "PRODUCE";
  if (action === "PURCHASE" || action === "PRODUCE" || action === "TRANSFER") {
    return action;
  }
  return action || "UNKNOWN";
}

function resolveAction(suggestion: MRPSuggestion) {
  return normalizeAction(suggestion.action || suggestion.type);
}

function actionCopy(action: string) {
  if (action === "PURCHASE") return "Purchase";
  if (action === "PRODUCE") return "Produce";
  if (action === "TRANSFER") return "Transfer";
  return action === "ALL" ? "All actions" : action;
}

function actionStatus(suggestion: MRPSuggestion) {
  return String(suggestion.action_status || "PENDING").toUpperCase();
}

function isDraftedActionStatus(status: string) {
  return status === "DRAFT_CREATED" || status.endsWith("_DRAFTED");
}

function countSuggestions(rows: MRPSuggestion[]) {
  let purchaseCount = 0;
  let produceCount = 0;
  let transferCount = 0;
  let draftCount = 0;
  let draftCoverageKg = 0;
  let pendingCount = 0;
  let highPendingCount = 0;
  let purchaseExposure = 0;

  for (const suggestion of rows) {
    const action = resolveAction(suggestion);
    const status = actionStatus(suggestion);
    if (action === "PURCHASE") purchaseCount += 1;
    if (action === "PRODUCE") produceCount += 1;
    if (action === "TRANSFER") transferCount += 1;
    if (isDraftedActionStatus(status)) {
      draftCount += 1;
      if (suggestionUnit(suggestion) === "KG") {
        draftCoverageKg += toNumber(suggestion.quantity ?? suggestion.qty);
      }
    } else {
      pendingCount += 1;
    }
    if (
      status === "PENDING" &&
      String(suggestion.priority || "").toUpperCase() === "HIGH"
    ) {
      highPendingCount += 1;
    }
    if (action === "PURCHASE") {
      const rate = toNumber(suggestion.material_details?.cost_snapshots?.[0]?.avg_rate_per_kg);
      const qty = toNumber(suggestion.quantity ?? suggestion.qty);
      if (rate > 0 && qty > 0) purchaseExposure += rate * qty;
    }
  }

  return {
    totalCount: rows.length,
    purchaseCount,
    produceCount,
    transferCount,
    draftCount,
    draftCoverageKg,
    pendingCount,
    highPendingCount,
    purchaseExposure,
  };
}

function formatPlanLabel(plan: MRPPlan) {
  return `${formatDisplayDateTime(plan.created_at)} · ${plan.plant_name || "All plants"}`;
}

function statusTone(status: MRPPlan["status"]) {
  if (status === "COMPLETED")
    return "bg-success-bg text-success-fg border-success-border";
  if (status === "RUNNING")
    return "bg-warning-bg text-warning-fg border-warning-border";
  if (status === "FAILED")
    return "bg-danger-bg text-danger-fg border-danger-border";
  return "bg-surface-2 text-content-2 border-line";
}

const PLAN_OUTLIER_DEMAND_KG = 5_000_000;
const PLAN_OUTLIER_SUPPLY_KG = 1_000_000;
type MRPViewTab = "overview" | "shortages" | "actions" | "history";

function effectiveSupplyForPlan(plan?: MRPPlan | null) {
  return plan ? toNumber(plan.total_available_kg) + toNumber(plan.total_wip_kg) : 0;
}

function isPlanOperationalOutlier(plan?: MRPPlan | null) {
  if (!plan) return false;
  const demand = toNumber(plan.total_demand_kg);
  const effectiveSupply = effectiveSupplyForPlan(plan);
  const shortage = toNumber(plan.total_shortage_kg);
  if (demand >= PLAN_OUTLIER_DEMAND_KG) return true;
  if (effectiveSupply >= PLAN_OUTLIER_SUPPLY_KG) return true;
  if (shortage >= PLAN_OUTLIER_DEMAND_KG) return true;
  return demand > 0 && effectiveSupply > 500_000 && effectiveSupply > demand * 8;
}

function buildPlanTrendData(plans: MRPPlan[]) {
  return [...plans]
    .filter((plan) => !isPlanOperationalOutlier(plan))
    .sort(
      (left, right) =>
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime(),
    )
    .slice(-8)
    .map((plan) => {
      const demand = toNumber(plan.total_demand_kg);
      const effectiveSupply = effectiveSupplyForPlan(plan);
      const coveredSupply = Math.min(demand, effectiveSupply);
      const uncoveredGap = Math.max(demand - coveredSupply, 0);
      const excessSupply = Math.max(effectiveSupply - demand, 0);
      const createdAt = new Date(plan.created_at);
      return {
        label: formatDisplayDateTime(createdAt),
        shortLabel: formatDisplayDate(createdAt),
        demand,
        coveredSupply,
        uncoveredGap,
        excessSupply,
        effectiveSupply,
      };
    });
}

export default function MRPCenter() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [activeView, setActiveView] = useState<MRPViewTab>("overview");
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<MRPPlanDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const plansQuery = useQuery({
    queryKey: ["mrp-plans"],
    queryFn: mrpService.getPlans,
    refetchInterval: 60_000,
  });

  const latestPlanQuery = useQuery({
    queryKey: ["mrp-latest"],
    queryFn: mrpService.getLatestPlan,
    refetchInterval: 60_000,
  });

  const plans = plansQuery.data || [];
  const latestPlan = latestPlanQuery.data || plans[0];
  const operationalPlans = useMemo(
    () => plans.filter((plan) => !isPlanOperationalOutlier(plan)),
    [plans],
  );
  const latestOperationalPlan = operationalPlans[0] || null;

  useEffect(() => {
    if (!selectedPlanId && (latestOperationalPlan?.id || latestPlan?.id)) {
      setSelectedPlanId(latestOperationalPlan?.id || latestPlan?.id || "");
    }
  }, [selectedPlanId, latestOperationalPlan, latestPlan]);

  const activePlan = useMemo(
    () =>
      plans.find((plan) => plan.id === selectedPlanId) ||
      latestOperationalPlan ||
      latestPlan ||
      null,
    [plans, selectedPlanId, latestOperationalPlan, latestPlan],
  );
  const activePlanOutlier = isPlanOperationalOutlier(activePlan);

  const requirementsQuery = useQuery({
    queryKey: ["mrp-requirements", activePlan?.id],
    queryFn: () => mrpService.getRequirements(activePlan?.id),
    enabled: !!activePlan?.id,
  });

  const suggestionsQuery = useQuery({
    queryKey: ["mrp-suggestions", activePlan?.id],
    queryFn: () => mrpService.getSuggestions(activePlan?.id),
    enabled: !!activePlan?.id,
  });

  const runMutation = useMutation({
    mutationFn: () => mrpService.runMRP(),
    onMutate: () => setIsRunning(true),
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ["mrp-plans"] });
      queryClient.invalidateQueries({ queryKey: ["mrp-latest"] });
      queryClient.invalidateQueries({ queryKey: ["mrp-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["mrp-suggestions"] });
      setSelectedPlanId(plan.id);
      toast({
        title: "MRP run complete",
        description:
          "Planning truth has been refreshed with the latest demand and supply signals.",
      });
      setIsRunning(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "MRP failed",
        description:
          error?.response?.data?.error ||
          error?.message ||
          "Unable to refresh the planning engine.",
      });
      setIsRunning(false);
    },
  });

  const draftMutation = useMutation({
    mutationFn: async ({
      suggestionId,
      action,
    }: {
      suggestionId: string;
      action: string;
    }) => {
      if (action === "PURCHASE") return mrpService.createDraftPO(suggestionId);
      if (action === "PRODUCE") return mrpService.createDraftJob(suggestionId);
      if (action === "TRANSFER")
        return mrpService.createDraftTransfer(suggestionId);
      throw new Error(`Unsupported action: ${action}`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["mrp-suggestions", activePlan?.id],
      });
      toast({
        title: data.po_id ? "Purchase Order drafted" : "Draft created",
        description: data.po_id
          ? `PO ${data.draft_ref} is ready — opening it now.`
          : `Reference ${data.draft_ref} is ready for review.`,
      });
      if (data.po_id) {
        router.push(`/procurement/purchase-orders/${data.po_id}`);
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Draft action failed",
        description:
          error?.response?.data?.error ||
          error?.message ||
          "Unable to create the draft action.",
      });
    },
  });

  const requirements = requirementsQuery.data || [];
  const suggestions = suggestionsQuery.data || [];

  const categoryScopedSuggestions = useMemo(() => {
    return suggestions.filter((suggestion) => {
      if (categoryFilter === "ALL") return true;
      return materialCategory(suggestion) === categoryFilter;
    });
  }, [suggestions, categoryFilter]);

  const actionButtonCounts = useMemo(
    () => countSuggestions(categoryScopedSuggestions),
    [categoryScopedSuggestions],
  );

  const highPurchasePending = useMemo(
    () =>
      suggestions.filter(
        (s) =>
          (s.priority || "").toString().toUpperCase() === "HIGH" &&
          resolveAction(s) === "PURCHASE" &&
          actionStatus(s) === "PENDING",
      ),
    [suggestions],
  );

  const bulkDraftMutation = useMutation({
    mutationFn: async (ids: string[]) => mrpService.bulkDraftPO(ids),
    onSuccess: (data) => {
      const created = (data?.results || []).length;
      const failed = (data?.errors || []).length;
      queryClient.invalidateQueries({ queryKey: ["mrp-suggestions"] });
      queryClient.invalidateQueries({
        queryKey: ["mrp-suggestions", activePlan?.id],
      });
      toast({
        title:
          failed > 0
            ? `Drafted ${created} POs · ${failed} failed`
            : `Drafted ${created} POs`,
        description:
          failed > 0
            ? "Some suggestions could not be drafted. Review the execution board for details."
            : "High-priority purchase suggestions converted to draft POs.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Bulk draft failed",
        description:
          error?.response?.data?.error ||
          error?.message ||
          "Unable to draft POs in bulk.",
      });
    },
  });

  const effectiveSupplyKg = effectiveSupplyForPlan(activePlan);
  const totalDemandKg = activePlan ? toNumber(activePlan.total_demand_kg) : 0;
  const shortageKg = activePlan ? toNumber(activePlan.total_shortage_kg) : 0;
  const coveragePct =
    totalDemandKg > 0 ? (effectiveSupplyKg / totalDemandKg) * 100 : 0;
  const shortagePct =
    totalDemandKg > 0 ? (shortageKg / totalDemandKg) * 100 : 0;

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const requirement of requirements) {
      values.add(materialCategory(requirement));
    }
    for (const suggestion of suggestions) {
      values.add(materialCategory(suggestion));
    }
    return Array.from(values).sort();
  }, [requirements, suggestions]);

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((suggestion) => {
      const action = resolveAction(suggestion);
      const category = materialCategory(suggestion);
      if (actionFilter !== "ALL" && action !== actionFilter) return false;
      if (categoryFilter !== "ALL" && category !== categoryFilter) return false;
      return true;
    });
  }, [suggestions, actionFilter, categoryFilter]);

  const filteredSuggestionMaterialIds = useMemo(
    () => new Set(filteredSuggestions.map((suggestion) => suggestion.material)),
    [filteredSuggestions],
  );

  const filteredRequirements = useMemo(() => {
    const rows = requirements
      .filter((requirement) => {
        const category = materialCategory(requirement);
        if (categoryFilter !== "ALL" && category !== categoryFilter)
          return false;
        if (
          actionFilter !== "ALL" &&
          !filteredSuggestionMaterialIds.has(requirement.material)
        ) {
          return false;
        }
        return true;
      })
      .map((requirement) => ({
        ...requirement,
        shortage: toNumber(requirement.shortage_qty_kg),
        required: toNumber(requirement.required_qty_kg),
        available: toNumber(requirement.available_qty_kg),
      }))
      .sort((left, right) => right.shortage - left.shortage);
    return rows;
  }, [requirements, actionFilter, categoryFilter, filteredSuggestionMaterialIds]);

  const actionMixData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const suggestion of filteredSuggestions) {
      const action = resolveAction(suggestion);
      totals.set(action, (totals.get(action) || 0) + 1);
    }
    return Array.from(totals.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }, [filteredSuggestions]);

  const categoryRiskData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const requirement of filteredRequirements) {
      if (requirementUnit(requirement) !== "KG") continue;
      const category =
        requirement.material_details?.category || "UNCATEGORISED";
      const shortage = Math.max(0, toNumber(requirement.shortage_qty_kg));
      totals.set(category, (totals.get(category) || 0) + shortage);
    }
    return Array.from(totals.entries())
      .map(([category, shortage]) => ({ category, shortage }))
      .sort((left, right) => right.shortage - left.shortage)
      .slice(0, 6);
  }, [filteredRequirements]);

  const filteredRequirementGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        material: string;
        name: string;
        code: string;
        category: string;
        unit: string;
        required: number;
        available: number;
        shortage: number;
        rowCount: number;
        sourceTypes: Set<string>;
        sourceRefs: Set<string>;
      }
    >();

    for (const requirement of filteredRequirements) {
      const key = requirement.material || requirement.id;
      const existing = groups.get(key);
      const next =
        existing ||
        {
          id: key,
          material: requirement.material,
          name: requirement.material_details?.name || "Material not linked",
          code: requirement.material_details?.code || "NO-CODE",
          category:
            requirement.material_details?.category || "UNCATEGORISED",
          unit: requirementUnit(requirement),
          required: 0,
          available: 0,
          shortage: 0,
          rowCount: 0,
          sourceTypes: new Set<string>(),
          sourceRefs: new Set<string>(),
        };
      next.required += requirement.required;
      next.available += requirement.available;
      next.shortage += requirement.shortage;
      next.rowCount += 1;
      if (requirement.source_type) next.sourceTypes.add(requirement.source_type);
      if (requirement.source_ref) next.sourceRefs.add(requirement.source_ref);
      groups.set(key, next);
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        coveredPct:
          group.required > 0
            ? Math.max(0, Math.min(100, (group.available / group.required) * 100))
            : 100,
        sourceTypeLabel: Array.from(group.sourceTypes).join(", ") || "MRP",
        sourceRefLabel: Array.from(group.sourceRefs).slice(0, 3).join(", "),
      }))
      .sort((left, right) => right.shortage - left.shortage);
  }, [filteredRequirements]);

  const planTrendData = useMemo(() => buildPlanTrendData(plans), [plans]);

  const actionStats = useMemo(() => {
    const stats = countSuggestions(filteredSuggestions);
    const planExposure = toNumber(activePlan?.purchase_value_est);
    return {
      ...stats,
      purchaseExposure:
        stats.purchaseExposure > 0 || actionFilter !== "ALL" || categoryFilter !== "ALL"
          ? stats.purchaseExposure
          : planExposure,
    };
  }, [activePlan?.purchase_value_est, actionFilter, categoryFilter, filteredSuggestions]);

  const filteredKgTotals = useMemo(() => {
    let requiredKg = 0;
    let availableKg = 0;
    let shortageKg = 0;
    const nonKgUnits = new Map<string, number>();

    for (const requirement of filteredRequirements) {
      const unit = requirementUnit(requirement);
      if (unit === "KG") {
        requiredKg += requirement.required;
        availableKg += requirement.available;
        shortageKg += Math.max(0, requirement.shortage);
      } else {
        nonKgUnits.set(unit, (nonKgUnits.get(unit) || 0) + Math.max(0, requirement.shortage));
      }
    }

    return {
      requiredKg,
      availableKg,
      shortageKg,
      coveredKg: Math.max(0, requiredKg - shortageKg),
      nonKgUnits: Array.from(nonKgUnits.entries()).map(([unit, qty]) => ({
        unit,
        qty,
      })),
    };
  }, [filteredRequirements]);

  const filterActive = actionFilter !== "ALL" || categoryFilter !== "ALL";
  const displayDemandKg = filterActive ? filteredKgTotals.requiredKg : totalDemandKg;
  const displayEffectiveSupplyKg = filterActive
    ? filteredKgTotals.availableKg
    : effectiveSupplyKg;
  const displayShortageKg = filterActive ? filteredKgTotals.shortageKg : shortageKg;
  const displayCoveragePct =
    displayDemandKg > 0 ? (displayEffectiveSupplyKg / displayDemandKg) * 100 : 0;
  const displayShortagePct =
    displayDemandKg > 0 ? (displayShortageKg / displayDemandKg) * 100 : 0;
  const displayCoveredKg = Math.max(0, displayDemandKg - displayShortageKg);
  const nonKgSummary = filteredKgTotals.nonKgUnits
    .slice(0, 2)
    .map((row) => `${formatQty(row.qty, row.unit)} short`)
    .join(" · ");

  const topShortages =
    activeView === "shortages"
      ? filteredRequirementGroups
      : filteredRequirementGroups.slice(0, 8);
  const recentPlans = [...plans]
    .sort(
      (left, right) =>
        new Date(right.created_at).getTime() -
        new Date(left.created_at).getTime(),
    )
    .slice(0, 6);
  const currentGapMaterials = filteredRequirementGroups.filter(
    (row) => row.shortage > 0,
  );
  const currentCoveredMaterials = filteredRequirementGroups.filter(
    (row) => row.shortage <= 0,
  );
  const workTabs: Array<{
    id: MRPViewTab;
    label: string;
    metric: string;
    detail: string;
  }> = [
    {
      id: "overview",
      label: "Overview",
      metric: `${formatKg(displayShortageKg)} gap`,
      detail: "Trend, posture, and summary",
    },
    {
      id: "shortages",
      label: "Material gaps",
      metric: `${currentGapMaterials.length} at risk`,
      detail: "Grouped shortage ledger",
    },
    {
      id: "actions",
      label: "Draft actions",
      metric: `${filteredSuggestions.length} suggestions`,
      detail: "PO, job, and transfer queue",
    },
    {
      id: "history",
      label: "Plan history",
      metric: `${recentPlans.length} runs`,
      detail: "Compare and audit runs",
    },
  ];

  return (
    <div className="min-h-screen bg-surface-2 px-6 py-6 md:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <section className="rounded-[2rem] border border-surface-1/70 bg-surface-1/88 p-6 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-info-border bg-info-bg px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-primary">
                <BrainCircuit className="h-3.5 w-3.5" />
                Material Planning Center
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-3 text-white shadow-lg ">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-content-1">
                    MRP Center
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm text-content-3">
                    Use one page to understand material pressure, action mix,
                    shortage concentration, and which draft moves are already
                    ready for execution.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
              <div className="grid gap-3 md:grid-cols-[minmax(240px,320px)_minmax(180px,240px)]">
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                    Plan run
                  </div>
                  <Select
                    value={activePlan?.id || ""}
                    onValueChange={setSelectedPlanId}
                  >
                    <SelectTrigger className="h-11 rounded-2xl border-line bg-surface-1/90 text-left shadow-sm">
                      <SelectValue placeholder="Choose plan run" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.length === 0 ? (
                        <SelectItem value="EMPTY" disabled>
                          No plans yet
                        </SelectItem>
                      ) : (
                        plans
                          .slice()
                          .sort(
                            (left, right) =>
                              new Date(right.created_at).getTime() -
                              new Date(left.created_at).getTime(),
                          )
                          .map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {formatPlanLabel(plan)}
                              {isPlanOperationalOutlier(plan)
                                ? " · historical outlier"
                                : ""}
                            </SelectItem>
                          ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                    Active status
                  </div>
                  <div className="flex h-11 items-center justify-between rounded-2xl border border-line bg-surface-1/90 px-4 shadow-sm">
                    <Badge
                      variant="outline"
                      className={statusTone(activePlan?.status || "DRAFT")}
                    >
                      {activePlan?.status || "NO PLAN"}
                    </Badge>
                    <span className="text-xs font-semibold text-content-3">
                      {activePlan?.created_at
                        ? formatDisplayDateTime(activePlan.created_at)
                        : "Run engine"}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                variant="outline"
                className="h-11 rounded-2xl border-warning-border bg-gradient-to-r from-warning-bg to-warm px-5 font-semibold text-warning-fg shadow-sm transition hover:from-warning-bg hover:to-warm disabled:opacity-60"
                onClick={() => {
                  if (activePlanOutlier) {
                    toast({
                      title: "Audit-only MRP run selected",
                      description:
                        "Select the latest clean operational run before drafting purchase orders.",
                    });
                    return;
                  }
                  if (highPurchasePending.length === 0) {
                    toast({
                      title: "No HIGH PURCHASE suggestions pending",
                      description:
                        "Run the planning engine or adjust priorities to surface high-priority buys.",
                    });
                    return;
                  }
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      `Draft ${highPurchasePending.length} POs for HIGH-priority items?`,
                    )
                  ) {
                    return;
                  }
                  bulkDraftMutation.mutate(
                    highPurchasePending.map((s) => s.id),
                  );
                }}
                disabled={bulkDraftMutation.isPending || activePlanOutlier}
                title="Draft purchase orders for every pending HIGH-priority PURCHASE suggestion in this plan"
              >
                {bulkDraftMutation.isPending ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-4 w-4" />
                )}
                Draft all HIGH ({highPurchasePending.length})
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-11 rounded-2xl px-5"
                disabled={!activePlan?.id || diffLoading}
                onClick={async () => {
                  if (!activePlan?.id) return;
                  setDiffLoading(true);
                  try {
                    const diff = await mrpService.getDiff(activePlan.id);
                    setDiffData(diff);
                    setDiffOpen(true);
                  } catch (err) {
                    toast({
                      title: "Diff failed",
                      description:
                        err instanceof Error ? err.message : "Unknown error",
                      variant: "destructive",
                    });
                  } finally {
                    setDiffLoading(false);
                  }
                }}
              >
                {diffLoading ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Split className="mr-2 h-4 w-4" />
                )}
                Compare with previous run
              </Button>
              <Button
                size="lg"
                className="h-11 rounded-2xl bg-surface-3 px-5 font-semibold text-white shadow-lg transition hover:bg-line"
                onClick={() => runMutation.mutate()}
                disabled={isRunning}
              >
                {isRunning ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {isRunning ? "Refreshing plan…" : "Run planning engine"}
              </Button>
            </div>
          </div>

          {diffOpen && diffData ? (
            <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-surface-1 shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface-1 px-6 py-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-content-4">
                    Plan diff
                  </div>
                  <div className="text-lg font-black text-content-1">
                    {diffData.from_plan
                      ? "Previous → current"
                      : "Current run (no prior to compare)"}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDiffOpen(false)}
                >
                  Close
                </Button>
              </div>
              <div className="space-y-4 p-6">
                <Card className="rounded-2xl border-success-border bg-success-bg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-black text-success-fg">
                      Added materials ({diffData.added_materials.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs">
                    {diffData.added_materials.length === 0 ? (
                      <span className="text-content-3">None.</span>
                    ) : (
                      <ul className="space-y-1">
                        {diffData.added_materials.map((m) => (
                          <li
                            key={m.material_id}
                            className="flex justify-between font-mono"
                          >
                            <span>{m.material_code}</span>
                            <span className="text-success-fg font-bold">
                              +{m.required_qty.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-danger-border bg-danger-bg">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-black text-danger-fg">
                      Removed materials ({diffData.removed_materials.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs">
                    {diffData.removed_materials.length === 0 ? (
                      <span className="text-content-3">None.</span>
                    ) : (
                      <ul className="space-y-1">
                        {diffData.removed_materials.map((m) => (
                          <li
                            key={m.material_id}
                            className="flex justify-between font-mono"
                          >
                            <span>{m.material_code}</span>
                            <span className="text-danger-fg font-bold">
                              -{m.required_qty.toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-line">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-black text-content-1">
                      Qty changes ({diffData.qty_changes.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs">
                    {diffData.qty_changes.length === 0 ? (
                      <span className="text-content-3">
                        No quantity deltas.
                      </span>
                    ) : (
                      <ul className="space-y-1">
                        {diffData.qty_changes.map((c) => (
                          <li
                            key={c.material_id}
                            className="flex justify-between font-mono"
                          >
                            <span>{c.material_code}</span>
                            <span
                              className={
                                c.delta > 0
                                  ? "text-warning-fg font-bold"
                                  : "text-primary font-bold"
                              }
                            >
                              {c.from_qty.toFixed(2)} → {c.to_qty.toFixed(2)} (
                              {c.delta > 0 ? "+" : ""}
                              {c.delta.toFixed(2)})
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-wrap items-center gap-2 rounded-[1.4rem] border border-line bg-surface-2 px-3 py-3">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                Action focus
              </span>
              {ACTION_FILTERS.map((value) => {
                const count =
                  value === "ALL"
                    ? actionButtonCounts.totalCount
                    : value === "PURCHASE"
                      ? actionButtonCounts.purchaseCount
                      : value === "PRODUCE"
                        ? actionButtonCounts.produceCount
                        : actionButtonCounts.transferCount;
                return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActionFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    actionFilter === value
                      ? "bg-surface-3 text-white"
                      : "bg-surface-1 text-content-3 shadow-sm hover:bg-surface-2"
                  }`}
                  title={`${count.toLocaleString()} ${actionCopy(value).toLowerCase()} suggestion${count === 1 ? "" : "s"} in the selected category`}
                >
                  {actionCopy(value)}
                  <span
                    className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                      actionFilter === value
                        ? "bg-white/15 text-white"
                        : "bg-surface-2 text-content-4"
                    }`}
                  >
                    {count.toLocaleString()}
                  </span>
                </button>
                );
              })}
            </div>
            <div className="rounded-[1.4rem] border border-line bg-surface-2 p-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 min-w-[220px] rounded-xl border-line bg-surface-1 shadow-sm">
                  <SelectValue placeholder="Filter category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-[1.4rem] border border-line bg-surface-2 px-4 py-3 text-right shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                Plan owner
              </div>
              <div className="mt-1 text-sm font-semibold text-content-2">
                {activePlan?.created_by_name || "System"}
              </div>
            </div>
          </div>

          {activePlanOutlier ? (
            <div className="mt-5 rounded-[1.4rem] border border-warning-border bg-warning-bg px-4 py-3 text-sm font-semibold text-warning-fg">
              Historical MRP outlier selected. This run is kept for audit, but
              it contains totals outside the current operational guardrails, so
              the trend and default dashboard use clean current runs instead.
              Recorded values remain visible below for trace review only.
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label="Demand"
            value={activePlanOutlier ? "Audit only" : formatKg(displayDemandKg)}
            hint={
              activePlanOutlier
                ? `Recorded ${formatKg(totalDemandKg)}; excluded from operational trend`
                : filterActive
                  ? `KG demand in current filter${nonKgSummary ? `; ${nonKgSummary}` : ""}`
                  : "Net KG requirement across current plan"
            }
            icon={TrendingUp}
            tone="indigo"
          />
          <MetricCard
            label="Effective supply"
            value={activePlanOutlier ? "Audit only" : formatKg(displayEffectiveSupplyKg)}
            hint={
              activePlanOutlier
                ? `Recorded ${formatKg(effectiveSupplyKg)}; use latest clean run for action`
                : filterActive
                  ? "Available KG against the selected material/action filter"
                  : `${formatKg(activePlan?.total_available_kg)} stock + ${formatKg(activePlan?.total_wip_kg)} WIP`
            }
            icon={Boxes}
            tone="emerald"
          />
          <MetricCard
            label="Shortage gap"
            value={activePlanOutlier ? "Audit only" : formatKg(displayShortageKg)}
            hint={
              activePlanOutlier
                ? `Recorded ${formatKg(shortageKg)}; not current action truth`
                : `${displayShortagePct.toFixed(1)}% of visible KG demand still uncovered`
            }
            icon={TrendingDown}
            tone="rose"
          />
          <MetricCard
            label="Coverage ratio"
            value={activePlanOutlier ? "Audit only" : `${displayCoveragePct.toFixed(1)}%`}
            hint={
              activePlanOutlier
                ? "Outlier run; coverage is not used for current planning"
                : `${displayCoveredKg.toLocaleString(undefined, { maximumFractionDigits: 0 })} kg already covered in view`
            }
            icon={PackageCheck}
            tone="sky"
          />
          <MetricCard
            label="Purchase exposure"
            value={formatMoney(actionStats.purchaseExposure)}
            hint={`${actionStats.purchaseCount} buy action${actionStats.purchaseCount === 1 ? "" : "s"} in current view`}
            icon={ShoppingCart}
            tone="amber"
          />
          <MetricCard
            label="Drafted actions"
            value={String(actionStats.draftCount)}
            hint={`${formatKg(actionStats.draftCoverageKg)} draft cover in current view; non-KG actions counted separately`}
            icon={Sparkles}
            tone="violet"
          />
        </section>

        <section className="rounded-[2rem] border border-surface-1/70 bg-surface-1/88 p-3 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.38)]">
          <div className="grid gap-3 lg:grid-cols-4">
            {workTabs.map((tab) => {
              const selected = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveView(tab.id)}
                  className={`rounded-[1.35rem] border px-4 py-3 text-left transition ${
                    selected
                      ? "border-line-strong bg-surface-3 text-white shadow-lg"
                      : "border-line bg-surface-2 text-content-2 hover:border-line-strong hover:bg-surface-1"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-black uppercase tracking-[0.16em]">
                      {tab.label}
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        selected
                          ? "border-white/20 bg-white/10 text-white"
                          : "border-line bg-surface-1 text-content-3"
                      }
                    >
                      {tab.metric}
                    </Badge>
                  </div>
                  <div
                    className={`mt-2 text-xs font-semibold ${
                      selected ? "text-white/70" : "text-content-3"
                    }`}
                  >
                    {tab.detail}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryStrip
            title="Visible action scope"
            value={`${actionCopy(actionFilter)} · ${categoryFilter === "ALL" ? "All categories" : categoryFilter}`}
            note={`${filteredSuggestions.length} suggestion${filteredSuggestions.length === 1 ? "" : "s"} matched`}
            accent="indigo"
          />
          <SummaryStrip
            title="Materials in view"
            value={String(filteredRequirementGroups.length)}
            note={`${currentGapMaterials.length} at risk · ${currentCoveredMaterials.length} covered`}
            accent={currentGapMaterials.length > 0 ? "amber" : "emerald"}
          />
          <SummaryStrip
            title="Pending actions"
            value={String(actionStats.pendingCount)}
            note={`${actionStats.highPendingCount} high priority · ${actionStats.draftCount} already drafted`}
            accent={actionStats.highPendingCount > 0 ? "rose" : "emerald"}
          />
          <SummaryStrip
            title="Non-KG shortages"
            value={filteredKgTotals.nonKgUnits.length ? `${filteredKgTotals.nonKgUnits.length} unit type${filteredKgTotals.nonKgUnits.length === 1 ? "" : "s"}` : "None"}
            note={nonKgSummary || "Visible shortage is fully KG-based"}
            accent={filteredKgTotals.nonKgUnits.length ? "violet" : "emerald"}
          />
        </section>

        {activeView === "overview" || activeView === "history" ? (
        <section className="grid gap-6 xl:grid-cols-[1.6fr_0.95fr] xl:items-start">
          <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-line bg-surface-1/75">
              <CardTitle className="text-lg font-black tracking-tight text-content-1">
                Supply vs demand trend
              </CardTitle>
              <CardDescription>
                Recent plan runs show whether available stock plus WIP is
                closing the demand gap or widening it. Historical outlier runs
                are excluded from this operational trend.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-[360px]">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={0}
                  minHeight={0}
                  initialDimension={{ width: 1, height: 1 }}
                >
                  <AreaChart
                    data={planTrendData}
                    margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="mrpDemand"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#4F46E5"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="#4F46E5"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="mrpSupply"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#10B981"
                          stopOpacity={0.22}
                        />
                        <stop
                          offset="95%"
                          stopColor="#10B981"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="mrpShortage"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#EF4444"
                          stopOpacity={0.18}
                        />
                        <stop
                          offset="95%"
                          stopColor="#EF4444"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#E2E8F0"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="shortLabel"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#64748B", fontSize: 12 }}
                    />
                    <YAxis
                      tickFormatter={(value) =>
                        `${Math.round(Number(value) / 1000)}k`
                      }
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#64748B", fontSize: 12 }}
                    />
                    <RechartsTooltip
                      labelFormatter={(_, payload) =>
                        String(payload?.[0]?.payload?.label || "")
                      }
                      formatter={(value, name) => [
                        formatKg(Number(value) || 0),
                        String(name ?? ""),
                      ]}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="demand"
                      name="Demand"
                      stroke="#4F46E5"
                      strokeWidth={2.4}
                      fill="url(#mrpDemand)"
                    />
                    <Area
                      type="monotone"
                      dataKey="coveredSupply"
                      name="Covered supply"
                      stroke="#10B981"
                      strokeWidth={2.4}
                      fill="url(#mrpSupply)"
                    />
                    <Area
                      type="monotone"
                      dataKey="uncoveredGap"
                      name="Uncovered gap"
                      stroke="#EF4444"
                      strokeWidth={2.2}
                      fill="url(#mrpShortage)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs font-semibold text-content-3">
                  {filterActive ? "Visible KG coverage" : "Latest run coverage"}
                  <div className="mt-1 text-base font-black text-content-1">
                    {formatKg(displayCoveredKg)}
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs font-semibold text-content-3">
                  Uncovered gap
                  <div className="mt-1 text-base font-black text-content-1">
                    {formatKg(displayShortageKg)}
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-xs font-semibold text-content-3">
                  Excess cover
                  <div className="mt-1 text-base font-black text-content-1">
                    {formatKg(Math.max(displayEffectiveSupplyKg - displayDemandKg, 0))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
              <CardHeader className="border-b border-line bg-surface-1/75">
                <CardTitle className="text-lg font-black tracking-tight text-content-1">
                  Execution posture
                </CardTitle>
                <CardDescription>
                  Action mix and draft readiness from the selected plan.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-6 md:grid-cols-[1fr_1.1fr]">
                <div className="h-[220px]">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={0}
                    initialDimension={{ width: 1, height: 1 }}
                  >
                    <PieChart>
                      <Pie
                        data={actionMixData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={56}
                        outerRadius={82}
                        stroke="none"
                        paddingAngle={3}
                      >
                        {actionMixData.map((entry) => (
                          <Cell
                            key={entry.name}
                            fill={
                              ACTION_COLORS[
                                entry.name as keyof typeof ACTION_COLORS
                              ] || "#94A3B8"
                            }
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number | string | undefined) =>
                          `${toNumber(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} action(s)`
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  <PostureTile
                    label="Purchase"
                    value={String(actionStats.purchaseCount)}
                    detail="Supplier-led recovery"
                    tone="amber"
                  />
                  <PostureTile
                    label="Produce"
                    value={String(actionStats.produceCount)}
                    detail="Internal manufacturing moves"
                    tone="indigo"
                  />
                  <PostureTile
                    label="Transfer"
                    value={String(actionStats.transferCount)}
                    detail="Inter-plant balancing"
                    tone="emerald"
                  />
                  <PostureTile
                    label="Draft cover"
                    value={formatKg(actionStats.draftCoverageKg)}
                    detail="KG-only cover from drafted actions"
                    tone="violet"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
              <CardHeader className="border-b border-line bg-surface-1/75">
                <CardTitle className="text-lg font-black tracking-tight text-content-1">
                  KG risk concentration
                </CardTitle>
                <CardDescription>
                  KG-material shortages grouped by category. Non-KG rows remain
                  in the material and action lists with their own unit.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="h-[240px]">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={0}
                    initialDimension={{ width: 1, height: 1 }}
                  >
                    <BarChart
                      data={categoryRiskData}
                      layout="vertical"
                      margin={{ top: 8, right: 8, left: 12, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#E2E8F0"
                        horizontal={false}
                      />
                      <XAxis
                        type="number"
                        tickFormatter={(value) =>
                          `${Math.round(Number(value) / 1000)}k`
                        }
                        tickLine={false}
                        axisLine={false}
                        tick={{ fill: "#64748B", fontSize: 12 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="category"
                        tickLine={false}
                        axisLine={false}
                        width={92}
                        tick={{ fill: "#475569", fontSize: 11 }}
                      />
                      <RechartsTooltip
                        formatter={(value: number | string | undefined) =>
                          formatKg(value as number)
                        }
                      />
                      <Bar
                        dataKey="shortage"
                        fill="#F97316"
                        radius={[0, 10, 10, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
        ) : null}

        {activeView === "overview" ||
        activeView === "shortages" ||
        activeView === "actions" ? (
        <section
          className={`grid gap-6 xl:items-start ${
            activeView === "overview"
              ? "xl:grid-cols-[1.15fr_1.35fr]"
              : "xl:grid-cols-1"
          }`}
        >
          {activeView !== "actions" ? (
          <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-line bg-surface-1/75">
              <CardTitle className="text-lg font-black tracking-tight text-content-1">
                Material shortage ledger
              </CardTitle>
              <CardDescription>
                Current-plan requirements grouped by material, ordered by
                uncovered quantity in each material's stock unit.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[620px] space-y-4 overflow-y-auto p-6">
              {topShortages.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-line bg-surface-2 p-10 text-center text-sm text-content-3">
                  No uncovered requirements for the current filter.
                </div>
              ) : (
                topShortages.map((requirement) => {
                  return (
                    <div
                      key={requirement.id}
                      className="rounded-[1.5rem] border border-line bg-surface-2 p-4 shadow-sm"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="text-sm font-black tracking-tight text-content-1">
                            {requirement.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-content-3">
                            <span>{requirement.code}</span>
                            <span>·</span>
                            <span>{requirement.category}</span>
                            <span>·</span>
                            <span>{requirement.sourceTypeLabel}</span>
                            <Badge
                              variant="outline"
                              className="border-line bg-surface-1 text-content-3"
                            >
                              {requirement.rowCount} row
                              {requirement.rowCount === 1 ? "" : "s"}
                            </Badge>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            requirement.shortage > 0
                              ? "border-danger-border bg-danger-bg text-danger-fg"
                              : "border-success-border bg-success-bg text-success-fg"
                          }
                        >
                          {requirement.shortage > 0
                            ? `Short ${formatQty(requirement.shortage, requirement.unit)}`
                            : "Covered"}
                        </Badge>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-line">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-success-fg to-primary"
                          style={{ width: `${requirement.coveredPct}%` }}
                        />
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-semibold text-content-3 md:grid-cols-3">
                        <span className="rounded-xl bg-surface-1 px-3 py-2">
                          Required
                          <br />
                          <strong className="text-sm text-content-1">
                            {formatQty(requirement.required, requirement.unit)}
                          </strong>
                        </span>
                        <span className="rounded-xl bg-surface-1 px-3 py-2">
                          Available
                          <br />
                          <strong className="text-sm text-content-1">
                            {formatQty(requirement.available, requirement.unit)}
                          </strong>
                        </span>
                        <span className="rounded-xl bg-surface-1 px-3 py-2">
                          Shortage
                          <br />
                          <strong className="text-sm text-content-1">
                            {formatQty(requirement.shortage, requirement.unit)}
                          </strong>
                        </span>
                      </div>
                      {requirement.sourceRefLabel ? (
                        <div className="mt-3 rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs font-semibold text-content-3">
                          Source: {requirement.sourceRefLabel}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          ) : null}

          {activeView !== "shortages" ? (
          <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-line bg-surface-1/75">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg font-black tracking-tight text-content-1">
                    Action execution board
                  </CardTitle>
                  <CardDescription>
                    Draft procurement, production, or transfer actions directly
                    from planning truth.
                  </CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className="border-line bg-surface-1 text-content-3"
                >
                  {filteredSuggestions.length} suggestions in view
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="max-h-[620px] space-y-3 overflow-y-auto p-6">
              {filteredSuggestions.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-line bg-surface-2 p-10 text-center">
                  <div className="text-sm font-black text-content-1">
                    No {actionCopy(actionFilter).toLowerCase()} suggestions in this view.
                  </div>
                  <div className="mx-auto mt-2 max-w-xl text-sm font-semibold leading-6 text-content-3">
                    {actionFilter === "PRODUCE"
                      ? "Produce appears only when the selected plan has in-house POD or extrudable film shortages. The current plan has no internal production recovery rows."
                      : actionFilter === "TRANSFER"
                        ? "Transfer appears only when another plant has usable excess stock for the shortage material."
                        : "Change the action or category filter to inspect the other MRP suggestions in this plan."}
                  </div>
                </div>
              ) : (
                filteredSuggestions.map((suggestion) => {
                  const action = resolveAction(suggestion);
                  const drafted = isDraftedActionStatus(actionStatus(suggestion));
                  return (
                    <div
                      key={suggestion.id}
                      className="rounded-[1.5rem] border border-line bg-surface-2 p-4 shadow-sm transition hover:border-line-strong hover:bg-surface-1"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                action === "PURCHASE"
                                  ? "border-warning-border bg-warning-bg text-warning-fg"
                                  : action === "PRODUCE"
                                    ? "border-info-border bg-info-bg text-primary"
                                    : "border-success-border bg-success-bg text-success-fg"
                              }
                            >
                              {action}
                            </Badge>
                            {drafted ? (
                              <Badge
                                variant="outline"
                                className="border-success-border bg-success-bg text-success-fg"
                              >
                                Drafted
                              </Badge>
                            ) : null}
                            <Badge
                              variant="outline"
                              className="border-line bg-surface-1 text-content-3"
                            >
                              {suggestion.material_details?.category ||
                                "UNCATEGORISED"}
                            </Badge>
                          </div>
                          <div className="text-base font-black tracking-tight text-content-1">
                            {suggestion.material_name ||
                              suggestion.material_details?.name ||
                              "Material not linked"}
                          </div>
                          <div className="text-xs font-semibold text-content-3">
                            {suggestion.material_code ||
                              suggestion.material_details?.code ||
                              "Code not recorded"}{" "}
                            · {formatQty(suggestion.quantity ?? suggestion.qty, suggestionUnit(suggestion))}
                          </div>
                          <p className="max-w-2xl text-sm text-content-3">
                            {suggestion.reason}
                          </p>
                        </div>

                        <div className="flex flex-col items-start gap-2 lg:items-end">
                          {drafted ? (
                            <div className="inline-flex items-center rounded-xl border border-success-border bg-success-bg px-3 py-2 text-sm font-semibold text-success-fg">
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              {suggestion.draft_ref || "Draft created"}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={draftMutation.isPending || activePlanOutlier}
                              className="rounded-xl border-line bg-surface-1 shadow-sm"
                              onClick={() =>
                                draftMutation.mutate({
                                  suggestionId: suggestion.id,
                                  action,
                                })
                              }
                            >
                              {action === "PURCHASE" ? (
                                <ShoppingCart className="mr-2 h-4 w-4" />
                              ) : action === "PRODUCE" ? (
                                <Factory className="mr-2 h-4 w-4" />
                              ) : (
                                <Split className="mr-2 h-4 w-4" />
                              )}
                              {activePlanOutlier
                                ? "Audit only"
                                : action === "PURCHASE"
                                ? "Create PO"
                                : action === "PRODUCE"
                                  ? "Create Job"
                                  : "Create Transfer"}
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          )}
                          <div className="text-xs font-semibold text-content-4">
                            {suggestion.required_date
                              ? `Need by ${formatDisplayDate(suggestion.required_date)}`
                              : "Required date not pinned"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
          ) : null}
        </section>
        ) : null}

        {activeView === "overview" || activeView === "history" ? (
        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
          <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-line bg-surface-1/75">
              <CardTitle className="text-lg font-black tracking-tight text-content-1">
                Planning summary
              </CardTitle>
              <CardDescription>
                Quick operational readout for the active plan before you move
                into action execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-6 md:grid-cols-2">
              <SummaryStrip
                title="At-risk materials"
                value={String(currentGapMaterials.length)}
                note="Materials still not fully covered"
                accent="rose"
              />
              <SummaryStrip
                title="Covered materials"
                value={String(currentCoveredMaterials.length)}
                note="Requirements already resolved by stock or WIP"
                accent="emerald"
              />
              <SummaryStrip
                title="Largest single gap"
                value={formatQty(
                  topShortages[0]?.shortage || 0,
                  topShortages[0]?.unit || "KG",
                )}
                note={topShortages[0]?.code || "No shortage leader"}
                accent="amber"
              />
              <SummaryStrip
                title="Demand posture"
                value={
                  displayCoveragePct >= 100
                    ? "Protected"
                    : displayCoveragePct >= 80
                      ? "Tight"
                      : "Critical"
                }
                note={`${displayShortagePct.toFixed(1)}% shortage share in view`}
                accent={
                  displayCoveragePct >= 100
                    ? "emerald"
                    : displayCoveragePct >= 80
                      ? "amber"
                      : "rose"
                }
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[2rem] border border-surface-1/70 bg-surface-1/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-line bg-surface-1/75">
              <CardTitle className="text-lg font-black tracking-tight text-content-1">
                Recent plan runs
              </CardTitle>
              <CardDescription>
                Review demand, effective supply, shortage, and purchase exposure
                across the last few planning cycles.
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[460px] space-y-3 overflow-y-auto p-6">
              {recentPlans.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-line bg-surface-2 p-10 text-center text-sm text-content-3">
                  No recent plans yet. Run the engine to establish the first
                  baseline.
                </div>
              ) : (
                recentPlans.map((plan) => {
                  const active = plan.id === activePlan?.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
                        active
                          ? "border-line-strong bg-surface-3 text-white shadow-lg "
                          : "border-line bg-surface-2 text-content-2 hover:border-line-strong hover:bg-surface-1"
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-sm font-black tracking-tight">
                            {formatPlanLabel(plan)}
                            {isPlanOperationalOutlier(plan) ? (
                              <span
                                className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] ${active ? "bg-warning-bg text-warning-fg" : "bg-warning-bg text-warning-fg"}`}
                              >
                                Audit outlier
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`mt-1 text-xs font-semibold ${active ? "text-content-4" : "text-content-3"}`}
                          >
                            {plan.created_by_name || "System"} ·{" "}
                            {plan.plant_name || "All plants"}
                          </div>
                        </div>
                        <div className="grid gap-2 text-xs font-semibold md:grid-cols-4">
                          <span
                            className={`rounded-xl px-3 py-2 ${active ? "bg-surface-1/10 text-white" : "bg-surface-1 text-content-2"}`}
                          >
                            Demand
                            <br />
                            <strong>{formatKg(plan.total_demand_kg)}</strong>
                          </span>
                          <span
                            className={`rounded-xl px-3 py-2 ${active ? "bg-surface-1/10 text-white" : "bg-surface-1 text-content-2"}`}
                          >
                            Supply
                            <br />
                            <strong>
                              {formatKg(
                                toNumber(plan.total_available_kg) +
                                  toNumber(plan.total_wip_kg),
                              )}
                            </strong>
                          </span>
                          <span
                            className={`rounded-xl px-3 py-2 ${active ? "bg-surface-1/10 text-white" : "bg-surface-1 text-content-2"}`}
                          >
                            Shortage
                            <br />
                            <strong>{formatKg(plan.total_shortage_kg)}</strong>
                          </span>
                          <span
                            className={`rounded-xl px-3 py-2 ${active ? "bg-surface-1/10 text-white" : "bg-surface-1 text-content-2"}`}
                          >
                            Value
                            <br />
                            <strong>
                              {formatMoney(plan.purchase_value_est)}
                            </strong>
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>
        ) : null}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  tone: "indigo" | "emerald" | "rose" | "sky" | "amber" | "violet";
}) {
  const toneMap = {
    indigo: "bg-info-bg text-primary",
    emerald: "bg-success-bg text-success-fg",
    rose: "bg-danger-bg text-danger-fg",
    sky: "bg-info-bg text-info-fg",
    amber: "bg-warning-bg text-warning-fg",
    violet: "bg-info-bg text-primary",
  } as const;

  return (
    <div className="rounded-[1.75rem] border border-surface-1/70 bg-surface-1/88 p-5 shadow-[0_18px_55px_-40px_rgba(15,23,42,0.42)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_70px_-45px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
            {label}
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-content-1">
            {value}
          </div>
        </div>
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneMap[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs font-medium leading-5 text-content-3">
        {hint}
      </p>
    </div>
  );
}

function PostureTile({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "amber" | "indigo" | "emerald" | "violet";
}) {
  const toneMap = {
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    indigo: "border-info-border bg-info-bg text-primary",
    emerald: "border-success-border bg-success-bg text-success-fg",
    violet: "border-info-border bg-info-bg text-primary",
  } as const;

  return (
    <div className={`rounded-[1.3rem] border px-4 py-3 ${toneMap[tone]}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.22em]">
        {label}
      </div>
      <div className="mt-2 text-xl font-black tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-semibold opacity-80">{detail}</div>
    </div>
  );
}

function SummaryStrip({
  title,
  value,
  note,
  accent,
}: {
  title: string;
  value: string;
  note: string;
  accent: "rose" | "emerald" | "amber" | "indigo" | "violet";
}) {
  const accentMap = {
    rose: "from-danger-solid to-danger-bg text-danger-fg",
    emerald: "from-success-fg to-success-bg text-success-fg",
    amber: "from-warning-fg to-warning-bg text-warning-fg",
    indigo: "from-primary to-info-bg text-primary",
    violet: "from-primary to-info-bg text-primary",
  } as const;

  return (
    <div
      className={`rounded-[1.4rem] border border-line bg-gradient-to-br px-4 py-4 ${accentMap[accent]}`}
    >
      <div className="text-[10px] font-black uppercase tracking-[0.22em]">
        {title}
      </div>
      <div className="mt-2 break-words text-xl font-black tracking-tight">
        {value}
      </div>
      <div className="mt-1 text-xs font-semibold opacity-85">{note}</div>
    </div>
  );
}
