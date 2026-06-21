
import { api } from "@/lib/api";

export interface ControlTowerStats {
    metrics: {
        id: string;
        label: string;
        value: string | number | null;
        unit: string;
        sub_value?: string;
        status?: 'normal' | 'warning' | 'success';
        trend?: number | null;
        trend_label?: string;
    }[];
    production_trend: { date: string; count: number }[];
    sales_trend: { date: string; count: number; weight: number }[];
    top_customers: { customer_name: string; order_count: number; total_weight: number }[];
    job_distribution: { status: string; count: number }[];
    alerts?: {
        id: string;
        type: string;
        severity: string;
        message: string;
        timestamp: string;
    }[];
    active_jobs?: {
        id: string;
        job_number: string;
        product: string;
        progress: number;
        status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
        operator?: string;
    }[];
    material_control?: {
        theoretical_kg: number;
        planned_issue_kg: number;
        actual_issued_kg: number;
        returned_kg: number;
        consumed_kg: number;
        variance_kg: number;
        issue_discipline_pct: number;
        return_efficiency_pct: number;
        net_usage_discipline_pct: number;
        variance_pct: number;
    };
    ink_control?: {
        theoretical_kg: number;
        planned_issue_kg: number;
        issued_kg: number;
        returned_kg: number;
        consumed_kg: number;
        variance_kg: number;
        remix_ratio_pct: number;
        remix_qty_kg: number;
    };
    shift_oee?: Array<{
        shift_code: string;
        output_kg: number;
        scrap_kg: number;
        quality_pct: number;
    }>;
    risk_signals?: Array<{
        code: string;
        message: string;
        severity: "LOW" | "MEDIUM" | "HIGH" | string;
    }>;
    generated_at?: string;
    data_quality?: {
        source_ready?: boolean;
        note?: string;
        cost_data_ready?: boolean;
        cost_row_count?: number;
        sales_line_count?: number;
        material_actual_ready?: boolean;
        ink_actual_ready?: boolean;
    };
}

export interface KPIMetrics {
    [key: string]: any;
}

export interface OrderTrackingResponse {
    order_number: string;
    customer: string;
    status: string;
    delivery_date?: string | null;
    total_weight?: number;
    progress?: {
        ordered: number;
        produced: number;
        packed: number;
        dispatched: number;
        completion_percentage: number;
    };
    items?: any[];
    order_header?: any;
    line_items?: any[];
    job_steps?: Array<{
        job_id: string;
        job_number: string;
        state: string;
        process_code?: string | null;
        step_name?: string | null;
        work_center?: string | null;
        work_center_code?: string | null;
        machine?: string | null;
        machine_code?: string | null;
        operator?: string | null;
        operator_username?: string | null;
        closed_by?: string | null;
        closed_by_username?: string | null;
        assignment_status?: string | null;
        assigned_machine?: string | null;
        assigned_machine_code?: string | null;
        assigned_by?: string | null;
        assigned_at?: string | null;
        created_at?: string | null;
        start_date?: string | null;
        end_date?: string | null;
        closed_at?: string | null;
        closed_with_variance?: boolean;
        variance_kg?: number;
        force_reason?: string;
        produced_kg?: number;
        scrap_kg?: number;
        logs?: Array<{
            type: string;
            timestamp?: string | null;
            qty?: number;
            uom?: string;
            actor?: string;
            reason?: string;
        }>;
    }>;
    active_jobs?: OrderTrackingResponse["job_steps"];
    completed_jobs?: OrderTrackingResponse["job_steps"];
    wip_lineage?: any[];
    interplant_links?: any[];
    dispatch_evidence?: any[];
    customer_dispatch_evidence?: any[];
    audit_timeline?: any[];
    material_audit?: {
        summary?: {
            ordered_target_kg?: number;
            latest_output_kg?: number;
            wip_output_kg?: number;
            wip_remainder_kg?: number;
            bulk_consumed_kg?: number;
            scrap_logged_kg?: number;
            mass_gap_to_target_kg?: number;
        };
        item_flow?: any[];
        materials?: any[];
    };
    kpi_snapshot?: {
        ordered_kg: number;
        produced_kg: number;
        packed_kg: number;
        dispatched_kg: number;
        dispatchable_kg?: number;
        replan_remaining_kg?: number;
        customer_dispatch_kg?: number;
        scrap_kg: number;
        yield_percent: number;
        active_jobs: number;
        completed_jobs: number;
        wip_kg: number;
        fg_kg: number;
        output_roll_kg: number;
        remainder_roll_kg: number;
        interplant_in_transit_kg: number;
        wip_output_kg?: number;
        wip_remainder_kg?: number;
        interplant_output_in_transit_kg?: number;
        interplant_remainder_in_transit_kg?: number;
    };
    data_freshness?: {
        generated_at: string;
        age_seconds: number;
    };
    error?: string;
}

