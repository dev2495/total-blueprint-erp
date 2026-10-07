"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock3, Loader2, QrCode, ShieldCheck } from "lucide-react";

import { isValidGateToken, publicGateApi, PublicGateError, type PublicGateConfig, type PublicVisitorReceipt } from "@/services/gate";
import { GateAction } from "./gate-ui";
import { gateTime } from "./gate-format";
import { VisitorForm, type VisitorDraft } from "./visitor-form";
import { useGateOperation } from "./use-gate-operation";

const FALLBACK_PURPOSES = ["Meeting", "Delivery", "Collection", "Service / maintenance", "Interview", "Official visit", "Other"];

/**
 * Public QR self-registration. No login, no ERP chrome, nothing persisted in
 * the browser. Submitting records the visitor's entry (server time); the
 * watchman confirms the exit when they leave.
 */
export function PublicVisitorRegistration({ token }: { token: string }) {
  const validToken = isValidGateToken(token);
  const [config, setConfig] = useState<PublicGateConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!validToken) return;
    const controller = new AbortController();
    setConfigError(null);
    publicGateApi
      .config(token, controller.signal)
      .then(setConfig)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setConfigError(err instanceof PublicGateError ? err.message : "Could not reach the gate desk. Please try again.");
      });
    return () => controller.abort();
  }, [token, validToken]);

  const op = useGateOperation<VisitorDraft, PublicVisitorReceipt>({
    send: (payload) => publicGateApi.submit(token, payload),
  });

  const plantName = config?.plant_name;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col">
      <header className="px-5 pb-6 pt-[max(20px,env(safe-area-inset-top))] text-[var(--text-on-dark)]" style={{ background: "var(--gate-ink)" }}>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/tpp-logo-mark.svg" alt="" className="h-full w-full object-contain" />
          </span>
          <div className="leading-tight">
            <div className="text-[17px] font-semibold tracking-[-0.01em]">{config?.company_name || "Total Poly Print"}</div>
            <div className="text-[13px]" style={{ color: "var(--gate-ink-muted)" }}>
              {plantName ? `${plantName} · Visitor gate` : "Visitor gate"}
            </div>
          </div>
        </div>
        <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em] [text-wrap:balance]">
          {op.phase === "saved" ? (op.result?.status === "INSIDE" ? "Entry recorded" : "Registration received") : "Register your visit"}
        </h1>
        {op.phase !== "saved" ? (
          <p className="mt-1 text-[14px]" style={{ color: "var(--gate-ink-muted)" }}>
            Takes about a minute. Your entry is recorded when you submit; the watchman confirms your exit.
          </p>
        ) : null}
      </header>

      <main className="-mt-3 flex-1 rounded-t-[22px] bg-[var(--gate-canvas)] px-4 pb-10 pt-5">
        {!validToken ? (
          <Notice
            icon={<QrCode className="h-7 w-7" />}
            title="Scan the gate QR code"
            body="This link is incomplete. Please rescan the QR code displayed at this factory's gate, or ask the watchman for the correct gate QR."
          />
        ) : configError ? (
          <Notice icon={<QrCode className="h-7 w-7" />} title="Gate link not available" body={configError} />
        ) : !config ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[15px] text-content-3">
            <Loader2 className="h-5 w-5 animate-spin" /> Opening visitor form…
          </div>
        ) : op.phase === "saved" && op.result ? (
          <WaitingCard
            receipt={op.result}
            onAnother={() => {
              op.reset();
              setFormKey((k) => k + 1);
              window.scrollTo({ top: 0 });
            }}
          />
        ) : (
          <div className="gate-card p-4">
            <VisitorForm
              key={formKey}
              audience="visitor"
              purposes={config.purposes?.length ? config.purposes : FALLBACK_PURPOSES}
              governmentIdEnabled={config.government_id_enabled !== false}
              privacyNote={config.privacy_note}
              phase={op.phase}
              error={op.error}
              onSubmit={(draft) => void op.submit(draft)}
              onRetry={() => void op.retry()}
              submitLabel="Record my entry"
            />
          </div>
        )}
        <p className="mt-5 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-content-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Your details are used only for this factory&apos;s visitor register and gate security. Nothing is saved on this phone.
        </p>
      </main>
    </div>
  );
}

/** Times shown here come only from the server receipt — never the phone's clock. */
function WaitingCard({ receipt, onAnother }: { receipt: PublicVisitorReceipt; onAnother: () => void }) {
  const inside = receipt.status === "INSIDE";
  const tone = inside ? "var(--gate-inside)" : "var(--gate-pending)";
  return (
    <div className="gate-card gate-rise overflow-hidden text-center">
      <div className="px-5 pb-6 pt-7" style={{ background: inside ? "var(--gate-inside-soft)" : "var(--gate-pending-soft)" }}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-1" style={{ color: tone }}>
          {inside ? <CheckCircle2 className="h-9 w-9" /> : <Clock3 className="h-8 w-8" />}
        </div>
        <div
          className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: tone, borderColor: inside ? "var(--gate-inside-edge)" : "var(--gate-pending-edge)", background: "var(--surface-1)" }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: tone }} />
          {inside ? "Entry recorded" : "Received"}
        </div>
        <p className="mx-auto mt-3 max-w-[320px] text-[16px] leading-relaxed text-content-1 [text-wrap:pretty]">
          {inside
            ? "Your entry is recorded. When you leave, the watchman will confirm your exit at the gate."
            : receipt.message || "Your registration has reached the gate. Please show this screen to the watchman."}
        </p>
      </div>
      <div className="space-y-1 px-5 py-4 text-[14px]">
        <div className="flex justify-between">
          <span className="text-content-3">Reference</span>
          <span className="font-mono font-semibold text-content-1">{String(receipt.receipt_id || "").slice(0, 8).toUpperCase()}</span>
        </div>
        {inside ? (
          <div className="flex justify-between">
            <span className="text-content-3">Entry time</span>
            <span className="gate-num font-semibold text-content-1">{gateTime(receipt.entry_at)}</span>
          </div>
        ) : null}
        {receipt.replayed ? <p className="pt-1 text-[12px] text-content-4">This registration was already recorded — no duplicate was created.</p> : null}
      </div>
      <div className="px-5 pb-5">
        <GateAction tone="plain" className="w-full" onClick={onAnother}>
          Register another person
        </GateAction>
      </div>
    </div>
  );
}

function Notice({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="gate-card p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-2 text-content-3">{icon}</div>
      <h2 className="mt-3 text-[19px] font-semibold text-content-1">{title}</h2>
      <p className="mt-1 text-[15px] leading-relaxed text-content-3">{body}</p>
    </div>
  );
}
