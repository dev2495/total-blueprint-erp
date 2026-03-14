"use client"

import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { templateService } from "@/services/templates"
import { PageHeader } from "@/components/ui-custom/page-header"
import ApprovalForm from "./ApprovalForm"
import { Loader2, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ApprovalDetailPage() {
    const params = useParams()
    const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "")
    const router = useRouter()

    const { data: template, isLoading } = useQuery({
        queryKey: ["template", id],
        queryFn: () => templateService.getTemplate(id as string),
        enabled: !!id,
    })

    if (isLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!template) {
        return (
            <div className="text-center py-20">
                <h2 className="text-2xl font-bold">Template Not Found</h2>
                <Button variant="link" onClick={() => router.back()}>Go back</Button>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <PageHeader
                    title={`Review: ${template.name}`}
                    description={`Engineering validation for ${template.fg_type} configuration.`}
                />
            </div>

            <ApprovalForm template={template} />
        </div>
    )
}
