"use client";

import { SalesOrderV34Workspace } from "@/components/sales-order-create/sales-order-workspace";

export default function CreateSalesOrderPage() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_6%_-8%,rgba(79,70,229,0.10),transparent_32rem),radial-gradient(circle_at_95%_2%,rgba(16,185,129,0.07),transparent_30rem),linear-gradient(180deg,#eef2ff_0%,#f1f5f9_55%,#eef4f8_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <SalesOrderV34Workspace />
    </div>
  );
}
