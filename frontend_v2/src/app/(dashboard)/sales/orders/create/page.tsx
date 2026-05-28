"use client"

import { SalesOrderV34Workspace } from "@/components/sales-order-create/sales-order-workspace"

export default function CreateSalesOrderPage() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <SalesOrderV34Workspace />
        </div>
    )
}
