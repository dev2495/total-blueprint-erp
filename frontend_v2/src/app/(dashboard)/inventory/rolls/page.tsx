"use client";

import { Suspense } from "react";

import { RollsWorkspaceV36 } from "@/components/inventory/rolls-workspace";

export default function RollsV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading roll workspace…
        </div>
      }
    >
      <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
        <RollsWorkspaceV36 />
      </div>
    </Suspense>
  );
}
