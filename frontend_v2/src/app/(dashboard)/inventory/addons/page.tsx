"use client";

import { Suspense } from "react";

import { AddonsWorkspaceV36 } from "@/components/inventory/addons-workspace";

export default function AddonsV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading add-ons workspace…
        </div>
      }
    >
      <div className="erp-production-surface min-h-screen px-4 py-4 sm:px-6">
        <AddonsWorkspaceV36 />
      </div>
    </Suspense>
  );
}
