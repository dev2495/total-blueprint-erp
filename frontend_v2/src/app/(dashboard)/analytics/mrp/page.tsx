"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
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
} from "lucide-react";

import { mrpService, type MRPPlan, type MRPRequirement, type MRPSuggestion } from "@/services/mrp";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ACTION_COLORS = {
  PURCHASE: "#F59E0B",
  PRODUCE: "#4F46E5",
  TRANSFER: "#10B981",
} as const;

function toNumber(value: string | number | null | undefined) {
  return Number(value || 0);
}

function formatKg(value: string | number | null | undefined) {
  return `${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })} kg`;
}

function formatMoney(value: string | number | null | undefined) {
  return `₹${toNumber(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function resolveAction(suggestion: MRPSuggestion) {
  return suggestion.action || (suggestion.type === "MTS_PRODUCE" ? "PRODUCE" : suggestion.type);
}

function formatPlanLabel(plan: MRPPlan) {
  return `${format(new Date(plan.created_at), "dd MMM HH:mm")} · ${plan.plant_name || "All plants"}`;
}

function statusTone(status: MRPPlan["status"]) {
  if (status === "COMPLETED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "RUNNING") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "FAILED") return "bg-rose-50 text-rose-700 border-rose-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function buildPlanTrendData(plans: MRPPlan[]) {
  return [...plans]
    .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime())
    .slice(-8)
    .map((plan) => {
      const demand = toNumber(plan.total_demand_kg);
      const effectiveSupply = toNumber(plan.total_available_kg) + toNumber(plan.total_wip_kg);
      const coveredSupply = Math.min(demand, effectiveSupply);
      const uncoveredGap = Math.max(demand - coveredSupply, 0);
      const excessSupply = Math.max(effectiveSupply - demand, 0);
      const createdAt = new Date(plan.created_at);
      return {
        label: format(createdAt, "dd MMM HH:mm"),
        shortLabel: format(createdAt, "dd MMM"),
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
  const [isRunning, setIsRunning] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

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

  useEffect(() => {
    if (!selectedPlanId && latestPlan?.id) {
      setSelectedPlanId(latestPlan.id);
    }
  }, [selectedPlanId, latestPlan]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || latestPlan || null,
    [plans, selectedPlanId, latestPlan]
  );

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
        description: "Planning truth has been refreshed with the latest demand and supply signals.",
      });
      setIsRunning(false);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "MRP failed",
        description: error?.response?.data?.error || error?.message || "Unable to refresh the planning engine.",
      });
      setIsRunning(false);
    },
  });

  const draftMutation = useMutation({
    mutationFn: async ({ suggestionId, action }: { suggestionId: string; action: string }) => {
      if (action === "PURCHASE") return mrpService.createDraftPO(suggestionId);
      if (action === "PRODUCE") return mrpService.createDraftJob(suggestionId);
      if (action === "TRANSFER") return mrpService.createDraftTransfer(suggestionId);
      throw new Error(`Unsupported action: ${action}`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["mrp-suggestions", activePlan?.id] });
      toast({
        title: "Draft created",
        description: `Reference ${data.draft_ref} is ready for review.`,
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Draft action failed",
        description: error?.response?.data?.error || error?.message || "Unable to create the draft action.",
      });
    },
  });

  const requirements = requirementsQuery.data || [];
  const suggestions = suggestionsQuery.data || [];

  const effectiveSupplyKg = activePlan ? toNumber(activePlan.total_available_kg) + toNumber(activePlan.total_wip_kg) : 0;
  const totalDemandKg = activePlan ? toNumber(activePlan.total_demand_kg) : 0;
  const shortageKg = activePlan ? toNumber(activePlan.total_shortage_kg) : 0;
  const coveragePct = totalDemandKg > 0 ? (effectiveSupplyKg / totalDemandKg) * 100 : 0;
  const shortagePct = totalDemandKg > 0 ? (shortageKg / totalDemandKg) * 100 : 0;

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const requirement of requirements) {
      if (requirement.material_details?.category) {
        values.add(requirement.material_details.category);
      }
    }
    return Array.from(values).sort();
  }, [requirements]);

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((suggestion) => {
      const action = resolveAction(suggestion);
      const category = suggestion.material_details?.category || "UNCATEGORISED";
      if (actionFilter !== "ALL" && action !== actionFilter) return false;
      if (categoryFilter !== "ALL" && category !== categoryFilter) return false;
      return true;
    });
  }, [suggestions, actionFilter, categoryFilter]);

  const filteredRequirements = useMemo(() => {
    const rows = requirements
      .filter((requirement) => {
        const category = requirement.material_details?.category || "UNCATEGORISED";
        if (categoryFilter !== "ALL" && category !== categoryFilter) return false;
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
  }, [requirements, categoryFilter]);

  const actionMixData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const suggestion of suggestions) {
      const action = resolveAction(suggestion);
      totals.set(action, (totals.get(action) || 0) + toNumber(suggestion.quantity ?? suggestion.qty));
    }
    return Array.from(totals.entries()).map(([name, value]) => ({ name, value }));
  }, [suggestions]);

  const categoryRiskData = useMemo(() => {
    const totals = new Map<string, number>();
    for (const requirement of requirements) {
      const category = requirement.material_details?.category || "UNCATEGORISED";
      const shortage = Math.max(0, toNumber(requirement.shortage_qty_kg));
      totals.set(category, (totals.get(category) || 0) + shortage);
    }
    return Array.from(totals.entries())
      .map(([category, shortage]) => ({ category, shortage }))
      .sort((left, right) => right.shortage - left.shortage)
      .slice(0, 6);
  }, [requirements]);

  const planTrendData = useMemo(() => buildPlanTrendData(plans), [plans]);

  const actionStats = useMemo(() => {
    let purchaseCount = 0;
    let produceCount = 0;
    let transferCount = 0;
    let draftCount = 0;
    let draftCoverageKg = 0;

    for (const suggestion of suggestions) {
      const action = resolveAction(suggestion);
      if (action === "PURCHASE") purchaseCount += 1;
      if (action === "PRODUCE") produceCount += 1;
      if (action === "TRANSFER") transferCount += 1;
      if (suggestion.action_status === "DRAFT_CREATED") {
        draftCount += 1;
        draftCoverageKg += toNumber(suggestion.quantity ?? suggestion.qty);
      }
    }

    return { purchaseCount, produceCount, transferCount, draftCount, draftCoverageKg };
  }, [suggestions]);

  const topShortages = filteredRequirements.slice(0, 8);
  const recentPlans = [...plans].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()).slice(0, 6);

  return (
    <div className="min-h-screen bg-slate-50/70 px-6 py-6 md:px-8">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)] backdrop-blur-xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-indigo-600">
                <BrainCircuit className="h-3.5 w-3.5" />
                Material Planning Center
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-200">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tight text-slate-900">MRP Center</h1>
                  <p className="mt-1 max-w-3xl text-sm text-slate-500">
                    Use one page to understand material pressure, action mix, shortage concentration, and which draft moves are already ready for execution.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end">
              <div className="grid gap-3 md:grid-cols-[minmax(240px,320px)_minmax(180px,240px)]">
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Plan run</div>
                  <Select value={activePlan?.id || ""} onValueChange={setSelectedPlanId}>
                    <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white/90 text-left shadow-sm">
                      <SelectValue placeholder="Choose plan run" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.length === 0 ? (
                        <SelectItem value="EMPTY" disabled>No plans yet</SelectItem>
                      ) : (
                        plans
                          .slice()
                          .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
                          .map((plan) => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {formatPlanLabel(plan)}
                            </SelectItem>
                          ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Active status</div>
                  <div className="flex h-11 items-center justify-between rounded-2xl border border-slate-200 bg-white/90 px-4 shadow-sm">
                    <Badge variant="outline" className={statusTone(activePlan?.status || "DRAFT")}>
                      {activePlan?.status || "NO PLAN"}
                    </Badge>
                    <span className="text-xs font-semibold text-slate-500">
                      {activePlan?.created_at ? format(new Date(activePlan.created_at), "dd MMM, HH:mm") : "Run engine"}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                className="h-11 rounded-2xl bg-slate-900 px-5 font-semibold text-white shadow-lg shadow-slate-200 transition hover:bg-slate-800"
                onClick={() => runMutation.mutate()}
                disabled={isRunning}
              >
                {isRunning ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {isRunning ? "Refreshing plan…" : "Run planning engine"}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_auto_auto]">
            <div className="flex flex-wrap items-center gap-2 rounded-[1.4rem] border border-slate-200 bg-slate-50/70 px-3 py-3">
              <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Action focus</span>
              {["ALL", "PURCHASE", "PRODUCE", "TRANSFER"].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActionFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                    actionFilter === value
                      ? "bg-slate-900 text-white"
                      : "bg-white text-slate-600 shadow-sm hover:bg-slate-100"
                  }`}
                >
                  {value === "ALL" ? "All actions" : value}
                </button>
              ))}
            </div>
            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 p-2">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 min-w-[220px] rounded-xl border-slate-200 bg-white shadow-sm">
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
            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50/70 px-4 py-3 text-right shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Plan owner</div>
              <div className="mt-1 text-sm font-semibold text-slate-700">{activePlan?.created_by_name || "System"}</div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="Demand" value={formatKg(totalDemandKg)} hint="Net requirement across current plan" icon={TrendingUp} tone="indigo" />
          <MetricCard label="Effective supply" value={formatKg(effectiveSupplyKg)} hint={`${formatKg(activePlan?.total_available_kg)} stock + ${formatKg(activePlan?.total_wip_kg)} WIP`} icon={Boxes} tone="emerald" />
          <MetricCard label="Shortage gap" value={formatKg(shortageKg)} hint={`${shortagePct.toFixed(1)}% of demand still uncovered`} icon={TrendingDown} tone="rose" />
          <MetricCard label="Coverage ratio" value={`${coveragePct.toFixed(1)}%`} hint={`${Math.max(0, totalDemandKg - shortageKg).toLocaleString(undefined, { maximumFractionDigits: 0 })} kg already covered`} icon={PackageCheck} tone="sky" />
          <MetricCard label="Purchase exposure" value={formatMoney(activePlan?.purchase_value_est)} hint={`${actionStats.purchaseCount} buy actions currently proposed`} icon={ShoppingCart} tone="amber" />
          <MetricCard label="Drafted actions" value={String(actionStats.draftCount)} hint={`${formatKg(actionStats.draftCoverageKg)} already pushed into draft execution`} icon={Sparkles} tone="violet" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.6fr_0.95fr] xl:items-start">
          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-slate-100 bg-white/75">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Supply vs demand trend</CardTitle>
              <CardDescription>Recent plan runs show whether available stock plus WIP is closing the demand gap or widening it.</CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={planTrendData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="mrpDemand" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="mrpSupply" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="mrpShortage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#EF4444" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                    <XAxis dataKey="shortLabel" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "#64748B", fontSize: 12 }}
                    />
                    <RechartsTooltip
                      labelFormatter={(_, payload) => String(payload?.[0]?.payload?.label || "")}
                      formatter={(value, name) => [formatKg(Number(value) || 0), String(name ?? "")]}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="demand" name="Demand" stroke="#4F46E5" strokeWidth={2.4} fill="url(#mrpDemand)" />
                    <Area type="monotone" dataKey="coveredSupply" name="Covered supply" stroke="#10B981" strokeWidth={2.4} fill="url(#mrpSupply)" />
                    <Area type="monotone" dataKey="uncoveredGap" name="Uncovered gap" stroke="#EF4444" strokeWidth={2.2} fill="url(#mrpShortage)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                  Latest run coverage
                  <div className="mt-1 text-base font-black text-slate-900">{formatKg(Math.min(totalDemandKg, effectiveSupplyKg))}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                  Uncovered gap
                  <div className="mt-1 text-base font-black text-slate-900">{formatKg(Math.max(totalDemandKg - Math.min(totalDemandKg, effectiveSupplyKg), 0))}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                  Excess cover
                  <div className="mt-1 text-base font-black text-slate-900">{formatKg(Math.max(effectiveSupplyKg - totalDemandKg, 0))}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
              <CardHeader className="border-b border-slate-100 bg-white/75">
                <CardTitle className="text-lg font-black tracking-tight text-slate-900">Execution posture</CardTitle>
                <CardDescription>Action mix and draft readiness from the selected plan.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-6 md:grid-cols-[1fr_1.1fr]">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
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
                          <Cell key={entry.name} fill={ACTION_COLORS[entry.name as keyof typeof ACTION_COLORS] || "#94A3B8"} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(value: number | string | undefined) => formatKg(value as number)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  <PostureTile label="Purchase" value={String(actionStats.purchaseCount)} detail="Supplier-led recovery" tone="amber" />
                  <PostureTile label="Produce" value={String(actionStats.produceCount)} detail="Internal manufacturing moves" tone="indigo" />
                  <PostureTile label="Transfer" value={String(actionStats.transferCount)} detail="Inter-plant balancing" tone="emerald" />
                  <PostureTile label="Draft cover" value={formatKg(actionStats.draftCoverageKg)} detail="Already drafted against this plan" tone="violet" />
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
              <CardHeader className="border-b border-slate-100 bg-white/75">
                <CardTitle className="text-lg font-black tracking-tight text-slate-900">Category risk concentration</CardTitle>
                <CardDescription>Shortage grouped by material category to show where planning pressure is concentrated.</CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryRiskData} layout="vertical" margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                      <XAxis type="number" tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                      <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} width={92} tick={{ fill: "#475569", fontSize: 11 }} />
                      <RechartsTooltip formatter={(value: number | string | undefined) => formatKg(value as number)} />
                      <Bar dataKey="shortage" fill="#F97316" radius={[0, 10, 10, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.15fr_1.35fr] xl:items-start">
          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-slate-100 bg-white/75">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Top shortage materials</CardTitle>
              <CardDescription>Real shortages from the selected plan, ordered by uncovered kilograms.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[620px] space-y-4 overflow-y-auto p-6">
              {topShortages.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                  No uncovered requirements for the current filter.
                </div>
              ) : (
                topShortages.map((requirement) => {
                  const coveredPct = requirement.required > 0 ? Math.max(0, Math.min(100, (requirement.available / requirement.required) * 100)) : 100;
                  return (
                    <div key={requirement.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1">
                          <div className="text-sm font-black tracking-tight text-slate-900">{requirement.material_details.name}</div>
                          <div className="text-xs font-semibold text-slate-500">
                            {requirement.material_details.code} · {requirement.material_details.category} · {requirement.source_type}
                          </div>
                        </div>
                        <Badge variant="outline" className={requirement.shortage > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}>
                          {requirement.shortage > 0 ? `Short ${formatKg(requirement.shortage)}` : "Covered"}
                        </Badge>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500" style={{ width: `${coveredPct}%` }} />
                      </div>
                      <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-600 md:grid-cols-3">
                        <span className="rounded-xl bg-white px-3 py-2">Required<br /><strong className="text-sm text-slate-900">{formatKg(requirement.required)}</strong></span>
                        <span className="rounded-xl bg-white px-3 py-2">Available<br /><strong className="text-sm text-slate-900">{formatKg(requirement.available)}</strong></span>
                        <span className="rounded-xl bg-white px-3 py-2">Shortage<br /><strong className="text-sm text-slate-900">{formatKg(requirement.shortage)}</strong></span>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-slate-100 bg-white/75">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-lg font-black tracking-tight text-slate-900">Action execution board</CardTitle>
                  <CardDescription>Draft procurement, production, or transfer actions directly from planning truth.</CardDescription>
                </div>
                <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                  {filteredSuggestions.length} suggestions in view
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="max-h-[620px] space-y-3 overflow-y-auto p-6">
              {filteredSuggestions.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                  No suggestions for the current filter.
                </div>
              ) : (
                filteredSuggestions.map((suggestion) => {
                  const action = resolveAction(suggestion);
                  const drafted = suggestion.action_status === "DRAFT_CREATED";
                  return (
                    <div key={suggestion.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 shadow-sm transition hover:border-slate-300 hover:bg-white">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant="outline"
                              className={
                                action === "PURCHASE"
                                  ? "border-amber-200 bg-amber-50 text-amber-700"
                                  : action === "PRODUCE"
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
                              }
                            >
                              {action}
                            </Badge>
                            {drafted ? (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Drafted</Badge>
                            ) : null}
                            <Badge variant="outline" className="border-slate-200 bg-white text-slate-600">
                              {suggestion.material_details?.category || "UNCATEGORISED"}
                            </Badge>
                          </div>
                          <div className="text-base font-black tracking-tight text-slate-900">
                            {suggestion.material_name || suggestion.material_details?.name || "Unknown material"}
                          </div>
                          <div className="text-xs font-semibold text-slate-500">
                            {suggestion.material_code || suggestion.material_details?.code || "SKU-UNKNOWN"} · {formatKg(suggestion.quantity ?? suggestion.qty)}
                          </div>
                          <p className="max-w-2xl text-sm text-slate-600">{suggestion.reason}</p>
                        </div>

                        <div className="flex flex-col items-start gap-2 lg:items-end">
                          {drafted ? (
                            <div className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              {suggestion.draft_ref || "Draft created"}
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={draftMutation.isPending}
                              className="rounded-xl border-slate-200 bg-white shadow-sm"
                              onClick={() => draftMutation.mutate({ suggestionId: suggestion.id, action })}
                            >
                              {action === "PURCHASE" ? <ShoppingCart className="mr-2 h-4 w-4" /> : action === "PRODUCE" ? <Factory className="mr-2 h-4 w-4" /> : <Split className="mr-2 h-4 w-4" />}
                              {action === "PURCHASE" ? "Create PO" : action === "PRODUCE" ? "Create Job" : "Create Transfer"}
                              <ArrowRight className="ml-2 h-4 w-4" />
                            </Button>
                          )}
                          <div className="text-xs font-semibold text-slate-400">
                            {suggestion.required_date ? `Need by ${format(new Date(suggestion.required_date), "dd MMM yyyy")}` : "Required date not pinned"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-slate-100 bg-white/75">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Planning summary</CardTitle>
              <CardDescription>Quick operational readout for the active plan before you move into action execution.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 p-6 md:grid-cols-2">
              <SummaryStrip title="At-risk materials" value={String(filteredRequirements.filter((row) => row.shortage > 0).length)} note="Materials still not fully covered" accent="rose" />
              <SummaryStrip title="Covered materials" value={String(filteredRequirements.filter((row) => row.shortage <= 0).length)} note="Requirements already resolved by stock or WIP" accent="emerald" />
              <SummaryStrip title="Largest single gap" value={formatKg(topShortages[0]?.shortage || 0)} note={topShortages[0]?.material_details.code || "No shortage leader"} accent="amber" />
              <SummaryStrip title="Demand posture" value={coveragePct >= 100 ? "Protected" : coveragePct >= 80 ? "Tight" : "Critical"} note={`${shortagePct.toFixed(1)}% shortage share`} accent={coveragePct >= 100 ? "emerald" : coveragePct >= 80 ? "amber" : "rose"} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/88 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.42)]">
            <CardHeader className="border-b border-slate-100 bg-white/75">
              <CardTitle className="text-lg font-black tracking-tight text-slate-900">Recent plan runs</CardTitle>
              <CardDescription>Review demand, effective supply, shortage, and purchase exposure across the last few planning cycles.</CardDescription>
            </CardHeader>
            <CardContent className="max-h-[460px] space-y-3 overflow-y-auto p-6">
              {recentPlans.length === 0 ? (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50/70 p-10 text-center text-sm text-slate-500">
                  No recent plans yet. Run the engine to establish the first baseline.
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
                          ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-200"
                          : "border-slate-200 bg-slate-50/70 text-slate-800 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-sm font-black tracking-tight">{formatPlanLabel(plan)}</div>
                          <div className={`mt-1 text-xs font-semibold ${active ? "text-slate-300" : "text-slate-500"}`}>
                            {plan.created_by_name || "System"} · {plan.plant_name || "All plants"}
                          </div>
                        </div>
                        <div className="grid gap-2 text-xs font-semibold md:grid-cols-4">
                          <span className={`rounded-xl px-3 py-2 ${active ? "bg-white/10 text-white" : "bg-white text-slate-700"}`}>Demand<br /><strong>{formatKg(plan.total_demand_kg)}</strong></span>
                          <span className={`rounded-xl px-3 py-2 ${active ? "bg-white/10 text-white" : "bg-white text-slate-700"}`}>Supply<br /><strong>{formatKg(toNumber(plan.total_available_kg) + toNumber(plan.total_wip_kg))}</strong></span>
                          <span className={`rounded-xl px-3 py-2 ${active ? "bg-white/10 text-white" : "bg-white text-slate-700"}`}>Shortage<br /><strong>{formatKg(plan.total_shortage_kg)}</strong></span>
                          <span className={`rounded-xl px-3 py-2 ${active ? "bg-white/10 text-white" : "bg-white text-slate-700"}`}>Value<br /><strong>{formatMoney(plan.purchase_value_est)}</strong></span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>
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
    indigo: "bg-indigo-50 text-indigo-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  } as const;

  return (
    <div className="rounded-[1.75rem] border border-white/70 bg-white/88 p-5 shadow-[0_18px_55px_-40px_rgba(15,23,42,0.42)] transition hover:-translate-y-0.5 hover:shadow-[0_26px_70px_-45px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</div>
        </div>
        <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-3 text-xs font-medium leading-5 text-slate-500">{hint}</p>
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
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  } as const;

  return (
    <div className={`rounded-[1.3rem] border px-4 py-3 ${toneMap[tone]}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.22em]">{label}</div>
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
  accent: "rose" | "emerald" | "amber";
}) {
  const accentMap = {
    rose: "from-rose-500/12 to-rose-100 text-rose-700",
    emerald: "from-emerald-500/12 to-emerald-100 text-emerald-700",
    amber: "from-amber-500/12 to-amber-100 text-amber-700",
  } as const;

  return (
    <div className={`rounded-[1.4rem] border border-slate-200 bg-gradient-to-br px-4 py-4 ${accentMap[accent]}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.22em]">{title}</div>
      <div className="mt-2 text-2xl font-black tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-semibold opacity-85">{note}</div>
    </div>
  );
}
