"use client";

import { Suspense } from "react";

import { BulkWorkspaceV36 } from "@/components/inventory/bulk-workspace";

export default function BulkV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading bulk workspace…
        </div>
      }
    >
      <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
        <BulkWorkspaceV36 />
      </div>
    </Suspense>
  );
}
