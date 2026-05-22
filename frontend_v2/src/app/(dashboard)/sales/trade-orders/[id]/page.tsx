"use client"

import { useParams } from "next/navigation"
import { TradeOrderDetail } from "@/components/trade-orders/trade-order-detail"

export default function TradeOrderDetailPage() {
    const params = useParams()
    const id = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : ""
    return <TradeOrderDetail id={id} />
}
