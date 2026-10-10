"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGateOperation } from "@/components/gate/use-gate-operation";

import { ActionFeedback } from "./document-rights";

/**
 * Confirmation with a mandatory written reason (≥ 5 characters), sent once
 * with a frozen client token; an uncertain failure resends the same action.
 */
export function ReasonDialog<R>({
  open,
  onOpenChange,
  title,
  description,
  label = "Reason",
  placeholder,
  confirmLabel,
  destructive,
  minLength = 5,
  onSubmit,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  minLength?: number;
  onSubmit: (payload: { client_token: string; reason: string }) => Promise<R>;
  onDone: (result: R) => void;
}) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const op = useGateOperation<{ reason: string }, R>({ send: (payload) => onSubmit(payload) });
  const { reset } = op;
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (open) {
      setReason("");
      handled.current = null;
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (op.phase === "saved" && op.result !== null && handled.current !== op.result) {
      handled.current = op.result;
      onDone(op.result);
      onOpenChange(false);
    }
  }, [op.phase, op.result, onDone, onOpenChange]);

  const valid = reason.trim().length >= minLength;
  return (
    <Dialog open={open} onOpenChange={(next) => (op.locked ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !op.locked) void op.submit({ reason: reason.trim() });
          }}
        >
          <label htmlFor={fieldId} className="block text-[13px] font-semibold text-content-2">
            {label}
          </label>
          <textarea
            id={fieldId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={op.locked}
            rows={3}
            maxLength={500}
            placeholder={placeholder}
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border"
            aria-describedby={`${fieldId}-hint`}
          />
          <p id={`${fieldId}-hint`} className="text-[12px] text-content-3">
            At least {minLength} characters. Kept permanently in the audit trail.
          </p>
          <ActionFeedback phase={op.phase} error={op.error} onRetry={() => void op.retry()} onRelease={op.release} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={op.locked} onClick={() => onOpenChange(false)}>
              Keep as is
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!valid || op.locked}>
              {op.phase === "sending" ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
