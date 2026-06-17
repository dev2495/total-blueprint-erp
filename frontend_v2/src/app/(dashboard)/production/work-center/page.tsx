"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Cpu,
  Activity,
  Zap,
  ShieldCheck,
  Search,
} from "lucide-react";
import Link from "next/link";

export default function WorkCenterListPage() {
  const [query, setQuery] = useState("");
  const [lastWorkCenterId, setLastWorkCenterId] = useState("");
  const storageKey = "tbp:last_work_center_terminal";

  const { data: workCenters, isLoading } = useQuery({
    queryKey: ["all-work-centers"],
    queryFn: async () => {
      const { data } = await api.get(
        "/api/factory/work-centers/my-work-centers/",
      );
      if (Array.isArray(data)) return data;
      if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as any).results)
      )
        return (data as any).results;
      return [];
    },
  });
  const filteredWorkCenters = useMemo(() => {
    const list = Array.isArray(workCenters) ? workCenters : [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((wc: any) => {
      return (
        String(wc.name || "")
          .toLowerCase()
          .includes(q) ||
        String(wc.code || "")
          .toLowerCase()
          .includes(q)
      );
    });
  }, [query, workCenters]);
  const lastWorkCenter = useMemo(() => {
    const list = Array.isArray(workCenters) ? workCenters : [];
    return list.find((wc: any) => String(wc.id) === String(lastWorkCenterId));
  }, [lastWorkCenterId, workCenters]);
  const primaryWorkCenter = lastWorkCenter || filteredWorkCenters[0];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const remembered = window.localStorage.getItem(storageKey) || "";
    setLastWorkCenterId(remembered);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
        <div className="text-center space-y-4">
          <Activity className="h-12 w-12 animate-pulse text-primary mx-auto" />
          <p className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
            Accessing Station Topology...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-8 bg-[#f8fafc] p-4 sm:p-6 lg:p-10">
      {/* Header Section */}
      <div className="mx-auto max-w-5xl space-y-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-info-bg border border-info-border text-primary text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
          <ShieldCheck className="h-3 w-3" /> Station Access
        </div>
        <h1 className="text-3xl font-black tracking-tighter text-content-1 sm:text-5xl">
          Floor <span className="text-primary italic">Access</span> Point
        </h1>
        <p className="mx-auto flex max-w-2xl items-center justify-center gap-2 text-sm font-semibold uppercase tracking-widest text-content-3">
          Open the WCM terminal directly or choose a station below{" "}
          <Activity className="h-4 w-4 text-info-fg" />
        </p>
        {primaryWorkCenter ? (
          <Link
            href={`/production/work-center/${primaryWorkCenter.id}`}
            className="mx-auto flex max-w-2xl items-center justify-between gap-4 rounded-2xl border border-info-border bg-surface-1 p-3 text-left shadow-premium transition hover:border-primary hover:shadow-premium-hover"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(storageKey, String(primaryWorkCenter.id));
              }
            }}
          >
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                {lastWorkCenter ? "Resume last WCM terminal" : "Open first available WCM terminal"}
              </div>
              <div className="mt-1 truncate text-lg font-black text-content-1">
                {primaryWorkCenter.name}
              </div>
              <div className="mt-0.5 truncate font-mono text-xs font-bold text-content-3">
                {primaryWorkCenter.code}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-black uppercase tracking-widest text-white">
              Open terminal <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        ) : null}
        <div className="mt-5 w-full max-w-xl rounded-2xl border border-line bg-surface-1/80 p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-10 border-line pl-9"
              placeholder="Search work center by name or code..."
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-content-3">
            <span>{filteredWorkCenters.length} visible</span>
            {lastWorkCenterId ? (
              <span>Last used terminal highlighted</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredWorkCenters?.map((wc: any) => {
          const isLastUsed = String(wc.id) === String(lastWorkCenterId);
          return (
            <Link
              key={wc.id}
              href={`/production/work-center/${wc.id}`}
              className="block active-scale group"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.setItem(storageKey, String(wc.id));
                }
              }}
            >
              <Card
                className={`relative h-full overflow-hidden rounded-[22px] border border-line bg-surface-1/80 shadow-sm backdrop-blur-md transition-all duration-300 hover:border-info-border hover:shadow-premium ${isLastUsed ? "ring-2 ring-success-border border-success-border" : ""}`}
              >
                <CardHeader className="flex flex-row items-start justify-between gap-4 p-5 pb-3">
                  <div className="min-w-0">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-content-4 italic">
                      WCM terminal
                    </h3>
                    <CardTitle className="mt-2 text-xl font-black tracking-tight text-content-1 transition-colors group-hover:text-primary">
                      {wc.name}
                    </CardTitle>
                  </div>
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 transition-colors duration-300 group-hover:bg-info-bg">
                    <Cpu className="h-5 w-5 text-content-4 transition-all duration-300 group-hover:scale-110 group-hover:text-primary" />
                  </div>
                </CardHeader>
                <CardContent className="p-5 pt-0">
                  <div className="rounded-2xl border border-line bg-surface-2 p-4 transition-all duration-300 group-hover:border-info-border group-hover:bg-surface-1">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[9px] font-black text-content-4 uppercase tracking-widest italic">
                        Station Protocol
                      </span>
                      <span className="mt-0.5 truncate text-xs font-black text-content-1">
                        {wc.code}
                      </span>
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-info-border bg-surface-1 px-3 py-2 text-primary">
                      <span className="text-[10px] font-black uppercase tracking-widest">
                        Open terminal
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </CardContent>
                <div className="absolute right-0 top-0 p-4 opacity-10">
                  <Zap className="h-16 w-16 -rotate-12 text-primary transition-transform duration-700 group-hover:rotate-0" />
                </div>
                {isLastUsed ? (
                  <div className="absolute right-5 top-5 rounded-full bg-success-fg px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                    Last Used
                  </div>
                ) : null}
              </Card>
            </Link>
          );
        })}
      </div>

      {!filteredWorkCenters.length ? (
        <div className="mx-auto max-w-5xl rounded-2xl border border-dashed border-line-strong bg-surface-1/70 p-8 text-center text-sm text-content-3">
          No work center matched the current search query.
        </div>
      ) : null}

      {/* Decorative blurs for depth */}
      <div className="fixed top-1/2 left-0 w-96 h-96 bg-primary rounded-full blur-[120px] -z-10" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-primary rounded-full blur-[120px] -z-10" />
    </div>
  );
}
