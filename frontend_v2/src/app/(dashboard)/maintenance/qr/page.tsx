"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Printer, QrCode } from "lucide-react";

import { HeroStat, HeroStats, PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { factoryService } from "@/services/factory";
import { maintenanceService } from "@/services/maintenance";

type Target = { kind: "machine" | "location"; id: string; code: string; name: string; sub: string; url: string; svg_url: string };

/**
 * Printable QR posters for machines and stock locations. One per sheet when a
 * single target is chosen; a grid for the whole plant otherwise.
 */
export default function MaintenanceQrPage() {
  const searchParams = useSearchParams();
  const [plantId, setPlantId] = useState("");
  const [kind, setKind] = useState<"all" | "machine" | "location">("all");
  const [only, setOnly] = useState<Target | null>(null);
  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants, staleTime: 10 * 60 * 1000 });
  const { data, isLoading } = useQuery({ queryKey: ["maintenance", "qr-targets", plantId], queryFn: () => maintenanceService.qrTargets(plantId || undefined) });

  const targets = useMemo<Target[]>(() => {
    if (!data) return [];
    const machines: Target[] = data.machines.map((m) => ({ kind: "machine", id: m.id, code: m.code, name: m.name, sub: `${m.work_center} · ${m.plant}`, url: m.url, svg_url: m.svg_url }));
    const locations: Target[] = data.locations.map((l) => ({ kind: "location", id: l.id, code: l.code, name: l.name, sub: `${l.type} · ${l.plant}`, url: l.url, svg_url: l.svg_url }));
    return [...machines, ...locations];
  }, [data]);

  useEffect(() => {
    const machineId = searchParams?.get("machine");
    const locationId = searchParams?.get("location");
    if (!targets.length) return;
    const found = targets.find((t) => (machineId && t.kind === "machine" && t.id === machineId) || (locationId && t.kind === "location" && t.id === locationId));
    if (found) setOnly(found);
  }, [searchParams, targets]);

  const visible = only ? [only] : targets.filter((t) => kind === "all" || t.kind === kind);

  return (
    <div className="space-y-4 pb-10 print:space-y-0 print:pb-0">
      <div className="print:hidden">
        <PageHero
          compact
          icon={<QrCode />}
          eyebrow="Maintenance · set up"
          title="QR codes for machines and locations"
          description="Print, laminate and stick one on each machine and each stock location. Anyone signed in scans it from the ERP header and lands on that machine or location with the panels for their role."
          actions={
            <div className="flex flex-wrap gap-2">
              <Select value={plantId || "ALL"} onValueChange={(value) => { setPlantId(value === "ALL" ? "" : value); setOnly(null); }}>
                <SelectTrigger className="h-10 w-[180px] rounded-xl border-white/20 bg-white/10 text-white" aria-label="Plant">
                  <SelectValue placeholder="All plants" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All plants</SelectItem>
                  {plants.map((plant: any) => (
                    <SelectItem key={plant.id} value={plant.id}>
                      {plant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" className={heroButtonClass("primary")} onClick={() => window.print()} data-testid="qr-print">
                <Printer className="mr-1.5 h-4 w-4" /> Print {only ? "this poster" : `${visible.length} posters`}
              </button>
            </div>
          }
        >
          <HeroStats columns={3}>
            <HeroStat label="Machines" value={data?.machines.length ?? "–"} active={kind === "machine"} onClick={() => { setKind("machine"); setOnly(null); }} />
            <HeroStat label="Locations" value={data?.locations.length ?? "–"} active={kind === "location"} onClick={() => { setKind("location"); setOnly(null); }} />
            <HeroStat label="All" value={targets.length} active={kind === "all" && !only} onClick={() => { setKind("all"); setOnly(null); }} />
          </HeroStats>
        </PageHero>
        {only ? (
          <button type="button" className="mt-2 text-sm font-semibold text-primary" onClick={() => setOnly(null)}>
            ← Show all
          </button>
        ) : null}
      </div>
      {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
      <div className={cn("grid gap-4", only ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2")}>
        {visible.map((target) => (
          <article key={`${target.kind}-${target.id}`} className={cn("break-inside-avoid rounded-2xl border border-line bg-white p-5 text-center text-black shadow-sm print:border-black print:shadow-none", only && "mx-auto w-full max-w-md")} data-testid={`qr-poster-${target.code}`}>
            <div className="text-caption font-bold uppercase tracking-[0.12em] text-black/60">{target.kind === "machine" ? "Machine · मशीन" : "Stock location · स्टॉक जगह"}</div>
            <div className="mt-1 font-mono text-3xl font-bold">{target.code}</div>
            <div className="text-base font-semibold">{target.name}</div>
            <div className="text-caption text-black/60">{target.sub}</div>
            <img src={target.svg_url} alt={`QR code for ${target.code}`} className="mx-auto mt-3 aspect-square w-full max-w-[260px] [image-rendering:pixelated]" />
            <div className="mt-2 text-caption text-black/70">Scan from the ERP header · ERP में स्कैन करें</div>
            <div className="font-mono text-[10px] text-black/50 print:text-[9px]">{target.url}</div>
            <button type="button" className="mt-2 text-caption font-semibold text-primary print:hidden" onClick={() => setOnly(target)}>
              Print just this one
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
