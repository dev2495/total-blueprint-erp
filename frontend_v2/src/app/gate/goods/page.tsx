"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { GoodsEntry } from "@/components/gate/goods-entry";
import { BillCapture } from "@/components/gate/bill-capture";
import { GoodsHub } from "@/components/gate/goods-hub";
import { GuardBillSubmit, GuardLog } from "@/components/gate/gate-guards";

/**
 * Inward is recorded by bill photo only (the typed inward form is retired);
 * outward keeps the existing typed register. No direction ⇒ choose a lane.
 */
function GoodsPageInner() {
  const params = useSearchParams();
  const direction = params?.get("direction");
  if (direction === "OUTWARD") {
    return (
      <GuardLog>
        <GoodsEntry key="OUTWARD" initialDirection="OUTWARD" />
      </GuardLog>
    );
  }
  if (direction === "INWARD") {
    return (
      <GuardBillSubmit>
        <BillCapture />
      </GuardBillSubmit>
    );
  }
  return <GoodsHub />;
}

export default function GateGoodsPage() {
  return (
    <Suspense fallback={null}>
      <GoodsPageInner />
    </Suspense>
  );
}
