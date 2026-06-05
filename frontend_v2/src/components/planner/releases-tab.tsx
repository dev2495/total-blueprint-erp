"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Box, Layers, Recycle, Package, Printer } from "lucide-react";

import { Chip } from "@/components/ds/chip";
import { ScopeCard } from "@/components/ds/scope-card";

import type { TowerTabContext } from "./types";
import { DirectFgWizard } from "./release-wizards/direct-fg";
import { MatchWipWizard } from "./release-wizards/match-wip";
import { FreshWizard } from "./release-wizards/fresh";
import { InHouseWizard } from "./release-wizards/in-house";

type ReleaseMode = "direct-fg" | "match-wip" | "fresh" | "packaging" | "pod";

export interface ReleasesTabProps {
  context: TowerTabContext;
}

export function ReleasesTab({ context: _context }: ReleasesTabProps) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ReleaseMode | null>(null);
  const [seedOrderKey, setSeedOrderKey] = useState<string | null>(null);
  const [seedSoItemId, setSeedSoItemId] = useState<string | null>(null);

  const urlMode = searchParams?.get("mode") ?? null;
  const urlOrderKind = searchParams?.get("order_kind") ?? null;
  const urlOrderId = searchParams?.get("order_id") ?? null;
  const urlSoItemId = searchParams?.get("so_item_id") ?? null;

  useEffect(() => {
    if (
      urlMode === "direct-fg" ||
      urlMode === "match-wip" ||
      urlMode === "fresh"
    ) {
      setMode(urlMode);
      if (urlOrderKind && urlOrderId) {
        setSeedOrderKey(`${urlOrderKind}:${urlOrderId}`);
      }
      if (urlSoItemId) setSeedSoItemId(urlSoItemId);
    }
  }, [urlMode, urlOrderKind, urlOrderId, urlSoItemId]);

  const handleClose = () => {
    setMode(null);
    setSeedOrderKey(null);
    setSeedSoItemId(null);
  };

  const isWizardActive = useMemo(() => mode !== null, [mode]);

  if (mode === "direct-fg") {
    return <DirectFgWizard seedOrderKey={seedOrderKey} onClose={handleClose} />;
  }
  if (mode === "match-wip") {
    return (
      <MatchWipWizard
        seedOrderKey={seedOrderKey}
        seedSoItemId={seedSoItemId}
        onClose={handleClose}
      />
    );
  }
  if (mode === "fresh") {
    return <FreshWizard seedOrderKey={seedOrderKey} onClose={handleClose} />;
  }
  if (mode === "packaging") {
    return <InHouseWizard kind="PACKAGING_STOCK" onClose={handleClose} />;
  }
  if (mode === "pod") {
    return <InHouseWizard kind="POD_STOCK" onClose={handleClose} />;
  }

  return (
    <div className="flex flex-col gap-6 px-5 py-5">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-base font-semibold text-content-1">
            Release a job
          </h2>
          <p className="text-[12px] text-content-3">
            Three release modes plus internal launches. Pick a mode below.
          </p>
        </div>
        <Chip kind="info" size="sm">
          3 release modes · 2 launch kinds
        </Chip>
      </header>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
          For sales demand
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          <ScopeCard
            title="Direct FG"
            description="Assign existing finished stock to a sales line."
            icon={<Box className="h-4 w-4" />}
            tone="success"
            onClick={() => setMode("direct-fg")}
            meta={[
              { label: "API", value: "claim_stock" },
              { label: "Source", value: "Pool · Finished" },
            ]}
          />
          <ScopeCard
            title="Match WIP"
            description="Claim a WIP roll mid-route to satisfy demand."
            icon={<Recycle className="h-4 w-4" />}
            tone="info"
            onClick={() => setMode("match-wip")}
            meta={[
              { label: "API", value: "claim_candidates → claim_stock" },
              { label: "Source", value: "Pool · WIP" },
            ]}
          />
          <ScopeCard
            title="Fresh"
            description="Create a new PlannedStockOrder for the line."
            icon={<Layers className="h-4 w-4" />}
            tone="accent"
            onClick={() => setMode("fresh")}
            meta={[
              { label: "API", value: "control_hub_plan" },
              { label: "Strategy", value: "Final / Pool" },
            ]}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
          In-house demand
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <ScopeCard
            title="Packaging stock"
            description="Launch internal packaging (poly-bags, cartons)."
            icon={<Package className="h-4 w-4" />}
            tone="warn"
            onClick={() => setMode("packaging")}
            meta={[
              { label: "Kind", value: "PACKAGING_STOCK" },
              { label: "Source", value: "Product Master / internal preset" },
            ]}
          />
          <ScopeCard
            title="POD stock"
            description="Launch printed-on-demand stock for downstream consumption."
            icon={<Printer className="h-4 w-4" />}
            tone="thick"
            onClick={() => setMode("pod")}
            meta={[
              { label: "Kind", value: "POD_STOCK" },
              { label: "Source", value: "Product Master / internal preset" },
            ]}
          />
        </div>
      </section>

      {!isWizardActive ? (
        <section className="rounded-lg border border-line bg-surface-2 p-4 text-[12px] text-content-3">
          <p className="font-semibold text-content-2">How it flows</p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            <li>
              Open the Demand tab to find a sales line — click{" "}
              <strong>Release</strong> on any line to land on the right mode
              here.
            </li>
            <li>Or pick a mode above to step through the wizard manually.</li>
            <li>
              Each successful confirm invalidates the planner queries — Demand,
              Pool and Queue tabs update live.
            </li>
          </ol>
        </section>
      ) : null}
    </div>
  );
}
