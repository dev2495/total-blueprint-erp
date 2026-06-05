"use client";

import { useParams } from "next/navigation";
import { ProductMasterEditWorkspace } from "@/components/product-master/product-master-edit";

export default function ProductMasterEditPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || "";
  return (
    <div className="px-4 py-4 sm:px-6">
      <ProductMasterEditWorkspace productId={id} />
    </div>
  );
}
