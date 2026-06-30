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
      <div className="erp-production-surface min-h-screen px-4 py-4 sm:px-6">
        <GrnHistoryV36 />
      </div>
    </Suspense>
  );
}
