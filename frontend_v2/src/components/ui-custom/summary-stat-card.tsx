"use client"

import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SummaryStatCardProps {
  label: string
  value: string | number
  subLabel?: string
  icon: LucideIcon
  toneClassName?: string
  className?: string
  compact?: boolean
}

export function SummaryStatCard({
  label,
  value,
  subLabel,
  icon: Icon,
  toneClassName = "bg-slate-50 text-slate-700",
  className,
  compact = false,
}: SummaryStatCardProps) {
  return (
    <Card className={cn("border-0 shadow-sm ring-1 ring-slate-100", className)}>
      <CardContent className={cn(compact ? "p-4" : "p-5")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className={cn("font-black uppercase text-slate-400", compact ? "text-[9px] tracking-[0.22em]" : "text-[10px] tracking-[0.18em]")}>
              {label}
            </div>
            <div className={cn("font-black tracking-tight text-slate-900", compact ? "mt-1.5 text-xl leading-none" : "mt-2 text-2xl")}>
              {value}
            </div>
            {subLabel ? (
              <div className={cn("font-medium text-slate-500", compact ? "mt-1 text-[11px] leading-4" : "mt-1 text-xs")}>
                {subLabel}
              </div>
            ) : null}
          </div>
          <div className={cn("shadow-sm ring-1 ring-inset ring-white/60", compact ? "rounded-xl p-2.5" : "rounded-2xl p-3", toneClassName)}>
            <Icon className={cn(compact ? "h-4.5 w-4.5" : "h-5 w-5")} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
