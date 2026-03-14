"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Disc, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { engineeringService, Cylinder } from "@/services/engineering"
import { CylinderDialog } from "@/components/engineering/cylinder-dialog"

export default function CylinderManagementPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [search, setSearch] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Cylinder | null>(null)

    const { data: cylinders = [], isLoading } = useQuery({
        queryKey: ["cylinders"],
        queryFn: () => engineeringService.getCylinders(),
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => engineeringService.deleteCylinder(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["cylinders"] })
            toast({ title: "Cylinder deleted" })
        },
        onError: (err: any) => {
            toast({
                title: "Delete failed",
                description: err?.response?.data?.detail || err?.message || "Could not delete cylinder.",
                variant: "destructive",
            })
        },
    })

    const filtered = useMemo(() => {
        const key = search.trim().toLowerCase()
        if (!key) return cylinders
        return cylinders.filter((row) => {
            const blob = [
                row.code,
                row.name,
                row.color_name,
                row.artwork_name,
                row.lifecycle_status,
            ]
                .map((v) => String(v || "").toLowerCase())
                .join(" ")
            return blob.includes(key)
        })
    }, [cylinders, search])

    const total = filtered.length
    const draftCount = filtered.filter((r) => Boolean(r.is_draft)).length
    const productionCount = filtered.filter((r) => !Boolean(r.is_draft)).length

    return (
        <div className="p-6 lg:p-8 space-y-6 bg-slate-50/50 min-h-screen">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                        <Disc className="h-6 w-6 text-indigo-600" />
                        Cylinder Catalog
                    </h1>
                    <p className="text-slate-500 font-medium">
                        Manage artwork-linked side slots and draft-to-production lifecycle.
                    </p>
                </div>
                <Button
                    onClick={() => {
                        setEditing(null)
                        setDialogOpen(true)
                    }}
                    data-testid="cylinder-new-button"
                >
                    <Plus className="h-4 w-4 mr-2" />
                    New Cylinder
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] uppercase text-slate-500">Total</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black">{total}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] uppercase text-slate-500">Draft Cylinders</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black text-amber-600">{draftCount}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] uppercase text-slate-500">Production Ready</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-black text-emerald-600">{productionCount}</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="overflow-hidden">
                <CardHeader className="border-b bg-slate-50/60">
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search code, artwork, color..."
                            className="pl-9 bg-white"
                            data-testid="cylinders-search"
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="p-12 text-center text-slate-500">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                            Loading cylinders...
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead>Artwork</TableHead>
                                    <TableHead>Color</TableHead>
                                    <TableHead>Side</TableHead>
                                    <TableHead>Lifecycle</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center py-12 text-slate-400">
                                            No cylinders found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filtered.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell className="font-mono text-xs font-bold">{row.code}</TableCell>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell>{row.artwork_name || "-"}</TableCell>
                                            <TableCell>{row.color_name || "-"}</TableCell>
                                            <TableCell>
                                                {row.side || "FRONT"} #{row.side_slot_index || 1}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={row.is_draft ? "secondary" : "outline"}>
                                                    {row.is_draft ? "DRAFT" : (row.lifecycle_status || "PRODUCTION")}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">{row.status}</Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="inline-flex items-center gap-1">
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        onClick={() => {
                                                            setEditing(row)
                                                            setDialogOpen(true)
                                                        }}
                                                    >
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="text-red-600 hover:text-red-700"
                                                        onClick={() => deleteMutation.mutate(row.id)}
                                                        disabled={deleteMutation.isPending}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <CylinderDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                cylinder={editing}
            />
        </div>
    )
}
