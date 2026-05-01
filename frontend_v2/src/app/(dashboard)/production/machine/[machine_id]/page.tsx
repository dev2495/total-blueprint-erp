'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Activity,
    AlertCircle,
    ArrowLeft,
    CheckCircle2,
    History,
    Pause,
    Play,
    Plus,
    RefreshCw,
    Save,
    Search,
    Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { normalizeProductSpec } from '@/lib/product-spec';
import { toast } from '@/hooks/use-toast';
import { inventoryService } from '@/services/inventory';
import { masterDataService, type GranuleQualityCode, type Material } from '@/services/master-data';
import { machineService, type MachineJobEvent } from '@/services/machine';

type QueueFilter = 'ALL' | 'RUNNING' | 'READY' | 'PAUSED';
type TerminalTab = 'run' | 'history';
type SublogKind = 'scrap' | 'downtime' | 'consumption' | 'quality' | null;
type EntryMode = 'KG' | 'PCS';

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

type QualityDraft = {
    code: string;
    label: string;
    value: string;
    spec_min?: number;
    spec_max?: number;
    textMode?: boolean;
    in_spec: boolean;
};

const POLL_MS = 8000;
const EVENTS_POLL_MS = 5000;
const DEFAULT_REMAINDER = '__DEFAULT__';
const SELECT_NONE = '__NONE__';

const surfaceClass = 'rounded-[18px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-14px_rgba(15,23,42,0.12)]';
const labelClass = 'text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500';
const inputClass = 'h-10 rounded-lg border-slate-200 bg-white text-sm font-semibold text-slate-900 focus-visible:ring-blue-500/20';

function toNumber(value: unknown, fallback = 0): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function toNullableNumber(value: unknown): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function firstNonEmpty(...values: unknown[]) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text && text !== '-' && text !== '—' && text.toLowerCase() !== 'null' && text.toLowerCase() !== 'undefined') return text;
    }
    return '';
}

function kg(value: unknown, digits = 3) {
    return `${toNumber(value, 0).toFixed(digits)} kg`;
}

function qtyLabel(value: unknown, uom = 'KG', digits = 3) {
    const unit = String(uom || 'KG').toUpperCase();
    if (unit === 'KG') return kg(value, digits);
    return `${toNumber(value, 0).toFixed(unit === 'PCS' ? 0 : digits)} ${unit.toLowerCase()}`;
}

