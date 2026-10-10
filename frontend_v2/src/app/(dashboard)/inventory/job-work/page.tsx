"use client";

import { Suspense } from "react";

import { JobWorkList } from "@/components/job-work/job-work-list";

/** Inventory → Job work: orders, material at job workers, reports and (Owner) legacy reconciliation. */
export default function JobWorkPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-40 max-w-[1400px] animate-pulse rounded-3xl bg-surface-2" />}>
      <JobWorkList />
    </Suspense>
  );
}
