"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { CircleHelp, ExternalLink } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { localize, getHelpContext } from "@/help/resolver";
import { useHelpLocale } from "@/hooks/use-help-locale";

function SectionList({ items }: { items: string[] }) {
  if (!items.length) {
    return <p className="text-xs text-slate-500">No details available.</p>;
  }

  return (
    <ul className="space-y-2 text-sm text-slate-700 list-disc pl-4">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function ContextHelpSheet() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";
  const { user, effectiveRole } = useAuth();
  const { locale, setLocale } = useHelpLocale();

  const roleCode = String(effectiveRole || user?.entitlements?.role || user?.role_info?.code || "").toUpperCase();

  const context = useMemo(() => getHelpContext(pathname, roleCode), [pathname, roleCode]);
  const helpRoute = context.pageGuide?.routePattern || pathname;
  const fullGuideHref = `/help?route=${encodeURIComponent(helpRoute)}`;

  const overview = context.pageGuide
    ? [
      localize(context.pageGuide.summary, locale),
      localize(context.pageGuide.purpose, locale),
    ].filter(Boolean)
    : [
      localize(context.roleGuide?.overview, locale),
      ...(context.roleGuide?.responsibilities || []).slice(0, 2).map((item) => localize(item, locale)),
    ].filter(Boolean);

  const steps = context.pageGuide
    ? [
      ...((context.pageGuide.prerequisites || []).map((item) => localize(item, locale))),
      ...((context.pageGuide.keyActions || []).map((item) => localize(item, locale))),
      ...((context.pageGuide.recoverySteps || []).map((item) => localize(item, locale))),
    ].filter(Boolean)
    : [
      ...((context.roleGuide?.dailyChecklist || []).map((item) => localize(item, locale))),
      ...((context.roleGuide?.coreWorkflows || []).map((item) => localize(item, locale))),
      ...((context.roleGuide?.escalationPaths || []).map((item) => localize(item, locale))),
    ].filter(Boolean);

  const related = context.pageGuide
    ? (context.pageGuide.relatedRoutes || []).map((route) => route)
    : context.roleGuide?.landingPage
      ? [context.roleGuide.landingPage]
      : [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" className="h-10 rounded-xl border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100">
          <CircleHelp className="h-4 w-4 mr-1.5" />
          Help
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-y-auto">
        <div className="p-5 border-b border-slate-200 bg-white sticky top-0 z-10">
          <SheetHeader className="space-y-2">
            <SheetTitle className="flex items-center justify-between">
              <span>{locale === "hi" ? "संदर्भ सहायता" : "Context Help"}</span>
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md ${locale === "en" ? "bg-white text-slate-900" : "text-slate-500"}`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLocale("hi")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md ${locale === "hi" ? "bg-white text-slate-900" : "text-slate-500"}`}
                >
                  HI
                </button>
              </div>
            </SheetTitle>
            <SheetDescription>
              {context.pageGuide
                ? localize(context.pageGuide.title, locale)
                : context.roleGuide
                  ? localize(context.roleGuide.title, locale)
                  : locale === "hi"
                    ? "इस पेज के लिए गाइड उपलब्ध नहीं है।"
                    : "No guide is available for this page."}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-3 flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href={fullGuideHref} onClick={() => setOpen(false)}>
                {locale === "hi" ? "पूरा गाइड" : "Open Full Guide"}
                <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Link>
            </Button>
            <div className="text-xs text-slate-500">{locale === "hi" ? `भूमिका: ${roleCode || "GUEST"}` : `Role: ${roleCode || "GUEST"}`}</div>
          </div>
        </div>

        <div className="p-5">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-5 h-auto">
              <TabsTrigger value="overview" className="text-xs">{locale === "hi" ? "सार" : "Overview"}</TabsTrigger>
              <TabsTrigger value="steps" className="text-xs">{locale === "hi" ? "स्टेप्स" : "Steps"}</TabsTrigger>
              <TabsTrigger value="flow" className="text-xs">{locale === "hi" ? "फ्लो" : "Decision Flow"}</TabsTrigger>
              <TabsTrigger value="faq" className="text-xs">FAQ</TabsTrigger>
              <TabsTrigger value="related" className="text-xs">{locale === "hi" ? "संबंधित" : "Related"}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="pt-4">
              <SectionList items={overview} />
            </TabsContent>

            <TabsContent value="steps" className="pt-4">
              <SectionList items={steps} />
            </TabsContent>

            <TabsContent value="flow" className="pt-4 space-y-3">
              {context.decisionFlow?.nodes?.length ? (
                context.decisionFlow.nodes.map((node) => (
                  <div key={node.id} className="rounded-lg border border-slate-200 p-3 bg-white">
                    <div className="font-semibold text-sm text-slate-900">{localize(node.title, locale)}</div>
                    <ul className="mt-2 text-xs text-slate-600 list-disc pl-4 space-y-1">
                      {node.outcomes.map((outcome, idx) => (
                        <li key={`${node.id}-${idx}`}>
                          {localize(outcome.label, locale)}
                          {outcome.resolution ? ` -> ${localize(outcome.resolution, locale)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">{locale === "hi" ? "निर्णय प्रवाह उपलब्ध नहीं है।" : "Decision flow unavailable."}</p>
              )}
            </TabsContent>

            <TabsContent value="faq" className="pt-4 space-y-3">
              {context.pageGuide
                ? (context.faqItems || []).map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 p-3 bg-white">
                    <p className="font-semibold text-sm text-slate-900">{localize(item.question, locale)}</p>
                    <p className="mt-1 text-sm text-slate-600">{localize(item.answer, locale)}</p>
                  </div>
                ))
                : (context.roleGuide?.faqs || []).map((item, idx) => (
                  <div key={`${context.roleGuide?.roleCode || "role"}-faq-${idx}`} className="rounded-lg border border-slate-200 p-3 bg-white">
                    <p className="font-semibold text-sm text-slate-900">{localize(item.q, locale)}</p>
                    <p className="mt-1 text-sm text-slate-600">{localize(item.a, locale)}</p>
                  </div>
                ))}
            </TabsContent>

            <TabsContent value="related" className="pt-4">
              {related.length ? (
                <ul className="space-y-2">
                  {related.map((route) => (
                    <li key={route}>
                      <Link href={`/help?route=${encodeURIComponent(route)}`} className="text-sm font-medium text-blue-700 hover:text-blue-900">
                        {route}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">{locale === "hi" ? "कोई संबंधित पेज नहीं।" : "No related pages."}</p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
