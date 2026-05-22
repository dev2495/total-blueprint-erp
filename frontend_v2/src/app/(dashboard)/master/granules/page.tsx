"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Material, type GranuleQualityCode } from "@/services/master-data"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Loader2, Package, Plus, Tag, Tags, Trash2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    is_sellable: z.boolean().default(false),
    default_gst_pct: z.coerce.number().nullable().optional(),
})

const qualityCodeSchema = z.object({
    code: z.string().trim().min(1, "Granule code is required"),
    status: z.enum(["ACTIVE", "INACTIVE"]),
    notes: z.string().optional(),
})

function GranuleForm({ initialData, onSubmit, isLoading }: { initialData?: Material, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            is_sellable: initialData?.is_sellable ?? false,
            default_gst_pct: initialData?.default_gst_pct ?? null,
        },
    })

    const isSellable = form.watch("is_sellable")

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Granule Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. G-1001" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Granule Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. LDPE High Slip" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {/* Sales / Trade Order section */}
                <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-4 space-y-3">
                    <div className="text-[11px] font-black uppercase tracking-wider text-emerald-700">Sales · Trade Orders</div>
                    <FormField
                        control={form.control}
                        name="is_sellable"
                        render={({ field }) => (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                    <input
                                        type="checkbox"
                                        checked={!!field.value}
                                        onChange={(e) => field.onChange(e.target.checked)}
                                        className="mt-1 h-4 w-4 accent-emerald-600"
                                    />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                    <FormLabel className="text-slate-800">Sellable as trading good</FormLabel>
                                    <div className="text-[11px] text-slate-500">Enable to make this granule available in Trade Orders.</div>
                                </div>
                            </FormItem>
                        )}
                    />
                    {isSellable ? (
                        <FormField
                            control={form.control}
                            name="default_gst_pct"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Default GST %</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            step="0.01"
                                            placeholder="e.g. 18"
                                            value={(field.value as number | null | undefined) ?? ""}
                                            onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    ) : null}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </div>
            </form>
        </Form>
    )
}

function GranuleQualityCodeForm({
    initialData,
    onSubmit,
    isLoading,
}: {
    initialData?: GranuleQualityCode | null
    onSubmit: (data: z.infer<typeof qualityCodeSchema>) => void
    isLoading: boolean
}) {
    const form = useForm({
        resolver: zodResolver(qualityCodeSchema),
        defaultValues: {
            code: initialData?.code || "",
            status: initialData?.status || "ACTIVE",
            notes: initialData?.notes || "",
        },
    })

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((values: z.infer<typeof qualityCodeSchema>) =>
                    onSubmit({
                        ...values,
                        code: values.code.trim().toUpperCase(),
                    })
                )}
                className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4"
            >
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Granule code</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. GP-101 / 45A / PRIME7" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-500">
                        This code belongs to the granule only. Vendors are selected later at GRN inward.
                    </div>
                </div>
                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                    <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Status</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="INACTIVE">Inactive</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="notes"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Notes</FormLabel>
                                <FormControl>
                                    <Input placeholder="Optional quality remark or handling note" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                <div className="flex justify-end gap-2">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Tags className="mr-2 h-4 w-4" />}
                        {initialData ? "Update code" : "Add code"}
                    </Button>
                </div>
            </form>
        </Form>
    )
}

