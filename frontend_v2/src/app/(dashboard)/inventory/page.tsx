import { Suspense } from "react"

import { InventoryWorkspaceShell } from "@/components/inventory/inventory-workspace"

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading inventory workspace...</div>}>
      <InventoryWorkspaceShell />
    </Suspense>
  )
}
