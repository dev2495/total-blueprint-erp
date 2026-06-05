"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Calendar,
  Copy,
  Download,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import {
  quotationService,
  QUOTATION_STATUSES,
  type QuotationListItem,
  type QuotationStatus,
} from "@/services/quotation";

const STATUS_STYLES: Record<
  QuotationStatus,
  { label: string; chip: string; dot: string }
> = {
  DRAFT: {
    label: "Draft",
    chip: "bg-surface-2 text-content-2 ring-1 ring-line",
    dot: "bg-line",
  },
  SENT: {
    label: "Sent",
    chip: "bg-info-bg text-info-fg ring-1 ring-info-border",
    dot: "bg-info-fg",
  },
  APPROVED: {
    label: "Approved",
    chip: "bg-success-bg text-success-fg ring-1 ring-success-border",
    dot: "bg-success-fg",
  },
  REJECTED: {
    label: "Rejected",
    chip: "bg-danger-bg text-danger-fg ring-1 ring-danger-border",
    dot: "bg-danger-solid",
  },
  EXPIRED: {
    label: "Expired",
    chip: "bg-warning-bg text-warning-fg ring-1 ring-warning-border",
    dot: "bg-warning-fg",
  },
  CONVERTED: {
    label: "Converted",
    chip: "bg-order-bg text-order-fg ring-1 ring-order-border",
    dot: "bg-order-fg",
  },
};

function formatInr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const n = Math.round(value * 100) / 100;
  const [whole, frac = "00"] = n.toFixed(2).split(".");
  if (whole.length <= 3) return `${whole}.${frac}`;
  const last3 = whole.slice(-3);
  let rest = whole.slice(0, -3);
  const chunks: string[] = [];
  while (rest.length > 2) {
    chunks.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) chunks.unshift(rest);
  return `${chunks.join(",")},${last3}.${frac}`;
}

function totalsValue(q: QuotationListItem): number {
  const totals = (q.totals_snapshot || {}) as Record<string, unknown>;
  const raw =
    (totals.grand_total as number) ??
    (totals.net_total as number) ??
    (totals.subtotal as number) ??
    0;
  return typeof raw === "number" ? raw : Number(raw) || 0;
}

type DateFilter = "ALL" | "THIS_MONTH" | "LAST_MONTH";

