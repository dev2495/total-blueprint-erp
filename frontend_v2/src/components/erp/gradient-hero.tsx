"use client";

import * as React from "react";
import { HeroChip as SharedHeroChip, PageHero } from "@/components/premium/page-hero";

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

const CHIP_TONE: Record<NonNullable<HeroChip["tone"]>, "good" | "warn" | "bad" | "info" | "neutral"> = {
  ok: "good",
  warn: "warn",
  error: "bad",
  info: "info",
  violet: "info",
};

/**
 * Legacy hero API (palette / tone) kept for the pages that use it. Every
 * variant now renders the shared PageHero so all modules share one header.
 */
export function GradientHero({
  eyebrow,
  title,
  subtitle,
  chips = [],
  actions,
  tone = "vivid",
  className,
  children,
}: GradientHeroProps) {
  return (
    <PageHero
      compact={tone === "subtle"}
      eyebrow={eyebrow}
      title={title}
      description={subtitle}
      actions={actions}
      className={className}
      meta={
        chips.length ? (
          <>
            {chips.map((chip, idx) => (
              <SharedHeroChip key={`${chip.label}-${idx}`} tone={chip.tone ? CHIP_TONE[chip.tone] : "neutral"}>
                {chip.label}
                {chip.value ? <span className="ml-1 font-semibold tabular-nums text-white">{chip.value}</span> : null}
              </SharedHeroChip>
            ))}
          </>
        ) : undefined
      }
    >
      {children}
    </PageHero>
  );
}
