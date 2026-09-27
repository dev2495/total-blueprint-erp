"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { inventoryService } from "@/services/inventory";

export function RollLabelActions({ rolls }: { rolls: Array<{ id: string; ref?: string }> }) {
  const [layout, setLayout] = React.useState("4x2");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState("");
  if (!rolls.length) return null;
  async function download(ids: string[]) {
    setPending(true); setMessage("");
    try {
      // Each inward roll gets its own page. Chunk only at the documented server limit.
      for (let offset = 0; offset < ids.length; offset += 200) {
        await inventoryService.downloadRollLabels(ids.slice(offset, offset + 200), layout);
      }
      setMessage("PDF downloaded. Print at actual size (100%), then check one QR scan. The roll IDs are unchanged.");
    } catch {
      setMessage("Label PDF could not be generated. Your inward stock is saved; retry the label download.");
    } finally { setPending(false); }
  }
  return <section className="mt-3 rounded-lg border border-line bg-surface-1 p-3 text-content-1" aria-label="Roll identity and optional labels">
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex-1"><p className="text-sm font-semibold">{rolls.length} roll identities saved</p>
        <p className="text-xs text-content-3">Labels are optional. Identify each physical roll by its supplier number or handwritten ERP ID and location.</p></div>
      <select aria-label="Label size" value={layout} onChange={e => setLayout(e.target.value)} className="rounded border border-line bg-surface-1 p-2 text-xs">
        <option value="4x2">4 × 2 inches</option><option value="100x50">100 × 50 mm</option>
      </select>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => void download(rolls.map(r => r.id))}>{pending ? "Preparing labels…" : "Download all labels"}</Button>
    </div>
    <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs">
      {rolls.map(roll => <li key={roll.id} className="flex items-center justify-between gap-3 border-t border-line py-2">
        <Link className="font-mono text-primary underline" href={`/inventory/traceability?q=${encodeURIComponent(roll.id)}`}>{roll.ref || roll.id}</Link>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void download([roll.id])}>Label / reprint</Button>
      </li>)}
    </ul>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </section>;
}