function formatShortDateTime(value?: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTime(value?: string | null) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function toDateTimeLocal(date = new Date()) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function behaviorLabel(raw?: string | null) {
    const value = String(raw || 'NONE').toUpperCase();
    if (value === 'MULTI_INPUT_COMBINE') return 'MULTI INPUT';
    if (value === 'MODIFY_EXISTING') return 'MODIFY';
    return value;
}

function behaviorVariant(behavior: string, inputForm: string, outputForm: string) {
    if (inputForm === 'ROLL' && outputForm === 'BULK') return 'pouching';
    if (behavior === 'CREATE_NEW') return 'extrusion';
    if (behavior === 'MODIFY_EXISTING') return 'printing';
    if (behavior === 'MULTI_INPUT_COMBINE') return 'lamination';
    if (behavior === 'SPLIT') return 'slitting';
    return 'standard';
}

function variantTitle(variant: string, stepName: string, behavior: string) {
    if (variant === 'pouching') return `${stepName} · ROLL → BULK`;
    if (variant === 'extrusion') return `${stepName} · CREATE_NEW`;
    if (variant === 'printing') return `${stepName} · MODIFY_EXISTING`;
    if (variant === 'lamination') return `${stepName} · MULTI_INPUT_COMBINE`;
    if (variant === 'slitting') return `${stepName} · SPLIT`;
    return `${stepName} · ${behavior || 'STANDARD'}`;
}

function qualityPreset(variant: string): QualityDraft[] {
    if (variant === 'printing') {
        return [
            { code: 'REGISTRATION', label: 'Registration', value: 'PASS', textMode: true, in_spec: true },
            { code: 'COLOR_MATCH_DE', label: 'Color match ΔE', value: '1.8', spec_min: 0, spec_max: 3, in_spec: true },
            { code: 'DRYER_TEMP_C', label: 'Dryer temp °C', value: '78', spec_min: 65, spec_max: 90, in_spec: true },
        ];
    }
    if (variant === 'lamination') {
        return [
            { code: 'NIP_PRESSURE', label: 'Nip pressure', value: '', spec_min: 0, spec_max: 0, in_spec: true },
            { code: 'OVEN_TEMP_C', label: 'Oven temp °C', value: '', spec_min: 55, spec_max: 90, in_spec: true },
            { code: 'WEB_TENSION', label: 'Web tension', value: '', in_spec: true },
            { code: 'COAT_WEIGHT_GSM', label: 'Coat weight GSM', value: '', in_spec: true },
        ];
    }
    if (variant === 'slitting') {
        return [
            { code: 'KNIFE_WEAR', label: 'Knife wear', value: 'OK', textMode: true, in_spec: true },
            { code: 'EDGE_TRIM_MM', label: 'Edge trim mm', value: '', spec_min: 0, spec_max: 20, in_spec: true },
            { code: 'WEB_TENSION', label: 'Web tension', value: '', in_spec: true },
        ];
    }
    if (variant === 'pouching') {
        return [
            { code: 'SEAL_INTEGRITY', label: 'Seal integrity', value: 'PASS', textMode: true, in_spec: true },
            { code: 'PRINT_CLARITY', label: 'Print clarity', value: 'PASS', textMode: true, in_spec: true },
            { code: 'DIMENSIONAL', label: 'Dimensional', value: 'PASS', textMode: true, in_spec: true },
            { code: 'SEAL_TEMP_C', label: 'Seal temp °C', value: '', spec_min: 120, spec_max: 170, in_spec: true },
        ];
    }
    return [
        { code: 'MELT_TEMP_C', label: 'Melt temp °C', value: '', spec_min: 215, spec_max: 225, in_spec: true },
        { code: 'SCREW_RPM', label: 'Screw RPM', value: '', spec_min: 70, spec_max: 90, in_spec: true },
        { code: 'DIE_PRESSURE_BAR', label: 'Die pressure bar', value: '', spec_min: 130, spec_max: 160, in_spec: true },
        { code: 'LINE_SPEED_MPM', label: 'Line speed m/min', value: '', spec_min: 20, spec_max: 25, in_spec: true },
        { code: 'GAUGE_VARIATION_MICRON', label: 'Gauge variation μ', value: '', spec_min: -2, spec_max: 2, in_spec: true },
    ];
}

function resolveCreateNewDefaultWidth(context?: any): number | null {
    const specs = Array.isArray(context?.target_roll_invariant_list) ? context.target_roll_invariant_list : [];
    for (const spec of [...specs].sort((a: any, b: any) => toNumber(a?.layer_index, 999) - toNumber(b?.layer_index, 999))) {
        const width = toNullableNumber(spec?.min_width_mm);
        if (width && width > 0) return width;
    }
    const fallback = toNullableNumber(context?.target_roll_invariants?.min_width_mm);
    return fallback && fallback > 0 ? fallback : null;
}

function eventTone(type?: string) {
    const normalized = String(type || '').toUpperCase();
    if (normalized.includes('SCRAP')) return 'bg-rose-500';
    if (normalized.includes('DOWN')) return 'bg-slate-500';
    if (normalized.includes('CONSUMPTION')) return 'bg-blue-600';
    if (normalized.includes('QUALITY')) return 'bg-cyan-500';
    if (normalized.includes('ROLL')) return 'bg-blue-500';
    return 'bg-emerald-500';
}

function stateBadgeClass(state?: string) {
    const normalized = String(state || '').toUpperCase();
    if (normalized === 'EXECUTING') return 'border-blue-200 bg-blue-50 text-blue-800';
    if (normalized === 'PAUSED') return 'border-amber-200 bg-amber-50 text-amber-800';
    if (normalized === 'RELEASED' || normalized === 'READY') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    if (normalized === 'COMPLETED') return 'border-slate-200 bg-slate-50 text-slate-700';
    return 'border-slate-200 bg-white text-slate-700';
}

function specChips(spec: any, selectedJob: any, context: any) {
    const layers = Array.isArray(spec.layers) ? spec.layers : [];
    const primaryLayer = layers[0] || {};
    const grade = firstNonEmpty(primaryLayer.grade, primaryLayer.gradeName, selectedJob?.grade_name);
    const thickness = firstNonEmpty(
        primaryLayer.thicknessMicron ? `${primaryLayer.thicknessMicron}μ` : '',
        selectedJob?.thickness_micron ? `${selectedJob.thickness_micron}μ` : ''
    );
    const variant = firstNonEmpty(spec.variantName, primaryLayer.variantName, primaryLayer.label, selectedJob?.variant_name);
    const template = firstNonEmpty(context?.display?.template_name, selectedJob?.template_name);
    return [
        { label: spec.fgType || selectedJob?.output_form || 'FG', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
        { label: spec.size?.label || 'Size not captured', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
        thickness ? { label: thickness, tone: 'bg-blue-50 text-blue-800 border-blue-200' } : null,
        variant ? { label: variant, tone: 'bg-blue-50 text-blue-800 border-blue-200' } : null,
        grade ? { label: grade, tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' } : null,
        spec.printingLabel ? { label: spec.printingLabel, tone: 'bg-sky-50 text-sky-800 border-sky-200' } : null,
        template ? { label: template, tone: 'bg-blue-50 text-blue-800 border-blue-200' } : null,
    ].filter(Boolean) as Array<{ label: string; tone: string }>;
}

export default function MachineExecutionPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();

    const machineIdParam = params?.machine_id;
    const machineId = Array.isArray(machineIdParam) ? machineIdParam[0] : String(machineIdParam || '');

    const [activeTab, setActiveTab] = useState<TerminalTab>('run');
    const [selectedJobId, setSelectedJobId] = useState('');
    const [queueSearch, setQueueSearch] = useState('');
    const [queueStatusFilter, setQueueStatusFilter] = useState<QueueFilter>('ALL');
    const [historyDateFrom, setHistoryDateFrom] = useState('');
    const [historyDateTo, setHistoryDateTo] = useState('');
    const [historyStatus, setHistoryStatus] = useState<'ALL' | 'NORMAL' | 'FORCED_VARIANCE'>('ALL');

    const [outputWeightKg, setOutputWeightKg] = useState('');
    const [outputPcs, setOutputPcs] = useState('');
    const [outputEntryMode, setOutputEntryMode] = useState<EntryMode>('KG');
    const [outputWidthMm, setOutputWidthMm] = useState('');
    const [outputLengthM, setOutputLengthM] = useState('');
    const [outputWidthDirty, setOutputWidthDirty] = useState(false);
    const [outputWeightDirty, setOutputWeightDirty] = useState(false);
    const [createRollRows, setCreateRollRows] = useState<CreateRollRow[]>([]);
    const [splitRows, setSplitRows] = useState<SplitRow[]>([{ id: 1, width_mm: '', weight_kg: '' }]);
    const [trimInput, setTrimInput] = useState('0');
    const [scrapInput, setScrapInput] = useState('0');
    const [scrapEntryMode, setScrapEntryMode] = useState<EntryMode>('KG');
    const [scrapReason, setScrapReason] = useState('TRIM');
    const [remainderLocationId, setRemainderLocationId] = useState(DEFAULT_REMAINDER);
    const [forceReason, setForceReason] = useState('');
    const [materialConfirmations, setMaterialConfirmations] = useState<Record<string, MaterialConfirmationDraft>>({});

    const [sublog, setSublog] = useState<SublogKind>(null);
    const [scrapDialogQty, setScrapDialogQty] = useState('0');
    const [scrapDialogReason, setScrapDialogReason] = useState('TRIM');
    const [scrapDialogNotes, setScrapDialogNotes] = useState('');
    const [downtimeReason, setDowntimeReason] = useState('MATERIAL');
    const [downtimeStart, setDowntimeStart] = useState(toDateTimeLocal());
    const [downtimeEnd, setDowntimeEnd] = useState('');
    const [downtimeAutoStop, setDowntimeAutoStop] = useState(true);
    const [downtimeNotes, setDowntimeNotes] = useState('');
    const [consumptionMaterialId, setConsumptionMaterialId] = useState('');
    const [consumptionGranuleCodeId, setConsumptionGranuleCodeId] = useState(SELECT_NONE);
    const [consumptionRollId, setConsumptionRollId] = useState(SELECT_NONE);
    const [consumptionQty, setConsumptionQty] = useState('');
    const [consumptionEstimated, setConsumptionEstimated] = useState(false);
    const [qualityRows, setQualityRows] = useState<QualityDraft[]>(qualityPreset('extrusion'));

    const splitCounterRef = useRef(2);
    const createCounterRef = useRef(1);
    const initializedJobIdRef = useRef<string | null>(null);

    const { data: machineDetail, isLoading: machineLoading, error: machineError } = useQuery({
        queryKey: ['machine-detail', machineId],
        queryFn: () => machineService.getMachineDetail(machineId),
        enabled: Boolean(machineId),
        refetchInterval: POLL_MS,
    });

    const { data: queueData = [], isLoading: queueLoading, error: queueError } = useQuery({
        queryKey: ['machine-queue', machineId],
        queryFn: () => machineService.getQueue(machineId),
        enabled: Boolean(machineId),
        refetchInterval: POLL_MS,
    });

    const queueItems = useMemo(() => (Array.isArray(queueData) ? queueData : []), [queueData]);
    const visibleQueueItems = useMemo(() => {
        return queueItems.filter((job: any) => {
            const state = String(job?.job_state || '').toUpperCase();
            if (queueStatusFilter === 'RUNNING' && state !== 'EXECUTING') return false;
            if (queueStatusFilter === 'READY' && !['RELEASED', 'READY', 'QUEUED', 'PLANNED', 'WAITING'].includes(state)) return false;
            if (queueStatusFilter === 'PAUSED' && state !== 'PAUSED') return false;
            const search = queueSearch.trim().toLowerCase();
            if (!search) return true;
            const spec = normalizeProductSpec(job);
            return [spec.searchText, job?.job_number, job?.process_code, job?.template_name].join(' ').toLowerCase().includes(search);
        });
    }, [queueItems, queueSearch, queueStatusFilter]);

    const selectedJob = useMemo(() => {
        if (!queueItems.length) return null;
        const explicit = queueItems.find((job: any) => String(job.id) === String(selectedJobId));
        if (explicit) return explicit;
        return queueItems.find((job: any) => String(job.job_state).toUpperCase() === 'EXECUTING') || queueItems[0];
    }, [queueItems, selectedJobId]);

    const selectedId = String(selectedJob?.id || '');

    const { data: context, isLoading: contextLoading } = useQuery({
        queryKey: ['machine-job-context', machineId, selectedId],
        queryFn: () => machineService.getJobContext(machineId, selectedId),
        enabled: Boolean(machineId && selectedId),
        refetchInterval: POLL_MS,
    });

    const { data: events = [], isLoading: eventsLoading } = useQuery({
        queryKey: ['machine-job-events', machineId, selectedId],
        queryFn: () => machineService.getJobEvents(machineId, selectedId, 20),
        enabled: Boolean(machineId && selectedId),
        refetchInterval: activeTab === 'run' ? EVENTS_POLL_MS : false,
    });

    const { data: historyData, isLoading: historyLoading } = useQuery({
        queryKey: ['machine-history', machineId, historyDateFrom, historyDateTo, historyStatus],
        queryFn: () =>
            machineService.getMachineHistory(machineId, {
                date_from: historyDateFrom || undefined,
                date_to: historyDateTo || undefined,
                status: historyStatus,
            }),
        enabled: Boolean(machineId) && activeTab === 'history',
    });

    const plantId = String(machineDetail?.machine?.plant_id || '');
    const { data: plantLocations = [] } = useQuery({
        queryKey: ['machine-plant-locations', plantId],
        queryFn: () => inventoryService.getLocations(plantId),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    });

    const { data: materialLibrary = [] } = useQuery({
        queryKey: ['machine-material-library'],
        queryFn: async () => {
            const data = await masterDataService.getLibrary({});
            return Array.isArray(data) ? data : ((data as any)?.results || []);
        },
        staleTime: 60_000,
    });

    const { data: granuleCodes = [] } = useQuery({
        queryKey: ['machine-granule-codes'],
        queryFn: () => masterDataService.getGranuleCodes({ status: 'ACTIVE' }),
        staleTime: 60_000,
    });

    useEffect(() => {
        if (!queueItems.length) {
            setSelectedJobId('');
            return;
        }
        if (!selectedJobId || !queueItems.some((job: any) => String(job.id) === String(selectedJobId))) {
            const executing = queueItems.find((job: any) => String(job.job_state).toUpperCase() === 'EXECUTING');
            setSelectedJobId(String((executing || queueItems[0]).id));
        }
    }, [queueItems, selectedJobId]);

    const behavior = String(
        context?.roll_handling?.behavior ||
        context?.display?.roll_behavior ||
        context?.job?.roll_behavior ||
        selectedJob?.roll_behavior ||
        'NONE'
    ).toUpperCase();
    const currentInputForm = String(context?.current_step?.input_form || context?.job?.input_form || selectedJob?.input_form || 'BULK').toUpperCase();
    const currentOutputForm = String(context?.job?.output_form || selectedJob?.output_form || 'ROLL').toUpperCase();
    const variant = behaviorVariant(behavior, currentInputForm, currentOutputForm);
    const supportsDiscreteOutputRolls = behavior === 'CREATE_NEW' || behavior === 'MULTI_INPUT_COMBINE';
    const showPcsEntry = currentInputForm === 'ROLL' && currentOutputForm === 'BULK';
    const stepName = firstNonEmpty(context?.display?.step_name, context?.current_step?.process_name, selectedJob?.process_code, 'Current step');
    const stepTransform = `${currentInputForm.toLowerCase()} → ${currentOutputForm.toLowerCase()}`;
    const spec = normalizeProductSpec(selectedJob, context);
    const chips = specChips(spec, selectedJob, context);

    const stepExecution: any = context?.step_execution || {};
    const progressWeight: any = context?.progress?.weight_kg || context?.execution_profile?.progress?.weight_kg || {};
    const primaryTarget = toNullableNumber(progressWeight?.target ?? stepExecution?.total_target_kg ?? selectedJob?.quantity);
    const primaryProduced = toNullableNumber(progressWeight?.produced ?? stepExecution?.produced_kg ?? selectedJob?.produced_qty);
    const primaryRemaining = toNullableNumber(progressWeight?.remaining ?? stepExecution?.remaining_kg ?? selectedJob?.remaining_qty);
    const targetKg = primaryTarget ?? 0;
    const producedKg = primaryProduced ?? 0;
    const remainingKg = Math.max(0, primaryRemaining ?? Math.max(0, targetKg - producedKg));
    const progressPct = targetKg > 0 ? Math.min(100, Math.max(0, (producedKg / targetKg) * 100)) : 0;
    const unitWeightG = toNumber(context?.execution_profile?.unit_weight_g ?? context?.job?.unit_weight_g ?? selectedJob?.unit_weight_g, 0);
    const stepToleranceKg = Math.max(0, toNumber(stepExecution?.tolerance_kg, 0.25));
    const primaryUom = String(stepExecution?.primary_uom || context?.execution_profile?.primary_unit || 'KG').toUpperCase();
    const remainingPrimary = Math.max(0, toNumber(stepExecution?.remaining_primary ?? context?.execution_profile?.step_remaining_primary ?? remainingKg, remainingKg));
    const stepTolerancePrimary = Math.max(0, toNumber(stepExecution?.tolerance_primary ?? context?.execution_profile?.tolerance_primary ?? stepToleranceKg, stepToleranceKg));

    const reservedRolls = useMemo(
        () =>
            (context?.inputs?.reserved_rolls || context?.allocated_rolls || []).map((row: any) => ({
                id: String(row.id),
                label_id: row.label_id || row.id,
                material_id: row.material_id || row.variant_id,
                material_name: row.material_name || row.variant || row.variant_name || 'Material',
                weight_kg: toNumber(row.weight_kg, 0),
                width_mm: toNullableNumber(row.width_mm),
                thickness_micron: toNullableNumber(row.thickness_micron ?? row.thickness),
                grade: row.grade || row.grade_name || '-',
                location_name: row.location_name || '-',
                target_lane_label: row.target_lane_label || null,
                target_layer_index: row.target_layer_index ?? null,
                target_variant_name: row.target_variant_name || null,
                target_grade_name: row.target_grade_name || null,
                target_thickness_micron: toNullableNumber(row.target_thickness_micron),
                target_width_mm: toNullableNumber(row.target_width_mm),
            })),
        [context]
    );
    const wipPool = (context?.wip_pool || context?.wip_recent_lineage || []).map((row: any) => ({
        id: String(row.id),
        label_id: row.label_id,
        material_name: row.material_name || 'Material',
        weight_kg: toNumber(row.weight_kg, 0),
        width_mm: toNullableNumber(row.width_mm),
        thickness_micron: toNullableNumber(row.thickness_micron),
        grade: row.grade || '-',
        location_name: row.location_name || '-',
        stage: row.stage || '-',
    }));
    const rightRailRolls = reservedRolls.length ? reservedRolls : wipPool.slice(0, 5);
    const reconcilableBulkRows = useMemo(
        () =>
            (context?.inputs?.bulk_preview_theoretical || context?.inputs?.bulk_preview || context?.satisfaction?.bulk_consumption || []).filter((row: any) => {
                const mode = String(row?.capture_mode || row?.strategy || '').toUpperCase();
                return mode !== 'AUTO_FROM_OUTPUT';
            }),
        [context]
    );
    const wipPoolMeta: any = context?.wip_pool_meta || {};
    const allocationRequired = Boolean(context?.step_policy?.allocation_required);
    const laneGroupMode = Boolean(wipPoolMeta?.lane_group_mode);
    const requiredLaneCount = Math.max(0, toNumber(wipPoolMeta?.input_lane_count, 0));
    const reservedLaneCount = new Set(reservedRolls.map((row: any) => String(row.target_lane_label || row.target_layer_index || '').trim()).filter(Boolean)).size;
    const allocationReady =
        !allocationRequired ||
        (laneGroupMode ? (requiredLaneCount <= 0 ? reservedRolls.length > 0 : reservedLaneCount >= requiredLaneCount) : reservedRolls.length >= 1);
    const reservedInputTotalKg = reservedRolls.reduce((sum: number, row: any) => sum + toNumber(row.weight_kg, 0), 0);
    const contextMaxOutputKg = toNullableNumber(stepExecution?.max_output_kg ?? context?.execution_profile?.max_output_kg);
    const maxOutputWithoutScrapKg = currentInputForm === 'ROLL'
        ? Math.max(0, Math.min(contextMaxOutputKg ?? remainingKg, reservedInputTotalKg || (contextMaxOutputKg ?? remainingKg)))
        : Math.max(0, contextMaxOutputKg ?? remainingKg);
    const trimKgValue = useMemo(() => {
        const raw = toNumber(trimInput, 0);
        if (scrapEntryMode === 'PCS') {
            return unitWeightG > 0 ? (Math.max(0, raw) * unitWeightG) / 1000 : 0;
        }
        return Math.max(0, raw);
    }, [scrapEntryMode, trimInput, unitWeightG]);
    const processScrapKgValue = useMemo(() => {
        const raw = toNumber(scrapInput, 0);
        if (scrapEntryMode === 'PCS') {
            return unitWeightG > 0 ? (Math.max(0, raw) * unitWeightG) / 1000 : 0;
        }
        return Math.max(0, raw);
    }, [scrapInput, scrapEntryMode, unitWeightG]);
    const wasteKgValue = trimKgValue + processScrapKgValue;
    const maxOutputWithScrapKg = currentInputForm === 'ROLL'
        ? Math.max(0, Math.min(maxOutputWithoutScrapKg, Math.max(0, reservedInputTotalKg - wasteKgValue)))
        : maxOutputWithoutScrapKg;

    const splitRowsParsed = useMemo(
        () =>
            splitRows
                .map((row) => ({ id: row.id, width_mm: toNumber(row.width_mm, 0), weight_kg: toNumber(row.weight_kg, 0) }))
                .filter((row) => row.width_mm > 0 && row.weight_kg > 0),
        [splitRows]
    );
    const splitTotalKg = splitRowsParsed.reduce((sum, row) => sum + row.weight_kg, 0);
    const createRollRowsParsed = useMemo(() => {
        const rows: Array<{ id: number; width_mm: number; weight_kg: number; length_m?: number | null }> = [];
        const baseWidth = toNumber(outputWidthMm, 0);
        const baseWeight = toNumber(outputWeightKg, 0);
        if (baseWidth > 0 && baseWeight > 0) {
            rows.push({ id: 0, width_mm: baseWidth, weight_kg: baseWeight, length_m: toNullableNumber(outputLengthM) });
        }
        for (const row of createRollRows) {
            const width = toNumber(row.width_mm, 0);
            const weight = toNumber(row.weight_kg, 0);
            if (width > 0 && weight > 0) {
                rows.push({ id: row.id, width_mm: width, weight_kg: weight, length_m: toNullableNumber(row.length_m) });
            }
        }
        return rows;
    }, [createRollRows, outputLengthM, outputWeightKg, outputWidthMm]);
    const createRollTotalKg = createRollRowsParsed.reduce((sum, row) => sum + row.weight_kg, 0);
    const previewOutputKg = useMemo(() => {
        if (behavior === 'SPLIT') return splitTotalKg;
        if (supportsDiscreteOutputRolls && createRollRowsParsed.length > 1) return createRollTotalKg;
        if (showPcsEntry && outputEntryMode === 'PCS') {
            const pcs = toNumber(outputPcs, NaN);
            if (Number.isFinite(pcs) && pcs > 0 && unitWeightG > 0) return (Math.round(pcs) * unitWeightG) / 1000;
        }
        const kgValue = toNumber(outputWeightKg, NaN);
        if (Number.isFinite(kgValue) && kgValue > 0) return kgValue;
        if (showPcsEntry && unitWeightG > 0) {
            const pcs = toNumber(outputPcs, NaN);
            if (Number.isFinite(pcs) && pcs > 0) return (Math.round(pcs) * unitWeightG) / 1000;
        }
        return 0;
    }, [behavior, splitTotalKg, supportsDiscreteOutputRolls, createRollRowsParsed.length, createRollTotalKg, showPcsEntry, outputEntryMode, outputPcs, unitWeightG, outputWeightKg]);
    const previewOutputPcs = showPcsEntry && unitWeightG > 0 && previewOutputKg > 0 ? Math.max(1, Math.round((previewOutputKg * 1000) / unitWeightG)) : toNullableNumber(outputPcs);
    const exceedsOutputCap = previewOutputKg > maxOutputWithScrapKg + 0.001;

    const jobState = String(selectedJob?.job_state || context?.job?.job_state || '').toUpperCase();
    const isExecuting = jobState === 'EXECUTING';
    const isPaused = jobState === 'PAUSED';
    const canStart = Boolean(selectedJob && !isExecuting && !['COMPLETED', 'CANCELLED'].includes(jobState) && allocationReady);
    const canStop = Boolean(selectedJob && isExecuting);
    const canLogOutput = Boolean(selectedJob && isExecuting && allocationReady && !exceedsOutputCap);
    const needsForceComplete = remainingPrimary > stepTolerancePrimary;
    const forceReasonValid = !needsForceComplete || forceReason.trim().length >= 5;
    const canComplete = Boolean(selectedJob && ['EXECUTING', 'PAUSED'].includes(jobState) && forceReasonValid);
    const operatorNextStep = !selectedJob
        ? 'No released jobs are waiting here.'
        : !allocationReady
          ? 'Reserve the required input roll before starting.'
          : canStart
            ? 'Start / resume this step when setup is ready.'
            : canLogOutput
              ? 'Log output for the current step.'
              : isPaused
                ? 'Step is paused. Resume before logging output.'
                : canComplete
                  ? 'Complete step when production and material actuals are ready.'
                  : 'Idle machine.';

    const materialRowsFromContext = useMemo(() => {
        const rows = reconcilableBulkRows
            .map((row: any) => ({
                id: String(row.material_id || ''),
                code: String(row.material_code || row.code || ''),
                name: String(row.material_name || row.name || ''),
                category: String(row.category || row.material_category || ''),
            }))
            .filter((row: any) => row.id && row.name);
        return rows;
    }, [reconcilableBulkRows]);
    const materialOptions = useMemo(() => {
        const byId = new Map<string, any>();
        for (const row of materialRowsFromContext) byId.set(row.id, row);
        const library = Array.isArray(materialLibrary) ? materialLibrary : [];
        for (const material of library as Material[]) {
            if (!material?.id) continue;
            byId.set(material.id, {
                id: material.id,
                code: material.code,
                name: material.name,
                category: material.category,
            });
        }
        return Array.from(byId.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }, [materialRowsFromContext, materialLibrary]);
    const selectedMaterial = materialOptions.find((material: any) => String(material.id) === String(consumptionMaterialId));
    const filteredGranuleCodes = useMemo(
        () =>
            (Array.isArray(granuleCodes) ? granuleCodes : []).filter((code: GranuleQualityCode) => {
                if (!consumptionMaterialId) return true;
                return String(code.granule) === String(consumptionMaterialId);
            }),
        [granuleCodes, consumptionMaterialId]
    );
    const remainderLocations = useMemo(() => (plantLocations || []).filter((loc: any) => loc?.is_active && loc?.type !== 'IN_TRANSIT'), [plantLocations]);

    useEffect(() => {
        const nextJobId = selectedJob?.id ? String(selectedJob.id) : null;
        if (!nextJobId || initializedJobIdRef.current === nextJobId) return;
        initializedJobIdRef.current = nextJobId;
        const initialKg = Math.max(0, maxOutputWithoutScrapKg || remainingKg || 0);
        setOutputWeightKg(initialKg > 0 ? initialKg.toFixed(3) : '');
        setOutputPcs(unitWeightG > 0 && showPcsEntry && initialKg > 0 ? String(Math.max(1, Math.round((initialKg * 1000) / unitWeightG))) : '');
        setOutputEntryMode(showPcsEntry ? 'PCS' : 'KG');
        setOutputWidthMm('');
        setOutputLengthM('');
        setOutputWidthDirty(false);
        setOutputWeightDirty(false);
        setCreateRollRows([]);
        createCounterRef.current = 1;
        setSplitRows([{ id: 1, width_mm: '', weight_kg: '' }]);
        splitCounterRef.current = 2;
        setTrimInput('0');
        setScrapInput('0');
        setScrapEntryMode('KG');
        setScrapReason(behavior === 'CREATE_NEW' ? 'SETUP' : behavior === 'SPLIT' ? 'TRIM' : 'DEFECT');
        setRemainderLocationId(DEFAULT_REMAINDER);
        setForceReason('');
        setConsumptionMaterialId(materialRowsFromContext[0]?.id || '');
        setConsumptionQty('');
        setQualityRows(qualityPreset(variant));
    }, [selectedJob?.id, behavior, maxOutputWithoutScrapKg, remainingKg, showPcsEntry, unitWeightG, variant, materialRowsFromContext]);

    useEffect(() => {
        if (behavior !== 'CREATE_NEW' || outputWidthDirty || outputWidthMm) return;
        const defaultWidth = resolveCreateNewDefaultWidth(context);
        if (defaultWidth && defaultWidth > 0) setOutputWidthMm(String(Math.round(defaultWidth)));
    }, [behavior, context, outputWidthDirty, outputWidthMm]);

    useEffect(() => {
        if (!showPcsEntry || outputEntryMode !== 'PCS' || unitWeightG <= 0 || outputWeightDirty) return;
        const pcs = toNumber(outputPcs, NaN);
        if (Number.isFinite(pcs) && pcs > 0) setOutputWeightKg(((Math.round(pcs) * unitWeightG) / 1000).toFixed(3));
    }, [outputEntryMode, outputPcs, outputWeightDirty, showPcsEntry, unitWeightG]);

    useEffect(() => {
        setMaterialConfirmations((prev) => {
            const next: Record<string, MaterialConfirmationDraft> = { ...prev };
            const active = new Set<string>();
            let changed = false;
            for (const row of reconcilableBulkRows) {
                const requirementId = String(row?.requirement_id || '').trim();
                if (!requirementId) continue;
                active.add(requirementId);
                if (!next[requirementId]) {
                    const issued = toNumber(row?.actual_issued_qty_kg ?? row?.estimated_actual_qty_kg ?? row?.actual_consumed_qty_kg ?? row?.required_qty_kg, 0);
                    next[requirementId] = {
                        requirement_id: requirementId,
                        material_id: row?.material_id ? String(row.material_id) : undefined,
                        actual_issued_qty: issued > 0 ? issued.toFixed(3) : '',
                        actual_returned_qty: toNumber(row?.actual_returned_qty_kg, 0).toFixed(3),
                        actual_scrap_qty: toNumber(row?.actual_scrap_qty_kg, 0).toFixed(3),
                        is_estimated: true,
                        return_mode: 'EXACT_COLOR_RETURN',
                        granule_code_allocations: [],
                    };
                    changed = true;
                }
            }
            for (const key of Object.keys(next)) {
                if (!active.has(key)) {
                    delete next[key];
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [reconcilableBulkRows]);

    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
            if (event.key === 'Escape') setSublog(null);
            if (event.key.toLowerCase() === 's') setSublog('scrap');
            if (event.key.toLowerCase() === 'd') setSublog('downtime');
            if (event.key.toLowerCase() === 'c') setSublog('consumption');
            if (event.key.toLowerCase() === 'q') setSublog('quality');
            if (event.key.toLowerCase() === 'o') document.getElementById('machine-output-panel')?.scrollIntoView({ block: 'center' });
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    const refreshAll = async () => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['machine-detail', machineId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-queue', machineId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-job-context', machineId, selectedId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-job-events', machineId, selectedId] }),
            queryClient.invalidateQueries({ queryKey: ['machine-history', machineId] }),
        ]);
    };

    const startMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.startJob(machineId, String(selectedJob.id));
        },
        onSuccess: async () => {
            toast({ title: isPaused ? 'Job resumed' : 'Job started', description: 'Machine execution is live.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Start failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to start job.' }),
    });

    const stopMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.stopJob(machineId, String(selectedJob.id), 'Operator pause');
        },
        onSuccess: async () => {
            toast({ title: 'Job paused', description: 'Output logging is locked until resume.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Pause failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to pause job.' }),
    });

    const logOutputMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            const payload: {
                actual_qty: number;
                output_width_mm?: number;
                output_length_m?: number;
                output_pcs?: number;
                scrap_qty?: number;
                trim_qty?: number;
                process_scrap_qty?: number;
                roll_outputs?: Array<{ width_mm: number; weight_kg: number; length_m?: number }>;
                split_outputs?: Array<{ width_mm: number; weight_kg: number }>;
                remainder_location_id?: string;
            } = {
                actual_qty: 0,
                scrap_qty: wasteKgValue,
                trim_qty: trimKgValue,
                process_scrap_qty: processScrapKgValue,
            };

            if (remainderLocationId && remainderLocationId !== DEFAULT_REMAINDER) payload.remainder_location_id = remainderLocationId;

            if (behavior === 'SPLIT') {
                if (!splitRowsParsed.length) throw new Error('Add at least one split output row.');
                if (splitTotalKg > maxOutputWithScrapKg + 0.001) throw new Error(`Split output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`);
                payload.split_outputs = splitRowsParsed.map((row) => ({ width_mm: row.width_mm, weight_kg: row.weight_kg }));
                payload.actual_qty = splitTotalKg;
            } else if (supportsDiscreteOutputRolls && createRollRowsParsed.length > 1) {
                if (createRollTotalKg > maxOutputWithScrapKg + 0.001) throw new Error(`Roll output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`);
                payload.roll_outputs = createRollRowsParsed.map((row) => ({
                    width_mm: row.width_mm,
                    weight_kg: row.weight_kg,
                    ...(row.length_m && row.length_m > 0 ? { length_m: row.length_m } : {}),
                }));
                payload.actual_qty = createRollTotalKg;
            } else {
                let qty = toNumber(outputWeightKg, NaN);
                if (showPcsEntry) {
                    const pcs = toNumber(outputPcs, NaN);
                    if (!Number.isFinite(pcs) || pcs <= 0) throw new Error('Output PCS is required for roll to bulk steps.');
                    payload.output_pcs = Math.max(1, Math.round(pcs));
                    if (!Number.isFinite(qty) || qty <= 0) {
                        if (unitWeightG <= 0) throw new Error('Unit weight is required to convert PCS to KG.');
                        qty = (payload.output_pcs * unitWeightG) / 1000;
                    }
                }
                if (!Number.isFinite(qty) || qty <= 0) throw new Error('Output weight must be greater than zero.');
                if (qty > maxOutputWithScrapKg + 0.001) throw new Error(`Output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`);
                payload.actual_qty = qty;
            }

            if (supportsDiscreteOutputRolls) {
                const width = toNumber(outputWidthMm, NaN);
                if (!Number.isFinite(width) || width <= 0) throw new Error('Output width is required for roll output.');
                payload.output_width_mm = width;
                const length = toNumber(outputLengthM, NaN);
                if (Number.isFinite(length) && length > 0) payload.output_length_m = length;
            }
            return machineService.logOutput(machineId, String(selectedJob.id), payload);
        },
        onSuccess: async () => {
            toast({ title: 'Output logged', description: 'Progress, scrap, and inventory math refreshed.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Log output failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to log output.' }),
    });

    const completeMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            const material_confirmations = Object.values(materialConfirmations)
                .map((draft) => ({
                    requirement_id: draft.requirement_id,
                    material_id: draft.material_id,
                    actual_issued_qty: Math.max(0, toNumber(draft.actual_issued_qty, 0)),
                    actual_returned_qty: Math.max(0, toNumber(draft.actual_returned_qty, 0)),
                    actual_scrap_qty: Math.max(0, toNumber(draft.actual_scrap_qty, 0)),
                    is_estimated: draft.is_estimated,
                    return_mode: draft.return_mode || 'EXACT_COLOR_RETURN',
                    target_ink_material_id: draft.return_mode === 'REMIXED_RETURN' ? draft.target_ink_material_id : undefined,
                    granule_code_allocations: (draft.granule_code_allocations || [])
                        .map((row) => ({ granule_code_id: row.granule_code_id, qty_kg: Math.max(0, toNumber(row.qty_kg, 0)) }))
                        .filter((row) => row.granule_code_id && row.qty_kg > 0),
                }))
                .filter((row) => row.requirement_id);
            return machineService.completeJob(machineId, String(selectedJob.id), {
                force_reason: forceReason.trim() || undefined,
                material_confirmations: material_confirmations.length ? material_confirmations : undefined,
            });
        },
        onSuccess: async (data) => {
            toast({
                title: data?.completion_mode === 'FORCED_VARIANCE' ? 'Step force-completed' : 'Step completed',
                description: data?.completion_mode === 'FORCED_VARIANCE' ? `Variance ${kg(data?.variance_kg)}` : 'Routing advanced with current-step actuals.',
            });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Complete failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to complete step.' }),
    });

    const scrapMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.logScrap(machineId, String(selectedJob.id), {
                quantity: Math.max(0, toNumber(scrapDialogQty, 0)),
                reason: scrapDialogReason,
                notes: scrapDialogNotes,
            });
        },
        onSuccess: async () => {
            setSublog(null);
            setScrapDialogQty('0');
            toast({ title: 'Scrap logged', description: 'Scrap is now visible in live events.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Scrap failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to log scrap.' }),
    });

    const downtimeMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            return machineService.logDowntime(machineId, String(selectedJob.id), {
                reason: downtimeReason,
                start_time: downtimeStart ? new Date(downtimeStart).toISOString() : undefined,
                end_time: downtimeEnd ? new Date(downtimeEnd).toISOString() : undefined,
                notes: downtimeNotes,
                auto_stop: downtimeAutoStop,
            });
        },
        onSuccess: async () => {
            setSublog(null);
            toast({ title: 'Downtime logged', description: downtimeAutoStop ? 'Machine step was paused.' : 'Downtime event was recorded.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Downtime failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to log downtime.' }),
    });

    const consumptionMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            if (!consumptionMaterialId && consumptionRollId === SELECT_NONE) throw new Error('Select material or roll.');
            const qty = toNumber(consumptionQty, NaN);
            if (!Number.isFinite(qty) || qty <= 0) throw new Error('Consumption quantity must be greater than zero.');
            return machineService.logConsumption(machineId, String(selectedJob.id), {
                material_id: consumptionMaterialId || undefined,
                granule_code_id: consumptionGranuleCodeId !== SELECT_NONE ? consumptionGranuleCodeId : undefined,
                roll_id: consumptionRollId !== SELECT_NONE ? consumptionRollId : undefined,
                quantity: qty,
                uom: 'KG',
                is_estimated: consumptionEstimated,
            });
        },
        onSuccess: async () => {
            setSublog(null);
            setConsumptionQty('');
            toast({ title: 'Consumption logged', description: 'Manual material usage is now in the job event stream.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Consumption failed', description: err?.response?.data?.error || err?.message || 'Unable to log consumption.' }),
    });

    const qualityMutation = useMutation({
        mutationFn: async () => {
            if (!selectedJob) throw new Error('Select a job first.');
            const readings = qualityRows
                .filter((row) => row.value.trim())
                .map((row) => ({
                    code: row.code,
                    value_numeric: row.textMode ? null : toNumber(row.value, NaN),
                    value_text: row.textMode ? row.value : '',
                    spec_min: row.spec_min,
                    spec_max: row.spec_max,
                    in_spec: row.in_spec,
                }))
                .filter((row) => row.value_text || Number.isFinite(row.value_numeric as number));
            if (!readings.length) throw new Error('Enter at least one quality reading.');
            return machineService.logQuality(machineId, String(selectedJob.id), { readings });
        },
        onSuccess: async () => {
            setSublog(null);
            toast({ title: 'Quality logged', description: 'Readings are attached to this job and process.' });
            await refreshAll();
        },
        onError: (err: any) => toast({ variant: 'destructive', title: 'Quality failed', description: err?.response?.data?.error?.message || err?.message || 'Unable to log quality.' }),
    });

    const handleOutputWeightChange = (value: string) => {
        setOutputWeightDirty(true);
        let next = value;
        const parsed = toNumber(value, NaN);
        if (Number.isFinite(parsed) && parsed > maxOutputWithScrapKg && maxOutputWithScrapKg > 0) next = maxOutputWithScrapKg.toFixed(3);
        setOutputWeightKg(next);
        if (showPcsEntry && outputEntryMode === 'KG' && unitWeightG > 0) {
            const kgValue = toNumber(next, NaN);
            setOutputPcs(Number.isFinite(kgValue) && kgValue > 0 ? String(Math.max(1, Math.round((kgValue * 1000) / unitWeightG))) : '');
        }
    };

    const handleOutputPcsChange = (value: string) => {
        setOutputPcs(value);
        if (!showPcsEntry || outputEntryMode !== 'PCS' || unitWeightG <= 0) return;
        const pcs = toNumber(value, NaN);
        setOutputWeightDirty(false);
        setOutputWeightKg(Number.isFinite(pcs) && pcs > 0 ? ((Math.round(pcs) * unitWeightG) / 1000).toFixed(3) : '');
    };

    const addCreateRollRow = () => setCreateRollRows((prev) => [...prev, { id: createCounterRef.current++, width_mm: outputWidthMm, weight_kg: '', length_m: '' }]);
    const addSplitRow = () => setSplitRows((prev) => [...prev, { id: splitCounterRef.current++, width_mm: '', weight_kg: '' }]);
    const updateCreateRow = (id: number, key: keyof CreateRollRow, value: string) => setCreateRollRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    const updateSplitRow = (id: number, key: keyof SplitRow, value: string) => setSplitRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
    const updateMaterialConfirmation = (requirementId: string, patch: Partial<MaterialConfirmationDraft>) => {
        setMaterialConfirmations((prev) => ({
            ...prev,
            [requirementId]: { ...prev[requirementId], ...patch },
        }));
    };
    const autoSplitEqual = (parts?: number) => {
        const rowCount = Math.max(1, parts || createRollRows.length + 1);
        const total = Math.max(previewOutputKg, toNumber(outputWeightKg, 0));
        const width = outputWidthMm || String(resolveCreateNewDefaultWidth(context) || '');
        if (rowCount <= 1 || total <= 0) return;
        const each = (total / rowCount).toFixed(3);
        setCreateRollRows((prev) => {
            const next = [...prev];
            while (next.length < rowCount - 1) {
                next.push({ id: createCounterRef.current++, width_mm: width, weight_kg: '', length_m: outputLengthM });
            }
            return next.slice(0, rowCount - 1).map((row) => ({ ...row, width_mm: row.width_mm || width, weight_kg: each, length_m: row.length_m || outputLengthM }));
        });
        setOutputWeightKg(each);
    };

    if (!machineId) {
        return <div className="p-6 text-sm text-rose-700">Missing machine id in route.</div>;
    }

    if (machineLoading || queueLoading) {
        return (
            <div className="min-h-screen bg-slate-50 p-6">
                <div className={cn(surfaceClass, 'p-8 text-center text-sm font-semibold text-slate-500')}>Loading machine terminal...</div>
            </div>
        );
    }

    if (machineError || queueError) {
        return (
            <div className="min-h-screen bg-slate-50 p-6">
                <div className={cn(surfaceClass, 'flex items-start gap-3 border-rose-200 p-6 text-rose-700')}>
                    <AlertCircle className="mt-0.5 h-5 w-5" />
                    <div>
                        <div className="font-black">Failed to load machine terminal</div>
                        <div className="text-sm font-semibold text-rose-600">Refresh and try again.</div>
                    </div>
                </div>
            </div>
        );
    }

    const machineName = firstNonEmpty(machineDetail?.machine?.name, machineDetail?.machine?.code, 'Machine Terminal');
    const machineCode = firstNonEmpty(machineDetail?.machine?.code, machineDetail?.machine?.name, 'Machine');
    const customerName = firstNonEmpty(spec.customerName, context?.job?.customer_name, selectedJob?.customer_name, 'Stock production');
    const orderNumber = firstNonEmpty(spec.orderNumber, context?.job?.order_number, selectedJob?.order_number, selectedJob?.job_number, 'STOCK');
    const historyRows = Array.isArray((historyData as any)?.jobs) ? (historyData as any).jobs : [];

    return (
        <div
            className="min-h-screen bg-[radial-gradient(900px_500px_at_0%_-10%,#e0f2fe_0%,transparent_55%),radial-gradient(900px_500px_at_100%_-10%,#ddd6fe_0%,transparent_55%),linear-gradient(180deg,#fff_0%,#f8fafc_100%)] text-[#0b1220]"
            data-testid="machine-execution-page"
        >
            <span className="sr-only">Kiosk focus for operators Select job Start / resume Log output Idle machine</span>
            <div className="mx-auto max-w-[1520px] px-4 py-4 md:px-6 md:py-5">
                <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 font-bold text-white">M</div>
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Total Poly Print ERP</div>
                            <div className="text-sm font-bold">Production · Machine Terminal</div>
                        </div>
                    </div>
                </div>

                <section className={cn(surfaceClass, 'mb-4 p-4')}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-center gap-3">
                            <Button type="button" variant="outline" className="h-10 rounded-[10px] border-slate-200 bg-white text-xs font-bold" onClick={() => router.push('/production/work-center')}>
                                <ArrowLeft className="mr-1 h-4 w-4" />
                                WCM
                            </Button>
                            <div className="flex items-center gap-2">
                                <span className={cn('h-2.5 w-2.5 rounded-full', isExecuting ? 'bg-blue-500' : isPaused ? 'bg-amber-500' : 'bg-emerald-500')} />
                                <div>
                                    <h1 className="text-lg font-black tracking-tight">{machineName}</h1>
                                    <div className="font-mono text-[11px] text-slate-500">
                                        {machineCode} · {machineDetail?.machine?.work_center_name || 'Work center'} · {machineDetail?.machine?.plant_name || 'Plant'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant={activeTab === 'history' ? 'default' : 'outline'} className={cn('h-10 rounded-[10px] text-sm font-semibold', activeTab === 'history' && 'bg-slate-950 text-white hover:bg-slate-900')} onClick={() => setActiveTab('history')}>
                                <History className="mr-2 h-4 w-4" />
                                History
                            </Button>
                            {activeTab === 'history' ? (
                                <Button type="button" variant="outline" className="h-10 rounded-[10px] text-sm font-semibold" onClick={() => setActiveTab('run')}>
                                    <Activity className="mr-2 h-4 w-4" />
                                    Back to live
                                </Button>
                            ) : null}
                            <Button type="button" variant="outline" className="h-10 rounded-[10px] border-slate-200 bg-white text-sm font-semibold" onClick={() => refreshAll()}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Refresh
                            </Button>
                            {isExecuting ? (
                                <Button type="button" className="h-10 rounded-[10px] bg-gradient-to-br from-amber-500 to-orange-500 text-sm font-semibold text-white" data-testid="machine-stop-step" disabled={!canStop || stopMutation.isPending} onClick={() => stopMutation.mutate()}>
                                    <Pause className="mr-2 h-4 w-4" />
                                    Pause
                                </Button>
                            ) : (
                                <Button type="button" className="h-10 rounded-[10px] bg-gradient-to-br from-emerald-600 to-emerald-500 text-sm font-semibold text-white" data-testid="machine-start-step" disabled={!canStart || startMutation.isPending} onClick={() => startMutation.mutate()}>
                                    <Play className="mr-2 h-4 w-4" />
                                    {isPaused ? 'Resume job' : 'Start job'}
                                </Button>
                            )}
                        </div>
                    </div>
                </section>

                {activeTab === 'history' ? (
                    <HistoryPanel
                        historyRows={historyRows}
                        historyLoading={historyLoading}
                        historyDateFrom={historyDateFrom}
                        historyDateTo={historyDateTo}
                        historyStatus={historyStatus}
                        setHistoryDateFrom={setHistoryDateFrom}
                        setHistoryDateTo={setHistoryDateTo}
                        setHistoryStatus={setHistoryStatus}
                    />
                ) : (
                    <>
                        <section className={cn(surfaceClass, 'mb-4 p-5')} style={{ background: 'linear-gradient(180deg,#eff6ff 0%, #fff 100%)' }}>
                            <div className="grid gap-4 xl:grid-cols-12 xl:items-center">
                                <div className="xl:col-span-5">
                                    <div className="mb-1 flex flex-wrap items-center gap-2">
                                        <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700">{customerName}</span>
                                        <span className="font-mono text-[11px] text-slate-500">{orderNumber}</span>
                                        <span className={cn('inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide', stateBadgeClass(jobState))}>{jobState || 'No job'}</span>
                                    </div>
                                    <h2 className="text-3xl font-black tracking-tight">{spec.productName || selectedJob?.product_name || 'Pick a released job'}</h2>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {chips.map((chip) => (
                                            <span key={`${chip.label}-${chip.tone}`} className={cn('inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold', chip.tone)}>
                                                {chip.label}
                                            </span>
                                        ))}
                                        <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] font-semibold text-yellow-300">{behavior}</span>
                                    </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-3 xl:col-span-5">
                                    <KpiCard label="Target" value={kg(targetKg)} tone="blue" />
                                    <KpiCard label="Produced" value={kg(producedKg)} tone="emerald" />
                                    <KpiCard label="Remaining" value={kg(remainingKg)} tone="amber" />
                                </div>
                                <div className="flex items-center gap-3 xl:col-span-2">
                                    <ProgressRing value={progressPct} />
                                    <div>
                                        <div className={labelClass}>Current step</div>
                                        <div className="mt-0.5 text-sm font-bold">{stepName}</div>
                                        <div className="text-[11px] text-slate-500">{stepTransform}</div>
                                        <span className="mt-1 inline-flex rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] font-semibold text-yellow-300">{behaviorLabel(behavior)}</span>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <div className="grid gap-4 xl:grid-cols-12">
                            <aside className="space-y-3 xl:col-span-3">
                                <QueueRail
                                    visibleQueueItems={visibleQueueItems}
                                    queueItems={queueItems}
                                    selectedId={selectedId}
                                    queueSearch={queueSearch}
                                    setQueueSearch={setQueueSearch}
                                    queueStatusFilter={queueStatusFilter}
                                    setQueueStatusFilter={setQueueStatusFilter}
                                    setSelectedJobId={setSelectedJobId}
                                    refreshAll={refreshAll}
                                />
                            </aside>

                            <main className="space-y-3 xl:col-span-6">
                                <RouteStepper
                                    stepName={stepName}
                                    stepTransform={stepTransform}
                                    behavior={behavior}
                                    jobState={jobState}
                                    isExecuting={isExecuting}
                                    isPaused={isPaused}
                                    allocationReady={allocationReady}
                                    producedKg={producedKg}
                                    remainingKg={remainingKg}
                                    targetKg={targetKg}
                                    progressPct={progressPct}
                                    canStart={canStart}
                                    canLogOutput={canLogOutput}
                                    canComplete={canComplete}
                                    nextAction={operatorNextStep}
                                />

                                <section className={cn(surfaceClass, 'overflow-hidden border-2 border-blue-500')} id="machine-output-panel" data-testid="machine-output-panel">
                                    <span className="sr-only">Enter only the fields this step needs.</span>
                                    <div className="flex items-center justify-between gap-3 bg-gradient-to-br from-sky-500 to-blue-600 px-5 py-3 text-white">
                                        <div>
                                            <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">Log output · primary action</div>
                                            <div className="mt-0.5 text-lg font-black">{variantTitle(variant, stepName, behavior)}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" variant="secondary" className="h-8 rounded-lg bg-white/15 text-xs font-bold text-white hover:bg-white/20" data-testid="machine-stage-output" onClick={() => document.getElementById('machine-output-panel')?.scrollIntoView({ block: 'center' })}>
                                                Focus
                                            </Button>
                                        </div>
                                    </div>

                                    {isPaused ? (
                                        <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-semibold text-amber-900">
                                            Step is paused. Resume the job before logging output.
                                        </div>
                                    ) : null}
                                    {!allocationReady ? (
                                        <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm font-semibold text-rose-900">
                                            Required input allocation is not ready for this step.
                                        </div>
                                    ) : null}

                                    <div className="p-5">
                                        <div className="mb-4 grid gap-3 sm:grid-cols-3">
                                            <MetricTile label="Output handling" value={behaviorLabel(behavior)} tone="blue" />
                                            <MetricTile label="Max this log" value={kg(maxOutputWithScrapKg)} tone="slate" />
                                            <MetricTile label="Close tolerance" value={qtyLabel(stepTolerancePrimary, primaryUom)} tone="amber" />
                                        </div>

                                        <ProcessLogForm
                                            variant={variant}
                                            behavior={behavior}
                                            showPcsEntry={showPcsEntry}
                                            outputEntryMode={outputEntryMode}
                                            setOutputEntryMode={setOutputEntryMode}
                                            outputWeightKg={outputWeightKg}
                                            handleOutputWeightChange={handleOutputWeightChange}
                                            outputPcs={outputPcs}
                                            handleOutputPcsChange={handleOutputPcsChange}
                                            unitWeightG={unitWeightG}
                                            outputWidthMm={outputWidthMm}
                                            setOutputWidthMm={(value: string) => {
                                                setOutputWidthDirty(true);
                                                setOutputWidthMm(value);
                                            }}
                                            outputLengthM={outputLengthM}
                                            setOutputLengthM={setOutputLengthM}
                                            createRollRows={createRollRows}
                                            addCreateRollRow={addCreateRollRow}
                                            updateCreateRow={updateCreateRow}
                                            removeCreateRow={(id: number) => setCreateRollRows((prev) => prev.filter((row) => row.id !== id))}
                                            autoSplitEqual={autoSplitEqual}
                                            splitRows={splitRows}
                                            addSplitRow={addSplitRow}
                                            updateSplitRow={updateSplitRow}
                                            removeSplitRow={(id: number) => setSplitRows((prev) => (prev.length <= 1 ? prev : prev.filter((row) => row.id !== id)))}
                                            reservedRolls={reservedRolls}
                                            previewOutputKg={previewOutputKg}
                                            previewOutputPcs={previewOutputPcs}
                                            trimInput={trimInput}
                                            setTrimInput={setTrimInput}
                                            scrapInput={scrapInput}
                                            setScrapInput={setScrapInput}
                                            scrapEntryMode={scrapEntryMode}
                                            setScrapEntryMode={setScrapEntryMode}
                                            remainderLocations={remainderLocations}
                                            remainderLocationId={remainderLocationId}
                                            setRemainderLocationId={setRemainderLocationId}
                                            selectedMaterial={selectedMaterial}
                                            materialConfirmations={materialConfirmations}
                                            reconcilableBulkRows={reconcilableBulkRows}
                                            updateMaterialConfirmation={updateMaterialConfirmation}
                                        />

                                        {exceedsOutputCap ? (
                                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900">
                                                Output preview {kg(previewOutputKg)} exceeds the current physical cap {kg(maxOutputWithScrapKg)}.
                                            </div>
                                        ) : null}
                                    </div>

                                    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                                        <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <Button type="button" variant="outline" className="h-9 rounded-[10px] bg-white text-xs font-semibold" onClick={() => { setScrapDialogQty(scrapInput || '0'); setScrapDialogReason(scrapReason); setSublog('scrap'); }}>
                                                + Scrap
                                            </Button>
                                            <Button type="button" variant="outline" className="h-9 rounded-[10px] bg-white text-xs font-semibold" onClick={() => { setDowntimeStart(toDateTimeLocal()); setSublog('downtime'); }}>
                                                + Downtime
                                            </Button>
                                            <Button type="button" variant="outline" className="h-9 rounded-[10px] bg-white text-xs font-semibold" onClick={() => setSublog('consumption')}>
                                                + Consumption
                                            </Button>
                                            <Button type="button" variant="outline" className="h-9 rounded-[10px] bg-white text-xs font-semibold" onClick={() => { setQualityRows(qualityPreset(variant)); setSublog('quality'); }}>
                                                + Quality
                                            </Button>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {needsForceComplete ? (
                                                <Input value={forceReason} onChange={(event) => setForceReason(event.target.value)} placeholder="Variance reason required" className="h-9 min-w-[220px] rounded-[10px] border-amber-200 bg-amber-50 text-xs font-semibold" />
                                            ) : null}
                                            <Button type="button" className="h-10 rounded-[10px] bg-gradient-to-br from-sky-500 to-blue-600 text-sm font-semibold text-white" data-testid="machine-log-output" disabled={!canLogOutput || logOutputMutation.isPending} onClick={() => logOutputMutation.mutate()}>
                                                <Save className="mr-2 h-4 w-4" />
                                                Log output
                                            </Button>
                                            <Button type="button" className="h-10 rounded-[10px] bg-gradient-to-br from-emerald-600 to-emerald-500 text-sm font-semibold text-white" data-testid="machine-finalize-step" disabled={!canComplete || completeMutation.isPending} onClick={() => completeMutation.mutate()}>
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                                Complete step →
                                            </Button>
                                        </div>
                                    </div>
                                </section>

                            </main>

                            <aside className="space-y-3 xl:col-span-3">
                                <RollsWipCard rolls={rightRailRolls} />
                                <ExecutionHealthCard allocationReady={allocationReady} shortage={toNumber((context?.telemetry?.execution_health as any)?.roll_shortage_count ?? (context?.satisfaction as any)?.rolls_missing, 0)} producedKg={producedKg} targetKg={targetKg} remainingKg={remainingKg} nextAction={operatorNextStep} contextLoading={contextLoading} />
                                <LiveEventsCard events={events} loading={eventsLoading} />
                            </aside>
                        </div>
                    </>
                )}
            </div>

            <SublogDialog
                sublog={sublog}
                setSublog={setSublog}
                selectedJob={selectedJob}
                scrapDialogQty={scrapDialogQty}
                setScrapDialogQty={setScrapDialogQty}
                scrapDialogReason={scrapDialogReason}
                setScrapDialogReason={setScrapDialogReason}
                scrapDialogNotes={scrapDialogNotes}
                setScrapDialogNotes={setScrapDialogNotes}
                scrapMutationPending={scrapMutation.isPending}
                onSaveScrap={() => scrapMutation.mutate()}
                downtimeReason={downtimeReason}
                setDowntimeReason={setDowntimeReason}
                downtimeStart={downtimeStart}
                setDowntimeStart={setDowntimeStart}
                downtimeEnd={downtimeEnd}
                setDowntimeEnd={setDowntimeEnd}
                downtimeAutoStop={downtimeAutoStop}
                setDowntimeAutoStop={setDowntimeAutoStop}
                downtimeNotes={downtimeNotes}
                setDowntimeNotes={setDowntimeNotes}
                downtimeMutationPending={downtimeMutation.isPending}
                onSaveDowntime={() => downtimeMutation.mutate()}
                materialOptions={materialOptions}
                consumptionMaterialId={consumptionMaterialId}
                setConsumptionMaterialId={setConsumptionMaterialId}
                filteredGranuleCodes={filteredGranuleCodes}
                consumptionGranuleCodeId={consumptionGranuleCodeId}
                setConsumptionGranuleCodeId={setConsumptionGranuleCodeId}
                reservedRolls={reservedRolls}
                consumptionRollId={consumptionRollId}
                setConsumptionRollId={setConsumptionRollId}
                consumptionQty={consumptionQty}
                setConsumptionQty={setConsumptionQty}
                consumptionEstimated={consumptionEstimated}
                setConsumptionEstimated={setConsumptionEstimated}
                consumptionPending={consumptionMutation.isPending}
                onSaveConsumption={() => consumptionMutation.mutate()}
                qualityRows={qualityRows}
                setQualityRows={setQualityRows}
                qualityPending={qualityMutation.isPending}
                onSaveQuality={() => qualityMutation.mutate()}
            />
        </div>
    );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'emerald' | 'amber' }) {
    const tones = {
        blue: 'border-l-blue-500 bg-white text-slate-950',
        emerald: 'border-l-emerald-500 bg-emerald-50 text-emerald-800',
        amber: 'border-l-amber-500 bg-amber-50 text-amber-800',
    };
    return (
        <div className={cn('rounded-[14px] border border-slate-200 border-l-[3px] p-3', tones[tone])}>
            <div className={labelClass}>{label}</div>
            <div className="mt-1 font-mono text-2xl font-black">{value}</div>
        </div>
    );
}

