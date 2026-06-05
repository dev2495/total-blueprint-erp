"use client";

import { Suspense } from "react";

import { GrnHistoryV36 } from "@/components/inventory/grn-history";

export default function GrnHistoryV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading GRN history…
        </div>
      }
    >
      <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
        <GrnHistoryV36 />
      </div>
    </Suspense>
  );
}
