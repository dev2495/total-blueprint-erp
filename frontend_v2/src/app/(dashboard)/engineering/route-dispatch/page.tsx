"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Factory,
  GitBranch,
  PencilLine,
  Route,
  Save,
  Search,
  SlidersHorizontal,
  Wand2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";

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
import { templateService, type RouteDispatchRow } from "@/services/templates";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

type SelectionPolicy = "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";

type DispatchDraft = {
  allowed: string[];
  defaultWorkCenter: string;
  policy: SelectionPolicy;
  notes: string;
};

type TemplateRouteGroup = {
  templateId: string;
  templateName: string;
  templateStatus: string;
  rows: RouteDispatchRow[];
  configured: number;
  needsDecision: number;
  noCapability: number;
};

const ISSUE_STATUSES = new Set([
  "NEEDS_DECISION",
  "NO_CAPABILITY",
  "INVALID_ALLOWED_WORK_CENTERS",
  "INVALID_DEFAULT_WORK_CENTER",
]);

const POLICY_LABELS: Record<SelectionPolicy, string> = {
  AUTO_IF_SINGLE: "Auto when only one",
  AUTO_DEFAULT: "Always use default",
  PLANNER_REQUIRED: "Planner chooses at release",
};

const POLICY_HINTS: Record<SelectionPolicy, string> = {
  AUTO_IF_SINGLE: "Best for steps with one capable center.",
  AUTO_DEFAULT: "Release uses the selected default center.",
  PLANNER_REQUIRED: "Planner confirms the center before release.",
};

const labelClassName =
  "text-[10px] font-black uppercase tracking-[0.16em] text-content-4";

function initialDraft(row: RouteDispatchRow): DispatchDraft {
  return {
    allowed: row.allowed_work_center_ids || [],
    defaultWorkCenter: row.default_work_center?.id || "",
    policy: row.selection_policy as SelectionPolicy,
    notes: row.dispatch_notes || "",
  };
}

function sortedIds(ids: string[]) {
  return [...ids].sort();
}

function sameIds(a: string[], b: string[]) {
  const left = sortedIds(a);
  const right = sortedIds(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hasDraftChanges(row: RouteDispatchRow, draft: DispatchDraft) {
  const initial = initialDraft(row);
  return (
    !sameIds(initial.allowed, draft.allowed) ||
    initial.defaultWorkCenter !== draft.defaultWorkCenter ||
    initial.policy !== draft.policy ||
    initial.notes !== draft.notes
  );
}

function statusLabel(status: string) {
  switch (status) {
    case "CONFIGURED":
      return "Ready";
    case "AUTO_RESOLVABLE":
      return "Auto ready";
    case "PLANNER_REQUIRED":
      return "Planner chooses";
    case "NEEDS_DECISION":
      return "Choose center";
    case "NO_CAPABILITY":
      return "No capability";
    case "INVALID_ALLOWED_WORK_CENTERS":
      return "Invalid allowed";
    case "INVALID_DEFAULT_WORK_CENTER":
      return "Invalid default";
    default:
      return status.replace(/_/g, " ");
  }
}

function statusMeta(status: string): { icon: LucideIcon; className: string } {
  switch (status) {
    case "CONFIGURED":
      return {
        icon: CheckCircle2,
        className: "border-success-border bg-success-bg text-success-fg",
      };
    case "AUTO_RESOLVABLE":
    case "PLANNER_REQUIRED":
      return {
        icon: Wand2,
        className: "border-info-border bg-info-bg text-info-fg",
      };
    case "NO_CAPABILITY":
      return {
        icon: XCircle,
        className: "border-danger-border bg-danger-bg text-danger-fg",
      };
    default:
      return {
        icon: AlertTriangle,
        className: "border-warning-border bg-warning-bg text-warning-fg",
      };
  }
}

function templateStatus(group: TemplateRouteGroup) {
  if (group.noCapability > 0) {
    return {
      label: `${group.noCapability} missing capability`,
      className: "border-danger-border bg-danger-bg text-danger-fg",
    };
  }

  if (group.needsDecision > 0) {
    return {
      label: `${group.needsDecision} decision${group.needsDecision === 1 ? "" : "s"} needed`,
      className: "border-warning-border bg-warning-bg text-warning-fg",
    };
  }

  return {
    label: "Route ready",
    className: "border-success-border bg-success-bg text-success-fg",
  };
}

function workCenterName(candidate: RouteDispatchRow["candidates"][number]) {
  return `${candidate.code} - ${candidate.name}`;
}

function allowedSummary(row: RouteDispatchRow, draft: DispatchDraft) {
  if (!row.candidates.length) {
    return "No capable work center mapped";
  }

  if (!draft.allowed.length) {
    return `All ${row.candidates.length} capable center${row.candidates.length === 1 ? "" : "s"} allowed`;
  }

  return `${draft.allowed.length} of ${row.candidates.length} allowed`;
}

function groupRouteRows(rows: RouteDispatchRow[]) {
  const groups = new Map<string, TemplateRouteGroup>();

  rows.forEach((row) => {
    const key = row.template_id;
    const current =
      groups.get(key) ||
      ({
        templateId: row.template_id,
        templateName: row.template_name,
        templateStatus: row.template_status,
        rows: [],
        configured: 0,
        needsDecision: 0,
        noCapability: 0,
      } satisfies TemplateRouteGroup);

    current.rows.push(row);
    current.configured += row.status === "CONFIGURED" || row.status === "AUTO_RESOLVABLE" || row.status === "PLANNER_REQUIRED" ? 1 : 0;
    current.needsDecision += ISSUE_STATUSES.has(row.status) ? 1 : 0;
    current.noCapability += row.status === "NO_CAPABILITY" ? 1 : 0;
    groups.set(key, current);
  });

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rows: group.rows.sort((a, b) => a.sequence_number - b.sequence_number),
    }))
    .sort((a, b) => {
      if (a.noCapability !== b.noCapability) return b.noCapability - a.noCapability;
      if (a.needsDecision !== b.needsDecision) return b.needsDecision - a.needsDecision;
      return a.templateName.localeCompare(b.templateName);
    });
}

