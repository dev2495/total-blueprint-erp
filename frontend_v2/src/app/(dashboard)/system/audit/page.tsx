"use client";

import Link from "next/link";
import { History, Search, ShieldCheck, ArrowRight, Workflow, ScanSearch } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const quickPanels = [
  {
    title: "Guided search",
    description: "Trace orders, challans, jobs, rolls, and report runs without jumping across modules.",
    icon: Search,
  },
  {
    title: "Control handoff proof",
    description: "Review the operational timeline across planning, execution, packing, dispatch, and report distribution.",
    icon: History,
  },
  {
    title: "Genealogy bridge",
    description: "Inventory trace stays in Roll Genealogy while the admin audit center focuses on cross-module proof.",
    icon: Workflow,
  },
];

export default function AuditCenterPage() {
  const { effectiveRole, user } = useAuth();
  const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase();
  const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <section className="rounded-[28px] border border-amber-200 bg-amber-50/90 p-8 shadow-sm">
          <Badge className="rounded-full border border-amber-200 bg-white text-[11px] font-black uppercase tracking-[0.26em] text-amber-700">
            Audit Access
          </Badge>
          <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950">Audit Center</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-700">
            Audit Center is limited to owner and admin roles. Store and operational roles should use Roll Genealogy,
            inventory history, and route-specific timelines instead of the enterprise audit console.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/inventory/traceability">
              <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                <Workflow className="mr-2 h-4 w-4" />
                Open Roll Genealogy
              </Button>
            </Link>
            <Link href="/inventory/roll-explorer">
              <Button variant="outline" className="rounded-2xl">
                <ScanSearch className="mr-2 h-4 w-4" />
                Open Roll Explorer
              </Button>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50 p-7 shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
        <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-indigo-200/30 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-4">
            <Badge className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-slate-700">
              Administration
            </Badge>
            <div className="space-y-2">
              <h1 className="text-4xl font-black tracking-tight text-slate-950">Audit Center</h1>
              <p className="max-w-2xl text-sm font-semibold leading-6 text-slate-600 sm:text-base">
                Guided search for enterprise proof across order flow, genealogy, dispatch, and scheduled reporting.
                This is the cross-module audit layer for admin and owner roles.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/inventory/traceability">
              <Button variant="outline" className="rounded-2xl bg-white/85">
                <Workflow className="mr-2 h-4 w-4" />
                Roll Genealogy
              </Button>
            </Link>
            <Link href="/system/report-center">
              <Button className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Report Center
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {quickPanels.map((panel) => {
          const Icon = panel.icon;
          return (
            <Card key={panel.title} className="rounded-[24px] border border-slate-200/80 bg-white/95 shadow-sm">
              <CardHeader className="space-y-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-lg font-black tracking-tight text-slate-950">{panel.title}</CardTitle>
                  <CardDescription className="text-sm font-medium leading-6 text-slate-600">
                    {panel.description}
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          );
        })}
      </section>

      <Card className="rounded-[28px] border border-slate-200/80 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-black tracking-tight text-slate-950">Guided search</CardTitle>
          <CardDescription className="text-sm font-medium text-slate-600">
            Follow the exact proof path depending on whether you are validating stock truth, dispatch evidence, or report generation history.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Stock proof</div>
            <div className="mt-2 text-lg font-black text-slate-900">Roll genealogy</div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
              Trace lineage, movement, and stage truth for rolls without opening admin-only audit controls.
            </p>
            <Link href="/inventory/traceability" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-slate-950">
              Open route
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Dispatch proof</div>
            <div className="mt-2 text-lg font-black text-slate-900">Challan and order evidence</div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
              Review dispatch documents, inter-plant transfers, and downstream order evidence from the live ERP routes.
            </p>
            <Link href="/dashboard/logistics" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-slate-950">
              Open dispatch bay
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-5">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Reporting proof</div>
            <div className="mt-2 text-lg font-black text-slate-900">Report history and PDF archive</div>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
              Validate daily report generation, stored PDFs, and report-run detail downloads from the Administration archive.
            </p>
            <Link href="/system/report-center" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-slate-950">
              Open report archive
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
