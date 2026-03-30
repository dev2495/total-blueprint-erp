"use client"

import { ReactNode } from "react"
import { PageHeader } from "@/components/ui-custom/page-header"
import { Button } from "@/components/ui/button"
import { CalendarDateRangePicker } from "@/components/date-range-picker"
import { RefreshCw, Download, Filter, BarChart3 } from "lucide-react"
import type { LocalizedText } from "@/help/types"

interface ReportLayoutProps {
    title: string
    description: string
    children: ReactNode
    actions?: ReactNode
    filters?: ReactNode
    onRefresh?: () => void
    onExport?: () => void
    isLoading?: boolean
    helpRoute?: string
    helpSummary?: LocalizedText | string
}

export function ReportLayout({
    title,
    description,
    children,
    actions,
    filters,
    onRefresh,
    onExport,
    isLoading,
    helpRoute,
    helpSummary,
}: ReportLayoutProps) {
    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/80 p-6 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-indigo-500/12 via-sky-400/10 to-emerald-400/10" />
                <div className="pointer-events-none absolute -right-12 -top-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
                <div className="pointer-events-none absolute -left-10 bottom-0 h-28 w-28 rounded-full bg-sky-400/10 blur-3xl" />
                <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-700">
                            <BarChart3 className="h-3.5 w-3.5" />
                            Analytics Story
                        </div>
                        <PageHeader
                            title={title}
                            description={description}
                            helpRoute={helpRoute}
                            helpSummary={helpSummary}
                            showHelpInline={Boolean(helpRoute || helpSummary)}
                            className="pb-0"
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {actions}
                        {onRefresh && (
                            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading} className="rounded-xl border-slate-200 bg-white/90 shadow-sm">
                                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                        )}
                        {onExport && (
                            <Button variant="outline" size="sm" onClick={onExport} className="rounded-xl border-slate-200 bg-white/90 shadow-sm">
                                <Download className="h-4 w-4 mr-2" />
                                Download PDF
                            </Button>
                        )}
                    </div>
                </div>
            </section>

            <section className="rounded-[1.75rem] border border-white/70 bg-white/75 p-4 shadow-[0_20px_50px_-35px_rgba(15,23,42,0.45)] backdrop-blur-xl">
                <div className="flex flex-wrap items-center gap-4">
                    <div className="mr-auto flex items-center gap-2 rounded-full bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200/80">
                        <Filter className="h-4 w-4 text-indigo-500" />
                        <span>Report Filters</span>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                        <CalendarDateRangePicker />
                    </div>

                    {filters}
                </div>
            </section>

            <div className="min-h-[500px] rounded-[2rem]">
                {children}
            </div>
        </div>
    )
}