// --- Main Page ---
export default function GranulesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Material | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Material | null>(null)
    const [selectedGranuleId, setSelectedGranuleId] = useState<string | null>(null)
    const [editingCode, setEditingCode] = useState<GranuleQualityCode | null>(null)
    const [codeToDelete, setCodeToDelete] = useState<GranuleQualityCode | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: granules } = useQuery({
        queryKey: ["granules"],
        queryFn: masterDataService.getGranules,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createGranule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => masterDataService.updateGranule(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteGranule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule deleted." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })
    const createCodeMutation = useMutation({
        mutationFn: (data: z.infer<typeof qualityCodeSchema>) => {
            if (!selectedGranule) throw new Error("Select a granule first.")
            return masterDataService.createGranuleCode({
                granule: selectedGranule.id,
                code: data.code,
                status: data.status,
                notes: data.notes || "",
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            queryClient.invalidateQueries({ queryKey: ["granule-codes"] })
            toast({ title: "Success", description: "Granule code added." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    })
    const updateCodeMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: z.infer<typeof qualityCodeSchema> }) =>
            masterDataService.updateGranuleCode(id, {
                code: data.code,
                status: data.status,
                notes: data.notes || "",
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            queryClient.invalidateQueries({ queryKey: ["granule-codes"] })
            toast({ title: "Success", description: "Granule code updated." })
            setEditingCode(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    })
    const deleteCodeMutation = useMutation({
        mutationFn: masterDataService.deleteGranuleCode,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            queryClient.invalidateQueries({ queryKey: ["granule-codes"] })
            toast({ title: "Success", description: "Granule code deleted." })
            setCodeToDelete(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
    })

    const filteredGranules = (granules || []).filter((item) => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return true
        return item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
    })
    const selectedGranule = (granules || []).find((item) => item.id === selectedGranuleId) || null
    const totalQualityCodes = (granules || []).reduce((sum, item) => sum + (item.quality_code_count || item.quality_codes?.length || 0), 0)
    const activeQualityCodes = (granules || []).reduce(
        (sum, item) => sum + (item.quality_codes || []).filter((code) => code.status === "ACTIVE").length,
        0,
    )

    return (
        <MasterRegistryShell
            title="Granules"
            description="Manage extrusion granules plus reusable quality codes that are selected during GRN, WCM issue splits, inventory, and analytics."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search granules..."
            stats={[
                { label: "Granules", value: (granules || []).length, subLabel: "Raw material masters", icon: Package, toneClassName: "bg-emerald-50 text-emerald-700" },
                { label: "Visible", value: filteredGranules.length, subLabel: "Matching current search", icon: Tag, toneClassName: "bg-slate-50 text-slate-700" },
                { label: "Granule masters", value: new Set((granules || []).map((item) => item.code)).size, subLabel: "Master identifiers", icon: Tag, toneClassName: "bg-blue-50 text-blue-700" },
                { label: "Granule codes", value: totalQualityCodes, subLabel: `${activeQualityCodes} active code options`, icon: Tags, toneClassName: "bg-cyan-50 text-cyan-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "GRANULE" },
                { kind: "processState", value: "EXTRUDED", label: "Extrusion feed" },
                { kind: "approval", value: "APPROVED", label: "Recipe compatible" },
                { kind: "origin", value: "PURCHASED", label: "Code traceable" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Granule
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Granule</DialogTitle>
                        </DialogHeader>
                        <GranuleForm
                            onSubmit={(data) => createMutation.mutate(data)}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >

            <DataTable
                columns={getColumns({
                    onEdit: setEditingItem,
                    onDelete: (item) => setItemToDelete(item),
                    onManageCodes: (item) => {
                        setSelectedGranuleId(item.id)
                        setEditingCode(null)
                    },
                })}
                data={filteredGranules}
                filterColumn="name"
                filterPlaceholder="Filter granules..."
            />

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Granule</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <GranuleForm
                            initialData={editingItem}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <strong>{itemToDelete?.code}</strong>.
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToDelete) {
                                    deleteMutation.mutate(itemToDelete.id)
                                    setItemToDelete(null)
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={!!selectedGranule} onOpenChange={(open) => {
                if (!open) {
                    setSelectedGranuleId(null)
                    setEditingCode(null)
                    setCodeToDelete(null)
                }
            }}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>Granule codes</DialogTitle>
                        <DialogDescription>
                            Track reusable quality codes for <strong>{selectedGranule?.code}</strong>. These codes are available at GRN and selectable during WCM issue overrides, regardless of vendor.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedGranule ? (
                        <div className="space-y-4">
                            <GranuleQualityCodeForm
                                initialData={editingCode}
                                onSubmit={(data) => {
                                    if (editingCode) {
                                        updateCodeMutation.mutate({ id: editingCode.id, data })
                                        return
                                    }
                                    createCodeMutation.mutate(data)
                                }}
                                isLoading={createCodeMutation.isPending || updateCodeMutation.isPending}
                            />
                            <div className="max-h-[360px] overflow-y-auto rounded-2xl border border-slate-200 bg-white">
                                <div className="grid grid-cols-[1.4fr_120px_1.6fr_120px] gap-3 border-b border-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">
                                    <span>Code</span>
                                    <span>Status</span>
                                    <span>Notes</span>
                                    <span className="text-right">Actions</span>
                                </div>
                                {(selectedGranule.quality_codes || []).length ? (
                                    (selectedGranule.quality_codes || []).map((code) => (
                                        <div
                                            key={code.id}
                                            className="grid grid-cols-[1.4fr_120px_1.6fr_120px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                                        >
                                            <div className="font-mono font-semibold text-slate-900">{code.code}</div>
                                            <div>
                                                <Badge variant="outline" className={code.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}>
                                                    {code.status}
                                                </Badge>
                                            </div>
                                            <div className="text-slate-500">{code.notes || "No notes"}</div>
                                            <div className="flex justify-end gap-2">
                                                <Button type="button" variant="outline" size="sm" onClick={() => setEditingCode(code)}>
                                                    Edit
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" onClick={() => setCodeToDelete(code)}>
                                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="px-4 py-10 text-center text-sm text-slate-500">
                                        No granule codes exist for this granule yet. Add the codes your inward team and WCM operators need for split reporting.
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!codeToDelete} onOpenChange={(open) => !open && setCodeToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete granule code?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes <strong>{codeToDelete?.code}</strong> from the granule code registry. Historical GRN, inventory, and consumption records will continue to show past transactions, but new inward and WCM issue selections will stop using this code.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (codeToDelete) {
                                    deleteCodeMutation.mutate(codeToDelete.id)
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </MasterRegistryShell>
    )
}
