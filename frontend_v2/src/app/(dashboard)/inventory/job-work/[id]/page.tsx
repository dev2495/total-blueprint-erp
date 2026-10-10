"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { JobWorkDetail } from "@/components/job-work/job-work-detail";

/** One job-work order: challans, returns (with the bill beside the form when ?bill=), close. */
export default function JobWorkOrderPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  return (
    <Suspense fallback={<div className="mx-auto h-64 max-w-[1400px] animate-pulse rounded-3xl bg-surface-2" />}>
      <JobWorkDetail id={id} />
    </Suspense>
  );
}
