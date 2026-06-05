"use client";

import { useParams } from "next/navigation";

import { PurchaseOrderDetailWorkspace } from "@/components/procurement/po-detail-workspace";

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  if (!id) return null;
  return <PurchaseOrderDetailWorkspace poId={id} />;
}
