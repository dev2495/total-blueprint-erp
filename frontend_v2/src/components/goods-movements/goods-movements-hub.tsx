"use client";

/**
 * Goods in & out: one register of everything of ours outside a factory gate and what is due back.
 * Inter-plant transfers, job work and gate passes keep their own papers and screens; this page
 * lists them together by stage (prepared, outside, back at the gate, done), flags what is late,
 * lets the store record "back at the gate" when the watchman could not scan, and opens the right
 * form for a new movement.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  DoorOpen,
  Factory,
  PackageOpen,
  Plus,
  Search,
  Ticket,
  Truck,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/components/layout/use-nav-access";
import { cn } from "@/lib/utils";
import { goodsMovementsApi, type MovementKind, type MovementRow, type MovementStage } from "@/services/goods-movements";

const PAGE_SIZE = 40;

const STAGES: Array<{ key: MovementStage; label: string; hint: string; icon: React.ElementType }> = [
  { key: "OUTSIDE", label: "Outside", hint: "In transit, at a job worker or out on a pass", icon: Truck },
  { key: "AT_GATE", label: "Back at gate", hint: "Arrived; the store still has to receive it", icon: DoorOpen },
  { key: "PREPARED", label: "Prepared", hint: "Paper made; the goods have not left yet", icon: PackageOpen },
  { key: "DONE", label: "Done", hint: "Received, returned or closed", icon: CircleCheck },
];

const KIND_META: Record<MovementKind, { label: string; short: string; tone: string; icon: React.ElementType }> = {
  INTERPLANT: { label: "Inter-plant transfer", short: "Inter-plant", tone: "bg-info-bg text-info-fg ring-info-border", icon: ArrowRightLeft },
  JOBWORK: { label: "Job work", short: "Job work", tone: "bg-order-bg text-order-fg ring-order-border", icon: Factory },
  RGP: { label: "Returnable gate pass", short: "Returnable", tone: "bg-success-bg text-success-fg ring-success-border", icon: Wrench },
  NRGP: { label: "Non-returnable gate pass", short: "Non-returnable", tone: "bg-surface-2 text-content-2 ring-line", icon: Ticket },
};

const DATE = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
const DATE_TIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function when(value: string | null, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : (withTime ? DATE_TIME : DATE).format(d);
}

function daysFrom(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function token() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export function GoodsMovementsHub() {
  const can = useHasPermission();
  const [stage, setStage] = useState<MovementStage>("OUTSIDE");
  const [kind, setKind] = useState<MovementKind | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = window.setTimeout(() => setSearch(searchText.trim()), 250);
    return () => window.clearTimeout(id);
  }, [searchText]);
  useEffect(() => setPage(1), [stage, kind, overdueOnly, search]);

  const registerQ = useQuery({
    queryKey: ["goods-movements", stage, kind, overdueOnly, search, page],
    queryFn: () => goodsMovementsApi.register({ stage, kind, overdue: overdueOnly, q: search, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const data = registerQ.data;
  const rows = data?.results ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const openTotal = useMemo(() => Object.values(data?.open_by_kind ?? {}).reduce((sum, n) => sum + n, 0), [data]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="goods-movements">
      <section className="rounded-2xl border border-line bg-surface-1 px-5 py-4 shadow-sm sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-content-3">Inventory · gate</div>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.01em] text-content-1">Goods in &amp; out</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-5 text-content-3">
              Everything of ours outside a factory gate and what is due back: transfers between our factories, job work and gate passes. Each
              keeps its own paper; this page shows them together.
            </p>
          </div>
          {can("inventory.manage") || can("gatepass.manage") ? <NewMovementMenu canGatePass={can("gatepass.manage")} canInventory={can("inventory.manage")} /> : null}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" role="tablist" aria-label="Stage">
          {STAGES.map(({ key, label, hint, icon: Icon }) => {
            const active = stage === key;
            const count = data?.counts?.[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setStage(key)}
                className={cn(
                  "flex min-h-[64px] items-start gap-3 rounded-xl px-3.5 py-2.5 text-left ring-1 transition-colors",
                  active ? "bg-info-bg ring-info-border" : "bg-surface-2 ring-line hover:bg-surface-1",
                )}
                data-testid={`goods-stage-${key.toLowerCase()}`}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 flex-none", active ? "text-info-fg" : "text-content-3")} aria-hidden />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("text-[14px] font-semibold", active ? "text-info-fg" : "text-content-1")}>{label}</span>
                    <span className="text-[18px] font-semibold tabular-nums text-content-1">{registerQ.isLoading ? "…" : count}</span>
                  </span>
                  <span className="block text-[12px] leading-4 text-content-3">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search number, party, vehicle, job…"
              aria-label="Search movements"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Paper type">
            <KindChip active={!kind} onClick={() => setKind("")} label="All" count={stage === "DONE" ? undefined : openTotal} />
            {(Object.keys(KIND_META) as MovementKind[]).map((k) => (
              <KindChip key={k} active={kind === k} onClick={() => setKind(kind === k ? "" : k)} label={KIND_META[k].short} count={stage === "DONE" ? undefined : data?.open_by_kind?.[k]} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setOverdueOnly((v) => !v)}
            aria-pressed={overdueOnly}
            className={cn(
              "ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ring-1 transition-colors",
              overdueOnly ? "bg-danger-bg text-danger-fg ring-danger-border" : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
            )}
            data-testid="goods-overdue-toggle"
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden /> Late · {data?.overdue ?? 0}
          </button>
        </div>

        {registerQ.isError ? (
          <div role="alert" className="m-4 rounded-xl border border-danger-border bg-danger-bg p-4 text-[13.5px] text-danger-fg">
            The register could not be loaded.{" "}
            <button type="button" className="font-semibold underline" onClick={() => registerQ.refetch()}>
              Try again
            </button>
          </div>
        ) : registerQ.isLoading ? (
          <div className="space-y-2 p-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyStage stage={stage} filtered={Boolean(kind || search || overdueOnly)} />
        ) : (
          <ul className="divide-y divide-line" data-testid="goods-rows">
            {rows.map((row) => (
              <MovementRowItem key={`${row.kind}-${row.id}`} row={row} canRecord={can("documents.manage")} />
            ))}
          </ul>
        )}

        {pages > 1 ? (
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12.5px] text-content-3">
            <span className="tabular-nums">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data?.total ?? 0)} of {data?.total ?? 0}
            </span>
            <span className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-9" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 tabular-nums">
                {page} / {pages}
              </span>
              <Button variant="outline" size="sm" className="h-9" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </span>
          </div>
        ) : null}
      </section>
      {stage === "DONE" ? (
        <p className="px-1 text-[12px] text-content-3">Done shows the last {data?.done_window_days ?? 60} days; search finds older papers.</p>
      ) : null}
    </div>
  );
}

function KindChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold ring-1 transition-colors",
        active ? "bg-primary text-white ring-primary" : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
      )}
    >
      {label}
      {count !== undefined ? <span className={cn("tabular-nums", active ? "text-white/85" : "text-content-3")}>{count}</span> : null}
    </button>
  );
}

function MovementRowItem({ row, canRecord }: { row: MovementRow; canRecord: boolean }) {
  const meta = KIND_META[row.kind];
  const Icon = meta.icon;
  const outFor = daysFrom(row.left_at);
  return (
    <li className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,2.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center" data-testid="goods-row">
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn("mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-lg ring-1", meta.tone)} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={row.link} className="font-mono text-[13.5px] font-semibold text-content-1 hover:underline">
              {row.number}
            </Link>
            <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1", meta.tone)}>{meta.short}</span>
            {row.auto ? <span className="text-[11.5px] text-content-3">{row.kind === "JOBWORK" ? "route step" : "from production"}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[13.5px] font-medium text-content-1" title={row.party}>
            {row.party || "—"}
          </div>
          <div className="truncate text-[12.5px] text-content-3" title={row.summary}>
            {row.summary}
            {row.job_number ? <span className="font-mono"> · {row.job_number}</span> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[12.5px] md:block md:space-y-0.5">
        <div>
          <span className="text-content-3">Left </span>
          <span className="tabular-nums text-content-1">{when(row.left_at, true)}</span>
          {row.left_at && !row.left_at_gate && row.stage !== "PREPARED" ? <span className="ml-1 text-content-3">(no gate scan)</span> : null}
        </div>
        <div>
          {row.back_at_gate_at ? (
            <>
              <span className="text-content-3">At gate </span>
              <span className="tabular-nums text-content-1">{when(row.back_at_gate_at, true)}</span>
            </>
          ) : row.expected_back ? (
            <>
              <span className="text-content-3">Due back </span>
              <span className="tabular-nums text-content-1">{when(row.expected_back)}</span>
            </>
          ) : outFor !== null && row.stage === "OUTSIDE" ? (
            <span className="text-content-3">Out {outFor} day{outFor === 1 ? "" : "s"}</span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[12px] font-medium text-content-2 ring-1 ring-line">{row.status_label}</span>
        {row.overdue ? (
          <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-[12px] font-semibold text-danger-fg ring-1 ring-danger-border" title={row.late_note}>
            Late
          </span>
        ) : null}
        {row.late_note && !row.overdue ? <span className="text-[12px] text-warning-fg">{row.late_note}</span> : null}
      </div>

      <div className="flex items-center gap-2 md:justify-end">
        {row.arrival && canRecord ? <BackAtGateButton row={row} /> : null}
        <Button asChild variant="outline" size="sm" className="h-9 rounded-lg">
          <Link href={row.link}>{row.stage === "AT_GATE" ? "Receive" : "Open"}</Link>
        </Button>
      </div>
    </li>
  );
}

function BackAtGateButton({ row }: { row: MovementRow }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [vehicle, setVehicle] = useState(row.vehicle || "");
  const [clientToken, setClientToken] = useState(token);
  const record = useMutation({
    mutationFn: () =>
      goodsMovementsApi.recordArrival({
        plant: row.arrival!.plant,
        kind: row.arrival!.kind,
        object_id: row.arrival!.object_id,
        vehicle_number: vehicle,
        notes: "Recorded from Goods in & out",
        client_token: clientToken,
      }),
    onSuccess: () => {
      toast({ title: "Marked back at the gate", description: `${row.number} · the store has been told to receive it.` });
      setOpen(false);
      setClientToken(token());
      qc.invalidateQueries({ queryKey: ["goods-movements"] });
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { code?: string[] | string; detail?: string } } })?.response?.data;
      const message = Array.isArray(detail?.code) ? detail?.code[0] : detail?.code || detail?.detail || "It could not be recorded.";
      toast({ title: "Not recorded", description: String(message), variant: "destructive" });
    },
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-lg" data-testid="goods-back-at-gate">
          <DoorOpen className="mr-1.5 h-4 w-4" aria-hidden /> Back at gate
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="text-[14px] font-semibold text-content-1">Record {row.number} back at the gate</div>
        <p className="mt-1 text-[12.5px] leading-5 text-content-3">
          For when the watchman could not scan the paper. Nothing moves in stock; the store is told to receive it.
        </p>
        <label className="mt-3 block text-[12.5px] font-medium text-content-2" htmlFor={`veh-${row.id}`}>
          Vehicle number (optional)
        </label>
        <Input id={`veh-${row.id}`} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} className="mt-1 h-10 font-mono" />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => record.mutate()} disabled={record.isPending}>
            {record.isPending ? "Saving…" : "Mark back at gate"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NewMovementMenu({ canGatePass, canInventory }: { canGatePass: boolean; canInventory: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="h-10 rounded-[10px]" data-testid="goods-new-movement">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New movement
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>What is leaving?</DropdownMenuLabel>
        {canInventory ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/inventory/inter-plant" className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-semibold">Stock to another of our factories</span>
                <span className="text-[12px] text-content-3">Inter-plant challan</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/inventory/job-work" className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-semibold">Material to a job worker</span>
                <span className="text-[12px] text-content-3">Job-work order and challan (GST Rule 45)</span>
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        {canGatePass ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/inventory/gate-passes/new?kind=RETURNABLE" className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-semibold">A part or tool that comes back</span>
                <span className="text-[12px] text-content-3">Returnable gate pass: repair, calibration, trial</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/inventory/gate-passes/new?kind=NON_RETURNABLE" className="flex flex-col items-start gap-0.5 py-2">
                <span className="font-semibold">Something that does not come back</span>
                <span className="text-[12px] text-content-3">Non-returnable gate pass: scrap, sample, supplier return</span>
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/logistics/dispatch" className="flex flex-col items-start gap-0.5 py-2">
            <span className="font-semibold">Goods to a customer</span>
            <span className="text-[12px] text-content-3">Dispatch bay: delivery challan and invoice</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyStage({ stage, filtered }: { stage: MovementStage; filtered: boolean }) {
  const copy: Record<MovementStage, string> = {
    OUTSIDE: "Nothing of ours is outside a gate right now.",
    AT_GATE: "Nothing is waiting at a gate to be received.",
    PREPARED: "No paper is waiting for its goods to leave.",
    DONE: "Nothing finished in the last 60 days.",
  };
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      <CircleCheck className="h-7 w-7 text-success-fg" aria-hidden />
      <div className="mt-2 text-[15px] font-semibold text-content-1">{filtered ? "No movement matches these filters" : copy[stage]}</div>
      <p className="mt-1 max-w-sm text-[13px] text-content-3">
        {filtered ? "Clear the search or the paper-type chips to see everything in this stage." : "New inter-plant challans, job work and gate passes appear here as soon as they are made."}
      </p>
    </div>
  );
}
