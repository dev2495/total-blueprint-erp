"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { factoryService, Plant } from "@/services/factory"
import { costingService } from "@/services/costing"
import { AxiosError } from "axios"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, MapPin, Factory, Settings2, Trash2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/components/auth-provider"

function userCanManageFactory(user: any): boolean {
    if (!user) return false
    if (user.is_superuser || user.is_owner) return true
    const perms: string[] = user.entitlements?.permissions || []
    if (perms.includes("*")) return true
    return perms.includes("factory.manage")
}

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    include_in_official_reports: z.boolean().default(true),
    legal_name: z.string().optional(),
    gstin: z.string().optional(),
    address: z.string().optional(),
    contact_phone: z.string().optional(),
    contact_email: z.string().optional(),
    authorized_signatory_name: z.string().optional(),
    authorized_signatory_designation: z.string().optional(),
    default_cost_absorption_group: z.string().optional(),
})

function PlantForm({ initialData, costGroups, onSubmit, isLoading }: { initialData?: Plant, costGroups: Array<{ id: string; code: string; label: string }>, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            include_in_official_reports: initialData?.include_in_official_reports ?? true,
            legal_name: initialData?.legal_profile?.legal_name || "",
            gstin: initialData?.legal_profile?.gstin || "",
            address: initialData?.legal_profile?.address || "",
            contact_phone: initialData?.legal_profile?.contact_phone || "",
            contact_email: initialData?.legal_profile?.contact_email || "",
            authorized_signatory_name: initialData?.legal_profile?.authorized_signatory_name || "",
            authorized_signatory_designation: initialData?.legal_profile?.authorized_signatory_designation || "",
            default_cost_absorption_group: initialData?.default_cost_absorption_group || "NONE",
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-h-[78vh] flex-col">
                <div className="space-y-4 overflow-y-auto pr-1">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Plant Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. P1" {...field} />
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
                                <FormLabel>Plant Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g. Main Plant" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="default_cost_absorption_group"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Default Cost Group</FormLabel>
                                <FormControl>
                                    <Select value={field.value || "NONE"} onValueChange={field.onChange}>
                                        <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-surface-1">
                                            <SelectValue placeholder="Assign plant default group" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="NONE">No default group</SelectItem>
                                            {costGroups.map((group) => (
                                                <SelectItem key={group.id} value={group.id}>
                                                    {group.code} · {group.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </FormControl>
                                <div className="text-xs text-slate-500">Fallback group used only when work center, machine, and template-step assignments do not override it.</div>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="include_in_official_reports"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div>
                                    <FormLabel>Include In Official Reports</FormLabel>
                                    <div className="text-xs text-slate-500">Show this plant in official daily stock and production packs.</div>
                                </div>
                                <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <div className="border-t pt-2">
                        <div className="mb-3 text-sm font-semibold text-slate-700">Legal Profile (for Official DC)</div>
                        <div className="space-y-4">
                            <FormField
                                control={form.control}
                                name="legal_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Legal Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Company legal entity name" {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="gstin"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>GSTIN</FormLabel>
                                        <FormControl>
                                            <Input placeholder="GST number" {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="address"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Address</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Full legal address" {...field} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="contact_phone"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Phone</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Contact number" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="contact_email"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Email</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Contact email" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <FormField
                                    control={form.control}
                                    name="authorized_signatory_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Authorized Signatory</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Name" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="authorized_signatory_designation"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Designation</FormLabel>
                                            <FormControl>
                                                <Input placeholder="Designation" {...field} />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="mt-4 flex justify-end gap-2 border-t bg-surface-1 pt-3">
                    <Button type="submit" disabled={isLoading} data-testid="plants-save">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </div>
            </form>
        </Form>
    )
}

// --- Main Page ---
export default function PlantsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const { user } = useAuth()
    const canManage = userCanManageFactory(user)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Plant | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Plant | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: plants } = useQuery({
        queryKey: ["plants"],
        queryFn: factoryService.getPlants,
    })
    const { data: costGroups } = useQuery({
        queryKey: ["cost-groups"],
        queryFn: costingService.getCostGroups,
    })

    const buildPlantPayload = (data: z.infer<typeof formSchema>) => ({
        code: data.code,
        name: data.name,
        default_cost_absorption_group: data.default_cost_absorption_group === "NONE" ? null : data.default_cost_absorption_group || null,
        include_in_official_reports: data.include_in_official_reports,
        legal_profile: {
            legal_name: data.legal_name || data.name,
            gstin: data.gstin || "",
            address: data.address || `${data.name} Plant Address`,
            contact_phone: data.contact_phone || "",
            contact_email: data.contact_email || "",
            authorized_signatory_name: data.authorized_signatory_name || "Authorized Signatory",
            authorized_signatory_designation: data.authorized_signatory_designation || "",
        }
    })

    const createMutation = useMutation({
        mutationFn: factoryService.createPlant,
        onSuccess: async (createdPlant) => {
            queryClient.setQueryData<Plant[]>(["plants"], (current = []) => {
                const withoutExisting = current.filter((plant) => plant.id !== createdPlant.id)
                return [createdPlant, ...withoutExisting]
            })
            await queryClient.invalidateQueries({ queryKey: ["plants"] })
            await queryClient.refetchQueries({ queryKey: ["plants"], type: "active" })
            toast({ title: "Success", description: "Plant created." })
            setIsCreateOpen(false)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: ReturnType<typeof buildPlantPayload> }) => factoryService.updatePlant(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["plants"] })
            toast({ title: "Success", description: "Plant updated." })
            setEditingItem(null)
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: factoryService.deletePlant,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["plants"] })
            toast({ title: "Success", description: "Plant deleted." })
        },
        onError: (err: AxiosError<{ detail: string }>) => toast({ title: "Error", description: err.response?.data?.detail || err.message, variant: "destructive" })
    })

    const filteredPlants = plants?.filter(plant =>
        plant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        plant.code.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    return (
        <FactoryPageLayout
            title="Plants"
            description="Manage manufacturing facilities and physical plants."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search plants..."
            actions={
                canManage ? (
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="rounded-xl shadow-md hover:shadow-lg transition-all" data-testid="plants-add-button">
                                <Plus className="mr-2 h-4 w-4" /> Add Plant
                            </Button>
                        </DialogTrigger>
                        <DialogContent data-testid="plants-dialog" className="sm:max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>Create Plant</DialogTitle>
                            </DialogHeader>
                            <PlantForm
                                costGroups={costGroups || []}
                                onSubmit={(data) => createMutation.mutate(buildPlantPayload(data))}
                                isLoading={createMutation.isPending}
                            />
                        </DialogContent>
                    </Dialog>
                ) : null
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredPlants.map((plant) => (
                    <Card key={plant.id} className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-slate-50/50 border-b border-slate-100">
                            <CardTitle className="text-sm font-medium text-slate-500">
                                {plant.code}
                            </CardTitle>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 hover:text-blue-600"
                                    onClick={() => setEditingItem(plant)}
                                >
                                    <Settings2 className="h-4 w-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 hover:text-red-600"
                                    onClick={() => setItemToDelete(plant)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-6">
                            <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                        <Factory className="h-6 w-6" />
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-lg text-slate-900">{plant.name}</h3>
                                        <div className="flex items-center text-xs text-slate-500 mt-0.5">
                                            <MapPin className="h-3 w-3 mr-1" />
                                            Main Facility
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <Badge variant={plant.include_in_official_reports ? "default" : "outline"} className={plant.include_in_official_reports ? "bg-emerald-600 hover:bg-emerald-600" : "border-line-strong text-content-3"}>
                                                {plant.include_in_official_reports ? "Official report scope" : "Internal-only scope"}
                                            </Badge>
                                            {plant.legal_profile?.legal_name ? (
                                                <Badge variant="outline" className="text-[10px] border-success-border text-success-fg">
                                                    Legal Profile Configured
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[10px] border-warning-border text-warning-fg">
                                                    Legal Profile Pending
                                                </Badge>
                                            )}
                                            <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700">
                                                {plant.default_cost_absorption_group_code || "No cost group"}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100">
                                <div className="text-center">
                                    <div className="text-xs text-slate-500 mb-1">Locations</div>
                                    <Badge variant="secondary" className="bg-slate-100">{plant.location_count || 0}</Badge>
                                </div>
                                <div className="text-center border-l border-slate-100">
                                    <div className="text-xs text-slate-500 mb-1">W/C</div>
                                    <Badge variant="secondary" className="bg-slate-100">{plant.work_center_count || 0}</Badge>
                                </div>
                                <div className="text-center border-l border-slate-100">
                                    <div className="text-xs text-slate-500 mb-1">Machines</div>
                                    <Badge variant="secondary" className="bg-slate-100">{plant.machine_count || 0}</Badge>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Edit Plant</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <PlantForm
                            initialData={editingItem}
                            costGroups={costGroups || []}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data: buildPlantPayload(data) })}
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
