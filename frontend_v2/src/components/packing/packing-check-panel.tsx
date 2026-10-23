"use client";

/**
 * Packing check: what the packing yard found against what the machine logged.
 *
 * Net packed = gross on the scale minus inner packs, gonny or carton, and tape/tags, as
 * stored on each sealed pack. Within the limits a closed check verifies the batch and
 * finished stock follows the packed figures; outside them the batch is held for dispatch
 * until a supervisor accepts it with a reason.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Scale, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { logisticsService, type PackingCheckSummary } from "@/services/logistics";

const REASONS: Array<{ code: string; label: string }> = [
  { code: "REJECTS", label: "Rejects found at pouching" },
  { code: "COUNT_ERROR", label: "Count error" },
  { code: "MACHINE_OVERLOG", label: "Machine over-logged" },
  { code: "SCALE_CHECK", label: "Scale checked" },
  { code: "OTHER", label: "Other" },
];

const num = (value: number | null | undefined, digits = 0) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const kg = (value: number | null | undefined) => `${num(value, 2)} kg`;
const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${value > 0 ? "+" : ""}${Number(value).toFixed(1)}%`;

function StatusPill({ status }: { status: PackingCheckSummary["status"] }) {
  const map: Record<string, { label: string; className: string }> = {
    OPEN: { label: "To check", className: "bg-surface-2 text-content-2" },
    VERIFIED: { label: "Verified", className: "bg-success-bg text-success-fg" },
    HELD: { label: "Held", className: "bg-warning-bg text-warning-fg" },
    ACCEPTED: { label: "Accepted", className: "bg-info-bg text-info-fg" },
  };
  const meta = map[status] || map.OPEN;
  return <span className={cn("rounded-full px-2 py-0.5 text-caption font-semibold", meta.className)}>{meta.label}</span>;
}

/** Held batches across every order, so a supervisor finds them without opening each order. */
export function PackingCheckHeldNotice({ onOpenOrder }: { onOpenOrder: (salesOrderId: string) => void }) {
  const queue = useQuery({
    queryKey: ["packing-check-queue", "ALL"],
    queryFn: ({ signal }) => logisticsService.getPackingCheckQueue(undefined, signal),
    refetchInterval: 30_000,
  });
  const held = (queue.data || []).filter((row) => row.status === "HELD");
  if (!held.length) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg"
      data-testid="packing-check-held-notice"
      role="status"
    >
      <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
      <span className="font-semibold">
        {held.length} batch{held.length === 1 ? "" : "es"} on hold at the packing check. A supervisor accepts with a reason before dispatch.
      </span>
      {held.slice(0, 6).map((row) => (
        <button
          key={row.fg_batch_id}
          type="button"
          disabled={!row.sales_order_id}
          onClick={() => row.sales_order_id && onOpenOrder(row.sales_order_id)}
          className="rounded-full border border-warning-border bg-surface-1 px-2.5 py-1 font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          {row.sales_order_no || "Order"} · {row.batch_number}
        </button>
      ))}
    </div>
  );
}

