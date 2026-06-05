import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(37,99,235,0.45)] hover:-translate-y-px hover:brightness-105 focus-visible:ring-4 focus-visible:ring-blue-500/20",
        destructive:
          "bg-rose-600 text-destructive-foreground shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(244,63,94,0.45)] hover:-translate-y-px hover:brightness-105",
        outline:
          "border border-line-strong bg-surface-1 text-slate-700 shadow-sm hover:-translate-y-px hover:border-blue-500 hover:bg-slate-100 hover:text-blue-700",
        secondary:
          "border border-slate-200 bg-slate-50 text-slate-800 shadow-sm hover:bg-white hover:text-slate-950",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "bg-success text-white shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(4,120,87,0.45)] hover:-translate-y-px hover:brightness-105",
        warning:
          "bg-warning text-white shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(180,83,9,0.45)] hover:-translate-y-px hover:brightness-105",
        info:
          "bg-info text-white shadow-[0_1px_1px_rgba(15,23,42,0.10),0_6px_16px_-8px_rgba(3,105,161,0.45)] hover:-translate-y-px hover:brightness-105",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-xl px-3 text-xs",
        lg: "h-11 rounded-xl px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
