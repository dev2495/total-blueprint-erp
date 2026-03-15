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
    PieChart as PieChartIcon,
    RefreshCw,
    Search,
    ShieldAlert,
    Split,
    TableProperties,
    Tag,
} from "lucide-react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartSurface } from "@/components/ui-custom/chart-surface";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";
import { humanizeToken } from "@/lib/visual-semantics";
import { toast } from "sonner";

import { factoryService } from "@/services/factory";
import { inventoryService } from "@/services/inventory";
import {
    getGenealogyTree,
    getRollExplorer,
    getRollsByVariant,
    moveRoll,
    quarantineRoll,
    releaseRolls,
    reserveRolls,
    RollByVariantResponse,
    RollExplorerFamily,
    RollExplorerRow,
    unquarantineRoll,
} from "@/services/rolls";
import { commercialFamilyService } from "@/services/commercial-families";

type ExplorerMode = "variant" | "grouped" | "table";

const ROLL_CHART_COLORS = ["#4f46e5", "#0f766e", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#65a30d"]

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function stageBadgeLabel(row: RollExplorerRow): string {
    if (String(row.roll_role || "").toUpperCase() === "REMAINDER") {
        const source = String(row.source_stage_name || "").trim();
        return source ? `REMAINDER • SRC ${source}` : "REMAINDER";
    }
    return row.stage_name || "—";
}

function originLabel(originType?: string | null): string {
    return humanizeToken(originType, "Unknown")
}

function stockStrategyLabel(value?: string | null): string {
    const normalized = String(value || "").toUpperCase()
    if (normalized === "INTERMEDIATE_POOL") return "Intermediate pool"
    if (normalized === "PACKAGING_STOCK") return "Packaging"
    return "Final stock"
}

export default function RollExplorerPage() {
    const qc = useQueryClient();

    const [mode, setMode] = useState<ExplorerMode>("variant");
    const [search, setSearch] = useState("");
    const [plantId, setPlantId] = useState("ALL");
    const [familyId, setFamilyId] = useState("ALL");
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
    const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
    const [expandedVariants, setExpandedVariants] = useState<Record<string, boolean>>({});

    const [moveLocationId, setMoveLocationId] = useState("ALL");
    const [moveReason, setMoveReason] = useState("WIP_TRANSFER");
    const [moveNote, setMoveNote] = useState("");
    const [reserveJobId, setReserveJobId] = useState("");
    const [quarantineReason, setQuarantineReason] = useState("");

    const { data: plants = [] } = useQuery({
        queryKey: ["roll-explorer-plants"],
        queryFn: factoryService.getPlants,
    });
    const { data: commercialFamilies = [] } = useQuery({
        queryKey: ["commercial-families"],
        queryFn: commercialFamilyService.getAll,
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

    const groupedMode: "grouped" | "table" = mode === "table" ? "table" : "grouped";

    const explorerQuery = useQuery({
        queryKey: [
            "roll-explorer",
            groupedMode,
            selectedPlantId,
            familyId,
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
                mode: groupedMode,
                plant: selectedPlantId || undefined,
                family: familyId !== "ALL" ? familyId : undefined,
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
        enabled: mode !== "variant",
        refetchInterval: 10000,
    });
    const variantQuery = useQuery<RollByVariantResponse>({
        queryKey: [
            "roll-explorer-by-variant",
            selectedPlantId,
            familyId,
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
            getRollsByVariant({
                plant: selectedPlantId || undefined,
                family: familyId !== "ALL" ? familyId : undefined,
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
        enabled: mode === "variant",
        refetchInterval: 10000,
    })

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

    const variantFamilies = useMemo(() => {
        const base = variantQuery.data?.families || []
        if (!search.trim()) return base
        const q = search.trim().toLowerCase()

        const rollMatches = (row: RollExplorerRow) => [
            row.label_id,
            row.family_display_name,
            row.variant_display_name,
            row.size_line,
            row.stage_name,
            row.location_name,
            row.plant_name,
            row.origin_label,
            row.stock_strategy_label,
            row.material_name,
        ]
            .map((value) => String(value || "").toLowerCase())
            .join(" ")
            .includes(q)

        return base
            .map((family) => {
                const familyMatches = [
                    family.family_display_name,
                    family.form_label,
                    family.reporting_group,
                ]
                    .map((value) => String(value || "").toLowerCase())
                    .join(" ")
                    .includes(q)

                const variants = family.variants
                    .map((variant) => {
                        const variantMatches = [
                            variant.variant_display_name,
                            variant.size_line,
                            variant.stage_name,
                            variant.stock_strategy_label,
                            variant.print_status,
                            variant.lamination_status,
                        ]
                            .map((value) => String(value || "").toLowerCase())
                            .join(" ")
                            .includes(q)

                        const matchingRolls = familyMatches || variantMatches
                            ? variant.rolls
                            : variant.rolls.filter(rollMatches)
                        if (!matchingRolls.length) return null

                        const availableKg = matchingRolls
                            .filter((row) => String(row.status || "").toUpperCase() === "AVAILABLE")
                            .reduce((sum, row) => sum + toNumber(row.weight_kg, 0), 0)
                        const reservedKg = matchingRolls
                            .filter((row) => String(row.status || "").toUpperCase() === "RESERVED")
                            .reduce((sum, row) => sum + toNumber(row.weight_kg, 0), 0)
                        const blockedKg = matchingRolls
                            .filter((row) => !["AVAILABLE", "RESERVED"].includes(String(row.status || "").toUpperCase()))
                            .reduce((sum, row) => sum + toNumber(row.weight_kg, 0), 0)

                        const plantMap = new Map<string, { plant_name: string; locations: Set<string>; available_kg: number; reserved_kg: number; blocked_kg: number }>()
                        for (const row of matchingRolls) {
                            const plantKey = row.plant_id || row.plant_name || "UNKNOWN"
                            const plant = plantMap.get(plantKey) || {
                                plant_name: row.plant_name || "-",
                                locations: new Set<string>(),
                                available_kg: 0,
                                reserved_kg: 0,
                                blocked_kg: 0,
                            }
                            if (row.location_name) plant.locations.add(row.location_name)
                            const rowStatus = String(row.status || "").toUpperCase()
                            if (rowStatus === "AVAILABLE") plant.available_kg += toNumber(row.weight_kg, 0)
                            else if (rowStatus === "RESERVED") plant.reserved_kg += toNumber(row.weight_kg, 0)
                            else plant.blocked_kg += toNumber(row.weight_kg, 0)
                            plantMap.set(plantKey, plant)
                        }

                        return {
                            ...variant,
                            roll_count: matchingRolls.length,
                            available_kg: availableKg,
                            reserved_kg: reservedKg,
                            blocked_kg: blockedKg,
                            plant_summary: Array.from(plantMap.values()).map((plant) => ({
                                plant_name: plant.plant_name,
                                locations: Array.from(plant.locations).sort(),
                                available_kg: plant.available_kg,
                                reserved_kg: plant.reserved_kg,
                                blocked_kg: plant.blocked_kg,
                            })),
                            rolls: matchingRolls,
                        }
                    })
                    .filter(Boolean) as RollExplorerFamily["variants"]

                if (!variants.length) return null
                return {
                    ...family,
                    total_roll_count: variants.reduce((sum, variant) => sum + variant.roll_count, 0),
                    total_available_kg: variants.reduce((sum, variant) => sum + variant.available_kg, 0),
                    total_reserved_kg: variants.reduce((sum, variant) => sum + variant.reserved_kg, 0),
                    total_blocked_kg: variants.reduce((sum, variant) => sum + variant.blocked_kg, 0),
                    oldest_age_days: variants.reduce((max, variant) => Math.max(max, variant.oldest_age_days), 0),
                    variants,
                }
            })
            .filter(Boolean) as RollExplorerFamily[]
    }, [search, variantQuery.data])

    const totals = (mode === "variant" ? variantQuery.data?.totals : explorerQuery.data?.totals) || {
        roll_count: 0,
        weight_kg: 0,
        remainder_roll_count: 0,
        remainder_weight_kg: 0,
    };

    const variantSummaryCharts = useMemo(() => {
        const familyContribution = variantFamilies
            .map((family) => ({
                name: family.family_display_name,
                value: family.total_available_kg + family.total_reserved_kg + family.total_blocked_kg,
            }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 6)

        const stageMap = new Map<string, number>()
        const strategyMap = new Map<string, number>()
        const originMap = new Map<string, number>()

        for (const family of variantFamilies) {
            for (const variant of family.variants) {
                const variantWeight = toNumber(variant.available_kg, 0) + toNumber(variant.reserved_kg, 0) + toNumber(variant.blocked_kg, 0)
                stageMap.set(variant.stage_name || "Unknown", (stageMap.get(variant.stage_name || "Unknown") || 0) + variantWeight)
                strategyMap.set(variant.stock_strategy_label || stockStrategyLabel(variant.stock_strategy), (strategyMap.get(variant.stock_strategy_label || stockStrategyLabel(variant.stock_strategy)) || 0) + variantWeight)
                for (const row of variant.rolls) {
                    const origin = row.origin_label || originLabel(row.origin_type)
                    originMap.set(origin, (originMap.get(origin) || 0) + toNumber(row.weight_kg, 0))
                }
            }
        }

        return {
            familyContribution,
            stageMix: Array.from(stageMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
            strategyMix: Array.from(strategyMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
            originMix: Array.from(originMap.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        }
    }, [variantFamilies])

    const refresh = async () => {
        await Promise.all([
            qc.invalidateQueries({ queryKey: ["roll-explorer"] }),
            qc.invalidateQueries({ queryKey: ["roll-explorer-by-variant"] }),
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
    const isLoadingData = mode === "variant" ? variantQuery.isLoading : explorerQuery.isLoading
    const dataError = mode === "variant" ? variantQuery.error : explorerQuery.error

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
                            <TabsTrigger value="variant" className="rounded-md data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 px-4 transition-all duration-300 font-semibold tracking-tight"><Layers className="h-4 w-4 mr-2" strokeWidth={2.5} />By Variant</TabsTrigger>
                            <TabsTrigger value="grouped" className="rounded-md data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-700 px-4 transition-all duration-300 font-semibold tracking-tight"><ListFilter className="h-4 w-4 mr-2" strokeWidth={2.5} />By Stage</TabsTrigger>
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
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-indigo-500 transition-colors"><PieChartIcon className="w-4 h-4" /> Rolls In View</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900">{totals.roll_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-indigo-500 transition-colors"><Layers className="w-4 h-4" /> Total KG</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">{toNumber(totals.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold tracking-wide text-slate-400">kg</span></div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden border-b-4 border-b-amber-400 group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2"><Split className="w-4 h-4" /> Free Remainders</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900">{totals.remainder_roll_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden border-b-4 border-b-amber-400 group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-amber-500 flex items-center gap-2"><Tag className="w-4 h-4" /> Remainder KG</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">{toNumber(totals.remainder_weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-semibold tracking-wide text-amber-600/50">kg</span></div>
                    </CardContent>
                </Card>
            </div>

            {mode === "variant" && variantFamilies.length > 0 ? (
                <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
                    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-[12px] font-black uppercase tracking-[0.18em] text-slate-500">Family Contribution</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[280px]">
                            <ChartSurface loadingLabel="Preparing family chart…">
                                {({ width, height }) => (
                                    <BarChart width={width} height={height} data={variantSummaryCharts.familyContribution} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                                        <Tooltip formatter={(value: number | string | undefined) => [`${toNumber(value, 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, "Weight"]} />
                                        <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                                            {variantSummaryCharts.familyContribution.map((row, index) => (
                                                <Cell key={row.name} fill={ROLL_CHART_COLORS[index % ROLL_CHART_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                )}
                            </ChartSurface>
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-[12px] font-black uppercase tracking-[0.18em] text-slate-500">Stage Mix</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[280px]">
                            <ChartSurface loadingLabel="Preparing stage mix…">
                                {({ width, height }) => (
                                    <PieChart width={width} height={height}>
                                        <Pie data={variantSummaryCharts.stageMix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96} paddingAngle={4}>
                                            {variantSummaryCharts.stageMix.map((row, index) => (
                                                <Cell key={row.name} fill={ROLL_CHART_COLORS[index % ROLL_CHART_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number | string | undefined) => [`${toNumber(value, 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`, "Weight"]} />
                                    </PieChart>
                                )}
                            </ChartSurface>
                        </CardContent>
                    </Card>

                    <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-slate-100">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-[12px] font-black uppercase tracking-[0.18em] text-slate-500">Source Mix</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {variantSummaryCharts.strategyMix.map((row, index) => (
                                <div key={row.name} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{row.name}</div>
                                            <div className="mt-1 text-lg font-black tracking-tight text-slate-900">
                                                {row.value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                                            </div>
                                        </div>
                                        <div className="h-11 w-11 rounded-2xl" style={{ backgroundColor: `${ROLL_CHART_COLORS[index % ROLL_CHART_COLORS.length]}22` }} />
                                    </div>
                                </div>
                            ))}
                            {variantSummaryCharts.originMix.slice(0, 3).map((row) => (
                                <div key={row.name} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
                                    <SemanticBadge kind="origin" value={row.name} label={row.name} />
                                    <div className="font-black text-slate-900">
                                        {row.value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            ) : null}

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
                    Final stock
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
                    variant={stage === "Printed" ? "default" : "outline"}
                    onClick={() => setStage((current) => current === "Printed" ? "ALL" : "Printed")}
                >
                    Printed
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant={stage === "Laminated" ? "default" : "outline"}
                    onClick={() => setStage((current) => current === "Laminated" ? "ALL" : "Laminated")}
                >
                    Laminated
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
                    <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2"><ListFilter className="w-4 h-4 text-emerald-500" strokeWidth={2.5} /> Stock Filters</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4">
                        <div className="xl:col-span-2">
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Search</Label>
                            <div className="relative mt-1.5">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <Input className="pl-9 bg-slate-50/50 border-slate-200 shadow-none font-medium text-slate-900 focus-visible:ring-indigo-500" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Family, size, roll, job, or location..." />
                            </div>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Plant</Label>
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Business Family</Label>
                            <div className="mt-1.5">
                                <Select value={familyId} onValueChange={setFamilyId}>
                                    <SelectTrigger className="bg-slate-50/50 border-slate-200 font-medium shadow-none focus:ring-indigo-500"><SelectValue placeholder="All families" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ALL">All families</SelectItem>
                                        {commercialFamilies.map((family) => (
                                            <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>
                                        ))}
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Stage</Label>
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Roll Type</Label>
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Stock Strategy</Label>
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Stock Status</Label>
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
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Job Number</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono text-sm" value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} placeholder="JOB-XXXX..." />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">From Date</Label>
                            <Input type="date" className="mt-1.5 bg-slate-50/50 border-slate-200 text-slate-600 font-medium font-mono text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">To Date</Label>
                            <Input type="date" className="mt-1.5 bg-slate-50/50 border-slate-200 text-slate-600 font-medium font-mono text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Min KG</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono font-medium text-sm" value={weightMin} onChange={(e) => setWeightMin(e.target.value)} placeholder="0.00" />
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Max KG</Label>
                            <Input className="mt-1.5 bg-slate-50/50 border-slate-200 font-mono font-medium text-sm" value={weightMax} onChange={(e) => setWeightMax(e.target.value)} placeholder="Infinity" />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                        {[
                            plantId !== "ALL" ? `Plant: ${plants.find((row: any) => String(row.id) === plantId)?.name || plantId}` : null,
                            familyId !== "ALL" ? `Family: ${commercialFamilies.find((row) => String(row.id) === familyId)?.name || familyId}` : null,
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
                                setFamilyId("ALL");
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

            {isLoadingData ? (
                <Card><CardContent className="p-10 text-center text-slate-500">Loading roll explorer...</CardContent></Card>
            ) : dataError ? (
                <Card className="border-red-200">
                    <CardContent className="p-6 text-red-600 flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 mt-0.5" />
                        <div>
                            <div className="font-semibold">Failed to load roll explorer</div>
                            <div className="text-sm text-red-500">Try refreshing after checking filters.</div>
                        </div>
                    </CardContent>
                </Card>
            ) : mode === "variant" ? (
                <div className="space-y-4">
                    {variantFamilies.length === 0 ? (
                        <Card><CardContent className="p-8 text-center text-slate-500">No stock families found for current filters.</CardContent></Card>
                    ) : (
                        <>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {variantFamilies.map((family) => (
                                    <Card key={`${family.family_key}-summary`} className="border-slate-200 shadow-sm">
                                        <CardContent className="space-y-3 p-5">
                                            <div>
                                                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{family.reporting_group || "Stock Family"}</div>
                                                <div className="mt-1 text-lg font-black tracking-tight text-slate-900">{family.family_display_name}</div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3 text-sm">
                                                <div className="rounded-xl bg-slate-50 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Variants</div>
                                                    <div className="mt-1 text-xl font-black text-slate-900">{family.variants.length}</div>
                                                </div>
                                                <div className="rounded-xl bg-slate-50 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Rolls</div>
                                                    <div className="mt-1 text-xl font-black text-slate-900">{family.total_roll_count}</div>
                                                </div>
                                                <div className="rounded-xl bg-emerald-50 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Available</div>
                                                    <div className="mt-1 text-xl font-black text-emerald-700">{family.total_available_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div>
                                                </div>
                                                <div className="rounded-xl bg-amber-50 p-3">
                                                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">Reserved</div>
                                                    <div className="mt-1 text-xl font-black text-amber-700">{family.total_reserved_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</div>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>

                            {variantFamilies.map((family) => {
                                const familyOpen = expandedFamilies[family.family_key] ?? true
                                return (
                                    <Card key={family.family_key} className="overflow-hidden border-slate-200 shadow-sm bg-gradient-to-br from-white via-white to-slate-50">
                                        <CardHeader className="border-b border-slate-100 bg-white/90 py-5">
                                            <button
                                                type="button"
                                                className="flex w-full items-center justify-between gap-3 text-left"
                                                onClick={() => setExpandedFamilies((current) => ({ ...current, [family.family_key]: !familyOpen }))}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{family.reporting_group || "Stock Family"}</div>
                                                    <CardTitle className="mt-1 text-2xl font-black tracking-tight text-slate-900">{family.family_display_name}</CardTitle>
                                                    <p className="mt-1 text-sm text-slate-500">
                                                        {family.variants.length} usable sizes • {family.total_roll_count} rolls • oldest stock {family.oldest_age_days || 0}d
                                                    </p>
                                                </div>
                                                <div className="hidden shrink-0 gap-3 lg:grid lg:grid-cols-3">
                                                    <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-right">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-600">Available</div>
                                                        <div className="mt-1 text-xl font-black tracking-tight text-emerald-700">{family.total_available_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                    </div>
                                                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-right">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-600">Reserved</div>
                                                        <div className="mt-1 text-xl font-black tracking-tight text-amber-700">{family.total_reserved_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                    </div>
                                                    <div className="rounded-2xl bg-rose-50 px-4 py-3 text-right">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-rose-600">Blocked</div>
                                                        <div className="mt-1 text-xl font-black tracking-tight text-rose-700">{family.total_blocked_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <SemanticBadge kind="jobState" value="READY" label={`${family.total_available_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`} />
                                                    {familyOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                                                </div>
                                            </button>
                                        </CardHeader>
                                        {familyOpen ? (
                                            <CardContent className="space-y-3 p-4">
                                                {family.variants.map((variant) => {
                                                    const variantOpen = expandedVariants[variant.variant_key] ?? false
                                                    return (
                                                        <div key={variant.variant_key} className="rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
                                                            <button
                                                                type="button"
                                                                className="flex w-full flex-col gap-4 px-5 py-5 text-left xl:flex-row xl:items-start xl:justify-between"
                                                                onClick={() => setExpandedVariants((current) => ({ ...current, [variant.variant_key]: !variantOpen }))}
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="font-black tracking-tight text-slate-900 text-lg break-words">{variant.variant_display_name}</div>
                                                                    <div className="mt-1 text-sm font-medium text-slate-600 break-words">{variant.size_line || "Size not set"} • {variant.stage_name} • {variant.stock_strategy_label}</div>
                                                                    <div className="mt-3 flex flex-wrap gap-2">
                                                                        <SemanticBadge kind="processState" value={variant.print_status} />
                                                                        <SemanticBadge kind="processState" value={variant.lamination_status} />
                                                                        <SemanticBadge kind="stockStrategy" value={variant.stock_strategy} label={variant.stock_strategy_label} />
                                                                    </div>
                                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                                        {variant.plant_summary.map((plant) => (
                                                                            <div key={`${variant.variant_key}-${plant.plant_name}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                                                                                {plant.plant_name} • {plant.locations.length} node{plant.locations.length === 1 ? "" : "s"}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                                <div className="grid min-w-0 shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 xl:min-w-[420px]">
                                                                        <div className="rounded-2xl bg-slate-50 p-3 text-center">
                                                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Rolls</div>
                                                                            <div className="mt-1 text-lg font-black text-slate-900">{variant.roll_count}</div>
                                                                        </div>
                                                                        <div className="rounded-2xl bg-emerald-50 p-3 text-center">
                                                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-600">Available</div>
                                                                            <div className="mt-1 text-lg font-black text-emerald-700">{variant.available_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                                        </div>
                                                                        <div className="rounded-2xl bg-amber-50 p-3 text-center">
                                                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">Reserved</div>
                                                                            <div className="mt-1 text-lg font-black text-amber-700">{variant.reserved_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                                        </div>
                                                                        <div className="rounded-2xl bg-rose-50 p-3 text-center">
                                                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-600">Blocked</div>
                                                                            <div className="mt-1 text-lg font-black text-rose-700">{variant.blocked_kg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                                                        </div>
                                                                    </div>
                                                            </button>
                                                            {variantOpen ? (
                                                                <div className="border-t border-slate-200 bg-white px-4 py-3">
                                                                    <div className="grid gap-2">
                                                                        {variant.rolls.map((row) => (
                                                                            <button
                                                                                key={row.id}
                                                                                type="button"
                                                                                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left hover:bg-slate-50"
                                                                                onClick={() => {
                                                                                    setSelected(row)
                                                                                    setMoveLocationId("ALL")
                                                                                    setDrawerOpen(true)
                                                                                }}
                                                                            >
                                                                                <div className="min-w-0">
                                                                                    <div className="font-bold text-slate-900">{row.label_id}</div>
                                                                                    <div className="mt-1 text-xs text-slate-500">{row.location_name || "No location"} · {row.plant_name || "No plant"} · {row.process_state_label || row.stage_name}</div>
                                                                                </div>
                                                                                <div className="flex items-center gap-2">
                                                                                    <SemanticBadge value={row.status} className="shadow-none" />
                                                                                    <SemanticBadge kind="origin" value={row.origin_type} label={row.origin_label || originLabel(row.origin_type)} className="shadow-none" />
                                                                                    <div className="font-mono text-sm font-black text-slate-900">{toNumber(row.weight_kg, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} kg</div>
                                                                                </div>
                                                                            </button>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    )
                                                })}
                                            </CardContent>
                                        ) : null}
                                    </Card>
                                )
                            })}
                        </>
                    )}
                </div>
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
                                                <SemanticBadge kind="origin" value={row.origin_type} label={originLabel(row.origin_type)} className="shadow-none" />
                                                <SemanticBadge kind="stockStrategy" value={row.stock_strategy} label={stockStrategyLabel(row.stock_strategy)} className="shadow-none" />
                                                <SemanticBadge kind="rollRole" value={row.roll_role} label={row.roll_role || "—"} className="shadow-none" />
                                                <SemanticBadge kind="processState" value={stageBadgeLabel(row)} label={stageBadgeLabel(row)} className="shadow-none bg-white" />
                                                <SemanticBadge value={row.status} className="shadow-none" />
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
                                                <SemanticBadge kind="origin" value={row.origin_type} label={originLabel(row.origin_type)} className="shadow-none" />
                                                <SemanticBadge kind="rollRole" value={row.roll_role} label={row.roll_role || "—"} className="shadow-none" />
                                            </div>
                                        </td>
                                        <td className="px-5 py-3"><SemanticBadge kind="processState" value={stageBadgeLabel(row)} label={stageBadgeLabel(row)} className="shadow-none bg-white" /></td>
                                        <td className="px-5 py-3"><SemanticBadge value={row.status} className="shadow-none" /></td>
                                        <td className="px-5 py-3"><SemanticBadge kind="stockStrategy" value={row.stock_strategy} label={stockStrategyLabel(row.stock_strategy)} className="shadow-none" /></td>
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
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Origin / Stage</div><div className="flex flex-wrap gap-2 mt-2"><SemanticBadge kind="origin" value={selected.origin_type} label={originLabel(selected.origin_type)} /><SemanticBadge kind="processState" value={stageBadgeLabel(selected)} label={stageBadgeLabel(selected)} className="bg-white" /><SemanticBadge kind="rollRole" value={selected.roll_role} label={selected.roll_role || "—"} /></div></CardContent></Card>
                                <Card className="border-0 shadow-sm rounded-xl overflow-hidden ring-1 ring-slate-100 bg-white"><CardContent className="p-4"><div className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Consumption / Locator</div><div className="flex flex-wrap gap-2 mt-2"><SemanticBadge kind="stockStrategy" value={selected.stock_strategy} label={stockStrategyLabel(selected.stock_strategy)} /><Badge variant="outline" className="border-slate-200 bg-white text-slate-700">{selected.location_name || "No location"}</Badge></div><div className="text-[11px] font-medium text-slate-500 mt-2">{selected.consumability_mode || "Planner will derive consumability from stock strategy."}</div></CardContent></Card>
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
