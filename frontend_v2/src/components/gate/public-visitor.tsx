"use client";

import { useEffect, useState } from "react";
import { Clock3, Loader2, QrCode, ShieldCheck } from "lucide-react";

import { isValidGateToken, publicGateApi, PublicGateError, type PublicGateConfig, type PublicVisitorReceipt } from "@/services/gate";
import { GateAction } from "./gate-ui";
import { gateTime } from "./gate-format";
import { VisitorForm, type VisitorDraft } from "./visitor-form";
import { useGateOperation } from "./use-gate-operation";

const FALLBACK_PURPOSES = ["Meeting", "Delivery", "Collection", "Service / maintenance", "Interview", "Official visit", "Other"];

/**
 * Public QR self-registration. No login, no ERP chrome, nothing persisted in
 * the browser. Submitting creates a PENDING request only — the visitor can
 * never admit themselves; the watchman does that at the gate.
 */
export function PublicVisitorRegistration({ token }: { token: string }) {
  const validToken = isValidGateToken(token);
  const [config, setConfig] = useState<PublicGateConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);

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
    onSaved: () => setSavedAt(new Date().toISOString()),
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
          {op.phase === "saved" ? "Please wait at the gate" : "Register your visit"}
        </h1>
        {op.phase !== "saved" ? (
          <p className="mt-1 text-[14px]" style={{ color: "var(--gate-ink-muted)" }}>
            Takes about a minute. The watchman confirms your entry.
          </p>
        ) : null}
      </header>

      <main className="-mt-3 flex-1 rounded-t-[22px] bg-[var(--gate-canvas)] px-4 pb-10 pt-5">
        {!validToken ? (
          <Notice
            icon={<QrCode className="h-7 w-7" />}
            title="Scan the gate QR code"
            body="This link is incomplete. Please scan the QR code displayed at the factory gate, or ask the watchman to register you."
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
            submittedAt={savedAt}
            onAnother={() => {
              op.reset();
              setSavedAt(null);
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
              submitLabel="Send to watchman"
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

function WaitingCard({ receipt, submittedAt, onAnother }: { receipt: PublicVisitorReceipt; submittedAt: string | null; onAnother: () => void }) {
  return (
    <div className="gate-card gate-rise overflow-hidden text-center">
      <div className="px-5 pb-6 pt-7" style={{ background: "var(--gate-pending-soft)" }}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-1" style={{ color: "var(--gate-pending)" }}>
          <Clock3 className="h-8 w-8" />
        </div>
        <div className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--gate-pending)", borderColor: "var(--gate-pending-edge)", background: "var(--surface-1)" }}>
          <span className="gate-pulse h-2 w-2 rounded-full" style={{ background: "var(--gate-pending)" }} />
          Waiting for watchman
        </div>
        <p className="mx-auto mt-3 max-w-[320px] text-[16px] leading-relaxed text-content-1 [text-wrap:pretty]">
          {receipt.message || "Your request has reached the gate. You are not admitted yet — the watchman will check and let you in."}
        </p>
      </div>
      <div className="space-y-1 px-5 py-4 text-[14px]">
        <div className="flex justify-between">
          <span className="text-content-3">Request</span>
          <span className="font-mono font-semibold text-content-1">{String(receipt.receipt_id || "").slice(0, 8).toUpperCase()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-content-3">Sent</span>
          <span className="gate-num font-semibold text-content-1">{gateTime(submittedAt)}</span>
        </div>
        {receipt.replayed ? <p className="pt-1 text-[12px] text-content-4">This request was already received — no duplicate was created.</p> : null}
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
