"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Clock3, DoorOpen, LogIn, LogOut, Phone, UserRound, UserX } from "lucide-react";

import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gateApi, type GateVisitor } from "@/services/gate";
import { gateElapsed, gateMinutesSince, gateTime, VISITOR_STATUS_META } from "./gate-format";
import { GateAction, GateSheet, OperationBanner, TonePill } from "./gate-ui";
import { useGateOperation } from "./use-gate-operation";

/** Matches backend summary_for_period overdue rule (inside > 12h). */
export const OVERDUE_INSIDE_MINUTES = 12 * 60;
/** Backend presets for cancelling a PENDING visitor (contract: visitors/<id>/cancel/). */
export const NOT_ADMITTED_REASONS = ["Visitor left", "Entry declined", "Duplicate / mistaken registration", "Visit cancelled"];

/** Private selfie: fetched with the staff session, held only as an object URL in memory. */
export function useVisitorSelfie(visitor: Pick<GateVisitor, "id" | "has_selfie"> | null, enabled = true) {
  const [url, setUrl] = useState<string | null>(null);
  const id = visitor?.id;
  const has = Boolean(visitor?.has_selfie);
  useEffect(() => {
    if (!enabled || !id || !has) return;
    let revoked = false;
    let objectUrl: string | null = null;
    gateApi
      .selfieObjectUrl(id)
      .then((created) => {
        if (revoked) {
          URL.revokeObjectURL(created);
          return;
        }
        objectUrl = created;
        setUrl(created);
      })
      .catch(() => setUrl(null));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [id, has, enabled]);
  return url;
}

function Portrait({ visitor, size = 56 }: { visitor: GateVisitor; size?: number }) {
  const url = useVisitorSelfie(visitor);
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-2 text-content-4"
      style={{ width: size, height: size }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Photo of ${visitor.name}`} className="h-full w-full object-cover" />
      ) : (
        <UserRound style={{ width: size * 0.45, height: size * 0.45 }} />
      )}
    </div>
  );
}

export function invalidateVisitorQueues(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["gate", "visitors"] }),
    qc.invalidateQueries({ queryKey: ["gate", "summary"] }),
  ]);
}

/**
 * A visitor pass: identity on the left of the perforation, time and the one
 * next action on the right. The action available is decided by status only,
 * so an exited pass can never offer "check out" again.
 */
export function VisitorPass({ visitor: incoming, now }: { visitor: GateVisitor; now: number }) {
  const [sheet, setSheet] = useState<null | "in" | "out" | "cancel">(null);
  // Adopt the server's answer at once so a completed step is never offered again.
  const [visitor, setVisitor] = useState(incoming);
  useEffect(() => setVisitor(incoming), [incoming]);
  const meta = VISITOR_STATUS_META[visitor.status] ?? VISITOR_STATUS_META.PENDING;
  const insideMinutes = gateMinutesSince(visitor.entry_at, now);
  const overdue = visitor.status === "INSIDE" && insideMinutes >= OVERDUE_INSIDE_MINUTES;

  return (
    <article className="gate-card gate-rise overflow-hidden">
      <div className="flex">
        <div className="flex min-w-0 flex-1 gap-3 p-4">
          <Portrait visitor={visitor} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold text-content-1">{visitor.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-content-3">
              <Phone className="h-3.5 w-3.5" />
              <span className="gate-num font-mono">{visitor.mobile}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-content-2">
              <span className="font-medium">{visitor.purpose}</span>
              {visitor.company ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-content-3">
                  <Building2 className="h-3.5 w-3.5" />
                  <span className="truncate">{visitor.company}</span>
                </span>
              ) : null}
            </div>
            {visitor.government_id_masked ? (
              <div className="mt-1 font-mono text-[12px] text-content-4">ID {visitor.government_id_masked}</div>
            ) : null}
          </div>
        </div>
        <div className="gate-pass__perf flex w-[112px] shrink-0 flex-col items-end justify-between p-4 text-right">
          <TonePill
            label={overdue ? "Overdue" : meta.label}
            tone={overdue ? "var(--gate-alert)" : meta.tone}
            soft={overdue ? "var(--gate-alert-soft)" : meta.soft}
            edge={overdue ? "var(--gate-alert-edge)" : meta.edge}
            dot
          />
          <div className="mt-2">
            {visitor.status === "PENDING" ? (
              <>
                <div className="gate-num text-[20px] font-semibold leading-none text-content-1">{gateElapsed(visitor.submitted_at, null, now)}</div>
                <div className="mt-1 text-[11px] leading-tight text-content-4">waiting<br />since {gateTime(visitor.submitted_at)}</div>
              </>
            ) : visitor.status === "INSIDE" ? (
              <>
                <div
                  className="gate-num text-[20px] font-semibold leading-none"
                  style={{ color: overdue ? "var(--gate-alert)" : "var(--content-1)" }}
                >
                  {gateElapsed(visitor.entry_at, null, now)}
                </div>
                <div className="mt-1 text-[11px] leading-tight text-content-4">inside<br />since {gateTime(visitor.entry_at)}</div>
              </>
            ) : (
              <>
                <div className="gate-num text-[15px] font-semibold text-content-2">{gateTime(visitor.exit_at || visitor.entry_at)}</div>
                <div className="mt-1 text-[11px] text-content-4">{gateElapsed(visitor.entry_at, visitor.exit_at, now)} inside</div>
              </>
            )}
          </div>
        </div>
      </div>

      {visitor.status === "PENDING" ? (
        <div className="grid grid-cols-[1fr_auto] gap-2 border-t border-line p-3">
          <GateAction tone="inside" size="md" onClick={() => setSheet("in")}>
            <LogIn className="h-5 w-5" /> Admit
          </GateAction>
          <GateAction tone="plain" size="md" onClick={() => setSheet("cancel")} aria-label={`Mark ${visitor.name} not admitted`}>
            <UserX className="h-5 w-5" /> Not admitted
          </GateAction>
        </div>
      ) : visitor.status === "INSIDE" ? (
        <div className="border-t border-line p-3">
          <GateAction tone="ink" size="md" className="w-full" onClick={() => setSheet("out")}>
            <LogOut className="h-5 w-5" /> Check out
          </GateAction>
        </div>
      ) : null}

      <VisitorActionSheet visitor={visitor} mode={sheet} onClose={() => setSheet(null)} onSaved={setVisitor} />
    </article>
  );
}

function VisitorActionSheet({
  visitor,
  mode,
  onClose,
  onSaved,
}: {
  visitor: GateVisitor;
  mode: null | "in" | "out" | "cancel";
  onClose: () => void;
  onSaved: (visitor: GateVisitor) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState(NOT_ADMITTED_REASONS[0]);
  const op = useGateOperation<{ action: "in" | "out" | "cancel"; reason?: string }, GateVisitor>({
    send: ({ action, reason: why, client_token }) =>
      action === "in"
        ? gateApi.checkIn(visitor.id, client_token)
        : action === "out"
          ? gateApi.checkOut(visitor.id, client_token)
          : gateApi.cancelVisitor(visitor.id, client_token, why || NOT_ADMITTED_REASONS[0]),
    onSaved: (result) => {
      if (result && typeof result === "object" && "status" in result) {
        onSaved({ ...visitor, ...result });
        const verb = result.status === "INSIDE" ? `admitted at ${gateTime(result.entry_at)}` : result.status === "EXITED" ? `checked out at ${gateTime(result.exit_at)}` : "marked not admitted";
        toast.success(`${result.name || visitor.name} ${verb}`, { description: "Saved to the gate register (server time)." });
      }
      return invalidateVisitorQueues(qc);
    },
  });

  // A 409 means another phone already moved this visitor: refresh the queue.
  const conflict = op.phase === "rejected" && getApiErrorStatus(op.error) === 409;
  useEffect(() => {
    if (conflict) void invalidateVisitorQueues(qc).catch(() => undefined);
  }, [conflict, qc]);

  const open = mode !== null;
  const close = () => {
    if (op.phase === "sending") return;
    if (op.phase === "uncertain") return; // must resolve: retry or verify
    op.reset();
    onClose();
  };

  const saved = op.phase === "saved" ? op.result : null;
  const title = mode === "in" ? "Admit visitor?" : mode === "out" ? "Check out visitor?" : "Not admitted";

  return (
    <GateSheet open={open} onOpenChange={(next) => (!next ? close() : undefined)} title={saved ? "Recorded" : title}>
      {saved ? (
        <div className="gate-rise py-2 text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: "var(--gate-inside-soft)", color: "var(--gate-inside)" }}
          >
            <DoorOpen className="h-8 w-8" />
          </div>
          <div className="mt-3 text-[18px] font-semibold text-content-1">{saved.name}</div>
          <p className="mt-1 text-[15px] text-content-2">
            {saved.status === "INSIDE"
              ? `Admitted at ${gateTime(saved.entry_at)}`
              : saved.status === "EXITED"
                ? `Checked out at ${gateTime(saved.exit_at)}`
                : "Marked not admitted"}
          </p>
          <p className="mt-1 text-[12px] text-content-4">Server time · saved to the gate register</p>
          <GateAction tone="in" className="mt-5 w-full" onClick={close}>
            Done
          </GateAction>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            <Portrait visitor={visitor} size={72} />
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold text-content-1">{visitor.name}</div>
              <div className="gate-num font-mono text-[13px] text-content-3">{visitor.mobile}</div>
              <div className="text-[13px] text-content-2">
                {visitor.purpose}
                {visitor.company ? ` · ${visitor.company}` : ""}
              </div>
            </div>
          </div>

          {mode === "out" ? (
            <div className="flex items-center gap-2 rounded-2xl border border-line px-4 py-3 text-[14px] text-content-2">
              <Clock3 className="h-4 w-4 text-content-4" /> Inside since {gateTime(visitor.entry_at)} · {gateElapsed(visitor.entry_at)}
            </div>
          ) : null}

          {mode === "in" ? (
            <p className="text-[14px] text-content-3">Check the face against the photo. Entry time is stamped by the server.</p>
          ) : null}

          {mode === "cancel" ? (
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-content-2">Reason</legend>
              <div className="grid gap-2">
                {NOT_ADMITTED_REASONS.map((preset) => (
                  <label
                    key={preset}
                    className={cn(
                      "gate-press flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border px-4 text-[15px]",
                      reason === preset ? "border-[var(--gate-ink-2)] font-semibold text-content-1" : "border-line text-content-2",
                    )}
                  >
                    <input
                      type="radio"
                      name={`reason-${visitor.id}`}
                      value={preset}
                      checked={reason === preset}
                      onChange={() => setReason(preset)}
                      disabled={op.locked}
                      className="h-5 w-5 accent-[var(--gate-ink-2)]"
                    />
                    {preset}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {conflict ? (
            <div className="rounded-2xl border p-4 text-[14px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)" }}>
              Already updated from another phone. The list has been refreshed.
            </div>
          ) : (
            <OperationBanner
              phase={op.phase}
              error={op.error}
              onRetry={() => void op.retry()}
              uncertainHint="Retrying sends the same action and cannot record it twice."
            />
          )}

          {conflict ? (
            <GateAction tone="plain" className="w-full" onClick={close}>
              Close
            </GateAction>
          ) : op.phase !== "uncertain" ? (
            <GateAction
              tone={mode === "in" ? "inside" : mode === "out" ? "ink" : "alert"}
              className="w-full"
              busy={op.phase === "sending"}
              onClick={() => void op.submit({ action: mode ?? "in", reason: mode === "cancel" ? reason : undefined })}
            >
              {mode === "in" ? (
                <>
                  <LogIn className="h-5 w-5" /> Admit now
                </>
              ) : mode === "out" ? (
                <>
                  <LogOut className="h-5 w-5" /> Confirm check out
                </>
              ) : (
                <>
                  <UserX className="h-5 w-5" /> Remove from queue
                </>
              )}
            </GateAction>
          ) : null}
        </div>
      )}
    </GateSheet>
  );
}
