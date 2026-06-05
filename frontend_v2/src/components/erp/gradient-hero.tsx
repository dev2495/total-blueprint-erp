"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HeroChip {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  tone?: "ok" | "warn" | "error" | "info" | "violet";
}

interface GradientHeroProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  chips?: HeroChip[];
  actions?: React.ReactNode;
  /** Accent palette */
  palette?: "blue" | "indigo" | "violet" | "emerald" | "rose";
  /** "vivid" (default) keeps the saturated gradient. "subtle" renders a calm light card with a thin accent stripe — same data, less visual noise. */
  tone?: "vivid" | "subtle";
  className?: string;
  children?: React.ReactNode;
}

const PALETTE_BG: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
  blue: "from-primary via-order-fg to-order-fg",
  indigo: "from-order-fg via-order-fg to-order-fg",
  violet: "from-order-fg via-order-fg to-danger-solid",
  emerald: "from-success-fg via-info-fg to-info-fg",
  rose: "from-danger-solid via-warm to-warning-fg",
};

const TONE_PILL: Record<NonNullable<HeroChip["tone"]>, string> = {
  ok: "bg-success-fg text-success-border ring-success-border",
  warn: "bg-warning-fg text-warning-border ring-warning-border",
  error: "bg-danger-solid text-danger-border ring-danger-border",
  info: "bg-info-fg text-info-border ring-info-border",
  violet: "bg-order-fg text-order-border ring-order-border",
};

const SUBTLE_ACCENT: Record<
  NonNullable<GradientHeroProps["palette"]>,
  string
> = {
  blue: "from-info-fg via-order-fg to-order-fg",
  indigo: "from-order-fg via-order-fg to-order-fg",
  violet: "from-order-fg via-order-fg to-danger-fg",
  emerald: "from-success-fg via-success-fg to-info-fg",
  rose: "from-danger-fg via-warm to-warning-fg",
};

const SUBTLE_EYEBROW: Record<
  NonNullable<GradientHeroProps["palette"]>,
  string
> = {
  blue: "text-primary",
  indigo: "text-order-fg",
  violet: "text-order-fg",
  emerald: "text-success-fg",
  rose: "text-danger-fg",
};

const SUBTLE_BG: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
  blue: "from-white via-surface-2 to-info-bg",
  indigo: "from-white via-surface-2 to-order-bg",
  violet: "from-white via-surface-2 to-order-bg",
  emerald: "from-white via-surface-2 to-success-bg",
  rose: "from-white via-surface-2 to-danger-bg",
};

const SUBTLE_CHIP_TONE: Record<NonNullable<HeroChip["tone"]>, string> = {
  ok: "bg-success-bg text-success-fg ring-success-border",
  warn: "bg-warning-bg text-warning-fg ring-warning-border",
  error: "bg-danger-bg text-danger-fg ring-danger-border",
  info: "bg-info-bg text-info-fg ring-info-border",
  violet: "bg-order-bg text-order-fg ring-order-border",
};

export function GradientHero({
  eyebrow,
  title,
  subtitle,
  chips = [],
  actions,
  palette = "blue",
  tone = "vivid",
  className,
  children,
}: GradientHeroProps) {
  if (tone === "subtle") {
    return (
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br px-5 py-4 shadow-sm",
          SUBTLE_BG[palette],
          className,
        )}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-1 bg-gradient-to-b",
            SUBTLE_ACCENT[palette],
          )}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4 pl-2">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <div
                className={cn(
                  "mb-0.5 text-[10px] font-black uppercase tracking-[0.22em]",
                  SUBTLE_EYEBROW[palette],
                )}
              >
                {eyebrow}
              </div>
            ) : null}
            <h1 className="font-display text-[22px] font-black leading-tight tracking-tight text-content-1 sm:text-[26px]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 max-w-3xl text-xs leading-5 text-content-3">
                {subtitle}
              </p>
            ) : null}
            {children}
            {chips.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {chips.map((chip, idx) => (
                  <span
                    key={`${chip.label}-${idx}`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1",
                      chip.tone
                        ? SUBTLE_CHIP_TONE[chip.tone]
                        : "bg-surface-1 text-content-2 ring-line",
                    )}
                  >
                    {chip.icon ? (
                      <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-current opacity-80">
                        {chip.icon}
                      </span>
                    ) : null}
                    <span>{chip.label}</span>
                    {chip.value ? (
                      <span className="font-mono tabular-nums opacity-90">
                        {chip.value}
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </section>
    );
  }
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-[0_30px_70px_-30px_rgba(30,41,82,0.55)] ring-1 ring-surface-1/15 sm:p-7",
        PALETTE_BG[palette],
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-surface-1/15 blur-3xl" />
        <div className="absolute -bottom-32 -left-10 h-72 w-72 rounded-full bg-surface-1/10 blur-3xl" />
        <svg
          aria-hidden
          className="absolute inset-0 h-full w-full opacity-[0.07]"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="grid-hero"
              width="32"
              height="32"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M0 0 L32 0 M0 0 L0 32"
                stroke="white"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid-hero)" />
        </svg>
      </div>

      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.28em] text-white/75">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-display text-[26px] font-bold leading-tight sm:text-[32px]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">
              {subtitle}
            </p>
          ) : null}
          {children}
        </div>

        {chips.length > 0 ? (
          <div className="flex w-full flex-wrap items-stretch gap-3 sm:w-auto sm:max-w-[60%]">
            {chips.map((chip, idx) => (
              <div
                key={`${chip.label}-${idx}`}
                className={cn(
                  "flex min-w-[150px] items-center gap-2 rounded-2xl bg-surface-1/10 px-3.5 py-2.5 backdrop-blur ring-1",
                  chip.tone ? TONE_PILL[chip.tone] : "ring-surface-1/20",
                )}
              >
                {chip.icon ? (
                  <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-surface-1/15">
                    {chip.icon}
                  </div>
                ) : null}
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/80">
                    {chip.label}
                  </div>
                  {chip.value ? (
                    <div className="truncate text-sm font-semibold leading-tight text-white">
                      {chip.value}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {actions ? (
          <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
