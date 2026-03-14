"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Layers,
    ListFilter,
    Locate,
    Package,
    PackageSearch,
    PieChart,
    RefreshCw,
    Search,
    ShieldAlert,
    Split,
    TableProperties,
    Tag,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

import { factoryService } from "@/services/factory";
import { inventoryService } from "@/services/inventory";
import {
    getGenealogyTree,
    getRollExplorer,
    moveRoll,
    quarantineRoll,
    releaseRolls,
    reserveRolls,
    RollExplorerRow,
    unquarantineRoll,
} from "@/services/rolls";

type ExplorerMode = "grouped" | "table";

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toneForStatus(status?: string): string {
    const s = String(status || "").toUpperCase();
    if (s === "AVAILABLE") return "bg-emerald-50/80 text-emerald-700 border-emerald-200";
    if (s === "RESERVED") return "bg-amber-50/80 text-amber-700 border-amber-200";
    if (s === "IN_PROCESS") return "bg-blue-50/80 text-blue-700 border-blue-200";
    if (s === "SCRAPPED") return "bg-rose-50/80 text-rose-700 border-rose-200";
    if (s === "CONSUMED") return "bg-slate-100 text-slate-700 border-slate-200";
    return "bg-slate-50 text-slate-600 border-slate-200";
}

function toneForRole(role?: string | null): string {
    const r = String(role || "").toUpperCase();
    if (r === "REMAINDER") return "bg-orange-50/80 text-orange-700 border-orange-200";
    if (r === "OUTPUT" || r === "SPLIT_OUTPUT") return "bg-indigo-50/80 text-indigo-700 border-indigo-200";
    if (r === "FG") return "bg-emerald-50/80 text-emerald-700 border-emerald-200";
    return "bg-slate-50 text-slate-600 border-slate-200";
}

function toneForOrigin(originType?: string | null): string {
    const normalized = String(originType || "").toUpperCase();
    if (normalized === "IN_HOUSE") return "bg-indigo-50/80 text-indigo-700 border-indigo-200";
    if (normalized === "PURCHASED") return "bg-emerald-50/80 text-emerald-700 border-emerald-200";
    if (normalized === "JOBWORK_RETURN") return "bg-fuchsia-50/80 text-fuchsia-700 border-fuchsia-200";
    if (normalized === "INTERPLANT_IN") return "bg-cyan-50/80 text-cyan-700 border-cyan-200";
    if (normalized === "REMAINDER") return "bg-orange-50/80 text-orange-700 border-orange-200";
    return "bg-slate-50 text-slate-600 border-slate-200";
}

function originLabel(originType?: string | null): string {
    const normalized = String(originType || "").toUpperCase();
    if (normalized === "IN_HOUSE") return "In-house made";
    if (normalized === "PURCHASED") return "Purchased";
    if (normalized === "JOBWORK_RETURN") return "Jobwork return";
    if (normalized === "INTERPLANT_IN") return "Inter-plant";
    if (normalized === "REMAINDER") return "Remainder";
    return normalized || "Unknown";
}

function stockStrategyLabel(value?: string | null): string {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "INTERMEDIATE_POOL") return "Intermediate pool";
    if (normalized === "PACKAGING_STOCK") return "Packaging";
    return "Final stock";
}

function toneForStockStrategy(value?: string | null): string {
    const normalized = String(value || "").toUpperCase();
    if (normalized === "INTERMEDIATE_POOL") return "bg-amber-50/80 text-amber-700 border-amber-200";
    if (normalized === "PACKAGING_STOCK") return "bg-slate-100 text-slate-700 border-slate-200";
    return "bg-emerald-50/80 text-emerald-700 border-emerald-200";
}

function stageBadgeLabel(row: RollExplorerRow): string {
    if (String(row.roll_role || "").toUpperCase() === "REMAINDER") {
        const source = String(row.source_stage_name || "").trim();
        return source ? `REMAINDER • SRC ${source}` : "REMAINDER";
    }
    return row.stage_name || "—";
}

