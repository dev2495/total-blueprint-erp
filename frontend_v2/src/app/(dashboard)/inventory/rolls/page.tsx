"use client"

import { Suspense } from "react"

import { RollsWorkspaceV36 } from "@/components/inventory/rolls-workspace"

export default function RollsV36Page() {
    return (
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading roll workspace…</div>}>
            <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
                <RollsWorkspaceV36 />
            </div>
        </Suspense>
    )
}
