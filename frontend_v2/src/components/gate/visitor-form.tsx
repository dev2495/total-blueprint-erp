"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GovernmentIdType, VisitorPayload } from "@/services/gate";
import { isValidMobile, normalizeMobile } from "./gate-format";
import { FieldError, FieldLabel, GateAction, OperationBanner } from "./gate-ui";
import { SelfieCapture } from "./selfie-capture";
import { GATE_ID_STORAGE_UNAVAILABLE, gateErrorCode, gateFieldErrors, type GateOperationPhase } from "./use-gate-operation";

export type VisitorDraft = Omit<VisitorPayload, "client_token">;

type IdChoice = "" | GovernmentIdType;

const ID_CHOICES: Array<{ value: IdChoice; label: string }> = [
  { value: "", label: "None" },
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN" },
  { value: "OTHER", label: "Other" },
];

function validate(draft: { name: string; mobile: string; purpose: string; idType: IdChoice; idNumber: string; consent: boolean; you: boolean }) {
  const errors: Record<string, string> = {};
  if (draft.name.trim().length < 2) errors.name = draft.you ? "Enter your full name." : "Enter the visitor's full name.";
  if (!isValidMobile(draft.mobile)) errors.mobile = "Enter a 10-digit mobile number.";
  if (!draft.purpose) errors.purpose = "Choose the purpose of the visit.";
  if (draft.idType) {
    const raw = draft.idNumber.replace(/\s+/g, "");
    if (!raw) errors.government_id_number = "Enter the ID number, or choose None.";
    else if (draft.idType === "AADHAAR" && !/^[0-9]{12}$/.test(raw)) errors.government_id_number = "Aadhaar has 12 digits.";
    else if (draft.idType === "PAN" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(raw.toUpperCase())) errors.government_id_number = "PAN looks like ABCDE1234F.";
  }
  if (!draft.consent) errors.consent = "Consent is needed to record the visit.";
  return errors;
}

/**
 * Shared visitor details form (public QR self-registration and watchman
 * walk-in). It never stores anything outside React state.
 */
