import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
        secondary:
          "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
        destructive:
          "border-danger-border bg-danger-bg text-danger-fg hover:bg-rose-100",
        outline: "border-line-strong bg-surface-1 text-slate-700",
        success:
          "border-success-border bg-success-bg text-success-fg",
        warning:
          "border-warning-border bg-warning-bg text-warning-fg",
        info:
          "border-info-border bg-info-bg text-info-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
