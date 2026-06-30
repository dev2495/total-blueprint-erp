"use client";

import { SalesOrdersListWorkspace } from "@/components/sales-orders/sales-orders-list";

export default function SalesOrdersPage() {
  return (
    <div
      className="erp-production-surface min-h-screen px-4 py-4 sm:px-6"
      data-testid="sales-orders-list-page"
    >
      <SalesOrdersListWorkspace />
    </div>
  );
}
