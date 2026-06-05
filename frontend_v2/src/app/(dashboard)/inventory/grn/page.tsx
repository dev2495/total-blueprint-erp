"use client";

import { Suspense } from "react";
import { GrnSmartV36 } from "@/components/inventory/grn-smart";

export default function GrnV36Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-3xl border border-line bg-surface-1 p-8 text-sm text-content-3">
          Loading GRN…
        </div>
      }
    >
      <div className="-mx-3 min-h-screen w-auto max-w-none overflow-visible bg-gradient-to-b from-surface-2 via-white to-surface-2 px-2 py-3 sm:-mx-4 sm:px-3 lg:-mx-6 lg:px-4 xl:-mx-8 xl:px-5">
        <GrnSmartV36 />
      </div>
    </Suspense>
  );
}
