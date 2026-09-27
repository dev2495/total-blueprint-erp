"use client";

import { ReactNode } from "react";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import type { LocalizedText } from "@/help/types";
import { PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { PageHelpInline } from "@/components/help/page-help-inline";

interface ReportLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
  filters?: ReactNode;
  onRefresh?: () => void;
  onExport?: () => void;
  isLoading?: boolean;
  helpRoute?: string;
  helpSummary?: LocalizedText | string;
}

export function ReportLayout({
  title,
  description,
  children,
  actions,
  filters,
  onRefresh,
  onExport,
  isLoading,
  helpRoute,
  helpSummary,
}: ReportLayoutProps) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <PageHero
        compact
        eyebrow="Analytics"
        icon={<BarChart3 />}
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {onRefresh ? (
              <button type="button" onClick={onRefresh} disabled={isLoading} className={heroButtonClass("ghost")}>
                <RefreshCw className={isLoading ? "animate-spin" : ""} /> Refresh
              </button>
            ) : null}
            {onExport ? (
              <button type="button" onClick={onExport} className={heroButtonClass("primary")}>
                <Download /> Download PDF
              </button>
            ) : null}
          </>
        }
      />
      {helpRoute || helpSummary ? <PageHelpInline routePattern={helpRoute} helpSummary={helpSummary} compact /> : null}
      {filters ? (
        <section className="flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-surface-1 p-2.5 shadow-[var(--shadow-sm)]">
          {filters}
        </section>
      ) : null}
      <div>{children}</div>
    </div>
  );
}