export interface AnalyticsFilterParams {
    plant?: string;
    date_from?: string;
    date_to?: string;
    shift?: string;
    process?: string;
    machine?: string;
}

export interface ScrapCenterResponse {
    filters?: Record<string, any>;
    summary: {
        production_scrap_kg: number;
        adjustment_scrap_kg: number;
        total_scrap_kg: number;
        scrap_rate_percent: number;
        total_consumed_kg: number;
        total_output_kg: number;
    };
    by_process: Array<{ process: string; scrap_kg: number; events: number }>;
    by_machine: Array<{ machine: string; scrap_kg: number; events: number }>;
    by_reason: Array<{ reason: string; scrap_kg: number; events: number }>;
    daily_trend: Array<{
        date: string;
        production_scrap_kg: number;
        adjustment_scrap_kg: number;
        total_scrap_kg: number;
    }>;
    top_jobs: Array<{
        job_id: string;
        job_number: string;
        template_name?: string | null;
        machine_name?: string | null;
        process_name?: string | null;
        scrap_kg: number;
        events: number;
    }>;
    recent_events: Array<Record<string, any>>;
}

export interface ReportTabResponse {
    tab: string;
    filters?: Record<string, any>;
    summary?: Record<string, any>;
    series?: Array<Record<string, any>>;
    breakdowns?: Record<string, any>;
    rows?: Array<Record<string, any>>;
    coverage?: {
        execution_log_coverage?: number;
        material_actual_coverage?: number;
        shift_coverage?: number;
    };
    warnings?: string[];
    shift_breakdown?: Array<Record<string, any>>;
    generated_at?: string;
    // Backward compatibility
    kpis?: Record<string, any>;
    details?: Record<string, any>;
    charts?: {
        trend?: Array<{ date: string; value: number }>;
        distribution?: Array<{ name: string; value: number }>;
    };
}

export interface SystemHealthResponse {
    status: string;
    uptime: string;
    active_users: number;
    error_rate: string;
    db_health: string;
    version: string;
    cpu_usage: number;
    memory_usage: number;
    disk_usage: number;
    telemetry_scope?: string;
    telemetry_fresh?: boolean;
    db_size_mb?: number;
    active_connections?: number;
    logs: Array<{
        level: string;
        message: string;
        time: string;
    }>;
}

export interface ReportDistributionProfile {
    report_code: string;
    label: string;
    active: boolean;
    target_roles: string[];
    updated_at?: string | null;
    updated_by?: string | null;
}

export interface AuditConsolePayload {
    counts: {
        operational_logs: number;
        login_entries: number;
        permission_audit: number;
        report_runs: number;
        inventory_audit?: number;
        production_audit?: number;
        master_data_audit?: number;
        system_config_audit?: number;
    };
    modes: {
        sessions: { items: any[]; latest?: any | null };
        permissions: { items: any[]; latest?: any | null };
        operations: { items: any[]; latest?: any | null };
        reports: { items: any[]; latest?: any | null };
        inventory?: { items: any[]; latest?: any | null };
        production?: { items: any[]; latest?: any | null };
        master_data?: { items: any[]; latest?: any | null };
        system_config?: { items: any[]; latest?: any | null };
    };
    generated_at?: string;
}

