// Shared building blocks of the help guide: links that keep the language, role chips and the
// process chart (who does what, on which screen, in order).

import Link from "next/link";
import * as React from "react";

import { cn } from "@/lib/utils";
import { routeSlug } from "@/help/slug";
import type { HelpLocale, LocalizedText, ProcessChart } from "@/help/types";

export type GuideTarget = { page?: string; process?: string; role?: string; module?: string };

export function guideHref(basePath: string, locale: HelpLocale, target: GuideTarget = {}): string {
  const params = new URLSearchParams();
  if (target.page) params.set("page", target.page);
  if (target.process) params.set("process", target.process);
  if (target.role) params.set("role", target.role);
  if (target.module) params.set("module", target.module);
  // Always say the language, so a shared link opens in it and the toggle back to English sticks.
  params.set("lang", locale);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function t(text: LocalizedText | string | undefined, locale: HelpLocale): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.en;
}

const ROLE_TONES: Record<string, string> = {
  SALES: "bg-info-bg text-primary",
  PLANNER: "bg-plate text-plate-fg",
  WORK_CENTER_MANAGER: "bg-warning-bg text-warning-fg",
  OPERATOR: "bg-warning-bg text-warning-fg",
  STORE: "bg-success-bg text-success-fg",
  DISPATCH: "bg-success-bg text-success-fg",
  WATCHMAN: "bg-surface-2 text-content-2",
  PLANT_MANAGER: "bg-plate text-plate-fg",
};

export const ROLE_NAMES: Record<string, LocalizedText> = {
  ADMIN: { en: "Admin", hi: "एडमिन" },
  OWNER: { en: "Owner", hi: "मालिक" },
  SUPER_ADMIN: { en: "Super admin", hi: "सुपर एडमिन" },
  SALES: { en: "Sales", hi: "सेल्स" },
  PLANNER: { en: "Planner", hi: "प्लानर" },
  WORK_CENTER_MANAGER: { en: "Work-center manager", hi: "वर्क-सेंटर मैनेजर" },
  OPERATOR: { en: "Machine operator", hi: "मशीन ऑपरेटर" },
  STORE: { en: "Store", hi: "स्टोर" },
  DISPATCH: { en: "Packing & dispatch", hi: "पैकिंग और डिस्पैच" },
  PLANT_MANAGER: { en: "Plant manager", hi: "प्लांट मैनेजर" },
  WATCHMAN: { en: "Watchman", hi: "चौकीदार" },
  MAINTENANCE_SUPERVISOR: { en: "Maintenance supervisor", hi: "मेंटेनेंस सुपरवाइज़र" },
  MAINTENANCE_TECH: { en: "Maintenance technician", hi: "मेंटेनेंस टेक्नीशियन" },
};

export function RoleChip({ role, locale, className }: { role: string; locale: HelpLocale; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-semibold",
        ROLE_TONES[role] || "bg-surface-2 text-content-2",
        className,
      )}
    >
      {t(ROLE_NAMES[role] || role, locale)}
    </span>
  );
}

/** The process drawn as numbered cards with arrows; each card opens its screen's guide. */
export function ProcessChartView({
  process,
  basePath,
  locale,
  compact = false,
}: {
  process: ProcessChart;
  basePath: string;
  locale: HelpLocale;
  compact?: boolean;
}) {
  return (
    <ol
      className={cn(
        "grid gap-2.5",
        compact ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
      )}
      aria-label={t(process.title, locale)}
      data-testid={`guide-process-${process.id}`}
    >
      {process.steps.map((step, index) => {
        const last = index === process.steps.length - 1;
        const body = (
          <>
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary text-[12.5px] font-bold text-primary-foreground">
                {index + 1}
              </span>
              <RoleChip role={step.role} locale={locale} />
            </div>
            <div className="mt-2 text-[14px] font-semibold leading-5 text-content-1">{t(step.title, locale)}</div>
            {!compact ? <p className="mt-1 text-[12.5px] leading-5 text-content-3">{t(step.detail, locale)}</p> : null}
            {step.route ? <div className="mt-2 truncate font-mono text-[11px] text-content-4">{step.route}</div> : null}
          </>
        );
        return (
          <li key={`${process.id}-${index}`} className="relative">
            {step.route ? (
              <Link
                href={guideHref(basePath, locale, { page: routeSlug(step.route) })}
                className="block h-full rounded-[14px] border border-line bg-surface-1 p-3 transition-colors hover:border-info-border hover:bg-info-bg"
              >
                {body}
              </Link>
            ) : (
              <div className="h-full rounded-[14px] border border-line bg-surface-1 p-3">{body}</div>
            )}
            {!last ? (
              <span
                aria-hidden
                className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 rotate-45 border-r-2 border-t-2 border-primary bg-transparent sm:block"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
