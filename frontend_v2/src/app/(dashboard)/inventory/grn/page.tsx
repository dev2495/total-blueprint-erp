"use client"

import { Suspense } from "react"
import { GrnSmartV36 } from "@/components/inventory/grn-smart"

export default function GrnV36Page() {
    return (
        <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading GRN…</div>}>
            <div className="-mx-3 min-h-screen w-auto max-w-none overflow-visible bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-2 py-3 sm:-mx-4 sm:px-3 lg:-mx-6 lg:px-4 xl:-mx-8 xl:px-5">
                <GrnSmartV36 />
            </div>
        </Suspense>
    )
}
