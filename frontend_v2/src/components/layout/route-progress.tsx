"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * Slim top progress bar for client navigations. Starts on an internal link
 * click and completes when the pathname or query changes, so users always get
 * immediate feedback even when the next route takes a moment.
 */
function RouteProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const timer = useRef<number | null>(null);
  const routeKey = `${pathname}?${searchParams?.toString() ?? ""}`;
  const lastKey = useRef(routeKey);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setState("running");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (lastKey.current === routeKey) return;
    lastKey.current = routeKey;
    setState((current) => (current === "running" ? "done" : current));
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 380);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [routeKey]);

  // Safety: never leave the bar hanging if navigation was cancelled.
  useEffect(() => {
    if (state !== "running") return;
    const id = window.setTimeout(() => setState("idle"), 12000);
    return () => window.clearTimeout(id);
  }, [state]);

  return <div className="erp-route-progress" data-state={state} aria-hidden />;
}

export function RouteProgress() {
  return (
    <Suspense fallback={null}>
      <RouteProgressInner />
    </Suspense>
  );
}
