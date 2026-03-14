"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle, Workflow } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { templateService } from "@/services/templates"
import { routingService } from "@/services/routing"
import { TemplateBomEditor } from "@/components/engineering/template-bom-editor"

export default function TemplateStudioPage() {
    const params = useParams()
    const id = params?.id as string
    const router = useRouter()
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [routingRuleId, setRoutingRuleId] = useState("")

    const { data: template, isLoading, isError, error } = useQuery({
        queryKey: ["template", id],
        queryFn: () => templateService.getTemplate(id),
    })
    const { data: routingRules } = useQuery({
        queryKey: ["routing-rules"],
        queryFn: () => routingService.getRules(),
    })

    const updateMutation = useMutation({
        mutationFn: (data: any) => templateService.updateTemplate(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template", id] })
            toast({ title: "Saved", description: "Template route updated." })
        },
        onError: (err: any) => toast({ title: "Error", description: err?.response?.data?.detail || err?.message, variant: "destructive" }),
    })

    const approveMutation = useMutation({
        mutationFn: () => templateService.approveTemplate(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template", id] })
            toast({ title: "Template Live", description: "Template is ready for production route usage." })
        },
        onError: (err: any) => toast({ title: "Approval Failed", description: err?.response?.data?.detail || err?.message, variant: "destructive" }),
    })

    if (isLoading) return <div className="p-8 text-sm text-slate-500">Loading template...</div>
    if (isError) {
        const detail = (error as any)?.response?.data?.detail || (error as Error)?.message || "Could not load template."
        return (
            <div className="p-6 space-y-6">
                <div className="rounded-3xl border border-rose-200 bg-rose-50 px-6 py-5">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-700">Template Load Failed</div>
                    <div className="mt-1 text-base font-bold text-rose-900">{detail}</div>
                    <div className="mt-2 text-sm text-rose-700">
                        If this mentions schema, run the templates migrations first.
                    </div>
                </div>
            </div>
        )
    }
    if (!template) return <div className="p-8 text-sm text-red-500">Template not found.</div>

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div>
                        <h1 className="text-lg font-bold">{template.name}</h1>
                        <p className="text-xs text-slate-500">Template is the source of final product type, route contract, step material policy, and roll handling rules.</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                        Final Product Type: {template.fg_type}
                    </div>
                    <div className={`rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] ${
                        template.status === "OBSOLETE"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-slate-200 bg-white text-slate-500"
                    }`}>
                        Status: {template.status}
                    </div>
                    <Button
                        onClick={() => approveMutation.mutate()}
                        disabled={approveMutation.isPending || template.status === "LIVE" || template.status === "OBSOLETE"}
                    >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {template.status === "LIVE" ? "LIVE" : template.status === "OBSOLETE" ? "READ ONLY" : "Approve / Publish"}
                    </Button>
                </div>
            </div>

            {template.status === "OBSOLETE" ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                    This template is obsolete and hidden from active selectors. It remains readable for historical traceability, but it should not be used for new planning.
                </div>
            ) : null}

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Workflow className="h-4 w-4" />
                        Route Binding
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Label className="text-xs">Routing Rule</Label>
                    <Select value={routingRuleId || template.routing_rule || ""} onValueChange={setRoutingRuleId}>
                        <SelectTrigger className="h-9 text-xs bg-white"><SelectValue placeholder="Select route rule" /></SelectTrigger>
                        <SelectContent>
                            {(routingRules || []).map((r: any) => (
                                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateMutation.mutate({ routing_rule: routingRuleId || template.routing_rule })}
                        disabled={updateMutation.isPending || !(routingRuleId || template.routing_rule) || template.status === "LIVE" || template.status === "OBSOLETE"}
                    >
                        Save Route
                    </Button>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Template Scope</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-slate-500">
                        Template controls route steps, roll behavior policy, and step-wise bulk category consumption mapping.
                        Product specs and artwork selection are managed in Sales/Stock orders.
                    </p>
                </CardContent>
            </Card>

            <TemplateBomEditor template={template as any} />
        </div>
    )
}
