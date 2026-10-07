"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check, Loader2, RotateCcw, Search, X } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { GateDirection } from "@/services/gate";
import { DIRECTION_META } from "./gate-format";
import { gateErrorMessage, type GateOperationPhase } from "./use-gate-operation";

export function GateMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/tpp-logo-mark.svg" alt="" aria-hidden className={cn("object-contain", className)} />;
}

export function PlateChip({ value, className }: { value?: string | null; className?: string }) {
  return (
    <span className={cn("gate-plate-chip", className)} title={value || undefined}>
      <span>{value || "—"}</span>
    </span>
  );
}

export function DirectionGlyph({ direction, className }: { direction: GateDirection; className?: string }) {
  const Icon = direction === "INWARD" ? ArrowDownLeft : ArrowUpRight;
  return <Icon className={className} style={{ color: DIRECTION_META[direction].tone }} aria-hidden />;
}

export function DirectionBadge({ direction, size = "md" }: { direction: GateDirection; size?: "sm" | "md" }) {
  const meta = DIRECTION_META[direction];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-[0.06em]",
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
      )}
      style={{ color: meta.tone, background: meta.soft, borderColor: meta.edge }}
    >
      <DirectionGlyph direction={direction} className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {meta.label}
    </span>
  );
}

export function TonePill({
  label,
  tone,
  soft,
  edge,
  dot,
  className,
}: {
  label: string;
  tone: string;
  soft: string;
  edge: string;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold", className)}
      style={{ color: tone, background: soft, borderColor: edge }}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} /> : null}
      {label}
    </span>
  );
}

export function FieldLabel({ children, hint, required }: { children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-semibold text-content-2">
        {children}
        {required ? <span className="ml-0.5 text-[var(--gate-alert)]">*</span> : null}
      </span>
      {hint ? <span className="text-[12px] text-content-4">{hint}</span> : null}
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-1.5 text-[13px] font-medium text-[var(--gate-alert)]">
      {message}
    </p>
  );
}

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
      <div>
        {eyebrow ? (
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-4">{eyebrow}</div>
        ) : null}
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-content-1">{title}</h2>
      </div>
      {action}
    </div>
  );
}

type ActionTone = "in" | "out" | "inside" | "pending" | "alert" | "ink" | "plain";

const TONE_STYLE: Record<ActionTone, React.CSSProperties> = {
  in: { background: "var(--gate-in)", color: "#fff" },
  out: { background: "var(--gate-out)", color: "#fff" },
  inside: { background: "var(--gate-inside)", color: "#fff" },
  pending: { background: "var(--gate-pending)", color: "#fff" },
  alert: { background: "var(--gate-alert)", color: "#fff" },
  ink: { background: "var(--gate-ink-2)", color: "#fff" },
  plain: { background: "var(--surface-2)", color: "var(--content-1)", boxShadow: "inset 0 0 0 1px var(--border-default)" },
};

export function GateAction({
  tone = "in",
  size = "lg",
  busy,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ActionTone; size?: "md" | "lg"; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        "gate-press inline-flex items-center justify-center gap-2 rounded-2xl px-5 font-semibold disabled:opacity-55",
        size === "lg" ? "min-h-[56px] text-[16px]" : "min-h-[48px] text-[15px]",
        className,
      )}
      style={{ ...TONE_STYLE[tone], ...props.style }}
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Bottom sheet with a 48px close target, used for pickers and confirmations. */
export function GateSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  tall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  tall?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto flex max-w-[640px] flex-col gap-0 rounded-t-[24px] border-0 bg-surface-1 p-0 [&>button:last-child]:hidden",
          tall ? "h-[88dvh]" : "max-h-[88dvh]",
        )}
      >
        <div className="flex items-start gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0 flex-1 pt-2">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--border-strong)]" aria-hidden />
            <SheetTitle className="text-[19px] font-semibold tracking-[-0.01em] text-content-1">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="mt-1 text-[14px] text-content-3">{description}</SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{title}</SheetDescription>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="gate-press mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-content-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer ? <div className="gate-safe-bottom border-t border-line px-5 pt-3">{footer}</div> : <div className="gate-safe-bottom" />}
      </SheetContent>
    </Sheet>
  );
}

export type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
};

/**
 * Searchable master picker. Search is debounced and sent to the server
 * (`onSearch`) so large masters stay within the endpoint's 100-row cap.
 */
