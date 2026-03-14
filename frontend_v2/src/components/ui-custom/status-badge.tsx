import { cn } from "@/lib/utils"
import { getStatusSemantic } from "@/lib/visual-semantics"
import { SemanticBadge } from "./semantic-badge"

interface StatusBadgeProps {
    status: string | boolean | "active" | "inactive" | "success" | "error" | "warning" | "neutral"
    className?: string
    variant?: "default" | "outline"
    customLabel?: string
}

export function StatusBadge({ status, className, variant = "default", customLabel }: StatusBadgeProps) {
    const meta = getStatusSemantic(status, customLabel)
    const label = customLabel || meta.label

    return (
        <SemanticBadge
            value={typeof status === "boolean" ? String(status) : String(status)}
            label={label}
            showIcon={variant === "default"}
            className={cn(variant === "outline" ? "bg-white" : "", className)}
        />
    )
}
