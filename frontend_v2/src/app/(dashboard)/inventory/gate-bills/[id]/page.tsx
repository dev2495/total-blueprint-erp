"use client";

import { useParams } from "next/navigation";
import { GateBillDetail } from "@/components/inventory/gate-bills/bill-detail";

export default function GateBillDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  return <GateBillDetail id={id} />;
}