export default function QuotationListPage() {
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | "ALL">(
    "ALL",
  );
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const quoteQuery = useQuery({
    queryKey: ["quotations", "list"],
    queryFn: () => quotationService.list(),
  });

  const quotes = quoteQuery.data || [];

  const bulkCloneMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => quotationService.cloneRevision(id)));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] });
      toast({
        title: "Bulk clone done",
        description: `Cloned ${selected.size} quote(s).`,
      });
      setSelected(new Set());
    },
    onError: (e: Error) =>
      toast({
        title: "Bulk clone failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const bulkExpireMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => quotationService.expire(id)));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] });
      toast({ title: "Bulk expire done" });
      setSelected(new Set());
    },
    onError: (e: Error) =>
      toast({
        title: "Bulk expire failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const kpis = useMemo(() => {
    const acc: Record<string, { count: number; value: number }> = {};
    for (const s of QUOTATION_STATUSES) acc[s] = { count: 0, value: 0 };
    for (const q of quotes) {
      const s = (q.status as QuotationStatus) || "DRAFT";
      if (!acc[s]) acc[s] = { count: 0, value: 0 };
      acc[s].count += 1;
      acc[s].value += totalsValue(q);
    }
    return acc;
  }, [quotes]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
    const lastMonth = (thisMonth + 11) % 12;
    const lastYear = thisMonth === 0 ? thisYear - 1 : thisYear;
    return quotes.filter((q) => {
      if (statusFilter !== "ALL" && q.status !== statusFilter) return false;
      if (dateFilter !== "ALL") {
        const dt = q.created_at ? new Date(q.created_at) : null;
        if (!dt || Number.isNaN(dt.getTime())) return false;
        if (dateFilter === "THIS_MONTH") {
          if (dt.getMonth() !== thisMonth || dt.getFullYear() !== thisYear)
            return false;
        } else if (dateFilter === "LAST_MONTH") {
          if (dt.getMonth() !== lastMonth || dt.getFullYear() !== lastYear)
            return false;
        }
      }
      if (!term) return true;
      return (
        (q.quote_number || "").toLowerCase().includes(term) ||
        (q.customer_name || "").toLowerCase().includes(term)
      );
    });
  }, [quotes, statusFilter, search, dateFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8 space-y-6">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-order-fg via-order-fg to-order-fg p-6 text-white shadow-[0_24px_60px_-36px_rgba(79,70,229,0.6)]">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-surface-1/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-20 h-56 w-56 rounded-full bg-order-fg blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.22em] text-order-border">
              <span className="h-2 w-2 rounded-full bg-success-fg" />
              Quotations · Workspace v37
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mt-1.5 flex items-center gap-3">
              <Sparkles className="h-7 w-7" strokeWidth={2.2} />
              Quotations
            </h1>
            <p className="text-sm font-semibold text-order-border mt-1">
              Quote any pouch — catalog or ad-hoc. Live BOM &amp; costing.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sales/quotations/new"
              className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-surface-1 text-order-fg font-extrabold text-sm hover:bg-order-bg shadow-md"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New Quotation
            </Link>
          </div>
        </div>
      </section>

      {/* KPI tiles */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["DRAFT", "SENT", "APPROVED", "CONVERTED"] as QuotationStatus[]).map(
          (s) => {
            const k = kpis[s] || { count: 0, value: 0 };
            const style = STATUS_STYLES[s];
            return (
              <div
                key={s}
                className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]"
              >
                <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                  {style.label}
                </div>
                <div className="mt-2 text-2xl font-extrabold text-content-1 font-mono">
                  {k.count}
                </div>
                <div className="mt-0.5 text-[12px] font-semibold text-content-3 font-mono">
                  ₹ {formatInr(k.value)}
                </div>
              </div>
            );
          },
        )}
      </section>

      {/* Filters */}
      <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 space-y-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="h-4 w-4 text-content-4" />
            <input
              type="text"
              placeholder="Search by QT number or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 h-10 rounded-xl border border-line px-3 text-sm font-semibold outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              ["ALL", ...QUOTATION_STATUSES] as Array<QuotationStatus | "ALL">
            ).map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition ${
                    active
                      ? "bg-surface-3 text-white ring-line-strong"
                      : "bg-surface-2 text-content-3 ring-line hover:bg-surface-2"
                  }`}
                >
                  {s === "ALL"
                    ? "All"
                    : STATUS_STYLES[s as QuotationStatus].label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-content-4" />
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
              Date
            </span>
          </div>
          {(
            [
              ["ALL", "All time"],
              ["THIS_MONTH", "This month"],
              ["LAST_MONTH", "Last month"],
            ] as Array<[DateFilter, string]>
          ).map(([id, label]) => {
            const active = dateFilter === id;
            return (
              <button
                key={id}
                onClick={() => setDateFilter(id)}
                className={`h-7 px-2.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition ${
                  active
                    ? "bg-brand-navy text-white ring-brand-navy"
                    : "bg-surface-2 text-content-3 ring-line hover:bg-surface-2"
                }`}
              >
                {label}
              </button>
            );
          })}
          {selected.size > 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-content-2">
                {selected.size} selected
              </span>
              <button
                onClick={() => bulkCloneMut.mutate(Array.from(selected))}
                disabled={bulkCloneMut.isPending}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full bg-order-bg text-order-fg ring-1 ring-order-border font-extrabold text-[11px] uppercase hover:bg-order-bg disabled:opacity-60"
              >
                {bulkCloneMut.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Clone
              </button>
              <button
                onClick={() => bulkExpireMut.mutate(Array.from(selected))}
                disabled={bulkExpireMut.isPending}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full bg-warning-bg text-warning-fg ring-1 ring-warning-border font-extrabold text-[11px] uppercase hover:bg-warning-bg disabled:opacity-60"
              >
                {bulkExpireMut.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : null}
                Mark expired
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="h-8 px-3 rounded-full text-content-3 hover:bg-surface-2 text-[11px] font-bold uppercase"
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {/* Quote cards */}
      <section className="space-y-3">
        {quoteQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-4 w-4 rounded bg-line" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-24 rounded bg-line" />
                    <div className="h-3 w-48 rounded bg-surface-2" />
                    <div className="h-2.5 w-32 rounded bg-surface-2" />
                  </div>
                  <div className="h-3 w-20 rounded bg-line" />
                </div>
              </div>
            ))}
          </div>
        ) : quoteQuery.isError ? (
          <div className="rounded-2xl bg-danger-bg ring-1 ring-danger-border p-8 text-center">
            <div className="text-sm font-extrabold text-danger-fg">
              Couldn&apos;t load quotations.
            </div>
            <button
              onClick={() => quoteQuery.refetch()}
              className="mt-3 inline-flex items-center gap-2 h-9 px-3 rounded-lg bg-danger-solid text-white font-extrabold text-xs uppercase hover:bg-danger-solid"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 && quotes.length === 0 ? (
          <div className="rounded-2xl bg-gradient-to-br from-order-bg via-white to-order-bg ring-1 ring-order-border p-12 text-center">
            <div className="mx-auto h-20 w-20 rounded-3xl bg-gradient-to-br from-order-fg via-order-fg to-order-fg flex items-center justify-center text-white shadow-md">
              <Sparkles className="h-9 w-9" />
            </div>
            <div className="mt-4 text-lg font-extrabold text-content-1">
              No quotations yet
            </div>
            <p className="mt-1 text-sm font-semibold text-content-3">
              Start your first quote — pick a customer, build the BOM, send the
              PDF.
            </p>
            <Link
              href="/sales/quotations/new"
              className="mt-5 inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-gradient-to-br from-order-fg via-order-fg to-order-fg text-white font-extrabold text-sm hover:opacity-95 shadow-md"
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              Start your first quote
            </Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-surface-1 ring-1 ring-line p-10 text-center">
            <FileText
              className="h-10 w-10 mx-auto text-content-4"
              strokeWidth={1.5}
            />
            <div className="mt-3 text-sm font-bold text-content-2">
              No quotations match these filters.
            </div>
            <button
              onClick={() => {
                setStatusFilter("ALL");
                setSearch("");
                setDateFilter("ALL");
              }}
              className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-xl bg-surface-2 text-content-2 font-bold text-xs uppercase hover:bg-line"
            >
              Clear filters
            </button>
          </div>
        ) : (
          filtered.map((q) => {
            const style =
              STATUS_STYLES[(q.status as QuotationStatus) || "DRAFT"];
            const value = totalsValue(q);
            const isSelected = selected.has(q.id);
            return (
              <div
                key={q.id}
                className={`group block rounded-2xl bg-surface-1 ring-1 p-4 transition shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)] ${
                  isSelected
                    ? "ring-order-border"
                    : "ring-line hover:ring-order-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-3 justify-between">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(q.id)}
                    className="h-4 w-4 accent-order-fg"
                    aria-label={`Select ${q.quote_number}`}
                  />
                  <Link
                    href={`/sales/quotations/${q.id}`}
                    className="flex-1 min-w-0"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-base font-extrabold text-content-1">
                          {q.quote_number}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider ${style.chip}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${style.dot}`}
                          />
                          {style.label}
                        </span>
                        {q.revision_no > 1 ? (
                          <span className="inline-flex items-center h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-warning-bg text-warning-fg ring-1 ring-warning-border">
                            REV {q.revision_no}
                          </span>
                        ) : null}
                        {(() => {
                          const cnt = Array.isArray(q.items)
                            ? q.items.length
                            : null;
                          if (cnt === null) return null;
                          return (
                            <span className="inline-flex items-center h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-order-bg text-order-fg ring-1 ring-order-border">
                              {cnt} lines
                            </span>
                          );
                        })()}
                        {(() => {
                          if (!q.valid_until) return null;
                          const days = Math.ceil(
                            (new Date(q.valid_until).getTime() - Date.now()) /
                              86400000,
                          );
                          if (Number.isNaN(days)) return null;
                          const color =
                            days < 0
                              ? "bg-danger-bg text-danger-fg ring-danger-border"
                              : days <= 7
                                ? "bg-warning-bg text-warning-fg ring-warning-border"
                                : "bg-success-bg text-success-fg ring-success-border";
                          const label =
                            days < 0
                              ? `expired ${-days}d ago`
                              : days === 0
                                ? "expires today"
                                : `${days}d left`;
                          return (
                            <span
                              className={`inline-flex items-center h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider ring-1 ${color}`}
                            >
                              {label}
                            </span>
                          );
                        })()}
                      </div>
                      <div className="text-sm font-bold text-content-2 truncate">
                        {q.customer_name}
                      </div>
                      <div className="text-[11px] font-semibold text-content-3 font-mono">
                        Valid until {q.valid_until || "—"} · Updated{" "}
                        {new Date(q.updated_at).toLocaleDateString()}
                      </div>
                    </div>
                  </Link>
                  <a
                    href={quotationService.pdfUrl(q.id)}
                    target="_blank"
                    rel="noopener"
                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-content-3 hover:bg-surface-2 hover:text-order-fg"
                    title="Preview PDF"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                  <Link
                    href={`/sales/quotations/${q.id}`}
                    className="flex items-center gap-3"
                  >
                    <div className="text-right">
                      <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                        Total
                      </div>
                      <div className="font-mono text-lg font-extrabold text-content-1">
                        ₹ {formatInr(value)}
                      </div>
                    </div>
                    <ArrowUpRight
                      className="h-5 w-5 text-content-4 group-hover:text-order-fg transition"
                      strokeWidth={2}
                    />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </section>
    </main>
  );
}
