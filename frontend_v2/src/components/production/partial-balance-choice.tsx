"use client";

// Shown when a step is closed short: what was not made goes back to the queue as a balance job
// (the later steps of the batch are cut to what this step made). On by default.

import { Undo2 } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { formatPartialQty, type PartialBalancePreview } from "@/lib/partial-flow";
import { cn } from "@/lib/utils";

export function PartialBalanceChoice({
  preview,
  checked,
  onChange,
  testId = "partial-balance-choice",
  className,
}: {
  preview?: PartialBalancePreview | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId?: string;
  className?: string;
}) {
  if (preview && preview.eligible === false && preview.reason) {
    return (
      <p
        className={cn("rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content-3", className)}
        data-testid={`${testId}-ineligible`}
      >
        {preview.reason}
      </p>
    );
  }
  const amount =
    preview && Number(preview.balance_qty || 0) > 0
      ? formatPartialQty(preview.balance_qty, preview.uom)
      : "";
  const where = preview?.work_center_name ? `the ${preview.work_center_name} queue` : "this step's queue";
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs",
        checked ? "border-info-border bg-info-bg text-info-fg" : "border-line bg-surface-2 text-content-2",
        className,
      )}
      data-testid={testId}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onChange(Boolean(value))} className="mt-0.5" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-semibold text-content-1">
          <Undo2 className="size-3.5" aria-hidden />
          Send the balance back to the queue{amount ? ` · ${amount}` : ""}
        </span>
        <span className="mt-0.5 block font-normal">
          {checked
            ? `What is not made returns to ${where} as a balance job; later steps of this batch make only what this step made.`
            : "No balance job: later steps keep their quantity and, at the last step, the planner sees the line under Partial re-plan."}
        </span>
      </span>
    </label>
  );
}
