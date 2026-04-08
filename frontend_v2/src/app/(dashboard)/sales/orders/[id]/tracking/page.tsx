"use client"

import { useParams, useRouter } from "next/navigation"
import { type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import {
    Activity,
    ArrowLeft,
    CheckCircle2,
    Clock3,
    Factory,
    Layers3,
    Loader2,
    Package,
    ShieldCheck,
    Truck,
    UserRound,
    Warehouse,
} from "lucide-react"

import { analyticsService } from "@/services/analytics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

function formatTs(value?: string | null) {
    if (!value) return "—"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function formatDate(value?: string | null) {
    if (!value) return "No date"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function safeNumber(value: unknown) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function identityLabel(name?: string | null, username?: string | null, fallback = "—") {
    const displayName = String(name || "").trim()
    const handle = String(username || "").trim()
    if (displayName && handle) return `${displayName} · @${handle}`
    return displayName || (handle ? `@${handle}` : fallback)
}

function codedLabel(name?: string | null, code?: string | null, fallback = "—") {
    const label = String(name || "").trim()
    const tag = String(code || "").trim()
    if (label && tag && label.toUpperCase() !== tag.toUpperCase()) return `${label} · ${tag}`
    return label || tag || fallback
}

function statusTone(status: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (normalized === "CANCELLED") return "border-rose-200 bg-rose-50 text-rose-700"
    if (normalized === "EXECUTING") return "border-red-200 bg-red-50 text-red-700"
    if (normalized === "RELEASED" || normalized === "PLANNED") return "border-indigo-200 bg-indigo-50 text-indigo-700"
    if (normalized === "PACKING_READY") return "border-violet-200 bg-violet-50 text-violet-700"
    if (normalized === "IN_TRANSIT" || normalized === "DISPATCH_READY") return "border-cyan-200 bg-cyan-50 text-cyan-700"
    if (normalized === "ON_HOLD" || normalized === "PAUSED" || normalized === "PLANNING_REQUIRED") return "border-amber-200 bg-amber-50 text-amber-700"
    return "border-slate-200 bg-slate-50 text-slate-700"
}

function progressParts(progress: any) {
    const ordered = Math.max(safeNumber(progress?.ordered), 0)
    const produced = Math.max(safeNumber(progress?.produced), 0)
    const packed = Math.max(safeNumber(progress?.packed), 0)
    const dispatched = Math.max(safeNumber(progress?.dispatched), 0)
    if (!ordered) return { producedPct: 0, packedPct: 0, dispatchedPct: 0 }
    return {
        producedPct: Math.min((produced / ordered) * 100, 100),
        packedPct: Math.min((packed / ordered) * 100, 100),
        dispatchedPct: Math.min((dispatched / ordered) * 100, 100),
    }
}

export default function OrderTrackingPage() {
    const params = useParams()
    const router = useRouter()
    const orderId = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "")

    const { data, isLoading, error } = useQuery({
        queryKey: ["order-tracking", orderId],
        queryFn: () => analyticsService.getOrderTracking(orderId),
        refetchInterval: 10_000,
    })

    if (isLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb]">
                <div className="text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-500" />
                    <div className="mt-3 text-sm font-medium text-slate-500">Loading live order tracking…</div>
                </div>
            </div>
        )
    }

    if (error || !data || data.error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-[#f4f6fb] p-6">
                <Card className="w-full max-w-xl rounded-3xl border border-rose-200 bg-white">
                    <CardContent className="space-y-4 p-8 text-center">
                        <div className="text-lg font-black text-slate-900">Tracking unavailable</div>
                        <div className="text-sm text-slate-500">
                            {data?.error || `Could not find order ${orderId}.`}
                        </div>
                        <div className="flex items-center justify-center gap-3">
                            <Button variant="outline" onClick={() => router.back()}>Back</Button>
                            <Button onClick={() => window.location.reload()}>Retry</Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const progress: any = data.progress || {}
    const progressBars = progressParts(progress)
    const activeJobs = Array.isArray(data.active_jobs) ? data.active_jobs : []
    const completedJobs = Array.isArray(data.completed_jobs) ? data.completed_jobs : []
    const lineItems = Array.isArray(data.line_items) ? data.line_items : []
    const wipLineage = Array.isArray(data.wip_lineage) ? data.wip_lineage : []
    const dispatchEvidence = Array.isArray(data.dispatch_evidence) ? data.dispatch_evidence : []
    const auditTimeline = Array.isArray(data.audit_timeline) ? data.audit_timeline : []
    const materialRows = Array.isArray(data.material_audit?.materials) ? data.material_audit?.materials : []
    const interplantLinks = Array.isArray(data.interplant_links) ? data.interplant_links : []
    const freshness = data.data_freshness
    const header: any = data.order_header || {}
    const kpis: any = data.kpi_snapshot || {}

    return (
        <div className="min-h-screen bg-[#f4f6fb] p-4 lg:p-6" data-testid="sales-order-tracking-page">
            <div className="mx-auto flex max-w-[1680px] flex-col gap-5">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_14px_38px_-28px_rgba(15,23,42,0.32)]">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                            <Button variant="ghost" size="sm" onClick={() => router.back()} className="h-auto px-0 text-slate-500 hover:text-slate-900">
                                <ArrowLeft className="mr-2 h-4 w-4" />
                                Back to sales orders
                            </Button>
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.16em] text-indigo-600">Live tracking</div>
                                <div className="mt-1 flex flex-wrap items-center gap-3">
                                    <h1 className="text-2xl font-black tracking-tight text-slate-900">{data.order_number}</h1>
                                    <span className={cn("rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]", statusTone(data.status))}>
                                        {data.status}
                                    </span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-3 text-sm text-slate-500">
                                    <span>{data.customer}</span>
                                    <span>Delivery {formatDate(data.delivery_date)}</span>
                                    <span>{safeNumber(header?.totals?.ordered_kg).toFixed(2)} kg</span>
                                    <span>{header?.totals?.ordered_pcs != null ? `${safeNumber(header.totals.ordered_pcs)} pcs` : "— pcs"}</span>
                                    <span>{safeNumber(header?.totals?.line_count)} line(s)</span>
                                </div>
                            </div>
                        </div>

                        <div className="min-w-[320px] space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="flex items-center justify-between">
                                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Fulfillment truth</div>
                                <div className="text-right">
                                    <div className="text-xl font-black text-indigo-600">{safeNumber(progress.completion_percentage).toFixed(0)}%</div>
                                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Complete</div>
                                </div>
                            </div>
                            <ProgressRow label="Produced" value={safeNumber(progress.produced)} total={safeNumber(progress.ordered)} percent={progressBars.producedPct} tone="bg-indigo-500" />
                            <ProgressRow label="Packed" value={safeNumber(progress.packed)} total={safeNumber(progress.ordered)} percent={progressBars.packedPct} tone="bg-cyan-500" />
                            <ProgressRow label="Dispatched" value={safeNumber(progress.dispatched)} total={safeNumber(progress.ordered)} percent={progressBars.dispatchedPct} tone="bg-emerald-500" />
                            <div className="text-[11px] text-slate-500">
                                Refresh {freshness?.generated_at ? formatTs(freshness.generated_at) : "live"}
                            </div>
                        </div>
                    </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                    <KpiCard icon={Package} title="Ordered" value={`${safeNumber(kpis.ordered_kg).toFixed(2)} kg`} tone="blue" />
                    <KpiCard icon={Factory} title="Produced" value={`${safeNumber(kpis.produced_kg).toFixed(2)} kg`} tone="indigo" />
                    <KpiCard icon={Layers3} title="WIP Output" value={`${safeNumber(kpis.wip_output_kg ?? kpis.output_roll_kg).toFixed(2)} kg`} tone="amber" />
                    <KpiCard icon={Warehouse} title="FG Ready" value={`${safeNumber(kpis.fg_kg).toFixed(2)} kg`} tone="emerald" />
                    <KpiCard icon={Truck} title="Transit" value={`${safeNumber(kpis.interplant_output_in_transit_kg ?? kpis.interplant_in_transit_kg).toFixed(2)} kg`} tone="violet" />
                    <KpiCard icon={CheckCircle2} title="Jobs Closed" value={`${safeNumber(kpis.completed_jobs)}`} tone="slate" />
                </section>

                <Tabs defaultValue="jobs" className="space-y-4">
                    <TabsList className="w-full justify-start overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1">
                        <TabsTrigger value="jobs">Jobs</TabsTrigger>
                        <TabsTrigger value="inventory">Inventory</TabsTrigger>
                        <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
                        <TabsTrigger value="audit">Audit Trail</TabsTrigger>
                        <TabsTrigger value="sku">SKU Status</TabsTrigger>
                    </TabsList>

                    <TabsContent value="jobs" className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
                            <SectionCard title={`Active jobs (${activeJobs.length})`} icon={Factory}>
                                {activeJobs.length ? (
                                    <div className="space-y-3">
                                        {activeJobs.map((job: any) => (
                                            <JobCard key={job.job_id || job.id || job.job_number} job={job} mode="active" />
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyState label="No active jobs are executing right now." />
                                )}
                            </SectionCard>

                            <SectionCard title={`Completed jobs (${completedJobs.length})`} icon={CheckCircle2}>
                                {completedJobs.length ? (
                                    <div className="space-y-3">
                                        {completedJobs.map((job: any) => (
                                            <JobCard key={job.job_id || job.id || job.job_number} job={job} mode="completed" />
                                        ))}
                                    </div>
                                ) : (
                                    <EmptyState label="No completed jobs recorded yet." />
                                )}
                            </SectionCard>
                        </div>
                    </TabsContent>

                    <TabsContent value="inventory" className="space-y-4">
                        <SectionCard title={`Line truth (${lineItems.length})`} icon={Package}>
                            <DataGrid
                                rows={lineItems.map((line: any) => ({
                                    template: line.template_name,
                                    fg_type: line.fg_type,
                                    ordered_kg: `${safeNumber(line.ordered_kg).toFixed(2)} kg`,
                                    produced_kg: `${safeNumber(line.produced_kg).toFixed(2)} kg`,
                                    dispatched_kg: `${safeNumber(line.dispatched_kg).toFixed(2)} kg`,
                                    wip_output_kg: `${safeNumber(line.wip_output_kg).toFixed(2)} kg`,
                                    wip_remainder_kg: `${safeNumber(line.wip_remainder_kg).toFixed(2)} kg`,
                                    completion: `${safeNumber(line.completion_percentage).toFixed(0)}%`,
                                }))}
                            />
                        </SectionCard>
                        <SectionCard title={`Inventory lineage (${wipLineage.length})`} icon={Layers3}>
                            <DataGrid
                                rows={wipLineage.map((roll: any) => ({
                                    label: roll.label_id,
                                    role: roll.roll_role,
                                    material: roll.material_code || roll.material,
                                    weight: `${safeNumber(roll.weight_kg).toFixed(3)} kg`,
                                    status: roll.status,
                                    location: roll.location || "—",
                                    created_job: roll.created_job_number || "—",
                                }))}
                            />
                        </SectionCard>
                    </TabsContent>

                    <TabsContent value="dispatch" className="space-y-4">
                        <SectionCard title={`Dispatch challans (${dispatchEvidence.length})`} icon={Truck}>
                            <DataGrid
                                rows={dispatchEvidence.map((challan: any) => ({
                                    dc_no: challan.dc_no,
                                    status: challan.status,
                                    dispatched_kg: `${safeNumber(challan.dispatched_kg).toFixed(2)} kg`,
                                    vehicle: challan.vehicle_no || "—",
                                    dispatch_date: formatTs(challan.dispatch_date),
                                    received_date: formatTs(challan.received_date),
                                }))}
                            />
                        </SectionCard>
                        <SectionCard title={`Inter-plant movement (${interplantLinks.length})`} icon={Truck}>
                            <DataGrid
                                rows={interplantLinks.map((link: any) => ({
                                    dc_no: link.dc_no,
                                    status: link.status,
                                    from: link.from_plant,
                                    to: link.to_plant,
                                    source_job: link.source_job_number || "—",
                                    target_job: link.target_job_number || "—",
                                    dispatched_kg: `${safeNumber(link.summary?.dispatched_total_kg).toFixed(2)} kg`,
                                }))}
                            />
                        </SectionCard>
                    </TabsContent>

                    <TabsContent value="audit" className="space-y-4">
                        <SectionCard title={`Audit timeline (${auditTimeline.length})`} icon={ShieldCheck}>
                            <div className="space-y-2">
                                {auditTimeline.length ? auditTimeline.slice(0, 60).map((event: any, index: number) => (
                                    <div key={`${event.reference || event.entity_id || index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="text-sm font-bold text-slate-900">{event.message || event.event_type}</div>
                                            <div className="text-[11px] text-slate-500">{formatTs(event.timestamp)}</div>
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                                            <span>{event.actor || "system"}</span>
                                            <span>{event.entity_type}</span>
                                            {event.reference ? <span>{event.reference}</span> : null}
                                            {event.delta_qty_kg != null ? <span>{safeNumber(event.delta_qty_kg).toFixed(3)} kg</span> : null}
                                        </div>
                                    </div>
                                )) : <EmptyState label="No audit events recorded." />}
                            </div>
                        </SectionCard>
                        <SectionCard title={`Material audit (${materialRows.length})`} icon={Layers3}>
                            <DataGrid
                                rows={materialRows.map((row: any) => ({
                                    material: `${row.material_code} · ${row.material_name}`,
                                    category: row.category,
                                    required: `${safeNumber(row.required_kg).toFixed(3)} kg`,
                                    consumed: `${safeNumber(row.consumed_kg).toFixed(3)} kg`,
                                    remaining: `${safeNumber(row.remaining_kg).toFixed(3)} kg`,
                                    steps: row.steps,
                                }))}
                            />
                        </SectionCard>
                    </TabsContent>

                    <TabsContent value="sku" className="space-y-4">
                        <SectionCard title={`SKU item status (${lineItems.length})`} icon={Package}>
                            <div className="grid gap-4 lg:grid-cols-2">
                                {lineItems.length ? lineItems.map((line: any) => (
                                    <div key={line.sales_order_item_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="text-sm font-black text-slate-900">{line.template_name || "Item"}</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[10px] font-bold text-orange-700">{line.fg_type}</span>
                                            {line.roll_form ? <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">{line.roll_form}</span> : null}
                                            {line.printing_enabled ? <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold text-fuchsia-700">{line.printing_type || "PRINT"}</span> : null}
                                        </div>
                                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                            <Metric label="Ordered" value={`${safeNumber(line.ordered_kg).toFixed(2)} kg`} />
                                            <Metric label="Produced" value={`${safeNumber(line.produced_kg).toFixed(2)} kg`} />
                                            <Metric label="Packed" value={`${safeNumber(line.packed_kg).toFixed(2)} kg`} />
                                            <Metric label="Dispatched" value={`${safeNumber(line.dispatched_kg).toFixed(2)} kg`} />
                                        </div>
                                    </div>
                                )) : <EmptyState label="No line items available." />}
                            </div>
                        </SectionCard>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    )
}

function ProgressRow({
    label,
    value,
    total,
    percent,
    tone,
}: {
    label: string
    value: number
    total: number
    percent: number
    tone: string
}) {
    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600">
                <span>{label}</span>
                <span>{value.toFixed(2)} / {total.toFixed(2)} kg</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white">
                <div className={cn("h-full", tone)} style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
            </div>
        </div>
    )
}

function KpiCard({ icon: Icon, title, value, tone }: { icon: any; title: string; value: string; tone: string }) {
    const toneClass =
        tone === "blue" ? "bg-blue-50 text-blue-700" :
        tone === "indigo" ? "bg-indigo-50 text-indigo-700" :
        tone === "amber" ? "bg-amber-50 text-amber-700" :
        tone === "emerald" ? "bg-emerald-50 text-emerald-700" :
        tone === "violet" ? "bg-violet-50 text-violet-700" :
        "bg-slate-100 text-slate-700"

    return (
        <Card className="rounded-2xl border border-slate-200 bg-white">
            <CardContent className="p-4">
                <div className={cn("mb-3 inline-flex rounded-xl p-2.5", toneClass)}>
                    <Icon className="h-4 w-4" />
                </div>
                <div className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-400">{title}</div>
                <div className="mt-1 text-lg font-black text-slate-900">{value}</div>
            </CardContent>
        </Card>
    )
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
    return (
        <Card className="rounded-3xl border border-slate-200 bg-white">
            <CardHeader className="border-b border-slate-100 pb-4">
                <CardTitle className="flex items-center gap-2 text-base font-black text-slate-900">
                    <Icon className="h-4 w-4 text-indigo-600" />
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-4">{children}</CardContent>
        </Card>
    )
}

function JobCard({ job, mode }: { job: any; mode: "active" | "completed" }) {
    const logs = Array.isArray(job.logs) ? job.logs.slice(0, 4) : []
    return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-black text-slate-900">{job.job_number || "Job"}</div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]", statusTone(job.state))}>
                            {job.state}
                        </span>
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                        {[job.step_name || "Process step", job.process_code].filter(Boolean).join(" · ")}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-right text-[11px] font-semibold text-slate-500">
                    <span>{safeNumber(job.produced_kg).toFixed(3)} kg out</span>
                    <span>{safeNumber(job.scrap_kg).toFixed(3)} kg scrap</span>
                </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Work center" value={codedLabel(job.work_center, job.work_center_code, "Unassigned")} icon={<Warehouse className="h-3.5 w-3.5" />} />
                <Metric label="Machine" value={codedLabel(job.machine || job.assigned_machine, job.machine_code || job.assigned_machine_code, "Unassigned")} icon={<Factory className="h-3.5 w-3.5" />} />
                <Metric label="Operator" value={identityLabel(job.operator, job.operator_username, "Pending")} icon={<UserRound className="h-3.5 w-3.5" />} />
                <Metric label={mode === "completed" ? "Closed by" : "Assigned by"} value={mode === "completed" ? identityLabel(job.closed_by, job.closed_by_username) : identityLabel(job.assigned_by, null)} icon={<ShieldCheck className="h-3.5 w-3.5" />} />
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Created" value={formatTs(job.created_at)} />
                <Metric label="Started" value={formatTs(job.start_date)} />
                <Metric label={mode === "completed" ? "Closed" : "Assigned"} value={formatTs(mode === "completed" ? job.closed_at : job.assigned_at)} />
                <Metric label="Variance" value={`${safeNumber(job.variance_kg).toFixed(3)} kg`} />
            </div>

            {job.force_reason ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Force-close reason: {job.force_reason}
                </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    Recent logs
                </div>
                {logs.length ? (
                    <div className="space-y-2">
                        {logs.map((log: any, index: number) => (
                            <div key={`${job.job_id || job.job_number}-${index}`} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                <div className="font-semibold text-slate-700">
                                    {log.type} · {safeNumber(log.qty).toFixed(3)} {log.uom || "KG"} · {log.actor || "system"}
                                </div>
                                <div className="text-slate-500">{formatTs(log.timestamp)}</div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-[11px] text-slate-500">No execution logs recorded.</div>
                )}
            </div>
        </div>
    )
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">
                {icon}
                {label}
            </div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{value || "—"}</div>
        </div>
    )
}

function DataGrid({ rows }: { rows: Array<Record<string, string>> }) {
    if (!rows.length) return <EmptyState label="No records available." />
    const columns = Object.keys(rows[0] || {})
    return (
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50">
                    <tr>
                        {columns.map((column) => (
                            <th key={column} className="px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                                {column.replace(/_/g, " ")}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.map((row, index) => (
                        <tr key={index}>
                            {columns.map((column) => (
                                <td key={column} className="px-4 py-3 text-sm font-medium text-slate-700">
                                    {row[column] || "—"}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function EmptyState({ label }: { label: string }) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{label}</div>
}
