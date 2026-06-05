"use client";

import { StockLauncherV3Workspace } from "@/components/planner-launcher/stock-launcher-workspace";

export default function StockLauncherPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
      <StockLauncherV3Workspace />
    </div>
  );
}
