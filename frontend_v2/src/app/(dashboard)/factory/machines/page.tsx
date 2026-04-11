"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { factoryService, Machine, WorkCenter } from "@/services/factory"
import { costingService } from "@/services/costing"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, RefreshCw, Zap, Settings2, Trash2, Activity, AlertTriangle, CheckCircle2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useEffect, useState } from "react"
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { describeApiError, extractApiErrorMap } from "@/lib/api"


// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    work_center: z.string().min(1, "Work Center is required"),
    cost_absorption_group: z.string().optional(),
})
type MachineFormValues = z.infer<typeof formSchema>

function normalizeMachineCode(value: string) {
    return String(value || "")
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase()
}

function summarizeMachineErrors(errors: Record<string, { message?: string } | undefined>) {
    return Object.entries(errors)
        .map(([field, value]) => `${field.replace(/_/g, " ")}: ${value?.message || "Invalid value"}`)
        .join(" | ")
}

function pickMachineFieldErrors(error: unknown): Partial<Record<keyof MachineFormValues, string>> {
    const fieldErrors = extractApiErrorMap(error)
    const allowed = new Set<keyof MachineFormValues>(["code", "name", "work_center", "cost_absorption_group"])
    return Object.entries(fieldErrors).reduce<Partial<Record<keyof MachineFormValues, string>>>((acc, [field, message]) => {
        if (allowed.has(field as keyof MachineFormValues)) {
            acc[field as keyof MachineFormValues] = message
        }
        return acc
    }, {})
}