export interface AuditLedgerEvent {
    id: string;
    source: string;
    source_model: string;
    source_id: string;
    stream: string;
    stream_label: string;
    action: string;
    actor: string;
    role: string;
    entity_type: string;
    entity_id: string;
    reference: string;
    summary: string;
    timestamp: string | null;
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | string;
    value: string;
    method: string;
    path: string;
    ip: string;
    href: string;
    traceable_reference: string;
    trace_supported: boolean;
    details: Record<string, unknown>;
}

export interface AuditLedgerPayload {
    events: AuditLedgerEvent[];
    summary: {
        filtered_count: number;
        page_count: number;
        page_rows?: number;
        page: number;
        limit: number;
        has_more: boolean;
        next_page?: number | null;
        prev_page?: number | null;
        counts_by_stream: Record<string, number>;
        counts_by_severity: Record<string, number>;
        actors: Array<{ actor: string; count: number }>;
        newest_at?: string | null;
        oldest_at?: string | null;
        role_override_count?: number;
        source_window?: Record<string, unknown>;
    };
    generated_at?: string;
}

export interface AuditEventDetailPayload {
    event?: AuditLedgerEvent;
    raw?: Record<string, unknown>;
    generated_at?: string;
    error?: string;
}

export interface ReportDispatchRun {
    id: string;
    report_code: string;
    report_date: string;
    status: "PENDING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | string;
    recipients: string[];
    recipient_count: number;
    warning_text: string;
    error_text: string;
    provider: string;
    provider_message_id: string;
    pdf_file_name: string;
    pdf_checksum_sha1: string;
    pdf_size_bytes: number;
    detail_file_name: string;
    detail_checksum_sha1: string;
    detail_size_bytes: number;
    triggered_manually: boolean;
    triggered_by?: string | null;
    window_start?: string | null;
    window_end?: string | null;
    created_at?: string | null;
    sent_at?: string | null;
}

export interface OperationalLogRow {
    date: string;
    type: string;
    desc: string;
    val: string;
    user: string | null;
    reference: string;
    href: string;
    event_type: string;
    entity_type: string;
    meta: Record<string, unknown>;
}

export interface TraceLookupPayload {
    query: string;
    matched_by?: string;
    entity?: {
        type: string;
        id: string;
        reference: string;
        title: string;
        subtitle?: string;
        status?: string;
    };
    summary?: Record<string, unknown>;
    timeline?: Array<Record<string, unknown>>;
    related?: Array<Record<string, unknown>>;
    specialized?: Record<string, unknown>;
    error?: string;
}

export interface CapabilityMatrixEntry {
    capability_family: string;
    examples: string[];
    what_it_means: string;
    why: string;
    config_needed: string[];
    code_needed: string[];
    limits: string[];
}

export interface CapabilityMatrixSection {
    status: "SUPPORTED_NOW" | "CONFIG_ONLY" | "NEW_LOGIC_REQUIRED" | string;
    label: string;
    entries: CapabilityMatrixEntry[];
}

export interface CapabilityMatrixResponse {
    version: string;
    source_of_truth: string;
    sections: CapabilityMatrixSection[];
}

