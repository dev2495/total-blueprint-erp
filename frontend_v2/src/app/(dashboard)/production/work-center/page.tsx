"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { api } from "@/lib/api"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ArrowRight, Cpu, Activity, Zap, ShieldCheck, Search } from "lucide-react"
import Link from "next/link"

export default function WorkCenterListPage() {
    const [query, setQuery] = useState("")
    const [lastWorkCenterId, setLastWorkCenterId] = useState("")
    const storageKey = "tbp:last_work_center_terminal"

    const { data: workCenters, isLoading } = useQuery({
        queryKey: ["all-work-centers"],
        queryFn: async () => {
            const { data } = await api.get("/api/factory/work-centers/my-work-centers/")
            if (Array.isArray(data)) return data
            if (data && typeof data === "object" && Array.isArray((data as any).results)) return (data as any).results
            return []
        }
    })
    const filteredWorkCenters = useMemo(() => {
        const list = Array.isArray(workCenters) ? workCenters : []
        const q = query.trim().toLowerCase()
        if (!q) return list
        return list.filter((wc: any) => {
            return (
                String(wc.name || "").toLowerCase().includes(q) ||
                String(wc.code || "").toLowerCase().includes(q)
            )
        })
    }, [query, workCenters])

    useEffect(() => {
        if (typeof window === "undefined") return
        const remembered = window.localStorage.getItem(storageKey) || ""
        setLastWorkCenterId(remembered)
    }, [])

    if (isLoading) {
        return (
            <div className="flex h-screen items-center justify-center bg-[#f8fafc]">
                <div className="text-center space-y-4">
                    <Activity className="h-12 w-12 animate-pulse text-blue-600 mx-auto" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Accessing Station Topology...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-8 lg:p-12 space-y-10 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="max-w-4xl mx-auto text-center space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                    <ShieldCheck className="h-3 w-3" /> Station Access
                </div>
                <h1 className="text-5xl font-black tracking-tighter text-slate-900">
                    Floor <span className="text-blue-600 italic">Access</span> Point
                </h1>
                <p className="text-slate-500 font-medium text-sm flex items-center justify-center gap-2 mt-2 uppercase tracking-widest">
                    Select a validated work center terminal to begin operations <Activity className="h-4 w-4 text-blue-400" />
                </p>
                <div className="mt-5 w-full max-w-xl rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            className="h-10 border-slate-200 pl-9"
                            placeholder="Search work center by name or code..."
                        />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{filteredWorkCenters.length} visible</span>
                        {lastWorkCenterId ? <span>Last used terminal highlighted</span> : null}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                {filteredWorkCenters?.map((wc: any) => {
                    const isLastUsed = String(wc.id) === String(lastWorkCenterId)
                    return (
                    <Link
                        key={wc.id}
                        href={`/production/work-center/${wc.id}`}
                        className="block active-scale group"
                        onClick={() => {
                            if (typeof window !== "undefined") {
                                window.localStorage.setItem(storageKey, String(wc.id))
                            }
                        }}
                    >
                        <Card className={`border-none shadow-premium hover:shadow-premium-hover rounded-[3rem] overflow-hidden bg-white/70 backdrop-blur-md transition-all duration-500 relative h-full ${isLastUsed ? "ring-2 ring-emerald-200 border border-emerald-300/50" : ""}`}>
                            <CardHeader className="flex flex-row items-center justify-between p-10 pb-6">
                                <div>
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400 italic">Validated Unit</h3>
                                    <CardTitle className="text-3xl font-black tracking-tight text-slate-900 mt-2 group-hover:text-blue-600 transition-colors">
                                        {wc.name}
                                    </CardTitle>
                                </div>
                                <div className="h-14 w-14 bg-slate-50 group-hover:bg-blue-50 rounded-2xl flex items-center justify-center transition-colors duration-500">
                                    <Cpu className="h-7 w-7 text-slate-400 group-hover:text-blue-600 group-hover:scale-110 transition-all duration-500" />
                                </div>
                            </CardHeader>
                            <CardContent className="p-10 pt-0">
                                <div className="flex items-center justify-between mt-6 bg-slate-50/50 p-4 rounded-2xl border border-transparent group-hover:border-blue-50 group-hover:bg-white transition-all duration-500">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest italic">Station Protocol</span>
                                        <span className="text-xs font-black text-slate-900 mt-0.5">{wc.code}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-500">
                                        Initialize <ArrowRight className="h-3.5 w-3.5" />
                                    </div>
                                </div>
                            </CardContent>
                            <div className="absolute top-0 right-0 p-4">
                                <Zap className="h-20 w-20 text-blue-500/5 -rotate-12 group-hover:rotate-0 transition-transform duration-1000" />
                            </div>
                            {isLastUsed ? (
                                <div className="absolute top-5 left-5 rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                                    Last Used
                                </div>
                            ) : null}
                        </Card>
                    </Link>
                )})}
            </div>

            {!filteredWorkCenters.length ? (
                <div className="mx-auto max-w-5xl rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                    No work center matched the current search query.
                </div>
            ) : null}

            {/* Decorative blurs for depth */}
            <div className="fixed top-1/2 left-0 w-96 h-96 bg-blue-500/5 rounded-full blur-[120px] -z-10" />
            <div className="fixed bottom-0 right-0 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px] -z-10" />
        </div>
    )
}
