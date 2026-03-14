"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Layers3, Settings2, Wrench } from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SECTION_ICON = {
    SUPPORTED_NOW: CheckCircle2,
    CONFIG_ONLY: Settings2,
    NEW_LOGIC_REQUIRED: Wrench,
} as const;

const SECTION_TONE = {
    SUPPORTED_NOW: "border-emerald-200 bg-emerald-50/60",
    CONFIG_ONLY: "border-amber-200 bg-amber-50/60",
    NEW_LOGIC_REQUIRED: "border-rose-200 bg-rose-50/60",
} as const;

export default function CapabilityMatrixPage() {
    const { data, isLoading, isError } = useQuery({
        queryKey: ["analytics-capability-matrix"],
        queryFn: analyticsApi.getCapabilityMatrix,
    });

    if (isLoading) {
        return <div className="p-6 text-sm text-slate-500">Loading capability matrix...</div>;
    }

    if (isError || !data) {
        return <div className="p-6 text-sm text-rose-600">Capability matrix could not be loaded.</div>;
    }

    return (
        <div className="min-h-screen bg-slate-50/50 p-6 space-y-6">
            <Card className="border-slate-200 shadow-sm">
                <CardContent className="flex items-start justify-between gap-4 p-6">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-indigo-700">
                            <Layers3 className="h-3.5 w-3.5" />
                            Capability Matrix
                        </div>
                        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">What this ERP can support today, by config, or only with new logic</h1>
                        <p className="mt-2 max-w-4xl text-sm text-slate-600">
                            This matrix is the honest support boundary for stock naming, rolls, pouches, and future flexible-packaging extensions.
                            It separates taxonomy work from real manufacturing logic changes.
                        </p>
                    </div>
                    <Badge variant="outline" className="bg-white text-slate-600 border-slate-200">Version {data.version}</Badge>
                </CardContent>
            </Card>

            {data.sections.map((section) => {
                const Icon = SECTION_ICON[section.status as keyof typeof SECTION_ICON] || Layers3;
                const tone = SECTION_TONE[section.status as keyof typeof SECTION_TONE] || "border-slate-200 bg-white";
                return (
                    <div key={section.status} className="space-y-4">
                        <div className={`rounded-2xl border px-5 py-4 ${tone}`}>
                            <div className="flex items-center gap-3">
                                <div className="rounded-xl bg-white/80 p-2">
                                    <Icon className="h-5 w-5 text-slate-900" />
                                </div>
                                <div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{section.status.replaceAll("_", " ")}</div>
                                    <div className="text-xl font-black tracking-tight text-slate-900">{section.label}</div>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            {section.entries.map((entry) => (
                                <Card key={`${section.status}-${entry.capability_family}`} className="border-slate-200 shadow-sm">
                                    <CardHeader className="pb-3">
                                        <CardTitle className="text-lg font-black text-slate-900">{entry.capability_family}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4 text-sm">
                                        <div>
                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">What it means</div>
                                            <p className="mt-1 text-slate-700">{entry.what_it_means}</p>
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Why</div>
                                            <p className="mt-1 text-slate-700">{entry.why}</p>
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Examples</div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                {entry.examples.map((example) => (
                                                    <Badge key={example} variant="outline" className="bg-slate-50 text-slate-700">{example}</Badge>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Needs only config</div>
                                                <ul className="mt-2 space-y-1 text-slate-700">
                                                    {(entry.config_needed.length ? entry.config_needed : ["Nothing extra"]).map((item) => (
                                                        <li key={item}>• {item}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Needs code / module</div>
                                                <ul className="mt-2 space-y-1 text-slate-700">
                                                    {(entry.code_needed.length ? entry.code_needed : ["No new code needed"]).map((item) => (
                                                        <li key={item}>• {item}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Limits</div>
                                            <ul className="mt-2 space-y-1 text-slate-700">
                                                {entry.limits.map((item) => (
                                                    <li key={item}>• {item}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

