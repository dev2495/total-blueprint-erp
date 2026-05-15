"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface HeroChip {
    icon?: React.ReactNode
    label: string
    value?: string
    tone?: "ok" | "warn" | "error" | "info" | "violet"
}

interface GradientHeroProps {
    eyebrow?: string
    title: string
    subtitle?: string
    chips?: HeroChip[]
    actions?: React.ReactNode
    /** Accent palette */
    palette?: "blue" | "indigo" | "violet" | "emerald" | "rose"
    /** "vivid" (default) keeps the saturated gradient. "subtle" renders a calm light card with a thin accent stripe — same data, less visual noise. */
    tone?: "vivid" | "subtle"
    className?: string
    children?: React.ReactNode
}

const PALETTE_BG: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
    blue: "from-blue-600 via-indigo-600 to-violet-600",
    indigo: "from-indigo-600 via-violet-600 to-fuchsia-600",
    violet: "from-violet-600 via-fuchsia-600 to-rose-600",
    emerald: "from-emerald-600 via-teal-600 to-sky-600",
    rose: "from-rose-600 via-orange-500 to-amber-500",
}

const TONE_PILL: Record<NonNullable<HeroChip["tone"]>, string> = {
    ok: "bg-emerald-500/15 text-emerald-50 ring-emerald-200/30",
    warn: "bg-amber-500/15 text-amber-50 ring-amber-200/30",
    error: "bg-rose-500/15 text-rose-50 ring-rose-200/30",
    info: "bg-sky-500/15 text-sky-50 ring-sky-200/30",
    violet: "bg-fuchsia-500/15 text-fuchsia-50 ring-fuchsia-200/30",
}

const SUBTLE_ACCENT: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
    blue: "from-blue-400 via-indigo-400 to-violet-400",
    indigo: "from-indigo-400 via-violet-400 to-fuchsia-400",
    violet: "from-violet-400 via-fuchsia-400 to-rose-400",
    emerald: "from-emerald-400 via-teal-400 to-sky-400",
    rose: "from-rose-400 via-orange-400 to-amber-400",
}

const SUBTLE_EYEBROW: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
    blue: "text-blue-700",
    indigo: "text-indigo-700",
    violet: "text-violet-700",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
}

const SUBTLE_BG: Record<NonNullable<GradientHeroProps["palette"]>, string> = {
    blue: "from-white via-slate-50/40 to-blue-50/40",
    indigo: "from-white via-slate-50/40 to-indigo-50/40",
    violet: "from-white via-slate-50/40 to-violet-50/40",
    emerald: "from-white via-slate-50/40 to-emerald-50/40",
    rose: "from-white via-slate-50/40 to-rose-50/40",
}

const SUBTLE_CHIP_TONE: Record<NonNullable<HeroChip["tone"]>, string> = {
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-700 ring-amber-200",
    error: "bg-rose-50 text-rose-700 ring-rose-200",
    info: "bg-sky-50 text-sky-700 ring-sky-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
}

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
                    "relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br px-5 py-4 shadow-sm",
                    SUBTLE_BG[palette],
                    className,
                )}
            >
                <div className={cn("absolute inset-y-0 left-0 w-1 bg-gradient-to-b", SUBTLE_ACCENT[palette])} />
                <div className="relative flex flex-wrap items-start justify-between gap-4 pl-2">
                    <div className="min-w-0 flex-1">
                        {eyebrow ? (
                            <div className={cn("mb-0.5 text-[10px] font-black uppercase tracking-[0.22em]", SUBTLE_EYEBROW[palette])}>
                                {eyebrow}
                            </div>
                        ) : null}
                        <h1 className="font-display text-[22px] font-black leading-tight tracking-tight text-slate-900 sm:text-[26px]">
                            {title}
                        </h1>
                        {subtitle ? (
                            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">{subtitle}</p>
                        ) : null}
                        {children}
                        {chips.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {chips.map((chip, idx) => (
                                    <span
                                        key={`${chip.label}-${idx}`}
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1",
                                            chip.tone ? SUBTLE_CHIP_TONE[chip.tone] : "bg-white text-slate-700 ring-slate-200",
                                        )}
                                    >
                                        {chip.icon ? <span className="inline-flex h-3.5 w-3.5 items-center justify-center text-current opacity-80">{chip.icon}</span> : null}
                                        <span>{chip.label}</span>
                                        {chip.value ? <span className="font-mono tabular-nums opacity-90">{chip.value}</span> : null}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                </div>
            </section>
        )
    }
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-3xl bg-gradient-to-br p-6 text-white shadow-[0_30px_70px_-30px_rgba(30,41,82,0.55)] ring-1 ring-white/15 sm:p-7",
                PALETTE_BG[palette],
                className
            )}
        >
            <div className="pointer-events-none absolute inset-0 opacity-30">
                <div className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
                <div className="absolute -bottom-32 -left-10 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <svg
                    aria-hidden
                    className="absolute inset-0 h-full w-full opacity-[0.07]"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <defs>
                        <pattern id="grid-hero" width="32" height="32" patternUnits="userSpaceOnUse">
                            <path d="M0 0 L32 0 M0 0 L0 32" stroke="white" strokeWidth="0.5" />
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
                        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/80">{subtitle}</p>
                    ) : null}
                    {children}
                </div>

                {chips.length > 0 ? (
                    <div className="flex w-full flex-wrap items-stretch gap-3 sm:w-auto sm:max-w-[60%]">
                        {chips.map((chip, idx) => (
                            <div
                                key={`${chip.label}-${idx}`}
                                className={cn(
                                    "flex min-w-[150px] items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2.5 backdrop-blur ring-1",
                                    chip.tone ? TONE_PILL[chip.tone] : "ring-white/20"
                                )}
                            >
                                {chip.icon ? (
                                    <div className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white/15">
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
                {actions ? <div className="flex flex-shrink-0 items-center gap-2">{actions}</div> : null}
            </div>
        </div>
    )
}
