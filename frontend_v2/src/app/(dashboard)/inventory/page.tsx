"use client";

import { Suspense } from "react";

import { InventoryHomeV36 } from "@/components/inventory/inventory-home";

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading inventory…
        </div>
      }
    >
      <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
        <InventoryHomeV36 />
      </div>
    </Suspense>
  );
}
