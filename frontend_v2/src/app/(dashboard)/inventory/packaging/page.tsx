"use client"

import { Suspense } from "react"

import { PackagingWorkspaceV36 } from "@/components/inventory/packaging-workspace"

export default function PackagingV36Page() {
    return (
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-surface-1 p-8 text-sm text-slate-500">Loading packaging workspace…</div>}>
            <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
                <PackagingWorkspaceV36 />
            </div>
        </Suspense>
    )
}
