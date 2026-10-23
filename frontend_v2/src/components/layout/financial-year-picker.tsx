"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CalendarRange } from "lucide-react";

import { api } from "@/lib/api";
import {
  getFinancialYear,
  onFinancialYearChange,
  setFinancialYear,
  type FinancialYearChoice,
} from "@/lib/financial-year";
import { cn } from "@/lib/utils";

interface FinancialYearRow {
  code: string;
  label: string;
  start: string;
  end: string;
  status: string;
  archived: boolean;
  current: boolean;
}

function useFinancialYears() {
  return useQuery({
    queryKey: ["financial-years"],
    queryFn: async () =>
      (await api.get<{ current: string; years: FinancialYearRow[] }>("/api/auth/financial-years/", { params: { fy: "" } }))
        .data,
    staleTime: 10 * 60_000,
    retry: false,
    meta: { suppressGlobalError: true },
  });
}

export function useFinancialYearChoice(): FinancialYearChoice {
  const [value, setValue] = React.useState<FinancialYearChoice>("");
  React.useEffect(() => {
    setValue(getFinancialYear());
    return onFinancialYearChange(setValue);
  }, []);
  return value;
}

/** Header picker: the working set by default, or one financial year (closed years are the archive). */
export function FinancialYearPicker({ className }: { className?: string }) {
  const years = useFinancialYears();
  const choice = useFinancialYearChoice();
  const queryClient = useQueryClient();
  if (years.isError || !years.data) return null;
  const rows = years.data.years;
  const pick = (value: FinancialYearChoice) => {
    setFinancialYear(value);
    // Every list refetches with the new year; detail pages keep their data.
    queryClient.invalidateQueries();
  };
  const picked = rows.find((row) => row.code === choice);
  return (
    <label
      className={cn(
        "flex h-10 items-center gap-1.5 rounded-[10px] border px-2.5 text-caption font-medium",
        choice ? "border-warning-border bg-warning-bg text-warning-fg" : "border-line bg-surface-2 text-content-2",
        className,
      )}
      title="Which financial year the lists show. Closed years are the archive."
    >
      {picked?.archived ? <Archive className="h-4 w-4" aria-hidden /> : <CalendarRange className="h-4 w-4" aria-hidden />}
      <span className="sr-only">Financial year shown in lists</span>
      <select
        value={choice}
        onChange={(event) => pick(event.target.value)}
        className="h-8 cursor-pointer bg-transparent pr-1 text-caption font-semibold outline-none"
      >
        <option value="">Working set · {rows.find((r) => r.current)?.label || "this year"}</option>
        {rows.map((row) => (
          <option key={row.code} value={row.code}>
            {row.label}
            {row.archived ? " · archived" : row.current ? " · this year only" : ""}
          </option>
        ))}
        <option value="all">All years</option>
      </select>
    </label>
  );
}

/** Banner while lists are scoped to one year, with the way back. */
export function FinancialYearBanner() {
  const choice = useFinancialYearChoice();
  const years = useFinancialYears();
  const queryClient = useQueryClient();
  if (!choice) return null;
  const row = years.data?.years.find((r) => r.code === choice);
  const label = choice === "all" ? "all financial years" : row?.label || `FY ${choice}`;
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg"
    >
      <span>
        <strong>Viewing {label}</strong>
        {row?.archived ? " (archived)" : ""}. Lists show {choice === "all" ? "every year's" : "that year's"} records; open
        work from other years is not in these lists.
      </span>
      <button
        type="button"
        onClick={() => {
          setFinancialYear("");
          queryClient.invalidateQueries();
        }}
        className="rounded-[8px] border border-warning-border bg-surface-1 px-2.5 py-1 font-semibold text-warning-fg hover:bg-surface-2"
      >
        Back to the working set
      </button>
    </div>
  );
}
