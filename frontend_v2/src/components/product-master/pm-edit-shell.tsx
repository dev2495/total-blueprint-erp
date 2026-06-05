"use client";

/**
 * pm-edit-shell.tsx
 *
 * Rich visual primitives dedicated to the PM Edit workspace. Mirrors the look
 * of the detail page (`pm-detail-v37.tsx`):
 * - RichHero — gradient page hero with ambient blobs, big title, chips
 * - RichSection — vibrant per-section card with icon bubble + tonal blob
 * + accent stripe; replaces SectionCardV3 for PM Edit only
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

const TONE_META: Record<
  RichTone,
  {
    wrap: string;
    stripe: string;
    iconBg: string;
    eyebrow: string;
    subtitle: string;
    blob: string;
    ring: string;
  }
> = {
  indigo: {
    wrap: "border-order-border bg-gradient-to-br from-order-bg via-white to-info-bg",
    stripe: "bg-gradient-to-b from-order-fg to-primary",
    iconBg: "bg-gradient-to-br from-order-fg to-primary text-white shadow-md",
    eyebrow: "text-order-fg",
    subtitle: "text-order-fg",
    blob: "bg-order-bg",
    ring: "ring-order-border",
  },
  blue: {
    wrap: "border-info-border bg-gradient-to-br from-info-bg via-white to-info-bg",
    stripe: "bg-gradient-to-b from-primary to-info-fg",
    iconBg: "bg-gradient-to-br from-primary to-info-fg text-white shadow-md",
    eyebrow: "text-primary",
    subtitle: "text-primary",
    blob: "bg-info-bg",
    ring: "ring-info-border",
  },
  violet: {
    wrap: "border-order-border bg-gradient-to-br from-order-bg via-white to-purple-50/60",
    stripe: "bg-gradient-to-b from-order-fg to-purple-500",
    iconBg:
      "bg-gradient-to-br from-order-fg to-purple-500 text-white shadow-md",
    eyebrow: "text-order-fg",
    subtitle: "text-order-fg",
    blob: "bg-order-bg",
    ring: "ring-order-border",
  },
  emerald: {
    wrap: "border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg",
    stripe: "bg-gradient-to-b from-success-fg to-success-bg0",
    iconBg:
      "bg-gradient-to-br from-success-fg to-success-bg0 text-white shadow-md",
    eyebrow: "text-success-fg",
    subtitle: "text-success-fg",
    blob: "bg-success-bg",
    ring: "ring-success-border",
  },
  amber: {
    wrap: "border-warning-border bg-gradient-to-br from-warning-bg via-white to-warm",
    stripe: "bg-gradient-to-b from-warning-fg to-warm",
    iconBg: "bg-gradient-to-br from-warning-fg to-warm text-white shadow-md",
    eyebrow: "text-warning-fg",
    subtitle: "text-warning-fg",
    blob: "bg-warning-bg",
    ring: "ring-warning-border",
  },
  fuchsia: {
    wrap: "border-order-border bg-gradient-to-br from-order-bg via-white to-danger-bg",
    stripe: "bg-gradient-to-b from-order-fg to-danger-solid",
    iconBg:
      "bg-gradient-to-br from-order-fg to-danger-solid text-white shadow-md",
    eyebrow: "text-order-fg",
    subtitle: "text-order-fg",
    blob: "bg-order-bg",
    ring: "ring-order-border",
  },
  rose: {
    wrap: "border-danger-border bg-gradient-to-br from-danger-bg via-white to-warm",
    stripe: "bg-gradient-to-b from-danger-solid to-warm",
    iconBg: "bg-gradient-to-br from-danger-solid to-warm text-white shadow-md",
    eyebrow: "text-danger-fg",
    subtitle: "text-danger-fg",
    blob: "bg-danger-bg",
    ring: "ring-danger-border",
  },
  slate: {
    wrap: "border-line bg-gradient-to-br from-surface-2 via-white to-surface-2",
    stripe: "bg-gradient-to-b from-surface-2 to-surface-3",
    iconBg:
      "bg-gradient-to-br from-surface-2 to-surface-3 text-white shadow-md",
    eyebrow: "text-content-2",
    subtitle: "text-content-2",
    blob: "bg-line",
    ring: "ring-line",
  },
};

// ──────────────────────────────────────────────────────────────────
// RichHero — the gradient page hero
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
    ok: "bg-success-bg text-success-fg ring-success-border",
    warn: "bg-warning-bg text-warning-fg ring-warning-border",
    info: "bg-surface-1 text-order-fg ring-order-border",
  };
  return (
    <section className="relative overflow-hidden rounded-3xl border border-order-border bg-gradient-to-br from-order-bg via-white to-order-bg px-6 py-5 shadow-lg ring-1 ring-surface-1/40">
      {/* Decorative blurred blobs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-order-fg blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-10 h-56 w-56 rounded-full bg-order-fg blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-10 right-1/3 h-32 w-32 rounded-full bg-order-bg blur-2xl"
      />
      <div className="absolute inset-y-0 left-0 w-2 bg-gradient-to-b from-order-fg via-order-fg to-order-fg shadow-[0_0_18px_2px_rgba(139,92,246,0.45)]" />
      <div className="relative pl-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
            {eyebrow}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-black tracking-tight bg-gradient-to-br from-surface-3 via-order-fg to-order-fg bg-clip-text text-transparent mt-1">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-content-2 max-w-3xl leading-relaxed">
              {subtitle}
            </p>
          ) : null}
          {chips && chips.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 font-bold ring-1 shadow-sm",
                    CHIP_TONE[c.tone || "info"],
                  )}
                >
                  {c.icon ? (
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
                      {c.icon}
                    </span>
                  ) : null}
                  <span className="text-[9px] font-black uppercase tracking-wider opacity-70">
                    {c.label}
                  </span>
                  <span className="font-mono font-black">{c.value}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {actions ? <div className="relative">{actions}</div> : null}
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
}: {
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
      className={cn(
        "relative overflow-hidden rounded-2xl border bg-surface-1 shadow-sm ring-1 ring-surface-1/40",
        t.ring.replace("ring-", "border-"),
        className,
      )}
    >
      {/* Tonal header band */}
      <header
        className={cn(
          "relative overflow-hidden border-b px-5 py-3.5 sm:px-6",
          t.wrap,
          t.ring,
        )}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full blur-3xl",
            t.blob,
          )}
        />
        <div className={cn("absolute inset-y-0 left-0 w-1", t.stripe)} />
        <div className="relative flex flex-wrap items-start justify-between gap-3 pl-2">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span
              className={cn(
                "flex h-10 w-10 flex-none items-center justify-center rounded-xl",
                t.iconBg,
              )}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {typeof index === "number" ? (
                  <span
                    className={cn(
                      "inline-flex h-5 min-w-[20px] items-center justify-center rounded-md px-1 text-[10px] font-black ring-1 ring-inset",
                      t.iconBg,
                    )}
                  >
                    {index}
                  </span>
                ) : null}
                {eyebrow ? (
                  <span
                    className={cn(
                      "text-[10px] font-black uppercase tracking-[0.22em]",
                      t.eyebrow,
                    )}
                  >
                    {eyebrow}
                  </span>
                ) : null}
                {badge}
              </div>
              <div className="font-display text-base font-black text-content-1 tracking-tight">
                {title}
              </div>
              {subtitle ? (
                <div
                  className={cn("mt-0.5 text-[11px] leading-snug", t.subtitle)}
                >
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
                "group relative flex flex-col items-center gap-1 rounded-xl border bg-surface-1 px-2 py-2 text-[10px] font-bold transition hover:shadow-md",
                active
                  ? "border-success-border ring-2 ring-success-border bg-gradient-to-br from-success-bg to-success-bg"
                  : "border-line hover:border-success-border text-content-3",
              )}
            >
              <PouchStyleIcon
                style={opt.value}
                className={active ? "text-success-fg" : "text-content-3"}
              />
              <span
                className={cn(
                  "text-[10px] leading-tight text-center",
                  active ? "text-success-fg" : "text-content-3",
                )}
              >
                {opt.label}
              </span>
              {active ? (
                <span className="absolute -top-1.5 -right-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-success-fg text-[9px] font-black text-white shadow ring-2 ring-surface-1">
                  ✓
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-[11px] font-mono font-bold ring-1",
          usesH
            ? "bg-warning-bg text-warning-fg ring-warning-border"
            : "bg-order-bg text-order-fg ring-order-border",
        )}
      >
        <span className="text-[9px] font-black uppercase tracking-wider opacity-70">
          Roll W ={" "}
        </span>
        {formula}
        {usesH ? (
          <span className="ml-2 text-[10px] font-normal opacity-80">
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset",
        variable
          ? "bg-gradient-to-r from-success-bg to-success-bg text-success-fg ring-success-border shadow-sm"
          : "bg-info-bg text-primary ring-info-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          variable ? "bg-success-fg" : "bg-primary",
        )}
      />
      <span>{axis}</span>
      <span className="text-[9px] opacity-80">
        {variable ? "Variable" : "Fixed"}
      </span>
    </span>
  );
}
