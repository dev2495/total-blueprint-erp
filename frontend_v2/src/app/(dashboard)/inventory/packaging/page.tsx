"use client";

import { Suspense } from "react";

import { PackagingWorkspaceV36 } from "@/components/inventory/packaging-workspace";

export default function PackagingV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading packaging workspace…
        </div>
      }
    >
      <div className="erp-production-surface min-h-screen px-4 py-4 sm:px-6">
        <PackagingWorkspaceV36 />
      </div>
    </Suspense>
  );
}
