"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ArrowUpRight, Clock3, Link2, ShieldCheck } from "lucide-react"

export interface TimelineEventLike {
  timestamp?: string
  actor?: string | null
  entity_type?: string | null
  entity_id?: string | null
  event_type?: string | null
  message?: string | null
  reference?: string | null
  delta_qty_kg?: number | null
  meta?: Record<string, any> | null
}

export interface RelatedRecordLike {
  type?: string
  reference: string
  label: string
  subtitle?: string | null
  href?: string | null
}

export interface SummaryItemLike {
  label: string
  value: ReactNode
  hint?: ReactNode
}

type RecordTimelinePanelProps = {
  title: string
  description?: string
  status?: ReactNode
  summary?: SummaryItemLike[]
  timeline?: TimelineEventLike[]
  relatedRecords?: RelatedRecordLike[]
  actions?: ReactNode
  emptyTimelineTitle?: string
  emptyTimelineDescription?: string
  dataTestId?: string
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Timestamp unavailable"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

function formatKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function isScalar(value: any) {
  return value == null || ["string", "number", "boolean"].includes(typeof value)
}

function scalarMetaEntries(meta?: Record<string, any> | null) {
  if (!meta || typeof meta !== "object") return []
  return Object.entries(meta)
    .filter(([, value]) => isScalar(value))
    .slice(0, 5)
}

export function RecordTimelinePanel({
  title,
  description,
  status,
  summary = [],
  timeline = [],
  relatedRecords = [],
  actions,
  emptyTimelineTitle = "No timeline events yet",
  emptyTimelineDescription = "This record does not have normalized audit history in the current dataset.",
  dataTestId,
}: RecordTimelinePanelProps) {
  return (
    <section data-testid={dataTestId} className="space-y-5">
      <Card className="overflow-hidden border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-52px_rgba(15,23,42,0.5)] backdrop-blur">
        <CardHeader className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-slate-600">
                <ShieldCheck className="h-3.5 w-3.5" />
                Timeline
              </div>
              {status ? (
                <Badge variant="outline" className="rounded-full border-slate-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">
                  {status}
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">{title}</CardTitle>
            {description ? <CardDescription className="max-w-3xl text-sm leading-6 text-slate-500">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">{actions}</div> : null}
        </CardHeader>

        {summary.length > 0 ? (
          <CardContent className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summary.map((item) => (
                <div key={item.label} className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{item.label}</div>
                  <div className="mt-2 break-words text-lg font-black tracking-tight text-slate-900">{item.value}</div>
                  {item.hint ? <div className="mt-1 text-xs leading-5 text-slate-500">{item.hint}</div> : null}
                </div>
              ))}
            </div>
          </CardContent>
        ) : null}

        <CardContent className="px-5 py-5 sm:px-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Event History</h3>
              </div>

              {timeline.length > 0 ? (
                <div className="space-y-3">
                  {timeline.map((event, index) => {
                    const metaEntries = scalarMetaEntries(event.meta)
                    return (
                      <div
                        key={`${event.timestamp || "event"}-${event.event_type || index}-${index}`}
                        className="relative flex gap-4 rounded-[1.5rem] border border-slate-200 bg-white px-4 py-4 shadow-sm"
                      >
                        <div className="relative flex flex-col items-center">
                          <div className="mt-1.5 h-3.5 w-3.5 rounded-full bg-indigo-500 ring-4 ring-indigo-100" />
                          {index < timeline.length - 1 ? <div className="mt-2 h-full w-px flex-1 bg-slate-200" /> : null}
                        </div>

                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="rounded-full border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-indigo-700">
                                  {event.event_type || "EVENT"}
                                </Badge>
                                {event.entity_type ? (
                                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-700">
                                    {event.entity_type}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="break-words text-sm font-semibold leading-6 text-slate-900">{event.message || "No message available."}</p>
                            </div>

                            <div className="shrink-0 text-right text-xs leading-5 text-slate-500">
                              <div className="font-semibold text-slate-700">{formatTimestamp(event.timestamp)}</div>
                              {event.actor ? <div className="mt-0.5 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">{event.actor}</div> : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {event.reference ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-semibold text-slate-600">
                                <Link2 className="h-3.5 w-3.5" />
                                {event.reference}
                              </span>
                            ) : null}
                            {typeof event.delta_qty_kg === "number" ? (
                              <span className={cn(
                                "inline-flex items-center rounded-full px-2.5 py-1 font-black uppercase tracking-[0.16em]",
                                event.delta_qty_kg >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700",
                              )}>
                                {event.delta_qty_kg >= 0 ? "+" : ""}
                                {Number(event.delta_qty_kg).toFixed(3)} kg
                              </span>
                            ) : null}
                          </div>

                          {metaEntries.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {metaEntries.map(([key, value]) => (
                                <span
                                  key={key}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                                >
                                  <span className="font-black uppercase tracking-[0.16em] text-slate-400">{formatKey(key)}:</span>
                                  <span className="truncate font-semibold text-slate-700">{String(value)}</span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                  <div className="font-semibold text-slate-700">{emptyTimelineTitle}</div>
                  <p className="mt-1 leading-6">{emptyTimelineDescription}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-black uppercase tracking-[0.22em] text-slate-500">Related Records</h3>
              </div>

              {relatedRecords.length > 0 ? (
                <div className="grid gap-3">
                  {relatedRecords.map((record) => {
                    const content = (
                      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                        <CardHeader className="space-y-2 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {record.type ? (
                              <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                                {record.type}
                              </Badge>
                            ) : null}
                            <span className="text-sm font-black text-slate-900">{record.label}</span>
                          </div>
                          <CardDescription className="break-words text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                            {record.reference}
                          </CardDescription>
                        </CardHeader>
                        {record.subtitle ? (
                          <CardContent className="px-4 pb-4 pt-0">
                            <p className="text-sm leading-6 text-slate-600">{record.subtitle}</p>
                          </CardContent>
                        ) : null}
                      </Card>
                    )

                    if (!record.href) return <div key={`${record.type || "related"}-${record.reference}`}>{content}</div>

                    return (
                      <Link key={`${record.type || "related"}-${record.reference}`} href={record.href} className="block">
                        {content}
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                  No related records were resolved for this entity.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
