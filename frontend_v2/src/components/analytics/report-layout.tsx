"use client"

import { ReactNode } from "react"
import { PageHeader } from "@/components/ui-custom/page-header"
import { Button } from "@/components/ui/button"
import { CalendarDateRangePicker } from "@/components/date-range-picker"
import { RefreshCw, Download, Filter } from "lucide-react"
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
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <PageHeader
                    title={title}
                    description={description}
                    helpRoute={helpRoute}
                    helpSummary={helpSummary}
                    showHelpInline={Boolean(helpRoute || helpSummary)}
                />
                <div className="flex items-center gap-2">
                    {actions}
                    <div className="flex items-center gap-2 border-l pl-2 ml-2 border-slate-200">
                        {onRefresh && (
                            <Button variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
                                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                        )}
                        {onExport && (
                            <Button variant="outline" size="sm" onClick={onExport}>
                                <Download className="h-4 w-4 mr-2" />
                                Export
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Global Report Controls */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2 text-slate-500 text-sm font-medium mr-auto">
                    <Filter className="h-4 w-4" />
                    <span>Report Filters:</span>
                </div>

                <CalendarDateRangePicker />

                {filters}
            </div>

            {/* Main Content */}
            <div className="min-h-[500px]">
                {children}
            </div>
        </div>
    )
}
