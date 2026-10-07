"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Building2,
  Check,
  ClipboardList,
  DoorOpen,
  ExternalLink,
  FileText,
  History,
  QrCode,
  UserCog,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { gateApi } from "@/services/gate";
import { useGate } from "./gate-shell";

/**
 * Gate Setup — the one place an Admin/Owner learns how the gate works and
 * reaches every gate tool. Gates are not registered separately: each plant
 * in the plant master already has its gate and its own visitor QR link.
 */
export function GateSetup() {
  const { plants, plant, plantId, setPlantId } = useGate();
  const qr = useQuery({
    queryKey: ["gate", "qr", plantId],
    queryFn: () => gateApi.plantQr(plantId),
    enabled: Boolean(plantId),
    meta: { suppressGlobalError: true },
  });

  return (
    <div className="mx-auto max-w-[920px] space-y-6 pb-6">
      <header className="px-1 pt-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-4">Admin · Owner</div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-content-1">Gate setup</h1>
        <p className="mt-1 max-w-[680px] text-[15px] leading-relaxed text-content-2 [text-wrap:pretty]">
          Every factory in the plant master already has its gate and its own visitor QR — created automatically with the plant. There is
          nothing to register here. Pick the factory, print its QR, give a watchman that gate, and use the tools below.
        </p>
      </header>

      <Step n={1} title="Choose the factory" body="Gates follow your plant master. To add or rename a factory, edit it in Plants; its gate and QR come with it.">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Factory">
          {plants.map((p) => {
            const active = p.id === plantId;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPlantId(p.id)}
                className={cn(
                  "gate-press flex min-h-[48px] items-center gap-2 rounded-2xl border px-4 text-left text-[15px] font-semibold",
                  active ? "border-transparent text-white" : "border-line bg-surface-1 text-content-1",
                )}
                style={active ? { background: "var(--gate-ink-2)" } : undefined}
              >
                {active ? <Check className="h-4 w-4" /> : <Building2 className="h-4 w-4 text-content-4" />}
                <span>{p.name}</span>
                <span className={cn("font-mono text-[11px]", active ? "text-white/70" : "text-content-4")}>{p.code}</span>
              </button>
            );
          })}
        </div>
        <ToolLink href="/factory/plants" icon={<Building2 className="h-5 w-5" />} title="Plants (plant master)" body="Add or edit factories" subtle />
      </Step>

      <Step
        n={2}
        title={`Print the visitor QR for ${plant?.name ?? "this factory"}`}
        body="Fix it at the gate. A visitor scans it, fills the form, and their entry is recorded immediately — no watchman action needed to come in."
      >
        <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px]">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">Visitor link</div>
          <div className="mt-0.5 break-all font-mono text-content-2">
            {qr.isLoading ? "Loading…" : qr.isError ? "Could not load the QR link — open the poster to retry." : qr.data?.public_url}
          </div>
        </div>
        <ToolLink href="/gate/qr" icon={<QrCode className="h-5 w-5" />} title="Open & print QR poster" body="One A4 sign with the factory's own QR" />
      </Step>

      <Step
        n={3}
        title="Give a watchman this gate"
        body="In Users, create or edit the person, set the role to Watchman, and tick this factory under Gate assignment. A watchman sees only the gate terminal: goods inward/outward and checking visitors out."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <ToolLink href="/system/users" icon={<Users className="h-5 w-5" />} title="Users" body="Edit an existing person" />
          <ToolLink href="/system/users/new" icon={<UserCog className="h-5 w-5" />} title="New user" body="Create a watchman login" />
        </div>
      </Step>

      <Step n={4} title="Daily use" body="Admins and owners have every gate tool by default. Report delegates (gate.reports) only see the sanitized report.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <ToolLink href="/gate" icon={<DoorOpen className="h-5 w-5" />} title="Gate terminal" body="Log goods inward / outward" />
          <ToolLink href="/gate/visitors" icon={<Users className="h-5 w-5" />} title="Visitors inside" body="Check visitors out" />
          <ToolLink href="/gate/register" icon={<ClipboardList className="h-5 w-5" />} title="Today's register" body="Paper-style goods register" />
          <ToolLink href="/gate/history" icon={<History className="h-5 w-5" />} title="Gate history" body="ERP match, corrections, audit" />
          <ToolLink href="/analytics/reports/gate" icon={<BarChart3 className="h-5 w-5" />} title="Gate report" body="Trends, mismatches, export" />
          <ToolLink href="/system/report-center" icon={<FileText className="h-5 w-5" />} title="Daily report pack" body="Gate Register Daily" />
        </div>
      </Step>
    </div>
  );
}

function Step({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <section className="gate-card grid gap-4 p-4 sm:grid-cols-[40px_1fr] sm:p-5" aria-labelledby={`gate-setup-step-${n}`}>
      <div
        className="gate-num flex h-10 w-10 items-center justify-center rounded-full text-[16px] font-bold text-white"
        style={{ background: "var(--gate-in)" }}
        aria-hidden
      >
        {n}
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <h2 id={`gate-setup-step-${n}`} className="text-[17px] font-semibold tracking-[-0.01em] text-content-1">
            {title}
          </h2>
          <p className="mt-0.5 text-[14px] leading-relaxed text-content-3 [text-wrap:pretty]">{body}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

function ToolLink({ href, icon, title, body, subtle }: { href: string; icon: React.ReactNode; title: string; body: string; subtle?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "gate-press flex min-h-[60px] items-center gap-3 rounded-2xl px-4 py-2.5",
        subtle ? "border border-dashed border-line" : "bg-surface-2",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-1 text-content-2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-content-1">{title}</span>
        <span className="block text-[13px] text-content-3">{body}</span>
      </span>
      <ExternalLink className="h-4 w-4 shrink-0 text-content-4" aria-hidden />
    </Link>
  );
}
