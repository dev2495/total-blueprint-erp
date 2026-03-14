import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBadgeProps {
    status: string | boolean | "active" | "inactive" | "success" | "error" | "warning" | "neutral"
    className?: string
    variant?: "default" | "outline"
    customLabel?: string
}

export function StatusBadge({ status, className, variant = "default", customLabel }: StatusBadgeProps) {
    let colorClass = "bg-slate-100 text-slate-800 hover:bg-slate-100/80" // Default neutral
    let label = customLabel || String(status)

    // Map boolean to Active/Inactive
    if (typeof status === "boolean") {
        label = status ? "Yes" : "No"
        if (status) {
            colorClass = "bg-green-100 text-green-700 hover:bg-green-100/80 border-green-200"
        } else {
            colorClass = "bg-slate-100 text-slate-700 hover:bg-slate-100/80 border-slate-200"
        }
    } else {
        // String status mapping
        const lowerStatus = String(status).toLowerCase()
        if (["active", "success", "completed", "verified", "yes", "true", "extrudable", "purchasable"].includes(lowerStatus)) {
            colorClass = "bg-green-50 text-green-700 hover:bg-green-50/80 border-green-200 border"
        } else if (["planning_required", "planned", "confirmed", "released", "dispatch_ready", "stock_ready"].includes(lowerStatus)) {
            colorClass = "bg-blue-50 text-blue-700 hover:bg-blue-50/80 border-blue-200 border"
        } else if (["error", "failed", "rejected", "risk"].includes(lowerStatus)) {
            colorClass = "bg-red-50 text-red-700 hover:bg-red-50/80 border-red-200 border"
        } else if (["warning", "pending", "draft", "review"].includes(lowerStatus)) {
            colorClass = "bg-amber-50 text-amber-700 hover:bg-amber-50/80 border-amber-200 border"
        } else if (["inactive", "disabled", "no", "false"].includes(lowerStatus)) {
            colorClass = "bg-slate-100 text-slate-600 hover:bg-slate-100/80 border-slate-200 border"
        } else {
            // Default blue-ish for other statuses (e.g. "Solid", "Liquid")
            colorClass = "bg-blue-50 text-blue-700 hover:bg-blue-50/80 border-blue-200 border"
        }
    }

    // Capitalize label if not custom
    if (!customLabel) {
        label = label.charAt(0).toUpperCase() + label.slice(1)
    }

    return (
        <Badge variant={variant} className={cn("px-2 py-0.5 text-xs font-medium border shadow-none", colorClass, className)}>
            {label}
        </Badge>
    )
}
