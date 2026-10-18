"use client";

/**
 * pm-edit-shell.tsx
 *
 * Visual primitives dedicated to the PM Edit workspace. Mirrors the look
 * of the detail page (`pm-detail-v37.tsx`):
 * - RichHero — plain page header card: title, subtitle, soft chips
 * - RichSection — plain section card with a neutral icon tile, title and
 *   subtitle; replaces SectionCardV3 for PM Edit only
 * - PouchStyleIcon — small inline SVG depicting each pouch style
 * - PouchStylePicker— visual grid of pouch styles with formula chip
 * - LayerStateToggle— Fixed/Variable toggle pill row for a layer-axis (μ or G)
 *
 * Nothing else in the app reads these — keeps SectionCardV3/GradientHero stable
 * for other pages.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  rollWidthFormula,
  pouchUsesHeightForRoll,
} from "@/lib/product-geometry";

// ──────────────────────────────────────────────────────────────────
// Tone palette — shared across primitives
// ──────────────────────────────────────────────────────────────────

export type RichTone =
  | "indigo"
  | "blue"
  | "violet"
  | "emerald"
  | "amber"
  | "fuchsia"
  | "rose"
  | "slate";

/**
 * The tone now only colours the section icon. Cards themselves are plain:
 * white surface, hairline border, dark title, muted subtitle.
 */
const TONE_META: Record<RichTone, { icon: string }> = {
  indigo: { icon: "text-order-fg" },
  blue: { icon: "text-primary" },
  violet: { icon: "text-order-fg" },
  emerald: { icon: "text-success-fg" },
  amber: { icon: "text-warning-fg" },
  fuchsia: { icon: "text-order-fg" },
  rose: { icon: "text-danger-fg" },
  slate: { icon: "text-content-3" },
};

// ──────────────────────────────────────────────────────────────────
// RichHero — the page header card
// ──────────────────────────────────────────────────────────────────

export interface RichHeroChip {
  label: string;
  value: React.ReactNode;
  tone?: "ok" | "warn" | "info";
  icon?: React.ReactNode;
}

export function RichHero({
  eyebrow,
  title,
  subtitle,
  chips,
  actions,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  chips?: RichHeroChip[];
  actions?: React.ReactNode;
}) {
  const CHIP_TONE: Record<string, string> = {
    ok: "border-success-border bg-success-bg text-success-fg",
    warn: "border-warning-border bg-warning-bg text-warning-fg",
    info: "border-line bg-surface-2 text-content-2",
  };
  return (
    <section className="relative overflow-hidden rounded-[16px] border border-line bg-surface-1 px-5 py-5 shadow-[var(--shadow-sm)] md:px-6">
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-content-3">
            {eyebrow}
          </div>
          <h1 className="mt-1 text-[22px] font-semibold leading-7 tracking-[-0.02em] text-content-1 md:text-[24px] md:leading-8">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed text-content-3">
              {subtitle}
            </p>
          ) : null}
          {chips && chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5 text-caption">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium",
                    CHIP_TONE[c.tone || "info"],
                  )}
                >
                  {c.icon ? (
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                      {c.icon}
                    </span>
                  ) : null}
                  <span className="text-caption opacity-80">{c.label}</span>
                  <span className="font-mono-token font-medium">{c.value}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="relative flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// RichSection — replacement for SectionCardV3, PM Edit only
// ──────────────────────────────────────────────────────────────────

