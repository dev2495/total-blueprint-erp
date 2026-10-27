"use client";

// The "Help" button in the header: the guide for the page in use, loaded only when opened.

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { CircleHelp, ExternalLink, Share2 } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { HelpFlowDiagram } from "@/components/help/help-visuals";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHelpLocale } from "@/hooks/use-help-locale";
import { usePageHelp } from "@/hooks/use-page-help";
import type { HelpLocale, LocalizedText } from "@/help/types";

function tr(text: LocalizedText | string | undefined, locale: HelpLocale): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.en;
}

export function ContextHelpSheet() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";
  const { user, effectiveRole } = useAuth();
  const { locale, setLocale } = useHelpLocale();
  const roleCode = String(effectiveRole || user?.entitlements?.role || user?.role_info?.code || "").toUpperCase();
  const { pageGuide, decisionFlow, slug, isLoading } = usePageHelp(pathname, roleCode, open);
  const fullGuideHref = slug ? `/help?page=${slug}&lang=${locale}` : `/help?lang=${locale}`;
  const shareHref = slug ? `/guide?page=${slug}&lang=${locale}` : `/guide?lang=${locale}`;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl border-info-border bg-info-bg text-info-fg hover:bg-info-bg" data-testid="context-help-open">
          <CircleHelp className="mr-1.5 h-4 w-4" />
          Help
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-2xl">
        <div className="sticky top-0 z-10 border-b border-line bg-surface-1 p-5 pr-14">
          <SheetHeader className="space-y-2">
            <SheetTitle className="flex items-center justify-between gap-2">
              <span>{pageGuide ? tr(pageGuide.title, locale) : locale === "hi" ? "इस पेज की मदद" : "Help for this page"}</span>
              <div className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
                {(["en", "hi"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setLocale(value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${locale === value ? "bg-surface-1 text-content-1" : "text-content-3"}`}
                  >
                    {value === "en" ? "EN" : "हिंदी"}
                  </button>
                ))}
              </div>
            </SheetTitle>
            <SheetDescription>
              {pageGuide
                ? tr(pageGuide.summary, locale)
                : isLoading
                  ? locale === "hi"
                    ? "लोड हो रहा है…"
                    : "Loading…"
                  : locale === "hi"
                    ? "इस पेज की गाइड नहीं मिली। पूरी गाइड में खोजें।"
                    : "No guide for this page yet. Search the full guide."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={fullGuideHref} onClick={() => setOpen(false)}>
                {locale === "hi" ? "पूरी गाइड" : "Open full guide"}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link href={shareHref} target="_blank" rel="noreferrer">
                <Share2 className="mr-1.5 h-3.5 w-3.5" />
                {locale === "hi" ? "शेयर करने वाला लिंक" : "Shareable link"}
              </Link>
            </Button>
          </div>
        </div>

        {pageGuide ? (
          <div className="p-5">
            <p className="mb-4 text-sm leading-6 text-content-2">{tr(pageGuide.purpose, locale)}</p>
            <Tabs defaultValue="steps" className="w-full">
              <TabsList className="grid h-auto w-full grid-cols-4">
                <TabsTrigger value="steps" className="text-xs">{locale === "hi" ? "स्टेप" : "Steps"}</TabsTrigger>
                <TabsTrigger value="fields" className="text-xs">{locale === "hi" ? "फ़ील्ड" : "Fields"}</TabsTrigger>
                <TabsTrigger value="problems" className="text-xs">{locale === "hi" ? "दिक्कतें" : "Problems"}</TabsTrigger>
                <TabsTrigger value="flow" className="text-xs">{locale === "hi" ? "फ़्लो" : "Flow"}</TabsTrigger>
              </TabsList>
              <TabsContent value="steps" className="pt-4">
                {pageGuide.prerequisites?.length ? (
                  <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-sm text-content-2">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-3">{locale === "hi" ? "पहले से चाहिए" : "Before you start"}</div>
                    <ul className="list-disc space-y-1 pl-4">
                      {pageGuide.prerequisites.map((item, index) => (
                        <li key={index}>{tr(item, locale)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <ol className="space-y-2">
                  {pageGuide.keyActions.map((item, index) => (
                    <li key={index} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 text-sm text-content-1">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{index + 1}</span>
                      <span className="pt-0.5 leading-6">{tr(item, locale)}</span>
                    </li>
                  ))}
                </ol>
              </TabsContent>
              <TabsContent value="fields" className="space-y-2 pt-4">
                {pageGuide.fieldHelp.map((entry, index) => (
                  <div key={index} className="rounded-lg border border-line bg-surface-1 p-3">
                    <p className="text-sm font-semibold text-content-1">{tr(entry.field, locale)}</p>
                    <p className="mt-1 text-sm text-content-2">{tr(entry.help, locale)}</p>
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="problems" className="space-y-2 pt-4">
                {pageGuide.commonErrors.map((entry, index) => (
                  <div key={index} className="rounded-lg border border-warning-border bg-warning-bg p-3">
                    <p className="text-sm font-semibold text-warning-fg">{tr(entry.error, locale)}</p>
                    <p className="mt-1 text-sm text-content-1">{tr(entry.reason, locale)}</p>
                  </div>
                ))}
                {pageGuide.recoverySteps?.length ? (
                  <ol className="list-decimal space-y-1 pl-5 pt-2 text-sm text-content-2">
                    {pageGuide.recoverySteps.map((item, index) => (
                      <li key={index}>{tr(item, locale)}</li>
                    ))}
                  </ol>
                ) : null}
              </TabsContent>
              <TabsContent value="flow" className="pt-4">
                <HelpFlowDiagram flow={decisionFlow} locale={locale} />
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
