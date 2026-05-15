"use client"

import { useParams } from "next/navigation"
import { VariantEditorWorkspace } from "@/components/product-master/variant-editor-workspace"

export default function NewVariantPage() {
    const params = useParams<{ id: string }>()
    const id = (params?.id as string) || ""
    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <VariantEditorWorkspace productId={id} mode="create" />
        </div>
    )
}
