"use client";

// Finds the help guide for the page being used and loads only that guide
// (public/help/data, written at build time by scripts/build_help_data.mjs).

import { useQuery } from "@tanstack/react-query";

import { canonicalHelpRoute } from "@/help/legacy-routes";
import type { DecisionFlow, LocalizedText, PageGuide } from "@/help/types";

type IndexEntry = { slug: string; route: string; module: string; roles: string[]; title: LocalizedText };

const MASTER_ROLES = new Set(["ADMIN", "OWNER", "SUPER_ADMIN"]);

function normalizePath(pathname: string): string {
  const trimmed = String(pathname || "/").trim().split("?")[0];
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\[\.\.\.[^\]]+\\\]/g, ".+")
    .replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function specificity(pattern: string): number {
  return pattern.split("/").reduce((score, segment) => (!segment ? score : score + (segment.includes("[") ? 1 : 3)), 0);
}

function roleFits(entry: IndexEntry, role: string): boolean {
  if (!role || !entry.roles?.length || entry.roles.includes(role)) return true;
  return MASTER_ROLES.has(role) && entry.roles.some((item) => MASTER_ROLES.has(item));
}

export function matchHelpEntry(index: IndexEntry[], pathname: string, role = ""): IndexEntry | undefined {
  const path = canonicalHelpRoute(normalizePath(pathname));
  const exact = index.filter((entry) => entry.route === path);
  if (exact.length) return exact.find((entry) => roleFits(entry, role)) || exact[0];
  return index
    .filter((entry) => entry.route.includes("[") && patternToRegex(entry.route).test(path))
    .sort((a, b) => specificity(b.route) - specificity(a.route))
    .find((entry) => roleFits(entry, role));
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  // Default caching: the browser revalidates, so a release's new guides show without a hard refresh.
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Help file ${url} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export function usePageHelp(pathname: string, role = "", enabled = true) {
  const index = useQuery({
    queryKey: ["help-index"],
    queryFn: ({ signal }) => getJson<IndexEntry[]>("/help/data/index.json", signal),
    staleTime: 60 * 60 * 1000,
    enabled,
  });
  const entry = index.data ? matchHelpEntry(index.data, pathname, role.toUpperCase()) : undefined;
  const page = useQuery({
    queryKey: ["help-page", entry?.slug],
    queryFn: ({ signal }) => getJson<{ guide: PageGuide; flow: DecisionFlow | null }>(`/help/data/pages/${entry!.slug}.json`, signal),
    enabled: enabled && Boolean(entry?.slug),
    staleTime: 60 * 60 * 1000,
  });
  return {
    slug: entry?.slug,
    pageGuide: page.data?.guide,
    decisionFlow: page.data?.flow || undefined,
    isLoading: index.isLoading || page.isLoading,
  };
}
