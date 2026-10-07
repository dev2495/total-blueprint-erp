"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { GoodsEntry } from "@/components/gate/goods-entry";
import { GuardLog } from "@/components/gate/gate-guards";

function GoodsPageInner() {
  const params = useSearchParams();
  const direction = params?.get("direction") === "OUTWARD" ? "OUTWARD" : "INWARD";
  return <GoodsEntry key={direction} initialDirection={direction} />;
}

export default function GateGoodsPage() {
  return (
    <GuardLog>
      <Suspense fallback={null}>
        <GoodsPageInner />
      </Suspense>
    </GuardLog>
  );
}
