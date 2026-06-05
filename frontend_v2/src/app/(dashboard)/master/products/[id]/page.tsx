"use client";

import { useParams } from "next/navigation";
import { PmDetailV37 } from "@/components/product-master/pm-detail";

export default function ProductMasterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || "";
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-order-bg via-white to-order-bg px-4 py-4 sm:px-6">
      {/* Ambient color blobs — purely decorative, soften the canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-order-bg blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-40 -right-32 h-80 w-80 rounded-full bg-order-bg blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-success-bg blur-3xl"
      />
      <div className="relative">
        <PmDetailV37 productId={id} />
      </div>
    </div>
  );
}
