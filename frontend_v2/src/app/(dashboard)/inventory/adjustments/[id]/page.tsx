"use client"

import { useParams } from "next/navigation"
import { StockAdjustmentDetail } from "@/components/stock-adjustments/adjustment-detail"

export default function StockAdjustmentDetailPage() {
    const params = useParams()
    const id = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : ""
    return <StockAdjustmentDetail id={id} />
}
