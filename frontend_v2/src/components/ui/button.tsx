import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[13px] font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.99] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-primary/90",
        destructive:
          "bg-danger-solid text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:opacity-90",
        outline:
          "border border-line bg-surface-1 text-content-1 shadow-[var(--shadow-sm)] hover:border-line-strong hover:bg-surface-2",
        secondary:
          "border border-line bg-surface-2 text-content-1 hover:border-line-strong hover:bg-surface-1",
        ghost: "text-content-2 hover:bg-surface-2 hover:text-content-1",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "bg-success text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-success/90 dark:text-[#06140e]",
        warning:
          "bg-warning text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-warning/90 dark:text-[#1a1004]",
        info:
          "bg-info text-white shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:opacity-90 dark:text-[#06131a]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-[8px] px-3 text-[12.5px]",
        lg: "h-11 rounded-[10px] px-6 text-[14px]",
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
