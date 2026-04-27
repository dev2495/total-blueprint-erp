import { cn } from "@/lib/utils"
import type { LocalizedText } from "@/help/types"
import { PageHelpInline } from "@/components/help/page-help-inline"

interface PageHeaderProps {
    title: string
    description?: string
    actions?: React.ReactNode
    className?: string
    helpRoute?: string
    helpSummary?: LocalizedText | string
    showHelpInline?: boolean
}

export function PageHeader({
    title,
    description,
    actions,
    className,
    helpRoute,
    helpSummary,
    showHelpInline,
}: PageHeaderProps) {
    return (
        <div className={cn("space-y-4 pb-4", className)}>
            <div className="erp-hero overflow-hidden rounded-3xl border border-white/10 px-5 py-5 shadow-xl backdrop-blur-xl sm:px-6 sm:py-6 lg:px-7">
                <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-4xl space-y-2">
                        <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-white/80 shadow-sm">
                            Total Poly Print ERP
                        </div>
                        <h1 className="font-display text-2xl font-bold tracking-normal text-white sm:text-3xl lg:text-[2.1rem]">{title}</h1>
                        {description && (
                            <p className="max-w-3xl text-sm leading-6 text-slate-200 sm:text-[15px]">
                                {description}
                            </p>
                        )}
                    </div>
                    {actions && (
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            {actions}
                        </div>
                    )}
                </div>
            </div>
            <div className="px-1">
                {showHelpInline ? <PageHelpInline routePattern={helpRoute} helpSummary={helpSummary} compact /> : null}
            </div>
        </div>
    )
}
