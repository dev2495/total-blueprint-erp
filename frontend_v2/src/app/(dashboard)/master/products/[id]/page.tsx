"use client"

import { useParams } from "next/navigation"
import { PmDetailV37 } from "@/components/product-master/pm-detail-v37"

export default function ProductMasterDetailPage() {
    const params = useParams<{ id: string }>()
    const id = (params?.id as string) || ""
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <PmDetailV37 productId={id} />
        </div>
    )
}
