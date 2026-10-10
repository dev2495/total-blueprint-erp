"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jobWorkApi, type JobWorkActionResult, type JobWorkOrderDetail } from "@/services/job-work";

import { ErrorBanner, Field, fieldErrors, fmtKg, inputClass, isUncertain, jobWorkError, newClientToken, Notice } from "./job-work-common";

export type CloseKind = "close" | "short-close" | "cancel";

const COPY: Record<CloseKind, { title: string; button: string; done: string }> = {
  close: { title: "Close order", button: "Close order", done: "closed" },
  "short-close": { title: "Close short", button: "Close short and write off", done: "closed short" },
  cancel: { title: "Cancel draft", button: "Cancel draft", done: "cancelled" },
};

/** Close (nothing at the vendor), short-close (write off the rest, reason) or cancel a draft. */
export function CloseDialog({ order, kind, onOpenChange }: { order: JobWorkOrderDetail; kind: CloseKind | null; onOpenChange: (kind: CloseKind | null) => void }) {
  return (
    <Dialog open={Boolean(kind)} onOpenChange={(open) => !open && onOpenChange(null)}>
      <DialogContent className="w-[calc(100vw-24px)] max-w-lg">
        {kind ? <CloseForm key={kind} order={order} kind={kind} onDone={() => onOpenChange(null)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({ order, kind, onDone }: { order: JobWorkOrderDetail; kind: CloseKind; onDone: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [stepReason, setStepReason] = useState("");
  const [needStepReason, setNeedStepReason] = useState(false);
  const [needVarianceReason, setNeedVarianceReason] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<Record<string, string> | null>(null);
  const copy = COPY[kind];
  const planned = order.mode === "PLANNED_STEP" && order.production_job;
  const stepDone = Boolean(order.step_release) || order.route_step?.position === "PAST";
  const totals = order.totals;
  const varianceOver = totals.variance_pct !== null && Math.abs(Number(totals.variance_pct)) > Number(totals.tolerance_pct) && !totals.variance_reason_recorded;

  const mutation = useMutation({
    mutationFn: (payload: Record<string, string>): Promise<JobWorkActionResult> => {
      if (kind === "close") return jobWorkApi.close(order.id, payload as { client_token: string });
      if (kind === "short-close") return jobWorkApi.shortClose(order.id, payload as { client_token: string; reason: string });
      return jobWorkApi.cancel(order.id, payload as { client_token: string; reason: string });
    },
    onSuccess: (result) => {
      frozen.current = null;
      qc.setQueryData(["jobwork", "detail", order.id], result.order);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      toast.success(`${order.number} ${copy.done}${result.replayed ? " (already saved)" : ""}.`);
      if (result.step?.detail) toast.message(result.step.detail);
      onDone();
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      const fields = fieldErrors(error);
      if (fields.step_force_reason) setNeedStepReason(true);
      if (fields.variance_reason) setNeedVarianceReason(true);
      setFailure(jobWorkError(error, "The order was not changed."));
    },
  });

  const submit = () => {
    if ((kind === "short-close" && reason.trim().length < 5) || (kind === "cancel" && reason.trim().length < 3)) {
      setFailure(kind === "short-close" ? "Explain why the order closes short (at least 5 characters)." : "Say why the draft is cancelled.");
      return;
    }
    if ((varianceOver || needVarianceReason) && kind === "close" && !varianceReason.trim()) {
      setFailure("Explain the material-balance difference to close.");
      return;
    }
    setFailure(null);
    const payload =
      frozen.current ??
      Object.fromEntries(
        Object.entries({
          client_token: newClientToken(),
          reason: kind === "close" ? "" : reason.trim(),
          variance_reason: kind === "close" ? varianceReason.trim() : "",
          step_force_reason: kind === "cancel" ? "" : stepReason.trim(),
        }).filter(([, value]) => value !== ""),
      );
    frozen.current = payload;
    mutation.mutate(payload);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {copy.title} · {order.number}
        </DialogTitle>
        <DialogDescription>
          {kind === "close"
            ? "Nothing is left at the job worker. Closing locks the order."
            : kind === "short-close"
              ? `${fmtKg(order.at_vendor.kg)} in ${order.at_vendor.lines} line(s) is still at the job worker. Closing short writes it off (it leaves stock at JOBWORK_OUT) with your reason.`
              : "Nothing was sent on this draft. Cancelling keeps it for the record."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {failure ? <ErrorBanner message={failure} /> : null}
        {pendingRetry ? <p className="text-[12.5px] text-content-3">The last attempt may have reached the server; confirming again resends the same request.</p> : null}
        {planned && kind !== "cancel" && stepDone ? (
          <Notice tone="info">
            {order.step_release
              ? `Route step ${order.route_step?.number ?? ""} of job ${order.production_job?.job_number} was completed when production continued with what was back. ${kind === "close" ? "Closing" : "Closing short"} only finishes this order; the job is not changed again.`
              : `${order.route_step?.position_detail ?? "The route step is already completed."} ${kind === "close" ? "Closing" : "Closing short"} only finishes this order.`}
          </Notice>
        ) : planned && kind !== "cancel" ? (
          <Notice tone="info">
            This is the planned route step of job {order.production_job?.job_number}. {kind === "close" ? "Closing" : "Closing short"} completes that step as you, so the job continues to its next step.
          </Notice>
        ) : order.production_job && kind !== "cancel" ? (
          <Notice tone="info">Job {order.production_job.job_number} is released from its job-work hold.</Notice>
        ) : null}
        {kind !== "close" ? (
          <Field label="Reason" htmlFor="jw-close-reason">
            <input id="jw-close-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "short-close" ? "e.g. Vendor fire; 2 rolls destroyed" : "e.g. Machine repaired; doing it in-house"} className={inputClass} />
          </Field>
        ) : null}
        {kind === "close" && (varianceOver || needVarianceReason) ? (
          <Field label={`Material balance is off by ${fmtKg(totals.variance_kg)} (${totals.variance_pct}%) — why?`} htmlFor="jw-close-var">
            <input id="jw-close-var" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} className={inputClass} />
          </Field>
        ) : null}
        {needStepReason && kind !== "cancel" && !stepDone ? (
          <Field label="The job is short of its step target — reason to complete it anyway" htmlFor="jw-close-step">
            <input id="jw-close-step" value={stepReason} onChange={(e) => setStepReason(e.target.value)} placeholder="e.g. Customer accepted 23,000 pcs" className={inputClass} />
          </Field>
        ) : null}
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Back
        </Button>
        <Button type="button" variant={kind === "close" ? "default" : "destructive"} onClick={submit} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
          {copy.button}
        </Button>
      </DialogFooter>
    </>
  );
}
