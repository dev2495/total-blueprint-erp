import { cn } from "@/lib/utils"

interface SectionCardProps extends React.HTMLAttributes<HTMLDivElement> {
    title?: string
    description?: string
    action?: React.ReactNode
}

export function SectionCard({ title, description, action, children, className, ...props }: SectionCardProps) {
    return (
        <div className={cn("rounded-2xl border border-slate-200/80 bg-white text-card-foreground shadow-sm", className)} {...props}>
            {(title || description || action) && (
                <div className="flex items-center justify-between p-6">
                    <div className="space-y-1">
                        {title && <h3 className="font-extrabold leading-none tracking-normal text-slate-950">{title}</h3>}
                        {description && <p className="text-sm leading-6 text-slate-500">{description}</p>}
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
