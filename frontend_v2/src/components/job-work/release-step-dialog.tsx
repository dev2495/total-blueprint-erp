"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FastForward, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jobWorkApi, type JobWorkActionResult, type JobWorkOrderDetail } from "@/services/job-work";

import { ErrorBanner, Field, fieldErrors, fmtKg, fmtNum, inputClass, isUncertain, jobWorkError, newClientToken, Notice } from "./job-work-common";

/**
 * "Continue production with what's back": completes the planned route step
 * now (e.g. printing at the job worker) so the next in-house step can start
 * on the material already received. The order stays open for the rest.
 */
export function ReleaseStepDialog({ order, open, onOpenChange }: { order: JobWorkOrderDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-lg">{open ? <ReleaseForm order={order} onDone={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function ReleaseForm({ order, onDone }: { order: JobWorkOrderDetail; onDone: () => void }) {
  const qc = useQueryClient();
  const route = order.route_step;
  const progress = route?.progress ?? null;
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(Boolean(progress?.short));
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<{ client_token: string; step_force_reason?: string } | null>(null);
  const next = route?.next_jobs ?? [];
  const job = order.production_job;
  const output = order.totals.output_pcs ? `${fmtNum(order.totals.output_pcs)} pcs (${fmtKg(order.totals.output_kg)})` : fmtKg(order.totals.output_kg);

  const mutation = useMutation({
    mutationFn: (payload: { client_token: string; step_force_reason?: string }): Promise<JobWorkActionResult> => jobWorkApi.releaseStep(order.id, payload),
    onSuccess: (result) => {
      frozen.current = null;
      qc.setQueryData(["jobwork", "detail", order.id], result.order);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      toast.success(`Production continues on ${order.production_job?.job_number ?? "the job"}${result.replayed ? " (already saved)" : ""}.`);
      if (result.step?.detail) toast.message(result.step.detail);
      onDone();
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      if (fieldErrors(error).step_force_reason) setNeedReason(true);
      setFailure(jobWorkError(error, "Nothing was changed."));
    },
  });

  const submit = () => {
    if (needReason && reason.trim().length < 3) {
      setFailure("The step is short of its target. Give the reason production continues with less.");
      return;
    }
    setFailure(null);
    const payload = frozen.current ?? { client_token: newClientToken(), ...(reason.trim() ? { step_force_reason: reason.trim() } : {}) };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Continue production with what&apos;s back</DialogTitle>
        <DialogDescription>
          {order.number} · {route?.label ?? "route step"} of job {job?.job_number}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-[13px] leading-relaxed text-content-2">
        {failure ? <ErrorBanner message={failure} /> : null}
        {pendingRetry ? <p className="text-[12.5px] text-content-3">The last attempt may have reached the server; confirming again resends the same request.</p> : null}
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {route?.label ? `${route.label[0].toUpperCase()}${route.label.slice(1)}` : "The route step"} of job <span className="font-mono">{job?.job_number}</span> is completed now with what came back: {output}.
          </li>
          <li>
            {next.length ? (
              <>
                Job <span className="font-mono">{next[0].job_number}</span> ({next[0].process_name || `step ${next[0].step_number}`}) is released{next[0].work_center_name ? ` to ${next[0].work_center_name}` : ""} and can start on the material already received.
              </>
            ) : (
              "The next route step is released for the planner and work-centre manager."
            )}
          </li>
          <li>
            The order stays open: {fmtKg(order.at_vendor.kg)} in {order.at_vendor.lines} line{order.at_vendor.lines === 1 ? "" : "s"} is still at {order.vendor_name}. Receive it here as it comes; it goes straight to the next step. Closing the order later does not complete the step again.
          </li>
          <li>Nothing is consumed from WIP: material the job worker used is settled by this order.</li>
        </ul>
        {progress ? (
          <Notice tone={progress.short ? "warn" : "info"} title={progress.short ? "Short of the step target" : "Step target met"}>
            Step output so far {fmtNum(progress.produced)} of {fmtNum(progress.target)} {progress.uom.toLowerCase()}
            {progress.short ? ` — ${fmtNum(progress.remaining)} ${progress.uom.toLowerCase()} short.` : "."}
          </Notice>
        ) : null}
        {needReason ? (
          <Field label="Why production continues with less (recorded on the job and the order)" htmlFor="jw-release-reason">
            <input id="jw-release-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Pouching starts with the first printed lot" className={inputClass} autoFocus />
          </Field>
        ) : null}
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Back
        </Button>
        <Button type="button" onClick={submit} disabled={mutation.isPending} data-testid="jobwork-release-step-confirm">
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <FastForward />}
          {pendingRetry ? "Retry" : "Continue production"}
        </Button>
      </DialogFooter>
    </>
  );
}
