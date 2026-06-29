"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Combine,
  Scissors,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Layers,
  Route,
  Factory,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  plannerService,
  type GangCandidateGroup,
  type GangCandidateJob,
} from "@/services/planner";

const PROCESS_LABEL: Record<string, string> = {
  EXTR: "Extrusion",
  EXTRU: "Extrusion",
  EXTRUSION: "Extrusion",
  LAM: "Lamination",
  LAMI: "Lamination",
  LAMIN: "Lamination",
  LAMINATION: "Lamination",
  PRINT: "Printing",
  PRINTING: "Printing",
  SLIT: "Slitting",
  SLIT_REWIND: "Slitting",
  POUCH: "Pouching",
  POUCHING: "Pouching",
  BAG: "Bag making",
  BAGMAKING: "Bag making",
};

function processLabel(code: string): string {
  const up = String(code || "").toUpperCase();
  return (
    PROCESS_LABEL[up] ||
    (up ? up.charAt(0) + up.slice(1).toLowerCase() : "Unknown step")
  );
}

function jobKg(job: GangCandidateJob): number {
  const direct = Number(job.quantity_kg);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return Number(job.quantity || 0);
}

function groupReasons(group: GangCandidateGroup | null): string[] {
  if (!group) return [];
  return Array.isArray(group.eligibility_reasons) ? group.eligibility_reasons.filter(Boolean) : [];
}

