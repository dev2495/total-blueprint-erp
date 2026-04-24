import { Suspense } from "react"

import { InventoryWorkspaceShell } from "@/components/inventory/inventory-workspace"

export default function PackagingInventoryEntryPage() {
  return (
    <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Opening Packaging Stock...</div>}>
      <InventoryWorkspaceShell />
    </Suspense>
  )
}
