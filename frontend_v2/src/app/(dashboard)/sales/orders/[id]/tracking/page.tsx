"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function LegacySalesOrderTrackingRedirect() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "");

  useEffect(() => {
    if (id) router.replace(`/sales/orders/${id}`);
  }, [id, router]);

  return (
    <div className="flex h-[70vh] items-center justify-center text-content-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Opening unified order tracker...
      </div>
    </div>
  );
}
