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
            <div className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/78 px-5 py-5 shadow-[0_22px_60px_-46px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:px-6 sm:py-6 lg:px-7">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-4xl space-y-2">
                        <div className="inline-flex items-center rounded-full border border-slate-200/80 bg-white/85 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 shadow-sm">
                            Premium Workspace
                        </div>
                        <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl lg:text-[2rem]">{title}</h1>
                        {description && (
                            <p className="max-w-3xl text-sm leading-6 text-slate-500 sm:text-[15px]">
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