export function RichSection({
  tone,
  index,
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  badge,
  id,
}: {
  id?: string;
  tone: RichTone;
  index?: number;
  icon: React.ReactNode;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  badge?: React.ReactNode;
}) {
  const t = TONE_META[tone];
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn(
        "relative scroll-mt-32 overflow-hidden rounded-[14px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <header className="relative border-b border-line px-5 py-4 sm:px-6">
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span
              className={cn(
                "flex h-9 w-9 flex-none items-center justify-center rounded-[10px] border border-line bg-surface-2 [&>svg]:h-4 [&>svg]:w-4",
                t.icon,
              )}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {typeof index === "number" ? (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-[6px] border border-line bg-surface-2 px-1 font-mono-token text-caption font-medium text-content-3">
                    {index}
                  </span>
                ) : null}
                {eyebrow ? (
                  <span className="text-caption font-medium text-content-3">
                    {eyebrow}
                  </span>
                ) : null}
                {badge}
              </div>
              <h2
                id={id ? `${id}-title` : undefined}
                className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-content-1"
              >
                {title}
              </h2>
              {subtitle ? (
                <div className="mt-0.5 text-[13px] leading-snug text-content-3">
                  {subtitle}
                </div>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex-none">{actions}</div> : null}
        </div>
      </header>
      <div className={cn("p-5 sm:p-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────
// PouchStyleIcon — tiny inline SVG per style
// ──────────────────────────────────────────────────────────────────

export function PouchStyleIcon({
  style,
  className,
}: {
  style: string;
  className?: string;
}) {
  const s = String(style || "").toUpperCase();
  const stroke = "currentColor";
  const fill = "currentColor";
  const common = {
    width: 36,
    height: 40,
    viewBox: "0 0 36 40",
    className: cn("text-content-2", className),
  };
  if (s === "STAND_UP") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="4"
          width="24"
          height="30"
          rx="3"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path
          d="M6 30 L18 34 L30 30"
          fill={fill}
          fillOpacity="0.15"
          stroke={stroke}
          strokeWidth="1.2"
        />
        <path d="M18 4 L18 8" stroke={stroke} strokeWidth="1.2" />
      </svg>
    );
  }
  if (s === "PILLOW" || s === "THREE_SIDE_SEAL") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="6"
          width="24"
          height="28"
          rx="2"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path
          d="M8 6 L8 34 M28 6 L28 34"
          stroke={stroke}
          strokeWidth="0.8"
          strokeDasharray="2 2"
        />
      </svg>
    );
  }
  if (s === "CENTER_SEAL") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="6"
          width="24"
          height="28"
          rx="2"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path d="M18 6 L18 34" stroke={stroke} strokeWidth="2" />
        <path d="M16 18 L20 18" stroke={stroke} strokeWidth="0.8" />
      </svg>
    );
  }
  if (s === "SIDE_GUSSET") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="6"
          width="24"
          height="28"
          rx="2"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path
          d="M10 6 L6 12 L6 28 L10 34"
          fill={fill}
          fillOpacity="0.15"
          stroke={stroke}
          strokeWidth="1.2"
        />
        <path
          d="M26 6 L30 12 L30 28 L26 34"
          fill={fill}
          fillOpacity="0.15"
          stroke={stroke}
          strokeWidth="1.2"
        />
      </svg>
    );
  }
  if (s === "QUAD_SEAL" || s === "FLAT_BOTTOM") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="6"
          width="24"
          height="28"
          rx="1"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path
          d="M10 6 L6 10 L6 30 L10 34 M26 6 L30 10 L30 30 L26 34"
          fill="none"
          stroke={stroke}
          strokeWidth="1"
          strokeDasharray="2 1.5"
        />
        <path d="M6 30 L30 30" stroke={stroke} strokeWidth="1.2" />
      </svg>
    );
  }
  if (s === "SPOUT") {
    return (
      <svg {...common}>
        <rect
          x="6"
          y="8"
          width="24"
          height="26"
          rx="3"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <rect
          x="20"
          y="2"
          width="6"
          height="8"
          rx="1.5"
          fill={fill}
          fillOpacity="0.2"
          stroke={stroke}
          strokeWidth="1.2"
        />
        <path
          d="M6 30 L18 34 L30 30"
          fill={fill}
          fillOpacity="0.1"
          stroke={stroke}
          strokeWidth="1"
        />
      </svg>
    );
  }
  if (s === "SACHET" || s === "STICK_PACK") {
    return (
      <svg {...common}>
        <rect
          x={s === "STICK_PACK" ? 14 : 8}
          y="4"
          width={s === "STICK_PACK" ? 8 : 20}
          height="32"
          rx="1.5"
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
        />
        <path
          d={
            s === "STICK_PACK"
              ? "M14 8 L22 8 M14 32 L22 32"
              : "M8 8 L28 8 M8 32 L28 32"
          }
          stroke={stroke}
          strokeWidth="0.8"
          strokeDasharray="1.5 1.5"
        />
      </svg>
    );
  }
  if (s === "SHAPED") {
    return (
      <svg {...common}>
        <path
          d="M10 6 Q6 14 8 22 Q10 30 18 34 Q26 30 28 22 Q30 14 26 6 Q18 4 10 6 Z"
          fill={fill}
          fillOpacity="0.1"
          stroke={stroke}
          strokeWidth="1.5"
        />
      </svg>
    );
  }
  // Default — flat film/roll for unrecognised
  return (
    <svg {...common}>
      <rect
        x="6"
        y="8"
        width="24"
        height="24"
        rx="1.5"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
      />
      <path
        d="M6 14 L30 14 M6 20 L30 20 M6 26 L30 26"
        stroke={stroke}
        strokeWidth="0.6"
      />
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────
// PouchStylePicker — visual icon grid replacing the dropdown
// ──────────────────────────────────────────────────────────────────

export const POUCH_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "STAND_UP", label: "Stand up" },
  { value: "PILLOW", label: "Pillow" },
  { value: "THREE_SIDE_SEAL", label: "3-side seal" },
  { value: "CENTER_SEAL", label: "Center seal" },
  { value: "SIDE_GUSSET", label: "Side gusset" },
  { value: "QUAD_SEAL", label: "Quad seal" },
  { value: "FLAT_BOTTOM", label: "Flat bottom" },
  { value: "SPOUT", label: "Spout" },
  { value: "SACHET", label: "Sachet" },
  { value: "STICK_PACK", label: "Stick pack" },
  { value: "SHAPED", label: "Shaped" },
];

