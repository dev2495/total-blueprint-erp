"use client";

import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LockKeyhole,
  Package,
  ScanSearch,
  Scale,
  Truck,
  Waves,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const quickActions = [
  {
    title: "Roll Explorer",
    description: "Follow roll genealogy, allocations, and live WIP stock.",
    href: "/inventory/roll-explorer",
    icon: CircleDot,
    badge: "Roll Truth",
  },
  {
    title: "Bulk Inventory",
    description: "Monitor bulk pools, replenishment, and intermediate stock.",
    href: "/inventory/bulk",
    icon: Waves,
    badge: "Bulk",
  },
  {
    title: "Packaging Stock",
    description: "Track pouch, sheet, and packaging inventory positions.",
    href: "/inventory/packaging",
    icon: Package,
    badge: "Packaging",
  },
  {
    title: "GRN Desk",
    description: "Inward new bulk and roll stock with traceable receipts.",
    href: "/inventory/grn",
    icon: ClipboardCheck,
    badge: "Inbound",
  },
  {
    title: "Opening Stock",
    description: "Post go-live stock as auditable opening balances, not vendor GRNs.",
    href: "/inventory/opening-stock",
    icon: Scale,
    badge: "Opening",
  },
  {
    title: "Stock Count",
    description: "Capture physical count variance and post shortage or excess adjustments.",
    href: "/inventory/stock-count",
    icon: ClipboardList,
    badge: "Audit",
  },
  {
    title: "Year Close",
    description: "Preview closing stock, clear blockers, and generate next FY opening.",
    href: "/inventory/year-close",
    icon: LockKeyhole,
    badge: "FY Lock",
  },
  {
    title: "Stock Card",
    description: "Opening plus every movement plus closing balance by material and location.",
    href: "/inventory/stock-card",
    icon: FileText,
    badge: "Ledger",
  },
  {
    title: "Inter-Plant",
    description: "Move traceable rolls between plants with printable challans.",
    href: "/inventory/inter-plant",
    icon: Truck,
    badge: "Transfers",
  },
  {
    title: "Inventory History",
    description: "Open ledger, movements, and health diagnostics for audit-ready visibility.",
    href: "/analytics/inventory-history",
    icon: Boxes,
    badge: "History",
  },
];

export default function InventoryHubPage() {
  return (
    <div className="space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200/70 bg-gradient-to-br from-white via-sky-50 to-indigo-50 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] sm:p-8">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_56%)] lg:block" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <Badge className="rounded-full border border-sky-200 bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.28em] text-sky-700">
              Inventory Command
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Fast inventory access without the heavy first load.
              </h1>
              <p className="max-w-xl text-sm font-medium leading-6 text-slate-600 sm:text-base">
                Start from the exact inventory task you need: roll genealogy, bulk pools, packaging,
                inbound receipts, transfers, or stock history. Roll trace stays in inventory, while
                enterprise-wide audit proof now lives in the Admin Audit Center.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/inventory/roll-explorer" className="w-full sm:w-auto">
              <Button className="w-full rounded-2xl bg-slate-950 px-5 py-6 text-sm font-bold text-white hover:bg-slate-800 sm:w-auto">
                <ScanSearch className="mr-2 h-4 w-4" />
                Open Roll Explorer
              </Button>
            </Link>
            <Link href="/system/audit" className="w-full sm:w-auto">
              <Button
                variant="outline"
                className="w-full rounded-2xl border-slate-300 bg-white/80 px-5 py-6 text-sm font-bold text-slate-700 hover:bg-white sm:w-auto"
              >
                Audit Center
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href} className="group block">
              <Card className="h-full rounded-[24px] border border-slate-200/80 bg-white/90 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg">
                <CardHeader className="space-y-4 pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="secondary" className="rounded-full px-2.5 py-1 text-[11px] font-bold">
                      {action.badge}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-black tracking-tight text-slate-950">
                      {action.title}
                    </CardTitle>
                    <CardDescription className="text-sm font-medium leading-6 text-slate-600">
                      {action.description}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="inline-flex items-center gap-2 text-sm font-bold text-slate-950">
                    Open
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>
    </div>
  );
}
