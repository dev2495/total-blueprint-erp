import { DECISION_FLOWS } from "@/help/content/flows";
import { FAQ_ITEMS } from "@/help/content/faq";
import { PAGE_GUIDES } from "@/help/content/pages";
import { ROLE_GUIDES } from "@/help/content/roles";
import { canonicalHelpRoute } from "@/help/legacy-routes";
import type {
  DecisionFlow,
  FAQItem,
  HelpLocale,
  LocalizedText,
  PageGuide,
  RoleGuide,
} from "@/help/types";

const MASTER_ROLES = new Set(["ADMIN", "OWNER", "SUPER_ADMIN"]);

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const trimmed = pathname.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\[\.\.\.[^\]]+\\\]/g, ".+")
    .replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function patternSpecificity(pattern: string): number {
  return pattern.split("/").reduce((score, segment) => {
    if (!segment) return score;
    if (segment.includes("[")) return score + 1;
    return score + 3;
  }, 0);
}

function isRoleCompatible(guide: PageGuide, normalizedRole: string): boolean {
  if (!normalizedRole) return true;
  if (!guide.roles || guide.roles.length === 0) return true;
  if (guide.roles.includes(normalizedRole)) return true;

  const userIsMaster = MASTER_ROLES.has(normalizedRole);
  const guideHasMasterScope = guide.roles.some((role) => MASTER_ROLES.has(role));
  return userIsMaster && guideHasMasterScope;
}

function exactGuidePriority(pathname: string, guide: PageGuide): number {
  const title = String(guide.title?.en || "").toLowerCase();

  if (pathname === "/inventory/stock-lifecycle") {
    if (title.includes("stock lifecycle")) return 120;
    if (title.includes("period") && title.includes("audit")) return 110;
    if (["fy correction", "opening stock", "stock count", "stock card", "year close"].some((legacyTitle) => title.includes(legacyTitle))) {
      return 20;
    }
  }

  return 50;
}

export function localize(text: LocalizedText | string | undefined, locale: HelpLocale): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text[locale] || text.en;
}

export function getRoleGuide(roleCode?: string | null): RoleGuide | undefined {
  const normalized = String(roleCode || "").toUpperCase();
  if (!normalized) return undefined;
  return ROLE_GUIDES.find((guide) => guide.roleCode === normalized);
}

export function resolvePageGuide(pathname: string, roleCode?: string | null): PageGuide | undefined {
  const normalizedPath = canonicalHelpRoute(normalizePath(pathname));
  const normalizedRole = String(roleCode || "").toUpperCase();

  const exactMatches = PAGE_GUIDES.filter((guide) => guide.routePattern === normalizedPath);
  const exactRoleMatch = exactMatches
    .filter((guide) => isRoleCompatible(guide, normalizedRole))
    .sort((a, b) => exactGuidePriority(normalizedPath, b) - exactGuidePriority(normalizedPath, a))[0];
  if (exactRoleMatch) return exactRoleMatch;
  if (exactMatches.length > 0) return undefined;

  const dynamicMatches = PAGE_GUIDES.filter((guide) => {
    if (!guide.routePattern.includes("[")) return false;
    return patternToRegex(guide.routePattern).test(normalizedPath);
  }).sort((a, b) => patternSpecificity(b.routePattern) - patternSpecificity(a.routePattern));

  if (!dynamicMatches.length) return undefined;
  return dynamicMatches.find((guide) => isRoleCompatible(guide, normalizedRole));
}

export function getDecisionFlow(flowId?: string | null): DecisionFlow | undefined {
  if (!flowId) return undefined;
  return DECISION_FLOWS.find((flow) => flow.id === flowId);
}

export function getFAQItems(ids?: string[] | null): FAQItem[] {
  if (!ids || ids.length === 0) return FAQ_ITEMS;
  const set = new Set(ids);
  return FAQ_ITEMS.filter((item) => set.has(item.id));
}

export function getHelpContext(pathname: string, roleCode?: string | null) {
  const pageGuide = resolvePageGuide(pathname, roleCode);
  const roleGuide = getRoleGuide(roleCode);
  const decisionFlow = getDecisionFlow(pageGuide?.decisionFlowId);
  const faqItems = getFAQItems(pageGuide?.faqRefs);

  return {
    pageGuide,
    roleGuide,
    decisionFlow,
    faqItems,
  };
}
