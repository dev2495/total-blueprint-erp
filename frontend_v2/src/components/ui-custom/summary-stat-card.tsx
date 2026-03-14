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
}

export function SummaryStatCard({
  label,
  value,
  subLabel,
  icon: Icon,
  toneClassName = "bg-slate-50 text-slate-700",
  className,
}: SummaryStatCardProps) {
  return (
    <Card className={cn("border-0 shadow-sm ring-1 ring-slate-100", className)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</div>
            {subLabel ? <div className="mt-1 text-xs font-medium text-slate-500">{subLabel}</div> : null}
          </div>
          <div className={cn("rounded-2xl p-3 shadow-sm ring-1 ring-inset ring-white/60", toneClassName)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
