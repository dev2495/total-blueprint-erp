"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, History, Palette, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { plannerService, type PlannerControlOrder, type PlannerOrderKind } from "@/services/planner";

function colorNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((row: any) => String(row?.name || row?.color_name || row || "").trim().toUpperCase()).filter(Boolean)
    : [];
}

function sideDraft(snapshot: any, side: "front" | "back") {
  const count = Number(snapshot?.[`${side}_colors_count`] || 0);
  const values = colorNames(snapshot?.[`${side}_colors`]);
  return Array.from({ length: count }, (_, index) => values[index] || "");
}

export function PrintColorRevisionDialog({
  order,
  onClose,
  onCommitted,
}: {
  order: PlannerControlOrder | null;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const snapshot = useMemo(() => order?.printing_snapshot || {}, [order]);
  const initialFront = useMemo(() => sideDraft(snapshot, "front"), [snapshot]);
  const initialBack = useMemo(() => sideDraft(snapshot, "back"), [snapshot]);
  const [front, setFront] = useState<string[]>([]);
  const [back, setBack] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  useEffect(() => {
    setFront(initialFront);
    setBack(initialBack);
    setReason("");
  }, [order?.order_id, order?.sales_order_item_id, initialFront, initialBack]);

  const previousRevision = snapshot?.color_revision || null;
  const mutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Select an order.");
      return plannerService.revisePrintColors(order.order_kind as PlannerOrderKind, order.order_id, {
        item_id: order.sales_order_item_id || undefined,
        front_colors: front.map((value) => value.trim().toUpperCase()),
        back_colors: back.map((value) => value.trim().toUpperCase()),
        reason: reason.trim(),
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["planner-control-hub"] });
      queryClient.invalidateQueries({ queryKey: ["wcm-queue"] });
      queryClient.invalidateQueries({ queryKey: ["machine-queue"] });
      toast({
        title: `Print colors revised · v${data?.revision?.revision_no || ""}`,
        description: "WCM and Machine now read the new governed color contract.",
      });
      onCommitted();
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Color revision blocked",
        description: error?.response?.data?.error || error?.message || "Review the color names and reason.",
        variant: "destructive",
      });
    },
  });

  const changed = JSON.stringify(front) !== JSON.stringify(initialFront) || JSON.stringify(back) !== JSON.stringify(initialBack);
  const invalid = !changed || reason.trim().length < 5 || [...front, ...back].some((value) => !value.trim());

  const renderSide = (label: string, values: string[], setValues: (next: string[]) => void) => (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.16em] text-content-2">{label}</div>
        <span className="rounded-full border border-line bg-surface-1 px-2 py-1 font-mono text-[10px] font-black tabular-nums text-content-3">{values.length} fixed position{values.length === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {values.map((value, index) => (
          <label key={`${label}-${index}`} className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-line bg-surface-1 p-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-order-bg font-mono text-xs font-black text-order-fg">C{index + 1}</span>
            <Input
              value={value}
              onChange={(event) => setValues(values.map((row, rowIndex) => rowIndex === index ? event.target.value : row))}
              placeholder={`Color ${index + 1}`}
              className="h-9 border-0 bg-transparent px-1 text-base font-black uppercase shadow-none focus-visible:ring-0"
            />
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={Boolean(order)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-4xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-line bg-gradient-to-r from-info-bg to-order-bg px-6 pb-5 pt-6 pr-14">
          <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-primary">
            <ShieldCheck className="h-4 w-4" /> Governed post-release change
          </div>
          <DialogTitle className="text-2xl">Revise print colors only</DialogTitle>
          <DialogDescription className="max-w-2xl text-sm font-semibold leading-6 text-content-2">
            Artwork, route, dimensions, print method, and front/back color counts stay locked. WCM and Machine will show the previous and current colors until completion.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
            <Palette className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm font-black text-content-1">{order?.order_number}</div>
              <div className="truncate text-xs font-semibold text-content-3">{order?.line_label || order?.template_name}</div>
            </div>
            <div className="flex items-center gap-2 text-xs font-black text-content-3">
              CURRENT <ArrowRight className="h-4 w-4" /> NEW
            </div>
          </div>
          {renderSide("Front colors", front, setFront)}
          {back.length ? renderSide("Back colors", back, setBack) : null}
          {previousRevision ? (
            <div className="rounded-xl border border-info-border bg-info-bg px-4 py-3 text-xs font-semibold text-primary">
              <div className="flex items-center gap-2 font-black"><History className="h-4 w-4" /> Latest revision v{previousRevision.revision_no}</div>
              <div className="mt-1">{previousRevision.reason} · {previousRevision.changed_by || "Planner"}</div>
            </div>
          ) : null}
          <div>
            <label className="text-xs font-black uppercase tracking-[0.14em] text-content-2">Reason visible to WCM and machine</label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Example: Customer approved sample with NAVY instead of ROYAL BLUE" className="mt-2 min-h-24 text-sm font-semibold" />
            <div className="mt-1 text-[11px] font-semibold text-content-3">Minimum 5 characters. This becomes immutable audit history.</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-2 px-6 py-4">
          <div className="text-xs font-semibold text-content-3">{changed ? "Color change detected" : "Change at least one color name"}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Publishing…" : "Publish color revision"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