export function PackingCheckPanel({ salesOrderId }: { salesOrderId?: string }) {
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const queue = useQuery({
    queryKey: ["packing-check-queue", salesOrderId || "ALL"],
    queryFn: ({ signal }) => logisticsService.getPackingCheckQueue(salesOrderId, signal),
    refetchInterval: 30_000,
  });
  const rows = queue.data || [];

  return (
    <section className="rounded-xl border border-line bg-surface-1" data-testid="packing-check-panel" aria-labelledby="packing-check-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-content-3" aria-hidden />
          <div>
            <h2 id="packing-check-title" className="text-sm font-semibold text-content-1">
              Packing check · पैकिंग जाँच
            </h2>
            <p className="text-caption text-content-3">
              Packed pieces and net weight against what the machine logged. Packing material is taken off first.
            </p>
          </div>
        </div>
        <span className="text-caption text-content-3">{rows.filter((row) => row.status === "OPEN" || row.status === "HELD").length} to check</span>
      </div>
      {queue.isLoading ? (
        <div className="px-4 py-6 text-sm text-content-3">Loading batches…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-sm text-content-3">No packed batch is waiting for a check.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface-2 text-left text-caption uppercase tracking-wider text-content-3">
              <tr>
                <th className="px-4 py-2 font-semibold">Batch</th>
                <th className="px-3 py-2 text-right font-semibold">Machine logged</th>
                <th className="px-3 py-2 text-right font-semibold">Packed</th>
                <th className="px-3 py-2 text-right font-semibold">Difference</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.fg_batch_id} className="border-t border-line" data-testid={`packing-check-row-${row.batch_number}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs font-semibold text-content-1">{row.batch_number}</div>
                    <div className="truncate text-caption text-content-3">
                      {[row.sales_order_no, row.product].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {num(row.logged_pcs)} pcs
                    <div className="text-caption text-content-3">{kg(row.logged_kg)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {num(row.packed_pcs)} pcs
                    <div className="text-caption text-content-3">net {kg(row.net_kg)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {pct(row.pcs_variance_pct)}
                    <div className="text-caption text-content-3">{pct(row.kg_variance_pct)} kg</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant={row.status === "HELD" ? "default" : "outline"}
                      onClick={() => setOpenBatchId(row.fg_batch_id)}
                      data-testid={`packing-check-open-${row.batch_number}`}
                    >
                      {row.status === "OPEN" ? "Check" : row.status === "HELD" ? "Decide" : "View"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PackingCheckDialog fgBatchId={openBatchId} onClose={() => setOpenBatchId(null)} />
    </section>
  );
}

function PackingCheckDialog({ fgBatchId, onClose }: { fgBatchId: string | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sampleCount, setSampleCount] = useState("100");
  const [sampleGrams, setSampleGrams] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const check = useQuery({
    queryKey: ["packing-check", fgBatchId],
    queryFn: ({ signal }) => logisticsService.getPackingCheck(String(fgBatchId), signal),
    enabled: Boolean(fgBatchId),
  });
  const data = check.data;

  const refresh = async (next?: PackingCheckSummary) => {
    if (next) queryClient.setQueryData(["packing-check", fgBatchId], next);
    await queryClient.invalidateQueries({ queryKey: ["packing-check-queue"] });
    await queryClient.invalidateQueries({ queryKey: ["packing-board"] });
  };
  const onError = (err: any) =>
    toast({
      variant: "destructive",
      title: "Not saved",
      description: err?.response?.data?.error || err?.message || "Please try again.",
    });

  const sample = useMutation({
    mutationFn: () => logisticsService.recordPackingSample(String(fgBatchId), Number(sampleCount), Number(sampleGrams)),
    onSuccess: async (next) => {
      await refresh(next);
      toast({ title: "Sample saved", description: `${num(next.sample_weight_g, 2)} g per pouch` });
    },
    onError,
  });
  const close = useMutation({
    mutationFn: () => logisticsService.closePackingCheck(String(fgBatchId), note.trim() || undefined),
    onSuccess: async (next) => {
      await refresh(next);
      toast({
        title: next.status === "VERIFIED" ? "Batch verified" : "Batch held for a supervisor",
        description:
          next.status === "VERIFIED"
            ? `Finished stock follows the packed figures${next.shortfall_pcs ? `; ${num(next.shortfall_pcs)} pcs booked as packing loss` : ""}.`
            : "The difference is outside the limits. Dispatch waits until a supervisor accepts it.",
      });
    },
    onError,
  });
  const accept = useMutation({
    mutationFn: () => logisticsService.acceptPackingCheck(String(fgBatchId), reason, note.trim() || undefined),
    onSuccess: async (next) => {
      await refresh(next);
      toast({ title: "Accepted with reason", description: "The batch can be dispatched." });
    },
    onError,
  });

  const within = (value: number | null | undefined, limit: number) =>
    value === null || value === undefined || Math.abs(value) <= limit;

  return (
    <Dialog
      open={Boolean(fgBatchId)}
      onOpenChange={(open) => {
        if (!open) {
          setNote("");
          setReason("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" data-testid="packing-check-dialog">
        <DialogHeader>
          <DialogTitle>Packing check · {data?.batch_number || "…"}</DialogTitle>
          <DialogDescription>
            Net = scale weight minus inner packs, gonny or carton, and tape or tags. Limits: pieces ±{data?.limits.pcs_pct ?? 2}%, weight ±
            {data?.limits.kg_pct ?? 2}%.
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <div className="py-6 text-sm text-content-3">Loading…</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-line p-3">
                <div className="text-caption text-content-3">Machine logged</div>
                <div className="font-mono text-lg font-semibold">{num(data.logged_pcs)} pcs</div>
                <div className="text-caption tabular-nums text-content-3">
                  {kg(data.logged_kg)} · {num(data.logged_weight_per_pc_g, 2)} g each
                </div>
              </div>
              <div className="rounded-lg border border-line p-3">
                <div className="text-caption text-content-3">Packed and weighed</div>
                <div className="font-mono text-lg font-semibold">{num(data.packed_pcs)} pcs</div>
                <div className="text-caption tabular-nums text-content-3">
                  gross {kg(data.gross_kg)} − packing {kg(data.tare_kg)} = net {kg(data.net_kg)}
                </div>
              </div>
              <div
                className={cn(
                  "rounded-lg border p-3",
                  within(data.pcs_variance_pct, data.limits.pcs_pct) && within(data.kg_variance_pct, data.limits.kg_pct)
                    ? "border-success-border bg-success-bg/40"
                    : "border-warning-border bg-warning-bg/40",
                )}
              >
                <div className="text-caption text-content-3">Difference</div>
                <div className="font-mono text-lg font-semibold">{pct(data.pcs_variance_pct)} pcs</div>
                <div className="text-caption tabular-nums text-content-3">
                  {pct(data.kg_variance_pct)} kg
                  {data.weight_variance_pct !== null && data.weight_variance_pct !== undefined
                    ? ` · pouches ${pct(data.weight_variance_pct)} by weight`
                    : ""}
                </div>
              </div>
            </div>

            {data.units?.length ? (
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-surface-2 text-left text-caption uppercase tracking-wider text-content-3">
                    <tr>
                      <th className="px-3 py-2">Pack</th>
                      <th className="px-3 py-2 text-right">Pcs</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      <th className="px-3 py-2 text-right">Packing</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2 text-right">vs log</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.units.map((unit) => (
                      <tr key={unit.id} className="border-t border-line tabular-nums">
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {unit.label_id}
                          {unit.status === "OPEN" ? <span className="ml-1 text-caption text-warning-fg">open</span> : null}
                        </td>
                        <td className="px-3 py-1.5 text-right">{num(unit.qty_pcs)}</td>
                        <td className="px-3 py-1.5 text-right">{unit.gross_kg === null ? "—" : num(unit.gross_kg, 2)}</td>
                        <td className="px-3 py-1.5 text-right">{num(unit.tare_kg, 2)}</td>
                        <td className="px-3 py-1.5 text-right">{unit.net_kg === null ? "—" : num(unit.net_kg, 2)}</td>
                        <td className="px-3 py-1.5 text-right">{pct(unit.variance_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {data.status === "OPEN" ? (
              <div className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="text-sm">
                  <span className="mb-1 block text-caption font-semibold text-content-2">Pouches weighed</span>
                  <Input inputMode="numeric" value={sampleCount} onChange={(e) => setSampleCount(e.target.value)} data-testid="packing-sample-count" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-caption font-semibold text-content-2">Their total weight (g)</span>
                  <Input inputMode="decimal" value={sampleGrams} onChange={(e) => setSampleGrams(e.target.value)} data-testid="packing-sample-grams" />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={sample.isPending || !Number(sampleCount) || !Number(sampleGrams)}
                  onClick={() => sample.mutate()}
                  data-testid="packing-sample-save"
                >
                  <Scale className="mr-1.5 h-4 w-4" aria-hidden /> Save sample
                </Button>
                <p className="text-caption text-content-3 sm:col-span-3">
                  {data.sample_weight_g
                    ? `Sample: ${num(data.sample_weight_g, 3)} g per pouch from ${num(data.sample_size)} pouches. Pieces by weight: ${num(data.pcs_by_weight)}.`
                    : "Optional: weigh 100 pouches once to get the real weight per pouch."}
                </p>
              </div>
            ) : null}

            {data.inner_packs ? (
              <div className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-sm" data-testid="packing-check-inner-packs">
                <span className="font-semibold text-content-1">Inner pouches · </span>
                <span className="tabular-nums">
                  {data.inner_packs.capture_mode === "EVENING_COUNT"
                    ? `${num(data.inner_packs.consumed_at_machine)} filled at the machine (bought pouches) · ${num(data.inner_packs.used_in_units)} used in packs`
                    : `${num(data.inner_packs.consumed_at_machine)} taken at the machine · ${num(data.inner_packs.used_in_units)} used in packs`}
                </span>
                {data.inner_packs.left_for_count ? null : data.inner_packs.returned != null ? (
                  <span className="tabular-nums text-success-fg"> · {num(data.inner_packs.returned)} back to stock</span>
                ) : data.inner_packs.consumed_at_machine > data.inner_packs.used_in_units ? (
                  <span className="text-content-3">
                    {" "}· {num(data.inner_packs.consumed_at_machine - data.inner_packs.used_in_units)} unused go back to stock when the check closes
                  </span>
                ) : null}
                {data.inner_packs.capture_mode === "EVENING_COUNT" ? (
                  <p className="mt-1 text-caption text-content-3" data-testid="packing-check-inner-packs-count">
                    Bought inner pouches are taken off stock by the evening packing count, booked to this order.
                  </p>
                ) : data.inner_packs.left_for_count ? (
                  <p className="mt-1 text-caption text-warning-fg" data-testid="packing-check-inner-packs-count">
                    Not taken off stock at the machine ({data.inner_packs.left_for_count_reason || "stock book gap"}). The evening packing count settles these pouches for this order.
                  </p>
                ) : null}
              </div>
            ) : null}

            {data.status === "HELD" ? (
              <div className="space-y-2 rounded-lg border border-warning-border bg-warning-bg/40 p-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-warning-fg">
                  <ShieldAlert className="h-4 w-4" aria-hidden /> Held for dispatch. A supervisor accepts it with a reason.
                </div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Reason">
                  {REASONS.map((row) => (
                    <button
                      key={row.code}
                      type="button"
                      role="radio"
                      aria-checked={reason === row.code}
                      onClick={() => setReason(row.code)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        reason === row.code ? "border-primary bg-primary text-primary-foreground" : "border-line bg-surface-1",
                      )}
                      data-testid={`packing-accept-reason-${row.code}`}
                    >
                      {row.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {data.status === "VERIFIED" || data.status === "ACCEPTED" ? (
              <div className="flex items-start gap-2 rounded-lg border border-success-border bg-success-bg/40 p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-success-fg" aria-hidden />
                <div>
                  Finished stock follows the packed figures.
                  {data.shortfall_pcs ? ` ${num(data.shortfall_pcs)} pcs (${kg(data.shortfall_kg)}) booked as packing loss.` : ""}
                  {data.reason ? ` Reason: ${REASONS.find((row) => row.code === data.reason)?.label || data.reason}.` : ""}
                </div>
              </div>
            ) : null}

            {data.status === "OPEN" && data.unpacked_pcs > 0 ? (
              <div
                className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/40 p-3 text-sm text-warning-fg"
                data-testid="packing-check-unpacked-warning"
              >
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  {num(data.unpacked_pcs)} pcs of this batch are not packed yet. Close the check only when packing of this batch is
                  finished: pieces not packed by then count as short.
                </div>
              </div>
            ) : null}

            {data.status === "OPEN" || data.status === "HELD" ? (
              <label className="block text-sm">
                <span className="mb-1 block text-caption font-semibold text-content-2">Note{data.status === "HELD" && reason === "OTHER" ? " (needed)" : ", optional"}</span>
                <Input value={note} onChange={(e) => setNote(e.target.value)} data-testid="packing-check-note" />
              </label>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {data?.status === "OPEN" ? (
            <Button
              type="button"
              disabled={close.isPending || data.open_units > 0 || data.packed_pcs <= 0}
              onClick={() => close.mutate()}
              data-testid="packing-check-close"
              title={data.open_units > 0 ? "Seal or empty the open packs first" : undefined}
            >
              Close check
            </Button>
          ) : null}
          {data?.status === "HELD" ? (
            <Button
              type="button"
              disabled={accept.isPending || !reason || (reason === "OTHER" && !note.trim())}
              onClick={() => accept.mutate()}
              data-testid="packing-check-accept"
            >
              Accept with reason
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
