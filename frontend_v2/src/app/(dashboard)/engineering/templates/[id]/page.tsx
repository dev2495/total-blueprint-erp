"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  GitBranch,
  Layers3,
  PencilLine,
  ShieldCheck,
  Workflow,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  type TemplateBatchExecutionPolicy,
  type TemplateProcessStep,
} from "@/services/templates";
import { routingService } from "@/services/routing";
import { TemplateBomEditor } from "@/components/engineering/template-bom-editor";
import { commercialFamilyService } from "@/services/commercial-families";
import { useAuth } from "@/components/auth-provider";

const err = (error: any) =>
  error?.response?.data?.detail ||
  error?.response?.data?.error ||
  error?.response?.data?.message ||
  error?.message ||
  "Request failed.";

const DISPATCH_BLOCKING_STATUSES = new Set([
  "NEEDS_DECISION",
  "NO_CAPABILITY",
  "INVALID_ALLOWED_WORK_CENTERS",
  "INVALID_DEFAULT_WORK_CENTER",
]);

function hasDispatchBlocker(step: TemplateProcessStep) {
  return DISPATCH_BLOCKING_STATUSES.has(
    String(step.dispatch_status?.status || ""),
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${active ? "bg-success-bg text-success-fg" : "bg-surface-2 text-content-3"}`}
    >
      {label}
    </span>
  );
}

function plainBehaviour(value?: string) {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "CREATE_NEW") return "Makes a new roll";
  if (normalized === "MODIFY_EXISTING") return "Works on an existing roll";
  if (normalized === "MULTI_INPUT_COMBINE") return "Combines lane rolls";
  if (normalized === "SPLIT") return "Splits one roll into many";
  return "Finishing or count-only step";
}

function StudioStepper({
  template,
  steps,
  readiness,
}: {
  template: any;
  steps: TemplateProcessStep[];
  readiness: any;
}) {
  const basicsReady = Boolean(
    template.name && template.fg_type && template.default_stock_strategy,
  );
  const routeReady = Boolean(template.routing_rule && steps.length);
  const materialsReady = Boolean(
    steps.length && steps.some((step) => step.materials?.length),
  );
  const dispatchReady =
    steps.length > 0 &&
    steps.every((step) => !hasDispatchBlocker(step));
  const readyItems = [
    basicsReady,
    routeReady,
    materialsReady,
    dispatchReady,
    Boolean(readiness?.ready),
  ];
  const firstPendingIndex = readyItems.findIndex((done) => !done);
  const activeIndex = firstPendingIndex === -1 ? readyItems.length - 1 : firstPendingIndex;
  const items = [
    ["Basics & family", basicsReady],
    ["Production route & stage rules", routeReady],
    ["Materials per stage", materialsReady],
    ["Work-center dispatch", dispatchReady],
    ["Review & make live", Boolean(readiness?.ready)],
  ];
  return (
    <div className="grid gap-3 md:grid-cols-5">
      {items.map(([label, done], index) => (
        <div
          key={String(label)}
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm ${done ? "border-success-border bg-success-bg text-success-fg" : index === activeIndex ? "border-info-border bg-surface-1 text-primary " : "border-line bg-surface-1 text-content-2"}`}
        >
          <div
            className={`grid h-8 w-8 place-items-center rounded-xl text-xs font-black ${done ? "bg-success-fg text-white" : index === activeIndex ? "bg-primary text-white" : "bg-surface-2 text-content-3"}`}
          >
            {done ? "✓" : index + 1}
          </div>
          <div>
            <div
              className={`text-[10px] font-black uppercase tracking-[0.14em] ${done ? "text-success-fg" : index === 1 ? "text-primary" : "text-content-4"}`}
            >
              {done
                ? `Step ${index + 1} · Complete`
                : index === activeIndex
                  ? "You are here"
                  : "Pending"}
            </div>
            <div className="mt-0.5 text-sm font-semibold">{String(label)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function readinessPercent(
  template: any,
  steps: TemplateProcessStep[],
  readiness: any,
) {
  if (readiness?.ready) return 100;
  const checks = [
    Boolean(
      template.name && template.fg_type && template.default_stock_strategy,
    ),
    Boolean(template.routing_rule && steps.length),
    Boolean(steps.length && steps.some((step) => step.materials?.length)),
    Boolean((readiness?.blockers || []).length === 0),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function ReadinessDashboard({
  template,
  steps,
  readiness,
}: {
  template: any;
  steps: TemplateProcessStep[];
  readiness: any;
}) {
  const pct = readinessPercent(template, steps, readiness);
  const blockers = readiness?.blockers || [];
  const warnings = readiness?.warnings || [];
  const materializedSteps = steps.filter(
    (step) => step.materials?.length,
  ).length;
  return (
    <section className="rounded-[20px] border border-line bg-surface-1 p-5 shadow-sm">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="min-w-[260px] flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
            Template readiness
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <div className="text-3xl font-extrabold tracking-tight">
              {pct}
              <span className="text-xl text-content-4">%</span>
            </div>
            <div className="text-sm font-medium text-content-3">
              {materializedSteps} of {steps.length || 0} stages have material
              policy
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-info-bg">
            <span
              className="block h-full rounded-full bg-gradient-to-r from-primary to-info-fg"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusPill label="Basics saved" active={Boolean(template.name)} />
            <StatusPill
              label={template.routing_rule_name || "Route pending"}
              active={Boolean(template.routing_rule)}
            />
            <StatusPill
              label={`${steps.length || 0} stages`}
              active={Boolean(steps.length)}
            />
            <StatusPill
              label={readiness?.ready ? "Ready for live" : "Review needed"}
              active={Boolean(readiness?.ready)}
            />
          </div>
        </div>
        <div className="hidden w-px self-stretch bg-surface-2 xl:block" />
        <div className="min-w-[320px] flex-1">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
            Blocking checks
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {blockers.slice(0, 3).map((item: string) => (
              <div
                key={item}
                className="rounded-2xl border border-danger-border bg-danger-bg px-3 py-2 font-semibold text-danger-fg"
              >
                Fix: {item}
              </div>
            ))}
            {!blockers.length && (
              <div className="rounded-2xl border border-success-border bg-success-bg px-3 py-2 font-semibold text-success-fg">
                No blocking readiness issues.
              </div>
            )}
            {warnings.slice(0, 2).map((item: string) => (
              <div
                key={item}
                className="rounded-2xl border border-warning-border bg-warning-bg px-3 py-2 font-semibold text-warning-fg"
              >
                Advisory: {item}
              </div>
            ))}
          </div>
        </div>
        <div className="hidden w-px self-stretch bg-surface-2 xl:block" />
        <div className="min-w-[230px]">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
            What is next
          </div>
          <p className="mt-2 text-sm font-medium text-content-3">
            {readiness?.ready
              ? "Publish or clone a new version when route policy is approved."
              : "Fix blockers, sync route stages, then move through engineering review."}
          </p>
          <div className="mt-3 rounded-2xl border border-line bg-surface-2 p-3 text-xs font-semibold text-content-3">
            Layer thickness, grade, width, and actual order specs stay on
            SKU/order snapshots; this template owns route, lanes, and material
            policy.
          </div>
        </div>
      </div>
    </section>
  );
}

function LifecycleRail({ status }: { status: string }) {
  const stages = ["DRAFT", "ENGINEERING", "APPROVED", "LIVE", "OBSOLETE"];
  const activeIndex = Math.max(0, stages.indexOf(String(status || "DRAFT")));
  const descriptions = [
    "Editable",
    "Peer checks rules",
    "Locked for publish",
    "Used by planner",
    "Retired",
  ];
  return (
    <section className="rounded-[20px] border border-line bg-surface-1 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
          Lifecycle
        </div>
        <span className="rounded-full border border-info-border bg-info-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-primary">
          Currently: {String(status || "Draft").replace("_", " ")}
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {stages.map((stage, index) => (
          <div key={stage} className="text-center">
            <div
              className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm font-black ${index <= activeIndex ? "bg-primary text-white" : "bg-surface-2 text-content-3"}`}
            >
              {index + 1}
            </div>
            <div className="mt-2 text-sm font-black text-content-1">
              {stage.replace("_", " ")}
            </div>
            <div className="text-[11px] font-medium text-content-3">
              {descriptions[index]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadinessPanel({ readiness }: { readiness: any }) {
  const ready = Boolean(readiness?.ready);
  return (
    <Card
      className={`rounded-[2rem] border ${ready ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg"}`}
    >
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-3">
              Review gate
            </div>
            <div
              className={`mt-1 text-xl font-black ${ready ? "text-success-fg" : "text-warning-fg"}`}
            >
              {ready ? "Ready for LIVE publish" : "Needs attention before LIVE"}
            </div>
          </div>
          {ready ? (
            <CheckCircle2 className="h-8 w-8 text-success-fg" />
          ) : (
            <XCircle className="h-8 w-8 text-warning-fg" />
          )}
        </div>
        <div className="mt-4 space-y-2 text-sm">
          {(readiness?.blockers || []).map((item: string) => (
            <div
              key={item}
              className="rounded-2xl bg-surface-1/70 px-3 py-2 font-semibold text-warning-fg"
            >
              {item}
            </div>
          ))}
          {(readiness?.warnings || []).map((item: string) => (
            <div
              key={item}
              className="rounded-2xl bg-surface-1/70 px-3 py-2 font-semibold text-content-2"
            >
              {item}
            </div>
          ))}
          {ready && !(readiness?.warnings || []).length && (
            <div className="rounded-2xl bg-surface-1/70 px-3 py-2 font-semibold text-success-fg">
              Route, lifecycle, lane, and material checks passed.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StepCard({ step }: { step: TemplateProcessStep }) {
  const spec = step.roll_handling;
  const isLamination =
    String(step.process_roll_behavior || "").toUpperCase() ===
    "MULTI_INPUT_COMBINE";
  return (
    <div className="rounded-3xl border border-line bg-surface-1 p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-primary">
            Step {step.sequence_number}
          </div>
          <h3 className="mt-1 text-lg font-black text-content-1">
            {step.process_name}
          </h3>
          <p className="mt-1 text-xs font-semibold text-content-3">
            {plainBehaviour(step.process_roll_behavior)} •{" "}
            {step.process_input_form} to {step.process_output_form}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill
            label={step.is_removed_from_route ? "removed" : "active"}
            active={!step.is_removed_from_route}
          />
          {isLamination && (
            <StatusPill
              label={`Pass ${spec?.lamination_pass_index || 1}`}
              active
            />
          )}
        </div>
      </div>
      {isLamination ? (
        <div className="mt-4 rounded-3xl border border-info-border bg-info-bg p-4">
          <div className="flex items-center gap-2 text-sm font-black text-primary">
            <Layers3 className="h-4 w-4" /> Lamination pass builder
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl bg-surface-1 p-3 text-sm">
              <b>Lane A</b>
              <div className="mt-1 text-xs text-content-3">
                {Number(spec?.lamination_pass_index || 1) <= 1
                  ? "Layer 1 roll group"
                  : "Previous laminate WIP group"}
              </div>
            </div>
            <div className="rounded-2xl bg-surface-1 p-3 text-sm">
              <b>Lane B</b>
              <div className="mt-1 text-xs text-content-3">
                Layer{" "}
                {Math.max(2, Number(spec?.lamination_pass_index || 1) + 1)} roll
                group
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 text-xs md:grid-cols-4">
            <div className="rounded-2xl bg-surface-1 p-3">
              <b>{spec?.input_lane_count || 2}</b>
              <br />
              input lanes
            </div>
            <div className="rounded-2xl bg-surface-1 p-3">
              <b>{spec?.adhesive_split_pct || 0}%</b>
              <br />
              adhesive split
            </div>
            <div className="rounded-2xl bg-surface-1 p-3">
              <b>{spec?.solvent_split_pct || 0}%</b>
              <br />
              solvent split
            </div>
            <div className="rounded-2xl bg-surface-1 p-3">
              <b>
                {spec?.width_rule === "MIN_INPUT"
                  ? "Smallest input"
                  : spec?.width_rule || "Smallest input"}
              </b>
              <br />
              width rule
            </div>
          </div>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {(step.materials || []).map((material) => (
          <span
            key={material.id}
            className="rounded-full bg-surface-2 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-content-3"
          >
            {material.category_code}
          </span>
        ))}
        {!step.materials?.length && (
          <span className="text-xs font-semibold text-content-4">
            No material categories mapped yet.
          </span>
        )}
      </div>
    </div>
  );
}

type DispatchDraft = {
  allowed: string[];
  defaultWorkCenter: string;
  policy: "AUTO_IF_SINGLE" | "AUTO_DEFAULT" | "PLANNER_REQUIRED";
  notes: string;
};

function dispatchStatusLabel(status?: string) {
  switch (status) {
    case "CONFIGURED":
      return "Default set";
    case "AUTO_RESOLVABLE":
      return "Auto fills on publish";
    case "PLANNER_REQUIRED":
      return "Planner chooses";
    case "NEEDS_DECISION":
      return "Decision needed";
    case "NO_CAPABILITY":
      return "No capability";
    case "INVALID_ALLOWED_WORK_CENTERS":
      return "Invalid allowed list";
    case "INVALID_DEFAULT_WORK_CENTER":
      return "Invalid default";
    default:
      return "Not checked";
  }
}

function dispatchStatusClass(status?: string) {
  if (status === "CONFIGURED" || status === "AUTO_RESOLVABLE" || status === "PLANNER_REQUIRED") {
    return "border-success-border bg-success-bg text-success-fg";
  }
  if (status === "NO_CAPABILITY" || status === "INVALID_ALLOWED_WORK_CENTERS" || status === "INVALID_DEFAULT_WORK_CENTER") {
    return "border-danger-border bg-danger-bg text-danger-fg";
  }
  return "border-warning-border bg-warning-bg text-warning-fg";
}

function DispatchStepEditor({
  step,
  isReadOnly,
  isSaving,
  onSave,
}: {
  step: TemplateProcessStep;
  isReadOnly: boolean;
  isSaving: boolean;
  onSave: (step: TemplateProcessStep, draft: DispatchDraft) => void;
}) {
  const status = step.dispatch_status;
  const candidates = status?.candidates || [];
  const validCandidates = status?.valid_candidates?.length ? status.valid_candidates : candidates;
  const [draft, setDraft] = useState<DispatchDraft>({
    allowed: step.allowed_work_center_ids || [],
    defaultWorkCenter: step.default_work_center || status?.default_work_center?.id || "",
    policy: step.work_center_selection_policy || status?.selection_policy || "AUTO_IF_SINGLE",
    notes: step.dispatch_notes || "",
  });
  const candidateIds = candidates.map((candidate) => candidate.id);
  const allowedIds = draft.allowed.length ? draft.allowed : candidateIds;

  return (
    <div className="rounded-3xl border border-line bg-surface-1 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
            Stage {step.sequence_number}
          </div>
          <h3 className="mt-1 text-base font-black text-content-1">
            {step.process_name}
          </h3>
          <p className="mt-1 text-xs font-semibold text-content-3">
            {candidates.length} capable work center{candidates.length === 1 ? "" : "s"}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${dispatchStatusClass(status?.status)}`}>
          {dispatchStatusLabel(status?.status)}
        </span>
      </div>

      {candidates.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-sm font-semibold text-danger-fg">
          Add machine/work-center capability for {step.process_code} before this template can go live.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-line bg-surface-2 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                  Allowed centers
                </div>
                <div className="text-xs font-semibold text-content-3">
                  Empty allow-list means every capable center is allowed.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isReadOnly}
                onClick={() => setDraft((current) => ({ ...current, allowed: [] }))}
              >
                Allow all
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {candidates.map((candidate) => {
                const checked = allowedIds.includes(candidate.id);
                return (
                  <label
                    key={candidate.id}
                    className="flex items-start gap-3 rounded-2xl border border-line bg-surface-1 p-3 text-sm font-semibold text-content-2"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={isReadOnly}
                      onCheckedChange={(value) => {
                        const currentAllowed = draft.allowed.length ? draft.allowed : candidateIds;
                        const next = value
                          ? Array.from(new Set([...currentAllowed, candidate.id]))
                          : currentAllowed.filter((id) => id !== candidate.id);
                        setDraft((current) => ({
                          ...current,
                          allowed: next.length === candidateIds.length ? [] : next,
                          defaultWorkCenter:
                            current.defaultWorkCenter === candidate.id && !value ? "" : current.defaultWorkCenter,
                        }));
                      }}
                    />
                    <span>
                      <span className="block font-black text-content-1">{candidate.code}</span>
                      <span className="text-xs text-content-3">{candidate.name}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-line bg-surface-2 p-3">
            <div>
              <Label>Release rule</Label>
              <Select
                value={draft.policy}
                disabled={isReadOnly}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    policy: value as DispatchDraft["policy"],
                    defaultWorkCenter:
                      value === "PLANNER_REQUIRED" ? "" : current.defaultWorkCenter,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO_IF_SINGLE">Auto when one center</SelectItem>
                  <SelectItem value="AUTO_DEFAULT">Use selected default</SelectItem>
                  <SelectItem value="PLANNER_REQUIRED">Planner chooses at release</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Default work center</Label>
              <Select
                value={draft.defaultWorkCenter || "__NONE__"}
                disabled={isReadOnly || draft.policy === "PLANNER_REQUIRED"}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    defaultWorkCenter: value === "__NONE__" ? "" : value,
                    policy: value === "__NONE__" ? current.policy : "AUTO_DEFAULT",
                    allowed:
                      value !== "__NONE__" && current.allowed.length && !current.allowed.includes(value)
                        ? Array.from(new Set([...current.allowed, value]))
                        : current.allowed,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">No default</SelectItem>
                  {validCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.code} - {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dispatch note</Label>
              <Input
                value={draft.notes}
                disabled={isReadOnly}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="Optional release note"
              />
            </div>
            <Button
              className="w-full"
              disabled={isReadOnly || isSaving}
              onClick={() => onSave(step, draft)}
            >
              {isSaving ? "Saving..." : "Save dispatch setup"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkCenterDispatchPanel({
  template,
  steps,
  isReadOnly,
  savingStepId,
  onSave,
}: {
  template: any;
  steps: TemplateProcessStep[];
  isReadOnly: boolean;
  savingStepId: string;
  onSave: (step: TemplateProcessStep, draft: DispatchDraft) => void;
}) {
  return (
    <Card id="work-center-dispatch" className="scroll-mt-28 rounded-[2rem]">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black">
              <Workflow className="h-4 w-4 text-primary" /> 4. Template route dispatch
            </div>
            <p className="mt-1 text-xs font-semibold text-content-3">
              Set work-center release rules here for new templates and
              correction drafts. The Route Dispatch page is only an audit and
              legacy backfill view.
            </p>
          </div>
          {template.status === "LIVE" ? (
            <span className="rounded-full border border-success-border bg-success-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-success-fg">
              Safe edit required
            </span>
          ) : null}
        </div>
        {!steps.length ? (
          <div className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-content-3">
            Sync route stages first; dispatch setup appears per route stage.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-3xl border border-info-border bg-info-bg px-4 py-3 text-sm font-semibold text-primary">
              Publish blocks missing capability, invalid defaults, and unresolved
              multi-center decisions. “Planner chooses at release” is valid when
              the planner must select the machine during release.
            </div>
            {steps.map((step) => (
              <DispatchStepEditor
                key={`${step.id}-${step.dispatch_updated_at || ""}`}
                step={step}
                isReadOnly={isReadOnly}
                isSaving={savingStepId === step.id}
                onSave={onSave}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function defaultBatchPolicy(policy?: TemplateBatchExecutionPolicy | null): TemplateBatchExecutionPolicy {
  return {
    default_batch_size_kg:
      policy?.default_batch_size_kg === undefined ? "" : policy.default_batch_size_kg,
    default_batch_size_pcs:
      policy?.default_batch_size_pcs === undefined ? "" : policy.default_batch_size_pcs,
    allow_partial_movement: policy?.allow_partial_movement ?? true,
    auto_release_parallel_branches:
      policy?.auto_release_parallel_branches ?? true,
    join_requires_all_inputs: policy?.join_requires_all_inputs ?? true,
    auto_batch_on_release: policy?.auto_batch_on_release ?? true,
    lot_number_prefix: policy?.lot_number_prefix || "",
  };
}

type TemplateRouteFlowStage = {
  stageIndex: number;
  nodes: Array<{ id: string; label: string; route_index: number }>;
};

const templateFlowTone = (index: number) =>
  [
    "border-info-border bg-info-bg text-primary",
    "border-success-border bg-success-bg text-success-fg",
    "border-warning-border bg-warning-bg text-warning-fg",
    "border-order-border bg-order-bg text-order-fg",
  ][index % 4];

function routeFlowStagesForTemplate(route: any): TemplateRouteFlowStage[] {
  const rawNodes = Array.isArray(route?.route_graph?.nodes)
    ? route.route_graph.nodes
    : [];
  const ordered = Array.isArray(route?.ordered_processes)
    ? route.ordered_processes
    : [];
  const nodes: TemplateRouteFlowStage["nodes"] = rawNodes.length
    ? rawNodes
        .filter((node: any) => node && (node.process_code || node.label || node.id))
        .map((node: any, index: number) => ({
          id: String(node.id || `step_${index + 1}`),
          label: String(node.label || node.process_name || node.process_code || `Step ${index + 1}`),
          route_index: Number.isFinite(Number(node.route_index))
            ? Number(node.route_index)
            : index,
        }))
    : ordered.map((processCode: string, index: number) => ({
        id: `step_${index + 1}_${processCode}`,
        label: String(processCode),
        route_index: index,
      }));
  const uniqueIndexes = Array.from(
    new Set<number>(nodes.map((node) => Number(node.route_index || 0))),
  ).sort((a: number, b: number) => a - b);
  const indexMap = new Map(uniqueIndexes.map((value, index) => [value, index]));
  const groups = new Map<number, TemplateRouteFlowStage["nodes"]>();
  nodes.forEach((node, index) => {
    const stageIndex = indexMap.get(Number(node.route_index || 0)) ?? index;
    groups.set(stageIndex, [...(groups.get(stageIndex) || []), { ...node, route_index: stageIndex }]);
  });
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([stageIndex, nodes]) => ({ stageIndex, nodes }));
}

function BatchExecutionPolicyCard({
  policy,
  route,
  isReadOnly,
  isSaving,
  onChange,
  onSave,
}: {
  policy: TemplateBatchExecutionPolicy;
  route: any;
  isReadOnly: boolean;
  isSaving: boolean;
  onChange: (policy: TemplateBatchExecutionPolicy) => void;
  onSave: () => void;
}) {
  const routeStages = routeFlowStagesForTemplate(route);
  const parallelGroups = routeStages.filter((stage) => stage.nodes.length > 1).length;
  const update = (patch: Partial<TemplateBatchExecutionPolicy>) =>
    onChange({ ...policy, ...patch });

  return (
    <Card className="rounded-[2rem] border-info-border bg-info-bg/20">
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black">
              <GitBranch className="h-4 w-4 text-primary" /> 2. Batch and lot execution
            </div>
            <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-content-3">
              Template Studio owns batch size, lot naming, matching, and release
              behavior for this product. Route Master only supplies the flow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-info-border bg-info-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-primary">
              template policy
            </span>
            <span className="rounded-full border border-success-border bg-success-bg px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-success-fg">
              one sales line stays one demand
            </span>
          </div>
        </div>

        <div className="rounded-[1.5rem] border border-line bg-surface-1 p-4">
          <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                Selected route flow · read only
              </div>
              <div className="mt-1 text-sm font-black text-content-1">
                {route?.name || route?.routing_rule_name || "No route selected"}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-info-border bg-info-bg px-2.5 py-1 text-[10px] font-black text-primary">
                {routeStages.length} stages
              </span>
              {parallelGroups ? (
                <span className="rounded-full border border-warning-border bg-warning-bg px-2.5 py-1 text-[10px] font-black text-warning-fg">
                  {parallelGroups} + branch{parallelGroups === 1 ? "" : "es"}
                </span>
              ) : null}
            </div>
          </div>
          {routeStages.length ? (
            <div className="space-y-2">
              {routeStages.map((stage, stagePosition) => (
                <div key={stage.stageIndex} className="flex flex-col items-center">
                  <div
                    className={`w-full rounded-2xl border p-3 ${stage.nodes.length > 1 ? "border-warning-border bg-warning-bg/50" : "border-line bg-surface-2"}`}
                  >
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Stage {stagePosition + 1}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {stage.nodes.map((node, nodeIndex) => (
                        <div key={node.id} className="flex items-center gap-2">
                          {nodeIndex > 0 ? (
                            <span className="text-base font-black text-warning-fg">+</span>
                          ) : null}
                          <span
                            className={`inline-flex min-h-9 items-center rounded-xl border px-3 py-1.5 text-xs font-black ${templateFlowTone(nodeIndex + stagePosition)}`}
                          >
                            {node.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {stagePosition < routeStages.length - 1 ? (
                    <div className="py-1 text-xs font-bold text-content-4">
                      ↓
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5 text-sm font-semibold text-content-3">
              Select and sync a route to see the flow this template will use.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
            Batch creation
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Batch size KG</Label>
              <Input
                inputMode="decimal"
                value={String(policy.default_batch_size_kg ?? "")}
                disabled={isReadOnly}
                onChange={(event) =>
                  update({ default_batch_size_kg: event.target.value })
                }
                placeholder="e.g. 500"
              />
            </div>
            <div>
              <Label>Batch size PCS</Label>
              <Input
                inputMode="numeric"
                value={String(policy.default_batch_size_pcs ?? "")}
                disabled={isReadOnly}
                onChange={(event) =>
                  update({ default_batch_size_pcs: event.target.value })
                }
                placeholder="Optional"
              />
            </div>
            <div>
              <Label>Lot prefix</Label>
              <Input
                value={String(policy.lot_number_prefix || "")}
                disabled={isReadOnly}
                onChange={(event) =>
                  update({ lot_number_prefix: event.target.value.toUpperCase() })
                }
                placeholder="AUTO"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
            Release behavior
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              [
                "auto_batch_on_release",
                "Auto create batches",
                "Create live production batches when planner releases the line.",
              ],
              [
                "allow_partial_movement",
                "Allow partial movement",
                "Permit part of a batch to move while balance remains open.",
              ],
              [
                "auto_release_parallel_branches",
                "Release + branches together",
                "Start independent route branches without manual duplicate release.",
              ],
              [
                "join_requires_all_inputs",
                "Match all before next stage",
                "Hold join stages until every required input branch is complete.",
              ],
            ].map(([key, label, help]) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-surface-1 px-4 py-3"
              >
                <div>
                  <div className="text-xs font-black text-content-1">{label}</div>
                  <div className="mt-1 text-[11px] font-semibold leading-4 text-content-3">
                    {help}
                  </div>
                </div>
                <Switch
                  disabled={isReadOnly}
                  checked={Boolean((policy as any)[key])}
                  onCheckedChange={(checked) =>
                    update({ [key]: checked } as Partial<TemplateBatchExecutionPolicy>)
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button disabled={isReadOnly || isSaving} onClick={onSave}>
            {isSaving ? "Saving execution rules..." : "Save template execution"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TemplateStudioPage() {
  const params = useParams();
  const id = params?.id as string;
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveRole, user } = useAuth();
  const isAdminActor = Boolean(
    user?.is_owner ||
      user?.is_superuser ||
      ["ADMIN", "SUPER_ADMIN", "OWNER"].includes(
        String(effectiveRole || user?.role_info?.code || "").toUpperCase(),
      ),
  );
  const canManageTemplates =
    isAdminActor ||
    Boolean(
      user?.entitlements?.permissions?.includes("*") ||
        user?.entitlements?.permissions?.includes("templates.manage") ||
        user?.extra_permissions?.includes("templates.manage"),
  );
  const [routingRuleId, setRoutingRuleId] = useState("");
  const [commercialFamilyId, setCommercialFamilyId] = useState("");
  const [batchPolicyDraft, setBatchPolicyDraft] =
    useState<TemplateBatchExecutionPolicy>(defaultBatchPolicy());

  const templateQuery = useQuery({
    queryKey: ["template", id],
    queryFn: () => templateService.getTemplate(id),
  });
  const stepsQuery = useQuery({
    queryKey: ["template-steps", id],
    queryFn: () => templateService.getProcessSteps(id),
    enabled: Boolean(id),
  });
  const readinessQuery = useQuery({
    queryKey: ["template-readiness", id],
    queryFn: () => templateService.getReadiness(id),
    enabled: Boolean(id),
  });
  const routingRulesQuery = useQuery({
    queryKey: ["routing-rules"],
    queryFn: () => routingService.getRules(),
  });
  const commercialFamiliesQuery = useQuery({
    queryKey: ["commercial-families"],
    queryFn: commercialFamilyService.getAll,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["template", id] });
    queryClient.invalidateQueries({ queryKey: ["template-steps", id] });
    queryClient.invalidateQueries({ queryKey: ["template-readiness", id] });
    queryClient.invalidateQueries({ queryKey: ["template-sync-preview", id] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: any) => templateService.updateTemplate(id, data),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Template saved",
        description: "Basics and route binding updated.",
      });
    },
    onError: (error) =>
      toast({
        title: "Save failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const syncMutation = useMutation({
    mutationFn: () => templateService.applyWorkflowSync(id),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Workflow synced",
        description: "Route stages are now aligned with the selected rule.",
      });
    },
    onError: (error) =>
      toast({
        title: "Sync failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const dispatchMutation = useMutation({
    mutationFn: (payload: { step: TemplateProcessStep; draft: DispatchDraft }) =>
      templateService.updateStepDispatch(id, payload.step.id, {
        allowed_work_center_ids: payload.draft.allowed,
        default_work_center: payload.draft.defaultWorkCenter || null,
        work_center_selection_policy: payload.draft.policy,
        dispatch_notes: payload.draft.notes || "",
      }),
    onSuccess: (_, payload) => {
      invalidate();
      toast({
        title: "Dispatch setup saved",
        description: `Stage ${payload.step.sequence_number} work-center rule updated.`,
      });
    },
    onError: (error) =>
      toast({
        title: "Dispatch save failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const batchPolicyMutation = useMutation({
    mutationFn: () =>
      templateService.updateTemplate(id, {
        batch_execution_policy: batchPolicyDraft,
      }),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Template execution saved",
        description: "New production releases will use these batch and lot rules.",
      });
    },
    onError: (error) =>
      toast({
        title: "Batch policy save failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const approveMutation = useMutation({
    mutationFn: () => templateService.approveTemplate(id),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Template approved",
        description: "It remains editable until published LIVE.",
      });
    },
    onError: (error) =>
      toast({
        title: "Approval failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const requestReviewMutation = useMutation({
    mutationFn: () => templateService.requestReview(id),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Sent for review",
        description: "Engineering review gate is now active.",
      });
    },
    onError: (error) =>
      toast({
        title: "Review request failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const publishMutation = useMutation({
    mutationFn: () => templateService.makeLive(id),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Template is LIVE",
        description: "New planner releases can use this template setup.",
      });
    },
    onError: (error) =>
      toast({
        title: "Publish failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const cloneMutation = useMutation({
    mutationFn: () => templateService.cloneTemplate(id),
    onSuccess: (template: any) => {
      toast({
        title: "New version created",
        description: "Opening the cloned template now.",
      });
      router.push(`/engineering/templates/${template.id}`);
    },
    onError: (error) =>
      toast({
        title: "Clone failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const editDraftMutation = useMutation({
    mutationFn: () =>
      templateService.editTemplateDraft(
        id,
        "Template correction requested from Template Studio.",
      ),
    onSuccess: (template: any) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({
        queryKey: ["templates", "admin-registry"],
      });
      toast({
        title:
          template.id === id ? "Template is editable" : "Correction draft ready",
        description:
          template.id === id
            ? "Continue editing this template."
            : "Existing orders stay on the live version until this draft is published.",
      });
      if (template.id !== id) router.push(`/engineering/templates/${template.id}`);
    },
    onError: (error) =>
      toast({
        title: "Safe edit failed",
        description: err(error),
        variant: "destructive",
      }),
  });
  const retireMutation = useMutation({
    mutationFn: () => templateService.retireTemplate(id),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({
        queryKey: ["templates", "admin-registry"],
      });
      toast({
        title: "Template disabled",
        description:
          "It is hidden from live selectors while route history remains preserved.",
      });
    },
    onError: (error) =>
      toast({
        title: "Disable failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const template = templateQuery.data;
  const steps = stepsQuery.data || template?.process_steps || [];
  const readiness = readinessQuery.data || template?.readiness;
  const selectedRoute = (routingRulesQuery.data || []).find(
    (rule: any) => rule.id === (routingRuleId || template?.routing_rule),
  );
  useEffect(() => {
    if (template?.id) {
      setBatchPolicyDraft(defaultBatchPolicy(template.batch_execution_policy));
    }
  }, [template?.id, template?.batch_execution_policy]);
  const laminationSteps = useMemo(
    () =>
      steps.filter(
        (step) =>
          String(step.process_roll_behavior || "").toUpperCase() ===
          "MULTI_INPUT_COMBINE",
      ),
    [steps],
  );

  if (templateQuery.isLoading)
    return (
      <div className="p-8 text-sm text-content-3">
        Loading template studio...
      </div>
    );
  if (templateQuery.isError || !template)
    return (
      <div className="p-8 text-sm text-danger-fg">
        {err(templateQuery.error) || "Template not found."}
      </div>
    );

  const isDisabled = template.status === "OBSOLETE";
  const isReadOnly = template.status === "LIVE" || isDisabled;
  const isLive = template.status === "LIVE";
  const isCorrectionDraft = Boolean(template.source_template);
  const nextLabel =
    template.status === "DRAFT"
      ? "Send for review"
      : template.status === "ENGINEERING"
        ? "Approve"
        : template.status === "APPROVED"
          ? "Publish LIVE"
          : template.status === "LIVE"
            ? "Edit safely"
            : "Clone new version";

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <section className="sticky top-2 z-20 rounded-[20px] border border-line bg-surface-1/85 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.back()}
              className="h-9 rounded-xl bg-surface-1 shadow-sm"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-sm font-black text-white">
              T
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
                Template Studio · execution rules
              </div>
              <div className="truncate text-[15px] font-semibold text-content-1">
                {template.name} ·{" "}
                {isCorrectionDraft
                  ? "correction draft"
                  : String(template.status || "draft").toLowerCase()}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-[11px] font-bold text-content-3">
              {template.fg_type || "Template"}
            </span>
            <span className="rounded-full border border-info-border bg-info-bg px-3 py-1 text-[11px] font-bold text-primary">
              {template.commercial_family_name || "Family unlinked"}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-bold ${isDisabled ? "border-line bg-surface-2 text-content-3" : isReadOnly ? "border-success-border bg-success-bg text-success-fg" : "border-warning-border bg-warning-bg text-warning-fg"}`}
            >
              {isDisabled
                ? "Disabled"
                : isReadOnly
                  ? "Live / locked"
                  : "Editable"}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                isLive ? editDraftMutation.mutate() : cloneMutation.mutate()
              }
              disabled={cloneMutation.isPending || editDraftMutation.isPending}
              className="h-9 rounded-xl bg-surface-1"
            >
              {isLive ? (
                <PencilLine className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {isLive ? "Edit safely" : "Duplicate"}
            </Button>
            {canManageTemplates && !isDisabled ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (
                    window.confirm(
                      "Disable this template? It will be hidden from live selectors while existing orders keep their route history.",
                    )
                  ) {
                    retireMutation.mutate();
                  }
                }}
                disabled={retireMutation.isPending}
                className="h-9 rounded-xl"
              >
                <XCircle className="mr-2 h-4 w-4" /> Disable
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-3">
          <StudioStepper
            template={template}
            steps={steps}
            readiness={readiness}
          />
        </div>
        {isLive ? (
          <div className="mt-3 flex flex-col gap-3 rounded-2xl border border-success-border bg-success-bg px-4 py-3 text-sm font-semibold text-success-fg md:flex-row md:items-center md:justify-between">
            <span>
              Live templates are locked for production history. Use safe edit to
              open a correction draft; existing orders and jobs stay unchanged.
            </span>
            <Button
              size="sm"
              onClick={() => editDraftMutation.mutate()}
              disabled={editDraftMutation.isPending}
              className="h-9 rounded-xl bg-success-fg px-4 text-white hover:bg-success-fg/90"
            >
              <PencilLine className="mr-2 h-4 w-4" /> Edit safely
            </Button>
          </div>
        ) : isCorrectionDraft ? (
          <div className="mt-3 rounded-2xl border border-info-border bg-info-bg px-4 py-3 text-sm font-semibold text-primary">
            You are editing a correction draft. Publish it to replace the live
            template for future orders; old orders keep the preserved original.
          </div>
        ) : null}
      </section>

      <ReadinessDashboard
        template={template}
        steps={steps}
        readiness={readiness}
      />
      <LifecycleRail status={template.status} />

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <main className="space-y-5">
          <Card className="rounded-[2rem]">
            <CardContent className="space-y-4 p-5">
              <div className="flex items-center gap-2 text-sm font-black">
                <ShieldCheck className="h-4 w-4 text-primary" /> 1. Basics and
                route binding
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>Routing rule</Label>
                  <Select
                    value={routingRuleId || template.routing_rule || ""}
                    onValueChange={setRoutingRuleId}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select route rule" />
                    </SelectTrigger>
                    <SelectContent>
                      {(routingRulesQuery.data || []).map((rule: any) => (
                        <SelectItem key={rule.id} value={rule.id}>
                          {rule.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Business family</Label>
                  <Select
                    value={
                      commercialFamilyId ||
                      template.commercial_family ||
                      "__NONE__"
                    }
                    onValueChange={setCommercialFamilyId}
                    disabled={isReadOnly}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select family" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">
                        No linked business family
                      </SelectItem>
                      {(commercialFamiliesQuery.data || []).map(
                        (family: any) => (
                          <SelectItem key={family.id} value={family.id}>
                            {family.name}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isReadOnly || updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({
                      routing_rule: routingRuleId || template.routing_rule,
                      commercial_family:
                        (commercialFamilyId ||
                          template.commercial_family ||
                          "__NONE__") === "__NONE__"
                          ? null
                          : commercialFamilyId || template.commercial_family,
                    })
                  }
                >
                  Save basics
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    !template.routing_rule ||
                    syncMutation.isPending ||
                    isReadOnly
                  }
                  onClick={() => syncMutation.mutate()}
                >
                  <Workflow className="mr-2 h-4 w-4" /> Sync route stages
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    isLive ? editDraftMutation.mutate() : cloneMutation.mutate()
                  }
                  disabled={cloneMutation.isPending || editDraftMutation.isPending}
                >
                  {isLive ? (
                    <PencilLine className="mr-2 h-4 w-4" />
                  ) : (
                    <Copy className="mr-2 h-4 w-4" />
                  )}
                  {isLive ? "Edit safely" : "Clone new version"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <BatchExecutionPolicyCard
            policy={batchPolicyDraft}
            route={selectedRoute}
            isReadOnly={isReadOnly}
            isSaving={batchPolicyMutation.isPending}
            onChange={setBatchPolicyDraft}
            onSave={() => batchPolicyMutation.mutate()}
          />

          <Card className="rounded-[2rem]">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black">
                <GitBranch className="h-4 w-4 text-primary" /> 3. Route stages
                and lamination lanes
              </div>
              <div className="mb-5 overflow-x-auto rounded-3xl border border-line bg-surface-2 p-4">
                <div className="flex min-w-max items-center gap-3">
                  {steps.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-3">
                      <div
                        className={`rounded-2xl border px-4 py-3 ${String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE" ? "border-warning-border bg-warning-bg" : "border-info-border bg-surface-1"}`}
                      >
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                          Stage {step.sequence_number}
                        </div>
                        <div className="mt-1 text-sm font-black text-content-1">
                          {step.process_name}
                        </div>
                        <div className="mt-1 text-[10px] font-semibold text-content-3">
                          {plainBehaviour(step.process_roll_behavior)}
                        </div>
                      </div>
                      {index < steps.length - 1 && (
                        <ArrowLeft className="h-4 w-4 rotate-180 text-content-4" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {steps.map((step) => (
                  <StepCard key={step.id} step={step} />
                ))}
                {!steps.length && (
                  <div className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-content-3">
                    No route stages yet. Select a routing rule and sync route
                    stages.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <WorkCenterDispatchPanel
            template={template}
            steps={steps}
            isReadOnly={isReadOnly}
            savingStepId={
              dispatchMutation.isPending
                ? dispatchMutation.variables?.step.id || ""
                : ""
            }
            onSave={(step, draft) => dispatchMutation.mutate({ step, draft })}
          />

          <div>
            <div className="mb-3">
              <div className="text-sm font-black text-content-1">
                5. Step material rules
              </div>
              <p className="mt-1 text-xs font-semibold text-content-3">
                Compact editor for route stages, issue categories, and machine
                close behavior.
              </p>
            </div>
            <TemplateBomEditor template={template as any} />
          </div>
          <details className="rounded-[2rem] border border-line bg-surface-1 p-5 shadow-sm">
            <summary className="cursor-pointer text-sm font-black">
              Template Studio glossary
            </summary>
            <div className="mt-4 grid gap-3 text-xs md:grid-cols-3">
              {[
                [
                  "Route stage",
                  "One production process pulled from the routing rule.",
                ],
                [
                  "Lane",
                  "A lamination input side; each lane may contain one or many physical rolls.",
                ],
                ["Pass 1", "Combines layer 1 plus layer 2."],
                [
                  "Pass 2",
                  "Combines pass-1 output plus layer 3 for 3-layer products.",
                ],
                [
                  "Issue policy",
                  "How much material WCM asks the store/floor to issue.",
                ],
                [
                  "Capture mode",
                  "How actual consumption is captured at machine close.",
                ],
              ].map(([term, copy]) => (
                <div key={term} className="rounded-2xl bg-surface-2 p-3">
                  <b>{term}</b>
                  <br />
                  {copy}
                </div>
              ))}
            </div>
          </details>
        </main>

        <aside className="sticky top-4 h-fit space-y-5">
          <ReadinessPanel readiness={readiness} />
          <Card className="rounded-[2rem]">
            <CardContent className="space-y-4 p-5">
              <div className="text-sm font-black">6. Review and make live</div>
              <div className="space-y-2 text-xs font-semibold text-content-3">
                <div>Route: {template.routing_rule_name || "Not selected"}</div>
                <div>
                  Family: {template.commercial_family_name || "Unlinked"}
                </div>
                <div>
                  Supported material categories: GRANULE, ADHESIVE, SOLVENT,
                  ADDON, POD
                </div>
                <div>
                  Layer truth remains in SKU/order snapshot; this template
                  controls route and material policy.
                </div>
              </div>
              <Button
                className="w-full"
                disabled={
                  isDisabled ||
                  requestReviewMutation.isPending ||
                  approveMutation.isPending ||
                  publishMutation.isPending ||
                  editDraftMutation.isPending
                }
                onClick={() => {
                  if (template.status === "DRAFT")
                    requestReviewMutation.mutate();
                  else if (template.status === "APPROVED")
                    publishMutation.mutate();
                  else if (template.status === "ENGINEERING")
                    approveMutation.mutate();
                  else if (template.status === "LIVE")
                    editDraftMutation.mutate();
                }}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" /> {nextLabel}
              </Button>
              {canManageTemplates && !isDisabled ? (
                <Button
                  variant="outline"
                  className="w-full border-danger-border text-danger-fg hover:bg-danger-bg"
                  disabled={retireMutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Disable this template? It will not appear in sales, planner, or product-master selectors.",
                      )
                    ) {
                      retireMutation.mutate();
                    }
                  }}
                >
                  <XCircle className="mr-2 h-4 w-4" /> Disable template
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
