"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckLine {
  label: string;
  ok: boolean;
  tone?: "ok" | "warn" | "error";
}

interface ValidationFooterProps {
  checks?: CheckLine[];
  autosaveLabel?: string;
  primaryActions?: React.ReactNode;
  secondaryActions?: React.ReactNode;
  className?: string;
}

export function ValidationFooter({
  checks = [],
  autosaveLabel,
  primaryActions,
  secondaryActions,
  className,
}: ValidationFooterProps) {
  const errorCount = checks.filter((c) => !c.ok && c.tone !== "warn").length;
  const warnCount = checks.filter((c) => !c.ok && c.tone === "warn").length;

  return (
    <div
      className={cn(
        "sticky bottom-3 z-20 mt-6 rounded-[18px] border border-line bg-surface-1/92 px-4 py-3 shadow-[0_10px_30px_-18px_rgba(16,24,40,0.35)] backdrop-blur-md",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {errorCount > 0 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-danger-bg px-3 text-[12.5px] font-medium text-danger-fg">
              <XCircle className="h-3.5 w-3.5" />
              {errorCount} to fix
            </span>
          ) : null}
          {warnCount > 0 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-warning-bg px-3 text-[12.5px] font-medium text-warning-fg">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warnCount} warning{warnCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {errorCount === 0 && warnCount === 0 && checks.length > 0 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-success-bg px-3 text-[12.5px] font-medium text-success-fg">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All checks pass
            </span>
          ) : null}
          {autosaveLabel ? (
            <span className="hidden h-7 max-w-full items-center gap-1.5 truncate rounded-full bg-surface-2 px-3 text-[12.5px] text-content-3 sm:inline-flex">
              <FileEdit className="h-3.5 w-3.5 flex-none" />
              <span className="truncate">{autosaveLabel}</span>
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {secondaryActions}
          {primaryActions}
        </div>
      </div>
    </div>
  );
}
