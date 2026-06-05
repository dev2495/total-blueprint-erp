"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Clock3, Link2, ShieldCheck } from "lucide-react";

export interface TimelineEventLike {
  timestamp?: string;
  actor?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  event_type?: string | null;
  message?: string | null;
  reference?: string | null;
  delta_qty_kg?: number | null;
  meta?: Record<string, any> | null;
}

export interface RelatedRecordLike {
  type?: string;
  reference: string;
  label: string;
  subtitle?: string | null;
  href?: string | null;
}

export interface SummaryItemLike {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

type RecordTimelinePanelProps = {
  title: string;
  description?: string;
  status?: ReactNode;
  summary?: SummaryItemLike[];
  timeline?: TimelineEventLike[];
  relatedRecords?: RelatedRecordLike[];
  actions?: ReactNode;
  emptyTimelineTitle?: string;
  emptyTimelineDescription?: string;
  dataTestId?: string;
};

function formatTimestamp(value?: string | null) {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatKey(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function isScalar(value: any) {
  return (
    value == null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function scalarMetaEntries(meta?: Record<string, any> | null) {
  if (!meta || typeof meta !== "object") return [];
  return Object.entries(meta)
    .filter(([, value]) => isScalar(value))
    .slice(0, 5);
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
      <Card className="overflow-hidden border-line bg-surface-1/90 shadow-[0_24px_60px_-52px_rgba(15,23,42,0.5)] backdrop-blur">
        <CardHeader className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-content-3">
                <ShieldCheck className="h-3.5 w-3.5" />
                Timeline
              </div>
              {status ? (
                <Badge
                  variant="outline"
                  className="rounded-full border-line bg-surface-1 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-content-2"
                >
                  {status}
                </Badge>
              ) : null}
            </div>
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="max-w-3xl text-sm leading-6 text-content-3">
                {description}
              </CardDescription>
            ) : null}
          </div>
          {actions ? (
            <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              {actions}
            </div>
          ) : null}
        </CardHeader>

        {summary.length > 0 ? (
          <CardContent className="border-b border-line px-5 py-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summary.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[1.4rem] border border-line bg-surface-2 px-4 py-4"
                >
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                    {item.label}
                  </div>
                  <div className="mt-2 break-words text-lg font-black tracking-tight text-content-1">
                    {item.value}
                  </div>
                  {item.hint ? (
                    <div className="mt-1 text-xs leading-5 text-content-3">
                      {item.hint}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        ) : null}

        <CardContent className="px-5 py-5 sm:px-6">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(18rem,0.85fr)]">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.22em] text-content-3">
                  Event History
                </h3>
              </div>

              {timeline.length > 0 ? (
                <div className="space-y-3">
                  {timeline.map((event, index) => {
                    const metaEntries = scalarMetaEntries(event.meta);
                    return (
                      <div
                        key={`${event.timestamp || "event"}-${event.event_type || index}-${index}`}
                        className="relative flex gap-4 rounded-[1.5rem] border border-line bg-surface-1 px-4 py-4 shadow-sm"
                      >
                        <div className="relative flex flex-col items-center">
                          <div className="mt-1.5 h-3.5 w-3.5 rounded-full bg-primary ring-4 ring-info-border" />
                          {index < timeline.length - 1 ? (
                            <div className="mt-2 h-full w-px flex-1 bg-line" />
                          ) : null}
                        </div>

                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-info-border bg-info-bg px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-primary"
                                >
                                  {event.event_type || "EVENT"}
                                </Badge>
                                {event.entity_type ? (
                                  <Badge
                                    variant="outline"
                                    className="rounded-full border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-content-2"
                                  >
                                    {event.entity_type}
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="break-words text-sm font-semibold leading-6 text-content-1">
                                {event.message || "No message available."}
                              </p>
                            </div>

                            <div className="shrink-0 text-right text-xs leading-5 text-content-3">
                              <div className="font-semibold text-content-2">
                                {formatTimestamp(event.timestamp)}
                              </div>
                              {event.actor ? (
                                <div className="mt-0.5 text-[11px] font-black uppercase tracking-[0.18em] text-content-4">
                                  {event.actor}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {event.reference ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 font-semibold text-content-3">
                                <Link2 className="h-3.5 w-3.5" />
                                {event.reference}
                              </span>
                            ) : null}
                            {typeof event.delta_qty_kg === "number" ? (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-2.5 py-1 font-black uppercase tracking-[0.16em]",
                                  event.delta_qty_kg >= 0
                                    ? "bg-success-bg text-success-fg"
                                    : "bg-danger-bg text-danger-fg",
                                )}
                              >
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
                                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-content-3"
                                >
                                  <span className="font-black uppercase tracking-[0.16em] text-content-4">
                                    {formatKey(key)}:
                                  </span>
                                  <span className="truncate font-semibold text-content-2">
                                    {String(value)}
                                  </span>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-line bg-surface-2 px-5 py-8 text-sm text-content-3">
                  <div className="font-semibold text-content-2">
                    {emptyTimelineTitle}
                  </div>
                  <p className="mt-1 leading-6">{emptyTimelineDescription}</p>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-black uppercase tracking-[0.22em] text-content-3">
                  Related Records
                </h3>
              </div>

              {relatedRecords.length > 0 ? (
                <div className="grid gap-3">
                  {relatedRecords.map((record) => {
                    const content = (
                      <Card className="overflow-hidden border-line bg-surface-1 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
                        <CardHeader className="space-y-2 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            {record.type ? (
                              <Badge
                                variant="outline"
                                className="rounded-full border-line bg-surface-2 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-content-3"
                              >
                                {record.type}
                              </Badge>
                            ) : null}
                            <span className="text-sm font-black text-content-1">
                              {record.label}
                            </span>
                          </div>
                          <CardDescription className="break-words text-xs font-semibold uppercase tracking-[0.18em] text-content-3">
                            {record.reference}
                          </CardDescription>
                        </CardHeader>
                        {record.subtitle ? (
                          <CardContent className="px-4 pb-4 pt-0">
                            <p className="text-sm leading-6 text-content-3">
                              {record.subtitle}
                            </p>
                          </CardContent>
                        ) : null}
                      </Card>
                    );

                    if (!record.href)
                      return (
                        <div
                          key={`${record.type || "related"}-${record.reference}`}
                        >
                          {content}
                        </div>
                      );

                    return (
                      <Link
                        key={`${record.type || "related"}-${record.reference}`}
                        href={record.href}
                        className="block"
                      >
                        {content}
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-dashed border-line bg-surface-2 px-5 py-8 text-sm text-content-3">
                  No related records were resolved for this entity.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