export default function GangBuilderPage() {
  const qc = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [mode, setMode] = React.useState<"all" | "eligible" | "blocked">("all");
  const [processFilter, setProcessFilter] = React.useState("all");
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["gang-candidates"],
    queryFn: () => plannerService.getGangCandidates({ limit: 60, scan_limit: 160 }),
    refetchInterval: 45_000,
    staleTime: 30_000,
    meta: { suppressGlobalError: true },
  });

  const groups = data?.groups || [];
  const totalGroups = data?.total_groups || 0;
  const processOptions = React.useMemo(() => {
    const values = new Set<string>();
    groups.forEach((group) => {
      const code = String(group.process_code || "");
      if (code) values.add(code);
    });
    return Array.from(values).sort();
  }, [groups]);
  const visibleGroups = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter((group) => {
      if (mode === "eligible" && !group.eligible_for_ganging) return false;
      if (mode === "blocked" && group.eligible_for_ganging) return false;
      if (processFilter !== "all" && String(group.process_code || "") !== processFilter) return false;
      if (!q) return true;
      const haystack = [
        group.layer_signature_hash,
        group.product_master_label,
        group.product_master_code,
        group.product_master_name,
        group.process_code,
        processLabel(group.process_code),
        ...group.jobs.flatMap((job) => [
          job.job_number,
          job.sales_order_number,
          job.customer_name,
          job.template_name,
        ]),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [groups, mode, processFilter, search]);
  const eligibleGroups = visibleGroups.filter((g) => g.eligible_for_ganging);
  const blockedGroups = visibleGroups.filter((g) => !g.eligible_for_ganging);
  const totalJobsAcrossEligible = eligibleGroups.reduce(
    (s, g) => s + g.job_count,
    0,
  );
  const potentialKg = eligibleGroups.reduce((s, g) => s + g.total_qty_kg, 0);

  const [activeGroupKey, setActiveGroupKey] = React.useState<string>("");
  const activeGroup =
    visibleGroups.find(
      (g) => (g.group_key || g.layer_signature_hash) === activeGroupKey,
    ) ||
    eligibleGroups[0] ||
    visibleGroups[0] ||
    null;
  React.useEffect(() => {
    const currentStillVisible = visibleGroups.some(
      (group) => (group.group_key || group.layer_signature_hash) === activeGroupKey,
    );
    const nextGroup = eligibleGroups[0] || visibleGroups[0];
    if ((!activeGroupKey || !currentStillVisible) && nextGroup)
      setActiveGroupKey(
        nextGroup.group_key || nextGroup.layer_signature_hash,
      );
  }, [eligibleGroups, visibleGroups, activeGroupKey]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
      <GradientHero
        palette="indigo"
        eyebrow="PLANNER · COMBINE ORDERS"
        title="Combine multiple orders onto one jumbo roll"
        subtitle="Only same Product Master orders at the same live route step can be combined. The page now blocks mixed PM, mixed step, missing-width, and non-roll-output jobs before they reach WCM."
        chips={[
          {
            icon: <Combine className="h-4 w-4" />,
            label: "PM step groups",
            value: String(totalGroups),
            tone: "violet",
          },
          {
            icon: <Layers className="h-4 w-4" />,
            label: "Jumbo-ready orders",
            value: String(totalJobsAcrossEligible),
            tone: "info",
          },
          {
            icon: <Boxes className="h-4 w-4" />,
            label: "Ready film",
            value: `${potentialKg.toFixed(0)} kg`,
            tone: "ok",
          },
          {
            icon: <AlertTriangle className="h-4 w-4" />,
            label: "Need setup",
            value: String(blockedGroups.length),
            tone: "warn",
          },
        ]}
      />

      <FlowSteps />

      <div className="mt-4 rounded-2xl border border-line bg-surface-1 p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order, customer, Product Master, job, step..."
              className="h-10 w-full rounded-xl border border-line bg-surface-1 pl-9 pr-3 text-sm font-semibold text-content-1 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "eligible", "blocked"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={mode === value ? "default" : "outline"}
                size="sm"
                onClick={() => setMode(value)}
                className={mode === value ? "bg-content-1 text-white hover:bg-content-1" : ""}
              >
                {value === "all" ? "All" : value === "eligible" ? "Combinable" : "Needs setup"}
              </Button>
            ))}
            <select
              value={processFilter}
              onChange={(event) => setProcessFilter(event.target.value)}
              className="h-9 rounded-xl border border-line bg-surface-1 px-3 text-xs font-bold text-content-2 outline-none"
            >
              <option value="all">All steps</option>
              {processOptions.map((code) => (
                <option key={code} value={code}>{processLabel(code)}</option>
              ))}
            </select>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
        {isError ? (
          <div className="mt-3 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-xs font-semibold text-danger-fg">
            Could not load combine candidates: {String((error as any)?.message || error)}
          </div>
        ) : (
          <div className="mt-2 text-[11px] font-semibold text-content-3">
            Showing {visibleGroups.length} of {groups.length} loaded Product Master + route-step groups.
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <GroupListCard
          groups={visibleGroups}
          isLoading={isLoading}
          activeGroupKey={
            activeGroup?.group_key || activeGroup?.layer_signature_hash || ""
          }
          onSelect={(key) => setActiveGroupKey(key)}
        />
        <GangWorkspaceCard
          group={activeGroup}
          onCommitted={() => {
            refetch();
            qc.invalidateQueries({ queryKey: ["gang-candidates"] });
          }}
        />
      </div>
    </div>
  );
}

