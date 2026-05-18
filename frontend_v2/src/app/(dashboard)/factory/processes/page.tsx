"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { factoryService, Process } from "@/services/factory"
import { AxiosError } from "axios"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, Settings2, Trash2, ArrowRight, Layout, Info } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
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
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAuth } from "@/components/auth-provider"

const apiErr = (err: AxiosError<{ detail?: string; error?: string; message?: string }>) =>
    err.response?.data?.detail || err.response?.data?.error || err.response?.data?.message || err.message

// --- Form Schema (Phase 53.5 - Physical Only) ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    description: z.string().optional(),
    input_form: z.enum(['BULK', 'ROLL', 'NONE', '']).refine(v => v !== '', { message: 'Select input form' }),
    output_form: z.enum(['BULK', 'ROLL', '']).refine(v => v !== '', { message: 'Select output form' }),
    roll_behavior: z.enum(['CREATE_NEW', 'MODIFY_EXISTING', 'MULTI_INPUT_COMBINE', 'SPLIT', 'NONE', '']).default(''),
})

function ProcessForm({ initialData, onSubmit, isLoading }: { initialData?: Process, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            description: initialData?.description || "",
            input_form: initialData?.input_form || "",
            output_form: initialData?.output_form || "",
            roll_behavior: initialData?.roll_behavior || "",
        },
    })

    const inputForm = form.watch("input_form")
    const outputForm = form.watch("output_form")
    const derivedBehavior = (() => {
        if (!inputForm || !outputForm) return null // Not selected yet
        if (inputForm === "BULK" && outputForm === "ROLL") return "CREATE_NEW"
        if (inputForm === "ROLL" && outputForm === "BULK") return "NONE"
        if (inputForm === "NONE") return "NONE"
        if (inputForm === "ROLL" && outputForm === "ROLL") return null // User must pick
        return null
    })()
    const behaviorLocked = derivedBehavior !== null && inputForm && outputForm
    const immutableBehavior = Boolean(initialData?.id)
    useEffect(() => {
        if (behaviorLocked && derivedBehavior) {
            const currentValue = form.getValues("roll_behavior");
            if (currentValue !== derivedBehavior) {
                form.setValue("roll_behavior", derivedBehavior as any, { shouldValidate: true, shouldDirty: true });
            }
        }
    }, [inputForm, outputForm, behaviorLocked, derivedBehavior, form]);

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Help Text */}
                <Alert className="bg-blue-50 border-blue-200">
                    <Info className="h-4 w-4 text-blue-600" />
                    <AlertDescription className="text-blue-800 text-sm">
                        Process defines <strong>ONLY physical behavior</strong>. Quantity is
                        always template-driven. Finished Good vs WIP is decided by Route position automatically.
                    </AlertDescription>
                </Alert>

                {/* Basic Info */}
                <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700">Basic Information</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="code"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Process Code</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. EXT" {...field} />
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
                                    <FormLabel>Process Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g. Extrusion" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="description"
                            render={({ field }) => (
                                <FormItem className="col-span-2">
                                    <FormLabel>Description</FormLabel>
                                    <FormControl>
                                        <Textarea placeholder="Physics behavior notes..." {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* IO Configuration */}
                <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700">IO Configuration</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <FormField
                            control={form.control}
                            name="input_form"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Input Form</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select input form" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="BULK">Bulk</SelectItem>
                                            <SelectItem value="ROLL">Roll</SelectItem>
                                            <SelectItem value="NONE">None</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>What form of material this process consumes</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="output_form"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Output Form</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select output form" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="BULK">Bulk</SelectItem>
                                            <SelectItem value="ROLL">Roll</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>What form of material this process produces</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                {/* Behavior Flags */}
                <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-slate-700">Behavior</h4>
                    <div className="space-y-3">
                        <FormField
                            control={form.control}
                            name="roll_behavior"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Roll Behavior</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value || ''} disabled={Boolean(behaviorLocked) || immutableBehavior}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select roll behavior" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="CREATE_NEW">Create New</SelectItem>
                                            <SelectItem value="MODIFY_EXISTING">Modify Existing</SelectItem>
                                            <SelectItem value="MULTI_INPUT_COMBINE">Multi Input Combine</SelectItem>
                                            <SelectItem value="SPLIT">Split</SelectItem>
                                            <SelectItem value="NONE">None</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormDescription>
                                        {immutableBehavior
                                            ? "Roll behavior is immutable after process creation."
                                            : "Defines roll physics for this process"}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
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

// --- Main Page ---
export default function ProcessesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const { effectiveRole, user } = useAuth()
    const isAdminActor = Boolean(user?.is_owner || user?.is_superuser || ["ADMIN", "SUPER_ADMIN", "OWNER"].includes(String(effectiveRole || user?.role_info?.code || "").toUpperCase()))
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Process | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Process | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: processes } = useQuery({
        queryKey: ["processes"],
        queryFn: factoryService.getProcesses,
    })

    const createMutation = useMutation({
        mutationFn: (data: any) => {
            const payload = { ...data, roll_behavior: data.roll_behavior || 'NONE' }
            return factoryService.createProcess(payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["processes"] })
            toast({ title: "Success", description: "Process created." })
            setIsCreateOpen(false)
        },
        onError: (err: AxiosError<{ detail?: string; error?: string; message?: string }>) => toast({ title: "Error", description: apiErr(err), variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: any }) => {
            const payload = { ...data, roll_behavior: data.roll_behavior || 'NONE' }
            return factoryService.updateProcess(id, payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["processes"] })
            toast({ title: "Success", description: "Process updated." })
            setEditingItem(null)
        },
        onError: (err: AxiosError<{ detail?: string; error?: string; message?: string }>) => toast({ title: "Error", description: apiErr(err), variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: factoryService.deleteProcess,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["processes"] })
            toast({ title: "Success", description: "Process deleted." })
        },
        onError: (err: AxiosError<{ detail?: string; error?: string; message?: string }>) => toast({ title: "Error", description: apiErr(err), variant: "destructive" })
    })

    const processList = Array.isArray(processes) ? processes : []
    const filteredProcesses = processList.filter(proc =>
        proc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        proc.code.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <FactoryPageLayout
            title="Processes"
            description="Physical transformation rules. FG/WIP is determined by Route position."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search processes..."
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Process
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Create Process</DialogTitle>
                            <DialogDescription>
                                Define process physics only. Quantities and consumption are handled by templates and execution engine.
                            </DialogDescription>
                        </DialogHeader>
                        <ProcessForm
                            onSubmit={(data) => createMutation.mutate(data)}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredProcesses.map((process) => {
                    const statusRaw = String((process as any).status || "").toUpperCase()
                    const statusCodeRaw = String((process as any).status_code || "").toUpperCase()
                    const explicitInactiveCodes = new Set(["INACTIVE", "DISABLED", "ARCHIVED", "DELETED"])
                    const explicitActiveCodes = new Set(["ACTIVE", "ENABLED", "LIVE", "PUBLISHED"])
                    const combinedStatusCode = statusRaw || statusCodeRaw
                    // Legacy rows often have stale `is_active=false`; treat unknown status as active.
                    const isActive = explicitActiveCodes.has(combinedStatusCode)
                        ? true
                        : explicitInactiveCodes.has(combinedStatusCode)
                            ? false
                            : true
                    return (
                        <Card key={process.id} className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-slate-50/50 border-b border-slate-100">
                                <Badge variant="outline" className="bg-white text-xs font-mono">
                                    {process.code}
                                </Badge>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:text-blue-600"
                                        onClick={() => setEditingItem(process)}
                                    >
                                        <Settings2 className="h-4 w-4" />
                                    </Button>
                                    {isAdminActor ? (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-red-600"
                                            onClick={() => setItemToDelete(process)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    ) : null}
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-pink-50 text-pink-600 rounded-lg">
                                            <Layout className="h-6 w-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold text-lg text-slate-900 leading-tight">{process.name}</h3>
                                            <div className="flex items-center gap-1 text-xs text-slate-500 mt-1">
                                                {process.roll_behavior && (
                                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 bg-blue-50 text-blue-600">
                                                        {process.roll_behavior.replace(/_/g, " ")}
                                                    </Badge>
                                                )}
                                                <Badge
                                                    variant="outline"
                                                    className={!isActive
                                                        ? "text-[10px] h-5 px-1.5 border-rose-200 text-rose-700 bg-rose-50"
                                                        : "text-[10px] h-5 px-1.5 border-emerald-200 text-emerald-700 bg-emerald-50"}
                                                >
                                                    {!isActive ? "INACTIVE" : "ACTIVE"}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-slate-100 text-xs text-slate-500">
                                    <div className="flex items-center gap-1">
                                        <span className="font-medium">In:</span>
                                        <Badge variant="outline" className="text-[10px] h-4 px-1">{process.input_form}</Badge>
                                    </div>
                                    <ArrowRight className="h-3 w-3 text-slate-300" />
                                    <div className="flex items-center gap-1">
                                        <span className="font-medium">Out:</span>
                                        <Badge variant="outline" className="text-[10px] h-4 px-1">{process.output_form}</Badge>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Process</DialogTitle>
                        <DialogDescription>
                            Update IO form and roll behavior mappings for this process.
                        </DialogDescription>
                    </DialogHeader>
                    {editingItem && (
                        <ProcessForm
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
                            This will permanently delete <strong>{itemToDelete?.code}</strong>. Delete linked routing rules first; active jobs still protect process history.
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
