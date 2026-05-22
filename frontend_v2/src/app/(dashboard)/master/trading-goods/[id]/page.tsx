"use client"

import { useParams } from "next/navigation"
import { TradingGoodEditor } from "@/components/trading-goods/trading-good-editor"

export default function EditTradingGoodPage() {
    const params = useParams()
    const id = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : ""
    return <TradingGoodEditor mode="edit" id={id} />
}
