import { Suspense } from "react"

import { StockLifecycleWorkspace } from "@/components/stock-lifecycle/workspace"

export default function StockLifecyclePage() {
    return (
        <Suspense
            fallback={
                <div className="rounded-3xl border border-slate-200 bg-surface-1 p-8 text-sm text-slate-500">
                    Loading stock lifecycle workspace…
                </div>
            }
        >
            <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
                <StockLifecycleWorkspace />
            </div>
        </Suspense>
    )
}
