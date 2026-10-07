/**
 * Per-report presentation config. The backend returns one contract for every
 * report (summary, series, breakdowns, rows, coverage, warnings); this file
 * decides which figures lead, how they are formatted, which targets they are
 * judged against, and how each breakdown is charted.
 */

export type MetricFormat = "kg" | "pct" | "inr" | "count" | "min" | "hrs" | "days" | "num" | "text";

export type KpiDef = {
  key: string;
  label: string;
  format?: MetricFormat;
  /** Summary/benchmark key or literal number used as the target. */
  target?: string | number;
  /** true when higher is better (drives good/bad colouring vs target). */
  higherIsBetter?: boolean;
  hint?: string;
};

export type SectionKind = "ranked" | "donut" | "bars" | "composition" | "pareto" | "table";

export type SectionDef = {
  key: string;
  title: string;
  description?: string;
  kind: SectionKind;
  label?: string[];
  value?: string;
  format?: MetricFormat;
  /** Extra fields to show under each ranked item. */
  sub?: { key: string; label: string; format?: MetricFormat }[];
  limit?: number;
};

export type ReportConfig = {
  domain: string;
  kpis: KpiDef[];
  sections: SectionDef[];
  /** Series date field; auto-detected when omitted. */
  dateKey?: string;
  /** Preferred trend measures (first found wins as default). */
  trendMeasures?: string[];
  /** Units for series measures whose names are ambiguous (e.g. "value"). */
  seriesFormats?: Record<string, MetricFormat>;
  /** Series without a date axis render as a category bar chart. */
  seriesTitle?: string;
  /** Preferred detail-table column order. */
  columns?: string[];
  /** Detail-table column cap (default 10). */
  maxColumns?: number;
  rowsTitle?: string;
};

const INVENTORY: ReportConfig = {
  domain: "Inventory",
  kpis: [
    { key: "total_weight_kg", label: "Roll stock", format: "kg", hint: "physical rolls in scope" },
    { key: "bulk_stock_kg", label: "Bulk stock", format: "kg", hint: "granules, chemicals, bulk" },
    { key: "total_items", label: "Stock items", format: "count" },
    { key: "aged_stock_weight_kg", label: "Aged stock", format: "kg", hint: "older than 90 days", higherIsBetter: false },
    { key: "aged_stock_items", label: "Aged items", format: "count", higherIsBetter: false },
    { key: "estimated_value", label: "Estimated value", format: "inr" },
    { key: "valuation_rate_coverage_pct", label: "Valuation coverage", format: "pct", target: 100, higherIsBetter: true },
    { key: "valuation_missing_rate_items", label: "Items without a rate", format: "count", higherIsBetter: false },
  ],
  sections: [
    { key: "aging", title: "Stock aging", description: "Weight by age band", kind: "composition", label: ["range"], value: "weight_kg", format: "kg" },
    { key: "by_stage", title: "By stage", kind: "donut", label: ["stage"], value: "weight_kg", format: "kg" },
    { key: "by_item_type", title: "By item type", kind: "donut", label: ["item_type"], value: "weight_kg", format: "kg" },
    {
      key: "by_family",
      title: "Largest stock families",
      kind: "ranked",
      label: ["family"],
      value: "weight_kg",
      format: "kg",
      sub: [
        { key: "count", label: "items", format: "count" },
        { key: "oldest_age_days", label: "oldest", format: "days" },
      ],
    },
    { key: "by_material", title: "By material", kind: "ranked", label: ["name", "code"], value: "weight", format: "kg" },
    { key: "by_location", title: "By location", kind: "ranked", label: ["location"], value: "weight_kg", format: "kg" },
    { key: "by_plant", title: "By plant", kind: "ranked", label: ["plant"], value: "weight_kg", format: "kg" },
  ],
  columns: ["label_id", "material_code", "material_name", "plant_name", "location_name", "stage_name", "weight_kg", "age_days", "created_at"],
  rowsTitle: "Stock items",
};

