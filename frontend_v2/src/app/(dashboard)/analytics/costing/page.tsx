"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Layers3,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  costingService,
  CostAbsorptionGroup,
  PlantCostPoolLine,
  PlantCostPoolMonth,
} from "@/services/costing";
import { factoryService } from "@/services/factory";

function money(value: string | number | undefined | null) {
  const numeric = Number(value || 0);
  return `₹${numeric.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatCoveragePct(value: unknown) {
  if (value === null || value === undefined || value === "") return "Pending";
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : "Pending";
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function toneForMode(mode: string) {
  if (mode === "ACTUAL")
    return "border-success-border bg-success-bg text-success-fg";
  if (mode === "HYBRID")
    return "border-warning-border bg-warning-bg text-warning-fg";
  return "border-line bg-surface-2 text-content-2";
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-content-3">
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
  inverted = false,
}: {
  label: string;
  value: string;
  hint?: string;
  inverted?: boolean;
}) {
  return (
    <div
      className={`rounded-[1.4rem] border px-4 py-4 ${inverted ? "border-surface-1/10 bg-surface-1/10 text-white" : "border-line bg-surface-1 text-content-1"}`}
    >
      <div
        className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${inverted ? "text-content-4" : "text-content-3"}`}
      >
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
        {value}
      </div>
      {hint ? (
        <div
          className={`mt-2 text-xs leading-5 ${inverted ? "text-content-4" : "text-content-3"}`}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function MasterAssignmentCard({
  title,
  description,
  count,
  items,
}: {
  title: string;
  description: string;
  count: number;
  items: Array<{ id: string; title: string; subtitle: string; group: string }>;
}) {
  return (
    <div className="rounded-[1.6rem] border border-line bg-surface-1 px-5 py-5 shadow-[0_18px_40px_-36px_rgba(15,23,42,0.45)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-content-1">{title}</div>
          <div className="mt-1 text-sm leading-6 text-content-3">
            {description}
          </div>
        </div>
        <Badge className="rounded-full border border-line bg-surface-2 text-content-2">
          {count}
        </Badge>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-line bg-surface-2 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-content-1">{item.title}</div>
                  <div className="mt-1 text-xs text-content-3">
                    {item.subtitle}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="border-info-border text-primary"
                >
                  {item.group}
                </Badge>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-5 text-sm text-content-3">
            No assignments yet.
          </div>
        )}
      </div>
    </div>
  );
}

