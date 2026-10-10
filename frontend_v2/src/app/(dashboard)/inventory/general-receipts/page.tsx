"use client";

import { Suspense } from "react";

import { GeneralReceiptsPage } from "@/components/documents-register/general-receipts-list";

/** Inventory: general receipts (spares, machinery, tools, services, charges) and machine history. */
export default function GeneralReceiptsRoute() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />}>
      <GeneralReceiptsPage />
    </Suspense>
  );
}
