"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { factoryService, Location, Plant } from "@/services/factory"
import { AxiosError } from "axios"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, MapPin, Warehouse, Settings2, Trash2, Box, Truck, ShieldCheck, Archive } from "lucide-react"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    plant: z.string().min(1, "Plant is required"),
    type: z.string().min(1, "Type is required"),
})

function LocationForm({ initialData, plants, onSubmit, isLoading }: { initialData?: Location, plants: Plant[], onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            plant: initialData?.plant || "",
            type: initialData?.type || "WAREHOUSE",
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
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select plant" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {plants?.map((plant) => (
                                        <SelectItem key={plant.id} value={plant.id}>
                                            {plant.name} ({plant.code})
                                        </SelectItem>
                                    ))}
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
                            <FormLabel>Location Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. F-01" {...field} />
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
                            <FormLabel>Location Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Finished Goods Warehouse" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Location Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                                    <SelectItem value="RM">Raw Materials</SelectItem>
                                    <SelectItem value="QC">Quality Control</SelectItem>
                                    <SelectItem value="WIP">WIP Area</SelectItem>
                                    <SelectItem value="FG">Finished Goods</SelectItem>
                                    <SelectItem value="DISPATCH">Dispatch Area</SelectItem>
                                </SelectContent>
                            </Select>
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

const getLocationColor = (type: string) => {
    switch (type) {
        case "FG": return "bg-green-100 text-green-700 hover:bg-green-200"
        case "RM": return "bg-blue-100 text-blue-700 hover:bg-blue-200"
        case "WIP": return "bg-orange-100 text-orange-700 hover:bg-orange-200"
        case "QC": return "bg-blue-100 text-blue-700 hover:bg-blue-200"
        case "DISPATCH": return "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
        default: return "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }
}

const getLocationIcon = (type: string) => {
    switch (type) {
        case "FG": return Box
        case "RM": return Box
        case "WIP": return Archive
        case "QC": return ShieldCheck
        case "DISPATCH": return Truck
        default: return Warehouse
    }
}

// --- Main Page ---
export default function LocationsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Location | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Location | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: locations } = useQuery({
        queryKey: ["locations"],
        queryFn: factoryService.getLocations,
    })

    const { data: plants } = useQuery({
        queryKey: ["plants"],
        queryFn: factoryService.getPlants,
    })

    const createMutation = useMutation({
        mutationFn: factoryService.createLocation,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["locations"] })
            toast({ title: "Success", description: "Location created." })
            setIsCreateOpen(false)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => factoryService.updateLocation(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["locations"] })
            toast({ title: "Success", description: "Location updated." })
            setEditingItem(null)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: factoryService.deleteLocation,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["locations"] })
            toast({ title: "Success", description: "Location deleted." })
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const filteredLocations = locations?.filter(loc =>
        loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        loc.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        loc.type.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    return (
        <FactoryPageLayout
            title="Locations"
            description="Manage inventory locations, warehouses, and storage areas within plants."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search locations..."
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Location
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Location</DialogTitle>
                        </DialogHeader>
                        <LocationForm
                            plants={plants || []}
                            onSubmit={(data) => createMutation.mutate(data)}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredLocations.map((location) => {
                    const Icon = getLocationIcon(location.type)
                    const plant = plants?.find(p => p.id === location.plant)

                    return (
                        <Card key={location.id} className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-slate-50/50 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="bg-surface-1 text-xs font-mono">
                                        {location.code}
                                    </Badge>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:text-blue-600"
                                        onClick={() => setEditingItem(location)}
                                    >
                                        <Settings2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:text-red-600"
                                        onClick={() => setItemToDelete(location)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${getLocationColor(location.type).split(" ")[0]} ${getLocationColor(location.type).split(" ")[1]}`}>
                                            <Icon className="h-6 w-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-lg text-slate-900 leading-tight">{location.name}</h3>
                                            <div className="flex items-center text-xs text-slate-500 mt-1">
                                                <MapPin className="h-3 w-3 mr-1" />
                                                {plant?.name || "Unknown Plant"}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
                                    <Badge className={`${getLocationColor(location.type)} border-transparent`}>
                                        {location.type}
                                    </Badge>
                                    <div className="text-xs text-content-4 font-medium">
                                        Active
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Location</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <LocationForm
                            plants={plants || []}
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