export const analyticsApi = {
    normalizeControlTowerStats: (payload: any): ControlTowerStats => {
        if (payload && typeof payload === "object" && payload.data && typeof payload.data === "object") {
            return payload.data as ControlTowerStats;
        }
        return (payload ?? {}) as ControlTowerStats;
    },
    performMaintenance: async (action: 'clear_cache' | 'vacuum_db'): Promise<{ success: boolean; message: string }> => {
        const { data } = await api.post("/api/analytics/maintenance/", { action });
        return data;
    },
    getSystemHealth: async (): Promise<SystemHealthResponse> => {
        const { data } = await api.get("/api/analytics/system-health/", { timeout: 7000 });
        return data as SystemHealthResponse;
    },
    getControlTowerStats: async (timeframe: string = 'month'): Promise<ControlTowerStats> => {
        const { data } = await api.get("/api/analytics/control-tower", { params: { timeframe } });
        return analyticsApi.normalizeControlTowerStats(data);
    },
    getOrderTracking: async (orderId: string): Promise<OrderTrackingResponse> => {
        try {
            const { data } = await api.get(`/api/analytics/orders/${orderId}/tracking/`);
            return data;
        } catch (_err) {
            const { data } = await api.get("/api/analytics/order-tracking/", {
                params: { order_id: orderId },
            });
            return data;
        }
    },
    getKPIs: async (): Promise<KPIMetrics> => {
        const { data } = await api.get("/api/analytics/kpis/");
        return data;
    },
    getDailyProduction: async (days: number = 30) => {
        const { data } = await api.get(`/api/analytics/daily-production/`, { params: { days } });
        return data;
    },
    getStockOverview: async () => {
        const { data } = await api.get("/api/analytics/stock-overview/");
        return data;
    },
    getOperationalLogs: async (filters: any = {}): Promise<OperationalLogRow[]> => {
        const { data } = await api.get("/api/analytics/operational-logs/", { params: filters });
        return Array.isArray(data) ? data : [];
    },
    getScrapAnalysis: async (days: number = 30) => {
        const { data } = await api.get(`/api/analytics/scrap-analysis/`, { params: { days } });
        return data;
    },
    getDowntimeAnalysis: async (days: number = 30) => {
        const { data } = await api.get(`/api/analytics/downtime-analysis/`, { params: { days } });
        return data;
    },
    getScrapCenter: async (filters: AnalyticsFilterParams = {}): Promise<ScrapCenterResponse> => {
        const { data } = await api.get('/api/analytics/scrap-center/', { params: filters });
        return data;
    },
    getReportTab: async (tab: string, filters: AnalyticsFilterParams = {}): Promise<ReportTabResponse> => {
        const { data } = await api.get(`/api/analytics/reports/${tab}/`, { params: filters });
        return data;
    },
    getReportTabPdfDownloadUrl: (tab: string, filters: AnalyticsFilterParams = {}) => {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(filters)) {
            if (value === undefined || value === null || value === "") continue
            params.set(key, String(value))
        }
        const query = params.toString()
        return `/api/analytics/reports/${tab}/export-pdf/${query ? `?${query}` : ""}`
    },
    getCatalog: async (): Promise<any[]> => {
        const { data } = await api.get("/api/analytics/catalog/");
        return data;
    },
    getDashboardSummary: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/dashboard-summary/", { params: filters });
        return data;
    },
    getMachineReport: async (machineId: string, filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get(`/api/analytics/reports/machine/${machineId}/`, { params: filters });
        return data;
    },
    getWorkCenterReport: async (wcId: string, filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get(`/api/analytics/reports/workcenter/${wcId}/`, { params: filters });
        return data;
    },
    getWcPerformance: async (filters: AnalyticsFilterParams = {}): Promise<any[]> => {
        const { data } = await api.get("/api/analytics/wc-performance/", { params: filters });
        return data;
    },
    getPlannerDashboard: async (): Promise<any> => {
        const { data } = await api.get("/api/analytics/planner-dashboard/");
        return data;
    },
    getWcmDashboard: async (): Promise<any> => {
        const hasExecutionTelemetry = (payload: any) =>
            Number(payload?.hero?.active_work_centers || 0) > 0 ||
            Number(payload?.summary?.machines_running || 0) > 0 ||
            (Array.isArray(payload?.machine_clusters) && payload.machine_clusters.length > 0) ||
            (Array.isArray(payload?.recent_activity) && payload.recent_activity.length > 0);

        try {
            const { data } = await api.get("/api/analytics/wcm-dashboard/");
            if (hasExecutionTelemetry(data) || typeof window === "undefined") {
                return data;
            }
        } catch (error) {
            if (typeof window === "undefined") {
                throw error;
            }
        }

        const response = await fetch("/api/analytics/wcm-dashboard/", {
            credentials: "include",
        });
        if (!response.ok) {
            throw new Error(`Failed to load WCM dashboard (${response.status})`);
        }
        return await response.json();
    },
    // ── Dedicated Report APIs ──
    getReportProduction: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/production", { params: filters });
        return data;
    },
    getReportOEE: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/oee", { params: filters });
        return data;
    },
    getReportDowntime: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/downtime", { params: filters });
        return data;
    },
    getReportScrap: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/scrap", { params: filters });
        return data;
    },
    getReportInventory: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/inventory", { params: filters });
        return data;
    },
    getReportSales: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/sales", { params: filters });
        return data;
    },
    getReportMRP: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/mrp", { params: filters });
        return data;
    },
    getReportOperator: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/operator", { params: filters });
        return data;
    },
    getReportCosting: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/costing", { params: filters });
        return data;
    },
    getReportDispatch: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/dispatch", { params: filters });
        return data;
    },
    getReportTrading: async (filters: AnalyticsFilterParams = {}): Promise<any> => {
        const { data } = await api.get("/api/analytics/reports/trading", { params: filters });
        return data;
    },
    getReportDistributions: async (): Promise<ReportDistributionProfile[]> => {
        const { data } = await api.get("/api/analytics/report-distributions/");
        return Array.isArray(data?.profiles) ? data.profiles : [];
    },
    updateReportDistributions: async (profiles: ReportDistributionProfile[]): Promise<ReportDistributionProfile[]> => {
        const { data } = await api.put("/api/analytics/report-distributions/", { profiles });
        return Array.isArray(data?.profiles) ? data.profiles : [];
    },
    sendReportDistribution: async (reportCode: string, reportDate?: string): Promise<ReportDispatchRun | null> => {
        const payload = reportDate ? { report_date: reportDate } : {};
        const { data } = await api.post(`/api/analytics/report-distributions/${reportCode}/send/`, payload);
        return data?.run ?? null;
    },
    getReportRuns: async (limit: number = 30, days?: number): Promise<ReportDispatchRun[]> => {
        const params: Record<string, number> = { limit };
        if (typeof days === "number" && Number.isFinite(days)) params.days = days;
        const { data } = await api.get("/api/analytics/report-runs/", { params });
        return Array.isArray(data?.runs) ? data.runs : [];
    },
    traceLookup: async (query: string): Promise<TraceLookupPayload> => {
        const { data } = await api.get("/api/analytics/trace/", {
            params: { q: query },
            validateStatus: (status: number) => status === 200 || status === 404,
        });
        return data as TraceLookupPayload;
    },
    getAuditConsole: async (): Promise<AuditConsolePayload> => {
        const { data } = await api.get("/api/analytics/audit-console/");
        return data as AuditConsolePayload;
    },
    getAuditLedger: async (params: Record<string, unknown> = {}): Promise<AuditLedgerPayload> => {
        const { data } = await api.get("/api/analytics/audit-ledger/", { params });
        return data as AuditLedgerPayload;
    },
    getAuditEventDetail: async (eventId: string): Promise<AuditEventDetailPayload> => {
        const { data } = await api.get(`/api/analytics/audit-ledger/${encodeURIComponent(eventId)}/`, {
            validateStatus: (status: number) => status === 200 || status === 404,
        });
        return data as AuditEventDetailPayload;
    },
    getCapabilityMatrix: async (): Promise<CapabilityMatrixResponse> => {
        const { data } = await api.get("/api/analytics/capability-matrix/");
        return data;
    },
    getReportRunPreviewUrl: (runId: string): string => `/api/analytics/report-runs/${runId}/preview-pdf/`,
    getReportRunPdfDownloadUrl: (runId: string): string => `/api/analytics/report-runs/${runId}/download-pdf/`,
    getReportRunDetailUrl: (runId: string): string => `/api/analytics/report-runs/${runId}/download-detail/`,
};

// Backwards-compatible alias (some pages still import analyticsService)
export const analyticsService = analyticsApi;

export default analyticsApi;
