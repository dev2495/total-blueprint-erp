"use client";

import { Suspense } from "react";

import { GeneralReceiptForm } from "@/components/documents-register/general-receipt-form";

/** New general receipt; `?bill=<id>` shows the bill beside the form, `?followup=<id>` follows up an old non-stock void. */
export default function NewGeneralReceiptRoute() {
  return (
    <Suspense fallback={<div className="h-[60vh] animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />}>
      <GeneralReceiptForm />
    </Suspense>
  );
}