function CostGroupLineCard({
  row,
  mode,
  disabled,
  onChange,
  onSave,
}: {
  row: PlantCostPoolLine;
  mode: "DIRECT" | "ALLOCATED";
  disabled: boolean;
  onChange: (field: keyof PlantCostPoolLine, value: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="rounded-[1.6rem] border border-line bg-surface-1 px-4 py-4 shadow-[0_16px_36px_-34px_rgba(15,23,42,0.5)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold text-content-1">
            {row.cost_group_label}
          </div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-content-3">
            {row.cost_group_code}
          </div>
        </div>
        <Badge className="rounded-full border border-line bg-surface-2 text-content-2">
          {mode}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FieldShell label="Alloc %">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.allocation_percent}
            onChange={(e) => onChange("allocation_percent", e.target.value)}
          />
        </FieldShell>
        <FieldShell label="Electricity">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.electricity_cost}
            onChange={(e) => onChange("electricity_cost", e.target.value)}
          />
        </FieldShell>
        <FieldShell label="Labor">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.labor_cost}
            onChange={(e) => onChange("labor_cost", e.target.value)}
          />
        </FieldShell>
        <FieldShell label="Overhead">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.overhead_cost}
            onChange={(e) => onChange("overhead_cost", e.target.value)}
          />
        </FieldShell>
        <FieldShell label="Maintenance">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.maintenance_cost}
            onChange={(e) => onChange("maintenance_cost", e.target.value)}
          />
        </FieldShell>
        <FieldShell label="Service">
          <Input
            className="h-11 rounded-2xl text-right"
            value={row.service_burden_cost}
            onChange={(e) => onChange("service_burden_cost", e.target.value)}
          />
        </FieldShell>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm text-content-3">
          Save one group at a time so the absorbed-rate preview stays stable
          while the month is being closed.
        </div>
        <Button
          className="rounded-2xl bg-surface-3 text-white hover:bg-line"
          disabled={disabled}
          onClick={onSave}
        >
          Save Group
        </Button>
      </div>
    </div>
  );
}

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function CostingCenterPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"WORKSPACE" | "GROUPS">("WORKSPACE");
  const [selectedMonthId, setSelectedMonthId] = useState("");
  const [selectedPlant, setSelectedPlant] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [mode, setMode] = useState<"DIRECT" | "ALLOCATED">("DIRECT");
  const [draftTotals, setDraftTotals] = useState({
    plant_total_electricity: "",
    plant_total_labor: "",
    plant_total_overhead: "",
    plant_total_maintenance: "",
    plant_total_service_burden: "",
    notes: "",
  });
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<CostAbsorptionGroup | null>(
    null,
  );
  const [groupDraft, setGroupDraft] = useState({
    code: "",
    label: "",
    description: "",
    default_intensity_factor: "1.00",
    is_active: true,
  });
  const [lineDrafts, setLineDrafts] = useState<
    Record<string, PlantCostPoolLine>
  >({});

  const plantsQuery = useQuery({
    queryKey: ["factory-plants"],
    queryFn: factoryService.getPlants,
  });
  const workCentersQuery = useQuery({
    queryKey: ["work-centers"],
    queryFn: factoryService.getWorkCenters,
  });
  const machinesQuery = useQuery({
    queryKey: ["machines"],
    queryFn: factoryService.getMachines,
  });
  const groupsQuery = useQuery({
    queryKey: ["cost-groups"],
    queryFn: costingService.getCostGroups,
  });
  const monthsQuery = useQuery({
    queryKey: ["cost-pool-months"],
    queryFn: costingService.getPlantPoolMonths,
    refetchInterval: 30000,
  });
  const summaryQuery = useQuery({
    queryKey: ["costing-dashboard-summary"],
    queryFn: costingService.getDashboardSummary,
    refetchInterval: 30000,
  });
  const orderStatsQuery = useQuery({
    queryKey: ["costing-order-dashboard-stats"],
    queryFn: costingService.getOrderDashboardStats,
    refetchInterval: 30000,
  });

  const groups = groupsQuery.data || [];
  const plants = plantsQuery.data || [];
  const workCenters = workCentersQuery.data || [];
  const machines = machinesQuery.data || [];
  const months = monthsQuery.data || [];
  const summary = summaryQuery.data;
  const stats = orderStatsQuery.data?.kpis || {};
  const leakage = orderStatsQuery.data?.loss_alerts || [];

  const selectedMonth = useMemo(
    () =>
      months.find((item) => item.id === selectedMonthId) || months[0] || null,
    [months, selectedMonthId],
  );

  useEffect(() => {
    if (selectedMonth?.id && selectedMonthId !== selectedMonth.id) {
      setSelectedMonthId(selectedMonth.id);
    }
  }, [selectedMonth?.id, selectedMonthId]);

  useEffect(() => {
    if (!selectedMonth) return;
    setDraftTotals({
      plant_total_electricity: selectedMonth.plant_total_electricity || "",
      plant_total_labor: selectedMonth.plant_total_labor || "",
      plant_total_overhead: selectedMonth.plant_total_overhead || "",
      plant_total_maintenance: selectedMonth.plant_total_maintenance || "",
      plant_total_service_burden:
        selectedMonth.plant_total_service_burden || "",
      notes: selectedMonth.notes || "",
    });
    setMode(selectedMonth.entry_mode || "DIRECT");
    const nextDrafts: Record<string, PlantCostPoolLine> = {};
    selectedMonth.lines.forEach((line) => {
      nextDrafts[line.cost_group] = { ...line };
    });
    setLineDrafts(nextDrafts);
  }, [selectedMonth?.id]);

  const rows = useMemo(
    () =>
      groups.map((group) => {
        const draftLine = lineDrafts[group.id];
        return {
          id: draftLine?.id || "",
          month_record: draftLine?.month_record || selectedMonth?.id || "",
          cost_group: group.id,
          cost_group_code: draftLine?.cost_group_code || group.code,
          cost_group_label: draftLine?.cost_group_label || group.label,
          entry_mode: mode,
          allocation_percent: draftLine?.allocation_percent || "0",
          electricity_cost: draftLine?.electricity_cost || "0",
          labor_cost: draftLine?.labor_cost || "0",
          overhead_cost: draftLine?.overhead_cost || "0",
          maintenance_cost: draftLine?.maintenance_cost || "0",
          service_burden_cost: draftLine?.service_burden_cost || "0",
          pool_total: draftLine?.pool_total || "0",
        };
      }),
    [groups, lineDrafts, mode, selectedMonth?.id],
  );

  const usage = useMemo(() => {
    const workCenterMap = new Map(workCenters.map((item) => [item.id, item]));
    return groups.map((group) => {
      const plantCount = plants.filter(
        (plant) => plant.default_cost_absorption_group === group.id,
      ).length;
      const workCenterCount = workCenters.filter(
        (wc) => wc.default_cost_absorption_group === group.id,
      ).length;
      const machineCount = machines.filter(
        (machine) => machine.cost_absorption_group === group.id,
      ).length;
      const inheritedMachineCount = machines.filter((machine) => {
        if (machine.cost_absorption_group) return false;
        const wc = workCenterMap.get(machine.work_center);
        return wc?.default_cost_absorption_group === group.id;
      }).length;
      return {
        groupId: group.id,
        plantCount,
        workCenterCount,
        machineCount,
        inheritedMachineCount,
      };
    });
  }, [groups, machines, plants, workCenters]);

  const unresolvedAssignments = useMemo(
    () => ({
      plants: plants.filter((plant) => !plant.default_cost_absorption_group),
      workCenters: workCenters.filter(
        (wc) => !wc.default_cost_absorption_group,
      ),
      machines: machines.filter((machine) => !machine.cost_absorption_group),
    }),
    [machines, plants, workCenters],
  );

  const createMonth = useMutation({
    mutationFn: costingService.createPlantPoolMonth,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] });
      setSelectedMonthId(result.id);
      setView("WORKSPACE");
    },
  });

  const updateMonth = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<PlantCostPoolMonth>;
    }) => costingService.updatePlantPoolMonth(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] });
      queryClient.invalidateQueries({
        queryKey: ["costing-dashboard-summary"],
      });
    },
  });

  const updateLine = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<PlantCostPoolLine>;
    }) => costingService.updatePlantPoolLine(id, payload),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] }),
  });

  const createLine = useMutation({
    mutationFn: costingService.createPlantPoolLine,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] }),
  });

  const reviewMonth = useMutation({
    mutationFn: costingService.reviewMonth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] });
      queryClient.invalidateQueries({
        queryKey: ["costing-dashboard-summary"],
      });
    },
  });

  const lockMonth = useMutation({
    mutationFn: costingService.lockMonth,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-pool-months"] });
      queryClient.invalidateQueries({
        queryKey: ["costing-dashboard-summary"],
      });
    },
  });

  const createGroup = useMutation({
    mutationFn: costingService.createCostGroup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-groups"] });
      closeGroupSheet();
    },
  });

  const updateGroup = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<CostAbsorptionGroup>;
    }) => costingService.updateCostGroup(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cost-groups"] });
      closeGroupSheet();
    },
  });

  const deleteGroup = useMutation({
    mutationFn: costingService.deleteCostGroup,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["cost-groups"] }),
  });

  function closeGroupSheet() {
    setGroupSheetOpen(false);
    setEditingGroup(null);
    setGroupDraft({
      code: "",
      label: "",
      description: "",
      default_intensity_factor: "1.00",
      is_active: true,
    });
  }

  function openGroupSheet(group?: CostAbsorptionGroup) {
    if (group) {
      setEditingGroup(group);
      setGroupDraft({
        code: group.code,
        label: group.label,
        description: group.description || "",
        default_intensity_factor: group.default_intensity_factor || "1.00",
        is_active: group.is_active,
      });
    } else {
      setEditingGroup(null);
      setGroupDraft({
        code: "",
        label: "",
        description: "",
        default_intensity_factor: "1.00",
        is_active: true,
      });
    }
    setGroupSheetOpen(true);
  }

  function saveLine(row: PlantCostPoolLine) {
    const payload = {
      month_record: selectedMonth?.id,
      cost_group: row.cost_group,
      entry_mode: mode,
      allocation_percent: row.allocation_percent,
      electricity_cost: row.electricity_cost,
      labor_cost: row.labor_cost,
      overhead_cost: row.overhead_cost,
      maintenance_cost: row.maintenance_cost,
      service_burden_cost: row.service_burden_cost,
    };
    if (row.id) {
      updateLine.mutate({ id: row.id, payload });
    } else {
      createLine.mutate(payload);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(99,102,241,0.14),_transparent_32%),linear-gradient(180deg,#f7f5ef_0%,#f9fbff_52%,#f4f7fb_100%)] px-6 py-8">
      <div className="mx-auto flex max-w-[1560px] flex-col gap-6">
        <section className="overflow-hidden rounded-[34px] border border-line bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_46%,#f7f8ec_100%)] px-8 py-8 text-content-1 shadow-[0_30px_90px_-56px_rgba(15,23,42,0.24)]">
          <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-info-border bg-info-bg px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-info-fg">
                <Layers3 className="h-4 w-4" /> Costing Center
              </div>
              <div className="space-y-3">
                <h1 className="max-w-4xl text-4xl font-semibold leading-[1.02] tracking-[-0.04em]">
                  Close plant months, steer absorption, and manage costing
                  groups from one calm command deck.
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-content-3">
                  Plants, work centers, machines, and monthly pools now share
                  the same visible cost-group language. Pick the month, control
                  allocations, and keep assignment gaps visible before the close
                  is frozen.
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-4">
                <StatTile
                  label="Coverage"
                  value={formatCoveragePct(
                    summary?.kpis?.avg_actual_cost_coverage_pct,
                  )}
                  hint="Average actual-cost confidence"
                />
                <StatTile
                  label="Unabsorbed Pool"
                  value={money(summary?.kpis?.unabsorbed_pool_value)}
                  hint="Still outside productive runtime"
                />
                <StatTile
                  label="Groups"
                  value={String(
                    summary?.kpis?.cost_group_count || groups.length || 0,
                  )}
                  hint="Editable cost buckets"
                />
                <StatTile
                  label="Locked Months"
                  value={String(summary?.kpis?.locked_months || 0)}
                  hint="Frozen close periods"
                />
              </div>
            </div>

            <div className="rounded-[28px] border border-line bg-surface-1/92 p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-info-fg">
                Workspace focus
              </div>
              <div className="mt-3 grid gap-3">
                {[
                  {
                    key: "WORKSPACE" as const,
                    title: "Costing Command Deck",
                    body: "Month close, plant totals, live line editor, and close discipline.",
                  },
                  {
                    key: "GROUPS" as const,
                    title: "Cost Group Master",
                    body: "Create groups, see usage across plants and machines, and fix assignment drift.",
                  },
                ].map((panel) => (
                  <button
                    key={panel.key}
                    type="button"
                    onClick={() => setView(panel.key)}
                    className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${view === panel.key ? "border-line-strong bg-surface-3 text-white" : "border-line bg-surface-1 hover:bg-surface-2"}`}
                  >
                    <div
                      className={`text-sm font-semibold ${view === panel.key ? "text-white" : "text-content-1"}`}
                    >
                      {panel.title}
                    </div>
                    <div
                      className={`mt-1 text-sm leading-6 ${view === panel.key ? "text-content-4" : "text-content-3"}`}
                    >
                      {panel.body}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {view === "WORKSPACE" ? (
          <section className="grid gap-6 xl:grid-cols-[296px_minmax(0,1.2fr)_320px]">
            <div className="space-y-5">
              <div className="rounded-[28px] border border-line bg-surface-1/92 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <SectionLabel>Plant month</SectionLabel>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-content-1">
                  Open a working month
                </h2>
                <div className="mt-6 space-y-4">
                  <FieldShell label="Plant">
                    <Select
                      value={selectedPlant}
                      onValueChange={setSelectedPlant}
                    >
                      <SelectTrigger className="h-12 rounded-2xl">
                        <SelectValue placeholder="Choose plant" />
                      </SelectTrigger>
                      <SelectContent>
                        {plants.map((plant) => (
                          <SelectItem key={plant.id} value={plant.id}>
                            {plant.code} · {plant.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldShell>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                    <FieldShell label="Year">
                      <Input
                        className="h-12 rounded-2xl"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                      />
                    </FieldShell>
                    <FieldShell label="Month">
                      <Select value={month} onValueChange={setMonth}>
                        <SelectTrigger className="h-12 rounded-2xl">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(
                            { length: 12 },
                            (_, index) => index + 1,
                          ).map((value) => (
                            <SelectItem key={value} value={String(value)}>
                              {monthLabel(2026, value)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FieldShell>
                  </div>
                  <div className="rounded-[1.5rem] border border-line bg-surface-2 p-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-content-3">
                      Entry model
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {(["DIRECT", "ALLOCATED"] as const).map((entryMode) => (
                        <button
                          key={entryMode}
                          type="button"
                          onClick={() => setMode(entryMode)}
                          className={`rounded-[1.25rem] border px-4 py-3 text-left transition ${mode === entryMode ? "border-line-strong bg-surface-3 text-white" : "border-line bg-surface-1 text-content-2 hover:border-line-strong"}`}
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.18em]">
                            {entryMode}
                          </div>
                          <div className="mt-1 text-xs leading-5">
                            {entryMode === "DIRECT"
                              ? "Edit each cost group directly."
                              : "Split plant totals into groups."}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="h-12 w-full rounded-2xl bg-surface-3 text-white hover:bg-line"
                    disabled={!selectedPlant || createMonth.isPending}
                    onClick={() =>
                      createMonth.mutate({
                        plant: selectedPlant,
                        year: Number(year),
                        month: Number(month),
                        entry_mode: mode,
                      })
                    }
                  >
                    {createMonth.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="mr-2 h-4 w-4" />
                    )}
                    Create or reopen plant month
                  </Button>
                </div>
              </div>

              <div className="rounded-[28px] border border-line bg-surface-1/92 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <SectionLabel>Recent months</SectionLabel>
                <div className="mt-4 max-h-[410px] space-y-3 overflow-y-auto pr-1">
                  {months.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedMonthId(item.id)}
                      className={`w-full rounded-[1.4rem] border px-4 py-4 text-left transition ${selectedMonthId === item.id ? "border-info-border bg-info-bg" : "border-line bg-surface-2 hover:border-line-strong hover:bg-surface-1"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-content-1">
                            {item.plant_code} ·{" "}
                            {monthLabel(item.year, item.month)}
                          </div>
                          <div className="mt-1 text-xs text-content-3">
                            {item.lines.length} groups · {item.entry_mode}
                          </div>
                        </div>
                        <Badge
                          className={`rounded-full border ${item.status === "LOCKED" ? "border-success-border bg-success-bg text-success-fg" : item.status === "REVIEWED" ? "border-warning-border bg-warning-bg text-warning-fg" : "border-line bg-surface-1 text-content-2"}`}
                        >
                          {item.status}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <SectionLabel>Plant month workspace</SectionLabel>
                    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-content-1">
                      {selectedMonth
                        ? `${selectedMonth.plant_code} · ${monthLabel(selectedMonth.year, selectedMonth.month)}`
                        : "No month selected"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-content-3">
                      Keep this surface simple: enter plant totals, save cost
                      groups one by one, then review or lock only after
                      assignment and absorption gaps are understood.
                    </p>
                  </div>
                  {selectedMonth ? (
                    <Badge className="rounded-full border border-line bg-surface-2 text-content-2">
                      {selectedMonth.status}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <FieldShell label="Electricity">
                    <Input
                      className="h-12 rounded-2xl"
                      value={draftTotals.plant_total_electricity}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          plant_total_electricity: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                  <FieldShell label="Labor">
                    <Input
                      className="h-12 rounded-2xl"
                      value={draftTotals.plant_total_labor}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          plant_total_labor: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                  <FieldShell label="Overhead">
                    <Input
                      className="h-12 rounded-2xl"
                      value={draftTotals.plant_total_overhead}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          plant_total_overhead: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                  <FieldShell label="Maintenance">
                    <Input
                      className="h-12 rounded-2xl"
                      value={draftTotals.plant_total_maintenance}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          plant_total_maintenance: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                  <FieldShell label="Service burden">
                    <Input
                      className="h-12 rounded-2xl"
                      value={draftTotals.plant_total_service_burden}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          plant_total_service_burden: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                  <FieldShell label="Month notes">
                    <Textarea
                      className="min-h-[108px] rounded-2xl"
                      value={draftTotals.notes}
                      onChange={(e) =>
                        setDraftTotals((prev) => ({
                          ...prev,
                          notes: e.target.value,
                        }))
                      }
                    />
                  </FieldShell>
                </div>

                {selectedMonth ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      className="rounded-2xl bg-surface-3 text-white hover:bg-line"
                      onClick={() =>
                        updateMonth.mutate({
                          id: selectedMonth.id,
                          payload: { ...draftTotals, entry_mode: mode },
                        })
                      }
                    >
                      Save month totals
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => reviewMonth.mutate(selectedMonth.id)}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Mark reviewed
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => lockMonth.mutate(selectedMonth.id)}
                    >
                      <Lock className="mr-2 h-4 w-4" /> Lock month
                    </Button>
                    {mode === "ALLOCATED" ? (
                      <Button
                        variant="secondary"
                        className="rounded-2xl"
                        onClick={() =>
                          costingService
                            .allocateMonthFromTotals(
                              selectedMonth.id,
                              Object.fromEntries(
                                rows.map((row) => [
                                  row.cost_group,
                                  row.allocation_percent || "0",
                                ]),
                              ),
                            )
                            .then(() => {
                              queryClient.invalidateQueries({
                                queryKey: ["cost-pool-months"],
                              });
                              queryClient.invalidateQueries({
                                queryKey: ["costing-dashboard-summary"],
                              });
                            })
                        }
                      >
                        Allocate from totals
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <SectionLabel>Cost-group lines</SectionLabel>
                    <h3 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-content-1">
                      Edit groups without the spreadsheet feel
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-content-3">
                      Each group is a self-contained block. Direct mode edits
                      absolute values. Allocated mode keeps the same cards but
                      lets you set percentage splits from plant totals.
                    </p>
                  </div>
                  <Badge className="rounded-full border border-line bg-surface-2 text-content-2">
                    {rows.length} groups
                  </Badge>
                </div>
                <div className="mt-5 grid max-h-[760px] gap-4 overflow-y-auto pr-1 xl:grid-cols-2">
                  {rows.map((row) => (
                    <CostGroupLineCard
                      key={row.cost_group}
                      row={row}
                      mode={mode}
                      disabled={!selectedMonth}
                      onChange={(field, value) =>
                        setLineDrafts((current) => ({
                          ...current,
                          [row.cost_group]: {
                            ...row,
                            [field]: value,
                          },
                        }))
                      }
                      onSave={() => saveLine(lineDrafts[row.cost_group] || row)}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <SectionLabel>Close health</SectionLabel>
                <div className="mt-4 grid gap-3">
                  <StatTile
                    label="Average actual coverage"
                    value={formatCoveragePct(
                      stats.avg_actual_cost_coverage_pct,
                    )}
                  />
                  <StatTile
                    label="Actual orders"
                    value={String(stats.actual_count || 0)}
                  />
                  <StatTile
                    label="Hybrid orders"
                    value={String(stats.hybrid_count || 0)}
                  />
                  <StatTile
                    label="Estimated orders"
                    value={String(stats.estimated_count || 0)}
                  />
                </div>
              </div>

              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <SectionLabel>Assignment precedence</SectionLabel>
                <div className="mt-4 rounded-[1.5rem] border border-line bg-surface-2 px-4 py-4 text-sm leading-6 text-content-3">
                  Machine override wins first. If a machine is empty, the work
                  center default is used. If that is empty, the template-step
                  mapping is used. If none exists, the plant default becomes the
                  fallback.
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-content-3">
                      Plants missing defaults
                    </div>
                    <div className="mt-1 text-lg font-semibold text-content-1">
                      {unresolvedAssignments.plants.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-content-3">
                      Work centers missing defaults
                    </div>
                    <div className="mt-1 text-lg font-semibold text-content-1">
                      {unresolvedAssignments.workCenters.length}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-content-3">
                      Machines using inheritance
                    </div>
                    <div className="mt-1 text-lg font-semibold text-content-1">
                      {unresolvedAssignments.machines.length}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between">
                  <div>
                    <SectionLabel>Margin leakage</SectionLabel>
                    <div className="mt-2 text-xl font-semibold tracking-[-0.04em] text-content-1">
                      Orders that still need review
                    </div>
                  </div>
                  <AlertTriangle className="h-5 w-5 text-warning-fg" />
                </div>
                <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {leakage.length ? (
                    leakage.map((row: any) => (
                      <div
                        key={row.id}
                        className="rounded-2xl border border-line bg-surface-2 px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-content-1">
                              {row.order_number}
                            </div>
                            <div className="mt-1 text-xs text-content-3">
                              {row.customer_name} · {row.product_name}
                            </div>
                          </div>
                          <Badge
                            className={`rounded-full border ${toneForMode(row.costing_mode)}`}
                          >
                            {row.costing_mode}
                          </Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-content-3">
                              Absorbed margin
                            </div>
                            <div className="font-semibold text-content-1">
                              {money(row.absorbed_margin)}
                            </div>
                          </div>
                          <div>
                            <div className="text-content-3">Coverage</div>
                            <div className="font-semibold text-content-1">
                              {formatCoveragePct(
                                row.actual_cost_coverage_pct,
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-line px-4 py-5 text-sm text-content-3">
                      No leakage alerts yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
            <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <SectionLabel>Cost Group Master</SectionLabel>
                  <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-content-1">
                    Editable cost buckets with visible usage
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-content-3">
                    Keep operational naming flexible but make costing stable.
                    These groups are what plants, work centers, machines, and
                    plant-month pools should speak in common.
                  </p>
                </div>
                <Button
                  className="rounded-2xl bg-surface-3 text-white hover:bg-line"
                  onClick={() => openGroupSheet()}
                >
                  <Plus className="mr-2 h-4 w-4" /> New Cost Group
                </Button>
              </div>
              <div className="mt-6 grid gap-4 xl:grid-cols-2">
                {groups.map((group) => {
                  const counts = usage.find(
                    (entry) => entry.groupId === group.id,
                  );
                  return (
                    <div
                      key={group.id}
                      className="rounded-[1.7rem] border border-line bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-5 shadow-[0_18px_40px_-38px_rgba(15,23,42,0.45)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-content-3">
                            {group.code}
                          </div>
                          <div className="mt-2 text-xl font-semibold text-content-1">
                            {group.label}
                          </div>
                          <div className="mt-2 text-sm leading-6 text-content-3">
                            {group.description || "No description yet."}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="rounded-2xl"
                            onClick={() => openGroupSheet(group)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="rounded-2xl text-danger-fg"
                            onClick={() => deleteGroup.mutate(group.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className="rounded-full border border-line bg-surface-2 text-content-2">
                          Intensity{" "}
                          {Number(group.default_intensity_factor || 1).toFixed(
                            2,
                          )}
                        </Badge>
                        <Badge
                          className={`rounded-full border ${group.is_active ? "border-success-border bg-success-bg text-success-fg" : "border-line bg-surface-2 text-content-3"}`}
                        >
                          {group.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <StatTile
                          label="Plants"
                          value={String(counts?.plantCount || 0)}
                        />
                        <StatTile
                          label="W/C"
                          value={String(counts?.workCenterCount || 0)}
                        />
                        <StatTile
                          label="Machine"
                          value={String(counts?.machineCount || 0)}
                        />
                        <StatTile
                          label="Inherited"
                          value={String(counts?.inheritedMachineCount || 0)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-[28px] border border-line bg-surface-1/94 p-6 shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
                <SectionLabel>Assignment workspace</SectionLabel>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-content-1">
                  Make grouping visible at setup time
                </div>
                <div className="mt-3 rounded-[1.5rem] border border-line bg-surface-2 px-4 py-4 text-sm leading-6 text-content-3">
                  Plants carry the broad fallback, work centers define the
                  operational default, and machines can override when a line
                  truly needs its own absorption behavior.
                </div>
              </div>
              <div className="rounded-[28px] border border-line bg-[linear-gradient(180deg,#0f172a_0%,#18223e_100%)] p-6 text-white shadow-[0_22px_60px_rgba(15,23,42,0.18)]">
                <SectionLabel>Setup shortcuts</SectionLabel>
                <div className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
                  Assign groups while setting up masters
                </div>
                <div className="mt-3 text-sm leading-6 text-content-4">
                  Cost groups are editable here in the master, but the fastest
                  clean setup is to pick them while creating plants, work
                  centers, and machine overrides in their own master screens.
                </div>
                <div className="mt-5 grid gap-3">
                  <Link
                    href="/factory/plants"
                    className="rounded-[1.3rem] border border-surface-1/10 bg-surface-1/5 px-4 py-4 transition hover:bg-surface-1/10"
                  >
                    <div className="text-sm font-semibold text-white">
                      Open Plants
                    </div>
                    <div className="mt-1 text-xs leading-5 text-content-4">
                      Set plant-level fallback cost groups.
                    </div>
                  </Link>
                  <Link
                    href="/factory/work-centers"
                    className="rounded-[1.3rem] border border-surface-1/10 bg-surface-1/5 px-4 py-4 transition hover:bg-surface-1/10"
                  >
                    <div className="text-sm font-semibold text-white">
                      Open Work Centers
                    </div>
                    <div className="mt-1 text-xs leading-5 text-content-4">
                      Set default operational cost groups for each WCM lane.
                    </div>
                  </Link>
                  <Link
                    href="/factory/machines"
                    className="rounded-[1.3rem] border border-surface-1/10 bg-surface-1/5 px-4 py-4 transition hover:bg-surface-1/10"
                  >
                    <div className="text-sm font-semibold text-white">
                      Open Machines
                    </div>
                    <div className="mt-1 text-xs leading-5 text-content-4">
                      Use overrides only where the machine truly differs.
                    </div>
                  </Link>
                </div>
              </div>
              <MasterAssignmentCard
                title="Plant defaults"
                description="Fallback group used when lower-level assignments stay empty."
                count={
                  plants.filter(
                    (plant) => !!plant.default_cost_absorption_group,
                  ).length
                }
                items={plants.map((plant) => ({
                  id: plant.id,
                  title: `${plant.code} · ${plant.name}`,
                  subtitle: `${plant.work_center_count || 0} work centers · ${plant.machine_count || 0} machines`,
                  group: plant.default_cost_absorption_group_code || "Unset",
                }))}
              />
              <MasterAssignmentCard
                title="Work center defaults"
                description="Operational grouping that most machines should inherit."
                count={
                  workCenters.filter((wc) => !!wc.default_cost_absorption_group)
                    .length
                }
                items={workCenters.map((wc) => ({
                  id: wc.id,
                  title: `${wc.code} · ${wc.name}`,
                  subtitle: wc.plant_name,
                  group:
                    wc.default_cost_absorption_group_code || "Plant default",
                }))}
              />
              <MasterAssignmentCard
                title="Machine overrides"
                description="Use overrides only where a machine genuinely diverges from its work center."
                count={
                  machines.filter((machine) => !!machine.cost_absorption_group)
                    .length
                }
                items={machines.map((machine) => ({
                  id: machine.id,
                  title: `${machine.code} · ${machine.name}`,
                  subtitle: machine.work_center_name,
                  group: machine.cost_absorption_group_code || "Inherited",
                }))}
              />
            </div>
          </section>
        )}
      </div>

      <Sheet open={groupSheetOpen} onOpenChange={setGroupSheetOpen}>
        <SheetContent
          side="right"
          className="w-full max-w-xl overflow-y-auto bg-[linear-gradient(180deg,#fbfbfd_0%,#f5f7fb_100%)] px-0"
        >
          <div className="px-6 py-6">
            <SheetHeader className="space-y-2">
              <SheetTitle>
                {editingGroup ? "Edit Cost Group" : "Create Cost Group"}
              </SheetTitle>
              <SheetDescription>
                Stable cost buckets should be edited here once, then selected
                directly while creating plants, work centers, and machines.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              <FieldShell label="Code">
                <Input
                  className="h-12 rounded-2xl"
                  value={groupDraft.code}
                  onChange={(e) =>
                    setGroupDraft((prev) => ({
                      ...prev,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                />
              </FieldShell>
              <FieldShell label="Label">
                <Input
                  className="h-12 rounded-2xl"
                  value={groupDraft.label}
                  onChange={(e) =>
                    setGroupDraft((prev) => ({
                      ...prev,
                      label: e.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell label="Description">
                <Textarea
                  className="min-h-[120px] rounded-2xl"
                  value={groupDraft.description}
                  onChange={(e) =>
                    setGroupDraft((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </FieldShell>
              <FieldShell label="Default intensity factor">
                <Input
                  className="h-12 rounded-2xl"
                  value={groupDraft.default_intensity_factor}
                  onChange={(e) =>
                    setGroupDraft((prev) => ({
                      ...prev,
                      default_intensity_factor: e.target.value,
                    }))
                  }
                />
              </FieldShell>
              <div className="rounded-[1.5rem] border border-line bg-surface-1 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-content-1">
                      Active group
                    </div>
                    <div className="mt-1 text-sm text-content-3">
                      Inactive groups stay visible historically but stop
                      appearing as default choices.
                    </div>
                  </div>
                  <Button
                    variant={groupDraft.is_active ? "default" : "outline"}
                    className="rounded-2xl"
                    onClick={() =>
                      setGroupDraft((prev) => ({
                        ...prev,
                        is_active: !prev.is_active,
                      }))
                    }
                  >
                    {groupDraft.is_active ? "Active" : "Inactive"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex gap-2">
              <Button
                className="rounded-2xl bg-surface-3 text-white hover:bg-line"
                disabled={createGroup.isPending || updateGroup.isPending}
                onClick={() => {
                  const payload = { ...groupDraft };
                  if (editingGroup) {
                    updateGroup.mutate({ id: editingGroup.id, payload });
                  } else {
                    createGroup.mutate(payload);
                  }
                }}
              >
                {createGroup.isPending || updateGroup.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="mr-2 h-4 w-4" />
                )}
                {editingGroup ? "Save Group" : "Create Group"}
              </Button>
              <Button
                variant="outline"
                className="rounded-2xl"
                onClick={closeGroupSheet}
              >
                Cancel
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
