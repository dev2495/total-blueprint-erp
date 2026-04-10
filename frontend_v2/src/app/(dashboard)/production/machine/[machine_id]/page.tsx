'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    AlertCircle,
    BarChart3,
    CheckCircle2,
    History,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Settings2,
    Trash2,
    Truck,
    Server,
    Layers,
    ChevronRight,
    Package,
    Activity,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SemanticBadge } from '@/components/ui-custom/semantic-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { inventoryService } from '@/services/inventory';
import { machineService } from '@/services/machine';

type SplitRow = {
    id: number;
    width_mm: string;
    weight_kg: string;
};

type CreateRollRow = {
    id: number;
    width_mm: string;
    weight_kg: string;
    length_m: string;
};

type MaterialConfirmationDraft = {
    requirement_id: string;
    material_id?: string;
    actual_issued_qty: string;
    actual_returned_qty: string;
    actual_scrap_qty: string;
    is_estimated: boolean;
    return_mode?: 'EXACT_COLOR_RETURN' | 'REMIXED_RETURN';
    target_ink_material_id?: string;
    granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: string }>;
};

const POLL_MS = 8000;
const DEFAULT_REMAINDER = '__DEFAULT__';

function toNumber(value: unknown, fallback = 0): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function toNullableNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function resolveCreateNewDefaultWidth(context?: any): number | null {
    if (!context || typeof context !== 'object') return null;

    const specs = Array.isArray(context?.target_roll_invariant_list) ? context.target_roll_invariant_list : [];
    const orderedSpecs = [...specs].sort((a: any, b: any) => {
        const aIdx = Number(a?.layer_index ?? 9999);
        const bIdx = Number(b?.layer_index ?? 9999);
        if (Number.isFinite(aIdx) && Number.isFinite(bIdx)) return aIdx - bIdx;
        return 0;
    });

    for (const spec of orderedSpecs) {
        const width = toNullableNumber(spec?.min_width_mm);
        if (width !== null && width > 0) return width;
    }

    const fallback = toNullableNumber(context?.target_roll_invariants?.min_width_mm);
    if (fallback !== null && fallback > 0) return fallback;

    return null;
}

function behaviorLabel(raw?: string | null): string {
    const behavior = String(raw || 'NONE').toUpperCase();
    if (behavior === 'MULTI_INPUT_COMBINE') return 'MULTI_INPUT';
    return behavior;
}

function formatMm(value: unknown): string {
    const num = toNullableNumber(value);
    if (num === null) return '—';
    return `${toNumber(num, 0).toFixed(0)} mm`;
}

function formatMicron(value: unknown): string {
    const num = toNullableNumber(value);
    if (num === null) return '—';
    return `${toNumber(num, 0).toFixed(1)} μm`;
}

function stateTone(state?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
    const normalized = String(state || '').toUpperCase();
    if (normalized === 'EXECUTING') return 'default';
    if (normalized === 'PAUSED') return 'secondary';
    if (normalized === 'COMPLETED') return 'outline';
    return 'outline';
}