const MATERIAL_FLOW: Omit<ReportConfig, "domain"> = {
  kpis: [
    { key: "theoretical_kg", label: "Theoretical need", format: "kg", hint: "from recipes" },
    { key: "actual_issued_kg", label: "Issued", format: "kg" },
    { key: "consumed_kg", label: "Consumed", format: "kg" },
    { key: "variance_kg", label: "Variance", format: "kg", higherIsBetter: false, hint: "consumed vs theoretical" },
    { key: "waste_factor_pct", label: "Waste factor", format: "pct", target: 5, higherIsBetter: false },
    { key: "planning_accuracy_pct", label: "Planning accuracy", format: "pct", target: 95, higherIsBetter: true },
    { key: "issue_accuracy_pct", label: "Issue accuracy", format: "pct", target: 95, higherIsBetter: true },
    { key: "returned_kg", label: "Returned to store", format: "kg" },
  ],
  sections: [
    { key: "waterfall", title: "Material flow", description: "Theoretical → issued → consumed", kind: "bars", label: ["name"], value: "value", format: "kg" },
    {
      key: "by_material",
      title: "Variance by material",
      kind: "ranked",
      label: ["name", "code"],
      value: "variance",
      format: "kg",
      sub: [
        { key: "variance_pct", label: "variance", format: "pct" },
        { key: "jobs", label: "jobs", format: "count" },
      ],
    },
    {
      key: "job_variance",
      title: "Jobs with the largest overuse",
      kind: "ranked",
      label: ["job_number"],
      value: "variance",
      format: "kg",
      sub: [{ key: "product", label: "", format: "text" }],
    },
  ],
  seriesTitle: "Material flow",
  seriesFormats: { value: "kg" },
  columns: ["name", "code", "theoretical", "required", "planned_issue", "actual_issued", "consumed", "variance", "variance_pct", "scrap", "jobs", "status"],
  rowsTitle: "Materials",
};

