"use client";

import { cleanJobName } from "@/lib/job-name";
import { cn } from "@/lib/utils";

/** The order's job name, shown right after the SO number wherever an order appears. */
export function JobNameTag({ name, className }: { name: unknown; className?: string }) {
  const text = cleanJobName(name);
  if (!text) return null;
  return (
    <span
      className={cn(
        "inline-flex max-w-[220px] items-center truncate rounded-[5px] bg-order-bg px-1.5 py-px text-caption font-semibold text-order-fg ring-1 ring-order-border",
        className,
      )}
      title={`Job name: ${text}`}
      data-testid="job-name-tag"
    >
      {text}
    </span>
  );
}
