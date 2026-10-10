"use client";

import { Suspense } from "react";

import { DocumentsRegisterPage } from "@/components/documents-register/register-page";

/**
 * Bills & documents register (inbox, all documents, filed, non-stock
 * follow-ups, reports). Kept under its original name for existing imports.
 */
export function GateBillQueue() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />}>
      <DocumentsRegisterPage />
    </Suspense>
  );
}
