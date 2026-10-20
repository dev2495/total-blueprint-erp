"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { useLabelledBy } from "@/components/ui/field-label"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const labelledBy = useLabelledBy(props)
    return (
      <input
        type={type}
        aria-labelledby={labelledBy}
        className={cn(
          "flex h-10 w-full rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-base text-content-1 ring-offset-background transition-[border-color,box-shadow,background-color] duration-150 ease-out file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-content-4 hover:border-line-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-[invalid=true]:border-danger-solid aria-[invalid=true]:bg-danger-bg md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
