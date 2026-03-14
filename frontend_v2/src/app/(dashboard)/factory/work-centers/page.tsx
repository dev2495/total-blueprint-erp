"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { factoryService, WorkCenter, Plant, Process } from "@/services/factory"
import { AxiosError } from "axios"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, Warehouse, Layers, Settings2, Trash2, ChevronRight, LayoutGrid, List } from "lucide-react"
import {
    Dialog,
    DialogContent,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    plant: z.string().min(1, "Plant is required"),
    processes: z.array(z.string()).default([]),
})

function WorkCenterForm({ initialData, plants, allProcesses, onSubmit, isLoading }: { initialData?: WorkCenter, plants: Plant[], allProcesses: Process[], onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            plant: initialData?.plant || "",
            processes: initialData?.processes || [],
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="plant"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Plant</FormLabel>
                            <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                value={field.value}
                            >
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select plant" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {plants.length > 0 ? plants.map((plant) => (
                                        <SelectItem key={plant.id} value={plant.id}>
                                            {plant.name} ({plant.code})
                                        </SelectItem>
                                    )) : (
                                        <SelectItem value="loading" disabled>Loading Plants...</SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Work Center Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. WC-EXT-01" {...field} />
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
                            <FormLabel>Work Center Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Extrusion Floor 1" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="processes"
                    render={() => (
                        <FormItem>
                            <div className="mb-4">
                                <FormLabel className="text-base">Operational Processes</FormLabel>
                                <div className="text-[0.8rem] text-muted-foreground">
                                    Select the processes this work center is capable of performing.
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4 rounded-lg border p-4 max-h-[200px] overflow-y-auto bg-slate-50">
                                {allProcesses.length > 0 ? allProcesses.map((process) => (
                                    <FormField
                                        key={process.id}
                                        control={form.control}
                                        name="processes"
                                        render={({ field }) => {
                                            return (
                                                <FormItem
                                                    key={process.id}
                                                    className="flex flex-row items-center space-x-2 space-y-0"
                                                >
                                                    <FormControl>
                                                        <Checkbox
                                                            checked={field.value?.includes(process.id)}
                                                            onCheckedChange={(checked) => {
                                                                const currentValues = field.value || []
                                                                return checked
                                                                    ? field.onChange([...currentValues, process.id])
                                                                    : field.onChange(
                                                                        currentValues.filter(
                                                                            (value) => value !== process.id
                                                                        )
                                                                    )
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormLabel className="text-sm font-medium cursor-pointer text-slate-700">
                                                        {process.name}
                                                    </FormLabel>
                                                </FormItem>
                                            )
                                        }}
                                    />
                                )) : (
                                    <div className="text-sm text-slate-400 col-span-2 text-center py-4">No processes defined yet.</div>
                                )}
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
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

// --- Main Page ---
export default function WorkCentersPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<WorkCenter | null>(null)
    const [itemToDelete, setItemToDelete] = useState<WorkCenter | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedPlantId, setSelectedPlantId] = useState<string | "ALL">("ALL")
    const [viewMode, setViewMode] = useState<"GRID" | "LIST">("GRID")

    const { data: workCenters } = useQuery({
        queryKey: ["work-centers"],
        queryFn: factoryService.getWorkCenters,
    })

    const { data: plants } = useQuery({
        queryKey: ["plants"],
        queryFn: factoryService.getPlants,
    })

    const { data: processes } = useQuery({
        queryKey: ["processes"],
        queryFn: factoryService.getProcesses,
    })

    const createMutation = useMutation({
        mutationFn: (data: z.infer<typeof formSchema>) => factoryService.createWorkCenter(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-centers"] })
            toast({ title: "Success", description: "Work Center created." })
            setIsCreateOpen(false)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => factoryService.updateWorkCenter(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-centers"] })
            toast({ title: "Success", description: "Work Center updated." })
            setEditingItem(null)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: factoryService.deleteWorkCenter,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["work-centers"] })
            toast({ title: "Success", description: "Work Center deleted." })
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const filteredWorkCenters = workCenters?.filter(wc => {
        const matchesSearch = wc.name.toLowerCase().includes(searchQuery.toLowerCase()) || wc.code.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesPlant = selectedPlantId === "ALL" || wc.plant === selectedPlantId
        return matchesSearch && matchesPlant
    }) || []

    return (
        <FactoryPageLayout
            title="Work Centers"
            description="Manage departments and groupings of machines within your plants."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search work centers..."
            actions={
                <div className="flex items-center gap-2">
                    <div className="flex bg-slate-100 p-1 rounded-lg mr-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-2", viewMode === "GRID" && "bg-white shadow-sm")}
                            onClick={() => setViewMode("GRID")}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            className={cn("h-7 px-2", viewMode === "LIST" && "bg-white shadow-sm")}
                            onClick={() => setViewMode("LIST")}
                        >
                            <List className="h-4 w-4" />
                        </Button>
                    </div>
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                                <Plus className="mr-2 h-4 w-4" /> Add Work Center
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create Work Center</DialogTitle>
                            </DialogHeader>
                            <WorkCenterForm
                                plants={plants || []}
                                allProcesses={processes || []}
                                onSubmit={(data) => createMutation.mutate(data)}
                                isLoading={createMutation.isPending}
                            />
                        </DialogContent>
                    </Dialog>
                </div>
            }
        >
            <div className="flex flex-col lg:flex-row gap-6">
                {/* Left Panel: Tree Filter */}
                <div className="w-full lg:w-64 flex-shrink-0">
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sticky top-24">
                        <h3 className="font-semibold text-sm text-slate-900 mb-4 px-2">Plants</h3>
                        <div className="space-y-1">
                            <Button
                                variant="ghost"
                                className={cn(
                                    "w-full justify-start text-sm font-medium",
                                    selectedPlantId === "ALL" ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                                )}
                                onClick={() => setSelectedPlantId("ALL")}
                            >
                                <LayoutGrid className="mr-2 h-4 w-4" />
                                All Plants
                                <span className="ml-auto text-xs opacity-60 bg-white/50 px-1.5 py-0.5 rounded-full border border-blue-100/50">
                                    {workCenters?.length || 0}
                                </span>
                            </Button>
                            {plants?.map((plant) => (
                                <Button
                                    key={plant.id}
                                    variant="ghost"
                                    className={cn(
                                        "w-full justify-start text-sm font-medium",
                                        selectedPlantId === plant.id ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                                    )}
                                    onClick={() => setSelectedPlantId(plant.id)}
                                >
                                    <Warehouse className="mr-2 h-4 w-4" />
                                    {plant.name}
                                    <span className="ml-auto text-xs opacity-60 bg-slate-100 px-1.5 py-0.5 rounded-full">
                                        {workCenters?.filter(wc => wc.plant === plant.id).length || 0}
                                    </span>
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Panel: Content */}
                <div className="flex-1">
                    {viewMode === "GRID" ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredWorkCenters.map((wc) => {
                                const plant = plants?.find(p => p.id === wc.plant)
                                const wcProcesses = processes?.filter(p => wc.processes?.includes(p.id)) || []

                                return (
                                    <Card key={wc.id} className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-slate-50/50 border-b border-slate-100">
                                            <Badge variant="outline" className="bg-white text-xs font-mono">
                                                {wc.code}
                                            </Badge>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 hover:text-blue-600"
                                                    onClick={() => setEditingItem(wc)}
                                                >
                                                    <Settings2 className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 hover:text-red-600"
                                                    onClick={() => setItemToDelete(wc)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="pt-6">
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                                                    <Layers className="h-6 w-6" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold text-lg text-slate-900 leading-tight">{wc.name}</h3>
                                                    <div className="flex items-center text-xs text-slate-500 mt-1">
                                                        <Warehouse className="h-3 w-3 mr-1" />
                                                        {plant?.name || "Unknown Plant"}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Capabilities</div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {wcProcesses.length > 0 ? (
                                                        wcProcesses.slice(0, 3).map(p => (
                                                            <Badge key={p.id} variant="secondary" className="bg-slate-100 text-slate-600 text-[10px] hover:bg-slate-200">
                                                                {p.name}
                                                            </Badge>
                                                        ))
                                                    ) : (
                                                        <span className="text-xs text-slate-400 italic">No specific processes</span>
                                                    )}
                                                    {wcProcesses.length > 3 && (
                                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 text-[10px]">
                                                            +{wcProcesses.length - 3}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-medium">
                                    <tr>
                                        <th className="p-4">Code</th>
                                        <th className="p-4">Name</th>
                                        <th className="p-4">Plant</th>
                                        <th className="p-4">Processes</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredWorkCenters.map((wc) => {
                                        const plant = plants?.find(p => p.id === wc.plant)
                                        const wcProcesses = processes?.filter(p => wc.processes?.includes(p.id)) || []
                                        return (
                                            <tr key={wc.id} className="hover:bg-slate-50/50">
                                                <td className="p-4 font-mono text-slate-600">{wc.code}</td>
                                                <td className="p-4 font-medium text-slate-900">{wc.name}</td>
                                                <td className="p-4 text-slate-600">{plant?.name}</td>
                                                <td className="p-4">
                                                    <div className="flex flex-wrap gap-1">
                                                        {wcProcesses.slice(0, 2).map(p => (
                                                            <Badge key={p.id} variant="outline" className="text-[10px] h-5">
                                                                {p.name}
                                                            </Badge>
                                                        ))}
                                                        {wcProcesses.length > 2 && (
                                                            <Badge variant="outline" className="text-[10px] h-5">
                                                                +{wcProcesses.length - 2}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <Button variant="ghost" size="sm" onClick={() => setEditingItem(wc)}>Edit</Button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Work Center</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <WorkCenterForm
                            plants={plants || []}
                            allProcesses={processes || []}
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
        </FactoryPageLayout>
    )
}
