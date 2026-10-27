// Server-side lookups for the help guide pages (/help in the app, /guide for everyone).
// The full content stays on the server; the browser only receives the page being read.

import { DECISION_FLOWS } from "@/help/content/flows";
import { FAQ_ITEMS } from "@/help/content/faq";
import { MODULE_DOCS } from "@/help/content/modules";
import { PAGE_GUIDES } from "@/help/content/pages";
import { PROCESS_CHARTS } from "@/help/content/processes";
import { ROLE_GUIDES } from "@/help/content/roles";
import { isLegacyRedirectRoute } from "@/help/legacy-routes";
import { resolvePageGuide } from "@/help/resolver";
import { moduleSlug, routeSlug } from "@/help/slug";
import type { GuideIndexEntry, HelpLocale, LocalizedText, ModuleDoc, PageGuide, ProcessChart } from "@/help/types";

/** Modules in the order work flows through the plant. */
export const MODULE_ORDER = [
  "Sales",
  "Planner",
  "Production",
  "Dashboard",
  "Logistics",
  "Inventory",
  "Gate",
  "Master Data",
  "Engineering",
  "Factory",
  "Maintenance",
  "Procurement",
  "Analytics",
  "System",
  "Access",
  "Profile",
  "Help Center",
];

export const MODULE_LABELS: Record<string, LocalizedText> = {
  Sales: { en: "Sales", hi: "सेल्स" },
  Planner: { en: "Planner", hi: "प्लानर" },
  Production: { en: "Production", hi: "प्रोडक्शन" },
  Dashboard: { en: "Dashboards & control tower", hi: "डैशबोर्ड और कंट्रोल टावर" },
  Logistics: { en: "Packing & dispatch", hi: "पैकिंग और डिस्पैच" },
  Inventory: { en: "Inventory & stores", hi: "इन्वेंटरी और स्टोर" },
  Gate: { en: "Gate", hi: "गेट" },
  "Master Data": { en: "Master data", hi: "मास्टर डेटा" },
  Engineering: { en: "Engineering", hi: "इंजीनियरिंग" },
  Factory: { en: "Factory setup", hi: "फैक्ट्री सेटअप" },
  Maintenance: { en: "Maintenance", hi: "मेंटेनेंस" },
  Procurement: { en: "Procurement", hi: "खरीद" },
  Analytics: { en: "Analytics & reports", hi: "एनालिटिक्स और रिपोर्ट" },
  System: { en: "System & admin", hi: "सिस्टम और एडमिन" },
  Access: { en: "Sign in", hi: "साइन इन" },
  Profile: { en: "Profile", hi: "प्रोफ़ाइल" },
  "Help Center": { en: "Help", hi: "मदद" },
};

export function moduleLabel(module: string, locale: HelpLocale): string {
  const label = MODULE_LABELS[module];
  return label ? label[locale] || label.en : module;
}

/** Every guide a reader can open (legacy redirect routes are folded into their new page). */
export const READABLE_GUIDES: PageGuide[] = PAGE_GUIDES.filter((guide) => !isLegacyRedirectRoute(guide.routePattern));

export function guideBySlug(slug: string): PageGuide | undefined {
  const wanted = String(slug || "").toLowerCase();
  return READABLE_GUIDES.find((guide) => routeSlug(guide.routePattern) === wanted);
}

/** A guide for a real path (dynamic segments such as /sales/orders/123 resolve to their pattern). */
export function guideByRoute(route: string): PageGuide | undefined {
  return resolvePageGuide(route, "") || READABLE_GUIDES.find((guide) => guide.routePattern === route);
}

export function flowById(id?: string) {
  return id ? DECISION_FLOWS.find((flow) => flow.id === id) : undefined;
}

export function processById(id: string): ProcessChart | undefined {
  return PROCESS_CHARTS.find((process) => process.id === id);
}

export function processesForRoute(route: string): ProcessChart[] {
  return PROCESS_CHARTS.filter((process) => process.steps.some((step) => step.route === route));
}

export function processesForRole(role: string): ProcessChart[] {
  return PROCESS_CHARTS.filter((process) => process.steps.some((step) => step.role === role));
}

export function moduleDoc(module: string): ModuleDoc | undefined {
  const slug = moduleSlug(module);
  return MODULE_DOCS.find((doc) => doc.slug === slug || moduleSlug(doc.module) === slug);
}

export function moduleBySlug(slug: string): string | undefined {
  return modulesInUse().find((module) => moduleSlug(module) === slug);
}

export function modulesInUse(): string[] {
  const present = new Set(READABLE_GUIDES.map((guide) => guide.module));
  MODULE_DOCS.forEach((doc) => present.add(doc.module));
  const ordered = MODULE_ORDER.filter((module) => present.has(module));
  const rest = Array.from(present).filter((module) => !MODULE_ORDER.includes(module)).sort();
  return [...ordered, ...rest];
}

export function guidesForModule(module: string): PageGuide[] {
  return READABLE_GUIDES.filter((guide) => guide.module === module).sort((a, b) => a.routePattern.localeCompare(b.routePattern));
}

export function guidesForRole(role: string): PageGuide[] {
  return READABLE_GUIDES.filter((guide) => (guide.roles || []).includes(role));
}

export function searchIndex(): GuideIndexEntry[] {
  return READABLE_GUIDES.map((guide) => ({
    slug: routeSlug(guide.routePattern),
    route: guide.routePattern,
    module: guide.module,
    roles: guide.roles || [],
    title: guide.title,
    summary: guide.summary,
  }));
}

export { FAQ_ITEMS, PROCESS_CHARTS, ROLE_GUIDES, MODULE_DOCS };
