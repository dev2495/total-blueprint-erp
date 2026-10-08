"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { GrnWizard } from "@/components/procurement/grn-wizard";

export default function PurchaseOrderReceivePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  if (!id) return null;
  // Suspense: the wizard reads ?inward_bill_id= (gate bill context).
  return (
    <Suspense fallback={null}>
      <GrnWizard poId={id} />
    </Suspense>
  );
}
