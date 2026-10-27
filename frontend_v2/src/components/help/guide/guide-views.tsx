// The help guide, rendered on the server: home, module, page, process and role views.
// Used by /help inside the ERP and by /guide, which anyone can open and share.

import fs from "fs";
import path from "path";
import Link from "next/link";
import * as React from "react";
import { ArrowRight, BookOpen, ChevronRight, Languages, LifeBuoy, ListChecks, Route, Users, Workflow } from "lucide-react";

import { HelpFlowDiagram } from "@/components/help/help-visuals";
import { cn } from "@/lib/utils";
import {
  FAQ_ITEMS,
  PROCESS_CHARTS,
  ROLE_GUIDES,
  flowById,
  guideByRoute,
  guideBySlug,
  guidesForModule,
  guidesForRole,
  moduleBySlug,
  moduleDoc,
  moduleLabel,
  modulesInUse,
  processById,
  processesForRole,
  processesForRoute,
  searchIndex,
} from "@/help/guide-data";
import { moduleSlug, routeSlug, screenshotKeyFor } from "@/help/slug";
import type { HelpLocale, PageGuide } from "@/help/types";

import { GuideLocaleMemory, GuideSearch, GuideShare, type SearchEntry } from "./guide-client-bits";
import { ProcessChartView, RoleChip, ROLE_NAMES, guideHref, t } from "./guide-bits";
import { Markdown } from "./markdown";

export type GuideParams = { page?: string; route?: string; process?: string; role?: string; module?: string; lang?: string; print?: string };
type RawGuideParams = Record<string, string | string[] | undefined>;

/** Query values can repeat (?role=a&role=b); the guide uses the first of each. */
export function normalizeGuideParams(raw: RawGuideParams | GuideParams | undefined): GuideParams {
  const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const source = (raw || {}) as RawGuideParams;
  const out: GuideParams = {};
  (["page", "route", "process", "role", "module", "lang", "print"] as const).forEach((key) => {
    const value = one(source[key]);
    if (typeof value === "string" && value) out[key] = value.slice(0, 200);
  });
  return out;
}

const SCREENSHOT_DIR = path.join(process.cwd(), "public", "help", "screenshots");

function screenshotFor(guide: PageGuide): string | null {
  const keys = [...(guide.screenshotKeys || []), screenshotKeyFor(guide.routePattern)];
  for (const key of keys) {
    for (const ext of ["png", "webp", "jpg"]) {
      if (fs.existsSync(path.join(SCREENSHOT_DIR, `${key}.${ext}`))) return `/help/screenshots/${key}.${ext}`;
    }
  }
  return null;
}

function searchEntries(basePath: string): SearchEntry[] {
  const both = (target: Parameters<typeof guideHref>[2]) => ({ en: guideHref(basePath, "en", target), hi: guideHref(basePath, "hi", target) });
  return [
    ...searchIndex().map((entry) => ({
      kind: "page" as const,
      key: entry.route,
      href: both({ page: entry.slug }),
      title: entry.title,
      detail: entry.summary,
      tag: { en: entry.module, hi: moduleLabel(entry.module, "hi") },
    })),
    ...PROCESS_CHARTS.map((process) => ({
      kind: "process" as const,
      key: process.id,
      href: both({ process: process.id }),
      title: process.title,
      detail: process.summary,
      tag: { en: "Process", hi: "प्रक्रिया" },
    })),
    ...ROLE_GUIDES.map((role) => ({
      kind: "role" as const,
      key: role.roleCode,
      href: both({ role: role.roleCode }),
      title: role.title,
      detail: role.overview,
      tag: { en: "Role", hi: "भूमिका" },
    })),
  ];
}

