"use client";

import { useParams } from "next/navigation";
import { PmDetailV37 } from "@/components/product-master/pm-detail";

export default function ProductMasterDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || "";
  return (
    <div className="pm-master-canvas min-h-screen overflow-x-hidden px-4 py-4 sm:px-6">
      <div className="pm-detail-viewport relative mx-auto w-full max-w-[1840px]">
        <PmDetailV37 productId={id} />
      </div>
    </div>
  );
}