export default function RouteDispatchPage() {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { effectiveRole, user } = useAuth();
  const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase();
  const canManageTemplates = Boolean(
    user?.is_owner ||
      user?.is_superuser ||
      ["ADMIN", "SUPER_ADMIN", "OWNER"].includes(roleCode) ||
      user?.entitlements?.permissions?.includes("*") ||
      user?.entitlements?.permissions?.includes("templates.manage") ||
      user?.extra_permissions?.includes("templates.manage"),
  );
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [processFilter, setProcessFilter] = useState("ALL");
  const [drafts, setDrafts] = useState<Record<string, DispatchDraft>>({});

  const query = useQuery({
    queryKey: ["route-dispatch"],
    queryFn: () => templateService.getRouteDispatch(),
  });

  const backfillMutation = useMutation({
    mutationFn: () => templateService.backfillRouteDispatch(true),
    onSuccess: (response) => {
      toast({
        title: "Route steps backfilled",
        description: `${response.applied} route step${response.applied === 1 ? "" : "s"} updated.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["route-dispatch"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: (payload: { row: RouteDispatchRow; draft: DispatchDraft }) =>
      templateService.updateStepDispatch(payload.row.template_id, payload.row.step_id, {
        allowed_work_center_ids: payload.draft.allowed,
        default_work_center: payload.draft.defaultWorkCenter || null,
        work_center_selection_policy: payload.draft.policy,
        dispatch_notes: payload.draft.notes || "",
      }),
    onSuccess: (_, payload) => {
      toast({
        title: "Route step saved",
        description: `${payload.row.template_name} - step ${payload.row.sequence_number}`,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[payload.row.step_id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["route-dispatch"] });
    },
  });

  const editDraftMutation = useMutation({
    mutationFn: (templateId: string) =>
      templateService.editTemplateDraft(
        templateId,
        "Route dispatch correction requested from Route Dispatch audit.",
      ),
    onSuccess: (template) => {
      toast({
        title: "Correction draft ready",
        description: "Opening Template Studio to edit dispatch safely.",
      });
      void queryClient.invalidateQueries({ queryKey: ["route-dispatch"] });
      router.push(`/engineering/templates/${template.id}`);
    },
    onError: (error: any) =>
      toast({
        title: "Safe edit failed",
        description:
          error?.response?.data?.detail ||
          error?.message ||
          "Could not create a correction draft.",
        variant: "destructive",
      }),
  });

  const disableTemplateMutation = useMutation({
    mutationFn: (templateId: string) => templateService.retireTemplate(templateId),
    onSuccess: () => {
      toast({
        title: "Template disabled",
        description: "It is hidden from all live selectors.",
      });
      void queryClient.invalidateQueries({ queryKey: ["route-dispatch"] });
      void queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (error: any) =>
      toast({
        title: "Disable failed",
        description:
          error?.response?.data?.detail ||
          error?.message ||
          "Could not disable template.",
        variant: "destructive",
      }),
  });

  const rows = query.data?.rows || [];

  const stats = useMemo(() => {
    const configured = rows.filter((row) => row.status === "CONFIGURED" || row.status === "PLANNER_REQUIRED").length;
    const autoReady = rows.filter((row) => row.status === "AUTO_RESOLVABLE").length;
    const issues = rows.filter((row) => ISSUE_STATUSES.has(row.status)).length;
    const noCapability = rows.filter((row) => row.status === "NO_CAPABILITY").length;
    const templateCount = new Set(rows.map((row) => row.template_id)).size;

    return {
      configured,
      autoReady,
      issues,
      noCapability,
      templateCount,
      totalSteps: rows.length,
    };
  }, [rows]);

  const processes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.process_code))).sort(),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesTerm =
        !term ||
        [row.template_name, row.process_code, row.process_name, row.template_status]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(term));
      const matchesStatus = statusFilter === "ALL" || row.status === statusFilter;
      const matchesProcess = processFilter === "ALL" || row.process_code === processFilter;
      return matchesTerm && matchesStatus && matchesProcess;
    });
  }, [processFilter, rows, search, statusFilter]);

  const templateGroups = useMemo(() => groupRouteRows(filteredRows), [filteredRows]);

  const updateDraft = (row: RouteDispatchRow, patch: Partial<DispatchDraft>) => {
    setDrafts((current) => ({
      ...current,
      [row.step_id]: { ...(current[row.step_id] || initialDraft(row)), ...patch },
    }));
  };

  const chooseWorkCenter = (
    row: RouteDispatchRow,
    draft: DispatchDraft,
    workCenterId: string,
    checked: boolean,
  ) => {
    const candidateIds = row.candidates.map((candidate) => candidate.id);
    const currentAllowed = draft.allowed.length ? draft.allowed : candidateIds;
    const nextAllowed = checked
      ? Array.from(new Set([...currentAllowed, workCenterId]))
      : currentAllowed.filter((id) => id !== workCenterId);

    updateDraft(row, {
      allowed: nextAllowed.length === candidateIds.length ? [] : nextAllowed,
      defaultWorkCenter:
        draft.defaultWorkCenter === workCenterId && !checked ? "" : draft.defaultWorkCenter,
    });
  };

  const chooseDefault = (row: RouteDispatchRow, draft: DispatchDraft, value: string) => {
    if (value === "__NONE__") {
      updateDraft(row, { defaultWorkCenter: "" });
      return;
    }

    const allowed =
      draft.allowed.length && !draft.allowed.includes(value)
        ? Array.from(new Set([...draft.allowed, value]))
        : draft.allowed;

    updateDraft(row, {
      defaultWorkCenter: value,
      allowed,
      policy: draft.policy === "AUTO_IF_SINGLE" ? "AUTO_DEFAULT" : draft.policy,
    });
  };

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-line bg-surface-1 shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto] lg:p-6">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-info-bg text-primary ring-1 ring-info-border">
                <Route className="h-5 w-5" />
              </span>
              <div>
                <p className={labelClassName}>Template route dispatch</p>
                <h1 className="text-3xl font-black tracking-tight text-content-1">
                  Work-center setup by template
                </h1>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryTile label="Templates" value={stats.templateCount} />
              <SummaryTile label="Route steps" value={stats.totalSteps} />
              <SummaryTile label="Need setup" value={stats.issues} tone="warning" />
              <SummaryTile label="No capability" value={stats.noCapability} tone="danger" />
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-3xl border border-line bg-surface-2 p-4 lg:min-w-[320px]">
            <div>
              <p className={labelClassName}>Release behavior</p>
              <p className="mt-1 text-sm font-semibold text-content-3">
                Each template step needs allowed work centers, an optional default, and a release rule.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Badge className="justify-center rounded-xl border-success-border bg-success-bg px-3 py-2 text-success-fg">
                {stats.configured} configured
              </Badge>
              <Badge className="justify-center rounded-xl border-info-border bg-info-bg px-3 py-2 text-info-fg">
                {stats.autoReady} auto ready
              </Badge>
            </div>
            <Button
              type="button"
              className="w-full justify-center gap-2"
              disabled={backfillMutation.isPending}
              onClick={() => backfillMutation.mutate()}
            >
              <Wand2 className="h-4 w-4" />
              Backfill missing steps
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-line bg-surface-1 p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_190px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search template, process, or route step..."
              className="h-12 pl-11"
            />
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="NEEDS_DECISION">Needs decision</SelectItem>
              <SelectItem value="NO_CAPABILITY">No capability</SelectItem>
              <SelectItem value="AUTO_RESOLVABLE">Auto ready</SelectItem>
              <SelectItem value="PLANNER_REQUIRED">Planner chooses</SelectItem>
              <SelectItem value="CONFIGURED">Configured</SelectItem>
              <SelectItem value="INVALID_ALLOWED_WORK_CENTERS">Invalid allowed</SelectItem>
              <SelectItem value="INVALID_DEFAULT_WORK_CENTER">Invalid default</SelectItem>
            </SelectContent>
          </Select>

          <Select value={processFilter} onValueChange={setProcessFilter}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Process" />
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
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-content-3">
            <SlidersHorizontal className="h-4 w-4 text-content-4" />
            <span>
              Showing {templateGroups.length} template{templateGroups.length === 1 ? "" : "s"} and{" "}
              {filteredRows.length} step{filteredRows.length === 1 ? "" : "s"}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("ALL");
              setProcessFilter("ALL");
            }}
          >
            Clear filters
          </Button>
        </div>
      </section>

      {query.isLoading ? (
        <div className="rounded-[24px] border border-line bg-surface-1 p-10 text-center font-semibold text-content-3">
          Loading route dispatch setup...
        </div>
      ) : query.isError ? (
        <div className="rounded-[24px] border border-danger-border bg-danger-bg p-10 text-center font-semibold text-danger-fg">
          Route dispatch setup could not be loaded.
        </div>
      ) : templateGroups.length === 0 ? (
        <div className="rounded-[24px] border border-line bg-surface-1 p-10 text-center font-semibold text-content-3">
          No route steps match the current filters.
        </div>
      ) : (
        <div className="space-y-4">
          {templateGroups.map((group) => (
            <TemplateRouteCard
              key={group.templateId}
              group={group}
              drafts={drafts}
              savingStepId={
                saveMutation.isPending ? saveMutation.variables?.row.step_id || null : null
              }
              onAllowAll={(row) => updateDraft(row, { allowed: [] })}
              onToggleWorkCenter={chooseWorkCenter}
              onChooseDefault={chooseDefault}
              onChangePolicy={(row, policy) => updateDraft(row, { policy })}
              onSave={(row, draft) => saveMutation.mutate({ row, draft })}
              onEditSafely={(templateId) => editDraftMutation.mutate(templateId)}
              onDisableTemplate={(templateId) => {
                if (window.confirm("Disable this template and hide it from all live selectors?")) {
                  disableTemplateMutation.mutate(templateId);
                }
              }}
              canManageTemplates={canManageTemplates}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-surface-2 p-4",
        tone === "warning" && "border-warning-border bg-warning-bg/60",
        tone === "danger" && "border-danger-border bg-danger-bg/60",
        tone === "neutral" && "border-line",
      )}
    >
      <p className={labelClassName}>{label}</p>
      <p className="mt-2 text-2xl font-black text-content-1">{value}</p>
    </div>
  );
}

function TemplateRouteCard({
  group,
  drafts,
  savingStepId,
  canManageTemplates,
  onAllowAll,
  onToggleWorkCenter,
  onChooseDefault,
  onChangePolicy,
  onSave,
  onEditSafely,
  onDisableTemplate,
}: {
  group: TemplateRouteGroup;
  drafts: Record<string, DispatchDraft>;
  savingStepId: string | null;
  canManageTemplates: boolean;
  onAllowAll: (row: RouteDispatchRow) => void;
  onToggleWorkCenter: (
    row: RouteDispatchRow,
    draft: DispatchDraft,
    workCenterId: string,
    checked: boolean,
  ) => void;
  onChooseDefault: (row: RouteDispatchRow, draft: DispatchDraft, value: string) => void;
  onChangePolicy: (row: RouteDispatchRow, policy: SelectionPolicy) => void;
  onSave: (row: RouteDispatchRow, draft: DispatchDraft) => void;
  onEditSafely: (templateId: string) => void;
  onDisableTemplate: (templateId: string) => void;
}) {
  const routeStatus = templateStatus(group);
  const isLive = group.templateStatus === "LIVE";
  const isReadOnly = isLive || group.templateStatus === "OBSOLETE";

  return (
    <Card className="overflow-hidden border-line bg-surface-1 shadow-sm">
      <CardHeader className="border-b border-line bg-surface-2/70">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-info-bg text-primary ring-1 ring-info-border">
                <GitBranch className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-xl font-black text-content-1">
                  {group.templateName}
                </CardTitle>
                <p className="mt-1 text-sm font-bold text-content-4">
                  {group.templateStatus} - {group.rows.length} route step
                  {group.rows.length === 1 ? "" : "s"} - {group.configured} ready
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("rounded-xl px-3 py-2 text-xs font-black", routeStatus.className)}>
              {routeStatus.label}
            </Badge>
            {isLive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onEditSafely(group.templateId)}
                className="rounded-xl"
              >
                <PencilLine className="mr-2 h-4 w-4" />
                Edit safely
              </Button>
            ) : null}
            {canManageTemplates && group.templateStatus !== "OBSOLETE" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onDisableTemplate(group.templateId)}
                className="rounded-xl border-danger-border text-danger-fg hover:bg-danger-bg"
              >
                <XCircle className="mr-2 h-4 w-4" />
                Disable
              </Button>
            ) : null}
          </div>
        </div>
        {isLive ? (
          <div className="mt-4 rounded-2xl border border-success-border bg-success-bg px-4 py-3 text-sm font-semibold text-success-fg">
            This template is live and locked. Create a correction draft before changing dispatch setup.
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {group.rows.map((row) => {
            const meta = statusMeta(row.status);
            const Icon = meta.icon;
            return (
              <span
                key={row.step_id}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-black",
                  meta.className,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                Step {row.sequence_number}
                <span className="font-bold opacity-80">{row.process_code}</span>
              </span>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4 lg:p-5">
        {group.rows.map((row) => {
          const draft = drafts[row.step_id] || initialDraft(row);
          const changed = hasDraftChanges(row, draft);
          return (
            <RouteStepPanel
              key={row.step_id}
              row={row}
              draft={draft}
              changed={changed}
              isReadOnly={isReadOnly}
              isSaving={savingStepId === row.step_id}
              onAllowAll={() => onAllowAll(row)}
              onToggleWorkCenter={(workCenterId, checked) =>
                onToggleWorkCenter(row, draft, workCenterId, checked)
              }
              onChooseDefault={(value) => onChooseDefault(row, draft, value)}
              onChangePolicy={(policy) => onChangePolicy(row, policy)}
              onSave={() => onSave(row, draft)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function RouteStepPanel({
  row,
  draft,
  changed,
  isReadOnly,
  isSaving,
  onAllowAll,
  onToggleWorkCenter,
  onChooseDefault,
  onChangePolicy,
  onSave,
}: {
  row: RouteDispatchRow;
  draft: DispatchDraft;
  changed: boolean;
  isReadOnly: boolean;
  isSaving: boolean;
  onAllowAll: () => void;
  onToggleWorkCenter: (workCenterId: string, checked: boolean) => void;
  onChooseDefault: (value: string) => void;
  onChangePolicy: (policy: SelectionPolicy) => void;
  onSave: () => void;
}) {
  const meta = statusMeta(row.status);
  const StatusIcon = meta.icon;
  const candidateIds = row.candidates.map((candidate) => candidate.id);
  const canSave = row.candidates.length > 0 && changed && !isSaving && !isReadOnly;

  return (
    <section className="rounded-3xl border border-line bg-surface-2/45 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-surface-1 text-primary ring-1 ring-line">
              <Factory className="h-4 w-4" />
            </span>
            <h3 className="text-lg font-black text-content-1">
              Step {row.sequence_number}: {row.process_code}
            </h3>
          </div>
          <p className="mt-1 text-sm font-bold text-content-3">{row.process_name}</p>
        </div>

        <Badge className={cn("w-fit rounded-xl px-3 py-2 text-xs font-black", meta.className)}>
          <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
          {statusLabel(row.status)}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={labelClassName}>Allowed work centers</p>
              <p className="mt-1 text-sm font-bold text-content-3">
                {allowedSummary(row, draft)}
              </p>
            </div>
            {row.candidates.length > 1 ? (
              <Button type="button" variant="outline" size="sm" onClick={onAllowAll} disabled={isReadOnly}>
                Allow all
              </Button>
            ) : null}
          </div>

          {row.candidates.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-warning-border bg-warning-bg p-4 text-sm font-bold text-warning-fg">
              No work center currently has capability for this process.
            </div>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {row.candidates.map((candidate) => {
                const checked = draft.allowed.length === 0 || draft.allowed.includes(candidate.id);
                const isDefault = draft.defaultWorkCenter === candidate.id;

                return (
                  <label
                    key={candidate.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition",
                      checked
                        ? "border-primary/60 bg-info-bg text-content-1"
                        : "border-line bg-surface-2 text-content-3 hover:border-primary/35",
                    )}
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={isReadOnly}
                      onCheckedChange={(value) =>
                        onToggleWorkCenter(candidate.id, value === true)
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black">
                        {workCenterName(candidate)}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs font-bold text-content-4">
                        <span>{candidate.plant_code}</span>
                        <span>-</span>
                        <span>capable</span>
                        {isDefault ? (
                          <Badge className="rounded-full border-info-border bg-info-bg text-info-fg">
                            Default
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="flex items-center gap-2">
            <CircleDot className="h-4 w-4 text-primary" />
            <p className={labelClassName}>Release decision</p>
          </div>

          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <label className={labelClassName}>
                Default work center
              </label>
              <Select
                value={draft.defaultWorkCenter || "__NONE__"}
                disabled={row.candidates.length === 0 || isReadOnly}
                onValueChange={onChooseDefault}
              >
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="No default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">No default</SelectItem>
                  {row.candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {workCenterName(candidate)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className={labelClassName}>
                Release rule
              </label>
              <Select
                value={draft.policy}
                disabled={row.candidates.length === 0 || isReadOnly}
                onValueChange={(value) => onChangePolicy(value as SelectionPolicy)}
              >
                <SelectTrigger className="h-12">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(POLICY_LABELS) as SelectionPolicy[]).map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {POLICY_LABELS[policy]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs font-bold text-content-4">{POLICY_HINTS[draft.policy]}</p>
            </div>

            <div className="rounded-2xl border border-line bg-surface-2 p-3 text-sm font-bold text-content-3">
              {row.candidates.length === 0 ? (
                "Capability setup is required before this route can be released automatically."
              ) : draft.defaultWorkCenter ? (
                <>
                  Default:{" "}
                  <span className="text-content-1">
                    {workCenterName(
                      row.candidates.find((candidate) => candidate.id === draft.defaultWorkCenter) ||
                        row.candidates[0],
                    )}
                  </span>
                </>
              ) : draft.policy === "PLANNER_REQUIRED" ? (
                "Planner will choose from the allowed centers at release."
              ) : row.candidates.length === 1 ? (
                "Single capable center can be used automatically."
              ) : (
                "Choose a default or require planner selection for this step."
              )}
            </div>

            <Button
              type="button"
              className="h-12 w-full justify-center gap-2"
              disabled={!canSave}
              onClick={onSave}
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : changed ? "Save step" : "Saved"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
