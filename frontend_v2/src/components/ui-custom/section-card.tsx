import { cn } from "@/lib/utils"

interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string
    description?: string
    action?: React.ReactNode
}

export function SectionCard({ title, description, action, children, className, ...props }: SectionCardProps) {
    return (
        <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props}>
            {(title || description || action) && (
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1">
                        {title && <h3 className="font-semibold leading-none tracking-tight">{title}</h3>}
                        {description && <p className="text-sm text-muted-foreground">{description}</p>}
                    </div>
                    {action && <div>{action}</div>}
                </div>
            )}
            <div className={cn("p-6 pt-0", { "pt-6": !title && !description && !action })}>
                {children}
            </div>
        </div>
    )
}
