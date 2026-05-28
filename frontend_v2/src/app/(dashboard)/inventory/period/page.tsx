"use client"

import { Suspense } from "react"

import { PeriodWorkspaceV36 } from "@/components/inventory/period-workspace"

export default function InventoryPeriodPage() {
    return (
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading period management…</div>}>
            <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
                <PeriodWorkspaceV36 />
            </div>
        </Suspense>
    )
}
