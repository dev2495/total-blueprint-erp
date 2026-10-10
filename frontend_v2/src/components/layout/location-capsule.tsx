"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { resolveNavigableRoute } from "@/lib/navigation-routes";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  system: "System",
  governance: "Governance",
  users: "Users",
  role: "Role",
  matrix: "Matrix",
  production: "Production",
  machine: "Machine",
  selector: "Selector",
  work: "Work",
  center: "Center",
  analytics: "Analytics",
  inventory: "Inventory",
  sales: "Sales",
  factory: "Factory",
  engineering: "Engineering",
  profile: "Profile",
  logistics: "Logistics",
  grn: "GRN",
  "gate-bills": "Bills & documents",
};

// Record pages (bills, receipts, passes, outward, job work, users) show a record label instead
// of the generic "Terminal" used for machine / work-centre terminals.
const RECORD_LABELS: Array<[RegExp, string]> = [
  [/^\/inventory\/gate-bills\/[0-9a-f-]{36}$/i, "Bill"],
  [/^\/inventory\/general-receipts\/[0-9a-f-]{36}$/i, "Receipt"],
  [/^\/inventory\/gate-passes\/[0-9a-f-]{36}$/i, "Gate pass"],
  [/^\/inventory\/outward-documents\/[0-9a-f-]{36}$/i, "Outward document"],
  [/^\/inventory\/job-work\/[0-9a-f-]{36}$/i, "Job-work order"],
  [/^\/system\/users\/[0-9a-f-]{36}$/i, "User"],
];

function recordLabel(path: string): string | null {
  const match = RECORD_LABELS.find(([pattern]) => pattern.test(path));
  return match ? match[1] : null;
}

function toLabel(segment: string): string {
  const key = String(segment || "").toLowerCase();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  ) {
    return "Terminal";
  }
  if (LABELS[key]) return LABELS[key];
  return key
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function LocationCapsule({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const normalizedPathname = String(pathname || "").replace(/\/+$/, "") || "/";
  const segments = String(pathname || "")
    .split("/")
    .filter(Boolean);

  const wrapperClass = cn(
    "relative z-10 items-center border border-line bg-surface-2 font-semibold text-content-3",
    compact
      ? "flex w-full overflow-x-auto rounded-2xl px-3 py-2 text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      : "hidden rounded-xl px-2 py-1 text-[11px] lg:flex",
  );

  if (!segments.length) {
    return (
      <div
        className={wrapperClass}
        data-testid={compact ? "location-capsule-compact" : "location-capsule"}
      >
        <span className="whitespace-nowrap">Home</span>
      </div>
    );
  }

  let cumulative = "";
  const crumbs = segments.map((segment) => {
    cumulative += `/${segment}`;
    return {
      segment,
      href: cumulative,
      target: resolveNavigableRoute(cumulative),
      label: recordLabel(cumulative) ?? toLabel(segment),
    };
  });

  return (
    <div
      className={wrapperClass}
      data-testid={compact ? "location-capsule-compact" : "location-capsule"}
    >
      <div className="flex min-w-max items-center">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const breadcrumbHref =
            crumb.target &&
            crumb.target === normalizedPathname &&
            crumb.href !== normalizedPathname
              ? crumb.href
              : crumb.target;
          return (
            <div
              key={crumb.href}
              className="flex items-center whitespace-nowrap"
            >
              {!isLast && breadcrumbHref ? (
                <Link
                  href={breadcrumbHref}
                  data-testid={`${compact ? "breadcrumb-link-compact" : "breadcrumb-link"}-${crumb.segment.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
                  data-route={crumb.target}
                  className="text-content-3 hover:text-content-2"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  className={
                    isLast ? "font-bold text-content-2" : "text-content-3"
                  }
                >
                  {crumb.label}
                </span>
              )}
              {!isLast ? (
                <ChevronRight className="mx-1 h-3 w-3 text-content-4" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
