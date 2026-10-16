"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/** The stock launcher now lives in the Control Tower (tab 7); old links and bookmarks land there. */
function LegacyStockLauncherRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const query = searchParams?.toString();
    router.replace(`/dashboard/planner/control-tower/stock-launcher${query ? `?${query}` : ""}`);
  }, [router, searchParams]);
  return (
    <div className="flex h-[70vh] items-center justify-center text-content-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Opening the stock launcher in the Control Tower...
      </div>
    </div>
  );
}

export default function StockLauncherPage() {
  return (
    <Suspense fallback={null}>
      <LegacyStockLauncherRedirect />
    </Suspense>
  );
}