export function MasterPicker({
  open,
  onOpenChange,
  title,
  description,
  options,
  loading,
  error,
  selectedId,
  onSearch,
  onSelect,
  emptyText = "No matching master record. Ask the office to add it in the ERP master.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  options: PickerOption[];
  loading?: boolean;
  error?: string | null;
  selectedId?: string;
  onSearch: (q: string) => void;
  onSelect: (id: string) => void;
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef(onSearch);
  searchRef.current = onSearch;

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      window.setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.title} ${o.subtitle ?? ""} ${o.meta ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <GateSheet open={open} onOpenChange={onOpenChange} title={title} description={description} tall>
      <div className="sticky top-0 z-10 -mx-5 bg-surface-1 px-5 pb-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-4" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or code"
            className="gate-field !pl-12"
            inputMode="search"
            autoComplete="off"
            aria-label={`Search ${title}`}
          />
        </label>
      </div>
      {error ? (
        <div className="rounded-2xl border p-4 text-[14px]" style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)", color: "var(--gate-alert)" }}>
          {error}
        </div>
      ) : null}
      <ul className="space-y-1.5" aria-busy={loading}>
        {visible.map((option) => {
          const selected = option.id === selectedId;
          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(option.id);
                  onOpenChange(false);
                }}
                className={cn(
                  "gate-press flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left",
                  selected ? "bg-[var(--gate-in-soft)]" : "bg-surface-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold text-content-1">{option.title}</div>
                  {option.subtitle ? <div className="truncate text-[13px] text-content-3">{option.subtitle}</div> : null}
                </div>
                {option.meta ? <span className="shrink-0 font-mono text-[12px] text-content-4">{option.meta}</span> : null}
                {selected ? <Check className="h-5 w-5 shrink-0 text-[var(--gate-in)]" /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-[14px] text-content-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching masters…
        </div>
      ) : null}
      {!loading && !error && visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-[14px] text-content-3">{emptyText}</p>
      ) : null}
    </GateSheet>
  );
}

/** Picker trigger that looks like an inset field. */
export function PickerField({
  value,
  placeholder,
  onOpen,
  invalid,
  disabled,
  sub,
}: {
  value?: string;
  placeholder: string;
  onOpen: () => void;
  invalid?: boolean;
  disabled?: boolean;
  sub?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      data-invalid={invalid || undefined}
      className="gate-field gate-press flex items-center justify-between gap-3 text-left disabled:opacity-60"
    >
      <span className="min-w-0 flex-1 py-2">
        <span className={cn("block truncate text-[16px]", value ? "font-semibold text-content-1" : "text-content-4")}>
          {value || placeholder}
        </span>
        {value && sub ? <span className="block truncate text-[12px] text-content-3">{sub}</span> : null}
      </span>
      <Search className="h-5 w-5 shrink-0 text-content-4" />
    </button>
  );
}

/**
 * The single truth about a send: what happened, and what the human can do.
 * "Saved" is never shown here — only a server receipt screen says saved.
 */
export function OperationBanner({
  phase,
  error,
  onRetry,
  onRelease,
  releaseLabel = "Edit entry",
  uncertainHint = "Check Today's register before editing. Retrying sends the same entry and cannot create a duplicate.",
}: {
  phase: GateOperationPhase;
  error: unknown;
  onRetry: () => void;
  onRelease?: () => void;
  releaseLabel?: string;
  uncertainHint?: string;
}) {
  if (phase === "uncertain") {
    return (
      <div
        role="alert"
        className="gate-rise rounded-2xl border p-4"
        style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)" }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--gate-pending)" }} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-content-1">Not confirmed yet</div>
            <p className="mt-0.5 text-[14px] text-content-2">
              {gateErrorMessage(error)} We don&apos;t know if the server saved it.
            </p>
            <p className="mt-1 text-[13px] text-content-3">{uncertainHint}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <GateAction tone="pending" size="md" onClick={onRetry}>
            <RotateCcw className="h-5 w-5" /> Send same entry again
          </GateAction>
          {onRelease ? (
            <GateAction tone="plain" size="md" onClick={onRelease}>
              {releaseLabel}
            </GateAction>
          ) : null}
        </div>
      </div>
    );
  }
  if (phase === "rejected") {
    return (
      <div
        role="alert"
        className="gate-rise rounded-2xl border p-4"
        style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)" }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--gate-alert)" }} />
          <div>
            <div className="text-[15px] font-semibold text-content-1">Not saved</div>
            <p className="mt-0.5 text-[14px] text-content-2">{gateErrorMessage(error)}</p>
            <p className="mt-1 text-[13px] text-content-3">Your entry is still here. Fix it and submit again.</p>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">{icon}</div>
      <div className="mt-3 text-[15px] font-semibold text-content-1">{title}</div>
      {body ? <p className="mt-1 max-w-[320px] text-[14px] text-content-3 [text-wrap:pretty]">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
