import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium leading-[1.35] transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-info-border bg-info-bg text-info-fg",
        secondary:
          "border-line bg-surface-2 text-content-2",
        destructive:
          "border-danger-border bg-danger-bg text-danger-fg",
        outline: "border-line bg-surface-1 text-content-2",
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
