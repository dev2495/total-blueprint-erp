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
        <div className={cn("space-y-3 pb-4", className)}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="space-y-1.5">
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
                    {description && (
                        <p className="text-sm text-muted-foreground">
                            {description}
                        </p>
                    )}
                </div>
                {actions && (
                    <div className="flex items-center gap-2">
                        {actions}
                    </div>
                )}
            </div>
            {showHelpInline ? <PageHelpInline routePattern={helpRoute} helpSummary={helpSummary} compact /> : null}
        </div>
    )
}
