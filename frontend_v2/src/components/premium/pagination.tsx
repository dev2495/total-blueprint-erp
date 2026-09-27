"use client";

import * as React from "react";
import { Pager } from "@/components/logistics/yard-ui";
import { cn } from "@/lib/utils";

/**
 * Client-side pagination for long lists. Resets to page 1 whenever any value
 * in `resetKeys` changes (filters, search) and clamps when the list shrinks.
 */
export function usePagination<T>(rows: T[] | undefined | null, pageSize = 50, resetKeys: unknown[] = []) {
  const list = rows || [];
  const [page, setPage] = React.useState(1);
  const pageCount = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, pageCount);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => setPage(1), resetKeys);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    setPage,
    pageCount,
    total: list.length,
    start,
    end: Math.min(list.length, start + pageSize),
    paged: list.slice(start, start + pageSize),
  };
}

export function PaginationBar({
  pagination,
  label = "items",
  testId,
  className,
}: {
  pagination: ReturnType<typeof usePagination<any>>;
  label?: string;
  testId: string;
  className?: string;
}) {
  if (pagination.total <= 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-content-3", className)}>
      <span>
        Showing {(pagination.start + 1).toLocaleString("en-IN")}–{pagination.end.toLocaleString("en-IN")} of {pagination.total.toLocaleString("en-IN")} {label}
      </span>
      <Pager page={pagination.page} pageCount={pagination.pageCount} onPageChange={pagination.setPage} testId={testId} />
    </div>
  );
}
