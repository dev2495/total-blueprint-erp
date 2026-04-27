"use client"

import { cn } from "@/lib/utils"

export function PremiumPageShell({
    children,
    className,
    dataTestId,
}: {
    children: React.ReactNode
    className?: string
    dataTestId?: string
}) {
    return (
        <div
            data-testid={dataTestId}
            className={cn(
                "relative min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-white/78 p-3 shadow-xl backdrop-blur-xl sm:p-4 lg:p-6",
                className
            )}
        >
            <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent" />
            <div className="mx-auto flex min-w-0 max-w-[1700px] flex-col gap-5 lg:gap-6">{children}</div>
        </div>
    )
}

export function PremiumHero({
    eyebrow,
    title,
    description,
    actions,
    metrics,
    className,
    dataTestId,
}: {
    eyebrow?: string
    title: string
    description?: string
    actions?: React.ReactNode
    metrics?: React.ReactNode
    className?: string
    dataTestId?: string
}) {
    return (
        <section
            data-testid={dataTestId}
            className={cn(
                "erp-hero relative overflow-hidden rounded-3xl border border-white/10 px-4 py-4 text-white shadow-xl sm:px-6 sm:py-6 lg:px-8 lg:py-7",
                className
            )}
        >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
            <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-4xl space-y-3">
                    {eyebrow ? (
                        <div className="inline-flex rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-slate-100/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                            {eyebrow}
                        </div>
                    ) : null}
                    <div className="space-y-2">
                        <h1 className="font-display text-[1.9rem] font-bold tracking-normal text-white sm:text-[2.35rem]">{title}</h1>
                        {description ? (
                            <p className="max-w-3xl text-sm leading-6 text-slate-300 sm:text-[15px]">{description}</p>
                        ) : null}
                    </div>
                </div>
                {actions ? (
                    <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end sm:gap-3 [&>*]:w-full [&>*]:justify-center sm:[&>*]:w-auto">
                        {actions}
                    </div>
                ) : null}
            </div>
            {metrics ? <div className="relative z-10 mt-5">{metrics}</div> : null}
        </section>
    )
}

export function PremiumMetricStrip({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
            {children}
        </div>
    )
}

export function PremiumMetricCard({
    label,
    value,
    hint,
    tone = "light",
    className,
    valueClassName,
    dataTestId,
}: {
    label: string
    value: React.ReactNode
    hint?: React.ReactNode
    tone?: "light" | "dark"
    className?: string
    valueClassName?: string
    dataTestId?: string
}) {
    return (
        <div
            data-testid={dataTestId}
            className={cn(
                "rounded-2xl border px-4 py-4 shadow-sm",
                tone === "dark"
                    ? "border-white/15 bg-white/10 text-white backdrop-blur"
                    : "border-slate-200/80 bg-white text-slate-900 backdrop-blur",
                className
            )}
        >
            <div className={cn("text-[10px] font-black uppercase tracking-[0.22em]", tone === "dark" ? "text-slate-300" : "text-slate-400")}>
                {label}
            </div>
            <div className={cn("font-display mt-2 break-words text-xl font-bold leading-tight tracking-normal sm:text-[1.55rem] xl:text-[1.8rem]", valueClassName)}>
                {value}
            </div>
            {hint ? (
                <div className={cn("mt-1 break-words text-xs leading-5", tone === "dark" ? "text-slate-300/90" : "text-slate-500")}>{hint}</div>
            ) : null}
        </div>
    )
}

export function PremiumSection({
    title,
    description,
    actions,
    children,
    className,
    contentClassName,
    dataTestId,
}: {
    title: string
    description?: string
    actions?: React.ReactNode
    children: React.ReactNode
    className?: string
    contentClassName?: string
    dataTestId?: string
}) {
    return (
        <section data-testid={dataTestId} className={cn("overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm backdrop-blur", className)}>
            <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-1.5">
                    <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-700">{title}</div>
                    {description ? <p className="max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
                </div>
                {actions ? <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">{actions}</div> : null}
            </div>
            <div className={cn("min-w-0 p-4 sm:p-5 lg:p-6", contentClassName)}>{children}</div>
        </section>
    )
}
