"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleHelp, ExternalLink } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import type { HelpLocale, LocalizedText } from "@/help/types";
import { useHelpLocale } from "@/hooks/use-help-locale";
import { usePageHelp } from "@/hooks/use-page-help";

function localize(text: LocalizedText | string | undefined, locale: HelpLocale): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.en;
}
import { cn } from "@/lib/utils";

interface PageHelpInlineProps {
  routePattern?: string;
  helpSummary?: LocalizedText | string;
  compact?: boolean;
  className?: string;
  hideIfMissing?: boolean;
}

export function PageHelpInline({
  routePattern,
  helpSummary,
  compact = true,
  className,
  hideIfMissing = true,
}: PageHelpInlineProps) {
  const pathname = usePathname() || "/";
  const { user, effectiveRole } = useAuth();
  const { locale } = useHelpLocale();

  const activePath = routePattern || pathname;
  const roleCode = String(
    effectiveRole || user?.entitlements?.role || user?.role_info?.code || "",
  ).toUpperCase();
  const context = usePageHelp(activePath, roleCode);

  if (!context.pageGuide && hideIfMissing) {
    return null;
  }

  const summaryText = localize(
    helpSummary || context.pageGuide?.summary || context.pageGuide?.purpose,
    locale,
  );

  if (!summaryText) return null;

  const fullGuideHref = context.slug
    ? `/help?page=${context.slug}&lang=${locale}`
    : `/help?route=${encodeURIComponent(activePath)}&lang=${locale}`;

  return (
    <div
      className={cn(
        "rounded-xl border border-info-border bg-info-bg px-4 py-3 text-info-fg",
        compact ? "text-xs" : "text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <CircleHelp
          className={cn("mt-0.5 shrink-0", compact ? "h-4 w-4" : "h-5 w-5")}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold uppercase tracking-wider text-caption text-info-fg">
            Help
          </p>
          <p
            className={cn(
              "mt-1 leading-relaxed text-info-fg",
              compact ? "text-xs" : "text-sm",
            )}
          >
            {summaryText}
          </p>
          <Link
            href={fullGuideHref}
            className="mt-2 inline-flex items-center gap-1.5 font-semibold text-info-fg hover:text-info-fg"
          >
            {locale === "hi" ? "पूरा गाइड खोलें" : "Open Full Guide"}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
