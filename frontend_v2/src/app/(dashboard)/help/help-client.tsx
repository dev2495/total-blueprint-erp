"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HelpFlowDiagram,
  HelpScreenshotImage,
} from "@/components/help/help-visuals";
import { MAIN_NAV_ROUTES } from "@/help/route-registry";
import {
  PAGE_GUIDES,
  ROLE_GUIDES,
  localize,
  getHelpContext,
  resolvePageGuide,
} from "@/help";
import type { PageGuide } from "@/help";
import { useHelpLocale } from "@/hooks/use-help-locale";

function SectionList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-4 space-y-1.5 text-sm text-content-2">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function HelpCenterPage() {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  const { user, effectiveRole } = useAuth();
  const { locale, setLocale } = useHelpLocale();

  const currentQuery = searchParams?.toString() || "";
  const roleCode = String(
    searchParams?.get("role") ||
      effectiveRole ||
      user?.entitlements?.role ||
      user?.role_info?.code ||
      "ADMIN",
  ).toUpperCase();
  const roleGuideFromCode =
    ROLE_GUIDES.find((guide) => guide.roleCode === roleCode) ||
    ROLE_GUIDES.find((guide) => guide.roleCode === "ADMIN");
  const selectedRoute =
    searchParams?.get("route") || roleGuideFromCode?.landingPage || pathname;

  const context = useMemo(
    () => getHelpContext(selectedRoute, roleCode),
    [selectedRoute, roleCode],
  );

  const roleGuide = context.roleGuide || roleGuideFromCode;
  const guide = context.pageGuide;

  const mainRoutes = useMemo(() => Array.from(MAIN_NAV_ROUTES).sort(), []);
  const featuredPages = useMemo(
    () =>
      mainRoutes
        .map(
          (route) =>
            resolvePageGuide(route, roleCode) ||
            PAGE_GUIDES.find((page) => page.routePattern === route),
        )
        .filter((page): page is PageGuide => Boolean(page)),
    [mainRoutes, roleCode],
  );

  const goToRouteGuide = (route: string) => {
    const query = new URLSearchParams(currentQuery);
    query.set("route", route);
    router.push(`/help?${query.toString()}`);
  };

  const goToRoleGuide = (nextRole: string) => {
    const query = new URLSearchParams(currentQuery);
    query.set("role", nextRole);
    router.push(`/help?${query.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-surface-1 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-content-1">
              {locale === "hi" ? "यूज़र हेल्प सेंटर" : "User Help Center"}
            </h1>
            <p className="text-sm text-content-3 mt-1">
              {locale === "hi"
                ? "भूमिका-आधारित मार्गदर्शन, निर्णय प्रवाह, और पेज-विशिष्ट सहायता।"
                : "Role-based guidance, decision flows, and page-specific assistance."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface-2">
              <button
                type="button"
                onClick={() => setLocale("en")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${locale === "en" ? "bg-surface-1 text-content-1" : "text-content-3"}`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLocale("hi")}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md ${locale === "hi" ? "bg-surface-1 text-content-1" : "text-content-3"}`}
              >
                HI
              </button>
            </div>
            <Badge variant="outline">
              {locale === "hi" ? `भूमिका: ${roleCode}` : `Role: ${roleCode}`}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {locale === "hi" ? "रोल गाइड" : "Role Guides"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {ROLE_GUIDES.map((guideItem) => (
                <button
                  key={guideItem.roleCode}
                  type="button"
                  onClick={() => goToRoleGuide(guideItem.roleCode)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-semibold ${roleCode === guideItem.roleCode ? "border-info-border bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2"}`}
                >
                  {guideItem.roleCode}
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {locale === "hi" ? "मुख्य पेज गाइड" : "Main Page Guides"}
              </CardTitle>
              <CardDescription className="text-xs">
                {locale === "hi"
                  ? "साइडबार और उच्च-प्रभाव पेज"
                  : "Sidebar and high-impact pages"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[420px] overflow-auto">
              {featuredPages.map((page) => (
                <button
                  key={page.routePattern}
                  type="button"
                  onClick={() => goToRouteGuide(page.routePattern)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-xs font-medium ${selectedRoute === page.routePattern ? "border-info-border bg-info-bg text-info-fg" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2"}`}
                >
                  <div className="font-semibold">
                    {localize(page.title, locale)}
                  </div>
                  <div className="text-[10px] text-content-3 mt-0.5">
                    {page.routePattern}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                {guide
                  ? localize(guide.title, locale)
                  : localize(
                      roleGuide?.title || { en: "Role Guide", hi: "रोल गाइड" },
                      locale,
                    )}
              </CardTitle>
              <CardDescription>
                {guide ? guide.routePattern : roleGuide?.landingPage}
              </CardDescription>
            </CardHeader>
            <CardContent className="max-h-[calc(100vh-220px)] space-y-5 overflow-auto pr-2">
              {guide ? (
                <>
                  <section className="rounded-lg border border-info-border bg-info-bg p-3">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "त्वरित सारांश" : "Quick Summary"}
                    </h3>
                    <p className="mt-1 text-sm font-semibold leading-5 text-content-2">
                      {localize(guide.summary, locale)}
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "उद्देश्य" : "Purpose"}
                    </h3>
                    <p className="text-sm text-content-2">
                      {localize(guide.purpose, locale)}
                    </p>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "पूर्व शर्तें" : "Prerequisites"}
                    </h3>
                    <SectionList
                      items={guide.prerequisites.map((item) =>
                        localize(item, locale),
                      )}
                    />
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "मुख्य स्टेप्स" : "Key Steps"}
                    </h3>
                    <SectionList
                      items={guide.keyActions.map((item) =>
                        localize(item, locale),
                      )}
                    />
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "फील्ड सहायता" : "Field Help"}
                    </h3>
                    <div className="grid gap-2 md:grid-cols-2">
                      {guide.fieldHelp.map((entry, idx) => (
                        <div
                          key={`${guide.routePattern}-field-${idx}`}
                          className="rounded-lg border border-line bg-surface-1 p-3"
                        >
                          <p className="text-xs font-black uppercase tracking-wide text-content-3">
                            {localize(entry.field, locale)}
                          </p>
                          <p className="mt-1 text-sm font-semibold leading-5 text-content-2">
                            {localize(entry.help, locale)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "निर्णय प्रवाह" : "Decision Flow"}
                      {context.decisionFlow
                        ? ` - ${localize(context.decisionFlow.title, locale)}`
                        : ""}
                    </h3>
                    <HelpFlowDiagram
                      flow={context.decisionFlow}
                      locale={locale}
                    />
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi" ? "सामान्य त्रुटियाँ" : "Common Errors"}
                    </h3>
                    <div className="space-y-2">
                      {guide.commonErrors.map((entry, idx) => (
                        <div
                          key={`${guide.routePattern}-err-${idx}`}
                          className="rounded-lg border border-danger-border bg-danger-bg p-3"
                        >
                          <p className="text-xs font-semibold text-danger-fg">
                            {localize(entry.error, locale)}
                          </p>
                          <p className="text-xs text-danger-fg mt-1">
                            {localize(entry.reason, locale)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">
                      {locale === "hi"
                        ? "पुनर्प्राप्ति स्टेप्स"
                        : "Recovery Steps"}
                    </h3>
                    <SectionList
                      items={guide.recoverySteps.map((item) =>
                        localize(item, locale),
                      )}
                    />
                  </section>

                  {guide.screenshotKeys.length ? (
                    <section className="space-y-2">
                      <h3 className="text-sm font-bold text-content-1">
                        {locale === "hi"
                          ? "मुख्य स्क्रीनशॉट"
                          : "Key Screenshots"}
                      </h3>
                      <div className="grid gap-3 md:grid-cols-2">
                        {guide.screenshotKeys.map((key) => (
                          <div
                            key={key}
                            className="rounded-lg border border-line p-2 bg-surface-1"
                          >
                            <HelpScreenshotImage imageKey={key} />
                            <p className="text-[10px] text-content-3 mt-1">
                              {key}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="space-y-2">
                    <h3 className="text-sm font-bold text-content-1">FAQ</h3>
                    {(context.faqItems || []).map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-line p-3 bg-surface-1"
                      >
                        <p className="text-sm font-semibold text-content-1">
                          {localize(item.question, locale)}
                        </p>
                        <p className="text-sm text-content-3 mt-1">
                          {localize(item.answer, locale)}
                        </p>
                      </div>
                    ))}
                  </section>
                </>
              ) : (
                <>
                  {roleGuide ? (
                    <>
                      <section className="space-y-2">
                        <h3 className="text-sm font-bold text-content-1">
                          {locale === "hi" ? "भूमिका अवलोकन" : "Role Overview"}
                        </h3>
                        <p className="text-sm text-content-2">
                          {localize(roleGuide.overview, locale)}
                        </p>
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-sm font-bold text-content-1">
                          {locale === "hi"
                            ? "जिम्मेदारियाँ"
                            : "Responsibilities"}
                        </h3>
                        <SectionList
                          items={roleGuide.responsibilities.map((item) =>
                            localize(item, locale),
                          )}
                        />
                      </section>

                      <section className="space-y-2">
                        <h3 className="text-sm font-bold text-content-1">
                          {locale === "hi"
                            ? "दैनिक चेकलिस्ट"
                            : "Daily Checklist"}
                        </h3>
                        <SectionList
                          items={roleGuide.dailyChecklist.map((item) =>
                            localize(item, locale),
                          )}
                        />
                      </section>
                    </>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                {locale === "hi" ? "त्वरित जंप" : "Quick Jump"}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              <Button variant="outline" asChild>
                <Link href="/system/governance">/system/governance</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/system/role-matrix">/system/role-matrix</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/sales/orders/create">/sales/orders/create</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/production/planner">/production/planner</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
