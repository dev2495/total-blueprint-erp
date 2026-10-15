"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Loader2, MapPin } from "lucide-react";

import { Row, SectionLabel } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService } from "@/services/maintenance";

/**
 * The location card a phone lands on after scanning a stock-location QR.
 * Everyone with inventory access sees what the system says is here. The
 * store counts against it and posts the differences as a stock adjustment
 * (reason: count correction), which goes through the normal posting rules.
 */
export default function LocationScanPage() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code || "");
  const { toast } = useToast();
  const [counting, setCounting] = useState(false);
  const [bulkCounts, setBulkCounts] = useState<Record<string, string>>({});
  const [missingRolls, setMissingRolls] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["maintenance", "scan-location", code], queryFn: () => maintenanceService.scanLocation(code), enabled: Boolean(code) });

  const diffs = useMemo(() => {
    if (!data) return [];
    const rows: Array<{ kind: "BULK" | "ROLL"; label: string; before: number; after: number; delta: number; uom: string; material_id?: string; roll_id?: string }> = [];
    data.bulk.forEach((row) => {
      const raw = bulkCounts[row.id];
      if (raw === undefined || raw === "") return;
      const after = Number(raw);
      if (!Number.isFinite(after)) return;
      const delta = Number((after - row.qty).toFixed(3));
      if (delta !== 0) rows.push({ kind: "BULK", label: `${row.material_code} · ${row.material_name}${row.granule_code ? ` · ${row.granule_code}` : ""}`, before: row.qty, after, delta, uom: row.uom, material_id: row.material_id });
    });
    data.rolls.forEach((roll) => {
      if (missingRolls[roll.id]) rows.push({ kind: "ROLL", label: `${roll.roll_number} · ${roll.material_code}`, before: roll.weight_kg, after: 0, delta: -roll.weight_kg, uom: "KG", roll_id: roll.id });
    });
    return rows;
  }, [data, bulkCounts, missingRolls]);

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error("Nothing to post.");
      const created = await api.post("/api/inventory/adjustments/", { plant: data.location.plant_id, reason: data.adjustment_reason || "COUNT_CORRECTION", notes: `Count at ${data.location.code} (${data.location.name}) from phone scan. ${note}`.trim() });
      const adjustmentId = created.data?.id;
      try {
        for (const row of diffs) {
          await api.post(`/api/inventory/adjustments/${adjustmentId}/add-line/`, {
            stock_class: row.kind,
            inventory_material: row.kind === "BULK" ? row.material_id : undefined,
            inventory_roll: row.kind === "ROLL" ? row.roll_id : undefined,
            location: data.location.id,
            delta_qty: row.delta,
            uom: row.uom,
            notes: row.kind === "ROLL" ? "Not found during count" : `Counted ${row.after} ${row.uom.toLowerCase()}, system ${row.before}`,
          });
        }
        const posted = await api.post(`/api/inventory/adjustments/${adjustmentId}/post/`, {});
        return posted.data;
      } catch (err) {
        // Nothing half-done is left behind: remove the draft, then report.
        try {
          await api.delete(`/api/inventory/adjustments/${adjustmentId}/`);
        } catch {
          // The draft stays visible under Stock adjustments if it cannot be removed.
        }
        throw err;
      }
    },
    onSuccess: (adjustment: any) => {
      toast({ title: "Count posted · गिनती दर्ज", description: `Adjustment ${adjustment?.code || ""} posted with ${diffs.length} line(s).` });
      setCounting(false);
      setBulkCounts({});
      setMissingRolls({});
      setNote("");
      refetch();
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not post the count", description: describeApiError(err) }),
  });

  const needle = search.trim().toLowerCase();
  const bulkRows = (data?.bulk || []).filter((row) => !needle || `${row.material_code} ${row.material_name} ${row.granule_code}`.toLowerCase().includes(needle));
  const rollRows = (data?.rolls || []).filter((row) => !needle || `${row.roll_number} ${row.material_code} ${row.batch_no}`.toLowerCase().includes(needle));
  const totals = data?.totals;

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-24">
      <PageHero
        compact
        icon={<MapPin />}
        eyebrow={data ? `${data.location.plant_name} · ${data.location.type}` : "Scanned location"}
        title={data ? `${data.location.code} · ${data.location.name}` : isLoading ? "Loading…" : "Location"}
        description={data ? "What the system says is here right now. Count against it and post the differences." : ""}
        actions={
          data?.viewer.can_count ? (
            <button type="button" className={cn("inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold", counting ? "border border-white/20 bg-white/10 text-white" : "bg-white text-content-1")} onClick={() => setCounting((v) => !v)} data-testid="loc-count-toggle">
              <ClipboardCheck className="mr-1.5 h-4 w-4" /> {counting ? "Stop counting" : "Count stock · गिनती"}
            </button>
          ) : null
        }
      >
        {totals ? (
          <HeroStats columns={4}>
            <HeroStat label="Rolls" value={totals.roll_count} hint={`${totals.roll_kg.toLocaleString("en-IN")} kg`} />
            <HeroStat label="Bulk lines" value={totals.bulk_lines} hint={`${totals.bulk_kg.toLocaleString("en-IN")} kg`} />
            <HeroStat label="Packed units" value={totals.packed_units} hint={`${totals.packed_pcs.toLocaleString("en-IN")} pcs`} />
            <HeroStat label="Differences" value={diffs.length} tone={diffs.length ? "warn" : "good"} />
          </HeroStats>
        ) : null}
      </PageHero>

      {error ? <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-3 text-sm text-danger-fg">No location matches code &quot;{code}&quot;.</div> : null}

      {data ? (
        <>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find material or roll" aria-label="Search this location" className="h-11" />

          <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="loc-bulk">
            <SectionLabel count={bulkRows.length}>Bulk material · थोक माल</SectionLabel>
            {!bulkRows.length ? <div className="text-sm text-content-3">No bulk stock here.</div> : null}
            <div className="space-y-2">
              {bulkRows.map((row) => (
                <div key={row.id} className="rounded-xl border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-content-1">
                        {row.material_code} · {row.material_name}
                      </div>
                      <div className="text-caption text-content-3">
                        {row.category}
                        {row.granule_code ? ` · ${row.granule_code}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-base font-semibold">{row.qty.toLocaleString("en-IN")} {row.uom.toLowerCase()}</div>
                      <div className="text-caption uppercase text-content-3">system</div>
                    </div>
                  </div>
                  {counting && row.countable === false ? (
                    <div className="mt-2 text-caption text-content-3">{row.count_note || "Counted in the physical count"}</div>
                  ) : null}
                  {counting && row.countable !== false ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Input type="number" inputMode="decimal" step="0.001" className="h-12 font-mono text-lg" placeholder={`Counted ${row.uom.toLowerCase()}`} aria-label={`Counted quantity for ${row.material_code}`} value={bulkCounts[row.id] ?? ""} onChange={(event) => setBulkCounts((current) => ({ ...current, [row.id]: event.target.value }))} data-testid={`loc-count-${row.material_code}`} />
                      <Button type="button" variant="outline" className="h-12" onClick={() => setBulkCounts((current) => ({ ...current, [row.id]: String(row.qty) }))}>
                        Same
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="loc-rolls">
            <SectionLabel count={data.roll_groups.length}>Rolls by material · रोल</SectionLabel>
            {!data.roll_groups.length ? <div className="text-sm text-content-3">No rolls here.</div> : null}
            <div className="space-y-1.5">
              {data.roll_groups.map((group) => (
                <Row key={group.material_id} title={`${group.material_code} · ${group.material_name}`} subtitle={`${group.rolls} roll${group.rolls === 1 ? "" : "s"} · ${group.weight_kg.toLocaleString("en-IN")} kg${group.reserved ? ` · ${group.reserved} reserved/in process` : ""}`} />
              ))}
            </div>
            {counting ? (
              <div className="mt-3">
                <div className="mb-1 text-caption text-content-3">Tick a roll that is NOT here. Rolls reserved or in process cannot be written off from the phone.</div>
                <div className="max-h-[50vh] space-y-1 overflow-y-auto">
                  {rollRows.map((roll) => (
                    <label key={roll.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-sm", missingRolls[roll.id] ? "border-danger-border bg-danger-bg/40" : "border-line")}>
                      <input type="checkbox" disabled={roll.status !== "AVAILABLE"} checked={Boolean(missingRolls[roll.id])} onChange={(event) => setMissingRolls((current) => ({ ...current, [roll.id]: event.target.checked }))} aria-label={`Roll ${roll.roll_number} missing`} />
                      <span className="font-mono font-semibold">{roll.roll_number}</span>
                      <span className="text-content-3">{roll.material_code} · {roll.width_mm} mm · {roll.weight_kg} kg · {roll.status.toLowerCase().replace("_", " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {counting ? (
            <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface-1/96 p-3 backdrop-blur lg:left-[76px]">
              <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 text-sm">
                  <b>{diffs.length}</b> difference(s) ·{" "}
                  {diffs
                    .slice(0, 3)
                    .map((d) => `${d.label.split(" · ")[0]} ${d.delta > 0 ? "+" : ""}${d.delta} ${d.uom.toLowerCase()}`)
                    .join(", ")}
                  {diffs.length > 3 ? " …" : ""}
                </div>
                <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note (optional)" aria-label="Count note" className="h-11 sm:w-56" />
                <Button type="button" className="h-11" disabled={!diffs.length || postMutation.isPending} onClick={() => postMutation.mutate()} data-testid="loc-count-post">
                  {postMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  Post count · दर्ज करें
                </Button>
              </div>
            </div>
          ) : null}

          <div className="text-caption text-content-3">
            Posted counts appear under <Link href="/inventory/adjustments" className="font-semibold text-primary">Stock adjustments</Link> with reason &quot;count correction&quot; and this location.
          </div>
        </>
      ) : null}
    </div>
  );
}
