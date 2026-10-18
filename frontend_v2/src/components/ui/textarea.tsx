import * as React from "react"

import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className, ...props }, ref) => {
        return (
            <textarea
                className={cn(
                    "flex min-h-[80px] w-full rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-sm text-content-1 ring-offset-background transition-[border-color,box-shadow] duration-150 ease-out placeholder:text-content-4 hover:border-line-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
                    className
                )}
                ref={ref}
                {...props}
            />
        )
    }
)
Textarea.displayName = "Textarea"

export { Textarea }