function FlowSteps() {
  const steps = [
    {
      n: 1,
      label: "Pick a recipe group",
      sub: "Same PM · recipe · route step",
    },
    {
      n: 2,
      label: "Tick 2 or more orders",
      sub: "Widths and roll output must be set",
    },
    {
      n: 3,
      label: "Press Combine orders",
      sub: "WCM slits one jumbo into jobs",
    },
  ];
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {steps.map((s, i) => (
        <div
          key={s.n}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface-1 px-3 py-2.5 shadow-sm"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-order-bg text-[11px] font-black text-order-fg">
            {s.n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-bold text-content-1">
              {s.label}
            </div>
            <div className="truncate text-[10px] text-content-3">{s.sub}</div>
          </div>
          {i < steps.length - 1 ? (
            <ChevronRight className="hidden h-4 w-4 shrink-0 text-content-4 sm:block" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function GroupSummary({ group }: { group: GangCandidateGroup }) {
  const widths = group.jobs
    .map((j) => Math.round(j.target_width_mm || 0))
    .filter((w) => w > 0);
  const uniqueWidths = Array.from(new Set(widths));
  const stepName = processLabel(group.process_code);
  const reasons = groupReasons(group);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-content-3">
      {group.product_master_label ? (
        <>
          <span className="max-w-full truncate font-bold text-content-2">{group.product_master_label}</span>
          <span>·</span>
        </>
      ) : null}
      <span className="font-semibold text-content-2">{stepName}</span>
      <span>·</span>
      <span>Step {group.step_index + 1}</span>
      {group.output_form ? (
        <>
          <span>·</span>
          <span className="font-mono">{group.output_form} output</span>
        </>
      ) : null}
      {uniqueWidths.length > 0 ? (
        <>
          <span>·</span>
          <span className="font-mono">
            {uniqueWidths.length <= 4
              ? uniqueWidths.map((w) => `${w}mm`).join(" + ")
              : `${uniqueWidths.length} different widths`}
          </span>
        </>
      ) : null}
      {reasons.length > 0 ? (
        <>
          <span>·</span>
          <span className="font-semibold text-warning-fg">{reasons[0]}</span>
        </>
      ) : null}
    </div>
  );
}

function GroupListCard({
  groups,
  isLoading,
  activeGroupKey,
  onSelect,
}: {
  groups: GangCandidateGroup[];
  isLoading: boolean;
  activeGroupKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <aside className="rounded-2xl border border-line bg-surface-1 shadow-sm">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-order-bg text-order-fg">
          <Layers className="h-4 w-4" />
        </span>
        <div>
          <h2 className="font-display text-sm font-bold text-content-1">
            Jumbo-ready groups
          </h2>
          <p className="text-[10px] text-content-3">
            Same Product Master, film recipe, current step, and roll output.
          </p>
        </div>
      </header>
      {isLoading ? (
        <div className="flex items-center justify-center p-10 text-content-3">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-10 text-center text-content-3">
          <AlertTriangle className="h-6 w-6 text-warning-fg" />
          <div className="text-sm font-semibold text-content-2">
            No combinable route groups yet
          </div>
          <p className="max-w-[260px] text-[11px] leading-relaxed">
            Released roll-output jobs appear when they share Product Master,
            recipe, route step, and target width.
          </p>
        </div>
      ) : (
        <div className="max-h-[70vh] overflow-y-auto p-3">
          {groups.map((g) => {
            const key = g.group_key || g.layer_signature_hash;
            const active = key === activeGroupKey;
            const eligible = g.eligible_for_ganging;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={cn(
                  "mb-2 block w-full rounded-2xl border p-3 text-left transition",
                  active
                    ? "border-order-border bg-order-bg ring-2 ring-order-border"
                    : "border-line bg-surface-1 hover:bg-surface-2",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {eligible ? (
                      <Badge className="bg-success-bg text-[9px] text-success-fg hover:bg-success-bg">
                        <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />
                        {g.job_count} orders · combinable
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-line text-[9px] text-content-3"
                      >
                        {g.job_count} order{g.job_count === 1 ? "" : "s"} ·
                        setup needed
                      </Badge>
                    )}
                  </div>
                  <span
                    className="font-mono text-[9px] text-content-4"
                    title="Recipe fingerprint (internal)"
                  >
                    #{g.layer_signature_hash.slice(0, 6)}
                  </span>
                </div>
                <GroupSummary group={g} />
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-content-3">
                  <span>
                    <b className="text-content-2">
                      {g.total_qty_kg.toFixed(0)} kg
                    </b>{" "}
                    target weight
                  </span>
                  {g.product_master_code ? (
                    <>
                      <span>·</span>
                      <span className="font-mono">{g.product_master_code}</span>
                    </>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function GangWorkspaceCard({
  group,
  onCommitted,
}: {
  group: GangCandidateGroup | null;
  onCommitted: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setSelected({});
  }, [group?.group_key, group?.layer_signature_hash]);

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const selectedJobs = (group?.jobs || []).filter((j) => selected[j.job_id]);
  const selectedSumKg = selectedJobs.reduce((s, j) => s + jobKg(j), 0);
  const selectedWidths = selectedJobs
    .map((j) => Math.round(j.target_width_mm || 0))
    .filter((w) => w > 0);
  const SLITTER_TRIM_PER_CUT = 5;
  const jumboWidthEstimate =
    selectedWidths.reduce((s, w) => s + w, 0) +
    Math.max(0, selectedWidths.length - 1) * SLITTER_TRIM_PER_CUT;
  const noWidthsYet = selectedJobs.some((j) => !j.target_width_mm);
  const reasons = groupReasons(group);
  const selectedBlocked = selectedIds.length >= 2 && reasons.length > 0;

  const commit = useMutation({
    mutationFn: async () => {
      if (!group) throw new Error("Pick a recipe group first");
      if (selectedIds.length < 2)
        throw new Error("Pick 2 or more orders to combine");
      if (!group.eligible_for_ganging)
        throw new Error(reasons[0] || "This group is not eligible to combine");
      return plannerService.commitGang(group.layer_signature_hash, selectedIds);
    },
    onSuccess: (res) => {
      toast({
        title: `${res.affected_jobs} orders combined`,
        description: `Batch ${res.gang_group_id} · they'll slit together at the machine`,
      });
      setSelected({});
      onCommitted();
    },
    onError: (err: any) => {
      toast({
        title: "Could not combine",
        description: String(err?.message || err),
        variant: "destructive",
      });
    },
  });

  if (!group) {
    return (
      <section className="rounded-2xl border border-dashed border-line-strong bg-surface-1 p-10 text-center">
        <Combine className="mx-auto h-10 w-10 text-content-4" />
        <p className="mt-3 text-sm font-semibold text-content-2">
          Pick a recipe group on the left
        </p>
        <p className="mt-1 text-xs text-content-3">
          Only same Product Master, same step, roll-output groups can be combined.
        </p>
      </section>
    );
  }

  const stepName = processLabel(group.process_code);

  return (
    <section className="space-y-3">
      <SlitLayoutPreview
        group={group}
        selectedJobs={selectedJobs}
        jumboWidthEstimate={jumboWidthEstimate}
      />

      {/* Orders picker */}
      <div className="rounded-2xl border border-line bg-surface-1 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-order-bg text-order-fg">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div>
              <h2 className="font-display text-sm font-bold text-content-1">
                Pick orders to combine
              </h2>
              <p className="text-[10px] text-content-3">
                These rows share <b>{group.product_master_label || "one Product Master"}</b> at <b>{stepName}</b>{" "}
                (step {group.step_index + 1}). Tick 2 or more only when the group is jumbo-ready.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-content-3">
            <span>
              <b className="text-content-2">{selectedIds.length}</b>/
              {group.job_count} ticked
            </span>
            {selectedSumKg > 0 ? (
              <>
                <span>·</span>
                <span>
                  <b className="text-content-2">
                    {selectedSumKg.toFixed(0)} kg
                  </b>{" "}
                  film
                </span>
              </>
            ) : null}
          </div>
        </header>
        <div className="divide-y divide-line">
          {group.jobs.map((j) => {
            const checked = !!selected[j.job_id];
            return (
              <label
                key={j.job_id}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-5 py-3 transition",
                  checked ? "bg-order-bg" : "hover:bg-surface-2",
                )}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      setSelected((s) => ({ ...s, [j.job_id]: Boolean(v) }))
                    }
                  />
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {j.sales_order_number ? (
                        <span className="font-mono text-sm font-bold text-content-1">
                          {j.sales_order_number}
                        </span>
                      ) : (
                        <span className="font-mono text-sm font-bold text-content-1">
                          {j.job_number}
                        </span>
                      )}
                      {j.customer_name ? (
                        <span className="text-[11px] font-semibold text-content-2">
                          · {j.customer_name}
                        </span>
                      ) : null}
                      {j.is_generic_stock ? (
                        <Badge className="bg-order-bg text-[10px] text-order-fg hover:bg-order-bg">
                          <Sparkles className="mr-0.5 h-2.5 w-2.5" /> generic
                          stock
                        </Badge>
                      ) : null}
                      {j.product_master_code ? (
                        <Badge variant="outline" className="border-line text-[10px] text-content-3">
                          {j.product_master_code}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-content-3">
                      {j.target_width_mm ? (
                        <span className="font-mono font-semibold text-content-2">
                          {Math.round(j.target_width_mm)} mm wide
                        </span>
                      ) : (
                        <span className="font-mono text-warning-fg">
                          no roll width set
                        </span>
                      )}
                      <span>·</span>
                      <span className="font-mono text-content-2">
                        {jobKg(j).toFixed(0)} kg
                      </span>
                      {String(j.uom || "").toUpperCase() !== "KG" ? (
                        <>
                          <span>·</span>
                          <span className="font-mono">{(j.quantity || 0).toFixed(0)} {j.uom}</span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>Job {j.job_number.slice(-8)}</span>
                      {j.output_form ? (
                        <>
                          <span>·</span>
                          <span>{j.output_form} output</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <Badge
                    variant="outline"
                    className="border-line text-[10px] text-content-3"
                  >
                    {j.job_state}
                  </Badge>
                </div>
              </label>
            );
          })}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3">
          <div className="text-[11.5px] text-content-2">
            {selectedIds.length < 2 ? (
              <span className="text-content-3">
                Pick at least 2 orders to combine.
              </span>
            ) : selectedBlocked ? (
              <span className="text-warning-fg">
                Cannot combine: {reasons[0]}
              </span>
            ) : noWidthsYet ? (
              <span className="text-warning-fg">
                One or more orders has no roll width set — combining is not
                safe.
              </span>
            ) : (
              <span>
                Combine <b>{selectedIds.length}</b> orders → jumbo needs ≥{" "}
                <b>{jumboWidthEstimate} mm</b> wide · ~
                <b>{selectedSumKg.toFixed(0)} kg</b> film
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected({})}
              disabled={selectedIds.length === 0}
            >
              Clear ticks
            </Button>
            <Button
              size="sm"
              onClick={() => commit.mutate()}
              disabled={
                selectedIds.length < 2 || commit.isPending || noWidthsYet || !group.eligible_for_ganging
              }
              className="bg-order-fg text-white hover:bg-order-fg"
            >
              {commit.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Combine className="mr-2 h-4 w-4" />
              )}
              Combine {selectedIds.length || ""} orders
            </Button>
          </div>
        </footer>
      </div>

      {/* Help footer */}
      <div className="rounded-xl border border-order-border bg-order-bg px-4 py-3 text-[11.5px] text-order-fg">
        <div className="font-bold text-order-fg">
          What happens after you press Combine
        </div>
        <div className="mt-1 grid gap-2 md:grid-cols-3">
          <RulePill icon={<Factory className="h-3.5 w-3.5" />} title="Same PM" body="Product Master, film stack, step, and process must match." />
          <RulePill icon={<Route className="h-3.5 w-3.5" />} title="Roll output" body="Only roll-output jobs with target width can enter a jumbo batch." />
          <RulePill icon={<Scissors className="h-3.5 w-3.5" />} title="WCM slit" body="The machine roll-picker creates one slit child per selected job." />
        </div>
        <div className="mt-2">
          Slits happen at the{" "}
          <Link
            className="font-bold text-order-fg underline"
            href="/production/work-center"
          >
            work-centre terminal
          </Link>{" "}
          — this page only plans them.
        </div>
      </div>
    </section>
  );
}

function RulePill({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-order-border/70 bg-white/55 px-3 py-2">
      <div className="flex items-center gap-1.5 font-bold text-order-fg">
        {icon}
        {title}
      </div>
      <div className="mt-1 leading-4 text-order-fg/80">{body}</div>
    </div>
  );
}

function SlitLayoutPreview({
  group,
  selectedJobs,
  jumboWidthEstimate,
}: {
  group: GangCandidateGroup;
  selectedJobs: GangCandidateJob[];
  jumboWidthEstimate: number;
}) {
  const jobsToRender =
    selectedJobs.length > 0 ? selectedJobs : group.jobs.slice(0, 4);
  const stepName = processLabel(group.process_code);
  return (
    <div className="rounded-2xl border border-line bg-gradient-to-br from-white via-surface-2 to-order-bg p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-order-bg text-order-fg">
            <Scissors className="h-4 w-4" />
          </span>
          <div>
            <h2 className="font-display text-sm font-bold text-content-1">
              Slit layout preview
            </h2>
            <p className="text-[10px] text-content-3">
              {selectedJobs.length > 0
                ? `Showing ${selectedJobs.length} ticked order${selectedJobs.length === 1 ? "" : "s"}.`
                : "Showing first 4 orders in this recipe group (tick orders below to lock the layout)."}{" "}
              One block = one slit.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="border-order-border bg-order-bg text-[10px] text-order-fg"
          >
            {stepName} · step {group.step_index + 1}
          </Badge>
          {selectedJobs.length >= 2 && jumboWidthEstimate > 0 ? (
            <Badge className="bg-success-bg text-[10px] text-success-fg hover:bg-success-bg">
              jumbo ≥ {jumboWidthEstimate} mm
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex h-32 items-stretch gap-1 overflow-x-auto rounded-xl bg-surface-2 p-2 ring-1 ring-line">
        {jobsToRender.length === 0 ? (
          <div className="flex w-full items-center justify-center text-xs text-content-4">
            No orders to preview yet.
          </div>
        ) : (
          jobsToRender.map((j, idx) => {
            const colorTones = [
              "from-order-bg to-order-bg text-order-fg",
              "from-order-bg to-order-bg text-order-fg",
              "from-success-bg to-success-bg text-success-fg",
              "from-warning-bg to-warning-bg text-warning-fg",
              "from-info-bg to-info-bg text-info-fg",
              "from-danger-bg to-danger-bg text-danger-fg",
            ];
            const tone = colorTones[idx % colorTones.length];
            const widthMm = j.target_width_mm || 0;
            const flexBasis = Math.max(
              80,
              Math.min(
                280,
                widthMm > 0 ? widthMm / 2 + 40 : (j.quantity || 100) / 2 + 80,
              ),
            );
            return (
              <div
                key={j.job_id}
                style={{ flexBasis }}
                className={cn(
                  "flex min-w-[80px] flex-col items-center justify-center rounded-md bg-gradient-to-b p-2 ring-1 ring-surface-1",
                  tone,
                )}
              >
                <div className="font-mono text-[10px] font-bold">
                  {j.sales_order_number
                    ? j.sales_order_number.slice(-8)
                    : j.job_number.slice(-8)}
                </div>
                {widthMm > 0 ? (
                  <div className="mt-1 font-mono text-[10.5px] font-bold opacity-90">
                    {Math.round(widthMm)} mm
                  </div>
                ) : (
                  <div className="mt-1 text-[10px] text-warning-fg">
                    no width
                  </div>
                )}
              <div className="mt-1 text-[10px] opacity-80">
                  {jobKg(j).toFixed(0)} kg
                </div>
                {j.customer_name ? (
                  <div className="mt-0.5 truncate text-[9px] opacity-70">
                    {j.customer_name.slice(0, 14)}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-content-3">
        <span>← one slit per order →</span>
        <span className="font-mono">5 mm trimmed at each cut</span>
      </div>
    </div>
  );
}
