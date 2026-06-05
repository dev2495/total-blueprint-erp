"use client";

import { useParams } from "next/navigation";

import { GrnWizard } from "@/components/procurement/grn-wizard";

export default function PurchaseOrderReceivePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  if (!id) return null;
  return <GrnWizard poId={id} />;
}
