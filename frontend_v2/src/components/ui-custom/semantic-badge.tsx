"use client"

import type { HTMLAttributes } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { getSemanticMeta, getStatusSemantic, humanizeToken, type SemanticKind } from "@/lib/visual-semantics"

interface SemanticBadgeProps extends HTMLAttributes<HTMLDivElement> {
  kind?: SemanticKind
  value?: string | boolean | null
  label?: string
  showIcon?: boolean
}

export function SemanticBadge({
  kind,
  value,
  label,
  showIcon = true,
  className,
  ...props
}: SemanticBadgeProps) {
  const meta = kind ? getSemanticMeta(kind, typeof value === "boolean" ? String(value) : value, label) : getStatusSemantic(value, label)
  const Icon = meta.icon
  const resolvedLabel = label || meta.label || humanizeToken(typeof value === "boolean" ? String(value) : value)

  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-none",
        meta.badgeClassName,
        className,
      )}
      {...props}
    >
      {showIcon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
      <span>{resolvedLabel}</span>
    </Badge>
  )
}
