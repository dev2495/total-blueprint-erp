"use client";

import { usePathname } from "next/navigation";

import { PageHelpInline } from "@/components/help/page-help-inline";
import { shouldShowInlineHelp } from "@/help/route-registry";

export function HelpPageBanner() {
  const pathname = usePathname() || "/";

  if (!shouldShowInlineHelp(pathname)) {
    return null;
  }

  return <PageHelpInline compact className="mb-4" hideIfMissing={false} />;
}
