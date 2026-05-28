"use client"

import { Suspense } from "react"

import { MobileCountV36 } from "@/components/inventory/mobile-count"

export default function InventoryCountPage() {
    return (
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading mobile count…</div>}>
            <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40">
                <MobileCountV36 />
            </div>
        </Suspense>
    )
}
