"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Factory,
  Route,
  Save,
  Search,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  templateService,
  type RouteDispatchRow,
} from "@/services/templates";
import { cn } from "@/lib/utils";

type SelectionPolicy = "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";

type DispatchDraft = {
  allowed: string[];
  defaultWorkCenter: string;
  policy: SelectionPolicy;
  notes: string;
};

const ISSUE_STATUSES = new Set([
  "NEEDS_DECISION",
  "NO_CAPABILITY",
  "INVALID_ALLOWED_WORK_CENTERS",
  "INVALID_DEFAULT_WORK_CENTER",
]);

function initialDraft(row: RouteDispatchRow): DispatchDraft {
  return {
    allowed: Array.isArray(row.allowed_work_center_ids)
      ? row.allowed_work_center_ids
      : [],
    defaultWorkCenter: row.default_work_center?.id || "__NONE__",
    policy: row.selection_policy || "AUTO_IF_SINGLE",
    notes: row.dispatch_notes || "",
  };
}

function statusLabel(status: string): string {
  return status
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusClass(status: string): string {
  if (status === "CONFIGURED") return "border-success-border bg-success-bg text-success-fg";
  if (status === "AUTO_RESOLVABLE") return "border-info-border bg-info-bg text-info-fg";
  if (ISSUE_STATUSES.has(status)) return "border-warning-border bg-warning-bg text-warning-fg";
  return "border-line bg-surface-2 text-content-3";
}

export default function RouteDispatchSetupPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [processFilter, setProcessFilter] = useState("ALL");
  const [drafts, setDrafts] = useState<Record<string, DispatchDraft>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["template-route-dispatch"],
    queryFn: () => templateService.getRouteDispatch(),
  });

  const backfillMutation = useMutation({
    mutationFn: () => templateService.backfillRouteDispatch(true),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["template-route-dispatch"] });
      toast({
        title: "Dispatch backfill complete",
        description: `${result.applied} route step${result.applied === 1 ? "" : "s"} auto-filled.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Backfill failed",
        description: error?.response?.data?.detail || error?.message || "Could not backfill route dispatch.",
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: ({ row, draft }: { row: RouteDispatchRow; draft: DispatchDraft }) =>
      templateService.updateStepDispatch(row.template_id, row.step_id, {
        allowed_work_center_ids: draft.allowed,
        default_work_center:
          draft.defaultWorkCenter === "__NONE__" ? null : draft.defaultWorkCenter,
        work_center_selection_policy: draft.policy,
        dispatch_notes: draft.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-route-dispatch"] });
      toast({
        title: "Dispatch updated",
        description: "Factory route selection saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.response?.data?.detail || error?.message || "Could not save dispatch setup.",
        variant: "destructive",
      });
    },
  });

  const rows = data?.rows || [];
  const processes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.process_code))).sort(),
    [rows],
  );
  const filteredRows = rows.filter((row) => {
    const term = search.trim().toLowerCase();
    const text = `${row.template_name} ${row.process_code} ${row.process_name}`.toLowerCase();
    return (
      (!term || text.includes(term)) &&
      (statusFilter === "ALL" || row.status === statusFilter) &&
      (processFilter === "ALL" || row.process_code === processFilter)
    );
  });

  const updateDraft = (row: RouteDispatchRow, patch: Partial<DispatchDraft>) => {
    setDrafts((current) => ({
      ...current,
      [row.step_id]: {
        ...(current[row.step_id] || initialDraft(row)),
        ...patch,
      },
    }));
  };

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <section className="overflow-hidden rounded-[2rem] border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-col gap-5 p-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="outline" className="border-line-strong bg-surface-3 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
                FACTORY FLOW
              </Badge>
              <Badge variant="outline" className="border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                ROUTE DISPATCH
              </Badge>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-content-1">
              Route Dispatch Setup
            </h1>
            <p className="mt-2 text-sm font-semibold text-content-3">
              Assign each live template step to allowed factory work centers so release never guesses between identical process capabilities.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:min-w-[620px]">
            {([
              ["Steps", data?.total || 0, Route],
              ["Needs decision", data?.needs_decision || 0, AlertTriangle],
              ["Configured", data?.status_counts?.CONFIGURED || 0, CheckCircle2],
              ["Auto ready", data?.status_counts?.AUTO_RESOLVABLE || 0, Wand2],
            ] satisfies Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
              <div key={String(label)} className="rounded-2xl border border-line bg-surface-2 px-4 py-3">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                  <span>{label as string}</span>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-1 text-2xl font-black text-content-1">{String(value)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2 px-5 py-4 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search template or process..."
              className="h-11 rounded-xl border-line bg-surface-1 pl-9 text-sm font-semibold"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-11 rounded-xl border-line bg-surface-1 text-sm font-bold xl:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All dispatch states</SelectItem>
              <SelectItem value="NEEDS_DECISION">Needs decision</SelectItem>
              <SelectItem value="AUTO_RESOLVABLE">Auto resolvable</SelectItem>
              <SelectItem value="CONFIGURED">Configured</SelectItem>
              <SelectItem value="NO_CAPABILITY">No capability</SelectItem>
            </SelectContent>
          </Select>
          <Select value={processFilter} onValueChange={setProcessFilter}>
            <SelectTrigger className="h-11 rounded-xl border-line bg-surface-1 text-sm font-bold xl:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All processes</SelectItem>
              {processes.map((process) => (
                <SelectItem key={process} value={process}>
                  {process}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            disabled={backfillMutation.isPending}
            onClick={() => backfillMutation.mutate()}
            className="h-11 rounded-xl bg-primary px-5 text-[11px] font-black uppercase tracking-[0.16em] text-white"
          >
            <Wand2 className="mr-2 h-4 w-4" />
            Auto Fill Singles
          </Button>
        </div>
      </section>

      <div className="space-y-3">
        {isLoading ? (
          <Card className="border-line bg-surface-1">
            <CardContent className="p-8 text-center text-sm font-semibold text-content-3">
              Loading dispatch setup...
            </CardContent>
          </Card>
        ) : filteredRows.length === 0 ? (
          <Card className="border-line bg-surface-1">
            <CardContent className="p-8 text-center text-sm font-semibold text-content-3">
              No route steps match the current filters.
            </CardContent>
          </Card>
        ) : (
          filteredRows.map((row) => {
            const draft = drafts[row.step_id] || initialDraft(row);
            const allowedSet = new Set(draft.allowed);
            const candidates = row.candidates || [];
            return (
              <Card key={row.step_id} className="overflow-hidden border-line bg-surface-1 shadow-sm">
                <CardHeader className="border-b border-line bg-surface-2 px-4 py-3">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base font-black text-content-1">
                        <Factory className="h-4 w-4 text-primary" />
                        {row.process_code}
                        <span className="text-content-4">·</span>
                        <span className="truncate">{row.template_name}</span>
                      </CardTitle>
                      <div className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-content-4">
                        Step {row.sequence_number} · {row.template_status} · {row.process_name}
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("w-fit px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]", statusClass(row.status))}>
                      {statusLabel(row.status)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-4 p-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr_auto] xl:items-start">
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Allowed work centers
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {candidates.length === 0 ? (
                        <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-3 text-sm font-bold text-warning-fg">
                          No capable work center is mapped for this process.
                        </div>
                      ) : (
                        candidates.map((wc) => {
                          const checked = allowedSet.size === 0 || allowedSet.has(wc.id);
                          return (
                            <label
                              key={wc.id}
                              className={cn(
                                "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 transition",
                                checked ? "border-primary bg-info-bg" : "border-line bg-surface-2",
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => {
                                  const current = allowedSet.size === 0 ? candidates.map((candidate) => candidate.id) : [...allowedSet];
                                  const next = value
                                    ? Array.from(new Set([...current, wc.id]))
                                    : current.filter((id) => id !== wc.id);
                                  updateDraft(row, { allowed: next });
                                }}
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-black text-content-1">
                                  {wc.code} · {wc.name}
                                </span>
                                <span className="block text-xs font-semibold text-content-4">
                                  {wc.plant_code || "Plant"} · capable
                                </span>
                              </span>
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Default
                    </div>
                    <Select
                      value={draft.defaultWorkCenter}
                      onValueChange={(value) => {
                        const allowed = value === "__NONE__" ? draft.allowed : Array.from(new Set([...draft.allowed, value]));
                        updateDraft(row, { defaultWorkCenter: value, allowed });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-xl border-line bg-surface-2 font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">No default</SelectItem>
                        {candidates.map((wc) => (
                          <SelectItem key={wc.id} value={wc.id}>
                            {wc.code} · {wc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Policy
                    </div>
                    <Select
                      value={draft.policy}
                      onValueChange={(value) => updateDraft(row, { policy: value as SelectionPolicy })}
                    >
                      <SelectTrigger className="h-11 rounded-xl border-line bg-surface-2 font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AUTO_IF_SINGLE">Auto if single</SelectItem>
                        <SelectItem value="AUTO_DEFAULT">Use default</SelectItem>
                        <SelectItem value="PLANNER_REQUIRED">Planner required</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex xl:justify-end">
                    <Button
                      type="button"
                      disabled={saveMutation.isPending}
                      onClick={() => saveMutation.mutate({ row, draft })}
                      className="h-11 rounded-xl bg-surface-3 px-5 text-[11px] font-black uppercase tracking-[0.16em] text-white hover:bg-primary"
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