function ProgressRing({ value }: { value: number }) {
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (circumference * Math.round(value)) / 100;
    return (
        <div className="relative h-16 w-16">
            <svg className="-rotate-90" width="64" height="64" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r={radius} stroke="#e2e8f0" strokeWidth="6" fill="none" />
                <circle cx="32" cy="32" r={radius} stroke="url(#machine-ring)" strokeWidth="6" fill="none" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />
                <defs>
                    <linearGradient id="machine-ring" x1="0" x2="1">
                        <stop offset="0%" stopColor="#0ea5e9" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                </defs>
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-sm font-black">{Math.round(value)}%</div>
        </div>
    );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'slate' | 'amber' }) {
    const classes = tone === 'blue' ? 'border-blue-100 bg-blue-50 text-blue-950' : tone === 'amber' ? 'border-amber-100 bg-amber-50 text-amber-950' : 'border-slate-200 bg-slate-50 text-slate-950';
    return (
        <div className={cn('rounded-xl border px-3 py-2', classes)}>
            <div className={cn(labelClass, tone === 'blue' && 'text-blue-700', tone === 'amber' && 'text-amber-700')}>{label}</div>
            <div className="mt-1 text-sm font-black">{value}</div>
        </div>
    );
}

function QueueRail({ visibleQueueItems, queueItems, selectedId, queueSearch, setQueueSearch, queueStatusFilter, setQueueStatusFilter, setSelectedJobId, refreshAll }: any) {
    return (
        <section className={cn(surfaceClass, 'p-4')}>
            <div className="mb-3 flex items-center justify-between">
                <div>
                    <div className={labelClass}>Queue</div>
                    <div className="mt-0.5 text-base font-black">{visibleQueueItems.length} visible</div>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-9 rounded-[10px] bg-white" onClick={() => refreshAll()}>
                    <RefreshCw className="h-4 w-4" />
                </Button>
            </div>
            <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search customer, size, grade" className={cn(inputClass, 'pl-9')} />
            </div>
            <div className="mb-3 grid grid-cols-2 gap-1.5 text-xs">
                {([
                    ['ALL', 'All'],
                    ['RUNNING', 'Run'],
                    ['READY', 'Ready'],
                    ['PAUSED', 'Hold'],
                ] as const).map(([value, label]) => (
                    <Button
                        key={value}
                        type="button"
                        variant="outline"
                        className={cn('h-9 rounded-full text-xs font-semibold', queueStatusFilter === value ? 'border-transparent bg-gradient-to-br from-sky-500 to-blue-600 text-white' : 'border-slate-200 bg-white text-slate-700')}
                        onClick={() => setQueueStatusFilter(value)}
                    >
                        {label}
                    </Button>
                ))}
            </div>
            <div className="max-h-[calc(100vh-430px)] space-y-2 overflow-y-auto pr-1">
                {visibleQueueItems.length ? visibleQueueItems.map((job: any) => {
                    const spec = normalizeProductSpec(job);
                    const selected = String(job.id) === String(selectedId);
                    return (
                        <button
                            key={job.id}
                            type="button"
                            data-testid={`machine-job-card-${job.id}`}
                            className={cn(
                                'w-full rounded-[14px] border p-3 text-left transition',
                                selected ? 'border-blue-500 bg-gradient-to-b from-blue-50 to-white shadow-[0_8px_18px_-10px_rgba(59,130,246,0.4)]' : 'border-slate-200 bg-white hover:border-blue-400'
                            )}
                            onClick={() => setSelectedJobId(String(job.id))}
                        >
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="truncate text-sm font-semibold">{spec.customerName}</div>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', stateBadgeClass(job.job_state))}>{job.job_state || 'ready'}</span>
                            </div>
                            <div className="mb-1 font-mono text-[11px] text-slate-500">{job.job_number} · {spec.productName} · {kg(job.step_remaining_kg ?? job.quantity, 0)}</div>
                            <div className="mt-1 rounded-lg border border-blue-100 bg-blue-50 p-2 text-[11px]">
                                <div className="font-semibold text-blue-900">{spec.size?.label || 'Size not captured'}</div>
                                <div className="font-mono text-slate-500">{(spec.layers || []).slice(0, 2).map((layer: any) => layer.label).join(' · ') || job.process_code || 'Step'}</div>
                            </div>
                        </button>
                    );
                }) : (
                    <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 p-5 text-center text-xs font-semibold text-slate-500">
                        {queueItems.length ? 'No jobs match this filter.' : 'No released jobs are waiting here.'}
                    </div>
                )}
            </div>
        </section>
    );
}

