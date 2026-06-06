import { Suspense } from "react";

import { StockLifecycleWorkspace } from "@/components/stock-lifecycle/workspace";

export default function StockLifecyclePage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading stock lifecycle workspace…
        </div>
      }
    >
      <div className="erp-soft-canvas min-h-screen px-4 py-4 sm:px-6">
        <StockLifecycleWorkspace />
      </div>
    </Suspense>
  );
}