export function PouchStylePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const formula = rollWidthFormula(value);
  const usesH = pouchUsesHeightForRoll(value);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {POUCH_STYLE_OPTIONS.map((opt) => {
          const active = String(value || "").toUpperCase() === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={cn(
                "group relative flex flex-col items-center gap-1 rounded-[10px] border px-2 py-2 text-caption font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-info-bg text-primary"
                  : "border-line bg-surface-1 text-content-3 hover:border-line-strong hover:bg-surface-2",
              )}
            >
              <PouchStyleIcon
                style={opt.value}
                className={active ? "text-primary" : "text-content-3"}
              />
              <span
                className={cn(
                  "text-caption leading-tight text-center",
                  active ? "text-primary" : "text-content-3",
                )}
              >
                {opt.label}
              </span>
              {active ? (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary text-caption font-semibold text-white ring-2 ring-surface-1">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        className={cn(
          "rounded-[10px] border px-3 py-2 font-mono-token text-caption font-medium",
          usesH
            ? "border-warning-border bg-warning-bg text-warning-fg"
            : "border-line bg-surface-2 text-content-2",
        )}
      >
        <span className="font-medium opacity-80">Roll W ={" "}</span>
        {formula}
        {usesH ? (
          <span className="ml-2 text-caption font-normal opacity-80">
            manual override below wins
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// LayerStateToggle — proper Fixed/Variable toggle pill row
// ──────────────────────────────────────────────────────────────────

export function LayerStatePill({
  axis,
  variable,
}: {
  axis: "μ thickness" | "G grade";
  variable: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-caption font-medium",
        variable
          ? "border-success-border bg-success-bg text-success-fg"
          : "border-info-border bg-info-bg text-info-fg",
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          variable ? "bg-success-fg" : "bg-info-fg",
        )}
      />
      <span>{axis}</span>
      <span className="text-caption opacity-80">
        {variable ? "Variable" : "Fixed"}
      </span>
    </span>
  );
}
