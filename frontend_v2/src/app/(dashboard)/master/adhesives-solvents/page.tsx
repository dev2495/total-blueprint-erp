"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FlaskConical, Lock, PackageCheck, ShieldCheck } from "lucide-react"

import { masterDataService } from "@/services/master-data"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { DataTable } from "@/components/ui/data-table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getColumns } from "./columns"

export default function AdhesivesSolventsPage() {
    const [searchQuery, setSearchQuery] = useState("")
    const { data: items = [] } = useQuery({
        queryKey: ["adhesives-solvents"],
        queryFn: () => masterDataService.getAdhesivesSolvents(),
    })

    const filteredItems = useMemo(() => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return items
        return items.filter((item) =>
            [item.name, item.code, item.category, item.status]
                .map((value) => String(value || "").toLowerCase())
                .join(" ")
                .includes(query)
        )
    }, [items, searchQuery])

    const adhesive = items.find((item) => item.category === "ADHESIVE")
    const solvent = items.find((item) => item.category === "SOLVENT")

    return (
        <MasterRegistryShell
            title="Adhesives & Solvents"
            description="Lamination chemistry is locked to one adhesive and one solvent so BOM, issue, inward, and variance stay aligned to the same master records."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search the fixed chemistry masters..."
            stats={[
                { label: "Chemical masters", value: items.length, subLabel: "System-managed records", icon: FlaskConical, toneClassName: "bg-warning-bg text-warning-fg" },
                { label: "Adhesive", value: adhesive ? 1 : 0, subLabel: adhesive?.code || "Missing", icon: PackageCheck, toneClassName: "bg-orange-50 text-orange-700" },
                { label: "Solvent", value: solvent ? 1 : 0, subLabel: solvent?.code || "Missing", icon: FlaskConical, toneClassName: "bg-cyan-50 text-cyan-700" },
                { label: "Visible", value: filteredItems.length, subLabel: "Current search scope", icon: ShieldCheck, toneClassName: "bg-slate-50 text-slate-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "ADHESIVE" },
                { kind: "materialCategory", value: "SOLVENT" },
                { kind: "approval", value: "APPROVED", label: "System managed" },
            ]}
        >
            <Card className="border-none shadow-premium rounded-[1.75rem] bg-white/90">
                <CardHeader className="border-b border-slate-100/80">
                    <CardTitle className="flex items-center gap-2 text-base font-black text-slate-900">
                        <Lock className="h-4 w-4 text-blue-600" />
                        Locked chemistry policy
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                        Operators inward only against the fixed adhesive or solvent master. Vendor, location, quantity, cost, and reference remain editable during GRN.
                    </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 p-6 md:grid-cols-2">
                    {items.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 shadow-sm">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">{item.category}</div>
                            <div className="mt-2 text-lg font-black tracking-tight text-slate-900">{item.name}</div>
                            <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">{item.code}</div>
                            <div className="mt-4 text-xs text-slate-500">
                                This master is consumed automatically by production truth and is no longer user-expandable from this screen.
                            </div>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <DataTable
                columns={getColumns()}
                data={filteredItems}
                filterColumn="name"
                filterPlaceholder="Filter chemistry master..."
            />
        </MasterRegistryShell>
    )
}