export function VisitorForm({
  purposes,
  governmentIdEnabled = true,
  privacyNote,
  phase,
  error,
  onSubmit,
  onRetry,
  submitLabel,
  audience,
}: {
  purposes: string[];
  governmentIdEnabled?: boolean;
  privacyNote?: string | null;
  phase: GateOperationPhase;
  error: unknown;
  onSubmit: (draft: VisitorDraft) => void;
  onRetry: () => void;
  submitLabel: string;
  audience: "visitor" | "watchman";
}) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [purpose, setPurpose] = useState("");
  const [company, setCompany] = useState("");
  const [idType, setIdType] = useState<IdChoice>("");
  const [idNumber, setIdNumber] = useState("");
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);

  const locked = phase === "sending" || phase === "uncertain";
  const you = audience === "visitor";
  const localErrors = validate({ name, mobile, purpose, idType, idNumber, consent, you });
  const serverErrors: Record<string, string> = phase === "rejected" ? { ...gateFieldErrors(error) } : {};
  if (phase === "rejected" && gateErrorCode(error) === GATE_ID_STORAGE_UNAVAILABLE) {
    serverErrors.government_id_number = "ID storage is off right now. Choose None and submit — everything else is kept.";
  }
  const errorFor = (key: string) => (touched ? localErrors[key] : undefined) || serverErrors[key];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (locked || Object.keys(localErrors).length) return;
    onSubmit({
      name: name.trim(),
      mobile: normalizeMobile(mobile),
      purpose,
      company: company.trim() || undefined,
      government_id_type: idType || undefined,
      government_id_number: idType ? idNumber.replace(/\s+/g, "").toUpperCase() : undefined,
      consent,
      selfie,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={locked} className="space-y-5">
        <div>
          <FieldLabel required>{you ? "Your name" : "Visitor name"}</FieldLabel>
          <input
            className="gate-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete={you ? "name" : "off"}
            autoCapitalize="words"
            enterKeyHint="next"
            maxLength={120}
            aria-invalid={Boolean(errorFor("name")) || undefined}
            placeholder="Full name"
          />
          <FieldError message={errorFor("name")} />
        </div>

        <div>
          <FieldLabel required>Mobile number</FieldLabel>
          <div className="flex items-stretch gap-2">
            <span className="flex min-h-[52px] items-center rounded-xl bg-surface-2 px-3 font-mono text-[16px] font-semibold text-content-3">+91</span>
            <input
              className="gate-field gate-num font-mono tracking-[0.04em]"
              value={mobile}
              onChange={(e) => setMobile(normalizeMobile(e.target.value))}
              inputMode="numeric"
              type="tel"
              autoComplete={you ? "tel-national" : "off"}
              enterKeyHint="next"
              placeholder="98765 43210"
              aria-invalid={Boolean(errorFor("mobile")) || undefined}
            />
          </div>
          <FieldError message={errorFor("mobile")} />
        </div>

        <div>
          <FieldLabel required>Purpose</FieldLabel>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Purpose of visit">
            {purposes.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={purpose === option}
                onClick={() => setPurpose(option)}
                className={cn(
                  "gate-press min-h-[48px] rounded-full border px-4 text-[15px] font-medium",
                  purpose === option
                    ? "border-transparent text-white"
                    : "border-[var(--gate-field-edge)] bg-[var(--gate-field)] text-content-2",
                )}
                style={purpose === option ? { background: "var(--gate-ink-2)" } : undefined}
              >
                {option}
              </button>
            ))}
          </div>
          <FieldError message={errorFor("purpose")} />
        </div>

        <div>
          <FieldLabel hint="Optional">Company</FieldLabel>
          <input
            className="gate-field"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            autoComplete={you ? "organization" : "off"}
            maxLength={160}
            placeholder="Company or organisation"
          />
          <FieldError message={serverErrors.company} />
        </div>

        {governmentIdEnabled ? (
          <div>
            <FieldLabel hint="Optional">Government ID</FieldLabel>
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface-2 p-1" role="radiogroup" aria-label="Government ID type">
              {ID_CHOICES.map((choice) => (
                <button
                  key={choice.label}
                  type="button"
                  role="radio"
                  aria-checked={idType === choice.value}
                  onClick={() => {
                    setIdType(choice.value);
                    setIdNumber("");
                  }}
                  className={cn(
                    "gate-press min-h-[44px] rounded-xl text-[14px] font-semibold",
                    idType === choice.value ? "bg-surface-1 text-content-1 shadow-[var(--gate-shadow)]" : "text-content-3",
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            {idType ? (
              <div className="mt-2">
                <input
                  className="gate-field font-mono tracking-[0.06em]"
                  value={idNumber}
                  onChange={(e) =>
                    setIdNumber(idType === "AADHAAR" ? e.target.value.replace(/[^0-9 ]/g, "").slice(0, 14) : e.target.value.toUpperCase().slice(0, 40))
                  }
                  inputMode={idType === "AADHAAR" ? "numeric" : "text"}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={idType === "AADHAAR" ? "12-digit Aadhaar" : idType === "PAN" ? "ABCDE1234F" : "ID number"}
                  aria-invalid={Boolean(errorFor("government_id_number")) || undefined}
                />
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-content-4">
                  <ShieldCheck className="h-3.5 w-3.5" /> Stored encrypted. Staff only see the last 4 digits.
                </p>
                <FieldError message={errorFor("government_id_number") || serverErrors.government_id_type} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <FieldLabel hint="Helps the watchman recognise you">{you ? "Selfie" : "Visitor photo"}</FieldLabel>
          <SelfieCapture value={selfie} onChange={setSelfie} disabled={locked} label={you ? "Take selfie" : "Take visitor photo"} />
          <FieldError message={serverErrors.selfie} />
        </div>

        <label
          className="flex cursor-pointer items-start gap-3 rounded-2xl border p-4"
          style={{ borderColor: errorFor("consent") ? "var(--gate-alert)" : "var(--border-default)" }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-label="I consent to this visit being recorded"
            className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--gate-in)]"
          />
          <span className="text-[14px] leading-relaxed text-content-2">
            {privacyNote ||
              (you
                ? "I agree that Total Poly Print records my name, mobile, visit purpose, photo and optional ID for factory gate security. It is used only for this site's visitor register and is not shared for marketing."
                : "The visitor agrees to Total Poly Print recording these details and photo for factory gate security only.")}
          </span>
        </label>
        <FieldError message={errorFor("consent")} />
      </fieldset>

      <OperationBanner
        phase={phase}
        error={error}
        onRetry={onRetry}
        uncertainHint="Retrying sends the same registration and cannot create a second one."
      />

      {phase !== "uncertain" ? (
        <GateAction type="submit" tone="in" className="w-full" busy={phase === "sending"}>
          {phase === "sending" ? "Sending…" : submitLabel}
        </GateAction>
      ) : null}
    </form>
  );
}
