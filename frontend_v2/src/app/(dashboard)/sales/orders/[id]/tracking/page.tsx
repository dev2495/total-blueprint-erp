"use client";

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { analyticsService } from '@/services/analytics';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    ArrowLeft,
    Package,
    Truck,
    Factory,
    CheckCircle2,
    Clock,
    AlertCircle,
    Calendar,
    FileText,
    Box,
    Database,
    ShieldCheck,
    RefreshCcw,
    History,
    Gauge,
    Layers3,
    Flame,
    Activity,
    Sparkles,
    Split,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function OrderTrackingPage() {
    const params = useParams();
    const router = useRouter();
    const orderId = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "");

    const { data, isLoading, error } = useQuery({
        queryKey: ['order-tracking', orderId],
        queryFn: () => analyticsService.getOrderTracking(orderId),
        refetchInterval: 10000, // Faster refresh for live tracking
    });

    if (isLoading) {
        return (
            <div className="p-8 space-y-6 max-w-[1600px] mx-auto">
                <div className="flex items-center space-x-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <Skeleton className="h-8 w-64" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
                </div>
                <Skeleton className="h-[600px] rounded-xl" />
            </div>
        );
    }

    if (error || !data || data.error) {
        return (
            <div className="flex flex-col items-center justify-center p-20 text-center min-h-[60vh]">
                <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-full mb-6">
                    <AlertCircle className="h-16 w-16 text-red-500" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight">Tracking Unavailable</h2>
                <p className="text-muted-foreground mt-3 max-w-md text-lg">
                    {data?.error || `Could not find order #${orderId}. Please check the ID and try again.`}
                </p>
                <div className="flex gap-4 mt-8">
                    <Button onClick={() => router.back()} variant="outline" size="lg">Go Back</Button>
                    <Button onClick={() => window.location.reload()} size="lg">Retry Connection</Button>
                </div>
            </div>
        );
    }

    const progress = data?.progress || { produced: 0, packed: 0, dispatched: 0, ordered: 0, completion_percentage: 0 };
    const items = data?.items || [];
    const lineItems = data?.line_items || [];
    const jobSteps = data?.job_steps || [];
    const wipLineage = data?.wip_lineage || [];
    const interplantLinks = data?.interplant_links || [];
    const dispatchEvidence = data?.dispatch_evidence || [];
    const auditTimeline = data?.audit_timeline || [];
    const materialAudit = data?.material_audit || {};
    const materialAuditSummary = materialAudit?.summary || {};
    const materialAuditItems = materialAudit?.item_flow || [];
    const materialAuditMaterials = materialAudit?.materials || [];
    const freshness = data?.data_freshness;

    const kpis = data?.kpi_snapshot || {
        ordered_kg: progress.ordered || 0,
        produced_kg: progress.produced || 0,
        packed_kg: progress.packed || 0,
        dispatched_kg: progress.dispatched || 0,
        scrap_kg: 0,
        yield_percent: 0,
        active_jobs: 0,
        completed_jobs: 0,
        wip_kg: 0,
        fg_kg: 0,
        output_roll_kg: 0,
        remainder_roll_kg: 0,
        interplant_in_transit_kg: 0,
        wip_output_kg: 0,
        wip_remainder_kg: 0,
        interplant_output_in_transit_kg: 0,
        interplant_remainder_in_transit_kg: 0,
    };

    // Aggregate data for easier display in tables
    const fallbackLiveJobs = items.flatMap((item: any) => item.live_production.map((j: any) => ({ ...j, sku: item.sku })));
    const activeJobs = (data?.active_jobs?.length ? data.active_jobs : fallbackLiveJobs) || [];
    const completedJobs = (data?.completed_jobs?.length ? data.completed_jobs : jobSteps.filter((s: any) => s.state === "COMPLETED")) || [];
    const allRolls = wipLineage.length > 0
        ? wipLineage
        : items.flatMap((item: any) => item.rolls.map((r: any) => ({ ...r, sku: item.sku })));
    const outputRolls = allRolls.filter((r: any) => r.roll_role !== 'REMAINDER');
    const remainderRolls = allRolls.filter((r: any) => r.roll_role === 'REMAINDER');
    const allBatches = items.flatMap((item: any) => item.fg_batches.map((b: any) => ({ ...b, sku: item.sku })));
    const legacyChallans = (Array.from(new Set(items.flatMap((item: any) => item.challans.map((c: any) => JSON.stringify(c))))) as string[]).map(s => JSON.parse(s));
    const allChallans = dispatchEvidence.length > 0 ? dispatchEvidence : legacyChallans;

    // Timeline Steps
    const steps = [
        { id: 'confirmed', label: 'Confirmed', icon: FileText, complete: true, status: 'Completed' },
        { id: 'production', label: 'Production', icon: Factory, complete: (progress?.produced || 0) > 0, status: (progress?.produced || 0) > 0 ? 'In Progress' : 'Pending' },
        { id: 'packing', label: 'Packing', icon: Box, complete: (progress?.packed || 0) > 0, status: (progress?.packed || 0) > 0 ? 'Active' : 'Awaiting' },
        { id: 'dispatch', label: 'Dispatch', icon: Truck, complete: (progress?.dispatched || 0) > 0, status: 'In Queue' },
        { id: 'delivered', label: 'Delivered', icon: CheckCircle2, complete: data?.status === 'COMPLETED', status: data?.status === 'COMPLETED' ? 'Finalized' : 'Est. TBD' },
    ];

    return (
        <div className="p-6 md:p-10 space-y-10 max-w-[1700px] mx-auto min-h-screen bg-slate-50/30 dark:bg-slate-950/20">
            {/* Navigation & Title */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b pb-8 border-slate-200 dark:border-slate-800">
                <div className="space-y-4">
                    <Button variant="ghost" size="sm" onClick={() => router.back()} className="text-muted-foreground hover:text-foreground p-0 h-auto">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Orders
                    </Button>
                    <div className="space-y-1">
                        <div className="flex items-center gap-4">
                            <h1 className="text-4xl font-extrabold tracking-tight">Order {data.order_number}</h1>
                            <Badge className={`
                                px-4 py-1 text-sm font-semibold rounded-full
                                ${data.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-blue-50 text-blue-700 border-blue-100'}
                            `} variant="outline">
                                {data.status}
                            </Badge>
                        </div>
                        <p className="text-xl text-muted-foreground font-medium flex items-center gap-3">
                            {data.customer}
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            <span className="flex items-center gap-2">
                                <Calendar className="h-5 w-5 text-indigo-500" /> Due {data.delivery_date}
                            </span>
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <p className="text-sm font-semibold text-slate-500 uppercase tracking-wider">Overall Progress</p>
                            <p className="text-4xl font-black text-indigo-600 dark:text-indigo-400">{progress.completion_percentage.toFixed(1)}%</p>
                        </div>
                        <div className="w-24 h-24 rounded-full border-8 border-slate-100 dark:border-slate-800 flex items-center justify-center relative overflow-hidden">
                            <div
                                className="absolute bottom-0 left-0 w-full bg-indigo-500/20 transition-all duration-1000"
                                style={{ height: `${progress.completion_percentage}%` }}
                            />
                            <CheckCircle2 className={`h-10 w-10 ${progress.completion_percentage === 100 ? 'text-emerald-500' : 'text-slate-200'}`} />
                        </div>
                    </div>
                </div>
            </div>

            <Card className="border border-indigo-100 bg-indigo-50/40 dark:bg-indigo-950/20 dark:border-indigo-900/40">
                <CardContent className="p-4 flex flex-wrap items-center gap-4 text-sm">
                    <div className="inline-flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300">
                        <ShieldCheck className="h-4 w-4" />
                        Audit Tracking Active
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                        Jobs: <span className="font-bold">{jobSteps.length}</span> |
                        WIP Rolls: <span className="font-bold"> {wipLineage.length}</span> |
                        Inter-Plant Links: <span className="font-bold"> {interplantLinks.length}</span>
                    </div>
                    <div className="ml-auto inline-flex items-center gap-2 text-slate-500">
                        <RefreshCcw className="h-4 w-4" />
                        {freshness?.generated_at ? `Last refresh ${new Date(freshness.generated_at).toLocaleString()}` : "Live refresh enabled"}
                    </div>
                </CardContent>
            </Card>

            {/* Smart Timeline Card */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
                <Card className="xl:col-span-8 border-none shadow-xl shadow-slate-200/50 dark:shadow-none bg-white dark:bg-slate-900 overflow-hidden">
                    <div className="bg-gradient-to-r from-indigo-500 to-purple-600 h-1" />
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg font-bold flex items-center gap-2">
                            <Clock className="h-5 w-5 text-indigo-500" />
                            Logistic Journey Map
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 pb-10">
                        <div className="relative flex items-center justify-between w-full px-6">
                            <div className="absolute left-10 right-10 top-1/2 transform -translate-y-1/2 h-1 bg-slate-100 dark:bg-slate-800 -z-0" />
                            {steps.map((step, index) => {
                                const Icon = step.icon;
                                const isActive = step.complete;
                                return (
                                    <div key={step.id} className="relative z-10 flex flex-col items-center bg-white dark:bg-slate-900 pt-2 transition-all duration-500">
                                        <div className={`
                                            flex items-center justify-center w-14 h-14 rounded-full border-4 transition-all duration-500
                                            ${isActive
                                                ? 'bg-indigo-600 border-indigo-100 text-white shadow-xl shadow-indigo-200 dark:shadow-none'
                                                : 'bg-white border-slate-100 text-slate-300 dark:bg-slate-800 dark:border-slate-700'
                                            }
                                        `}>
                                            <Icon className="h-6 w-6" />
                                        </div>
                                        <div className="mt-4 text-center">
                                            <p className={`text-sm font-bold uppercase tracking-tight ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}>
                                                {step.label}
                                            </p>
                                            <p className="text-[10px] font-medium text-slate-400 mt-0.5">{step.status}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>

                <div className="xl:col-span-4 grid grid-cols-2 gap-4">
                    <SimpleKPI title="Total Ordered" value={`${kpis.ordered_kg} kg`} icon={FileText} color="blue" />
                    <SimpleKPI title="Gross Output" value={`${kpis.produced_kg} kg`} icon={Factory} color="emerald" />
                    <SimpleKPI title="Scrap" value={`${kpis.scrap_kg} kg`} icon={Flame} color="rose" />
                    <SimpleKPI title="Yield" value={`${kpis.yield_percent}%`} icon={Gauge} color="teal" />
                    <SimpleKPI title="WIP Output" value={`${(kpis.wip_output_kg ?? kpis.output_roll_kg ?? kpis.wip_kg ?? 0)} kg`} icon={Layers3} color="amber" />
                    <SimpleKPI title="WIP Remainder" value={`${(kpis.wip_remainder_kg ?? kpis.remainder_roll_kg ?? 0)} kg`} icon={Split} color="orange" />
                    <SimpleKPI title="FG Ready" value={`${kpis.fg_kg} kg`} icon={Package} color="indigo" />
                    <SimpleKPI title="Transit Output" value={`${(kpis.interplant_output_in_transit_kg ?? kpis.interplant_in_transit_kg ?? 0)} kg`} icon={Truck} color="violet" />
                    <SimpleKPI title="Transit Remainder" value={`${(kpis.interplant_remainder_in_transit_kg ?? 0)} kg`} icon={History} color="pink" />
                    <SimpleKPI title="Jobs Closed" value={`${kpis.completed_jobs}`} icon={Activity} color="slate" />
                </div>
            </div>

            {/* Intelligence Hub */}
            <Tabs defaultValue="live" className="space-y-6">
                <TabsList className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl w-full lg:w-fit border border-slate-200/60">
                    <TabsTrigger value="live" className="rounded-lg px-6 flex items-center gap-2 py-2.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        Live Production
                    </TabsTrigger>
                    <TabsTrigger value="lineage" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <Database className="h-4 w-4" />
                        Inventory Lineage
                    </TabsTrigger>
                    <TabsTrigger value="logistics" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        Dispatch Timeline
                    </TabsTrigger>
                    <TabsTrigger value="interplant" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <History className="h-4 w-4" />
                        Inter-Plant
                    </TabsTrigger>
                    <TabsTrigger value="audit" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Audit Trail
                    </TabsTrigger>
                    <TabsTrigger value="material-audit" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <Layers3 className="h-4 w-4" />
                        Material Audit
                    </TabsTrigger>
                    <TabsTrigger value="skus" className="rounded-lg px-6 py-2.5 flex items-center gap-2">
                        <Box className="h-4 w-4" />
                        SKU Status
                    </TabsTrigger>
                </TabsList>

                {/* Tab: Live Production */}
                <TabsContent value="live" className="space-y-6">
                    {activeJobs.length === 0 && completedJobs.length === 0 ? (
                        <EmptyState icon={Factory} title="No Active Production" description="This order is currently not being processed on any machine logs." />
                    ) : (
                        <div className="space-y-8">
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <Sparkles className="h-4 w-4 text-red-500" />
                                    <h3 className="text-sm font-black tracking-wider uppercase text-slate-500">Active Jobs</h3>
                                </div>
                                {activeJobs.length === 0 ? (
                                    <div className="text-sm text-slate-500 border rounded-lg p-4 bg-white">No active jobs right now.</div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                        {activeJobs.map((job: any) => (
                                            <LiveJobCard key={job.id || job.job_id || job.job_number} job={job} />
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    <h3 className="text-sm font-black tracking-wider uppercase text-slate-500">Completed Jobs with Logs</h3>
                                </div>
                                {completedJobs.length === 0 ? (
                                    <div className="text-sm text-slate-500 border rounded-lg p-4 bg-white">No completed jobs yet.</div>
                                ) : (
                                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                                        {completedJobs.map((job: any) => (
                                            <CompletedJobCard key={job.job_id || job.job_number} job={job} />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </TabsContent>

                {/* Tab: Inventory Lineage */}
                <TabsContent value="lineage">
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                        <span className="font-semibold">Remainder / Balance roll:</span> unconsumed parent balance returned to reusable WIP stock. It is tracked separately from step output rolls.
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <DataCard title="Step Output Rolls" icon={Database}>
                            <InventoryTable
                                data={outputRolls}
                                columns={['label_id', 'roll_role', 'material', 'weight_kg', 'status', 'location', 'created_job_number']}
                            />
                        </DataCard>
                        <DataCard title="Remainder / Balance Rolls" icon={Layers3}>
                            <InventoryTable
                                data={remainderRolls}
                                columns={['label_id', 'roll_role', 'parent_roll_label', 'weight_kg', 'status', 'location', 'created_job_number']}
                            />
                        </DataCard>
                    </div>
                    <div className="mt-8">
                        <DataCard title="Finished Goods Batches" icon={Package}>
                            <InventoryTable data={allBatches} columns={['batch_number', 'sku', 'qty_pcs', 'qty_kg', 'status']} />
                        </DataCard>
                    </div>
                </TabsContent>

                {/* Tab: Logistics */}
                <TabsContent value="logistics">
                    <DataCard title="Delivery History & Challans" icon={Truck}>
                        <InventoryTable data={allChallans} columns={['dc_no', 'status', 'weight_kg', 'vehicle_no', 'dispatch_date']} />
                    </DataCard>
                </TabsContent>

                <TabsContent value="interplant">
                    {interplantLinks.length === 0 ? (
                        <EmptyState icon={History} title="No Inter-Plant Links" description="This order has no inter-plant movement yet." />
                    ) : (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                            {interplantLinks.map((link: any) => (
                                <Card key={link.challan_id} className="border border-slate-200 shadow-sm">
                                    <CardHeader className="pb-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <CardTitle className="text-base font-black">{link.dc_no || link.challan_id}</CardTitle>
                                            <Badge
                                                variant="outline"
                                                className={link.status === "RECEIVED" ? "border-emerald-200 text-emerald-700 bg-emerald-50" : "border-blue-200 text-blue-700 bg-blue-50"}
                                            >
                                                {link.status}
                                            </Badge>
                                        </div>
                                        <CardDescription className="text-xs">
                                            {link.from_plant} → {link.to_plant}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="space-y-3 text-sm">
                                        <div className="grid grid-cols-3 gap-2">
                                            <MetricChip label="Roll Lines" value={link.summary?.roll_lines ?? 0} color="blue" />
                                            <MetricChip label="Bulk Lines" value={link.summary?.bulk_lines ?? 0} color="amber" />
                                            <MetricChip label="Out (kg)" value={Number(link.summary?.dispatched_total_kg || 0).toFixed(3)} color="indigo" />
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            Source Job: {link.source_job_number || "—"} | Target Job: {link.target_job_number || "—"}
                                        </div>
                                        {Array.isArray(link.items_preview) && link.items_preview.length > 0 && (
                                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 space-y-1">
                                                {link.items_preview.map((item: any, idx: number) => (
                                                    <div key={`${link.challan_id}-line-${idx}`} className="flex justify-between text-xs">
                                                        <span className="truncate">
                                                            {item.line_type} • {item.roll_role || item.roll_label || item.material_name || "Item"}
                                                        </span>
                                                        <span className="font-semibold">{Number(item.dispatched_qty_kg || 0).toFixed(3)} kg</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="audit">
                    <DataCard title="Normalized Audit Events" icon={ShieldCheck}>
                        <InventoryTable
                            data={auditTimeline}
                            columns={['timestamp', 'event_type', 'entity_type', 'reference', 'delta_qty_kg', 'actor', 'message']}
                        />
                    </DataCard>
                </TabsContent>

                <TabsContent value="material-audit" className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <SimpleKPI title="Ordered Target" value={`${Number(materialAuditSummary?.ordered_target_kg || 0).toFixed(3)} kg`} icon={FileText} color="indigo" />
                        <SimpleKPI title="Latest Output" value={`${Number(materialAuditSummary?.latest_output_kg || 0).toFixed(3)} kg`} icon={Factory} color="emerald" />
                        <SimpleKPI title="WIP Carry (Output)" value={`${Number(materialAuditSummary?.wip_output_kg || 0).toFixed(3)} kg`} icon={Database} color="blue" />
                        <SimpleKPI title="Gap To Target" value={`${Number(materialAuditSummary?.mass_gap_to_target_kg || 0).toFixed(3)} kg`} icon={AlertCircle} color="amber" />
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <DataCard title="Line Flow Balance" icon={Layers3}>
                            <InventoryTable
                                data={materialAuditItems}
                                columns={[
                                    'template_name',
                                    'ordered_target_kg',
                                    'latest_output_kg',
                                    'wip_output_kg',
                                    'wip_remainder_kg',
                                    'bulk_consumed_kg',
                                    'scrap_logged_kg',
                                    'mass_gap_to_target_kg',
                                    'step_target_source',
                                ]}
                            />
                        </DataCard>
                        <DataCard title="Material Consumption Audit" icon={Activity}>
                            <InventoryTable
                                data={materialAuditMaterials}
                                columns={[
                                    'material_code',
                                    'material_name',
                                    'category',
                                    'required_kg',
                                    'consumed_kg',
                                    'remaining_kg',
                                    'steps',
                                ]}
                            />
                        </DataCard>
                    </div>
                </TabsContent>

                {/* Tab: SKU Status */}
                <TabsContent value="skus">
                    {lineItems.length > 0 ? (
                        <DataCard title="SKU Progress (Audit)" icon={Box}>
                            <InventoryTable
                                data={lineItems.map((line: any) => ({
                                    template_name: line.template_name,
                                    fg_profile: line.fg_type === "ROLL"
                                        ? `${line.fg_type} • ${line.roll_form || "FLAT"}`
                                        : (line.fg_type || "POUCH"),
                                    print_profile: line.printing_enabled
                                        ? `${line.printing_type || "PRINT"} • ${line.substrate_mode || "NA"} • F${line.front_colors_count || 0}/B${line.back_colors_count || 0}`
                                        : "DISABLED",
                                    execution_model_version: line.execution_model_version,
                                    ordered_kg: line.ordered_kg,
                                    route_target_source: line.route_target_source || line.ordered_target_source,
                                    step_target_kg: line.step_target_kg,
                                    step_target_source: line.step_target_source,
                                    produced_kg: line.produced_kg,
                                    packed_kg: line.packed_kg,
                                    dispatched_kg: line.dispatched_kg,
                                    scrap_kg: line.scrap_kg,
                                    completion_percentage: `${line.completion_percentage}%`,
                                }))}
                                columns={[
                                    'template_name',
                                    'fg_profile',
                                    'print_profile',
                                    'execution_model_version',
                                    'ordered_kg',
                                    'route_target_source',
                                    'step_target_kg',
                                    'step_target_source',
                                    'produced_kg',
                                    'packed_kg',
                                    'dispatched_kg',
                                    'scrap_kg',
                                    'completion_percentage'
                                ]}
                            />
                        </DataCard>
                    ) : (
                        <div className="space-y-4">
                            {items.map((item: any) => (
                                <SKUProgress key={item.sku} item={item} />
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}

function SimpleKPI({ title, value, icon: Icon, color, trend }: any) {
    const colors: any = {
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20',
        emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20',
        amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20',
        indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20',
        rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/20',
        teal: 'bg-teal-50 text-teal-600 dark:bg-teal-900/20',
        violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/20',
        orange: 'bg-orange-50 text-orange-600 dark:bg-orange-900/20',
        pink: 'bg-pink-50 text-pink-600 dark:bg-pink-900/20',
        slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    };
    return (
        <Card className="border-none shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-5">
                <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center mb-3`}>
                    <Icon className="h-5 w-5" />
                </div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{title}</p>
                <div className="flex items-baseline gap-2 mt-1">
                    <h3 className="text-xl font-black">{value}</h3>
                    {trend && <span className="text-[10px] font-bold text-emerald-500">{trend}</span>}
                </div>
            </CardContent>
        </Card>
    );
}

function LiveJobCard({ job }: any) {
    const jobNumber = job.job_number || job.jobNumber || "--"
    const machine = job.machine || "Not Assigned"
    const latestActivity = job.latest_activity || job.start_date || "No logs yet"
    const state = job.state || "IN_PROGRESS"
    return (
        <Card className="border-l-4 border-l-red-500 shadow-lg hover:shadow-xl transition-all">
            <CardContent className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <Badge variant="outline" className="mb-2 uppercase text-[10px] font-bold tracking-widest">{machine}</Badge>
                        <h4 className="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            Job {jobNumber}
                            <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                        </h4>
                    </div>
                    <Badge className="bg-amber-500 text-white border-none">{state}</Badge>
                </div>
                <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Product</span>
                        <span className="font-bold">{job.sku || job.step_name || "--"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Last Output</span>
                        <span className="font-bold flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {latestActivity}
                        </span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function CompletedJobCard({ job }: any) {
    const logs = Array.isArray(job.logs) ? job.logs.slice(0, 5) : [];
    return (
        <Card className="border border-emerald-200 bg-emerald-50/30 shadow-sm">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-black">{job.job_number}</CardTitle>
                    <Badge className={job.closed_with_variance ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"}>
                        {job.closed_with_variance ? "FORCED VARIANCE" : "NORMAL CLOSE"}
                    </Badge>
                </div>
                <CardDescription>{job.step_name || "Step"} • {job.machine || "No machine"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-3 gap-2">
                    <MetricChip label="Produced" value={`${Number(job.produced_kg || 0).toFixed(3)} kg`} color="emerald" />
                    <MetricChip label="Scrap" value={`${Number(job.scrap_kg || 0).toFixed(3)} kg`} color="rose" />
                    <MetricChip label="Variance" value={`${Number(job.variance_kg || 0).toFixed(3)} kg`} color="amber" />
                </div>
                {job.force_reason ? (
                    <div className="text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-700 p-2">
                        Force reason: {job.force_reason}
                    </div>
                ) : null}
                <div className="rounded-md border bg-white p-2 space-y-1">
                    <div className="text-xs font-semibold text-slate-500">Recent Logs</div>
                    {logs.length === 0 ? (
                        <div className="text-xs text-slate-400">No logs recorded.</div>
                    ) : logs.map((log: any, idx: number) => (
                        <div key={`${job.job_id}-log-${idx}`} className="flex items-center justify-between text-xs">
                            <span className="font-medium">{log.type} • {Number(log.qty || 0).toFixed(3)} {log.uom || "KG"}</span>
                            <span className="text-slate-500">{log.timestamp ? new Date(log.timestamp).toLocaleString() : "--"}</span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

function MetricChip({ label, value, color = "slate" }: any) {
    const colorMap: Record<string, string> = {
        blue: "bg-blue-50 border-blue-200 text-blue-700",
        amber: "bg-amber-50 border-amber-200 text-amber-700",
        indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
        emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
        rose: "bg-rose-50 border-rose-200 text-rose-700",
        slate: "bg-slate-100 border-slate-200 text-slate-700",
    }
    return (
        <div className={`rounded-md border px-2 py-1 ${colorMap[color] || colorMap.slate}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider">{label}</div>
            <div className="text-xs font-black">{value}</div>
        </div>
    )
}

function DataCard({ title, icon: Icon, children }: any) {
    return (
        <Card className="border-none shadow-xl shadow-slate-200/40 dark:shadow-none bg-white dark:bg-slate-900">
            <CardHeader className="border-b border-slate-50 dark:border-slate-800">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                    <Icon className="h-5 w-5 text-indigo-500" />
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                {children}
            </CardContent>
        </Card>
    );
}

function InventoryTable({ data, columns }: any) {
    if (data.length === 0) return <div className="p-10 text-center text-slate-400 font-medium">No results recorded yet.</div>;
    const dateColumns = new Set([
        'created_at',
        'updated_at',
        'dispatch_date',
        'delivery_date',
        'received_date',
        'timestamp',
        'start_date',
        'end_date',
        'closed_at',
        'dispatched_at',
    ]);

    const renderCell = (row: any, col: string) => {
        const value = row[col];
        if (col.includes('status')) {
            const status = String(value || '').toUpperCase();
            const className = status === 'COMPLETED' || status === 'RECEIVED'
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : status === 'IN_TRANSIT' || status === 'RELEASED' || status === 'EXECUTING'
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : status === 'REMAINDER'
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-100 text-slate-700 border-slate-200";
            return <Badge variant="outline" className={`uppercase text-[10px] font-bold ${className}`}>{status || '--'}</Badge>;
        }
        if (col === 'roll_role') {
            const role = String(value || '--').toUpperCase();
            const className = role === 'REMAINDER'
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : role === 'FG'
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : role.includes('OUTPUT')
                        ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                        : "bg-slate-100 text-slate-700 border-slate-200";
            return <Badge variant="outline" className={`text-[10px] font-bold ${className}`}>{role}</Badge>;
        }
        if (typeof value === 'number' && col.includes('kg')) {
            return <span className="font-semibold">{value.toFixed(3)}</span>;
        }
        if (typeof value === 'string' && dateColumns.has(col) && value.includes('T')) {
            return new Date(value).toLocaleString();
        }
        return value || '--';
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50/50 dark:bg-slate-800/50 text-xs font-black text-slate-500 uppercase">
                    <tr>
                        {columns.map((c: string) => (
                            <th key={c} className="px-6 py-4">{c.replace('_', ' ').replace('__', ' ')}</th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {data.map((row: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors">
                            {columns.map((c: string) => (
                                <td key={c} className="px-6 py-4 font-medium">{renderCell(row, c)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function SKUProgress({ item }: any) {
    const pct = Math.min((item.produced / item.ordered) * 100, 100);
    return (
        <Card className="border-none shadow-sm overflow-hidden bg-white/50 dark:bg-slate-900/50">
            <CardContent className="p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    <div className="space-y-1 flex-1">
                        <h4 className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">{item.sku}</h4>
                        <p className="text-sm font-bold text-slate-400">ORDERED: {item.ordered} KG</p>
                    </div>

                    <div className="flex items-center gap-10 flex-[2]">
                        <div className="flex-1 space-y-2">
                            <div className="flex justify-between text-xs font-black text-slate-500">
                                <span>PRODUCTION PROGRESS</span>
                                <span>{pct.toFixed(0)}%</span>
                            </div>
                            <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${pct}%` }} />
                            </div>
                        </div>

                        <div className="flex gap-4 border-l pl-4 border-slate-100 dark:border-slate-800">
                            <MetricBox label="Produced" value={item.produced} unit="kg" />
                            <MetricBox label="Packed" value={item.packed} unit="kg" />
                            <MetricBox label="Loaded" value={item.dispatched} unit="kg" />
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function MetricBox({ label, value, unit }: any) {
    return (
        <div className="text-right min-w-[70px]">
            <p className="text-[10px] font-black text-slate-400 uppercase">{label}</p>
            <p className="text-base font-black text-slate-700 dark:text-slate-200">{value}<span className="text-[10px] ml-0.5 text-slate-400">{unit}</span></p>
        </div>
    );
}

function EmptyState({ icon: Icon, title, description }: any) {
    return (
        <div className="flex flex-col items-center justify-center p-20 text-center bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-full mb-6">
                <Icon className="h-10 w-10 text-slate-300" />
            </div>
            <h3 className="text-xl font-bold">{title}</h3>
            <p className="text-muted-foreground mt-2 max-w-sm">{description}</p>
        </div>
    );
}