function Section({ title, icon, children, id }: { title: string; icon?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] sm:p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-content-1">
        {icon}
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Crumbs({ basePath, locale, items }: { basePath: string; locale: HelpLocale; items: Array<{ label: string; href?: string }> }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[12.5px] text-content-3">
      <Link href={guideHref(basePath, locale)} className="hover:text-content-1">
        {locale === "hi" ? "मदद गाइड" : "Help guide"}
      </Link>
      {items.map((item, index) => (
        <React.Fragment key={index}>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          {item.href ? (
            <Link href={item.href} className="hover:text-content-1">
              {item.label}
            </Link>
          ) : (
            <span className="text-content-2">{item.label}</span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

function LangToggle({ basePath, locale, params }: { basePath: string; locale: HelpLocale; params: GuideParams }) {
  // Old links say ?route=/sales/orders; the toggle keeps the same page.
  const routeGuide = !params.page && params.route ? guideByRoute(params.route) : undefined;
  const target = {
    page: params.page || (routeGuide ? routeSlug(routeGuide.routePattern) : undefined),
    process: params.process,
    role: params.role,
    module: params.module,
  };
  const base = "inline-flex h-9 items-center rounded-[9px] px-3 text-[13px] font-semibold transition-colors";
  return (
    <nav aria-label="Language" className="inline-flex items-center gap-0.5 rounded-[12px] border border-line-strong bg-surface-2 p-0.5" data-testid="guide-language">
      <Languages className="mx-1.5 h-4 w-4 text-content-4" aria-hidden />
      <Link href={guideHref(basePath, "en", target)} aria-current={locale === "en" ? "true" : undefined} className={cn(base, locale === "en" ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3 hover:text-content-1")}>
        English
      </Link>
      <Link href={guideHref(basePath, "hi", target)} aria-current={locale === "hi" ? "true" : undefined} className={cn(base, locale === "hi" ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3 hover:text-content-1")}>
        हिंदी
      </Link>
    </nav>
  );
}

function GuideCard({ guide, basePath, locale }: { guide: PageGuide; basePath: string; locale: HelpLocale }) {
  return (
    <Link
      href={guideHref(basePath, locale, { page: routeSlug(guide.routePattern) })}
      className="group block rounded-[14px] border border-line bg-surface-1 p-3.5 transition-colors hover:border-info-border hover:bg-info-bg"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[14.5px] font-semibold leading-5 text-content-1">{t(guide.title, locale)}</span>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-content-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
      <p className="mt-1 line-clamp-3 text-[12.5px] leading-5 text-content-3">{t(guide.summary, locale)}</p>
      <div className="mt-2 truncate font-mono text-[11px] text-content-4">{guide.routePattern}</div>
    </Link>
  );
}

function firstParagraph(markdown: string): string {
  const para = String(markdown || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith("#") && !block.startsWith("|") && !/^[-*\d]/.test(block));
  return (para || "").replace(/\*\*|`/g, "").slice(0, 220);
}

// ─── Views ──────────────────────────────────────────────────────

function HomeView({ basePath, locale }: { basePath: string; locale: HelpLocale }) {
  const modules = modulesInUse();
  const mainProcess = PROCESS_CHARTS[0];
  return (
    <div className="grid gap-4">
      <section className="rounded-[20px] bg-plate p-5 text-plate-fg sm:p-7">
        <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-plate-fg-3">Total Poly Print ERP</div>
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">
          {locale === "hi" ? "हर स्क्रीन, हर काम: आसान भाषा में" : "Every screen and every job, in plain words"}
        </h1>
        <p className="mt-2 max-w-[720px] text-[14px] leading-6 text-plate-fg-2">
          {locale === "hi"
            ? "स्क्रीन का नाम, बटन या काम लिखकर खोजें। हर पेज पर स्टेप, फ़ील्ड का मतलब, आम गलतियाँ और उनका हल है। लिंक शेयर करें: वह उसी भाषा में खुलेगा।"
            : "Search by screen, button or job. Every page has the steps, what each field means, the usual problems and how to fix them. Share any link: it opens in the same language."}
        </p>
      </section>

      {mainProcess ? (
        <Section title={locale === "hi" ? `पूरा काम एक नज़र में: ${t(mainProcess.title, locale)}` : `The whole job at a glance: ${t(mainProcess.title, locale)}`} icon={<Workflow className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <p className="mb-3 text-[13px] text-content-3">{t(mainProcess.summary, locale)}</p>
          <ProcessChartView process={mainProcess} basePath={basePath} locale={locale} compact />
        </Section>
      ) : null}

      <Section title={locale === "hi" ? "मॉड्यूल" : "Modules"} icon={<BookOpen className="h-4.5 w-4.5 text-primary" aria-hidden />}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => {
            const doc = moduleDoc(module);
            const count = guidesForModule(module).length;
            return (
              <Link
                key={module}
                href={guideHref(basePath, locale, { module: moduleSlug(module) })}
                className="group block rounded-[14px] border border-line bg-surface-1 p-3.5 transition-colors hover:border-info-border hover:bg-info-bg"
                data-testid={`guide-module-${moduleSlug(module)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-content-1">{moduleLabel(module, locale)}</span>
                  {count ? (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] font-semibold text-content-3">
                      {count} {locale === "hi" ? "पेज" : count === 1 ? "page" : "pages"}
                    </span>
                  ) : null}
                </div>
                {doc ? <p className="mt-1 line-clamp-3 text-[12.5px] leading-5 text-content-3">{firstParagraph(locale === "hi" ? doc.hi : doc.en)}</p> : null}
              </Link>
            );
          })}
        </div>
      </Section>

      <Section title={locale === "hi" ? "मेरी भूमिका" : "My role"} icon={<Users className="h-4.5 w-4.5 text-primary" aria-hidden />}>
        <div className="flex flex-wrap gap-2">
          {ROLE_GUIDES.map((role) => (
            <Link key={role.roleCode} href={guideHref(basePath, locale, { role: role.roleCode })} className="rounded-full transition-opacity hover:opacity-85">
              <RoleChip role={role.roleCode} locale={locale} className="h-8 px-3 text-[12.5px]" />
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-content-3">
          {locale === "hi"
            ? "अपनी भूमिका चुनें: रोज़ का काम, आपके पेज और आप किन प्रक्रियाओं में हैं।"
            : "Pick your role: your daily routine, your pages and the processes you take part in."}
        </p>
      </Section>

      <Section title={locale === "hi" ? `प्रक्रियाएँ (फ़्लो चार्ट) · ${PROCESS_CHARTS.length}` : `Processes (flow charts) · ${PROCESS_CHARTS.length}`} icon={<Route className="h-4.5 w-4.5 text-primary" aria-hidden />}>
        <ul className="grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
          {PROCESS_CHARTS.map((process) => (
            <li key={process.id} className="min-w-0">
              <Link href={guideHref(basePath, locale, { process: process.id })} className="flex h-full items-start justify-between gap-2 rounded-[10px] px-2.5 py-2 hover:bg-surface-2">
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-content-1">{t(process.title, locale)}</span>
                  <span className="line-clamp-2 block text-[12px] text-content-3">{t(process.summary, locale)}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-[12px] text-content-4">{process.steps.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {FAQ_ITEMS.length ? (
        <Section title={locale === "hi" ? "अक्सर पूछे जाने वाले सवाल" : "Frequently asked"} icon={<LifeBuoy className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <div className="grid gap-2">
            {FAQ_ITEMS.map((item) => (
              <details key={item.id} className="group rounded-[12px] border border-line px-3.5 py-2.5">
                <summary className="cursor-pointer list-none text-[14px] font-semibold text-content-1">{t(item.question, locale)}</summary>
                <p className="mt-1.5 text-[13.5px] leading-6 text-content-2">{t(item.answer, locale)}</p>
              </details>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function ModuleView({ module, basePath, locale }: { module: string; basePath: string; locale: HelpLocale }) {
  const doc = moduleDoc(module);
  const guides = guidesForModule(module);
  const processes = PROCESS_CHARTS.filter((process) => process.modules?.includes(module) || process.steps.some((step) => guides.some((g) => g.routePattern === step.route)));
  return (
    <div className="grid gap-4">
      <div>
        <Crumbs basePath={basePath} locale={locale} items={[{ label: moduleLabel(module, locale) }]} />
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-content-1">{moduleLabel(module, locale)}</h1>
      </div>
      {doc ? (
        <Section title={locale === "hi" ? "यह मॉड्यूल कैसे काम करता है" : "How this module works"} icon={<BookOpen className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <Markdown source={locale === "hi" ? doc.hi : doc.en} className="max-w-[860px]" />
        </Section>
      ) : null}
      {processes.length ? (
        <Section title={locale === "hi" ? "इस मॉड्यूल की प्रक्रियाएँ" : "Processes in this module"} icon={<Route className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <div className="flex flex-wrap gap-2">
            {processes.map((process) => (
              <Link key={process.id} href={guideHref(basePath, locale, { process: process.id })} className="rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[13px] font-semibold text-content-2 hover:border-info-border hover:bg-info-bg">
                {t(process.title, locale)}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
      <Section title={locale === "hi" ? `पेज (${guides.length})` : `Pages (${guides.length})`} icon={<ListChecks className="h-4.5 w-4.5 text-primary" aria-hidden />}>
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {guides.map((guide) => (
            <GuideCard key={guide.routePattern} guide={guide} basePath={basePath} locale={locale} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function PageView({ guide, basePath, locale }: { guide: PageGuide; basePath: string; locale: HelpLocale }) {
  const shot = screenshotFor(guide);
  const flow = flowById(guide.decisionFlowId);
  const processes = processesForRoute(guide.routePattern);
  const related = (guide.relatedRoutes || []).map((route) => guideByRoute(route)).filter((g): g is PageGuide => Boolean(g) && g!.routePattern !== guide.routePattern);
  return (
    <div className="grid gap-4" data-testid="guide-page-view">
      <div>
        <Crumbs basePath={basePath} locale={locale} items={[{ label: moduleLabel(guide.module, locale), href: guideHref(basePath, locale, { module: moduleSlug(guide.module) }) }, { label: t(guide.title, locale) }]} />
        <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-content-1">{t(guide.title, locale)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-content-2">{guide.routePattern}</span>
          {(guide.roles || []).map((role) => (
            <RoleChip key={role} role={role} locale={locale} />
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-4">
          <section className="rounded-[18px] border border-info-border bg-info-bg p-4 sm:p-5">
            <p className="text-[15px] font-semibold leading-6 text-content-1">{t(guide.summary, locale)}</p>
            <p className="mt-2 text-[14px] leading-6 text-content-2">{t(guide.purpose, locale)}</p>
          </section>
          <Section title={locale === "hi" ? "कैसे करें: स्टेप बाय स्टेप" : "How to do it, step by step"} icon={<ListChecks className="h-4.5 w-4.5 text-primary" aria-hidden />}>
            <ol className="grid gap-2">
              {guide.keyActions.map((step, index) => (
                <li key={index} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[12.5px] font-bold text-primary-foreground">{index + 1}</span>
                  <span className="pt-0.5 text-[14px] leading-6 text-content-1">{t(step, locale)}</span>
                </li>
              ))}
            </ol>
          </Section>
          {guide.prerequisites?.length ? (
            <Section title={locale === "hi" ? "शुरू करने से पहले" : "Before you start"}>
              <ul className="list-disc space-y-1 pl-5 text-[14px] leading-6 text-content-2">
                {guide.prerequisites.map((item, index) => (
                  <li key={index}>{t(item, locale)}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <div className="grid content-start gap-4">
          {shot ? (
            <figure className="overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
              <img src={shot} alt={t(guide.title, locale)} className="block w-full" loading="lazy" />
              <figcaption className="border-t border-line px-3.5 py-2 text-[12px] text-content-3">
                {locale === "hi" ? "स्क्रीन का उदाहरण (टेस्ट डेटा)" : "What the screen looks like (test data)"}
              </figcaption>
            </figure>
          ) : null}
          {processes.length ? (
            <Section title={locale === "hi" ? "यह पेज किस प्रक्रिया में आता है" : "Where this page sits in the process"} icon={<Route className="h-4.5 w-4.5 text-primary" aria-hidden />}>
              <div className="grid gap-2">
                {processes.map((process) => {
                  const index = process.steps.findIndex((step) => step.route === guide.routePattern);
                  const prev = process.steps[index - 1];
                  const next = process.steps[index + 1];
                  return (
                    <Link key={process.id} href={guideHref(basePath, locale, { process: process.id })} className="block rounded-[12px] border border-line px-3 py-2.5 hover:border-info-border hover:bg-info-bg">
                      <span className="block text-[14px] font-semibold text-content-1">{t(process.title, locale)}</span>
                      <span className="mt-0.5 block text-[12.5px] text-content-3">
                        {locale === "hi" ? "स्टेप" : "Step"} {index + 1}/{process.steps.length}
                        {prev ? ` · ${locale === "hi" ? "पहले" : "before"}: ${t(prev.title, locale)}` : ""}
                        {next ? ` · ${locale === "hi" ? "बाद में" : "next"}: ${t(next.title, locale)}` : ""}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </Section>
          ) : null}
        </div>
      </div>

      {guide.fieldHelp?.length ? (
        <Section title={locale === "hi" ? "स्क्रीन पर क्या है, उसका मतलब" : "What each part of the screen means"}>
          <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {guide.fieldHelp.map((entry, index) => (
              <div key={index} className="rounded-[12px] border border-line bg-surface-1 p-3">
                <dt className="text-[13px] font-semibold text-content-1">{t(entry.field, locale)}</dt>
                <dd className="mt-1 text-[13px] leading-5 text-content-2">{t(entry.help, locale)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {guide.commonErrors?.length ? (
          <Section title={locale === "hi" ? "आम दिक्कतें और हल" : "Common problems and fixes"} icon={<LifeBuoy className="h-4.5 w-4.5 text-warning-fg" aria-hidden />}>
            <div className="grid gap-2">
              {guide.commonErrors.map((entry, index) => (
                <div key={index} className="rounded-[12px] border border-warning-border bg-warning-bg p-3">
                  <p className="text-[13.5px] font-semibold text-warning-fg">{t(entry.error, locale)}</p>
                  <p className="mt-1 text-[13px] leading-5 text-content-1">{t(entry.reason, locale)}</p>
                </div>
              ))}
            </div>
          </Section>
        ) : null}
        {guide.recoverySteps?.length ? (
          <Section title={locale === "hi" ? "अटक गए? यह करें" : "Stuck? Do this"}>
            <ol className="list-decimal space-y-1 pl-5 text-[14px] leading-6 text-content-2">
              {guide.recoverySteps.map((item, index) => (
                <li key={index}>{t(item, locale)}</li>
              ))}
            </ol>
          </Section>
        ) : null}
      </div>

      {flow?.nodes?.length ? (
        <Section title={`${locale === "hi" ? "निर्णय फ़्लो" : "Decision flow"}: ${t(flow.title, locale)}`} icon={<Workflow className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <HelpFlowDiagram flow={flow} locale={locale} />
        </Section>
      ) : null}

      {related.length ? (
        <Section title={locale === "hi" ? "जुड़े हुए पेज" : "Related pages"}>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {related.map((item) => (
              <GuideCard key={item.routePattern} guide={item} basePath={basePath} locale={locale} />
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function ProcessView({ id, basePath, locale }: { id: string; basePath: string; locale: HelpLocale }) {
  const process = processById(id);
  if (!process) return <NotFound basePath={basePath} locale={locale} />;
  return (
    <div className="grid gap-4">
      <div>
        <Crumbs basePath={basePath} locale={locale} items={[{ label: locale === "hi" ? "प्रक्रिया" : "Process" }, { label: t(process.title, locale) }]} />
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-content-1">{t(process.title, locale)}</h1>
        <p className="mt-1.5 max-w-[820px] text-[14px] leading-6 text-content-2">{t(process.summary, locale)}</p>
      </div>
      <Section title={locale === "hi" ? "फ़्लो चार्ट" : "Flow chart"} icon={<Workflow className="h-4.5 w-4.5 text-primary" aria-hidden />}>
        <ProcessChartView process={process} basePath={basePath} locale={locale} />
      </Section>
    </div>
  );
}

function RoleView({ code, basePath, locale }: { code: string; basePath: string; locale: HelpLocale }) {
  const role = ROLE_GUIDES.find((guide) => guide.roleCode === code);
  if (!role && !ROLE_NAMES[code]) return <NotFound basePath={basePath} locale={locale} />;
  const pages = guidesForRole(code);
  const processes = processesForRole(code);
  const landing = role?.landingPage ? guideByRoute(role.landingPage) : undefined;
  const list = (title: string, items?: Array<{ en: string; hi: string }>) =>
    items?.length ? (
      <Section title={title}>
        <ul className="list-disc space-y-1 pl-5 text-[14px] leading-6 text-content-2">
          {items.map((item, index) => (
            <li key={index}>{t(item, locale)}</li>
          ))}
        </ul>
      </Section>
    ) : null;
  return (
    <div className="grid gap-4">
      <div>
        <Crumbs basePath={basePath} locale={locale} items={[{ label: locale === "hi" ? "भूमिका" : "Role" }, { label: t(ROLE_NAMES[code] || code, locale) }]} />
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-content-1">{role ? t(role.title, locale) : t(ROLE_NAMES[code] || code, locale)}</h1>
        {role ? <p className="mt-1.5 max-w-[820px] text-[14px] leading-6 text-content-2">{t(role.overview, locale)}</p> : null}
        {landing ? (
          <Link href={guideHref(basePath, locale, { page: routeSlug(landing.routePattern) })} className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-primary hover:underline">
            {locale === "hi" ? "शुरुआत का पेज" : "Start page"}: {t(landing.title, locale)} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {list(locale === "hi" ? "रोज़ की चेकलिस्ट" : "Daily checklist", role?.dailyChecklist)}
        {list(locale === "hi" ? "ज़िम्मेदारियाँ" : "Responsibilities", role?.responsibilities)}
        {list(locale === "hi" ? "मुख्य काम" : "Core work", role?.coreWorkflows)}
        {list(locale === "hi" ? "किससे बात करें" : "Who to go to", role?.escalationPaths)}
      </div>
      {processes.length ? (
        <Section title={locale === "hi" ? "आपकी प्रक्रियाएँ" : "Your processes"} icon={<Route className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <div className="flex flex-wrap gap-2">
            {processes.map((process) => (
              <Link key={process.id} href={guideHref(basePath, locale, { process: process.id })} className="rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[13px] font-semibold text-content-2 hover:border-info-border hover:bg-info-bg">
                {t(process.title, locale)}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
      {pages.length ? (
        <Section title={locale === "hi" ? `आपके पेज (${pages.length})` : `Your pages (${pages.length})`} icon={<ListChecks className="h-4.5 w-4.5 text-primary" aria-hidden />}>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {pages.map((guide) => (
              <GuideCard key={guide.routePattern} guide={guide} basePath={basePath} locale={locale} />
            ))}
          </div>
        </Section>
      ) : null}
      {role?.faqs?.length ? (
        <Section title="FAQ">
          <div className="grid gap-2">
            {role.faqs.map((item, index) => (
              <details key={index} className="rounded-[12px] border border-line px-3.5 py-2.5">
                <summary className="cursor-pointer list-none text-[14px] font-semibold text-content-1">{t(item.q, locale)}</summary>
                <p className="mt-1.5 text-[13.5px] leading-6 text-content-2">{t(item.a, locale)}</p>
              </details>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function NotFound({ basePath, locale }: { basePath: string; locale: HelpLocale }) {
  return (
    <div className="rounded-[18px] border border-dashed border-line px-5 py-10 text-center">
      <p className="text-[15px] font-semibold text-content-1">{locale === "hi" ? "यह गाइड नहीं मिली।" : "This guide was not found."}</p>
      <Link href={guideHref(basePath, locale)} className="mt-2 inline-block text-[13.5px] font-semibold text-primary hover:underline">
        {locale === "hi" ? "गाइड के होम पर जाएँ" : "Go to the guide home"}
      </Link>
    </div>
  );
}

function titleFor(params: GuideParams, locale: HelpLocale): string {
  const page = params.page ? guideBySlug(params.page) : params.route ? guideByRoute(params.route) : undefined;
  if (page) return t(page.title, locale);
  if (params.process) return t(processById(params.process)?.title, locale) || "TPP ERP";
  if (params.module) {
    const found = moduleBySlug(params.module);
    if (found) return moduleLabel(found, locale);
  }
  if (params.role && ROLE_NAMES[params.role.toUpperCase()]) return t(ROLE_NAMES[params.role.toUpperCase()], locale);
  return locale === "hi" ? "TPP ERP मदद गाइड" : "TPP ERP help guide";
}

/** Picks the view from the query (?page=, ?route=, ?process=, ?role=, ?module=) and draws the guide chrome. */
export function GuideRouter({ basePath, params: rawParams, publicView = false }: { basePath: string; params: GuideParams | RawGuideParams; publicView?: boolean }) {
  const params = normalizeGuideParams(rawParams);
  const locale: HelpLocale = params.lang === "hi" ? "hi" : "en";
  let body: React.ReactNode;
  if (params.page || params.route) {
    const guide = params.page ? guideBySlug(params.page) : guideByRoute(String(params.route || ""));
    body = guide ? <PageView guide={guide} basePath={basePath} locale={locale} /> : <NotFound basePath={basePath} locale={locale} />;
  } else if (params.process) {
    body = <ProcessView id={params.process} basePath={basePath} locale={locale} />;
  } else if (params.role) {
    body = <RoleView code={params.role.toUpperCase()} basePath={basePath} locale={locale} />;
  } else if (params.module) {
    const found = moduleBySlug(params.module);
    // ?print=1: the module and every page in full, one after another (for PDFs and printing).
    body = !found ? (
      <NotFound basePath={basePath} locale={locale} />
    ) : params.print === "1" ? (
      <div className="grid gap-10">
        <ModuleView module={found} basePath={basePath} locale={locale} />
        {guidesForModule(found).map((guide) => (
          <div key={guide.routePattern} className="break-before-page">
            <PageView guide={guide} basePath={basePath} locale={locale} />
          </div>
        ))}
      </div>
    ) : (
      <ModuleView module={found} basePath={basePath} locale={locale} />
    );
  } else {
    body = <HomeView basePath={basePath} locale={locale} />;
  }
  return (
    <div lang={locale} className={cn("mx-auto grid w-full max-w-[1320px] gap-4", publicView ? "px-4 pb-16 pt-4 sm:px-6" : "pb-12")} data-testid="guide-root">
      <GuideLocaleMemory locale={locale} />
      <header className="flex flex-wrap items-center gap-3 rounded-[18px] border border-line bg-surface-1 px-3.5 py-3 shadow-[var(--shadow-sm)] print:hidden">
        <Link href={guideHref(basePath, locale)} className="flex shrink-0 items-center gap-2">
          <img src="/brand/tpp-logo-mark.svg" alt="" className="h-8 w-8" />
          <span className="text-[15px] font-semibold text-content-1">{locale === "hi" ? "मदद गाइड" : "Help guide"}</span>
        </Link>
        <div className="order-3 w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <GuideSearch entries={searchEntries(basePath)} locale={locale} />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <LangToggle basePath={basePath} locale={locale} params={params} />
          <GuideShare title={titleFor(params, locale)} locale={locale} />
        </div>
      </header>
      {body}
    </div>
  );
}

export function guideTitle(rawParams: GuideParams | RawGuideParams): string {
  const params = normalizeGuideParams(rawParams);
  const locale: HelpLocale = params.lang === "hi" ? "hi" : "en";
  return titleFor(params, locale);
}