export const REPORT_CONFIG: Record<string, ReportConfig> = {
  production: {
    domain: "Production",
    kpis: [
      { key: "total_output_kg", label: "Output", format: "kg", hint: "good output in period" },
      { key: "yield_pct", label: "Yield", format: "pct", target: 95, higherIsBetter: true },
      { key: "scrap_rate", label: "Scrap rate", format: "pct", target: 5, higherIsBetter: false },
      { key: "completion_rate", label: "Job completion", format: "pct", higherIsBetter: true },
      { key: "total_jobs", label: "Jobs", format: "count" },
      { key: "avg_output_per_machine_kg", label: "Output per machine", format: "kg" },
      { key: "active_machines", label: "Active machines", format: "count" },
      { key: "avg_job_size_kg", label: "Avg job size", format: "kg" },
    ],
    sections: [
      { key: "by_process", title: "Output by process", kind: "ranked", label: ["name", "process"], value: "value", format: "kg" },
      {
        key: "by_work_center",
        title: "Output by work centre",
        kind: "ranked",
        label: ["work_center"],
        value: "output_kg",
        format: "kg",
        sub: [{ key: "job_count", label: "jobs", format: "count" }],
      },
      { key: "by_shift", title: "Output by shift", kind: "donut", label: ["shift_code"], value: "output_kg", format: "kg" },
      { key: "by_job_state", title: "Job status mix", kind: "donut", label: ["state"], value: "count", format: "count" },
      {
        key: "by_machine",
        title: "Machine output",
        kind: "ranked",
        label: ["machine"],
        value: "actual_output",
        format: "kg",
        sub: [
          { key: "yield_pct", label: "yield", format: "pct" },
          { key: "scrap_kg", label: "scrap", format: "kg" },
        ],
      },
      { key: "scrap_reasons", title: "Scrap reasons", kind: "pareto", label: ["reason"], value: "scrap_kg", format: "kg" },
      { key: "by_operator", title: "Output by operator", kind: "ranked", label: ["operator"], value: "output_kg", format: "kg" },
    ],
    trendMeasures: ["output_kg", "scrap_kg", "yield_pct"],
    rowsTitle: "Jobs in period",
  },
  oee: {
    domain: "Production",
    kpis: [
      { key: "avg_oee", label: "OEE", format: "pct", target: "world_class_oee", higherIsBetter: true },
      { key: "global_availability", label: "Availability", format: "pct", target: "target_availability", higherIsBetter: true },
      { key: "global_performance", label: "Performance", format: "pct", target: "target_performance", higherIsBetter: true },
      { key: "global_quality", label: "Quality", format: "pct", target: "target_quality", higherIsBetter: true },
      { key: "output_kg", label: "Output", format: "kg" },
      { key: "scrap_kg", label: "Scrap", format: "kg", higherIsBetter: false },
      { key: "machines_tracked", label: "Machines running", format: "count", hint: "had output, scrap or downtime" },
      { key: "machines_idle", label: "Idle machines", format: "count" },
    ],
    sections: [
      {
        key: "by_work_center",
        title: "OEE by work centre",
        kind: "ranked",
        label: ["work_center", "name"],
        value: "avg_oee",
        format: "pct",
        sub: [
          { key: "avg_availability", label: "A", format: "pct" },
          { key: "avg_performance", label: "P", format: "pct" },
          { key: "avg_quality", label: "Q", format: "pct" },
          { key: "output_kg", label: "", format: "kg" },
        ],
      },
      { key: "oee_bands", title: "Machines by OEE band", kind: "donut", label: ["band"], value: "machines", format: "count" },
      {
        key: "by_machine",
        title: "Machine output",
        kind: "ranked",
        label: ["machine_name"],
        value: "produced_kg",
        format: "kg",
        sub: [
          { key: "oee", label: "OEE", format: "pct" },
          { key: "quality", label: "quality", format: "pct" },
          { key: "downtime_hours", label: "down", format: "hrs" },
        ],
      },
    ],
    trendMeasures: ["value", "output_kg", "downtime_hours"],
    seriesFormats: { value: "pct" },
    columns: ["machine_name", "machine_code", "work_center", "oee", "availability", "performance", "quality", "produced_kg", "scrap_kg", "downtime_hours"],
    rowsTitle: "Machines",
  },
  downtime: {
    domain: "Production",
    kpis: [
      { key: "total_downtime_hours", label: "Downtime", format: "hrs", higherIsBetter: false },
      { key: "total_events", label: "Stoppages", format: "count", higherIsBetter: false },
      { key: "mttr_minutes", label: "Mean time to repair", format: "min", higherIsBetter: false },
      { key: "avg_events_per_day", label: "Stoppages per day", format: "num", higherIsBetter: false },
    ],
    sections: [
      { key: "pareto", title: "Downtime reasons (Pareto)", description: "Fix the top reasons first", kind: "pareto", label: ["reason"], value: "minutes", format: "min" },
      {
        key: "top_machines",
        title: "Machines losing the most time",
        kind: "ranked",
        label: ["machine"],
        value: "minutes",
        format: "min",
        sub: [{ key: "count", label: "stoppages", format: "count" }],
      },
    ],
    trendMeasures: ["minutes", "events"],
    rowsTitle: "Reasons",
  },
  gate: {
    domain: "Gate",
    kpis: [
      { key: "goods_total", label: "Register entries", format: "count", hint: "movements logged, not distinct vehicles" },
      { key: "inward", label: "Inward entries", format: "count" },
      { key: "outward", label: "Outward entries", format: "count" },
      { key: "unmatched", label: "Awaiting ERP match", format: "count", target: 0, higherIsBetter: false, hint: "owner review" },
      { key: "discrepancies", label: "ERP mismatches", format: "count", target: 0, higherIsBetter: false },
      { key: "visitor_entries", label: "Visitor entries", format: "count" },
      { key: "visitor_exits", label: "Visitor exits", format: "count" },
      { key: "overdue_visitors", label: "Overdue inside now", format: "count", target: 0, higherIsBetter: false, hint: "current, not period" },
    ],
    sections: [],
    // Backend daily series {date, inward, outward, total} in Asia/Kolkata.
    dateKey: "date",
    trendMeasures: ["inward", "outward", "total"],
    seriesFormats: { inward: "count", outward: "count", total: "count" },
    rowsTitle: "Goods register",
    maxColumns: 14,
    columns: [
      "logged_at",
      "direction",
      "invoice_number",
      "party_name",
      "vehicle_number",
      "product_name",
      "quantity",
      "uom",
      "amount",
      "reconciliation_status",
      "reference",
      "invoice_date",
      "amount_basis",
      "plant",
    ],
  },
  scrap: {
    domain: "Quality",
    kpis: [
      { key: "total_scrap_kg", label: "Scrap", format: "kg", higherIsBetter: false },
      { key: "scrap_rate", label: "Scrap rate", format: "pct", target: "target_scrap_rate", higherIsBetter: false },
      { key: "yield_pct", label: "Yield", format: "pct", target: "target_yield", higherIsBetter: true },
      { key: "cost_of_scrap", label: "Cost of scrap", format: "inr", higherIsBetter: false },
      { key: "total_events", label: "Scrap events", format: "count" },
      { key: "avg_scrap_per_event_kg", label: "Avg per event", format: "kg" },
      { key: "top_reason", label: "Top reason", format: "text" },
      { key: "top_machine", label: "Worst machine", format: "text" },
    ],
    sections: [
      { key: "by_reason", title: "Scrap by reason", kind: "pareto", label: ["name", "reason"], value: "value", format: "kg" },
      {
        key: "by_process",
        title: "Scrap by process",
        kind: "ranked",
        label: ["process"],
        value: "scrap_kg",
        format: "kg",
        sub: [{ key: "yield_pct", label: "yield", format: "pct" }],
      },
      { key: "by_machine", title: "Scrap by machine", kind: "ranked", label: ["machine"], value: "scrap", format: "kg" },
      { key: "by_operator", title: "Scrap by operator", kind: "ranked", label: ["operator"], value: "scrap_kg", format: "kg" },
      {
        key: "top_jobs",
        title: "Jobs with the most scrap",
        kind: "ranked",
        label: ["job_number"],
        value: "scrap_kg",
        format: "kg",
        sub: [
          { key: "template_name", label: "", format: "text" },
          { key: "yield_pct", label: "yield", format: "pct" },
        ],
      },
    ],
    trendMeasures: ["scrap_kg", "cost", "events"],
    columns: ["timestamp", "reason", "quantity_kg", "job_number", "machine_name", "process_name", "logged_by"],
    rowsTitle: "Scrap events",
  },
  inventory: INVENTORY,
  "inventory-lineage": { ...INVENTORY, domain: "Inventory" },
  interplant: {
    domain: "Logistics",
    kpis: [
      { key: "total_challans", label: "Transfers", format: "count" },
      { key: "dispatched_total_kg", label: "Dispatched", format: "kg" },
      { key: "received_total_kg", label: "Received", format: "kg" },
      { key: "in_transit", label: "In transit", format: "count", higherIsBetter: false },
      { key: "output_in_transit_kg", label: "Weight in transit", format: "kg" },
      { key: "received", label: "Received challans", format: "count" },
      { key: "draft", label: "Drafts", format: "count" },
    ],
    sections: [],
    trendMeasures: ["weight_kg", "challans"],
    columns: ["dc_no", "status", "from_plant", "to_plant", "dispatched_at", "received_at", "dispatched_kg", "received_kg"],
    rowsTitle: "Recent transfers",
  },
  mrp: { domain: "Materials", ...MATERIAL_FLOW },
  "material-variance": { domain: "Materials", ...MATERIAL_FLOW },
  "ink-intelligence": {
    domain: "Materials",
    kpis: [
      { key: "ink_theoretical_kg", label: "Ink needed", format: "kg", hint: "from recipes" },
      { key: "ink_actual_issued_kg", label: "Ink issued", format: "kg" },
      { key: "ink_consumed_kg", label: "Ink consumed", format: "kg" },
      { key: "ink_returned_kg", label: "Returned", format: "kg" },
      { key: "ink_variance_kg", label: "Variance", format: "kg", higherIsBetter: false },
      { key: "color_families", label: "Colour families", format: "count" },
    ],
    sections: [
      {
        key: "top_variance",
        title: "Colour families with the most variance",
        kind: "ranked",
        label: ["color_family"],
        value: "variance_qty",
        format: "kg",
        sub: [
          { key: "issue_discipline_pct", label: "issue discipline", format: "pct" },
          { key: "return_efficiency_pct", label: "returns", format: "pct" },
        ],
      },
    ],
    seriesTitle: "Consumption by colour family",
    seriesFormats: { value: "kg" },
    columns: ["color_family", "theoretical_qty", "planned_issue_qty", "actual_issued_qty", "actual_returned_qty", "actual_consumed_qty", "variance_qty", "variance_pct", "job_count"],
    rowsTitle: "Colour families",
  },
  sales: {
    domain: "Sales",
    kpis: [
      { key: "total_revenue", label: "Order value", format: "inr" },
      { key: "total_weight_ordered_kg", label: "Weight ordered", format: "kg" },
      { key: "otif_rate", label: "On-time completion proxy", format: "pct", higherIsBetter: true },
      { key: "backlog_count", label: "Open orders", format: "count" },
      { key: "overdue_count", label: "Overdue orders", format: "count", higherIsBetter: false },
      { key: "completed_count", label: "Completed", format: "count" },
      { key: "quote_conversion_pct", label: "Quote conversion", format: "pct", higherIsBetter: true },
      { key: "repeat_share_pct", label: "Repeat business", format: "pct" },
    ],
    sections: [
      { key: "pipeline", title: "Order pipeline", kind: "donut", label: ["status"], value: "count", format: "count" },
      {
        key: "top_customers",
        title: "Top customers",
        kind: "ranked",
        label: ["name"],
        value: "weight_kg",
        format: "kg",
        sub: [{ key: "orders", label: "orders", format: "count" }],
      },
      {
        key: "sku_breakdown",
        title: "Products by value",
        kind: "ranked",
        label: ["sku"],
        value: "value",
        format: "inr",
        sub: [
          { key: "weight_kg", label: "", format: "kg" },
          { key: "orders", label: "orders", format: "count" },
        ],
      },
      {
        key: "overdue_orders",
        title: "Most overdue orders",
        kind: "ranked",
        label: ["order_number"],
        value: "days_overdue",
        format: "days",
        sub: [{ key: "customer_name", label: "", format: "text" }],
      },
    ],
    trendMeasures: ["created", "completed"],
    columns: ["order_number", "customer_name", "delivery_date", "status", "days_overdue"],
    rowsTitle: "Overdue orders",
  },
  dispatch: {
    domain: "Logistics",
    kpis: [
      { key: "total_challans", label: "Challans", format: "count" },
      { key: "dispatched", label: "Dispatched", format: "count" },
      { key: "pending", label: "Pending", format: "count", higherIsBetter: false },
      { key: "total_weight_kg", label: "Weight shipped", format: "kg" },
      { key: "total_pcs", label: "Pieces shipped", format: "count" },
    ],
    sections: [
      { key: "pipeline", title: "Challan status", kind: "donut", label: ["status"], value: "count", format: "count" },
      {
        key: "by_customer",
        title: "Weight by customer",
        kind: "ranked",
        label: ["customer"],
        value: "weight_kg",
        format: "kg",
        sub: [{ key: "challans", label: "challans", format: "count" }],
      },
    ],
    trendMeasures: ["weight_kg", "challans"],
    columns: ["dc_no", "customer", "status", "date", "vehicle"],
    rowsTitle: "Recent challans",
  },
  operator: {
    domain: "People",
    kpis: [
      { key: "active_operators", label: "Active operators", format: "count" },
      { key: "total_output_kg", label: "Output", format: "kg" },
      { key: "avg_efficiency", label: "Avg efficiency", format: "pct", target: 95, higherIsBetter: true },
      { key: "best_operator", label: "Top performer", format: "text" },
    ],
    sections: [
      {
        key: "leaderboard",
        title: "Operator leaderboard",
        kind: "ranked",
        label: ["full_name", "name"],
        value: "produced_kg",
        format: "kg",
        sub: [
          { key: "efficiency", label: "efficiency", format: "pct" },
          { key: "scrap_rate", label: "scrap", format: "pct" },
          { key: "jobs", label: "jobs", format: "count" },
        ],
      },
    ],
    columns: ["full_name", "jobs", "completed", "produced_kg", "scrap_kg", "efficiency", "scrap_rate", "completion_rate", "target_achievement"],
    rowsTitle: "Operators",
  },
  costing: {
    domain: "Finance",
    kpis: [
      { key: "total_revenue", label: "Revenue", format: "inr" },
      { key: "total_production_cost", label: "Production cost", format: "inr", higherIsBetter: false },
      { key: "total_margin", label: "Gross margin", format: "inr", higherIsBetter: true },
      { key: "avg_margin_pct", label: "Margin %", format: "pct", target: "target_gross_margin", higherIsBetter: true },
      { key: "avg_cost_per_kg", label: "Cost per kg", format: "inr", higherIsBetter: false },
      { key: "total_contribution", label: "Contribution", format: "inr" },
      { key: "avg_actual_cost_coverage_pct", label: "Actual-cost coverage", format: "pct", target: 100, higherIsBetter: true },
      { key: "total_jobs_costed", label: "Jobs costed", format: "count" },
    ],
    sections: [
      { key: "cost_split", title: "Cost split", kind: "donut", label: ["name"], value: "value", format: "inr" },
      { key: "customer_margin", title: "Margin by customer", kind: "ranked", label: ["customer", "name"], value: "margin", format: "inr" },
      { key: "overhead_trend", title: "Overheads by month", kind: "bars", label: ["date"], value: "total", format: "inr" },
    ],
    trendMeasures: ["cost_per_kg", "value", "total"],
    rowsTitle: "Costed jobs",
  },
  "shift-performance": {
    domain: "Production",
    kpis: [
      { key: "total_output_kg", label: "Output", format: "kg" },
      { key: "total_scrap_kg", label: "Scrap", format: "kg", higherIsBetter: false },
      { key: "total_downtime_minutes", label: "Downtime", format: "min", higherIsBetter: false },
      { key: "shift_count", label: "Shifts", format: "count" },
    ],
    sections: [
      {
        key: "shift_oee_like",
        title: "Shift comparison",
        kind: "ranked",
        label: ["shift_code"],
        value: "output_kg",
        format: "kg",
        sub: [
          { key: "yield_pct", label: "yield", format: "pct" },
          { key: "downtime_minutes", label: "downtime", format: "min" },
        ],
      },
    ],
    seriesFormats: { value: "kg" },
    columns: ["shift_code", "output_kg", "scrap_kg", "yield_pct", "events", "downtime_minutes"],
    rowsTitle: "Shifts",
  },
};

export const DEFAULT_CONFIG: ReportConfig = { domain: "Analytics", kpis: [], sections: [] };
