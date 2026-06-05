"use client"

import * as React from "react"
import { CalendarIcon, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

function formatInputDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function CalendarDateRangePicker({
  className,
}: React.HTMLAttributes<HTMLDivElement>) {
  const [from, setFrom] = React.useState(() => formatInputDate(new Date()))
  const [to, setTo] = React.useState(() => {
    const value = new Date()
    value.setDate(value.getDate() + 7)
    return formatInputDate(value)
  })

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-surface-1 px-3 py-2 shadow-sm">
        <CalendarIcon className="h-4 w-4 text-blue-500" />
        <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Window</span>
      </div>
      <Input
        type="date"
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        className="h-10 w-[148px] rounded-xl border-slate-200 bg-surface-1"
      />
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-content-4">
        <ChevronRight className="h-3.5 w-3.5" />
        To
      </div>
      <Input
        type="date"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        className="h-10 w-[148px] rounded-xl border-slate-200 bg-surface-1"
      />
    </div>
  )
}
