import { Suspense } from "react"

import { InventoryWorkspaceShell } from "@/components/inventory/inventory-workspace"

export default function RollExplorerEntryPage() {
  return (
    <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Opening Roll Explorer...</div>}>
      <InventoryWorkspaceShell />
    </Suspense>
  )
}
