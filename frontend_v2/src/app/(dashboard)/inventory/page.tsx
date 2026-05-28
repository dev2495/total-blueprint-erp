"use client"

import { Suspense } from "react"

import { InventoryHomeV36 } from "@/components/inventory/inventory-home"

export default function InventoryPage() {
  return (
    <Suspense fallback={<div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading inventory…</div>}>
      <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
        <InventoryHomeV36 />
      </div>
    </Suspense>
  )
}
