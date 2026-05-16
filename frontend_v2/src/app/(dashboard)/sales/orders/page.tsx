"use client"

import { SalesOrdersListWorkspace } from "@/components/sales-v37/sales-orders-list"

export default function SalesOrdersPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6" data-testid="sales-orders-list-page">
            <SalesOrdersListWorkspace />
        </div>
    )
}