export default function MachineExecutionPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();

    const machineIdParam = params?.machine_id;
    const machineId = Array.isArray(machineIdParam) ? machineIdParam[0] : String(machineIdParam || '');

    const [selectedJobId, setSelectedJobId] = useState('');
    const [outputWeightKg, setOutputWeightKg] = useState('');
    const [outputPcs, setOutputPcs] = useState('');
    const [outputEntryMode, setOutputEntryMode] = useState<'KG' | 'PCS'>('KG');
    const [outputWidthMm, setOutputWidthMm] = useState('');
    const [outputWidthDirty, setOutputWidthDirty] = useState(false);
    const [outputWeightDirty, setOutputWeightDirty] = useState(false);
    const [outputLengthM, setOutputLengthM] = useState('');
    const [createRollRows, setCreateRollRows] = useState<CreateRollRow[]>([]);
    const [scrapKg, setScrapKg] = useState('0');
    const [scrapPcs, setScrapPcs] = useState('0');
    const [scrapEntryMode, setScrapEntryMode] = useState<'KG' | 'PCS'>('KG');
    const scrapInputRef = useRef<HTMLInputElement | null>(null);
    const [stopReason, setStopReason] = useState('Operator stop');
    const [remainderLocationId, setRemainderLocationId] = useState(DEFAULT_REMAINDER);
    const [forceReason, setForceReason] = useState('');
    const [splitRows, setSplitRows] = useState<SplitRow[]>([{ id: 1, width_mm: '', weight_kg: '' }]);
    const splitCounterRef = useRef(2);
    const createRowCounterRef = useRef(1);
    const initializedJobIdRef = useRef<string | null>(null);
    const [materialConfirmations, setMaterialConfirmations] = useState<Record<string, MaterialConfirmationDraft>>({});
    const [activeTab, setActiveTab] = useState<'execution' | 'history'>('execution');
    const [historyDateFrom, setHistoryDateFrom] = useState('');
    const [historyDateTo, setHistoryDateTo] = useState('');
    const [historyStatus, setHistoryStatus] = useState<'ALL' | 'NORMAL' | 'FORCED_VARIANCE'>('ALL');

    const {
        data: machineDetail,
        isLoading: machineLoading,
        error: machineError,
    } = useQuery({
        queryKey: ['machine-detail', machineId],
        queryFn: () => machineService.getMachineDetail(machineId),
        enabled: Boolean(machineId),
        refetchInterval: POLL_MS,
    });

    const {
        data: queueData = [],
        isLoading: queueLoading,
        error: queueError,
    } = useQuery({
        queryKey: ['machine-queue', machineId],
        queryFn: () => machineService.getQueue(machineId),
        enabled: Boolean(machineId),
        refetchInterval: POLL_MS,
    });

    const queueItems = useMemo(() => {
        if (Array.isArray(queueData)) return queueData;
        const maybeObject = queueData as any;
        const nestedCandidates = [
            maybeObject?.queue,
            maybeObject?.results,
            maybeObject?.jobs,
            maybeObject?.machines,
            maybeObject?.data,
        ];
        for (const candidate of nestedCandidates) {
            if (Array.isArray(candidate)) return candidate;
        }
        return [];
    }, [queueData]);
    const safeQueueItems = Array.isArray(queueItems) ? queueItems : [];

    const isActive = machineDetail?.machine?.status === 'ACTIVE';

    const selectedJob = useMemo(() => {
        if (!safeQueueItems.length) return null;
        const byId = safeQueueItems.find((job) => String(job.id) === String(selectedJobId));
        if (byId) return byId;
        return safeQueueItems.find((job) => String(job.job_state).toUpperCase() === 'EXECUTING') || safeQueueItems[0];
    }, [safeQueueItems, selectedJobId]);

    const selectedId = String(selectedJob?.id || '');

    const { data: context, isLoading: contextLoading } = useQuery({
        queryKey: ['machine-job-context', machineId, selectedId],
        queryFn: () => machineService.getJobContext(machineId, selectedId),
        enabled: Boolean(machineId && selectedId),
        refetchInterval: POLL_MS,
    });

    const {
        data: historyData,
        isLoading: historyLoading,
    } = useQuery({
        queryKey: ['machine-history', machineId, historyDateFrom, historyDateTo, historyStatus],
        queryFn: () =>
            machineService.getMachineHistory(machineId, {
                date_from: historyDateFrom || undefined,
                date_to: historyDateTo || undefined,
                status: historyStatus,
            }),
        enabled: Boolean(machineId) && activeTab === 'history',
        refetchInterval: activeTab === 'history' ? POLL_MS : false,
    });

    const plantId = String(machineDetail?.machine?.plant_id || '');
    const { data: plantLocations = [] } = useQuery({
        queryKey: ['machine-plant-locations', plantId],
        queryFn: () => inventoryService.getLocations(plantId),
        enabled: Boolean(plantId),
        staleTime: 20_000,
    });

    const remainderLocations = useMemo(
        () => (plantLocations || []).filter((loc: any) => loc?.is_active && loc?.type !== 'IN_TRANSIT'),
        [plantLocations]
    );

    useEffect(() => {
        if (!safeQueueItems.length) {
            setSelectedJobId('');
            return;
        }
        if (!selectedJobId || !safeQueueItems.some((job) => String(job.id) === String(selectedJobId))) {
            const executing = safeQueueItems.find((job) => String(job.job_state).toUpperCase() === 'EXECUTING');
            setSelectedJobId(String((executing || safeQueueItems[0]).id));
        }
    }, [safeQueueItems, selectedJobId]);

    const behaviorRaw =
        context?.roll_handling?.behavior ||
        context?.display?.roll_behavior ||
        context?.job?.roll_behavior ||
        selectedJob?.roll_behavior ||
        'NONE';
    const behavior = String(behaviorRaw || 'NONE').toUpperCase();
    const behaviorDisplay = behaviorLabel(behavior);

    const progressWeight = context?.progress?.weight_kg || context?.execution_profile?.progress?.weight_kg || {};
    const progressPcs = context?.progress?.pcs || context?.execution_profile?.progress?.pcs || {};
    const stepExecution = context?.step_execution || {};
    const stepPolicy = context?.step_policy || {};
    const orderProgress = context?.order_progress || {};

    const targetWeightKg = toNullableNumber(progressWeight?.target);
    const producedWeightKg = toNullableNumber(progressWeight?.produced);
    const remainingWeightKg = toNullableNumber(progressWeight?.remaining);

    const remainingPcs = toNullableNumber(progressPcs?.remaining);

    const fallbackTarget = toNumber(selectedJob?.quantity, 0);
    const fallbackProduced = toNumber(context?.job?.produced_qty, 0);
    const fallbackRemaining = toNumber(context?.job?.remaining_qty ?? selectedJob?.remaining_qty, 0);

    const primaryTarget = targetWeightKg ?? (String(selectedJob?.uom || '').toUpperCase() === 'KG' ? fallbackTarget : null);
    const primaryProduced = producedWeightKg ?? (String(selectedJob?.uom || '').toUpperCase() === 'KG' ? fallbackProduced : null);
    const primaryRemaining = remainingWeightKg ?? (String(selectedJob?.uom || '').toUpperCase() === 'KG' ? fallbackRemaining : null);

    const orderWeight = orderProgress?.weight_kg || {};
    const orderPcs = orderProgress?.pcs || {};
    const orderTargetKg = toNullableNumber(orderWeight?.target);
    const orderProducedKg = toNullableNumber(orderWeight?.produced);
    const orderRemainingKg = toNullableNumber(orderWeight?.remaining);
    const stepRollTargetKg = toNumber(stepExecution?.roll_target_kg, 0);
    const stepBulkTargetKg = toNumber(stepExecution?.bulk_target_kg, 0);
    const stepTotalTargetKg = toNumber(stepExecution?.total_target_kg, primaryTarget || 0);
    const stepProducedKg = toNumber(stepExecution?.produced_kg, primaryProduced || 0);
    const stepRemainingKg = toNumber(stepExecution?.remaining_kg, primaryRemaining || 0);
    const stepRemainingPcs = toNullableNumber(stepExecution?.remaining_pcs ?? remainingPcs);
    const stepToleranceKg = Math.max(0, toNumber(stepExecution?.tolerance_kg, 0.25));
    const unitWeightG = toNumber(
        context?.execution_profile?.unit_weight_g ??
        context?.job?.unit_weight_g ??
        (selectedJob as any)?.unit_weight_g,
        0
    );

    const progressPct = useMemo(() => {
        if (primaryTarget && primaryTarget > 0 && primaryProduced !== null) {
            return Math.min(100, Math.max(0, (primaryProduced / primaryTarget) * 100));
        }
        return 0;
    }, [primaryTarget, primaryProduced]);

    const reservedRolls =
        (context?.inputs?.reserved_rolls || context?.allocated_rolls || []).map((row: any) => ({
            id: String(row.id),
            label_id: row.label_id || row.id,
            weight_kg: toNumber(row.weight_kg, 0),
            thickness_micron: toNullableNumber(row.thickness_micron ?? row.thickness),
            width_mm: toNullableNumber(row.width_mm ?? row.width),
            variant: row.variant || row.material_name || '—',
            grade: row.grade || row.grade_name || '—',
            location_name: row.location_name || '—',
        }));
    const bulkPreview =
        context?.inputs?.bulk_preview_theoretical ||
        context?.inputs?.bulk_preview ||
        context?.satisfaction?.bulk_consumption ||
        [];
    const reconcilableBulkRows = useMemo(
        () =>
            (bulkPreview || []).filter((row: any) => {
                const mode = String(row?.capture_mode || row?.strategy || '').toUpperCase();
                return mode !== 'AUTO_FROM_OUTPUT';
            }),
        [bulkPreview]
    );

    const wipPool = (context?.wip_pool || []).map((row: any) => ({
        id: String(row.id),
        label_id: row.label_id,
        weight_kg: toNumber(row.weight_kg, 0),
        thickness_micron: toNullableNumber(row.thickness_micron),
        width_mm: toNullableNumber(row.width_mm),
        variant: row.material_name || '—',
        grade: row.grade || '—',
        location_name: row.location_name || '—',
        stage: row.stage || '—',
    }));
    const wipPoolMeta = context?.wip_pool_meta || {};
    const wipRecentLineage = context?.wip_recent_lineage || [];
    const rollInputRequired = Boolean(wipPoolMeta?.required_for_step);
    const displayedWip = rollInputRequired ? wipPool : wipRecentLineage;
    const displayedWipWeightKg = displayedWip.reduce((sum: number, row: any) => sum + toNumber(row?.weight_kg, 0), 0);
    const totalLineageWeightKg = toNumber(wipPoolMeta?.lineage_total_weight_kg, displayedWipWeightKg);

    const telemetry = context?.telemetry || {};
    const telemetryHealth = telemetry?.execution_health || {};
    const telemetryCounters = telemetry?.inventory_counters || telemetry || {};
    const telemetryLogs = telemetryCounters?.live_logs || telemetry?.live_logs || context?.live_consumption?.last_events || [];
    const geometryCards = context?.geometry_cards || {};
    const currentInputForm = String(context?.current_step?.input_form || context?.job?.input_form || selectedJob?.input_form || '').toUpperCase();
    const currentOutputForm = String(context?.job?.output_form || selectedJob?.output_form || '').toUpperCase();
    const reservedInputTotalKg = useMemo(
        () => reservedRolls.reduce((sum: number, row: any) => sum + toNumber(row?.weight_kg, 0), 0),
        [reservedRolls]
    );
    const contextMaxOutputKg = toNullableNumber(stepExecution?.max_output_kg ?? context?.execution_profile?.max_output_kg);
    const maxOutputWithoutScrapKg = useMemo(() => {
        const stepCap = Math.max(0, stepRemainingKg);
        if (currentInputForm !== 'ROLL') {
            return contextMaxOutputKg !== null ? Math.max(0, contextMaxOutputKg) : stepCap;
        }
        const inputCap = Math.max(0, reservedInputTotalKg);
        if (contextMaxOutputKg !== null) {
            return Math.max(0, Math.min(contextMaxOutputKg, inputCap));
        }
        return Math.max(0, Math.min(stepCap, inputCap));
    }, [stepRemainingKg, currentInputForm, contextMaxOutputKg, reservedInputTotalKg]);
    const rollToBulkStrict = String(stepPolicy?.roll_to_bulk_validation_mode || '').toUpperCase().includes('KG_AND_PCS_REQUIRED');
    const showPcsEntry = currentOutputForm === 'BULK' && (currentInputForm === 'ROLL' || rollToBulkStrict);
    const emphasizeGeometry = currentInputForm === 'ROLL' && currentOutputForm === 'BULK';
    const allocationRequired = Boolean(stepPolicy?.allocation_required);
    const executionVersion = toNumber(
        context?.execution_model_version ?? context?.job?.execution_model_version ?? (selectedJob as any)?.execution_model_version,
        1
    );
    const stepTargetSource = String(stepExecution?.target_source || stepPolicy?.step_target_source || (selectedJob as any)?.step_target_source || 'NA');
    const orderTargetSource = String((selectedJob as any)?.order_target_source || stepPolicy?.order_target_source || 'NA');
    const baseGeometry = geometryCards?.base_geometry || {};
    const effectiveGeometry = geometryCards?.effective_geometry || {};
    const baseWidthMm = toNullableNumber(baseGeometry?.width_mm ?? baseGeometry?.width);
    const baseHeightMm = toNullableNumber(baseGeometry?.height_mm ?? baseGeometry?.height);
    const baseAreaM2 = toNullableNumber(baseGeometry?.area_m2 ?? baseGeometry?.area);
    const effectiveWidthMm = toNullableNumber(effectiveGeometry?.width_mm ?? effectiveGeometry?.width ?? baseWidthMm);
    const effectiveHeightMm = toNullableNumber(effectiveGeometry?.height_mm ?? effectiveGeometry?.height ?? baseHeightMm);
    const effectiveAreaM2 = toNullableNumber(effectiveGeometry?.area_m2 ?? effectiveGeometry?.area ?? baseAreaM2);
    const createNewDefaultWidthMm = useMemo(
        () => (behavior === 'CREATE_NEW' ? resolveCreateNewDefaultWidth(context) : null),
        [behavior, context]
    );

    useEffect(() => {
        const nextJobId = selectedJob?.id ? String(selectedJob.id) : null;
        if (!nextJobId) {
            initializedJobIdRef.current = null;
            return;
        }
        if (initializedJobIdRef.current === nextJobId) return;
        initializedJobIdRef.current = nextJobId;

        setOutputWidthMm('');
        setOutputWidthDirty(false);
        setOutputWeightDirty(false);
        setOutputLengthM('');
        setScrapKg('0');
        setScrapPcs('0');
        setScrapEntryMode('KG');
        setRemainderLocationId(DEFAULT_REMAINDER);
        setForceReason('');
        setOutputPcs('');
        setOutputEntryMode(showPcsEntry ? 'PCS' : 'KG');
        setCreateRollRows([]);
        createRowCounterRef.current = 1;
        setSplitRows([{ id: 1, width_mm: '', weight_kg: '' }]);
        splitCounterRef.current = 2;

        const initial = maxOutputWithoutScrapKg > 0
            ? maxOutputWithoutScrapKg
            : (primaryRemaining !== null ? Math.max(primaryRemaining, 0) : 0);
        setOutputWeightKg(initial > 0 ? initial.toFixed(3) : '');
        if (showPcsEntry) {
            const pcsInitial = unitWeightG > 0 && initial > 0
                ? Math.max(1, Math.round((initial * 1000) / unitWeightG))
                : (stepRemainingPcs !== null ? Math.max(stepRemainingPcs, 0) : 0);
            setOutputPcs(pcsInitial > 0 ? Math.round(pcsInitial).toString() : '');
        }
    }, [selectedJob?.id, primaryRemaining, showPcsEntry, stepRemainingPcs, maxOutputWithoutScrapKg, unitWeightG]);

    useEffect(() => {
        if (!selectedJob) return;
        if (behavior !== 'CREATE_NEW') return;
        if (outputWidthDirty) return;
        if ((outputWidthMm || '').trim().length > 0) return;
        if (!createNewDefaultWidthMm || createNewDefaultWidthMm <= 0) return;
        setOutputWidthMm(String(Math.round(createNewDefaultWidthMm)));
    }, [selectedJob?.id, behavior, outputWidthDirty, outputWidthMm, createNewDefaultWidthMm]);

    useEffect(() => {
        if (!showPcsEntry) {
            if (outputEntryMode !== 'KG') setOutputEntryMode('KG');
            return;
        }
        if (outputEntryMode !== 'PCS') return;
        if (unitWeightG <= 0) return;
        const pcs = toNumber(outputPcs, NaN);
        if (!Number.isFinite(pcs) || pcs <= 0) return;
        if (outputWeightDirty) return;
        const derivedKg = (Math.round(pcs) * unitWeightG) / 1000;
        if (derivedKg > 0) {
            setOutputWeightKg(derivedKg.toFixed(3));
        }
    }, [showPcsEntry, outputEntryMode, outputPcs, unitWeightG, outputWeightDirty]);

    useEffect(() => {
        if (!showPcsEntry) return;
        if (outputEntryMode !== 'KG') return;
        if (unitWeightG <= 0) return;
        const kg = toNumber(outputWeightKg, NaN);
        if (!Number.isFinite(kg) || kg <= 0) return;
        const derivedPcs = Math.max(1, Math.round((kg * 1000) / unitWeightG));
        setOutputPcs((prev) => (prev === String(derivedPcs) ? prev : String(derivedPcs)));
    }, [showPcsEntry, outputEntryMode, outputWeightKg, unitWeightG]);

    const splitRowsParsed = useMemo(() => {
        return splitRows
            .map((row) => ({
                id: row.id,
                width_mm: toNumber(row.width_mm, 0),
                weight_kg: toNumber(row.weight_kg, 0),
            }))
            .filter((row) => row.width_mm > 0 && row.weight_kg > 0);
    }, [splitRows]);

    const splitTotalKg = useMemo(
        () => splitRowsParsed.reduce((acc, row) => acc + toNumber(row.weight_kg, 0), 0),
        [splitRowsParsed]
    );

    const createRollRowsParsed = useMemo(() => {
        const firstRow = {
            id: 0,
            width_mm: toNumber(outputWidthMm, 0),
            weight_kg: toNumber(outputWeightKg, 0),
            length_m: toNullableNumber(outputLengthM),
        };
        const extraRows = createRollRows
            .map((row) => ({
                id: row.id,
                width_mm: toNumber(row.width_mm, 0),
                weight_kg: toNumber(row.weight_kg, 0),
                length_m: toNullableNumber(row.length_m),
            }))
            .filter((row) => row.width_mm > 0 && row.weight_kg > 0);

        const rows = [];
        if (firstRow.width_mm > 0 && firstRow.weight_kg > 0) {
            rows.push(firstRow);
        }
        rows.push(...extraRows);
        return rows;
    }, [createRollRows, outputLengthM, outputWeightKg, outputWidthMm]);

    const createRollTotalKg = useMemo(
        () => createRollRowsParsed.reduce((acc, row) => acc + toNumber(row.weight_kg, 0), 0),
        [createRollRowsParsed]
    );

    const firstReservedWeight = toNumber(reservedRolls[0]?.weight_kg, 0);
    const scrapValue = useMemo(() => {
        if (scrapEntryMode === 'PCS') {
            const pcs = Math.max(0, toNumber(scrapPcs, 0));
            if (pcs <= 0 || unitWeightG <= 0) return 0;
            return (pcs * unitWeightG) / 1000;
        }
        return Math.max(0, toNumber(scrapKg, 0));
    }, [scrapEntryMode, scrapPcs, scrapKg, unitWeightG]);
    const splitRemainder = behavior === 'SPLIT' ? Math.max(0, firstReservedWeight - splitTotalKg - scrapValue) : null;
    const previewOutputKg = useMemo(() => {
        if (behavior === 'SPLIT') {
            return Math.max(0, splitTotalKg);
        }
        if (behavior === 'CREATE_NEW' && createRollRowsParsed.length > 0) {
            return Math.max(0, createRollTotalKg);
        }
        if (showPcsEntry && outputEntryMode === 'PCS') {
            const pcs = toNumber(outputPcs, NaN);
            if (Number.isFinite(pcs) && pcs > 0 && unitWeightG > 0) {
                return (Math.round(pcs) * unitWeightG) / 1000;
            }
        }
        const kg = toNumber(outputWeightKg, NaN);
        if (Number.isFinite(kg) && kg > 0) return kg;
        if (showPcsEntry) {
            const pcs = toNumber(outputPcs, NaN);
            if (Number.isFinite(pcs) && pcs > 0 && unitWeightG > 0) {
                return (Math.round(pcs) * unitWeightG) / 1000;
            }
        }
        return 0;
    }, [behavior, splitTotalKg, createRollRowsParsed.length, createRollTotalKg, showPcsEntry, outputEntryMode, outputPcs, unitWeightG, outputWeightKg]);
    const previewOutputPcs = useMemo(() => {
        if (!showPcsEntry) return null;
        const pcs = toNumber(outputPcs, NaN);
        if (Number.isFinite(pcs) && pcs > 0) {
            return Math.max(1, Math.round(pcs));
        }
        if (unitWeightG > 0 && previewOutputKg > 0) {
            return Math.max(1, Math.round((previewOutputKg * 1000) / unitWeightG));
        }
        return null;
    }, [showPcsEntry, outputPcs, unitWeightG, previewOutputKg]);
    const maxOutputWithScrapKg = useMemo(() => {
        if (currentInputForm !== 'ROLL') {
            return Math.max(0, maxOutputWithoutScrapKg);
        }
        const inputAfterScrap = Math.max(0, reservedInputTotalKg - scrapValue);
        return Math.max(0, Math.min(maxOutputWithoutScrapKg, inputAfterScrap));
    }, [currentInputForm, maxOutputWithoutScrapKg, reservedInputTotalKg, scrapValue]);
    const exceedsOutputCap = previewOutputKg > (maxOutputWithScrapKg + 0.001);

    useEffect(() => {
        if (!selectedJob) return;
        if (behavior === 'SPLIT') return;
        if (maxOutputWithScrapKg <= 0) return;
        const currentKg = toNumber(outputWeightKg, NaN);
        if (!Number.isFinite(currentKg) || currentKg <= maxOutputWithScrapKg + 0.001) return;
        const clampedKg = maxOutputWithScrapKg;
        setOutputWeightKg(clampedKg.toFixed(3));
        if (showPcsEntry && unitWeightG > 0) {
            const clampedPcs = Math.max(1, Math.round((clampedKg * 1000) / unitWeightG));
            setOutputPcs(String(clampedPcs));
        }
    }, [
        selectedJob?.id,
        behavior,
        maxOutputWithScrapKg,
        outputWeightKg,
        showPcsEntry,
        unitWeightG,
    ]);

    const jobState = String(selectedJob?.job_state || '').toUpperCase();
    const isExecuting = jobState === 'EXECUTING';
    const allocationReservationReady = !allocationRequired || reservedRolls.length === 1;
    const canStart = Boolean(
        selectedJob &&
        !isExecuting &&
        jobState !== 'COMPLETED' &&
        jobState !== 'CANCELLED' &&
        allocationReservationReady
    );
    const canStop = Boolean(selectedJob && isExecuting);
    const canLogOutput = Boolean(selectedJob && isExecuting && allocationReservationReady && !exceedsOutputCap);

    const needsForceComplete = useMemo(() => {
        const remaining = stepRemainingKg;
        return remaining > stepToleranceKg;
    }, [stepRemainingKg, stepToleranceKg]);

    const forceReasonRequired = needsForceComplete;
    const forceReasonValid = !forceReasonRequired || forceReason.trim().length >= 5;
    const canComplete = Boolean(selectedJob && (jobState === 'EXECUTING' || jobState === 'PAUSED') && forceReasonValid);
    const operatorNextStep = (() => {
        if (!selectedJob) return "Pick a job from the queue."
        if (!allocationReservationReady) return "Reserve the required roll before starting."
        if (canStart) return "Start the job when the machine setup is ready."
        if (canLogOutput) return "Enter finished output and scrap, then save the log."
        if (canComplete) return needsForceComplete ? "Add a reason, then finalize the step." : "Finalize this step when output is complete."
        if (canStop) return "Pause the job only if you need to stop the machine."
        return "Check the current job state before the next action."
    })()

    const addSplitRow = () => {
        setSplitRows((prev) => [...prev, { id: splitCounterRef.current++, width_mm: '', weight_kg: '' }]);
    };

    const addCreateRollRow = () => {
        setCreateRollRows((prev) => [
            ...prev,
            { id: createRowCounterRef.current++, width_mm: outputWidthMm || '', weight_kg: '', length_m: '' },
        ]);
    };

    const removeSplitRow = (id: number) => {
        setSplitRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)));
    };

    const removeCreateRollRow = (id: number) => {
        setCreateRollRows((prev) => prev.filter((row) => row.id !== id));
    };

    const updateSplitRow = (id: number, key: 'width_mm' | 'weight_kg', value: string) => {
        setSplitRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    };

    const updateCreateRollRow = (id: number, key: 'width_mm' | 'weight_kg' | 'length_m', value: string) => {
        setCreateRollRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    };

    const handleOutputWeightChange = (value: string) => {
        setOutputWeightDirty(true);
        let nextValue = value;
        const parsed = toNumber(value, NaN);
        if (
            Number.isFinite(parsed) &&
            parsed > 0 &&
            currentInputForm === 'ROLL' &&
            maxOutputWithScrapKg > 0 &&
            parsed > maxOutputWithScrapKg
        ) {
            nextValue = maxOutputWithScrapKg.toFixed(3);
        }
        setOutputWeightKg(nextValue);
        if (!showPcsEntry) return;
        if (outputEntryMode !== 'KG') return;
        if (unitWeightG <= 0) return;
        const kg = toNumber(nextValue, NaN);
        if (!Number.isFinite(kg) || kg <= 0) {
            setOutputPcs('');
            return;
        }
        const derivedPcs = Math.max(1, Math.round((kg * 1000) / unitWeightG));
        setOutputPcs(String(derivedPcs));
    };

    const handleOutputPcsChange = (value: string) => {
        setOutputPcs(value);
        if (!showPcsEntry) return;
        if (outputEntryMode !== 'PCS') return;
        if (unitWeightG <= 0) return;
        const pcs = toNumber(value, NaN);
        if (!Number.isFinite(pcs) || pcs <= 0) {
            setOutputWeightKg('');
            return;
        }
        let derivedKg = (Math.round(pcs) * unitWeightG) / 1000;
        if (currentInputForm === 'ROLL' && maxOutputWithScrapKg > 0 && derivedKg > maxOutputWithScrapKg) {
            derivedKg = maxOutputWithScrapKg;
            const cappedPcs = Math.max(1, Math.round((derivedKg * 1000) / unitWeightG));
            setOutputPcs(String(cappedPcs));
        }
        setOutputWeightDirty(false);
        setOutputWeightKg(derivedKg.toFixed(3));
    };

    const refreshAll = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['machine-queue', machineId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-detail', machineId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-job-context', machineId, selectedId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-history', machineId] }),
        ]);
    };

    const startMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.startJob(machineId, String(selectedJob.id));
        },
        onSuccess: async () => {
            toast({ title: 'Job started', description: 'Machine execution started.' });
            await refreshAll();
        },
        onError: (err: any) => {
            toast({
                variant: 'destructive',
                title: 'Start failed',
                description: err?.response?.data?.error || err?.message || 'Unable to start job.',
            });
        },
    });

    const stopMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.stopJob(machineId, String(selectedJob.id), stopReason || undefined);
        },
        onSuccess: async () => {
            toast({ title: 'Job stopped', description: 'Machine execution paused.' });
            await refreshAll();
        },
        onError: (err: any) => {
            toast({
                variant: 'destructive',
                title: 'Stop failed',
                description: err?.response?.data?.error || err?.message || 'Unable to stop job.',
            });
        },
    });

    const logOutputMutation = useMutation({
        mutationFn: async (draft?: { scrapInputValue?: string | null; scrapEntryMode?: 'KG' | 'PCS' }) => {
            if (!selectedJob) throw new Error('Select a job first.');

            const payload: {
                actual_qty: number;
                output_width_mm?: number;
                output_length_m?: number;
                output_pcs?: number;
                scrap_qty?: number;
                roll_outputs?: Array<{ width_mm: number; weight_kg: number; length_m?: number }>;
                split_outputs?: Array<{ width_mm: number; weight_kg: number }>;
                remainder_location_id?: string;
            } = {
                actual_qty: 0,
            };

            const resolvedScrapValue = (() => {
                const liveInput = draft?.scrapInputValue ?? scrapInputRef.current?.value;
                const liveMode = draft?.scrapEntryMode || scrapEntryMode;
                if (typeof liveInput === 'string' && liveInput.trim().length > 0) {
                    if (liveMode === 'PCS') {
                        const pcs = Math.max(0, toNumber(liveInput, 0));
                        if (pcs <= 0 || unitWeightG <= 0) return 0;
                        return (pcs * unitWeightG) / 1000;
                    }
                    return Math.max(0, toNumber(liveInput, 0));
                }
                return scrapValue;
            })();
            payload.scrap_qty = resolvedScrapValue;

            if (remainderLocationId && remainderLocationId !== DEFAULT_REMAINDER) {
                payload.remainder_location_id = remainderLocationId;
            }

            if (behavior === 'SPLIT') {
                if (!splitRowsParsed.length) {
                    throw new Error('Add at least one split row (width + weight).');
                }
                if (splitTotalKg > (maxOutputWithScrapKg + 0.001)) {
                    throw new Error(`Output exceeds physical max for this log (${maxOutputWithScrapKg.toFixed(3)} kg).`);
                }
                payload.split_outputs = splitRowsParsed.map((row) => ({ width_mm: row.width_mm, weight_kg: row.weight_kg }));
                payload.actual_qty = splitTotalKg;
            } else {
                if (behavior === 'CREATE_NEW' && createRollRowsParsed.length > 1) {
                    if (createRollTotalKg > (maxOutputWithScrapKg + 0.001)) {
                        throw new Error(`Output exceeds physical max for this log (${maxOutputWithScrapKg.toFixed(3)} kg).`);
                    }
                    payload.roll_outputs = createRollRowsParsed.map((row) => ({
                        width_mm: row.width_mm,
                        weight_kg: row.weight_kg,
                        ...(row.length_m !== null && row.length_m > 0 ? { length_m: row.length_m } : {}),
                    }));
                    payload.actual_qty = createRollTotalKg;
                    return machineService.logOutput(machineId, String(selectedJob.id), payload);
                }

                let qty = toNumber(outputWeightKg, NaN);
                if (showPcsEntry) {
                    const pcsInput = toNumber(outputPcs, NaN);
                    const hasPcs = Number.isFinite(pcsInput) && pcsInput > 0;
                    const roundedPcs = hasPcs ? Math.max(1, Math.round(pcsInput)) : null;

                    if (outputEntryMode === 'PCS') {
                        if (!hasPcs) {
                            throw new Error('Output PCS is required for PCS-led output entry.');
                        }
                        if (unitWeightG <= 0) {
                            throw new Error('Unit weight is required to convert output PCS to KG for this step.');
                        }
                        qty = (roundedPcs! * unitWeightG) / 1000;
                    }

                    if (!Number.isFinite(qty) || qty <= 0) {
                        if (hasPcs && unitWeightG > 0) {
                            qty = (roundedPcs! * unitWeightG) / 1000;
                        } else {
                            throw new Error('Output weight must be greater than zero.');
                        }
                    }

                    if (outputEntryMode === 'KG') {
                        if (hasPcs) {
                            payload.output_pcs = roundedPcs!;
                        } else if (unitWeightG > 0) {
                            payload.output_pcs = Math.max(1, Math.round((qty * 1000) / unitWeightG));
                        } else {
                            throw new Error('Output PCS is required when unit weight conversion is unavailable.');
                        }
                    } else if (hasPcs) {
                        payload.output_pcs = roundedPcs!;
                    } else {
                        throw new Error('Output PCS is required for bulk-output execution.');
                    }
                } else {
                    if (!Number.isFinite(qty) || qty <= 0) {
                        throw new Error('Output weight must be greater than zero.');
                    }
                }
                if (qty > (maxOutputWithScrapKg + 0.001)) {
                    throw new Error(`Output exceeds physical max for this log (${maxOutputWithScrapKg.toFixed(3)} kg).`);
                }

                payload.actual_qty = qty;
            }

            if (behavior === 'CREATE_NEW') {
                const width = toNumber(outputWidthMm, NaN);
                if (!Number.isFinite(width) || width <= 0) {
                    throw new Error('Output width is required for CREATE_NEW.');
                }
                payload.output_width_mm = width;

                if (outputLengthM.trim()) {
                    const length = toNumber(outputLengthM, NaN);
                    if (!Number.isFinite(length) || length < 0) {
                        throw new Error('Output length must be zero or positive.');
                    }
                    payload.output_length_m = length;
                }
            }

            return machineService.logOutput(machineId, String(selectedJob.id), payload);
        },
        onSuccess: async () => {
            toast({ title: 'Output logged', description: 'Physics applied and progress updated.' });
            await refreshAll();
        },
        onError: (err: any) => {
            toast({
                variant: 'destructive',
                title: 'Log output failed',
                description: err?.response?.data?.error || err?.message || 'Unable to log output.',
            });
        },
    });

    const completeMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            const confirmationPayload = reconcilableBulkRows
                .map((row: any) => {
                    const requirementId = String(row?.requirement_id || '');
                    const draft = materialConfirmations[requirementId];
                    if (!requirementId || !draft) return null;
                    const issued = Math.max(0, toNumber(draft.actual_issued_qty, 0));
                    const returned = Math.max(0, toNumber(draft.actual_returned_qty, 0));
                    const scrap = Math.max(0, toNumber(draft.actual_scrap_qty, 0));
                    const granuleCodeAllocations = (draft.granule_code_allocations || [])
                        .map((allocation) => ({
                            granule_code_id: allocation.granule_code_id,
                            qty_kg: Math.max(0, toNumber(allocation.qty_kg, 0)),
                        }))
                        .filter((allocation) => allocation.granule_code_id && allocation.qty_kg > 0);
                    return {
                        requirement_id: requirementId,
                        material_id: draft.material_id,
                        actual_issued_qty: issued,
                        actual_returned_qty: returned,
                        actual_scrap_qty: scrap,
                        is_estimated: draft.is_estimated,
                        return_mode: draft.return_mode || 'EXACT_COLOR_RETURN',
                        target_ink_material_id: draft.return_mode === 'REMIXED_RETURN' ? draft.target_ink_material_id : undefined,
                        granule_code_allocations: granuleCodeAllocations.length ? granuleCodeAllocations : undefined,
                    };
                })
                .filter(Boolean) as Array<{
                    requirement_id: string;
                    material_id?: string;
                    actual_issued_qty: number;
                    actual_returned_qty: number;
                    actual_scrap_qty: number;
                    is_estimated?: boolean;
                    return_mode?: 'EXACT_COLOR_RETURN' | 'REMIXED_RETURN';
                    target_ink_material_id?: string;
                    granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: number }>;
                }>;
            const payload =
                forceReason.trim() || confirmationPayload.length
                    ? {
                          force_reason: forceReason.trim() || undefined,
                          material_confirmations: confirmationPayload,
                      }
                    : undefined;
            return machineService.completeJob(machineId, String(selectedJob.id), payload);
        },
        onSuccess: async (data) => {
            const forced = data?.completion_mode === 'FORCED_VARIANCE';
            toast({
                title: forced ? 'Step force-completed' : 'Step completed',
                description: forced
                    ? `Closed with variance ${toNumber(data?.variance_kg, 0).toFixed(3)} kg.`
                    : 'Step closed and routing advanced.',
            });

            const dc = data?.interplant_dc;
            if (dc?.id && dc?.print_pdf_url) {
                const printUrl = `/inter-plant/print/${dc.id}`;
                const popup = window.open(printUrl, '_blank', 'noopener,noreferrer');
                if (!popup) {
                    toast({ title: 'Popup blocked', description: `Open this link to print DC: ${printUrl}` });
                }
            }

            await refreshAll();
        },
        onError: (err: any) => {
            toast({
                variant: 'destructive',
                title: 'Complete failed',
                description: err?.response?.data?.error || err?.message || 'Unable to complete step.',
            });
        },
    });

    useEffect(() => {
        setMaterialConfirmations((prev) => {
            const next: Record<string, MaterialConfirmationDraft> = { ...prev };
            const activeIds = new Set<string>();
            let changed = false;
            for (const row of reconcilableBulkRows) {
                const requirementId = String(row?.requirement_id || '').trim();
                if (!requirementId) continue;
                activeIds.add(requirementId);
                if (!next[requirementId]) {
                    const estimated = toNumber(
                        row?.actual_issued_qty_kg ?? row?.estimated_actual_qty_kg ?? row?.actual_consumed_qty_kg,
                        0
                    );
                    const codeOptions = Array.isArray(row?.granule_code_options) ? row.granule_code_options : [];
                    next[requirementId] = {
                        requirement_id: requirementId,
                        material_id: row?.material_id ? String(row.material_id) : undefined,
                        actual_issued_qty: estimated > 0 ? estimated.toFixed(3) : '',
                        actual_returned_qty: toNumber(row?.actual_returned_qty_kg, 0).toFixed(3),
                        actual_scrap_qty: toNumber(row?.actual_scrap_qty_kg, 0).toFixed(3),
                        is_estimated: true,
                        return_mode: 'EXACT_COLOR_RETURN',
                        target_ink_material_id: '',
                        granule_code_allocations:
                            String(row?.category || '').toUpperCase() === 'GRANULE' && codeOptions.length > 0
                                ? [{ granule_code_id: String(codeOptions[0].granule_code_id), qty_kg: estimated > 0 ? estimated.toFixed(3) : '' }]
                                : [],
                    };
                    changed = true;
                }
            }
            for (const key of Object.keys(next)) {
                if (!activeIds.has(key)) {
                    delete next[key];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [reconcilableBulkRows]);

    const updateMaterialConfirmation = (requirementId: string | number, patch: Partial<MaterialConfirmationDraft>) => {
        const key = String(requirementId || "").trim();
        if (!key) return;
        setMaterialConfirmations((prev) => {
            const current = prev[key];
            if (!current) return prev;
            return {
                ...prev,
                [key]: {
                    ...current,
                    ...patch,
                    is_estimated: patch.is_estimated ?? current.is_estimated,
                },
            };
        });
    };

    if (!machineId) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-6 text-sm text-red-600">Missing machine id in route.</CardContent>
                </Card>
            </div>
        );
    }

    if (machineLoading || queueLoading) {
        return (
            <div className="p-6">
                <Card>
                    <CardContent className="p-8 text-center text-slate-500">Loading machine terminal...</CardContent>
                </Card>
            </div>
        );
    }

    if (machineError || queueError) {
        return (
            <div className="p-6">
                <Card className="border-red-200">
                    <CardContent className="p-6 flex items-start gap-3 text-red-600">
                        <AlertCircle className="h-5 w-5 mt-0.5" />
                        <div>
                            <div className="font-semibold">Failed to load machine terminal</div>
                            <div className="text-sm text-red-500">Refresh and try again.</div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div
            className="relative min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.12),_transparent_28%),linear-gradient(180deg,#fbfdff_0%,#f6f7fb_100%)] transition-colors duration-1000"
            data-testid="machine-execution-page"
        >
            {/* Ambient Background Glow */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute top-[-20%] right-[-10%] h-3/4 w-3/4 rounded-full bg-blue-400/8 blur-[160px]" />
                <div className="absolute bottom-[10%] left-[-15%] h-2/3 w-2/3 rounded-full bg-indigo-500/8 blur-[140px]" />
            </div>

            <div className="relative z-10 p-6 space-y-6 max-w-[1600px] mx-auto">
                {/* Header Card */}
                <Card className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/92 shadow-[0_28px_74px_-52px_rgba(15,23,42,0.24)]">
                    <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-blue-600 to-indigo-600" />
                    <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                            <div className="space-y-1">
                                <div className="flex items-center gap-3">
                                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                                        <Server className="h-8 w-8 text-blue-600" />
                                        {machineDetail?.machine?.name || 'Machine Terminal'}
                                    </h1>
                                    <SemanticBadge
                                        kind="jobState"
                                        value={isActive ? "READY" : "BLOCKED"}
                                        label={machineDetail?.machine?.status || 'OFFLINE'}
                                        className="rounded-full px-3 py-1 text-[10px]"
                                    />
                                </div>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                                        <span>Operator: <span className="text-slate-900">{machineDetail?.operator?.name || 'Unassigned'}</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                                        <span>Template: <span className="text-blue-600">{context?.display?.template_name || selectedJob?.template_name || selectedJob?.product_name || '—'}</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-1 h-1 rounded-full bg-slate-300" />
                                        <span>Current Step: <span className="text-indigo-600">{context?.display?.step_name || context?.current_step?.process_name || '—'}</span></span>
                                    </div>
                                </div>
                                <div className="pt-2 text-sm text-slate-500">
                                    Keep one job active, log only current-step output, and let the execution plane carry output, scrap, remainder, and material truth.
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <div className="flex flex-col items-end mr-4">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Flow type</span>
                                    <Badge variant="outline" className="rounded-lg bg-slate-50 border-slate-200 px-3 py-1 font-black text-blue-700">
                                        {behaviorDisplay}
                                    </Badge>
                                </div>
                                <Button
                                    variant="outline"
                                    className="rounded-xl border-slate-200 shadow-sm hover:bg-slate-50 hover:text-blue-600 transition-all font-bold text-xs h-11 px-5"
                                    onClick={() => router.push('/production/machine-selector')}
                                >
                                    <Settings2 className="h-4 w-4 mr-2" />
                                    SWITCH MACHINE
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'execution' | 'history')} className="space-y-6 relative">
                    <TabsList className="h-12 rounded-2xl border border-slate-200/80 bg-white/92 p-1 shadow-sm">
                        <TabsTrigger value="execution" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md transition-all">
                            <Settings2 className="h-4 w-4 mr-2" />
                            RUN JOB
                        </TabsTrigger>
                        <TabsTrigger value="history" className="rounded-xl px-6 font-bold text-xs data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md transition-all">
                            <History className="h-4 w-4 mr-2" />
                            PAST JOBS
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="execution" className="space-y-6 mt-0 outline-none animate-in fade-in duration-500">
                        {/* Horizontal Job Queue */}
                        <Card className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-white/92 shadow-[0_20px_56px_-44px_rgba(15,23,42,0.2)]">
                            <CardHeader className="py-3 px-6 border-b border-white/20 bg-white/10">
                                <CardTitle className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] flex items-center justify-between">
                                    <span>Live Job Queue ({safeQueueItems.length})</span>
                                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100 font-bold tracking-widest lowercase">
                                        <div className="w-1 h-1 rounded-full bg-blue-500 animate-pulse" />
                                        polling...
                                    </div>
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 flex gap-4 overflow-x-auto scrollbar-hide">
                                {safeQueueItems.length === 0 && (
                                    <div className="flex w-full flex-col items-center justify-center gap-3 rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50/70 px-6 py-7 text-slate-400">
                                        <Layers className="h-8 w-8 opacity-20" />
                                        <span className="text-xs font-bold uppercase tracking-widest">No released jobs are waiting here.</span>
                                        <span className="max-w-md text-center text-[11px] font-semibold leading-5 text-slate-500">
                                            Release work from the WCM deck or switch machines if another terminal already owns the active queue.
                                        </span>
                                        <div className="mt-1 flex flex-wrap justify-center gap-2">
                                            <Button variant="outline" size="sm" className="rounded-xl border-slate-200 bg-white text-[10px] font-black uppercase tracking-[0.18em]" onClick={() => router.push('/dashboard/work-center')}>
                                                Open WCM Deck
                                            </Button>
                                            <Button variant="outline" size="sm" className="rounded-xl border-slate-200 bg-white text-[10px] font-black uppercase tracking-[0.18em]" onClick={() => router.push('/production/machine-selector')}>
                                                Change Machine
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {safeQueueItems.map((job) => {
                                    const isSelected = String(job.id) === String(selectedId);
                                    const isRunning = String(job.job_state).toUpperCase() === 'EXECUTING';
                                    const queueExecutionVersion = toNumber((job as any).execution_model_version, 1);
                                    const orderTargetKgRaw = toNumber(
                                        (job as any).order_reference_target_kg,
                                        toNumber(
                                        (job as any).step_adjusted_total_kg,
                                        toNumber(
                                            (job as any).total_weight_kg,
                                            String(job?.uom || '').toUpperCase() === 'KG' ? toNumber(job?.quantity, 0) : 0
                                        )
                                        )
                                    );
                                    const stepTargetKg = toNumber(
                                        (job as any).step_target_kg,
                                        String(job?.uom || '').toUpperCase() === 'KG' ? toNumber(job?.quantity, 0) : 0
                                    );
                                    const orderTargetKg = queueExecutionVersion >= 2
                                        ? Math.max(orderTargetKgRaw, 0)
                                        : Math.max(orderTargetKgRaw, stepTargetKg);
                                    const showQueuePcs = String(job?.output_form || '').toUpperCase() === 'BULK';
                                    const orderTargetPcs = (() => {
                                        if (!showQueuePcs) return null;
                                        if (String(job?.uom || '').toUpperCase() === 'PCS') {
                                            return toNumber(job?.quantity, 0);
                                        }
                                        const unitWeight = toNumber((job as any)?.unit_weight_g, 0);
                                        if (unitWeight > 0 && orderTargetKg > 0) {
                                            return (orderTargetKg * 1000) / unitWeight;
                                        }
                                        return null;
                                    })();

                                    return (
                                        <button
                                            key={job.id}
                                            onClick={() => setSelectedJobId(String(job.id))}
                                            data-testid={`machine-job-card-${job.id}`}
                                            className={cn(
                                                "group relative min-w-[280px] text-left rounded-2xl border transition-all duration-500 p-4",
                                                isSelected
                                                    ? "border-blue-400/50 bg-white/80 shadow-[0_20px_40px_-15px_rgba(59,130,246,0.3)] -translate-y-2"
                                                    : "border-white/20 bg-white/20 backdrop-blur-sm hover:border-white/40 hover:bg-white/40 hover:shadow-xl hover:-translate-y-1"
                                            )}
                                        >
                                            <div className="flex items-center justify-between mb-3">
                                                <div className={cn(
                                                    "text-sm font-black tracking-tight transition-colors",
                                                    isSelected ? "text-blue-600" : "text-slate-900"
                                                )}>
                                                    {job.job_number}
                                                </div>
                                                <SemanticBadge kind="jobState" value={job.job_state} label={job.job_state || "Queued"} className="text-[9px] px-2 py-1" />
                                            </div>
                                            <div className="text-[11px] font-black text-slate-900 truncate mb-1">
                                                {job.template_name || job.product_name}
                                            </div>
                                            <div className="flex items-center justify-between mt-4 bg-slate-50/50 rounded-xl px-3 py-2 border border-slate-100/50">
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] font-black text-blue-600 uppercase tracking-wider mt-1">
                                                        Step Target {stepTargetKg.toFixed(2)} KG
                                                    </span>
                                                    <span className="text-[8px] font-black text-slate-400 tracking-widest uppercase mt-1">Order Target (Route)</span>
                                                    <span className="text-[10px] font-bold text-slate-600">{orderTargetKg.toFixed(2)} KG</span>
                                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-wider">
                                                        {String((job as any).order_target_source || 'V2_ORDER_REFERENCE')}
                                                    </span>
                                                    {orderTargetPcs !== null && (
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                                            {orderTargetPcs.toFixed(1)} PCS
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[8px] font-black text-slate-400 tracking-widest uppercase">Priority</span>
                                                    <div className="flex items-center gap-1">
                                                        {[1, 2, 3].map((p) => (
                                                            <div key={p} className={cn("w-1.5 h-1.5 rounded-full", p <= 2 ? "bg-amber-400" : "bg-slate-200")} />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            {isSelected && (
                                                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-1 bg-blue-500 rounded-t-full shadow-[0_-4px_10px_rgba(59,130,246,0.5)]" />
                                            )}
                                        </button>
                                    );
                                })}
                            </CardContent>
                        </Card>

                        <Card className="border border-blue-100 bg-[linear-gradient(135deg,#ffffff_0%,#eef6ff_100%)] shadow-[0_20px_56px_-44px_rgba(37,99,235,0.16)]">
                            <CardContent className={cn("grid gap-3 p-4", selectedJob ? "md:grid-cols-[1.2fr_repeat(4,1fr)]" : "lg:grid-cols-[1.15fr_1fr_1fr]")}>
                                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">Kiosk focus for operators</div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-700">Next action now</div>
                                    <div className="mt-2 text-base font-black text-slate-900">{operatorNextStep}</div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <SemanticBadge kind="jobState" value={jobState || "PENDING"} label={jobState || "No job"} className="text-[10px]" />
                                        <SemanticBadge kind="jobState" value={isActive ? "READY" : "BLOCKED"} label={isActive ? "Machine ready" : "Machine offline"} className="text-[10px]" />
                                    </div>
                                </div>
                                {selectedJob ? (
                                    [
                                        "Select job",
                                        "1. Pick the job.",
                                        "2. Start or pause safely.",
                                        "3. Enter output and scrap.",
                                        "4. Finalize when the step target is complete.",
                                    ].map((step) => (
                                        <div key={step} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                                            {step}
                                        </div>
                                    ))
                                ) : (
                                    <>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Operator contract</div>
                                            <div className="mt-2 text-sm font-black text-slate-900">Pick one released job, then keep all output and material truth inside the active execution plane.</div>
                                            <div className="mt-2 text-xs leading-5 text-slate-500">This terminal stays step-aware. Output, scrap, WIP routing, and ink/material actuals only expand once a live job is selected.</div>
                                        </div>
                                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">What appears next</div>
                                            <div className="mt-2 space-y-2 text-sm font-semibold text-slate-700">
                                                <div>1. Released queue job</div>
                                                <div>2. Step target and remaining</div>
                                                <div>3. Output, scrap, and material actuals</div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        <div className="grid grid-cols-12 gap-6 relative">
                            {/* Column 1: Material Inputs */}
                            <Card className={cn(
                                "col-span-4 flex flex-col overflow-hidden rounded-[2.5rem] border border-slate-200/80 bg-white/92 shadow-[0_22px_64px_-48px_rgba(15,23,42,0.22)] transition-all duration-500",
                                selectedJob ? "h-[calc(100vh-320px)]" : "min-h-[420px]"
                            )}>
                                <CardHeader className="py-4 px-6 border-b border-slate-100 bg-slate-50/50">
                                    <CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                        <Package className="h-4 w-4 text-blue-600" />
                                        Material Feed
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 space-y-8 overflow-y-auto scrollbar-hide flex-1">
                                    {!selectedJob ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3 rounded-[1.8rem] border border-dashed border-slate-200 bg-slate-50/60 px-4">
                                            <div className="p-4 rounded-full bg-slate-50">
                                                <Package className="h-8 w-8 opacity-20" />
                                            </div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Pick a queue job</p>
                                            <p className="max-w-xs text-center text-[11px] font-semibold leading-5 text-slate-500">
                                                Reserved rolls, WIP pool, and requirement-aware material prompts appear here as soon as one live job is selected.
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Reserved Rolls */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Reserved Rolls</h4>
                                                    <SemanticBadge kind="jobState" value={reservedRolls.length > 0 ? "ASSIGNED" : "PENDING"} label={`${reservedRolls.length} items`} className="text-[9px]" />
                                                </div>
                                                <div className="grid gap-3">
                                                    {reservedRolls.map((roll: any) => (
                                                        <div key={roll.id} className="p-3 rounded-2xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow group">
                                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                                <div className="font-black text-slate-800 text-xs tracking-tight group-hover:text-blue-600 transition-colors">
                                                                    {roll.label_id}
                                                                </div>
                                                                <div className="flex flex-col items-end">
                                                                    <span className="text-[11px] font-black text-slate-900">{toNumber(roll.weight_kg, 0).toFixed(2)} KG</span>
                                                                    <span className="text-[9px] font-bold text-slate-400 tracking-tighter uppercase line-clamp-1 truncate max-w-[120px]">{roll.variant}</span>
                                                                </div>
                                                            </div>
                                                            <div className="text-[9px] font-semibold text-slate-500 mb-1">
                                                                ID: <span className="font-bold text-slate-700 break-all">{roll.id}</span>
                                                            </div>
                                                            <div className="text-[9px] font-semibold text-slate-500 mb-2 truncate">
                                                                {roll.location_name || '—'}
                                                            </div>
                                                            <div className="flex items-center gap-4 text-[9px] font-bold text-slate-500">
                                                                <span>{formatMm(roll.width_mm)}</span>
                                                                <span className="text-slate-200">•</span>
                                                                <span>{formatMicron(roll.thickness_micron)}</span>
                                                                <span className="text-slate-200">•</span>
                                                                <span className="text-blue-500">{roll.grade || '—'}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {reservedRolls.length === 0 && (
                                                        <div className="py-6 border border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center text-slate-300 gap-2">
                                                            <span className="text-[9px] font-bold uppercase tracking-widest">No Rolls Reserved</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Bulk Consumption */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Bulk Materials</h4>
                                                    <SemanticBadge kind="jobState" value={bulkPreview.length > 0 ? "READY" : "PENDING"} label={`${bulkPreview.length} active`} className="text-[9px]" />
                                                </div>
                                                <div className="grid gap-3">
                                                    {bulkPreview.map((req: any, idx: number) => (
                                                        <div key={req.material_id || idx} className="p-4 rounded-2xl bg-gradient-to-br from-white to-slate-50/50 border border-slate-100 shadow-sm group">
                                                            <div className="font-black text-slate-900 text-xs tracking-tight mb-2 uppercase group-hover:text-blue-600 transition-colors">
                                                                {req.material_name || req.category || 'Material'}
                                                            </div>
                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                                <div className="space-y-1">
                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Theoretical</span>
                                                                    <p className="text-xs font-black text-slate-800">{toNumber(req.theoretical_qty_kg ?? req.required_qty_kg, 0).toFixed(3)} KG</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Planned</span>
                                                                    <p className="text-xs font-black text-slate-800">{toNumber(req.planned_issue_qty_kg ?? req.required_qty_kg, 0).toFixed(3)} KG</p>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Estimated Actual</span>
                                                                    <p className="text-xs font-black text-slate-800">{toNumber(req.estimated_actual_qty_kg ?? req.actual_consumed_qty_kg ?? req.required_qty_kg, 0).toFixed(3)} KG</p>
                                                                </div>
                                                                <div className="space-y-1 text-right">
                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Capture</span>
                                                                    <Badge
                                                                        variant="outline"
                                                                        className={cn(
                                                                            "text-[8px] font-black uppercase",
                                                                            String(req.capture_mode || req.strategy || '').toUpperCase() === 'AUTO_ESTIMATED_CONFIRM'
                                                                                ? "bg-amber-50 border-amber-200 text-amber-700"
                                                                                : String(req.capture_mode || req.strategy || '').toUpperCase() === 'OPERATOR_REQUIRED'
                                                                                    ? "bg-rose-50 border-rose-200 text-rose-700"
                                                                                    : "bg-slate-100 border-slate-200"
                                                                        )}
                                                                    >
                                                                        {String(req.capture_mode || req.strategy || 'AUTO_FROM_OUTPUT').replace(/_/g, '-')}
                                                                    </Badge>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {reconcilableBulkRows.length > 0 && (
                                                        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50/50 space-y-4">
                                                            <div className="space-y-1">
                                                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
                                                                    Material Reconciliation
                                                                </div>
                                                                <div className="text-[10px] text-amber-800 font-semibold">
                                                                    Confirm or edit estimated actuals before step close. Materials on auto capture stay fully backend-managed.
                                                                </div>
                                                            </div>
                                                            <div className="grid gap-3">
                                                                {reconcilableBulkRows.map((req: any, idx: number) => {
                                                                    const requirementId = String(req?.requirement_id || "").trim()
                                                                    const draft = materialConfirmations[requirementId] || {
                                                                        actual_issued_qty: toNumber(req.estimated_actual_qty_kg ?? req.actual_consumed_qty_kg ?? req.required_qty_kg, 0).toFixed(3),
                                                                        actual_returned_qty: "0",
                                                                        actual_scrap_qty: "0",
                                                                        is_estimated: true,
                                                                        return_mode: "EXACT_COLOR_RETURN" as const,
                                                                        target_ink_material_id: "",
                                                                    }
                                                                    const estimate = toNumber(req.estimated_actual_qty_kg ?? req.actual_consumed_qty_kg ?? req.required_qty_kg, 0)
                                                                    const granuleCodeOptions = Array.isArray(req?.granule_code_options) ? req.granule_code_options : []
                                                                    const granuleAllocations =
                                                                        draft.granule_code_allocations && draft.granule_code_allocations.length > 0
                                                                            ? draft.granule_code_allocations
                                                                            : (String(req?.category || '').toUpperCase() === 'GRANULE' && granuleCodeOptions.length > 0
                                                                                ? [{ granule_code_id: String(granuleCodeOptions[0].granule_code_id), qty_kg: estimate > 0 ? estimate.toFixed(3) : '' }]
                                                                                : [])

                                                                    return (
                                                                        <div key={req.requirement_id || req.material_id || idx} className="rounded-2xl border border-amber-200 bg-white/90 p-4 space-y-3">
                                                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                                                <div>
                                                                                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-900">
                                                                                        {req.material_name || req.category || "Material"}
                                                                                    </div>
                                                                                    <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                                                                                        {String(req.capture_mode || req.strategy || "AUTO_ESTIMATED_CONFIRM").replace(/_/g, " ")}
                                                                                    </div>
                                                                                </div>
                                                                                <Button
                                                                                    type="button"
                                                                                    variant="outline"
                                                                                    size="sm"
                                                                                    className="h-8 rounded-xl border-amber-200 text-[10px] font-black uppercase tracking-widest"
                                                                                    onClick={() => updateMaterialConfirmation(requirementId, {
                                                                                        actual_issued_qty: estimate.toFixed(3),
                                                                                        actual_returned_qty: "0",
                                                                                        actual_scrap_qty: "0",
                                                                                        is_estimated: true,
                                                                                        return_mode: "EXACT_COLOR_RETURN",
                                                                                        target_ink_material_id: "",
                                                                                        granule_code_allocations:
                                                                                            String(req?.category || '').toUpperCase() === 'GRANULE' && granuleCodeOptions.length > 0
                                                                                                ? [{ granule_code_id: String(granuleCodeOptions[0].granule_code_id), qty_kg: estimate.toFixed(3) }]
                                                                                                : [],
                                                                                    })}
                                                                                    disabled={!requirementId}
                                                                                >
                                                                                    Use Estimate
                                                                                </Button>
                                                                            </div>
                                                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                                                <div className="space-y-1">
                                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Theoretical</span>
                                                                                    <p className="text-[11px] font-black text-slate-800">{toNumber(req.theoretical_qty_kg ?? req.required_qty_kg, 0).toFixed(3)} KG</p>
                                                                                </div>
                                                                                <div className="space-y-1">
                                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Planned</span>
                                                                                    <p className="text-[11px] font-black text-slate-800">{toNumber(req.planned_issue_qty_kg ?? req.required_qty_kg, 0).toFixed(3)} KG</p>
                                                                                </div>
                                                                                <div className="space-y-1">
                                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Estimated</span>
                                                                                    <p className="text-[11px] font-black text-slate-800">{estimate.toFixed(3)} KG</p>
                                                                                </div>
                                                                                <div className="space-y-1 text-right">
                                                                                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status</span>
                                                                                    <Badge
                                                                                        variant="outline"
                                                                                        className={cn(
                                                                                            "text-[8px] font-black uppercase",
                                                                                            draft.is_estimated
                                                                                                ? "bg-amber-50 border-amber-200 text-amber-700"
                                                                                                : "bg-emerald-50 border-emerald-200 text-emerald-700"
                                                                                        )}
                                                                                    >
                                                                                        {draft.is_estimated ? "Estimated" : "Confirmed"}
                                                                                    </Badge>
                                                                                </div>
                                                                            </div>
                                                                            <div className="grid gap-3 md:grid-cols-3">
                                                                                <div className="space-y-2">
                                                                                    <Label className="text-[9px] font-black uppercase text-slate-500 ml-1">
                                                                                        Issued (KG)
                                                                                    </Label>
                                                                                    <Input
                                                                                        data-testid={`machine-material-issued-${requirementId}`}
                                                                                        value={draft.actual_issued_qty}
                                                                                        onChange={(e) => updateMaterialConfirmation(requirementId, {
                                                                                            actual_issued_qty: e.target.value,
                                                                                            is_estimated: false,
                                                                                        })}
                                                                                        placeholder="0.000"
                                                                                        className="h-10 rounded-xl border-amber-200 bg-white font-bold"
                                                                                        disabled={!requirementId}
                                                                                    />
                                                                                </div>
                                                                                <div className="space-y-2">
                                                                                    <Label className="text-[9px] font-black uppercase text-slate-500 ml-1">
                                                                                        Returned (KG)
                                                                                    </Label>
                                                                                    <Input
                                                                                        data-testid={`machine-material-returned-${requirementId}`}
                                                                                        value={draft.actual_returned_qty}
                                                                                        onChange={(e) => updateMaterialConfirmation(requirementId, {
                                                                                            actual_returned_qty: e.target.value,
                                                                                            is_estimated: false,
                                                                                        })}
                                                                                        placeholder="0.000"
                                                                                        className="h-10 rounded-xl border-amber-200 bg-white font-bold"
                                                                                        disabled={!requirementId}
                                                                                    />
                                                                                </div>
                                                                                <div className="space-y-2">
                                                                                    <Label className="text-[9px] font-black uppercase text-slate-500 ml-1">
                                                                                        Scrap (KG)
                                                                                    </Label>
                                                                                    <Input
                                                                                        data-testid={`machine-material-scrap-${requirementId}`}
                                                                                        value={draft.actual_scrap_qty}
                                                                                        onChange={(e) => updateMaterialConfirmation(requirementId, {
                                                                                            actual_scrap_qty: e.target.value,
                                                                                            is_estimated: false,
                                                                                        })}
                                                                                        placeholder="0.000"
                                                                                        className="h-10 rounded-xl border-amber-200 bg-white font-bold"
                                                                                        disabled={!requirementId}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                            {String(req?.category || '').toUpperCase() === 'GRANULE' && (
                                                                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
                                                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                                                        <div>
                                                                                            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-800">
                                                                                                Granule vendor code issue
                                                                                            </div>
                                                                                            <p className="text-[10px] font-semibold text-emerald-900">
                                                                                                Split this material issue by vendor quality code for stock and consumption reporting.
                                                                                            </p>
                                                                                        </div>
                                                                                        <Button
                                                                                            type="button"
                                                                                            variant="outline"
                                                                                            size="sm"
                                                                                            className="h-8 rounded-xl border-emerald-200 bg-white text-[10px] font-black uppercase tracking-widest"
                                                                                            disabled={!requirementId || granuleCodeOptions.length === 0}
                                                                                            onClick={() => updateMaterialConfirmation(requirementId, {
                                                                                                granule_code_allocations: [
                                                                                                    ...granuleAllocations,
                                                                                                    { granule_code_id: String(granuleCodeOptions[0]?.granule_code_id || ''), qty_kg: '' },
                                                                                                ],
                                                                                                is_estimated: false,
                                                                                            })}
                                                                                        >
                                                                                            <Plus className="mr-1 h-3 w-3" /> Add Code
                                                                                        </Button>
                                                                                    </div>
                                                                                    {granuleCodeOptions.length === 0 ? (
                                                                                        <div className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-[10px] font-bold text-amber-800">
                                                                                            No granule quality-code stock is available at the selected issue location. Inward this granule with a code first.
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="space-y-2">
                                                                                            {granuleAllocations.map((allocation, allocationIndex) => (
                                                                                                <div key={`${requirementId}-granule-code-${allocationIndex}`} className="grid gap-2 md:grid-cols-[1fr_140px_40px]">
                                                                                                    <Select
                                                                                                        value={allocation.granule_code_id || String(granuleCodeOptions[0]?.granule_code_id || '')}
                                                                                                        onValueChange={(value) => {
                                                                                                            const nextAllocations = granuleAllocations.map((row, rowIndex) =>
                                                                                                                rowIndex === allocationIndex ? { ...row, granule_code_id: value } : row
                                                                                                            )
                                                                                                            updateMaterialConfirmation(requirementId, {
                                                                                                                granule_code_allocations: nextAllocations,
                                                                                                                is_estimated: false,
                                                                                                            })
                                                                                                        }}
                                                                                                    >
                                                                                                        <SelectTrigger
                                                                                                            data-testid={`machine-granule-code-${requirementId}-${allocationIndex}`}
                                                                                                            className="h-10 rounded-xl border-emerald-200 bg-white font-bold text-[11px]"
                                                                                                        >
                                                                                                            <SelectValue placeholder="Select granule code" />
                                                                                                        </SelectTrigger>
                                                                                                        <SelectContent>
                                                                                                            {granuleCodeOptions.map((option: any) => (
                                                                                                                <SelectItem key={`${requirementId}-${option.granule_code_id}`} value={String(option.granule_code_id)}>
                                                                                                                    {option.code}
                                                                                                                    {option.vendor_name ? ` / ${option.vendor_name}` : ''}
                                                                                                                    {` / ${toNumber(option.available_qty_kg, 0).toFixed(3)} kg`}
                                                                                                                </SelectItem>
                                                                                                            ))}
                                                                                                        </SelectContent>
                                                                                                    </Select>
                                                                                                    <Input
                                                                                                        data-testid={`machine-granule-code-qty-${requirementId}-${allocationIndex}`}
                                                                                                        value={allocation.qty_kg}
                                                                                                        onChange={(e) => {
                                                                                                            const nextAllocations = granuleAllocations.map((row, rowIndex) =>
                                                                                                                rowIndex === allocationIndex ? { ...row, qty_kg: e.target.value } : row
                                                                                                            )
                                                                                                            updateMaterialConfirmation(requirementId, {
                                                                                                                granule_code_allocations: nextAllocations,
                                                                                                                is_estimated: false,
                                                                                                            })
                                                                                                        }}
                                                                                                        placeholder="KG"
                                                                                                        className="h-10 rounded-xl border-emerald-200 bg-white font-bold"
                                                                                                    />
                                                                                                    <Button
                                                                                                        type="button"
                                                                                                        variant="ghost"
                                                                                                        size="icon"
                                                                                                        className="h-10 w-10 rounded-xl text-slate-500 hover:text-red-600"
                                                                                                        disabled={granuleAllocations.length <= 1}
                                                                                                        onClick={() => updateMaterialConfirmation(requirementId, {
                                                                                                            granule_code_allocations: granuleAllocations.filter((_, rowIndex) => rowIndex !== allocationIndex),
                                                                                                            is_estimated: false,
                                                                                                        })}
                                                                                                    >
                                                                                                        <Trash2 className="h-4 w-4" />
                                                                                                    </Button>
                                                                                                </div>
                                                                                            ))}
                                                                                            <div className="text-[10px] font-bold text-emerald-900">
                                                                                                Allocated {granuleAllocations.reduce((sum, row) => sum + toNumber(row.qty_kg, 0), 0).toFixed(3)} KG. It must match net consumed KG on close.
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            )}
                                                                            {String(req?.category || '').toUpperCase() === 'INK' && (
                                                                                <div className="grid gap-3 md:grid-cols-2">
                                                                                    <div className="space-y-2">
                                                                                        <Label className="text-[9px] font-black uppercase text-slate-500 ml-1">
                                                                                            Ink Return Mode
                                                                                        </Label>
                                                                                        <Select
                                                                                            value={draft.return_mode || "EXACT_COLOR_RETURN"}
                                                                                            onValueChange={(value) =>
                                                                                                updateMaterialConfirmation(requirementId, {
                                                                                                    return_mode: value as 'EXACT_COLOR_RETURN' | 'REMIXED_RETURN',
                                                                                                    target_ink_material_id:
                                                                                                        value === 'REMIXED_RETURN'
                                                                                                            ? draft.target_ink_material_id || ''
                                                                                                            : '',
                                                                                                    is_estimated: false,
                                                                                                })
                                                                                            }
                                                                                        >
                                                                                            <SelectTrigger
                                                                                                data-testid={`machine-material-return-mode-${requirementId}`}
                                                                                                className="h-10 rounded-xl border-amber-200 bg-white font-bold text-[11px]"
                                                                                            >
                                                                                                <SelectValue />
                                                                                            </SelectTrigger>
                                                                                            <SelectContent>
                                                                                                <SelectItem value="EXACT_COLOR_RETURN">Exact Color Return</SelectItem>
                                                                                                <SelectItem value="REMIXED_RETURN">Remixed Return</SelectItem>
                                                                                            </SelectContent>
                                                                                        </Select>
                                                                                    </div>
                                                                                    <div className="space-y-2">
                                                                                        <Label className="text-[9px] font-black uppercase text-slate-500 ml-1">
                                                                                            Remix Target Ink
                                                                                        </Label>
                                                                                        <Select
                                                                                            value={draft.target_ink_material_id || "__SAME__"}
                                                                                            onValueChange={(value) =>
                                                                                                updateMaterialConfirmation(requirementId, {
                                                                                                    target_ink_material_id: value === "__SAME__" ? "" : value,
                                                                                                    is_estimated: false,
                                                                                                })
                                                                                            }
                                                                                            disabled={(draft.return_mode || 'EXACT_COLOR_RETURN') !== 'REMIXED_RETURN'}
                                                                                        >
                                                                                            <SelectTrigger
                                                                                                data-testid={`machine-material-target-ink-${requirementId}`}
                                                                                                className="h-10 rounded-xl border-amber-200 bg-white font-bold text-[11px]"
                                                                                            >
                                                                                                <SelectValue placeholder="Select target ink" />
                                                                                            </SelectTrigger>
                                                                                            <SelectContent>
                                                                                                <SelectItem value="__SAME__">Same Ink (No Remix)</SelectItem>
                                                                                                {bulkPreview
                                                                                                    .filter((row: any) => String(row?.category || '').toUpperCase() === 'INK' && row?.material_id)
                                                                                                    .map((row: any) => (
                                                                                                        <SelectItem key={`ink-target-${row.material_id}`} value={String(row.material_id)}>
                                                                                                            {row.material_name || row.material_id}
                                                                                                        </SelectItem>
                                                                                                    ))}
                                                                                            </SelectContent>
                                                                                        </Select>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* WIP Pool */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">WIP Pool</h4>
                                                    <div className="flex items-center gap-2">
                                                        <Badge variant="outline" className="text-[9px] bg-indigo-50/50 border-indigo-100 text-indigo-600 font-bold uppercase">
                                                            {rollInputRequired ? 'POOL-IN' : 'CONTEXT'}
                                                        </Badge>
                                                        <Badge variant="outline" className="text-[9px] bg-slate-50 border-slate-200 text-slate-700 font-bold uppercase">
                                                            {totalLineageWeightKg.toFixed(2)} KG TOTAL
                                                        </Badge>
                                                    </div>
                                                </div>
                                                <div className="grid gap-3">
                                                    {!rollInputRequired && (
                                                        <div className="p-3 rounded-2xl bg-slate-50 border border-slate-100 text-[10px] text-slate-600 font-semibold">
                                                            WIP Pool is background-only for this step. Step output/consumption stays current-step only.
                                                        </div>
                                                    )}
                                                    {rollInputRequired && wipPool.length === 0 && (
                                                        <div className="p-3 rounded-2xl bg-rose-50 border border-rose-100 text-rose-700 space-y-2">
                                                            <div className="text-[10px] font-black uppercase tracking-widest">No Compatible WIP Rolls</div>
                                                            {(wipPoolMeta?.blocked_reasons || []).map((msg: string, idx: number) => (
                                                                <div key={`wip-block-${idx}`} className="text-[10px] font-semibold">{msg}</div>
                                                            ))}
                                                            {(wipPoolMeta?.action_hints || []).map((msg: string, idx: number) => (
                                                                <div key={`wip-hint-${idx}`} className="text-[10px] text-rose-600">{msg}</div>
                                                            ))}
                                                            <div className="flex gap-2 pt-1">
                                                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => router.push('/production/work-center')}>
                                                                    Open WCM
                                                                </Button>
                                                                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => router.push('/inventory/inter-plant')}>
                                                                    Open Inter-Plant
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {displayedWip.map((wip: any) => (
                                                        <div key={wip.id} className="p-3 rounded-2xl bg-indigo-50/30 border border-indigo-100/50 flex items-center justify-between group">
                                                            <div>
                                                                <div className="font-black text-indigo-900 text-xs tracking-tight uppercase">{wip.label_id}</div>
                                                                <div className="text-[9px] font-bold text-indigo-400/80 uppercase mt-0.5 tracking-tighter">{wip.variant || wip.material_name || '—'}</div>
                                                                <div className="text-[8px] font-semibold text-indigo-500/80 uppercase">{wip.stage || '—'}</div>
                                                                <div className="text-[8px] font-semibold text-indigo-500/80">
                                                                    {formatMm(wip.width_mm)} • {formatMicron(wip.thickness_micron)} • {wip.grade || 'NO GRADE'}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-xs font-black text-indigo-700">{toNumber(wip.weight_kg, 0).toFixed(2)} KG</span>
                                                                <div className="text-[9px] font-bold text-indigo-400 uppercase tracking-tighter truncate max-w-[150px]">
                                                                    {wip.location_name || '—'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {displayedWip.length === 0 && (
                                                        <div className="py-4 border border-dashed border-indigo-100 rounded-2xl text-center text-[10px] font-semibold text-indigo-400">
                                                            No lineage WIP rolls available.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Column 2: Production Controls */}
                            <Card className={cn(
                                "col-span-5 border border-white/20 shadow-2xl shadow-indigo-200/10 bg-white/40 backdrop-blur-2xl rounded-[3rem] overflow-hidden flex flex-col transition-all duration-700",
                                selectedJob ? "h-[calc(100vh-320px)]" : "min-h-[420px]"
                            )}>
                                <CardHeader className="py-4 px-6 border-b border-slate-100 bg-slate-50/50">
                                    <CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                        Execution workspace
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 space-y-6 overflow-y-auto scrollbar-hide flex-1">
                                    {!selectedJob ? (
                                        <div className="h-full flex flex-col items-center justify-center gap-3 rounded-[1.8rem] border border-dashed border-slate-200 bg-slate-50/60 px-4 text-slate-400">
                                            <div className="p-4 rounded-full bg-slate-50">
                                                <Play className="h-8 w-8 opacity-20" />
                                            </div>
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em]">Execution plane ready</p>
                                            <p className="max-w-xs text-center text-[11px] font-semibold leading-5 text-slate-500">
                                                Pick one live job and this plane becomes the only place the operator needs for start, pause, output, scrap, and close.
                                            </p>
                                            <div className="mt-3 grid w-full max-w-xl gap-2 md:grid-cols-3">
                                                {["1. Pick released job", "2. Start or resume", "3. Log output and actuals"].map((item) => (
                                                    <div key={item} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">
                                                        {item}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Main Job Context Card */}
                                            <Card className="border border-white/10 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white rounded-[2rem] overflow-hidden shadow-2xl shadow-indigo-900/20">
                                                <CardContent className="p-6 space-y-6">
                                                    <div className="flex items-start justify-between">
                                                        <div>
                                                            <div className="text-[10px] font-black text-blue-400 uppercase tracking-[0.3em] mb-1">Production Job</div>
                                                            <h2 className="text-3xl font-black tracking-tighter">{selectedJob.job_number}</h2>
                                                            <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider line-clamp-1">{context?.display?.template_name || selectedJob.template_name}</p>
                                                        </div>
                                                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 font-black uppercase tracking-widest text-[10px] px-3">
                                                            {behaviorDisplay}
                                                        </Badge>
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-4">
                                                        <div className="space-y-1">
                                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Target</span>
                                                            <div className="text-lg font-black">{primaryTarget !== null ? primaryTarget.toFixed(2) : '—'} <span className="text-[10px] text-slate-500 font-bold uppercase">KG</span></div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Produced</span>
                                                            <div className="text-lg font-black text-emerald-400">{primaryProduced !== null ? primaryProduced.toFixed(2) : '—'} <span className="text-[10px] text-emerald-500/50 font-bold uppercase">KG</span></div>
                                                        </div>
                                                        <div className="space-y-1 text-right">
                                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Balance</span>
                                                            <div className="text-lg font-black text-amber-400">{primaryRemaining !== null ? primaryRemaining.toFixed(2) : '—'} <span className="text-[10px] text-amber-500/50 font-bold uppercase">KG</span></div>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                                                            <span className="text-slate-500 text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">Step Progress</span>
                                                            <span className="text-white">{progressPct}%</span>
                                                        </div>
                                                        <div className="h-3 bg-white/5 rounded-full overflow-hidden p-[2px]">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 rounded-full transition-all duration-1000 shadow-[0_0_15px_rgba(59,130,246,0.5)]"
                                                                style={{ width: `${progressPct}%` }}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-2 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                                        <div>Exec V{executionVersion}</div>
                                                        <div className="truncate">Step Src: {stepTargetSource}</div>
                                                        <div className="truncate text-right">Order Src: {orderTargetSource}</div>
                                                    </div>
                                                </CardContent>
                                            </Card>

                                            <Card className={cn(
                                                "rounded-3xl border shadow-sm",
                                                emphasizeGeometry
                                                    ? "border-blue-200 bg-blue-50/70"
                                                    : "border-slate-200 bg-slate-50/70"
                                            )}>
                                                <CardContent className="p-4 space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Geometry Snapshot</Label>
                                                        {emphasizeGeometry && (
                                                            <Badge variant="outline" className="text-[9px] font-black uppercase bg-blue-100 border-blue-200 text-blue-700">
                                                                Roll → Bulk Focus
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3 text-[11px]">
                                                        <div className="rounded-2xl bg-white border border-slate-100 p-3">
                                                            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Base</div>
                                                            <div className="font-black text-slate-800 mt-1">
                                                                {baseWidthMm !== null ? baseWidthMm.toFixed(0) : '—'} mm × {baseHeightMm !== null ? baseHeightMm.toFixed(0) : '—'} mm
                                                            </div>
                                                            <div className="text-slate-500 mt-1">
                                                                Area {baseAreaM2 !== null ? baseAreaM2.toFixed(3) : '—'} m2
                                                            </div>
                                                        </div>
                                                        <div className="rounded-2xl bg-white border border-slate-100 p-3">
                                                            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Effective</div>
                                                            <div className="font-black text-slate-800 mt-1">
                                                                {effectiveWidthMm !== null ? effectiveWidthMm.toFixed(0) : '—'} mm × {effectiveHeightMm !== null ? effectiveHeightMm.toFixed(0) : '—'} mm
                                                            </div>
                                                            <div className="text-slate-500 mt-1">
                                                                Area {effectiveAreaM2 !== null ? effectiveAreaM2.toFixed(3) : '—'} m2 · POD {String(geometryCards?.pod_summary?.name || geometryCards?.pod_summary?.type || context?.job?.geometry?.pod?.name || 'None')}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {(geometryCards?.adjustments_summary || []).length > 0 && (
                                                        <div className="rounded-2xl bg-white border border-slate-100 p-3">
                                                            <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-2">Adjustments</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                {(geometryCards?.adjustments_summary || []).map((row: any, idx: number) => (
                                                                    <Badge key={`geo-adj-${idx}`} variant="outline" className="text-[9px] font-bold bg-slate-50 border-slate-200 text-slate-700">
                                                                        {row?.name || 'Adj'} {row?.value ?? ''}{row?.unit || ''}{row?.on ? ` on ${row.on}` : ''}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </CardContent>
                                            </Card>

                                            {/* Dynamic Output Entry Form */}
                                            <div className="space-y-4 rounded-[1.8rem] border border-slate-200/90 bg-white/70 p-4" data-testid="machine-output-panel">
                                                <div className="flex items-center justify-between gap-4 px-1">
                                                    <div>
                                                        <Label className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Output Entry</Label>
                                                        <div className="mt-1 text-[11px] font-semibold text-slate-500">Enter only the fields this step needs.</div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        data-testid="machine-stage-output"
                                                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500"
                                                    >
                                                        Output
                                                    </button>
                                                    {behavior === 'SPLIT' && (
                                                        <Button variant="ghost" size="sm" onClick={addSplitRow} className="h-7 text-[10px] font-black text-blue-600 hover:text-blue-700 hover:bg-blue-50 uppercase tracking-widest">
                                                            <Plus className="h-3 w-3 mr-1" /> Add Split
                                                        </Button>
                                                    )}
                                                    {behavior === 'CREATE_NEW' && (
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            data-testid="machine-add-create-row"
                                                            onClick={addCreateRollRow}
                                                            className="h-7 text-[10px] font-black text-blue-600 hover:text-blue-700 hover:bg-blue-50 uppercase tracking-widest"
                                                        >
                                                            <Plus className="h-3 w-3 mr-1" /> Add Output
                                                        </Button>
                                                    )}
                                                </div>
                                                {allocationRequired && (
                                                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">
                                                        <div className="font-black uppercase tracking-wider text-[10px]">Step 1 Allocation Policy</div>
                                                        <div className="mt-1">
                                                            Exactly one stage-0 purchasable roll must be reserved before start/log. Reserved now: <span className="font-black">{reservedRolls.length}</span>.
                                                        </div>
                                                    </div>
                                                )}

                                                {behavior === 'CREATE_NEW' && (
                                                    <div className="p-4 rounded-3xl bg-slate-50/50 border border-slate-100 space-y-4">
                                                        {showPcsEntry && (
                                                            <div className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 flex items-center justify-between gap-3">
                                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Output Entry Mode</div>
                                                                <div className="flex items-center gap-1">
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant={outputEntryMode === 'PCS' ? 'default' : 'outline'}
                                                                        className="h-7 rounded-xl text-[9px] font-black uppercase tracking-wider px-3"
                                                                        onClick={() => {
                                                                            setOutputEntryMode('PCS');
                                                                            setOutputWeightDirty(false);
                                                                        }}
                                                                    >
                                                                        PCS-led
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant={outputEntryMode === 'KG' ? 'default' : 'outline'}
                                                                        className="h-7 rounded-xl text-[9px] font-black uppercase tracking-wider px-3"
                                                                        onClick={() => setOutputEntryMode('KG')}
                                                                    >
                                                                        KG-led
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className="space-y-3">
                                                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3">
                                                                <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Output Roll 1</div>
                                                                <div className="grid grid-cols-2 gap-4">
                                                                    <div className="space-y-2">
                                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Width (MM)</Label>
                                                                        <Input
                                                                            data-testid="machine-create-row-width-0"
                                                                            value={outputWidthMm}
                                                                            onChange={(e) => {
                                                                                setOutputWidthDirty(true);
                                                                                setOutputWidthMm(e.target.value);
                                                                            }}
                                                                            placeholder="0.00"
                                                                            className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                        />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Weight (KG)</Label>
                                                                        <Input
                                                                            data-testid="machine-create-row-weight-0"
                                                                            value={outputWeightKg}
                                                                            onChange={(e) => handleOutputWeightChange(e.target.value)}
                                                                            placeholder="0.00"
                                                                            className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                        />
                                                                    </div>
                                                                </div>
                                                                {showPcsEntry && (
                                                                    <div className="space-y-2">
                                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Output PCS</Label>
                                                                        <Input
                                                                            data-testid="machine-output-pcs"
                                                                            value={outputPcs}
                                                                            onChange={(e) => handleOutputPcsChange(e.target.value)}
                                                                            placeholder="0"
                                                                            className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                        />
                                                                    </div>
                                                                )}
                                                                <div className="space-y-2">
                                                                    <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Output Length (M) <span className="text-[8px] font-medium opacity-50">(optional)</span></Label>
                                                                    <Input
                                                                        data-testid="machine-create-row-length-0"
                                                                        value={outputLengthM}
                                                                        onChange={(e) => setOutputLengthM(e.target.value)}
                                                                        placeholder="0.00"
                                                                        className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {createRollRows.map((row, index) => (
                                                                <div key={row.id} className="rounded-2xl border border-slate-200 bg-white/90 p-4 space-y-3">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">
                                                                            Output Roll {index + 2}
                                                                        </div>
                                                                        <Button
                                                                            type="button"
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            onClick={() => removeCreateRollRow(row.id)}
                                                                            className="h-9 w-9 rounded-2xl text-slate-300 hover:text-rose-500 hover:bg-rose-50"
                                                                        >
                                                                            <Trash2 className="h-4 w-4" />
                                                                        </Button>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-4">
                                                                        <div className="space-y-2">
                                                                            <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Width (MM)</Label>
                                                                            <Input
                                                                                data-testid={`machine-create-row-width-${index + 1}`}
                                                                                value={row.width_mm}
                                                                                onChange={(e) => updateCreateRollRow(row.id, 'width_mm', e.target.value)}
                                                                                placeholder="0.00"
                                                                                className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                            />
                                                                        </div>
                                                                        <div className="space-y-2">
                                                                            <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Weight (KG)</Label>
                                                                            <Input
                                                                                data-testid={`machine-create-row-weight-${index + 1}`}
                                                                                value={row.weight_kg}
                                                                                onChange={(e) => updateCreateRollRow(row.id, 'weight_kg', e.target.value)}
                                                                                placeholder="0.00"
                                                                                className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Output Length (M) <span className="text-[8px] font-medium opacity-50">(optional)</span></Label>
                                                                        <Input
                                                                            data-testid={`machine-create-row-length-${index + 1}`}
                                                                            value={row.length_m}
                                                                            onChange={(e) => updateCreateRollRow(row.id, 'length_m', e.target.value)}
                                                                            placeholder="0.00"
                                                                            className="h-11 rounded-2xl border-slate-200 font-bold shadow-sm"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        <div className="flex items-center justify-between rounded-2xl bg-blue-50/30 border border-blue-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-blue-600">
                                                            <span>Total Create-New Output</span>
                                                            <span>{createRollTotalKg.toFixed(3)} KG</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {(behavior === 'MODIFY_EXISTING' || behavior === 'MULTI_INPUT_COMBINE' || behavior === 'NONE') && (
                                                    <div className="p-4 rounded-3xl bg-slate-50/50 border border-slate-100 space-y-3">
                                                        {showPcsEntry && (
                                                            <div className="rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 flex items-center justify-between gap-3">
                                                                <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Output Entry Mode</div>
                                                                <div className="flex items-center gap-1">
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant={outputEntryMode === 'PCS' ? 'default' : 'outline'}
                                                                        className="h-7 rounded-xl text-[9px] font-black uppercase tracking-wider px-3"
                                                                        onClick={() => {
                                                                            setOutputEntryMode('PCS');
                                                                            setOutputWeightDirty(false);
                                                                        }}
                                                                    >
                                                                        PCS-led
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant={outputEntryMode === 'KG' ? 'default' : 'outline'}
                                                                        className="h-7 rounded-xl text-[9px] font-black uppercase tracking-wider px-3"
                                                                        onClick={() => setOutputEntryMode('KG')}
                                                                    >
                                                                        KG-led
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div className={cn("gap-4", showPcsEntry ? "grid grid-cols-2" : "grid grid-cols-1")}>
                                                            <div className="space-y-2">
                                                                <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Output Weight (KG)</Label>
                                                                <Input data-testid="machine-output-weight" value={outputWeightKg} onChange={(e) => handleOutputWeightChange(e.target.value)} placeholder="0.00" className="h-12 rounded-2xl border-slate-200 font-black text-lg shadow-sm" />
                                                            </div>
                                                            {showPcsEntry && (
                                                                <div className="space-y-2">
                                                                    <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">Output PCS</Label>
                                                                    <Input
                                                                    data-testid="machine-output-pcs"
                                                                    value={outputPcs}
                                                                        onChange={(e) => handleOutputPcsChange(e.target.value)}
                                                                        placeholder="0"
                                                                        className="h-12 rounded-2xl border-slate-200 font-black text-lg shadow-sm"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                        {showPcsEntry && (
                                                            <div className="mt-2 text-[10px] font-semibold text-slate-500">
                                                                {unitWeightG > 0
                                                                    ? (outputEntryMode === 'KG'
                                                                        ? 'KG-led auto-calculates PCS. You can still edit PCS before logging.'
                                                                        : 'PCS-led auto-calculates KG. Switch to KG-led to drive by weight and auto-derive PCS.')
                                                                    : 'Roll→Bulk requires operator PCS entry for every log.'}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {behavior === 'SPLIT' && (
                                                    <div className="space-y-3">
                                                        {splitRows.map((row) => (
                                                            <div key={row.id} className="grid grid-cols-[1fr_1.2fr_auto] gap-3 items-end animate-in fade-in slide-in-from-right-2">
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-[8px] font-black uppercase text-slate-400 ml-1">Width</Label>
                                                                    <Input value={row.width_mm} onChange={(e) => updateSplitRow(row.id, 'width_mm', e.target.value)} className="h-11 rounded-2xl font-bold border-slate-200" />
                                                                </div>
                                                                <div className="space-y-1.5">
                                                                    <Label className="text-[8px] font-black uppercase text-slate-400 ml-1">Weight</Label>
                                                                    <Input value={row.weight_kg} onChange={(e) => updateSplitRow(row.id, 'weight_kg', e.target.value)} className="h-11 rounded-2xl font-bold border-slate-200" />
                                                                </div>
                                                                <Button variant="ghost" size="icon" onClick={() => removeSplitRow(row.id)} className="h-11 w-11 rounded-2xl text-slate-300 hover:text-rose-500 hover:bg-rose-50">
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                        <div className="flex items-center justify-between p-3 rounded-2xl bg-blue-50/30 border border-blue-100 text-[10px] font-black uppercase tracking-widest text-blue-600">
                                                            <span>Calculated Total</span>
                                                            <span>{splitTotalKg.toFixed(2)} KG</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Scrap & Remainder */}
                                            <div className="p-4 rounded-3xl bg-rose-50/40 border border-rose-100 space-y-4">
                                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-600">
                                                    Scrap & Remainder
                                                </div>
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div className="space-y-2">
                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">
                                                            Scrap ({scrapEntryMode})
                                                        </Label>
                                                        <Select value={scrapEntryMode} onValueChange={(value) => setScrapEntryMode(value as 'KG' | 'PCS')}>
                                                            <SelectTrigger className="h-9 rounded-xl border-rose-200 bg-white font-bold text-[11px]">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="KG">KG</SelectItem>
                                                                <SelectItem value="PCS" disabled={unitWeightG <= 0}>PCS</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                            <Input
                                                                ref={scrapInputRef}
                                                                data-testid="machine-scrap-input"
                                                                value={scrapEntryMode === 'PCS' ? scrapPcs : scrapKg}
                                                            onChange={(e) => {
                                                                if (scrapEntryMode === 'PCS') {
                                                                    setScrapPcs(e.target.value);
                                                                    return;
                                                                }
                                                                setScrapKg(e.target.value);
                                                            }}
                                                            placeholder={scrapEntryMode === 'PCS' ? "0" : "0.000"}
                                                            className="h-11 rounded-2xl border-rose-200 bg-white font-bold shadow-sm"
                                                        />
                                                        {scrapEntryMode === 'PCS' ? (
                                                            <div className="text-[10px] text-rose-600 font-semibold">
                                                                Converted scrap weight: {scrapValue.toFixed(3)} KG.
                                                            </div>
                                                        ) : (
                                                            <div className="text-[10px] text-rose-600 font-semibold">
                                                                Roll-process scrap only. Bulk scrap is not operator-entered.
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <Label className="text-[9px] font-black uppercase text-slate-400 ml-1">
                                                            Remainder Destination
                                                        </Label>
                                                        <Select value={remainderLocationId} onValueChange={setRemainderLocationId}>
                                                            <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white font-semibold">
                                                                <SelectValue placeholder="Default (Current Plant RM Location)" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value={DEFAULT_REMAINDER}>Default (Current Plant RM Location)</SelectItem>
                                                                {remainderLocations.map((loc: any) => (
                                                                    <SelectItem key={String(loc.id)} value={String(loc.id)}>
                                                                        {loc.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <div className="text-[10px] text-slate-500 font-semibold">
                                                            Default keeps remainder in current plant RM. Override applies to this output log only.
                                                        </div>
                                                    </div>
                                                </div>
                                                {behavior === 'SPLIT' && splitRemainder !== null && (
                                                    <div className="rounded-2xl bg-white border border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                                                        <span>Calculated Split Remainder</span>
                                                        <span className="text-indigo-700">{splitRemainder.toFixed(3)} KG</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="rounded-2xl border border-blue-100 bg-blue-50/40 px-3 py-2">
                                                <div className="text-[9px] font-black uppercase tracking-[0.2em] text-blue-700">Payload Preview (Next Log)</div>
                                                <div className="mt-1 text-[10px] font-bold text-slate-600">
                                                    Max allowed this log: <span className="text-blue-700 font-black">{maxOutputWithScrapKg.toFixed(3)} kg</span>
                                                </div>
                                                <div className="mt-2 grid grid-cols-3 gap-2">
                                                    <div className="rounded-xl bg-white border border-blue-100 px-2 py-1.5">
                                                        <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">Output KG</div>
                                                        <div className="text-[12px] font-black text-slate-900">{previewOutputKg.toFixed(3)}</div>
                                                    </div>
                                                    <div className="rounded-xl bg-white border border-blue-100 px-2 py-1.5">
                                                        <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">Output PCS</div>
                                                        <div className="text-[12px] font-black text-slate-900">
                                                            {showPcsEntry ? (previewOutputPcs !== null ? previewOutputPcs.toLocaleString() : '—') : 'N/A'}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-xl bg-white border border-blue-100 px-2 py-1.5">
                                                        <div className="text-[8px] uppercase tracking-wider text-slate-500 font-bold">Scrap KG Final</div>
                                                        <div className="text-[12px] font-black text-slate-900">{scrapValue.toFixed(3)}</div>
                                                    </div>
                                                </div>
                                                {exceedsOutputCap && (
                                                    <div className="mt-2 text-[10px] font-black text-rose-600 uppercase tracking-wide">
                                                        Output exceeds physical cap. Reduce output or scrap before logging.
                                                    </div>
                                                )}
                                            </div>

                                            {/* Action Engine Grid */}
                                            <div className="grid grid-cols-2 gap-4 mt-auto">
                                                    <Button
                                                        data-testid="machine-start-step"
                                                        onClick={() => startMutation.mutate()}
                                                    disabled={!canStart || startMutation.isPending}
                                                    className="h-16 rounded-[1.5rem] bg-gradient-to-r from-emerald-600 to-teal-500 border-none shadow-lg shadow-emerald-500/20 font-black text-xs uppercase tracking-widest transition-all hover:scale-[1.02] hover:shadow-emerald-500/40 active:scale-95 disabled:opacity-50"
                                                >
                                                    <Play className="h-5 w-5 mr-3 fill-current" />
                                                    Start job
                                                </Button>
                                                <Button
                                                    data-testid="machine-stop-step"
                                                    variant="outline"
                                                    onClick={() => stopMutation.mutate()}
                                                    disabled={!canStop || stopMutation.isPending}
                                                    className="h-16 rounded-[1.5rem] border-2 border-rose-200/50 bg-white shadow-lg shadow-rose-200/10 font-black text-xs uppercase tracking-widest transition-all hover:bg-rose-500 hover:text-white hover:border-transparent hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                                                >
                                                    <Pause className="h-5 w-5 mr-3 fill-current" />
                                                    Pause Job
                                                </Button>
                                                <Button
                                                    data-testid="machine-log-output"
                                                    onClick={() =>
                                                        logOutputMutation.mutate({
                                                            scrapInputValue: scrapInputRef.current?.value ?? null,
                                                            scrapEntryMode,
                                                        })
                                                    }
                                                    disabled={!canLogOutput || logOutputMutation.isPending}
                                                    className="h-16 rounded-[1.5rem] bg-white border-2 border-blue-600/50 text-blue-600 font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/10 transition-all hover:bg-blue-600 hover:text-white hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                                                >
                                                    <CheckCircle2 className="h-5 w-5 mr-3" />
                                                    Log output
                                                </Button>
                                                <Button
                                                    data-testid="machine-finalize-step"
                                                    onClick={() => completeMutation.mutate()}
                                                    disabled={!canComplete || completeMutation.isPending}
                                                    className="h-16 rounded-[1.5rem] bg-gradient-to-r from-blue-700 to-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-2xl shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-indigo-500/50 active:scale-95 disabled:opacity-50"
                                                >
                                                    <CheckCircle2 className="h-5 w-5 mr-3" />
                                                    Finalize Step
                                                </Button>
                                            </div>

                                            {/* Validation & Notes */}
                                            <div className="space-y-4 pt-4 border-t border-slate-100">
                                                <div className="space-y-2">
                                                    <Label className="text-[9px] font-black uppercase text-slate-400 tracking-widest ml-1">Stop note or shop-floor comment</Label>
                                                    <Input
                                                        value={stopReason}
                                                        onChange={(e) => setStopReason(e.target.value)}
                                                        placeholder="Write a short reason if you pause the job or need to leave a note..."
                                                        className="h-11 rounded-2xl bg-slate-50 border-none shadow-inner text-xs font-bold"
                                                    />
                                                </div>

                                                {forceReasonRequired && (
                                                    <div className="p-5 rounded-3xl bg-rose-50 border border-rose-100 space-y-4 animate-in zoom-in-95 duration-300">
                                                        <div className="flex items-center gap-2 text-rose-600">
                                                            <AlertCircle className="h-4 w-4" />
                                                            <span className="text-[10px] font-black uppercase tracking-[0.22em]">Variance Detected</span>
                                                        </div>
                                                        <p className="text-[11px] font-bold text-rose-500 uppercase leading-relaxed">
                                                            Material shortfall: {stepRemainingKg.toFixed(2)} KG ({progressPct}% completion).
                                                            You must provide a justification to force-complete.
                                                        </p>
                                                        <Input
                                                            value={forceReason}
                                                            onChange={(e) => setForceReason(e.target.value)}
                                                            placeholder="Provide justification..."
                                                            className="h-12 rounded-2xl bg-white border-rose-200 focus:ring-rose-500 font-bold"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </CardContent>
                            </Card>

                            <Card className={cn(
                                "col-span-3 border border-white/20 shadow-2xl shadow-indigo-200/5 bg-white/40 backdrop-blur-xl rounded-[2.5rem] overflow-hidden flex flex-col transition-all duration-500",
                                selectedJob ? "h-[calc(100vh-320px)]" : "min-h-[420px]"
                            )}>
                                <CardHeader className="py-5 px-6 border-b border-white/10 bg-white/10">
                                    <CardTitle className="text-xs font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                        <Activity className="h-4 w-4 text-indigo-600" />
                                        Live Telemetry Feed
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-3 space-y-3 overflow-y-auto text-sm">
                                    {!selectedJob ? (
                                        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[1.8rem] border border-dashed border-slate-200 bg-slate-50/60 px-4 text-center">
                                            <Activity className="h-8 w-8 text-slate-300" />
                                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Telemetry comes alive with the selected job</div>
                                            <div className="max-w-xs text-[11px] font-semibold leading-5 text-slate-500">
                                                Step progress, material counters, queue health, and live logs appear here as soon as the operator picks a released job.
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="p-4 rounded-3xl border border-blue-100 bg-blue-50/70 space-y-2">
                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Execution Health</div>
                                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                                    <div className="rounded-xl bg-white border border-blue-100 p-2">
                                                        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Input Ready</div>
                                                        <div className={cn("font-black mt-1", telemetryHealth?.input_ready ? "text-emerald-600" : "text-rose-600")}>
                                                            {telemetryHealth?.input_ready ? 'YES' : 'NO'}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-xl bg-white border border-blue-100 p-2">
                                                        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Roll Shortage</div>
                                                        <div className="font-black mt-1 text-amber-600">{toNumber(telemetryHealth?.roll_shortage_count, 0)}</div>
                                                    </div>
                                                    <div className="rounded-xl bg-white border border-blue-100 p-2">
                                                        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Step Progress</div>
                                                        <div className="font-black mt-1 text-slate-800">
                                                            {toNumber(telemetryHealth?.step_produced_kg, 0).toFixed(3)} / {toNumber(telemetryHealth?.step_target_kg, 0).toFixed(3)} kg
                                                        </div>
                                                    </div>
                                                    <div className="rounded-xl bg-white border border-blue-100 p-2">
                                                        <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">Remaining</div>
                                                        <div className="font-black mt-1 text-indigo-700">{toNumber(telemetryHealth?.step_remaining_kg, 0).toFixed(3)} kg</div>
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-blue-700 font-semibold">{telemetryHealth?.next_action_hint || 'No action hint.'}</div>
                                            </div>

                                            <details className="rounded-2xl border border-slate-200 bg-white p-3">
                                                <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                                    Inventory Counters (compact)
                                                </summary>
                                                <div className="grid gap-2 mt-3 text-[11px]">
                                                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                                                        <span className="font-semibold text-slate-600">Bulk consumed</span>
                                                        <span className="font-black text-slate-900">{toNumber(telemetryCounters?.bulk_consumed_kg, 0).toFixed(3)} kg</span>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                                                        <span className="font-semibold text-slate-600">Rolls consumed</span>
                                                        <span className="font-black text-slate-900">{toNumber(telemetryCounters?.rolls_consumed_count, 0)} / {toNumber(telemetryCounters?.rolls_consumed_kg, 0).toFixed(3)} kg</span>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                                                        <span className="font-semibold text-slate-600">Rolls created</span>
                                                        <span className="font-black text-slate-900">{toNumber(telemetryCounters?.rolls_created_count, 0)} / {toNumber(telemetryCounters?.rolls_created_kg, 0).toFixed(3)} kg</span>
                                                    </div>
                                                    <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
                                                        <span className="font-semibold text-slate-600">Scrap</span>
                                                        <span className="font-black text-rose-600">{toNumber(telemetryCounters?.scrap_kg, context?.live_consumption?.total_scrap_kg || 0).toFixed(3)} kg</span>
                                                    </div>
                                                </div>
                                            </details>

                                            <div className="rounded border border-slate-200 bg-white p-2">
                                                <div className="text-xs text-slate-500 mb-1">Live Logs</div>
                                                {telemetryLogs.length === 0 ? (
                                                    <div className="text-xs text-slate-400">No events yet</div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        {telemetryLogs.slice(0, 12).map((evt: any, idx: number) => (
                                                            <div key={`evt-${idx}`} className="text-xs text-slate-700 flex items-center justify-between gap-2">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <Badge variant="outline" className="text-[9px] font-bold h-5 px-1.5 uppercase">
                                                                        {evt.type || 'EVENT'}
                                                                    </Badge>
                                                                    <span className="truncate">
                                                                        {toNumber(evt.quantity_kg, 0).toFixed(3)} kg
                                                                        {evt.roll_label ? ` • ${evt.roll_label}` : ''}
                                                                    </span>
                                                                </div>
                                                                <span className="text-[10px] text-slate-400 shrink-0">
                                                                    {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <Button variant="outline" className="w-full" onClick={refreshAll}>
                                                <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                                            </Button>

                                            {(completeMutation.data as any)?.interplant_dc?.dc_no && (
                                                <div className="rounded border border-indigo-200 bg-indigo-50 p-2 text-xs text-indigo-700">
                                                    <Truck className="h-3 w-3 inline mr-1" />
                                                    Auto DC: {(completeMutation.data as any).interplant_dc.dc_no}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>

                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="history" className="space-y-4 mt-0">
                        <Card className="border-slate-200 shadow-sm bg-white/95">
                            <CardHeader className="py-3 border-b bg-white">
                                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4" />
                                    Machine History
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Date From</Label>
                                        <Input
                                            type="date"
                                            value={historyDateFrom}
                                            onChange={(e) => setHistoryDateFrom(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Date To</Label>
                                        <Input
                                            type="date"
                                            value={historyDateTo}
                                            onChange={(e) => setHistoryDateTo(e.target.value)}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">Status</Label>
                                        <Select
                                            value={historyStatus}
                                            onValueChange={(v) => setHistoryStatus(v as 'ALL' | 'NORMAL' | 'FORCED_VARIANCE')}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">ALL</SelectItem>
                                                <SelectItem value="NORMAL">NORMAL</SelectItem>
                                                <SelectItem value="FORCED_VARIANCE">FORCED_VARIANCE</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex items-end">
                                        <Button
                                            variant="outline"
                                            className="w-full"
                                            onClick={() => queryClient.invalidateQueries({ queryKey: ['machine-history', machineId] })}
                                        >
                                            <RefreshCw className="h-4 w-4 mr-1" />
                                            Refresh
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                    <div className="p-5 rounded-[2rem] bg-white/40 border border-white/40 shadow-sm backdrop-blur-md hover:bg-white/60 transition-all group">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Jobs Completed</div>
                                        <div className="text-3xl font-black text-slate-900 group-hover:text-blue-600 transition-colors">{toNumber(historyData?.summary?.jobs_completed, 0)}</div>
                                    </div>
                                    <div className="p-5 rounded-[2rem] bg-white/40 border border-white/40 shadow-sm backdrop-blur-md hover:bg-white/60 transition-all group">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Produced (kg)</div>
                                        <div className="text-3xl font-black text-emerald-600 group-hover:scale-110 origin-left transition-transform">{toNumber(historyData?.summary?.produced_kg, 0).toFixed(2)}</div>
                                    </div>
                                    <div className="p-5 rounded-[2rem] bg-white/40 border border-white/40 shadow-sm backdrop-blur-md hover:bg-white/60 transition-all group">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Scrap (kg)</div>
                                        <div className="text-3xl font-black text-amber-600 group-hover:scale-110 origin-left transition-transform">{toNumber(historyData?.summary?.scrap_kg, 0).toFixed(2)}</div>
                                    </div>
                                    <div className="p-5 rounded-[2rem] bg-white/40 border border-white/40 shadow-sm backdrop-blur-md hover:bg-white/60 transition-all group">
                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Forced Variance</div>
                                        <div className="text-3xl font-black text-rose-600 group-hover:scale-110 origin-left transition-transform">{toNumber(historyData?.summary?.forced_variance_count, 0)}</div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                            <Card className="border-slate-200 shadow-sm bg-white/95">
                                <CardHeader className="py-3 border-b bg-white">
                                    <CardTitle className="text-sm font-semibold">Daily Summary</CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[380px] overflow-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-slate-50">
                                                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                                    <th className="px-3 py-2">Date</th>
                                                    <th className="px-3 py-2">Jobs</th>
                                                    <th className="px-3 py-2">Produced (kg)</th>
                                                    <th className="px-3 py-2">Scrap (kg)</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(historyData?.daily || []).length === 0 && !historyLoading ? (
                                                    <tr>
                                                        <td className="px-3 py-4 text-slate-400" colSpan={4}>No daily history found.</td>
                                                    </tr>
                                                ) : (
                                                    (historyData?.daily || []).map((row) => (
                                                        <tr key={row.date} className="border-t border-slate-100">
                                                            <td className="px-3 py-2 font-medium text-slate-700">{row.date}</td>
                                                            <td className="px-3 py-2 text-slate-700">{row.jobs_completed}</td>
                                                            <td className="px-3 py-2 text-slate-700">{toNumber(row.produced_kg, 0).toFixed(3)}</td>
                                                            <td className="px-3 py-2 text-slate-700">{toNumber(row.scrap_kg, 0).toFixed(3)}</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="border-slate-200 shadow-sm bg-white/95">
                                <CardHeader className="py-3 border-b bg-white">
                                    <CardTitle className="text-sm font-semibold">Completed Jobs</CardTitle>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[380px] overflow-auto">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 bg-slate-50">
                                                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                                                    <th className="px-3 py-2">Job</th>
                                                    <th className="px-3 py-2">Step</th>
                                                    <th className="px-3 py-2">Mode</th>
                                                    <th className="px-3 py-2">Produced</th>
                                                    <th className="px-3 py-2">Scrap</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(historyData?.jobs || []).length === 0 && !historyLoading ? (
                                                    <tr>
                                                        <td className="px-3 py-4 text-slate-400" colSpan={5}>No completed jobs in selected filters.</td>
                                                    </tr>
                                                ) : (
                                                    (historyData?.jobs || []).map((row) => (
                                                        <tr key={row.job_id} className="border-t border-slate-100">
                                                            <td className="px-3 py-2">
                                                                <div className="font-semibold text-slate-800">{row.job_number}</div>
                                                                <div className="text-xs text-slate-500">{row.template_name}</div>
                                                            </td>
                                                            <td className="px-3 py-2 text-slate-700">{row.step_name}</td>
                                                            <td className="px-3 py-2">
                                                                <Badge variant={row.completion_mode === 'FORCED_VARIANCE' ? 'destructive' : 'outline'}>
                                                                    {row.completion_mode}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-3 py-2 text-slate-700">{toNumber(row.produced_kg, 0).toFixed(3)} kg</td>
                                                            <td className="px-3 py-2 text-slate-700">{toNumber(row.scrap_kg, 0).toFixed(3)} kg</td>
                                                        </tr>
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
