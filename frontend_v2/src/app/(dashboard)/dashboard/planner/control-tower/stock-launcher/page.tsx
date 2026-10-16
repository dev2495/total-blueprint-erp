"use client";

import { Suspense } from "react";

import { StockLauncherV3Workspace } from "@/components/planner-launcher/stock-launcher-workspace";

/** Tab 7 of the Control Tower: the stock launcher, same shell as the other planner tabs. */
export default function ControlTowerStockLauncherTab() {
  return (
    <Suspense fallback={<div className="erp-skeleton h-[320px] rounded-[18px]" />}>
      <StockLauncherV3Workspace />
    </Suspense>
  );
}