function MachineForm({
    initialData,
    workCenters,
    existingMachines,
    costGroups,
    onSubmit,
    isLoading,
    serverError,
    apiFieldErrors,
    onInvalid,
    onOpenExisting,
}: {
    initialData?: Machine,
    workCenters: WorkCenter[],
    existingMachines: Machine[],
    costGroups: Array<{ id: string; code: string; label: string }>,
    onSubmit: (data: MachineFormValues) => void,
    isLoading: boolean,
    serverError?: string | null,
    apiFieldErrors?: Partial<Record<keyof MachineFormValues, string>>,
    onInvalid?: (message: string) => void,
    onOpenExisting?: (machine: Machine) => void,
}) {
    const form = useForm<MachineFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            work_center: initialData?.work_center || "",
            cost_absorption_group: initialData?.cost_absorption_group || "NONE",
        },
    })

    useEffect(() => {
        form.reset({
            code: initialData?.code || "",
            name: initialData?.name || "",
            work_center: initialData?.work_center || "",
            cost_absorption_group: initialData?.cost_absorption_group || "NONE",
        })
    }, [form, initialData])

    useEffect(() => {
        form.clearErrors()
        Object.entries(apiFieldErrors || {}).forEach(([field, message]) => {
            if (!message) return
            form.setError(field as keyof MachineFormValues, { type: "server", message })
        })
    }, [apiFieldErrors, form])

    const watchedCode = form.watch("code")
    const watchedWorkCenter = form.watch("work_center")
    const normalizedCode = normalizeMachineCode(watchedCode)
    const duplicateMachine = existingMachines.find((machine) =>
        machine.id !== initialData?.id &&
        machine.work_center === watchedWorkCenter &&
        normalizeMachineCode(machine.code) === normalizedCode
    )
    const duplicateMessage = duplicateMachine
        ? `Machine code '${normalizedCode}' already belongs to ${duplicateMachine.name} in ${duplicateMachine.work_center_name}.`
        : null

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((data) => {
                    const normalized = normalizeMachineCode(data.code)
                    if (duplicateMachine) {
                        form.setError("code", { type: "manual", message: duplicateMessage || "Machine code already exists in this work center." })
                        onInvalid?.(duplicateMessage || "Machine code already exists in this work center.")
                        return
                    }
                    onSubmit({ ...data, code: normalized })
                }, (errors) => onInvalid?.(summarizeMachineErrors(errors as Record<string, { message?: string } | undefined>)))}
                className="space-y-4"
            >
                {serverError ? (
                    <Alert variant="destructive">
                        <AlertTitle>Machine was not saved</AlertTitle>
                        <AlertDescription>{serverError}</AlertDescription>
                    </Alert>
                ) : null}
                {duplicateMachine ? (
                    <Alert>
                        <AlertTitle>Code already used in this work center</AlertTitle>
                        <AlertDescription className="space-y-3">
                            <p>{duplicateMessage}</p>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <Badge variant="secondary" className="bg-slate-100 text-slate-700">{duplicateMachine.code}</Badge>
                                <span>{duplicateMachine.name}</span>
                                <span>•</span>
                                <span>{duplicateMachine.work_center_name}</span>
                            </div>
                            {onOpenExisting ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => onOpenExisting(duplicateMachine)}>
                                    Open existing machine
                                </Button>
                            ) : null}
                        </AlertDescription>
                    </Alert>
                ) : null}
                <FormField
                    control={form.control}
                    name="work_center"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Work Center</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select work center" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {workCenters?.map((wc) => (
                                        <SelectItem key={wc.id} value={wc.id}>
                                            {wc.name} ({wc.code})
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
                    name="cost_absorption_group"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Machine Cost Group Override</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Use work center default" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="NONE">Use work center default</SelectItem>
                                    {costGroups.map((group) => (
                                        <SelectItem key={group.id} value={group.id}>
                                            {group.code} · {group.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <div className="text-[0.8rem] text-muted-foreground">
                                Machine assignment wins first in costing precedence. Leave empty to inherit from the work center.
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Machine Code</FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="e.g. MC-01"
                                    {...field}
                                    onBlur={(event) => {
                                        field.onBlur()
                                        const normalized = normalizeMachineCode(event.target.value)
                                        if (normalized && normalized !== event.target.value) {
                                            form.setValue("code", normalized, { shouldDirty: true, shouldValidate: true })
                                        }
                                    }}
                                />
                            </FormControl>
                            <div className="text-[0.8rem] text-muted-foreground">
                                Machine codes are unique inside the selected work center.
                            </div>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Machine Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. High Speed Extruder" {...field} />
                            </FormControl>
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

const getStatusColor = (status: string) => {
    switch (status) {
        case "ACTIVE": return "bg-green-100 text-green-700 hover:bg-green-200 border-green-200"
        case "DOWN": return "bg-red-100 text-red-700 hover:bg-red-200 border-red-200"
        case "MAINTENANCE": return "bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200"
        default: return "bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200"
    }
}

const getStatusIcon = (status: string) => {
    switch (status) {
        case "ACTIVE": return CheckCircle2
        case "DOWN": return AlertTriangle
        case "MAINTENANCE": return RefreshCw
        default: return Activity
    }
}

// --- Main Page ---
export default function MachinesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Machine | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Machine | null>(null)
    const [searchQuery, setSearchQuery] = useState("")
    const [createSubmitError, setCreateSubmitError] = useState<string | null>(null)
    const [createFieldErrors, setCreateFieldErrors] = useState<Partial<Record<keyof MachineFormValues, string>>>({})
    const [editSubmitError, setEditSubmitError] = useState<string | null>(null)
    const [editFieldErrors, setEditFieldErrors] = useState<Partial<Record<keyof MachineFormValues, string>>>({})

    const { data: machines } = useQuery({
        queryKey: ["machines"],
        queryFn: factoryService.getMachines,
    })

    const { data: workCenters } = useQuery({
        queryKey: ["work-centers"],
        queryFn: factoryService.getWorkCenters,
    })
    const { data: costGroups } = useQuery({
        queryKey: ["cost-groups"],
        queryFn: costingService.getCostGroups,
    })

    const createMutation = useMutation({
        mutationFn: factoryService.createMachine,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
            setCreateSubmitError(null)
            setCreateFieldErrors({})
            toast({ title: "Success", description: "Machine created." })
            setIsCreateOpen(false)
        },
        onError: (err: unknown) => {
            const message = describeApiError(err, "Machine could not be created.")
            setCreateSubmitError(message)
            setCreateFieldErrors(pickMachineFieldErrors(err))
            toast({ title: "Machine create failed", description: message, variant: "destructive" })
        }
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => factoryService.updateMachine(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
            setEditSubmitError(null)
            setEditFieldErrors({})
            toast({ title: "Success", description: "Machine updated." })
            setEditingItem(null)
        },
        onError: (err: unknown) => {
            const message = describeApiError(err, "Machine could not be updated.")
            setEditSubmitError(message)
            setEditFieldErrors(pickMachineFieldErrors(err))
            toast({ title: "Machine update failed", description: message, variant: "destructive" })
        }
    })

    const deleteMutation = useMutation({
        mutationFn: factoryService.deleteMachine,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["machines"] })
            toast({ title: "Success", description: "Machine deleted." })
        },
        onError: (err: unknown) => {
            toast({ title: "Machine delete failed", description: describeApiError(err, "Machine could not be deleted."), variant: "destructive" })
        }
    })

    const sortedMachines = [...(machines || [])].sort((left, right) => {
        const codeCompare = normalizeMachineCode(left.code).localeCompare(normalizeMachineCode(right.code))
        if (codeCompare !== 0) return codeCompare
        const workCenterCompare = String(left.work_center_name || "").localeCompare(String(right.work_center_name || ""))
        if (workCenterCompare !== 0) return workCenterCompare
        return left.name.localeCompare(right.name)
    })
    const query = searchQuery.trim().toLowerCase()
    const filteredMachines = sortedMachines.filter((machine) =>
        !query ||
        machine.name.toLowerCase().includes(query) ||
        machine.code.toLowerCase().includes(query) ||
        normalizeMachineCode(machine.code).toLowerCase().includes(query) ||
        String(machine.work_center_name || "").toLowerCase().includes(query)
    )

    return (
        <FactoryPageLayout
            title="Machines"
            description="Manage specific production units and equipment within your work centers."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by code, name, or work center..."
            actions={
                <Dialog open={isCreateOpen} onOpenChange={(open) => {
                    setIsCreateOpen(open)
                    if (!open) {
                        setCreateSubmitError(null)
                        setCreateFieldErrors({})
                    }
                }}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Machine
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Machine</DialogTitle>
                        </DialogHeader>
                        <MachineForm
                            workCenters={workCenters || []}
                            existingMachines={machines || []}
                            costGroups={costGroups || []}
                            onSubmit={(data) => {
                                setCreateSubmitError(null)
                                setCreateFieldErrors({})
                                createMutation.mutate(data)
                            }}
                            isLoading={createMutation.isPending}
                            serverError={createSubmitError}
                            apiFieldErrors={createFieldErrors}
                            onInvalid={(message) => {
                                setCreateSubmitError(message)
                                toast({ title: "Cannot save machine yet", description: message, variant: "destructive" })
                            }}
                            onOpenExisting={(machine) => {
                                setIsCreateOpen(false)
                                setCreateSubmitError(null)
                                setCreateFieldErrors({})
                                setEditingItem(machine)
                            }}
                        />
                    </DialogContent>
                </Dialog>
            }
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredMachines.map((machine) => {
                    const StatusIcon = getStatusIcon(machine.status)
                    const wc = workCenters?.find(w => w.id === machine.work_center)

                    return (
                        <Card key={machine.id} className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-slate-50/50 border-b border-slate-100">
                                <Badge variant="outline" className={`bg-white border text-xs font-semibold px-2 py-0.5 rounded-full ${getStatusColor(machine.status)}`}>
                                    <StatusIcon className="h-3 w-3 mr-1 inline-block" />
                                    {machine.status}
                                </Badge>

                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:text-blue-600"
                                        onClick={() => setEditingItem(machine)}
                                    >
                                        <Settings2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hover:text-red-600"
                                        onClick={() => setItemToDelete(machine)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                            <Zap className="h-6 w-6" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant="secondary" className="h-6 bg-slate-900 px-2.5 text-[11px] font-bold tracking-[0.18em] text-white">
                                                    {machine.code}
                                                </Badge>
                                                <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                                                    {wc?.code || "NO-WC"}
                                                </span>
                                            </div>
                                            <h3 className="mt-2 font-semibold text-lg text-slate-900 leading-tight">{machine.name}</h3>
                                            <div className="flex items-center text-xs text-slate-500 mt-1">
                                                <span className="text-slate-500">{wc?.name || "No WC"}</span>
                                            </div>
                                            <div className="mt-2">
                                                <Badge variant="outline" className="border-indigo-200 text-indigo-700">
                                                    {machine.cost_absorption_group_code || wc?.default_cost_absorption_group_code || "Inherited from work center"}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div >

            <Dialog open={!!editingItem} onOpenChange={(open) => {
                if (!open) {
                    setEditingItem(null)
                    setEditSubmitError(null)
                    setEditFieldErrors({})
                }
            }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Machine</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <MachineForm
                            workCenters={workCenters || []}
                            existingMachines={machines || []}
                            costGroups={costGroups || []}
                            initialData={editingItem}
                            onSubmit={(data) => {
                                setEditSubmitError(null)
                                setEditFieldErrors({})
                                updateMutation.mutate({ id: editingItem.id, data })
                            }}
                            isLoading={updateMutation.isPending}
                            serverError={editSubmitError}
                            apiFieldErrors={editFieldErrors}
                            onInvalid={(message) => {
                                setEditSubmitError(message)
                                toast({ title: "Cannot update machine yet", description: message, variant: "destructive" })
                            }}
                            onOpenExisting={(machine) => {
                                setEditingItem(machine)
                            }}
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
        </FactoryPageLayout >
    )
}
