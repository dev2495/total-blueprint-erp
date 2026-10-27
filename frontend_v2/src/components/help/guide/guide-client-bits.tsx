"use client";

// Browser-side pieces of the help guide: search across every guide, share a link, and
// remember the reader's language.

import Link from "next/link";
import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, Link2, Search, Share2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { HelpLocale, LocalizedText } from "@/help/types";

type SearchEntry = {
  kind: "page" | "process" | "role" | "module";
  key: string;
  href: { en: string; hi: string };
  title: LocalizedText;
  detail: LocalizedText;
  tag: LocalizedText;
};

const LOCALE_KEY = "tbp_help_locale";

function normalise(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/\s+/g, " ").trim();
}

export function GuideSearch({ entries, locale, autoFocus = false }: { entries: SearchEntry[]; locale: HelpLocale; autoFocus?: boolean }) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const router = useRouter();
  const needle = normalise(query);
  const results = React.useMemo(() => {
    if (needle.length < 2) return [];
    const words = needle.split(" ");
    return entries
      .map((entry) => {
        const haystack = normalise(`${entry.title.en} ${entry.title.hi} ${entry.detail.en} ${entry.detail.hi} ${entry.key} ${entry.tag.en}`);
        const title = normalise(`${entry.title.en} ${entry.title.hi}`);
        if (!words.every((word) => haystack.includes(word))) return null;
        const score = (title.includes(needle) ? 10 : 0) + (title.startsWith(needle) ? 5 : 0) + (entry.kind === "page" ? 1 : 2);
        return { entry, score };
      })
      .filter((row): row is { entry: SearchEntry; score: number } => Boolean(row))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((row) => row.entry);
  }, [entries, needle]);
  React.useEffect(() => setActive(0), [needle]);

  return (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((value) => Math.min(value + 1, results.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(0, value - 1));
          } else if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            const href = results[active].href[locale];
            setQuery("");
            router.push(href);
          } else if (event.key === "Escape") {
            setQuery("");
          }
        }}
        placeholder={locale === "hi" ? "खोजें: स्क्रीन, काम, बटन… (जैसे dispatch slip)" : "Search screens, tasks, buttons… (e.g. dispatch slip)"}
        aria-label={locale === "hi" ? "गाइड में खोजें" : "Search the guide"}
        className="h-11 w-full rounded-[12px] border border-line-strong bg-surface-1 pl-9 pr-3 text-[14px] text-content-1 outline-none transition placeholder:text-content-4 focus:border-primary focus:ring-4 focus:ring-info-bg [&::-webkit-search-cancel-button]:hidden"
        data-testid="guide-search"
      />
      {needle.length >= 2 ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-40 mt-1.5 max-h-[60vh] overflow-y-auto rounded-[14px] border border-line bg-surface-1 p-1 shadow-[var(--shadow-lg)]"
        >
          {results.length ? (
            results.map((entry, index) => (
              <li key={`${entry.kind}-${entry.key}`}>
                <Link
                  href={entry.href[locale]}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => setQuery("")}
                  className={cn("block rounded-[10px] px-3 py-2", index === active ? "bg-info-bg" : "hover:bg-surface-2")}
                >
                  <span className="flex items-center gap-2">
                    <span className="rounded-md bg-surface-2 px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-[0.05em] text-content-3">
                      {entry.tag[locale] || entry.tag.en}
                    </span>
                    <span className="truncate text-[14px] font-semibold text-content-1">{entry.title[locale] || entry.title.en}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-content-3">{entry.detail[locale] || entry.detail.en}</span>
                </Link>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-[13px] text-content-3">
              {locale === "hi" ? "कुछ नहीं मिला। कोई और शब्द आज़माएँ।" : "Nothing found. Try another word."}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/** The link to share: always the public guide (/guide opens without signing in), even from /help in the app. */
function publicUrl(): string {
  const url = new URL(window.location.href);
  if (url.pathname === "/help" || url.pathname.startsWith("/help/")) url.pathname = "/guide";
  return url.toString();
}

/** Share the guide page: the phone's share sheet when there is one, WhatsApp, or copy the link. */
export function GuideShare({ title, locale }: { title: string; locale: HelpLocale }) {
  const [copied, setCopied] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const sharePath = usePathname();
  const shareParams = useSearchParams();
  // Guide pages change only the query, so follow it: WhatsApp always shares the page on screen.
  React.useEffect(() => setUrl(publicUrl()), [sharePath, shareParams]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(locale === "hi" ? "यह लिंक कॉपी करें" : "Copy this link", publicUrl());
    }
  };
  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: { title: string; url: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title, url: publicUrl() });
        return;
      } catch {
        // cancelled: fall back to copying
      }
    }
    await copy();
  };
  const button = "inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-surface-1 px-3 text-[13px] font-semibold text-content-2 transition-colors hover:border-line-strong hover:text-content-1";
  return (
    <div className="flex items-center gap-1.5" data-testid="guide-share">
      <button type="button" onClick={share} className={button}>
        <Share2 className="h-4 w-4" aria-hidden /> {locale === "hi" ? "शेयर" : "Share"}
      </button>
      <a
        href={url ? `https://wa.me/?text=${encodeURIComponent(`${title}\n${url}`)}` : "#"}
        target="_blank"
        rel="noreferrer"
        className={button}
      >
        WhatsApp
      </a>
      <button type="button" onClick={copy} className={button} aria-live="polite">
        {copied ? <Check className="h-4 w-4 text-success-fg" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        {copied ? (locale === "hi" ? "कॉपी हुआ" : "Copied") : locale === "hi" ? "लिंक" : "Link"}
      </button>
    </div>
  );
}

/** Opens the guide in the language the reader picked last time; a shared ?lang= link always wins. */
export function GuideLocaleMemory({ locale }: { locale: HelpLocale }) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const searchParams = useSearchParams();
  React.useEffect(() => {
    const explicit = searchParams?.get("lang");
    try {
      if (explicit === "hi" || explicit === "en") {
        window.localStorage.setItem(LOCALE_KEY, explicit);
        return;
      }
      const saved = window.localStorage.getItem(LOCALE_KEY);
      if (saved === "hi" && locale !== "hi") {
        const params = new URLSearchParams(searchParams?.toString() || "");
        params.set("lang", "hi");
        router.replace(`${pathname}?${params.toString()}`);
      }
    } catch {
      // localStorage unavailable: stay in the language of the link
    }
  }, [locale, pathname, router, searchParams]);
  return null;
}

export type { SearchEntry };
