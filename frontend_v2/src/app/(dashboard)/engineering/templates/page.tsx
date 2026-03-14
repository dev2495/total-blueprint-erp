"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Search, ArrowRight } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { templateService, type TemplateBlueprint } from "@/services/templates"
import { routingService } from "@/services/routing"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { useRouter } from "next/navigation"

type DraftPouchStyle = NonNullable<TemplateBlueprint["pouch_style"]>

export default function EngineeringTemplatesPage() {
    const router = useRouter()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("ALL")
    const [createOpen, setCreateOpen] = useState(false)
    const [draftName, setDraftName] = useState("")
    const [draftFgType, setDraftFgType] = useState<"POUCH" | "ROLL">("POUCH")
    const [draftPouchStyle, setDraftPouchStyle] = useState<DraftPouchStyle>("PILLOW")
    const [draftRoutingRule, setDraftRoutingRule] = useState<string>("__NONE__")

    const { data: templates, isLoading, isError, error } = useQuery({
        queryKey: ["templates"],
        queryFn: () => templateService.getTemplates(),
    })
    const { data: schemaHealth } = useQuery({
        queryKey: ["templates-schema-health"],
        queryFn: () => templateService.getSchemaHealth(),
        retry: false,
    })
    const { data: routingRules } = useQuery({
        queryKey: ["routing-rules"],
        queryFn: () => routingService.getRules(),
    })

    const createTemplateMutation = useMutation({
        mutationFn: () => {
            const name = draftName.trim()
            if (!name) throw new Error("Template name is required.")
            return templateService.createTemplate({
                name,
                fg_type: draftFgType,
                pouch_style: draftFgType === "POUCH" ? draftPouchStyle : "",
                routing_rule: draftRoutingRule === "__NONE__" ? null : draftRoutingRule,
            })
        },
        onSuccess: (created) => {
            queryClient.invalidateQueries({ queryKey: ["templates"] })
            setCreateOpen(false)
            setDraftName("")
            setDraftFgType("POUCH")
            setDraftPouchStyle("PILLOW")
            setDraftRoutingRule("__NONE__")
            toast({ title: "Template created", description: "Route template draft created successfully." })
            router.push(`/engineering/templates/${created.id}`)
        },
        onError: (err: any) => {
            toast({
                title: "Create failed",
                description: err?.response?.data?.detail || err?.message || "Could not create template.",
                variant: "destructive",
            })
        }
    })

    const filtered = (Array.isArray(templates) ? templates : []).filter(t => {
        const matchesSearch = t.name.toLowerCase().includes(searchTerm.toLowerCase()) || t.id.includes(searchTerm)
        const matchesStatus = statusFilter === "ALL" || t.status === statusFilter
        return matchesSearch && matchesStatus
    })

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'DRAFT': return <Badge variant="secondary">Draft</Badge>
            case 'ENGINEERING': return <Badge className="bg-purple-100 text-purple-700 hover:bg-purple-200">Engineering</Badge>
            case 'APPROVED': return <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200">Approved</Badge>
            case 'LIVE': return <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200">Live</Badge>
            case 'OBSOLETE': return <Badge variant="outline" className="text-slate-400">Obsolete</Badge>
            default: return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="p-6 lg:p-8 space-y-6"> {/* Changed main div class */}
            <div className="flex items-center justify-between"> {/* Updated header structure */}
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="bg-slate-900 text-white border-0 px-2 py-0.5">ENGINEERING HUB</Badge>
                    </div>
                    <h1 className="text-3xl font-black tracking-tighter text-slate-900 italic">
                        Template <span className="text-indigo-600 not-italic">Studio</span>
                    </h1>
                    <p className="text-slate-500 font-medium">Manage route contracts, step material rules, issue policies, and roll handling rules.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        className="h-11 px-8 rounded-xl bg-indigo-600 hover:bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-200 transition-all active-scale"
                        onClick={() => setCreateOpen(true)}
                    >
                        <Plus className="h-4 w-4 mr-2" /> New Template
                    </Button>
                </div>
            </div>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Create Route Template</DialogTitle>
                            <DialogDescription>
                            Templates define final product type, route contract, step material policy, and roll handling rules.
                            </DialogDescription>
                        </DialogHeader>
                    <div className="grid grid-cols-1 gap-4 py-2">
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-slate-600">Template Name</p>
                            <Input
                                value={draftName}
                                onChange={(e) => setDraftName(e.target.value)}
                                placeholder="e.g. Pouch Route V2"
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                            <div className="space-y-2">
                                <p className="text-xs font-semibold uppercase text-slate-600">FG Type</p>
                                <Select value={draftFgType} onValueChange={(v: "POUCH" | "ROLL") => setDraftFgType(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="POUCH">POUCH</SelectItem>
                                        <SelectItem value="ROLL">ROLL</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {draftFgType === "POUCH" ? (
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold uppercase text-slate-600">Pouch Style</p>
                                    <Select value={draftPouchStyle} onValueChange={(value) => setDraftPouchStyle(value as DraftPouchStyle)}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="THREE_SIDE_SEAL">Three Side Seal</SelectItem>
                                            <SelectItem value="PILLOW">Pillow</SelectItem>
                                            <SelectItem value="STAND_UP">Stand Up</SelectItem>
                                            <SelectItem value="SIDE_GUSSET">Side Gusset</SelectItem>
                                            <SelectItem value="QUAD_SEAL">Quad Seal</SelectItem>
                                            <SelectItem value="FLAT_BOTTOM">Flat Bottom</SelectItem>
                                            <SelectItem value="SPOUT">Spout</SelectItem>
                                            <SelectItem value="SHAPED">Shaped</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : null}
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase text-slate-600">Routing Rule</p>
                            <Select value={draftRoutingRule} onValueChange={setDraftRoutingRule}>
                                <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__NONE__">No route yet</SelectItem>
                                    {(routingRules || []).map((rule: any) => (
                                        <SelectItem key={rule.id} value={rule.id}>{rule.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button onClick={() => createTemplateMutation.mutate()} disabled={createTemplateMutation.isPending}>
                            {createTemplateMutation.isPending ? "Creating..." : "Create & Open Studio"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Filters */}
            <Card className="p-4 rounded-xl border-slate-200 shadow-sm bg-white"> {/* Added new Card for filters */}
                <div className="flex items-center gap-4">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            placeholder="Search blueprints..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-9 bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
                        />
                    </div>
                    <div className="flex items-center gap-1 border-l pl-4 border-slate-100">
                        {['ALL', 'DRAFT', 'ENGINEERING', 'LIVE'].map((status) => (
                            <Button
                                key={status}
                                variant={statusFilter === status ? "default" : "ghost"}
                                size="sm"
                                onClick={() => setStatusFilter(status)}
                                className={cn(
                                    "text-[10px] font-black uppercase tracking-wider h-7",
                                    statusFilter === status ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
                                )}
                            >
                                {status}
                            </Button>
                        ))}
                    </div>
                </div>
            </Card>

            {schemaHealth && schemaHealth.healthy === false ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-700">Template Schema Warning</div>
                    <div className="mt-1 font-semibold">{schemaHealth.message}</div>
                    {schemaHealth.detail ? <div className="mt-1 text-xs">{schemaHealth.detail}</div> : null}
                </div>
            ) : null}

            <Card className="border-slate-200 shadow-sm rounded-xl overflow-hidden bg-white"> {/* Updated Card class */}
                <CardHeader className="p-6 pb-2 border-b border-slate-50 bg-slate-50/30"> {/* Updated CardHeader class */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <CardTitle className="text-lg font-black tracking-tight text-slate-900 uppercase italic">Blueprint Registry</CardTitle>
                        {/* Removed search input from here */}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="px-6 text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Blueprint Name</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Type</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Status</TableHead>
                                <TableHead className="text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Version</TableHead>
                                <TableHead className="text-right px-6 text-[9px] font-black uppercase text-slate-400 italic tracking-widest">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-20">Loading...</TableCell>
                                </TableRow>
                            ) : isError ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="py-10">
                                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
                                            <div className="font-bold">Template registry could not load.</div>
                                            <div className="mt-1 text-xs">
                                                {(error as any)?.response?.data?.detail || (error as Error)?.message || "Unknown template registry error."}
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="text-center py-24 text-[11px] font-black uppercase text-slate-300 italic tracking-[0.2em]">
                                        No blueprints found
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filtered.map((t) => (
                                    <TableRow key={t.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50/50 cursor-pointer group">
                                        <TableCell className="px-6 py-4">
                                            <div className="flex flex-col">
                                                <span className="font-black text-slate-900 uppercase tracking-tight text-xs group-hover:text-indigo-600 transition-colors">{t.name}</span>
                                                <span className="text-[9px] text-slate-400 font-medium">{t.id.slice(0, 8)}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <span className="px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[9px] font-black uppercase tracking-widest text-slate-600">
                                                {t.fg_type}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            {getStatusBadge(t.status)}
                                        </TableCell>
                                        <TableCell>
                                            <span className="text-xs font-bold text-slate-600">v{t.version}</span>
                                        </TableCell>
                                        <TableCell className="text-right px-6">
                                            <Button variant="ghost" size="sm" asChild className="hover:bg-indigo-50 hover:text-indigo-600">
                                                <Link href={`/engineering/templates/${t.id}`}>
                                                    Studio <ArrowRight className="h-3 w-3 ml-1" />
                                                </Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
