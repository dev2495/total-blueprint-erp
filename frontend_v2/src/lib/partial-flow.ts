// Partial runs: a step closed short sends the unmade part back to its queue as a balance job,
// and the later steps of its batch are cut to what it made (server: PartialBalanceService).

export type PartialBalanceOf = {
  of_job?: string;
  of_job_id?: string;
  qty?: string | number;
  uom?: string;
  at?: string;
};

export type PartialQuantityReduced = {
  from_qty?: string | number;
  to_qty?: string | number;
  uom?: string;
  by_job?: string;
};

export type PartialBalancePreview = {
  eligible?: boolean;
  reason?: string;
  balance_qty?: number;
  uom?: string;
  balance_kg?: number;
  work_center_name?: string;
};

export type PartialFlow = {
  balance_of?: PartialBalanceOf | null;
  quantity_reduced?: PartialQuantityReduced | null;
  balance_out?: Record<string, unknown> | null;
  preview?: PartialBalancePreview | null;
};

export function partialFlowOf(job: any): PartialFlow {
  const flow = job?.partial_flow;
  return flow && typeof flow === "object" ? (flow as PartialFlow) : {};
}

/** A balance job, or a step cut to what an upstream short close made. */
export function isPartialFlowJob(job: any): boolean {
  const flow = partialFlowOf(job);
  return Boolean(flow.balance_of || flow.quantity_reduced);
}

export function formatPartialQty(qty: unknown, uom: unknown): string {
  const value = Number(qty || 0);
  const unit = String(uom || "").toUpperCase();
  const digits = unit === "PCS" ? 0 : 2;
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: digits })} ${unit === "PCS" ? "pcs" : unit.toLowerCase() || "kg"}`;
}

/** Short tags for queue rows. */
export function partialFlowTags(job: any): { key: string; label: string; title: string }[] {
  const flow = partialFlowOf(job);
  const tags: { key: string; label: string; title: string }[] = [];
  if (flow.balance_of) {
    tags.push({
      key: "balance",
      label: `Balance · ${formatPartialQty(flow.balance_of.qty, flow.balance_of.uom)}`,
      title: `What ${flow.balance_of.of_job || "an earlier run"} did not make, back in the queue.`,
    });
  }
  if (flow.quantity_reduced) {
    tags.push({
      key: "reduced",
      label: `Cut to ${formatPartialQty(flow.quantity_reduced.to_qty, flow.quantity_reduced.uom)}`,
      title: `${flow.quantity_reduced.by_job || "An earlier step"} closed short; this step makes only what reached it (was ${formatPartialQty(flow.quantity_reduced.from_qty, flow.quantity_reduced.uom)}). The rest runs as a balance job.`,
    });
  }
  return tags;
}