export default function RollExplorerPage() {
    const qc = useQueryClient();

    const [mode, setMode] = useState<ExplorerMode>("grouped");
    const [search, setSearch] = useState("");
    const [plantId, setPlantId] = useState("ALL");
    const [stage, setStage] = useState("ALL");
    const [role, setRole] = useState("ALL");
    const [originType, setOriginType] = useState("ALL");
    const [stockStrategy, setStockStrategy] = useState("ALL");
    const [status, setStatus] = useState("AVAILABLE,RESERVED,IN_PROCESS");
    const [locationId, setLocationId] = useState("ALL");
    const [jobNumber, setJobNumber] = useState("");
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [weightMin, setWeightMin] = useState("");
    const [weightMax, setWeightMax] = useState("");

    const [selected, setSelected] = useState<RollExplorerRow | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);

    const [moveLocationId, setMoveLocationId] = useState("ALL");
    const [moveReason, setMoveReason] = useState("WIP_TRANSFER");
    const [moveNote, setMoveNote] = useState("");
    const [reserveJobId, setReserveJobId] = useState("");
    const [quarantineReason, setQuarantineReason] = useState("");

    const { data: plants = [] } = useQuery({
        queryKey: ["roll-explorer-plants"],
        queryFn: factoryService.getPlants,
    });

    const selectedPlantId = plantId !== "ALL" ? plantId : "";
    const { data: filterLocations = [] } = useQuery({
        queryKey: ["roll-explorer-locations", selectedPlantId],
        queryFn: () => inventoryService.getLocations(selectedPlantId),
        enabled: Boolean(selectedPlantId),
    });

    const detailPlantId = selected?.plant_id || selectedPlantId;
    const { data: detailLocations = [] } = useQuery({
        queryKey: ["roll-explorer-detail-locations", detailPlantId],
        queryFn: () => inventoryService.getLocations(detailPlantId),
        enabled: Boolean(detailPlantId),
    });

    const explorerQuery = useQuery({
        queryKey: [
            "roll-explorer",
            mode,
            selectedPlantId,
            stage,
            role,
            originType,
            stockStrategy,
            status,
            locationId,
            jobNumber,
            dateFrom,
            dateTo,
            weightMin,
            weightMax,
        ],
        queryFn: () =>
            getRollExplorer({
                mode,
                plant: selectedPlantId || undefined,
                stage: stage !== "ALL" ? stage : undefined,
                roll_role: role !== "ALL" ? role : undefined,
                origin_type: originType !== "ALL" ? originType : undefined,
                stock_strategy: stockStrategy !== "ALL" ? stockStrategy : undefined,
                status: status !== "ALL" ? status : undefined,
                location: locationId !== "ALL" ? locationId : undefined,
                job_number: jobNumber.trim() || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                weight_min: weightMin.trim() ? toNumber(weightMin, 0) : undefined,
                weight_max: weightMax.trim() ? toNumber(weightMax, 0) : undefined,
            }),
        refetchInterval: 10000,
    });

    const { data: genealogy, isLoading: genealogyLoading } = useQuery({
        queryKey: ["roll-explorer-genealogy", selected?.id],
        queryFn: () => getGenealogyTree(String(selected?.id)),
        enabled: Boolean(selected?.id && drawerOpen),
    });

    const rows = useMemo(() => {
        const base = mode === "table"
            ? explorerQuery.data?.rows || []
            : (explorerQuery.data?.buckets || []).flatMap((bucket) => bucket.rolls || []);

        if (!search.trim()) return base;
        const q = search.trim().toLowerCase();
        return base.filter((row) => {
            const haystack = [
                row.label_id,
                row.display_name,
                row.variant_summary,
                row.material_name,
                row.grade_name,
                row.location_name,
                row.stage_name,
                row.roll_role,
                row.origin_type,
                row.stock_strategy,
                row.created_job_number,
                row.production_job_number,
            ]
                .map((x) => String(x || "").toLowerCase())
                .join(" ");
            return haystack.includes(q);
        });
    }, [explorerQuery.data, mode, search]);

    const groupedBuckets = useMemo(() => {
        const base = explorerQuery.data?.buckets || [];
        if (!search.trim()) return base;
        const filtered = new Map<string, { key: string; label: string; roll_count: number; weight_kg: number; rolls: RollExplorerRow[] }>();
        for (const row of rows) {
            const key = row.bucket_label || row.stage_name || "Unknown";
            const existing = filtered.get(key) || { key, label: key, roll_count: 0, weight_kg: 0, rolls: [] };
            existing.roll_count += 1;
            existing.weight_kg += toNumber(row.weight_kg, 0);
            existing.rolls.push(row);
            filtered.set(key, existing);
        }
        return Array.from(filtered.values()).sort((a, b) => (a.label === "Remainder / Freed" ? -1 : b.label === "Remainder / Freed" ? 1 : a.label.localeCompare(b.label)));
    }, [explorerQuery.data, rows, search]);

    const totals = explorerQuery.data?.totals || {
        roll_count: 0,
        weight_kg: 0,
        remainder_roll_count: 0,
        remainder_weight_kg: 0,
    };

    const refresh = async () => {
        await Promise.all([
            qc.invalidateQueries({ queryKey: ["roll-explorer"] }),
            qc.invalidateQueries({ queryKey: ["roll-explorer-genealogy"] }),
        ]);
    };

    const moveMutation = useMutation({
        mutationFn: async () => {
            if (!selected?.id) throw new Error("Select a roll first.");
            if (!moveLocationId || moveLocationId === "ALL") throw new Error("Select destination location.");
            return moveRoll(selected.id, moveLocationId, moveReason || "WIP_TRANSFER", moveNote || undefined);
        },
        onSuccess: async () => {
            toast.success("Roll moved");
            setMoveNote("");
            await refresh();
        },
        onError: (err: any) => toast.error(err?.response?.data?.error || err?.message || "Move failed"),
    });

    const reserveMutation = useMutation({
        mutationFn: async () => {
            if (!selected?.id) throw new Error("Select a roll first.");
            if (!reserveJobId.trim()) throw new Error("Enter target job id.");
            return reserveRolls([selected.id], reserveJobId.trim());
        },
        onSuccess: async () => {
            toast.success("Roll reserved");
            await refresh();
        },
        onError: (err: any) => toast.error(err?.response?.data?.error || err?.message || "Reserve failed"),
    });

    const releaseMutation = useMutation({
        mutationFn: async () => {
            if (!selected?.id) throw new Error("Select a roll first.");
            return releaseRolls([selected.id]);
        },
        onSuccess: async () => {
            toast.success("Roll released");
            await refresh();
        },
        onError: (err: any) => toast.error(err?.response?.data?.error || err?.message || "Release failed"),
    });

    const quarantineMutation = useMutation({
        mutationFn: async () => {
            if (!selected?.id) throw new Error("Select a roll first.");
            return quarantineRoll(selected.id, quarantineReason || undefined);
        },
        onSuccess: async () => {
            toast.success("Roll quarantined");
            setQuarantineReason("");
            await refresh();
        },
        onError: (err: any) => toast.error(err?.response?.data?.error || err?.message || "Quarantine failed"),
    });

    const unquarantineMutation = useMutation({
        mutationFn: async () => {
            if (!selected?.id) throw new Error("Select a roll first.");
            return unquarantineRoll(selected.id);
        },
        onSuccess: async () => {
            toast.success("Roll unquarantined");
            await refresh();
        },
        onError: (err: any) => toast.error(err?.response?.data?.error || err?.message || "Unquarantine failed"),
    });

    const isBusy =
        moveMutation.isPending ||
        reserveMutation.isPending ||
        releaseMutation.isPending ||
        quarantineMutation.isPending ||
        unquarantineMutation.isPending;

    const canReserve = Boolean(selected && String(selected.status || "").toUpperCase() === "AVAILABLE" && !selected.is_quarantined);
    const canRelease = Boolean(selected && String(selected.status || "").toUpperCase() === "RESERVED");
    const canQuarantine = Boolean(selected && !selected.is_quarantined);
    const canUnquarantine = Boolean(selected && selected.is_quarantined);

    return (
        <div className="p-6 space-y-6 bg-slate-50/50 min-h-screen">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 shadow-sm">
                            <PackageSearch className="h-5 w-5 text-indigo-600" strokeWidth={2.5} />
                        </div>
                        WIP & Roll Explorer
                    </h1>
                    <p className="text-slate-500 mt-1.5 font-medium tracking-tight">Unified genealogy, precise filtering, and controlled roll operations.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Tabs value={mode} onValueChange={(v) => setMode(v as ExplorerMode)} className="bg-white rounded-lg shadow-[0_1px_3px_rgba(0,0,0,0.05)] border border-slate-200">
                        <TabsList className="bg-transparent border-0 h-10 p-1">
                            <TabsTrigger value="grouped" className="rounded-md data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 px-4 transition-all duration-300 font-semibold tracking-tight"><ListFilter className="h-4 w-4 mr-2" strokeWidth={2.5} />Grouped</TabsTrigger>
                            <TabsTrigger value="table" className="rounded-md data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 px-4 transition-all duration-300 font-semibold tracking-tight"><TableProperties className="h-4 w-4 mr-2" strokeWidth={2.5} />Table</TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Button variant="outline" onClick={refresh} className="bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] hover:bg-slate-50 font-bold border-slate-200 text-slate-700">
                        <RefreshCw className="h-4 w-4 mr-2 text-indigo-500" strokeWidth={2.5} />
                        Sync Layer
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-indigo-500 transition-colors"><PieChart className="w-4 h-4" /> Queried Rolls</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900">{totals.roll_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-indigo-500 transition-colors"><Layers className="w-4 h-4" /> Global Mass</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">{toNumber(totals.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold tracking-wide text-slate-400">kg</span></div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden border-b-4 border-b-amber-400 group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2"><Split className="w-4 h-4" /> Freed Remainders</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900">{totals.remainder_roll_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden border-b-4 border-b-amber-400 group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2"><Tag className="w-4 h-4" /> Remainder Volume</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">{toNumber(totals.remainder_weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold tracking-wide text-amber-600/50">kg</span></div>
                    </CardContent>
                </Card>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant={originType === "IN_HOUSE" ? "default" : "outline"}
                    onClick={() => setOriginType((current) => current === "IN_HOUSE" ? "ALL" : "IN_HOUSE")}
                >
                    In-house made
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={stockStrategy === "INTERMEDIATE_POOL" ? "default" : "outline"}
                    onClick={() => setStockStrategy((current) => current === "INTERMEDIATE_POOL" ? "ALL" : "INTERMEDIATE_POOL")}
                >
                    Intermediate pool
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={stockStrategy === "FINAL_STOCK" ? "default" : "outline"}
                    onClick={() => setStockStrategy((current) => current === "FINAL_STOCK" ? "ALL" : "FINAL_STOCK")}
                >
                    Available FG
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={originType === "PURCHASED" ? "default" : "outline"}
                    onClick={() => setOriginType((current) => current === "PURCHASED" ? "ALL" : "PURCHASED")}
                >
                    External inbound
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={role === "REMAINDER" ? "default" : "outline"}
                    onClick={() => setRole((current) => current === "REMAINDER" ? "ALL" : "REMAINDER")}
                >
                    Remainders / freed
                </Button>
            </div>

            <Card className="border-0 shadow-sm bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
                <CardHeader className="pb-3 border-b border-slate-100 bg-slate-50/50">
                    <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2"><ListFilter className="w-4 h-4 text-emerald-500" strokeWidth={2.5} /> Telemetry Constraints</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                        <div className="xl:col-span-2">
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Query Pattern</Label>
                            <div className="relative mt-1.5">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input className="pl-9 bg-slate-50/50 border-slate-200 shadow-none font-medium text-slate-900 focus-visible:ring-indigo-500" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Label, job, or material..." />
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Plant Focus</Label>
                            <div className="mt-1.5">
                                <Select value={plantId} onValueChange={(v) => { setPlantId(v); setLocationId("ALL"); }}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="Global" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">Global Sector</SelectItem>
                                        {plants.map((p: any) => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Location</Label>
                            <div className="mt-1.5">
                                <Select value={locationId} onValueChange={setLocationId}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All Zones" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Zones</SelectItem>
                                        {(filterLocations || []).map((loc: any) => (
                                            <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Node Stage</Label>
                            <div className="mt-1.5">
                                <Select value={stage} onValueChange={setStage}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All Stages" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Stages</SelectItem>
                                        {[
                                            "Raw Material",
                                            "Extruded",
                                            "Printed",
                                            "Laminated",
                                            "Slit",
                                            "Finished Good",
                                            "Remainder / Freed",
                                        ].map((name) => (
                                            <SelectItem key={name} value={name}>{name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Archetype</Label>
                            <div className="mt-1.5">
                                <Select value={role} onValueChange={setRole}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All Archetypes" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All Archetypes</SelectItem>
                                        <SelectItem value="OUTPUT">OUTPUT</SelectItem>
                                        <SelectItem value="SPLIT_OUTPUT">SPLIT_OUTPUT</SelectItem>
                                        <SelectItem value="REMAINDER">REMAINDER</SelectItem>
                                        <SelectItem value="FG">FINAL_GOOD</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Origin</Label>
                            <div className="mt-1.5">
                                <Select value={originType} onValueChange={setOriginType}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All origins" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All origins</SelectItem>
                                        <SelectItem value="IN_HOUSE">In-house made</SelectItem>
                                        <SelectItem value="PURCHASED">Purchased</SelectItem>
                                        <SelectItem value="JOBWORK_RETURN">Jobwork return</SelectItem>
                                        <SelectItem value="INTERPLANT_IN">Inter-plant</SelectItem>
                                        <SelectItem value="REMAINDER">Remainder</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 border-t border-slate-100 pt-4">
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Consumption</Label>
                            <div className="mt-1.5">
                                <Select value={stockStrategy} onValueChange={setStockStrategy}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All strategies" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All strategies</SelectItem>
                                        <SelectItem value="FINAL_STOCK">Final stock</SelectItem>
                                        <SelectItem value="INTERMEDIATE_POOL">Intermediate pool</SelectItem>
                                        <SelectItem value="PACKAGING_STOCK">Packaging</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Network State</Label>
                            <div className="mt-1.5">
                                <Select value={status} onValueChange={setStatus}>
                                    <SelectTrigger className="bg-white border-blue-200 font-bold text-blue-800 shadow-sm focus:ring-indigo-500 ring-2 ring-transparent transition-all"><SelectValue placeholder="Status Mode" /></SelectTrigger>
                                    <SelectContent className="font-medium">
                                        <SelectItem value="AVAILABLE,RESERVED,IN_PROCESS">Active Stock (WIP+FG)</SelectItem>
                                        <SelectItem value="ALL">Complete History</SelectItem>
                                        <SelectItem value="AVAILABLE">Available Flow Only</SelectItem>
                                        <SelectItem value="RESERVED">Hard Reserved</SelectItem>
                                        <SelectItem value="CONSUMED,SCRAPPED">Depleted / Waste</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Job Trace ID</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono text-sm" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="JOB-XXXX..." />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Date Matrix Form</Label>
                            <Input type="date" className="mt-1.5 bg-slate-50/50 border-slate-200 text-slate-600 font-medium font-mono text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Date Matrix Till</Label>
                            <Input type="date" className="mt-1.5 bg-slate-50/50 border-slate-200 text-slate-600 font-medium font-mono text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Min Mass (kg)</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono font-medium text-sm" value={weightMin} onChange={(e) => setWeightMin(e.target.value)} placeholder="0.00" />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Max Mass (kg)</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono font-medium text-sm" value={weightMax} onChange={(e) => setWeightMax(e.target.value)} placeholder="Infinity" />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                        {[
                            plantId !== "ALL" ? `Plant: ${plants.find((row: any) => String(row.id) === plantId)?.name || plantId}` : null,
                            stage !== "ALL" ? `Stage: ${stage}` : null,
                            role !== "ALL" ? `Role: ${role}` : null,
                            originType !== "ALL" ? `Origin: ${originLabel(originType)}` : null,
                            stockStrategy !== "ALL" ? `Consumption: ${stockStrategyLabel(stockStrategy)}` : null,
                            locationId !== "ALL" ? `Location: ${(filterLocations || []).find((row: any) => String(row.id) === locationId)?.name || locationId}` : null,
                            jobNumber.trim() ? `Job: ${jobNumber.trim()}` : null,
                        ].filter(Boolean).map((chip) => (
                            <Badge key={chip} variant="outline" className="bg-white">{chip}</Badge>
                        ))}
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="ml-auto"
                            onClick={() => {
                                setPlantId("ALL");
                                setStage("ALL");
                                setRole("ALL");
                                setOriginType("ALL");
                                setStockStrategy("ALL");
                                setStatus("AVAILABLE,RESERVED,IN_PROCESS");
                                setLocationId("ALL");
                                setJobNumber("");
                                setDateFrom("");
                                setDateTo("");
                                setWeightMin("");
                                setWeightMax("");
                                setSearch("");
                            }}
                        >
                            Clear all filters
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {explorerQuery.isLoading ? (
                <Card><CardContent className="p-10 text-center text-slate-500">Loading roll explorer...</CardContent></Card>
            ) : explorerQuery.error ? (
                <Card className="border-red-200">
                    <CardContent className="p-6 text-red-600 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 mt-0.5" />
                        <div>
                            <div className="font-semibold">Failed to load roll explorer</div>
                            <div className="text-sm text-red-500">Try refreshing after checking filters.</div>
                        </div>
                    </CardContent>
                </Card>
            ) : mode === "grouped" ? (
                <div className="space-y-3">
                    {groupedBuckets.length === 0 ? (
                        <Card><CardContent className="p-8 text-center text-slate-500">No rolls found for current filters.</CardContent></Card>
                    ) : groupedBuckets.map((bucket) => (
                        <Card key={bucket.key} className="overflow-hidden">
                            <CardHeader className="py-4 border-b border-slate-100 bg-white">
                                <div className="flex items-center justify-between gap-2">
                                    <CardTitle className="text-[15px] font-bold text-slate-800 flex items-center gap-2 tracking-tight">
                                        {bucket.label === "Remainder / Freed" ? <Split className="h-4 w-4 text-amber-500" strokeWidth={2.5} /> : <ChevronDown className="h-4 w-4 text-indigo-500" strokeWidth={2.5} />}
                                        {bucket.label}
                                    </CardTitle>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="bg-slate-100 border-0 text-slate-600">{bucket.roll_count} rolls</Badge>
                                        <Badge variant="secondary" className="bg-indigo-50 border-0 text-indigo-700">{toNumber(bucket.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} kg</Badge>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                {bucket.rolls.map((row) => (
                                    <button
                                        key={row.id}
                                        className="w-full text-left px-5 py-3 border-t border-slate-100 first:border-t-0 hover:bg-slate-50 transition-colors"
                                        onClick={() => {
                                            setSelected(row);
                                            setMoveLocationId("ALL");
                                            setDrawerOpen(true);
                                        }}
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="font-bold text-[14px] text-slate-900 tracking-tight truncate">{row.display_name || row.label_id}</div>
                                                <div className="text-[11px] font-bold text-slate-700 truncate mt-0.5">{row.label_id}</div>
                                                <div className="text-xs font-medium tracking-wide text-slate-500 truncate mt-0.5">
                                                    {row.variant_summary || `${row.material_name || "Material"} • ${row.location_name || "Location"}`}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <Badge variant="outline" className={`${toneForOrigin(row.origin_type)} shadow-sm`}>{originLabel(row.origin_type)}</Badge>
                                                <Badge variant="outline" className={`${toneForStockStrategy(row.stock_strategy)} shadow-sm`}>{stockStrategyLabel(row.stock_strategy)}</Badge>
                                                <Badge variant="outline" className={`${toneForRole(row.roll_role)} shadow-sm`}>{row.roll_role || "—"}</Badge>
                                                <Badge variant="outline" className="border-slate-200 text-slate-600 bg-white shadow-sm">{stageBadgeLabel(row)}</Badge>
                                                <Badge variant="outline" className={`${toneForStatus(row.status)} shadow-sm`}>{row.status}</Badge>
                                                <div className="font-black text-sm text-slate-900 min-w-[110px] text-right font-mono tracking-tighter">{toNumber(row.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-[10px] text-slate-400 uppercase tracking-widest font-sans">kg</span></div>
                                                <ChevronRight className="h-4 w-4 text-slate-400 ml-2" />
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card className="border-0 shadow-sm rounded-2xl overflow-hidden bg-white">
                    <CardContent className="p-0 overflow-auto">
                        <table className="w-full text-sm min-w-[1180px]">
                            <thead className="bg-slate-50/80 border-b border-slate-100">
                                <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">
                                    <th className="px-5 py-3">Label Identifier</th>
                                    <th className="px-5 py-3">Readable variant</th>
                                    <th className="px-5 py-3">Origin / Role</th>
                                    <th className="px-5 py-3">Current Stage</th>
                                    <th className="px-5 py-3">Stock Status</th>
                                    <th className="px-5 py-3">Consumption</th>
                                    <th className="px-5 py-3 text-right">Net Weight</th>
                                    <th className="px-5 py-3">Facility</th>
                                    <th className="px-5 py-3">Node Location</th>
                                    <th className="px-5 py-3">Job Tracer</th>
                                    <th className="px-5 py-3" />
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {rows.length === 0 ? (
                                    <tr><td className="px-5 py-10 text-center text-slate-500 font-medium" colSpan={11}>No inventory objects found matching this matrix.</td></tr>
                                ) : rows.map((row) => (
                                    <tr key={row.id} className="hover:bg-slate-50/60 transition-colors">
                                        <td className="px-5 py-3 font-bold text-slate-900 tracking-tight">
                                            <div>{row.label_id}</div>
                                            <div className="text-[11px] font-semibold text-slate-500">{row.display_name || row.material_name || "—"}</div>
                                        </td>
                                        <td className="px-5 py-3 font-medium text-slate-600 truncate max-w-[240px]">{row.variant_summary || row.material_name || "—"}</td>
                                        <td className="px-5 py-3">
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline" className={`${toneForOrigin(row.origin_type)} shadow-sm`}>{originLabel(row.origin_type)}</Badge>
                                                <Badge variant="outline" className={`${toneForRole(row.roll_role)} shadow-sm`}>{row.roll_role || "—"}</Badge>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3"><Badge variant="outline" className="border-slate-200 text-slate-600 bg-white shadow-sm">{stageBadgeLabel(row)}</Badge></td>
                                        <td className="px-5 py-3"><Badge variant="outline" className={`${toneForStatus(row.status)} shadow-sm`}>{row.status}</Badge></td>
                                        <td className="px-5 py-3"><Badge variant="outline" className={`${toneForStockStrategy(row.stock_strategy)} shadow-sm`}>{stockStrategyLabel(row.stock_strategy)}</Badge></td>
                                        <td className="px-5 py-3 text-right font-mono font-bold tracking-tighter text-slate-900">{toNumber(row.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-slate-400 text-xs font-sans uppercase tracking-widest">kg</span></td>
                                        <td className="px-5 py-3 text-slate-500 text-xs font-medium">{row.plant_name || "—"}</td>
                                        <td className="px-5 py-3 font-medium text-slate-700 flex items-center gap-1.5"><Locate className="h-3 w-3 text-slate-400" /> {row.location_name || "—"}</td>
                                        <td className="px-5 py-3 font-mono text-xs font-medium text-slate-500">{row.production_job_number || row.created_job_number || "—"}</td>
                                        <td className="px-5 py-3 text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 font-bold"
                                                onClick={() => {
                                                    setSelected(row);
                                                    setMoveLocationId("ALL");
                                                    setDrawerOpen(true);
                                                }}
                                            >
                                                Inspect
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </CardContent>
                </Card>
            )}

            <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
                <DialogContent className="max-w-4xl bg-slate-50 border-slate-200">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-xl font-black text-slate-800 tracking-tight">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
                                <Package className="h-4 w-4 text-indigo-600" strokeWidth={2.5} />
                            </div>
                            {selected?.label_id || "Roll Inspector"}
                        </DialogTitle>
                    </DialogHeader>

                    {selected && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Readable Variant</div><div className="font-bold text-[13px] text-slate-800 mt-0.5 truncate">{selected.display_name || selected.material_name || "—"}</div><div className="text-[11px] font-medium text-slate-500 mt-1 truncate">{selected.variant_summary || selected.label_id}</div></CardContent></Card>
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Mass Level</div><div className="font-black font-mono text-sm tracking-tighter text-slate-900 mt-0.5">{toNumber(selected.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-[10px] text-slate-400 font-sans tracking-widest">KG</span></div></CardContent></Card>
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Origin / Stage</div><div className="flex flex-wrap gap-2 mt-2"><Badge variant="outline" className={toneForOrigin(selected.origin_type)}>{originLabel(selected.origin_type)}</Badge><Badge variant="outline" className="border-slate-200 bg-white text-slate-700">{stageBadgeLabel(selected)}</Badge><Badge variant="outline" className={toneForRole(selected.roll_role)}>{selected.roll_role || "—"}</Badge></div></CardContent></Card>
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Consumption / Locator</div><div className="flex flex-wrap gap-2 mt-2"><Badge variant="outline" className={toneForStockStrategy(selected.stock_strategy)}>{stockStrategyLabel(selected.stock_strategy)}</Badge><Badge variant="outline" className="border-slate-200 bg-white text-slate-700">{selected.location_name || "No location"}</Badge></div><div className="text-[11px] font-medium text-slate-500 mt-2">{selected.consumability_mode || "Planner will derive consumability from stock strategy."}</div></CardContent></Card>
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                                <Card className="border-0 shadow-sm rounded-xl bg-white ring-1 ring-slate-100">
                                    <CardHeader className="pb-3 border-b border-slate-50"><CardTitle className="text-[13px] tracking-widest font-bold uppercase text-slate-500">Controlled Actions</CardTitle></CardHeader>
                                    <CardContent className="space-y-5 pt-4">
                                        <div className="space-y-2">
                                            <Label className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Move Node Location</Label>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <Select value={moveLocationId} onValueChange={setMoveLocationId}>
                                                    <SelectTrigger className="bg-slate-50 border-slate-200 font-medium"><SelectValue placeholder="Destination" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="ALL">Select location</SelectItem>
                                                        {(detailLocations || []).map((loc: any) => (
                                                            <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Select value={moveReason} onValueChange={setMoveReason}>
                                                    <SelectTrigger className="bg-slate-50 border-slate-200 font-medium"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="WIP_TRANSFER">WIP_TRANSFER</SelectItem>
                                                        <SelectItem value="INTER_PLANT_RECEIPT">INTER_PLANT_RECEIPT</SelectItem>
                                                        <SelectItem value="JOBWORK_SEND">JOBWORK_SEND</SelectItem>
                                                        <SelectItem value="MANUAL_ADJUST">MANUAL_ADJUST</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <Button onClick={() => moveMutation.mutate()} disabled={isBusy || moveLocationId === "ALL"} variant="secondary" className="bg-indigo-50 font-bold hover:bg-indigo-100 text-indigo-700">
                                                    <Locate className="h-4 w-4 mr-1 text-indigo-500" /> Relocate
                                                </Button>
                                            </div>
                                            <Input placeholder="Move reasoning (optional)" value={moveNote} onChange={(e) => setMoveNote(e.target.value)} className="bg-slate-50 border-slate-200" />
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-[11px] font-bold tracking-widest uppercase text-slate-400">Hard Reserve Control</Label>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <Input placeholder="Target Job Trace" value={reserveJobId} onChange={(e) => setReserveJobId(e.target.value)} className="font-mono bg-slate-50 border-slate-200" />
                                                <Button variant="outline" className="border-slate-200 text-slate-700 font-bold hover:bg-slate-50" onClick={() => reserveMutation.mutate()} disabled={isBusy || !canReserve || !reserveJobId.trim()}>
                                                    Lock
                                                </Button>
                                                <Button variant="outline" className="border-slate-200 text-slate-700 font-bold hover:bg-slate-50" onClick={() => releaseMutation.mutate()} disabled={isBusy || !canRelease}>
                                                    Release
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label className="text-[11px] font-bold tracking-widest uppercase text-amber-500">Quality Quarantine</Label>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <Input placeholder="Reason (optional)" value={quarantineReason} onChange={(e) => setQuarantineReason(e.target.value)} className="bg-amber-50/50 border-amber-200" />
                                                <Button variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-50 font-bold" onClick={() => quarantineMutation.mutate()} disabled={isBusy || !canQuarantine}>
                                                    <ShieldAlert className="h-4 w-4 mr-1" strokeWidth={2.5} /> Isolate
                                                </Button>
                                                <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 font-bold" onClick={() => unquarantineMutation.mutate()} disabled={isBusy || !canUnquarantine}>
                                                    <CheckCircle2 className="h-4 w-4 mr-1" strokeWidth={2.5} /> Pardon
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="text-[10px] font-medium tracking-tight text-slate-400 border-t border-slate-100 pt-3 flex items-center gap-1.5">
                                            <ShieldAlert className="h-3 w-3" /> State mutations are permanently audited dynamically.
                                        </div>
                                    </CardContent>
                                </Card>

                                <Card className="border-0 shadow-sm rounded-xl bg-white ring-1 ring-slate-100">
                                    <CardHeader className="pb-3 border-b border-slate-50"><CardTitle className="text-[13px] tracking-widest font-bold uppercase text-slate-500">Genealogy Engine</CardTitle></CardHeader>
                                    <CardContent className="space-y-4 pt-4">
                                        {genealogyLoading ? (
                                            <div className="text-sm text-slate-500 animate-pulse font-medium">Resolving tree topology...</div>
                                        ) : !genealogy ? (
                                            <div className="text-sm text-slate-400 font-medium">No genealogy trace resolved.</div>
                                        ) : (
                                            <>
                                                <div>
                                                    <div className="text-[11px] font-bold text-slate-400 tracking-widest uppercase mb-1.5">Origin / Ancestors</div>
                                                    <div className="space-y-1">
                                                        {(genealogy.ancestors || []).length === 0 ? (
                                                            <div className="text-xs text-slate-300 font-medium">No parent heritage nodes</div>
                                                        ) : (genealogy.ancestors || []).map((node: any, idx: number) => (
                                                            <div key={`a-${idx}`} className="text-[12px] font-medium rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 flex items-center justify-between">
                                                                <div>
                                                                    <span className="font-bold text-slate-800 mr-2">{node.label_id}</span>
                                                                    <span className="text-slate-400">{node.relation_type}</span>
                                                                </div>
                                                                <span className="font-mono text-slate-600 font-bold">{toNumber(node.qty_used_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}<span className="text-[9px] ml-1 font-sans tracking-wide uppercase">kg</span></span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-bold text-slate-400 tracking-widest uppercase mb-1.5">Offspring / Split Consumers</div>
                                                    <div className="space-y-1">
                                                        {(genealogy.descendants || []).length === 0 ? (
                                                            <div className="text-xs text-slate-300 font-medium">No localized children</div>
                                                        ) : (genealogy.descendants || []).map((node: any, idx: number) => (
                                                            <div key={`d-${idx}`} className="text-[12px] font-medium rounded-md border border-slate-100 bg-slate-50 px-2.5 py-1.5 flex items-center justify-between">
                                                                <div>
                                                                    <span className="font-bold text-slate-800 mr-2">{node.label_id}</span>
                                                                    <span className="text-slate-400">{node.relation_type}</span>
                                                                </div>
                                                                <span className="font-mono text-slate-600 font-bold">{toNumber(node.qty_used_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}<span className="text-[9px] ml-1 font-sans tracking-wide uppercase">kg</span></span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </CardContent>
                                </Card>
                            </div>

                            {selected.roll_role === "REMAINDER" && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm text-amber-800 text-[13px] font-medium px-4 py-3 flex items-center gap-3">
                                    <Tag className="h-4 w-4 text-amber-500" strokeWidth={2.5} />
                                    Remainder rolls represent unused, unconsumed material returned to the floor from a parent trace loop as pure WIP stock.
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
