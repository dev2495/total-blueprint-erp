"use client"

import { StockLauncherV3Workspace } from "@/components/planner-launcher/stock-launcher-workspace"

export default function StockLauncherPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <StockLauncherV3Workspace />
        </div>
    )
}