function RouteStepper({
    stepName,
    stepTransform,
    behavior,
    jobState,
    isExecuting,
    isPaused,
    allocationReady,
    producedKg,
    remainingKg,
    targetKg,
    progressPct,
    canStart,
    canLogOutput,
    canComplete,
    nextAction,
}: any) {
    const hasJob = Boolean(jobState);
    const statusLabel = !hasJob ? 'Waiting for job' : isExecuting ? 'Running live' : isPaused ? 'Paused' : canStart ? 'Ready to start' : jobState;
    const statusTone = !hasJob
        ? 'border-slate-200 bg-slate-50 text-slate-600'
        : isExecuting
          ? 'border-blue-200 bg-blue-50 text-blue-800'
          : isPaused
            ? 'border-amber-200 bg-amber-50 text-amber-800'
            : canStart
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-slate-200 bg-white text-slate-700';
    const nextLabel = !hasJob
        ? 'Select released job'
        : !allocationReady
          ? 'Reserve input'
          : canStart
            ? 'Start job'
            : isPaused
              ? 'Resume job'
              : canLogOutput
                ? 'Log output'
                : canComplete
                  ? 'Complete step'
                  : nextAction;
    const steps = [
        { eyebrow: 'Gate', label: 'WCM released', detail: 'Ready queue', state: hasJob ? 'done' : 'pending' },
        { eyebrow: 'Machine', label: 'Ready', detail: allocationReady ? 'Input ready' : 'Input pending', state: !hasJob ? 'pending' : allocationReady ? 'done' : 'current' },
        { eyebrow: 'Now', label: stepName, detail: `${stepTransform} · ${behaviorLabel(behavior)}`, state: isExecuting ? 'current' : hasJob && (canStart || isPaused) ? 'current' : 'pending' },
        { eyebrow: 'Output', label: 'Log output', detail: producedKg > 0 ? `${kg(producedKg)} logged` : 'Awaiting entry', state: producedKg > 0 ? 'done' : isExecuting ? 'current' : 'pending' },
        { eyebrow: 'Close', label: 'Complete step', detail: remainingKg > 0 ? `${kg(remainingKg)} remaining` : 'Ready to close', state: canComplete ? 'current' : 'pending' },
    ];
    return (
        <section className={cn(surfaceClass, 'p-5 md:p-6')}>
            <div className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
                <div>
                    <div className={labelClass}>Current status</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={cn('inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-black', statusTone)}>{statusLabel}</span>
                        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-black text-amber-900">
                            Remaining {kg(remainingKg)}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-black text-sky-900">
                            Next · {nextLabel}
                        </span>
                    </div>
                </div>
                <div className="min-w-[170px] rounded-[16px] border border-slate-200 bg-white p-3 shadow-sm">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                        <span>Progress</span>
                        <span>{Math.round(progressPct)}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500" style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
                    </div>
                    <div className="mt-2 text-xs font-semibold text-slate-500">{kg(producedKg)} / {kg(targetKg)}</div>
                </div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div className={labelClass}>Live route</div>
                <div className="text-xs font-semibold text-slate-500">Shows what is done, active, and still pending for this machine step.</div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-5">
                {steps.map((step, index) => (
                    <div key={step.label} className="flex items-stretch">
                        <div
                            className={cn(
                                'flex min-h-[104px] w-full items-start gap-3 rounded-[16px] border px-3.5 py-3 text-left transition',
                                step.state === 'done' && 'border-emerald-200 bg-emerald-50 text-emerald-900',
                                step.state === 'current' && 'border-transparent bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-[0_14px_28px_-18px_rgba(37,99,235,0.9)]',
                                step.state === 'pending' && 'border-slate-200 bg-slate-50 text-slate-500'
                            )}
                        >
                            <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black', step.state === 'current' ? 'bg-white text-sky-600' : step.state === 'done' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-500')}>
                                {step.state === 'done' ? '✓' : index + 1}
                            </span>
                            <span className="min-w-0">
                                <span className={cn('block text-[10px] font-black uppercase tracking-[0.18em]', step.state === 'current' ? 'text-white/75' : 'text-slate-400')}>{step.eyebrow}</span>
                                <span className="mt-1 block text-sm font-black leading-tight">{step.label}</span>
                                <span className={cn('mt-1 block text-xs font-semibold leading-4', step.state === 'current' ? 'text-white/80' : 'text-slate-500')}>{step.detail}</span>
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}

function ProcessLogForm(props: any) {
    const {
        variant,
        showPcsEntry,
        outputEntryMode,
        setOutputEntryMode,
        outputWeightKg,
        handleOutputWeightChange,
        outputPcs,
        handleOutputPcsChange,
        unitWeightG,
        outputWidthMm,
        setOutputWidthMm,
        outputLengthM,
        setOutputLengthM,
        createRollRows,
        addCreateRollRow,
        updateCreateRow,
        removeCreateRow,
        autoSplitEqual,
        splitRows,
        addSplitRow,
        updateSplitRow,
        removeSplitRow,
        reservedRolls,
        previewOutputKg,
        previewOutputPcs,
        trimInput,
        setTrimInput,
        scrapInput,
        setScrapInput,
        scrapEntryMode,
        setScrapEntryMode,
        remainderLocations,
        remainderLocationId,
        setRemainderLocationId,
        materialConfirmations,
        reconcilableBulkRows,
        updateMaterialConfirmation,
    } = props;

    return (
        <div className="space-y-4">
            {showPcsEntry ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className={labelClass}>Entry mode</div>
                            <div className="text-xs font-semibold text-slate-600">{unitWeightG > 0 ? `PCS and KG are linked at ${unitWeightG} g/pc.` : 'Unit weight is missing; enter both PCS and KG carefully.'}</div>
                        </div>
                        <div className="flex gap-1">
                            {(['PCS', 'KG'] as EntryMode[]).map((mode) => (
                                <Button key={mode} type="button" size="sm" variant="outline" className={cn('h-8 rounded-lg text-xs font-bold', outputEntryMode === mode ? 'border-transparent bg-slate-950 text-white' : 'bg-white')} onClick={() => setOutputEntryMode(mode)}>
                                    {mode}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}

            {variant === 'slitting' ? (
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label className={labelClass}>Input roll</Label>
                        <Select value={reservedRolls[0]?.id || SELECT_NONE}>
                            <SelectTrigger className={cn(inputClass, 'mt-1 font-mono')}><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {reservedRolls.length ? reservedRolls.map((roll: any) => <SelectItem key={roll.id} value={roll.id}>{roll.label_id} · {kg(roll.weight_kg)}</SelectItem>) : <SelectItem value={SELECT_NONE}>No roll reserved</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className={labelClass}>Width math</div>
                        <div className="mt-1 font-mono text-sm font-bold">
                            {(reservedRolls[0]?.width_mm || 0).toFixed?.(0) || '0'} = {splitRows.map((row: SplitRow) => row.width_mm || '0').join(' + ')}
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold text-emerald-700">Checked before save by output cap.</div>
                    </div>
                </div>
            ) : variant === 'pouching' ? (
                <div className="grid gap-3 md:grid-cols-3">
                    <div>
                        <Label className={labelClass}>Input roll</Label>
                        <Select value={reservedRolls[0]?.id || SELECT_NONE}>
                            <SelectTrigger className={cn(inputClass, 'mt-1 font-mono')}><SelectValue /></SelectTrigger>
                            <SelectContent>
                                {reservedRolls.length ? reservedRolls.map((roll: any) => <SelectItem key={roll.id} value={roll.id}>{roll.label_id} · {kg(roll.weight_kg)}</SelectItem>) : <SelectItem value={SELECT_NONE}>No roll reserved</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className={labelClass}>Good output PCS</Label>
                        <div className="mt-1 flex items-center gap-1">
                            <Input data-testid="machine-output-pcs" value={outputPcs} onChange={(event) => handleOutputPcsChange(event.target.value)} className={cn(inputClass, 'font-mono text-base font-bold')} type="number" />
                            <span className="text-xs font-semibold text-slate-500">pcs</span>
                        </div>
                        <div className="mt-1 text-[10px] text-slate-500">≈ <b className="font-mono">{kg(previewOutputKg)}</b></div>
                    </div>
                    <div>
                        <Label className={labelClass}>Output kg</Label>
                        <div className="mt-1 flex items-center gap-1">
                            <Input data-testid="machine-output-weight" value={outputWeightKg} onChange={(event) => handleOutputWeightChange(event.target.value)} className={cn(inputClass, 'font-mono')} type="number" step="0.001" />
                            <span className="text-xs font-semibold text-slate-500">kg</span>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="grid gap-3 md:grid-cols-3">
                    <div>
                        <Label className={labelClass}>{variant === 'printing' ? 'Throughput good qty' : 'Total produced'}</Label>
                        <div className="mt-1 flex items-center gap-1">
                            <Input data-testid="machine-output-weight" value={outputWeightKg} onChange={(event) => handleOutputWeightChange(event.target.value)} className={cn(inputClass, 'font-mono text-base font-bold')} type="number" step="0.001" />
                            <span className="text-xs font-semibold text-slate-500">kg</span>
                        </div>
                    </div>
                    <div>
                        <Label className={labelClass}>Output width</Label>
                        <div className="mt-1 flex items-center gap-1">
                            <Input data-testid="machine-output-width" value={outputWidthMm} onChange={(event) => setOutputWidthMm(event.target.value)} className={cn(inputClass, 'font-mono')} type="number" />
                            <span className="text-xs text-slate-500">mm</span>
                        </div>
                    </div>
                    <div>
                        <Label className={labelClass}>Output length opt</Label>
                        <div className="mt-1 flex items-center gap-1">
                            <Input data-testid="machine-output-length" value={outputLengthM} onChange={(event) => setOutputLengthM(event.target.value)} className={cn(inputClass, 'font-mono')} type="number" />
                            <span className="text-xs text-slate-500">m</span>
                        </div>
                    </div>
                </div>
            )}

            {variant === 'extrusion' || variant === 'lamination' ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className={labelClass}>Roll outputs · auto labels</div>
                            <div className="mt-0.5 text-xs text-slate-600">{createRollRows.length + 1} roll rows · total produced {kg(previewOutputKg)}</div>
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="outline" className="h-9 rounded-[10px] bg-white text-xs font-semibold" disabled={createRollRows.length < 1} onClick={() => autoSplitEqual(createRollRows.length + 1)}>Balance current rows</Button>
                            <Button type="button" className="h-9 rounded-[10px] bg-gradient-to-br from-sky-500 to-blue-600 text-xs font-semibold text-white" data-testid="machine-add-create-row" onClick={addCreateRollRow}>
                                <Plus className="mr-1 h-3 w-3" />
                                Add roll
                            </Button>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/60 text-[10px] uppercase tracking-wider text-slate-500">
                                <tr><th className="p-2 pl-4 text-left">#</th><th className="p-2 text-left">Label</th><th className="p-2 text-right">Weight</th><th className="p-2 text-right">Width</th><th className="p-2 text-right">Length</th><th className="p-2" /></tr>
                            </thead>
                            <tbody>
                                <tr className="border-t border-slate-100">
                                    <td className="p-2 pl-4 font-mono text-xs text-slate-500">1</td>
                                    <td className="p-2 font-mono text-xs font-semibold">Auto label on save</td>
                                    <td className="p-2 text-right"><Input data-testid="machine-create-row-weight-0" value={outputWeightKg} onChange={(event) => handleOutputWeightChange(event.target.value)} className="ml-auto h-9 w-28 rounded-lg font-mono" /></td>
                                    <td className="p-2 text-right"><Input data-testid="machine-create-row-width-0" value={outputWidthMm} onChange={(event) => setOutputWidthMm(event.target.value)} className="ml-auto h-9 w-24 rounded-lg font-mono" /></td>
                                    <td className="p-2 text-right"><Input data-testid="machine-create-row-length-0" value={outputLengthM} onChange={(event) => setOutputLengthM(event.target.value)} className="ml-auto h-9 w-24 rounded-lg font-mono" /></td>
                                    <td />
                                </tr>
                                {createRollRows.map((row: CreateRollRow, index: number) => (
                                    <tr key={row.id} className="border-t border-slate-100">
                                        <td className="p-2 pl-4 font-mono text-xs text-slate-500">{index + 2}</td>
                                        <td className="p-2 font-mono text-xs font-semibold">Auto label on save</td>
                                        <td className="p-2 text-right"><Input data-testid={`machine-create-row-weight-${index + 1}`} value={row.weight_kg} onChange={(event) => updateCreateRow(row.id, 'weight_kg', event.target.value)} className="ml-auto h-9 w-28 rounded-lg font-mono" /></td>
                                        <td className="p-2 text-right"><Input data-testid={`machine-create-row-width-${index + 1}`} value={row.width_mm} onChange={(event) => updateCreateRow(row.id, 'width_mm', event.target.value)} className="ml-auto h-9 w-24 rounded-lg font-mono" /></td>
                                        <td className="p-2 text-right"><Input data-testid={`machine-create-row-length-${index + 1}`} value={row.length_m} onChange={(event) => updateCreateRow(row.id, 'length_m', event.target.value)} className="ml-auto h-9 w-24 rounded-lg font-mono" /></td>
                                        <td className="p-2 text-right"><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => removeCreateRow(row.id)}><Trash2 className="h-4 w-4" /></Button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="border-t border-slate-100 bg-emerald-50/60 px-4 py-2 text-right text-xs font-black uppercase tracking-wider text-emerald-800">
                        Total produced from rows: <span className="font-mono text-sm">{kg(previewOutputKg)}</span>
                    </div>
                </div>
            ) : null}

            {variant === 'slitting' ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 p-3">
                        <div>
                            <div className={labelClass}>Split outputs · child rolls</div>
                            <div className="mt-0.5 text-xs text-slate-600">Sum of children + edge trim must stay within input roll weight.</div>
                        </div>
                        <Button type="button" className="h-9 rounded-[10px] bg-gradient-to-br from-sky-500 to-blue-600 text-xs font-semibold text-white" onClick={addSplitRow}>
                            <Plus className="mr-1 h-3 w-3" />
                            Add child
                        </Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/60 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="p-2 pl-4 text-left">#</th><th className="p-2 text-left">Label</th><th className="p-2 text-right">Width</th><th className="p-2 text-right">Weight</th><th className="p-2" /></tr></thead>
                            <tbody>
                                {splitRows.map((row: SplitRow, index: number) => (
                                    <tr key={row.id} className="border-t border-slate-100">
                                        <td className="p-2 pl-4 font-mono text-xs text-slate-500">{index + 1}</td>
                                        <td className="p-2 font-mono text-xs font-semibold">Auto child label</td>
                                        <td className="p-2 text-right"><Input data-testid={`machine-split-row-width-${index}`} value={row.width_mm} onChange={(event) => updateSplitRow(row.id, 'width_mm', event.target.value)} className="ml-auto h-9 w-24 rounded-lg font-mono" /></td>
                                        <td className="p-2 text-right"><Input data-testid={`machine-split-row-weight-${index}`} value={row.weight_kg} onChange={(event) => updateSplitRow(row.id, 'weight_kg', event.target.value)} className="ml-auto h-9 w-28 rounded-lg font-mono" /></td>
                                        <td className="p-2 text-right"><Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => removeSplitRow(row.id)} disabled={splitRows.length <= 1}><Trash2 className="h-4 w-4" /></Button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : null}

            {reconcilableBulkRows.length ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <div>
                            <div className={cn(labelClass, 'text-blue-800')}>Material actuals</div>
                            <div className="text-[11px] text-blue-900/70">Confirm measured issue/return/scrap before closing this step.</div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {reconcilableBulkRows.slice(0, 5).map((row: any) => {
                            const requirementId = String(row.requirement_id || '');
                            const draft = materialConfirmations[requirementId];
                            if (!draft) return null;
                            return (
                                <div key={requirementId} className="grid gap-2 rounded-lg border border-blue-100 bg-white p-2 md:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] md:items-end">
                                    <div>
                                        <div className="text-xs font-black text-slate-900">{row.material_name || row.material_code || 'Material'}</div>
                                        <div className="text-[10px] font-semibold text-slate-500">Required {kg(row.required_qty_kg || row.theoretical_qty_kg)}</div>
                                    </div>
                                    <InlineNumber label="Issued" value={draft.actual_issued_qty} onChange={(value) => updateMaterialConfirmation(requirementId, { actual_issued_qty: value, is_estimated: false })} />
                                    <InlineNumber label="Returned" value={draft.actual_returned_qty} onChange={(value) => updateMaterialConfirmation(requirementId, { actual_returned_qty: value, is_estimated: false })} />
                                    <InlineNumber label="Scrap" value={draft.actual_scrap_qty} onChange={(value) => updateMaterialConfirmation(requirementId, { actual_scrap_qty: value, is_estimated: false })} />
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className={cn(labelClass, 'text-rose-800')}>Trim and scrap · optional</div>
                        <div className="mt-0.5 text-[11px] text-rose-900/80">Enter either, both, or none. The output log sends the combined waste weight to inventory.</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div>
                            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-700">Trim</div>
                            <Input data-testid="machine-trim-input" value={trimInput} onChange={(event) => setTrimInput(event.target.value)} className="h-10 w-24 rounded-lg border-rose-200 bg-white font-mono" type="number" step="0.001" />
                        </div>
                        <div>
                            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-700">Scrap</div>
                            <Input data-testid="machine-scrap-input" value={scrapInput} onChange={(event) => setScrapInput(event.target.value)} className="h-10 w-24 rounded-lg border-rose-200 bg-white font-mono" type="number" step="0.001" />
                        </div>
                        <Select value={scrapEntryMode} onValueChange={(value) => setScrapEntryMode(value as EntryMode)}>
                            <SelectTrigger className="h-10 w-24 rounded-lg border-rose-200 bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="KG">KG</SelectItem><SelectItem value="PCS">PCS</SelectItem></SelectContent>
                        </Select>
                        <div className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-800">
                            Total {kg((toNumber(trimInput, 0) + toNumber(scrapInput, 0)) * (scrapEntryMode === 'PCS' && unitWeightG > 0 ? unitWeightG / 1000 : 1))}
                        </div>
                    </div>
                </div>
            </div>

            {variant === 'pouching' ? (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50/30 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <div className={cn(labelClass, 'text-amber-800')}>Roll remainder · returns to bin</div>
                            <div className="text-[11px] text-amber-900/70">Input roll balance is returned to the selected remainder location.</div>
                        </div>
                        <Select value={remainderLocationId} onValueChange={setRemainderLocationId}>
                            <SelectTrigger className="h-10 min-w-[220px] rounded-lg border-amber-200 bg-white"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={DEFAULT_REMAINDER}>Use job output location</SelectItem>
                                {remainderLocations.map((loc: any) => <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function InlineNumber({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <div>
            <Label className={labelClass}>{label}</Label>
            <Input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-9 rounded-lg font-mono" type="number" step="0.001" />
        </div>
    );
}

function RollsWipCard({ rolls }: { rolls: any[] }) {
    return (
        <section className={cn(surfaceClass, 'p-4')}>
            <div className="mb-2 flex items-center justify-between">
                <div>
                    <div className={labelClass}>Rolls and WIP</div>
                    <div className="mt-0.5 text-base font-black">Input pool</div>
                </div>
                <span className="font-mono text-xs text-slate-500">{rolls.length} rows</span>
            </div>
            <div className="space-y-2">
                {rolls.length ? rolls.slice(0, 6).map((roll) => (
                    <div key={roll.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="truncate font-mono text-xs font-bold text-slate-950">{roll.label_id || roll.id}</div>
                                <div className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{roll.material_name}</div>
                            </div>
                            <div className="font-mono text-sm font-black">{kg(roll.weight_kg)}</div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{toNumber(roll.width_mm, 0).toFixed(0)} mm</span>
                            <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{toNumber(roll.thickness_micron, 0).toFixed(1)} μ</span>
                            <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{roll.grade || '-'}</span>
                        </div>
                    </div>
                )) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs italic text-slate-500">No roll or WIP input is visible for this step.</div>
                )}
            </div>
        </section>
    );
}

function ExecutionHealthCard({ allocationReady, shortage, producedKg, targetKg, remainingKg, nextAction, contextLoading }: any) {
    return (
        <section className={cn(surfaceClass, 'p-4')}>
            <div className={cn(labelClass, 'mb-3')}>Execution health</div>
            <div className="grid grid-cols-2 gap-2">
                <HealthTile label="Input ready" value={contextLoading ? '...' : allocationReady ? 'Yes' : 'No'} tone={allocationReady ? 'emerald' : 'rose'} />
                <HealthTile label="Roll shortage" value={String(shortage)} />
                <HealthTile label="Step progress" value={`${kg(producedKg)} / ${kg(targetKg)}`} />
                <HealthTile label="Remaining" value={kg(remainingKg)} tone="amber" />
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className={labelClass}>Next action</div>
                <div className="mt-1 text-sm font-black leading-5 text-slate-950">{nextAction}</div>
            </div>
        </section>
    );
}

function HealthTile({ label, value, tone = 'slate' }: { label: string; value: string; tone?: 'slate' | 'emerald' | 'amber' | 'rose' }) {
    const toneClass = tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-950';
    return (
        <div className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
            <div className={labelClass}>{label}</div>
            <div className={cn('mt-1 break-words text-base font-black', toneClass)}>{value}</div>
        </div>
    );
}

function LiveEventsCard({ events, loading }: { events: MachineJobEvent[]; loading: boolean }) {
    return (
        <section className={cn(surfaceClass, 'p-4')}>
            <div className="mb-2 flex items-center justify-between">
                <div>
                    <div className={labelClass}>Live events</div>
                    <div className="mt-0.5 text-base font-black">Last 20</div>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    <span className="font-mono text-[10px] text-slate-500">poll 5s</span>
                </div>
            </div>
            <div className="space-y-1.5">
                {loading ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-500">Loading events...</div>
                ) : events.length ? events.map((event) => (
                    <div key={event.id} className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-xs">
                        <span className={cn('h-2 w-2 rounded-full', eventTone(event.type))} />
                        <span className="font-mono text-[11px] text-slate-500">{formatTime(event.ts)}</span>
                        <span className="min-w-0 truncate"><b>{String(event.type).replaceAll('_', ' ')}</b>{event.label ? ` · ${event.label}` : ''}</span>
                        <span className="text-[10px] text-slate-400">{event.user || ''}</span>
                    </div>
                )) : (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-center text-xs font-semibold text-slate-500">No events yet.</div>
                )}
            </div>
        </section>
    );
}

function HistoryPanel({ historyRows, historyLoading, historyDateFrom, historyDateTo, historyStatus, setHistoryDateFrom, setHistoryDateTo, setHistoryStatus }: any) {
    return (
        <section className={cn(surfaceClass, 'p-5')}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <div className={cn(labelClass, 'text-blue-700')}>Machine history</div>
                    <h2 className="mt-1 text-3xl font-black tracking-tight">Closed and forced jobs</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-500">Date and variance filters use the same machine history API.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                    <Input type="date" value={historyDateFrom} onChange={(event) => setHistoryDateFrom(event.target.value)} className={inputClass} />
                    <Input type="date" value={historyDateTo} onChange={(event) => setHistoryDateTo(event.target.value)} className={inputClass} />
                    <Select value={historyStatus} onValueChange={setHistoryStatus}>
                        <SelectTrigger className={inputClass}><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="ALL">All status</SelectItem>
                            <SelectItem value="NORMAL">Normal</SelectItem>
                            <SelectItem value="FORCED_VARIANCE">Forced variance</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                <div className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_0.8fr] bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                    <div>Product</div><div>Completed</div><div>Output</div><div>Variance</div><div>Status</div>
                </div>
                <div className="overflow-x-auto">
                    {historyLoading ? (
                        <div className="px-4 py-10 text-center text-sm font-semibold text-slate-500">Loading history...</div>
                    ) : historyRows.length ? historyRows.map((row: any) => (
                        <div key={row.job_id} className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_0.8fr] border-t border-slate-100 px-4 py-3 text-sm">
                            <div className="min-w-0"><div className="truncate font-black">{row.job_number}</div><div className="truncate text-xs font-semibold text-slate-500">{row.template_name} · {row.step_name}</div></div>
                            <div className="font-semibold text-slate-600">{formatShortDateTime(row.completed_at)}</div>
                            <div className="font-mono font-black">{kg(row.produced_kg)}</div>
                            <div className="font-mono font-black">{kg(row.variance_kg)}</div>
                            <div><span className={cn('rounded-full border px-2 py-1 text-[10px] font-bold uppercase', stateBadgeClass(row.completion_mode))}>{row.completion_mode}</span></div>
                        </div>
                    )) : (
                        <div className="px-4 py-10 text-center text-sm font-semibold text-slate-500">No history rows for this filter.</div>
                    )}
                </div>
            </div>
        </section>
    );
}

function SublogDialog(props: any) {
    const {
        sublog,
        setSublog,
        selectedJob,
        scrapDialogQty,
        setScrapDialogQty,
        scrapDialogReason,
        setScrapDialogReason,
        scrapDialogNotes,
        setScrapDialogNotes,
        scrapMutationPending,
        onSaveScrap,
        downtimeReason,
        setDowntimeReason,
        downtimeStart,
        setDowntimeStart,
        downtimeEnd,
        setDowntimeEnd,
        downtimeAutoStop,
        setDowntimeAutoStop,
        downtimeNotes,
        setDowntimeNotes,
        downtimeMutationPending,
        onSaveDowntime,
        materialOptions,
        consumptionMaterialId,
        setConsumptionMaterialId,
        filteredGranuleCodes,
        consumptionGranuleCodeId,
        setConsumptionGranuleCodeId,
        reservedRolls,
        consumptionRollId,
        setConsumptionRollId,
        consumptionQty,
        setConsumptionQty,
        consumptionEstimated,
        setConsumptionEstimated,
        consumptionPending,
        onSaveConsumption,
        qualityRows,
        setQualityRows,
        qualityPending,
        onSaveQuality,
    } = props;
    const open = Boolean(sublog);
    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setSublog(null); }}>
            <DialogContent className="max-h-[86vh] overflow-y-auto rounded-[18px] sm:max-w-xl">
                {!selectedJob ? (
                    <DialogHeader>
                        <DialogTitle>Select a job first</DialogTitle>
                        <DialogDescription>Sublogs are attached to the active machine job.</DialogDescription>
                    </DialogHeader>
                ) : sublog === 'scrap' ? (
                    <>
                        <DialogHeader><DialogTitle>Log scrap</DialogTitle><DialogDescription>Quantity, reason, and notes are written to ScrapLog.</DialogDescription></DialogHeader>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div><Label className={labelClass}>Quantity</Label><Input value={scrapDialogQty} onChange={(event) => setScrapDialogQty(event.target.value)} className={cn(inputClass, 'mt-1 font-mono')} type="number" step="0.001" /></div>
                            <div><Label className={labelClass}>UOM</Label><Input value="KG" disabled className={cn(inputClass, 'mt-1 font-mono')} /></div>
                        </div>
                        <ReasonChips reasons={['SETUP', 'TRIM', 'DEFECT', 'MACHINE', 'MATERIAL', 'OTHER']} value={scrapDialogReason} onChange={setScrapDialogReason} />
                        <Textarea value={scrapDialogNotes} onChange={(event) => setScrapDialogNotes(event.target.value)} placeholder="Notes" className="min-h-20 rounded-lg" />
                        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSublog(null)}>Cancel</Button><Button className="bg-gradient-to-br from-rose-600 to-red-500 text-white" disabled={scrapMutationPending} onClick={onSaveScrap}>Save scrap</Button></div>
                    </>
                ) : sublog === 'downtime' ? (
                    <>
                        <DialogHeader><DialogTitle>Log downtime</DialogTitle><DialogDescription>Downtime can pause the running step for breakdown or power events.</DialogDescription></DialogHeader>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div><Label className={labelClass}>Start time</Label><Input value={downtimeStart} onChange={(event) => setDowntimeStart(event.target.value)} className={cn(inputClass, 'mt-1 font-mono')} type="datetime-local" /></div>
                            <div><Label className={labelClass}>End time</Label><Input value={downtimeEnd} onChange={(event) => setDowntimeEnd(event.target.value)} className={cn(inputClass, 'mt-1 font-mono')} type="datetime-local" /></div>
                        </div>
                        <ReasonChips reasons={['BREAKDOWN', 'MAINTENANCE', 'MATERIAL', 'MANPOWER', 'POWER', 'OTHER']} value={downtimeReason} onChange={setDowntimeReason} />
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Checkbox checked={downtimeAutoStop} onCheckedChange={(value) => setDowntimeAutoStop(Boolean(value))} /> Auto-stop the running step</label>
                        <Textarea value={downtimeNotes} onChange={(event) => setDowntimeNotes(event.target.value)} placeholder="Notes" className="min-h-20 rounded-lg" />
                        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSublog(null)}>Cancel</Button><Button className="bg-gradient-to-br from-amber-600 to-orange-500 text-white" disabled={downtimeMutationPending} onClick={onSaveDowntime}>Save downtime</Button></div>
                    </>
                ) : sublog === 'consumption' ? (
                    <>
                        <DialogHeader><DialogTitle>Log material consumption</DialogTitle><DialogDescription>Manual usage rows are added to MaterialConsumptionLog for this job.</DialogDescription></DialogHeader>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <Label className={labelClass}>Material</Label>
                                <Select value={consumptionMaterialId || SELECT_NONE} onValueChange={(value) => { setConsumptionMaterialId(value === SELECT_NONE ? '' : value); setConsumptionGranuleCodeId(SELECT_NONE); }}>
                                    <SelectTrigger className={cn(inputClass, 'mt-1')}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={SELECT_NONE}>Select material</SelectItem>
                                        {materialOptions.map((material: any) => <SelectItem key={material.id} value={material.id}>{material.code ? `${material.code} · ` : ''}{material.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className={labelClass}>Granule code</Label>
                                <Select value={consumptionGranuleCodeId} onValueChange={setConsumptionGranuleCodeId}>
                                    <SelectTrigger className={cn(inputClass, 'mt-1')}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={SELECT_NONE}>No code</SelectItem>
                                        {filteredGranuleCodes.map((code: GranuleQualityCode) => <SelectItem key={code.id} value={code.id}>{code.code} · {code.granule_material_code || code.granule_name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <Label className={labelClass}>From roll</Label>
                                <Select value={consumptionRollId} onValueChange={setConsumptionRollId}>
                                    <SelectTrigger className={cn(inputClass, 'mt-1 font-mono')}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={SELECT_NONE}>No specific roll</SelectItem>
                                        {reservedRolls.map((roll: any) => <SelectItem key={roll.id} value={roll.id}>{roll.label_id} · {kg(roll.weight_kg)}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div><Label className={labelClass}>Quantity kg</Label><Input value={consumptionQty} onChange={(event) => setConsumptionQty(event.target.value)} className={cn(inputClass, 'mt-1 font-mono')} type="number" step="0.001" /></div>
                        </div>
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><Checkbox checked={consumptionEstimated} onCheckedChange={(value) => setConsumptionEstimated(Boolean(value))} /> Estimated quantity</label>
                        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSublog(null)}>Cancel</Button><Button className="bg-gradient-to-br from-blue-700 to-blue-500 text-white" disabled={consumptionPending} onClick={onSaveConsumption}>Save consumption</Button></div>
                    </>
                ) : sublog === 'quality' ? (
                    <>
                        <DialogHeader><DialogTitle>Quality readings</DialogTitle><DialogDescription>Parameter set follows the current process type.</DialogDescription></DialogHeader>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {qualityRows.map((row: QualityDraft, index: number) => (
                                <div key={row.code} className="rounded-lg border border-cyan-100 bg-cyan-50/50 p-2">
                                    <Label className={labelClass}>{row.label}</Label>
                                    <Input value={row.value} onChange={(event) => setQualityRows((prev: QualityDraft[]) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className={cn(inputClass, 'mt-1 font-mono')} />
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                        <span className="text-[10px] text-slate-500">{row.spec_min !== undefined || row.spec_max !== undefined ? `spec ${row.spec_min ?? '-'}-${row.spec_max ?? '-'}` : 'observation'}</span>
                                        <label className="flex items-center gap-1 text-[10px] font-semibold text-slate-600"><Checkbox checked={row.in_spec} onCheckedChange={(value) => setQualityRows((prev: QualityDraft[]) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, in_spec: Boolean(value) } : item))} /> In spec</label>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setSublog(null)}>Cancel</Button><Button className="bg-gradient-to-br from-cyan-600 to-sky-500 text-white" disabled={qualityPending} onClick={onSaveQuality}>Save readings</Button></div>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}

function ReasonChips({ reasons, value, onChange }: { reasons: string[]; value: string; onChange: (value: string) => void }) {
    return (
        <div>
            <Label className={labelClass}>Reason</Label>
            <div className="mt-2 grid grid-cols-3 gap-2">
                {reasons.map((reason) => (
                    <Button key={reason} type="button" variant="outline" className={cn('h-9 rounded-full text-xs font-semibold', value === reason ? 'border-transparent bg-gradient-to-br from-sky-500 to-blue-600 text-white' : 'bg-white')} onClick={() => onChange(reason)}>
                        {reason}
                    </Button>
                ))}
            </div>
        </div>
    );
}
