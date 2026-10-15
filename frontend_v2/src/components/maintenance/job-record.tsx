"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService, type ChecklistResult, type MaintenanceJob, type Severity } from "@/services/maintenance";

import { BigChoice, JobStatusPill, SectionLabel, fmtDate, fmtDateTime, fmtInr, fmtMinutes } from "./ui";

/**
 * One job record for operators and technicians: checklist with three outcomes
 * per item, readings on a number keyboard, spares as notes, time, note, photos,
 * and the three job outcomes. Works on a phone; the same record is shown read
 * only once closed.
 */
export function JobRecord({ job, onChanged, compact = false }: { job: MaintenanceJob; onChanged?: (job: MaintenanceJob) => void; compact?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editable = ["DUE", "IN_PROGRESS", "UNABLE", "ISSUE_FOUND"].includes(job.status);
  const [results, setResults] = useState<Record<string, ChecklistResult>>(() => {
    const map: Record<string, ChecklistResult> = {};
    (job.checklist_results || []).forEach((row) => {
      map[row.code] = row;
    });
    return map;
  });
  const [outcome, setOutcome] = useState<"" | "COMPLETED" | "ISSUE" | "UNABLE">(job.outcome || "");
  const [reason, setReason] = useState(job.outcome_reason || "");
  const [faultTitle, setFaultTitle] = useState("");
  const [severity, setSeverity] = useState<Severity>("MEDIUM");
  const [machineRunning, setMachineRunning] = useState(true);
  const [minutes, setMinutes] = useState(String(job.time_minutes || ""));
  const [notes, setNotes] = useState(job.notes || "");
  const [spares, setSpares] = useState<Array<{ item: string; qty: string; cost: string }>>(
    (job.spares_used || []).map((row) => ({ item: row.item, qty: String(row.qty || ""), cost: String(row.cost || "") })),
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["maintenance"] });
  };

  const startMutation = useMutation({
    mutationFn: () => maintenanceService.startJob(job.id),
    onSuccess: (next) => {
      onChanged?.(next);
      invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not start", description: describeApiError(err) }),
  });

  const completeMutation = useMutation({
    mutationFn: () =>
      maintenanceService.completeJob(job.id, {
        outcome: outcome as "COMPLETED" | "ISSUE" | "UNABLE",
        checklist_results: Object.values(results),
        time_minutes: Number(minutes || 0),
        spares_used: spares.filter((row) => row.item.trim()).map((row) => ({ item: row.item.trim(), qty: Number(row.qty || 0), cost: Number(row.cost || 0) })),
        notes,
        outcome_reason: reason,
        fault_title: faultTitle,
        fault_severity: severity,
        machine_running: machineRunning,
      }),
    onSuccess: (next) => {
      toast({ title: outcome === "COMPLETED" ? "Recorded · दर्ज हो गया" : outcome === "ISSUE" ? "Issue reported · समस्या दर्ज" : "Marked as not done · दर्ज" });
      onChanged?.(next);
      invalidate();
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not save", description: describeApiError(err) }),
  });

  const checklist = job.checklist || [];
  const issueItems = useMemo(() => Object.values(results).filter((row) => row.status === "ISSUE"), [results]);
  const allAnswered = checklist.every((item) => results[item.code]?.status);
  const canSubmit =
    editable && outcome && (outcome === "COMPLETED" ? allAnswered || checklist.length === 0 : reason.trim().length > 0) && !completeMutation.isPending;

  const setItem = (code: string, patch: Partial<ChecklistResult>) =>
    setResults((current) => ({ ...current, [code]: { ...(current[code] || {}), code, status: patch.status ?? current[code]?.status ?? "OK", ...patch } }));

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      await maintenanceService.uploadAttachment(file, { job: job.id });
      toast({ title: "Photo attached · फ़ोटो जुड़ गई" });
      const fresh = await maintenanceService.job(job.id);
      onChanged?.(fresh);
      invalidate();
    } catch (err) {
      toast({ variant: "destructive", title: "Photo not attached", description: describeApiError(err) });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3" data-testid={`maintenance-job-record-${job.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <JobStatusPill status={job.status} overdue={job.is_overdue} />
        <span className="text-caption text-content-3">
          Planned {fmtDate(job.planned_date)}
          {job.completed_at ? ` · done ${fmtDateTime(job.completed_at)}${job.completed_by_name ? ` by ${job.completed_by_name}` : ""}` : ""}
        </span>
      </div>
      {job.status === "UNABLE" || job.status === "ISSUE_FOUND" ? (
        <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-fg">
          <b>{job.status === "UNABLE" ? "Not completed:" : "Issue found:"}</b> {job.outcome_reason}
        </div>
      ) : null}
      {job.status === "DUE" && editable ? (
        <Button type="button" className="h-12 w-full text-base font-bold" onClick={() => startMutation.mutate()} disabled={startMutation.isPending} data-testid="maintenance-job-start">
          {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Start · शुरू करें
        </Button>
      ) : null}

      {checklist.length ? (
        <div>
          <SectionLabel count={checklist.length}>Checks · जाँच</SectionLabel>
          <div className="space-y-2">
            {checklist.map((item) => {
              const current = results[item.code];
              return (
                <div key={item.code} className="rounded-xl border border-line bg-surface-1 p-3" data-testid={`maintenance-check-${item.code}`}>
                  <div className="text-sm font-semibold text-content-1">
                    {item.label}
                    {item.label_hi ? <span className="ml-1.5 text-caption font-medium text-content-3">· {item.label_hi}</span> : null}
                  </div>
                  {item.kind === "READING" ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        aria-label={`${item.label} reading`}
                        className="h-12 font-mono text-lg"
                        value={current?.reading ?? ""}
                        disabled={!editable}
                        onChange={(event) => {
                          const value = event.target.value === "" ? null : Number(event.target.value);
                          const outOfRange = value !== null && ((item.min != null && value < item.min) || (item.max != null && value > item.max));
                          setItem(item.code, { reading: value, status: value === null ? current?.status || "OK" : outOfRange ? "ISSUE" : "OK" });
                        }}
                      />
                      <span className="text-sm font-semibold text-content-3">{item.unit}</span>
                      {item.min != null || item.max != null ? (
                        <span className="text-caption text-content-3">
                          {item.min ?? "…"} to {item.max ?? "…"}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={cn("mt-2 grid gap-2", compact ? "grid-cols-3" : "grid-cols-3")}>
                    <BigChoice label="OK" hindi="ठीक है" tone="ok" active={current?.status === "OK"} onClick={() => editable && setItem(item.code, { status: "OK" })} testId={`check-ok-${item.code}`} />
                    <BigChoice label="Issue" hindi="गड़बड़ है" tone="issue" active={current?.status === "ISSUE"} onClick={() => editable && setItem(item.code, { status: "ISSUE" })} testId={`check-issue-${item.code}`} />
                    <BigChoice label="Can't check" hindi="नहीं कर सका" tone="skip" active={current?.status === "SKIPPED"} onClick={() => editable && setItem(item.code, { status: "SKIPPED" })} testId={`check-skip-${item.code}`} />
                  </div>
                  {current?.status && current.status !== "OK" ? (
                    <Input
                      className="mt-2"
                      placeholder="What did you see? · क्या देखा?"
                      aria-label={`${item.label} note`}
                      value={current.note || ""}
                      disabled={!editable}
                      onChange={(event) => setItem(item.code, { note: event.target.value })}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {job.kind === "TECH_SERVICE" || spares.length ? (
        <div>
          <SectionLabel>Spares used (note only) · पुर्ज़े</SectionLabel>
          <div className="space-y-2">
            {spares.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_72px_96px_36px] items-center gap-1.5">
                <Input placeholder="Item · पुर्ज़ा" aria-label="Spare item" value={row.item} disabled={!editable} onChange={(event) => setSpares((current) => current.map((r, i) => (i === index ? { ...r, item: event.target.value } : r)))} />
                <Input type="number" inputMode="decimal" placeholder="Qty" aria-label="Spare quantity" value={row.qty} disabled={!editable} onChange={(event) => setSpares((current) => current.map((r, i) => (i === index ? { ...r, qty: event.target.value } : r)))} />
                <Input type="number" inputMode="decimal" placeholder="₹ cost" aria-label="Spare cost" value={row.cost} disabled={!editable} onChange={(event) => setSpares((current) => current.map((r, i) => (i === index ? { ...r, cost: event.target.value } : r)))} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove spare row" disabled={!editable} onClick={() => setSpares((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {editable ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSpares((current) => [...current, { item: "", qty: "1", cost: "" }])}>
                <Plus className="mr-1 h-4 w-4" /> Add spare
              </Button>
            ) : null}
            {!editable && job.spares_used?.length ? <div className="text-caption text-content-3">Total noted: {fmtInr(job.spares_cost)}</div> : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <SectionLabel>Time taken · समय (min)</SectionLabel>
          <Input type="number" inputMode="numeric" aria-label="Time taken in minutes" className="h-12 font-mono text-lg" value={minutes} disabled={!editable} onChange={(event) => setMinutes(event.target.value)} placeholder="e.g. 45" />
          {!editable && job.time_minutes ? <div className="mt-1 text-caption text-content-3">{fmtMinutes(job.time_minutes)}</div> : null}
        </div>
        <div>
          <SectionLabel>Photos · फ़ोटो</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            {(job.attachments || []).map((file) => (
              <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-lg border border-line bg-surface-2" title={file.original_name}>
                {file.content_type.startsWith("image/") ? <img src={file.url} alt={file.original_name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-caption">PDF</span>}
              </a>
            ))}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden" aria-label="Add a photo" onChange={(event) => onPickPhoto(event.target.files?.[0] || null)} />
            <Button type="button" variant="outline" className="h-14" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Camera className="mr-1 h-4 w-4" />} Add photo
            </Button>
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Note · टिप्पणी</SectionLabel>
        <Textarea rows={2} value={notes} disabled={!editable} onChange={(event) => setNotes(event.target.value)} placeholder="Anything the next person should know" aria-label="Job note" />
      </div>

      {editable ? (
        <div>
          <SectionLabel>Outcome · नतीजा</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            <BigChoice label="Completed" hindi="पूरा हुआ" tone="ok" active={outcome === "COMPLETED"} onClick={() => setOutcome("COMPLETED")} testId="maintenance-outcome-completed" />
            <BigChoice label="Issue found" hindi="समस्या मिली" tone="issue" active={outcome === "ISSUE"} onClick={() => setOutcome("ISSUE")} testId="maintenance-outcome-issue" />
            <BigChoice label="Unable" hindi="नहीं हो सका" tone="skip" active={outcome === "UNABLE"} onClick={() => setOutcome("UNABLE")} testId="maintenance-outcome-unable" />
          </div>
          {outcome === "COMPLETED" && issueItems.length ? (
            <div className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg">
              {issueItems.length} check(s) marked &quot;Issue&quot;. Choose &quot;Issue found&quot; so a fault is raised, or change the check.
            </div>
          ) : null}
          {outcome === "ISSUE" || outcome === "UNABLE" ? (
            <div className="mt-2 space-y-2">
              <Textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={outcome === "ISSUE" ? "What is wrong? · क्या खराबी है?" : "Why not? · क्यों नहीं हो पाया?"} aria-label="Outcome reason" data-testid="maintenance-outcome-reason" />
              {outcome === "ISSUE" ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input value={faultTitle} onChange={(event) => setFaultTitle(event.target.value)} placeholder="Short fault name (optional)" aria-label="Fault title" />
                  <div className="flex gap-1.5">
                    {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as Severity[]).map((level) => (
                      <button key={level} type="button" aria-pressed={severity === level} onClick={() => setSeverity(level)} className={cn("rounded-lg border px-2 py-1 text-caption font-semibold", severity === level ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2")}>
                        {level}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-sm sm:col-span-2">
                    <input type="checkbox" checked={!machineRunning} onChange={(event) => setMachineRunning(!event.target.checked)} />
                    Machine has stopped · मशीन बंद है (the running step is paused as a breakdown)
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
          <Button type="button" className="mt-3 h-12 w-full text-base font-bold" disabled={!canSubmit} onClick={() => completeMutation.mutate()} data-testid="maintenance-job-submit">
            {completeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {job.requires_verification && outcome === "COMPLETED" ? "Submit for verification · जाँच के लिए भेजें" : "Save record · दर्ज करें"}
          </Button>
          {!allAnswered && checklist.length && outcome === "COMPLETED" ? <div className="mt-1 text-caption text-content-3">Answer every check before completing.</div> : null}
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-caption text-content-3">
          {job.status === "AWAITING_VERIFICATION" ? "Waiting for a supervisor to verify." : job.status === "VERIFIED" ? `Verified ${fmtDateTime(job.verified_at)}${job.verified_by_name ? ` by ${job.verified_by_name}` : ""}${job.verification_note ? ` · ${job.verification_note}` : ""}` : "Closed."}
        </div>
      )}
    </div>
  );
}
