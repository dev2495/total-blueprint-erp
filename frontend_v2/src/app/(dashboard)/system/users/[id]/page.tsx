"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useParams } from "next/navigation"
import { systemUserService, Role, PermissionCatalogEntry } from "@/services/system-users"
import { factoryService, Machine, WorkCenter } from "@/services/factory"
import { PageHeader } from "@/components/ui-custom/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Loader2, ArrowLeft, Shield, Key, Building2, Cog, Save, Search, Circle, CheckCircle2, Info } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { FieldErrors, useForm, type UseFormReturn } from "react-hook-form"
import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { getCanonicalRoleLabel } from "@/lib/roles"
import { describeApiError, extractApiErrorMap as extractSharedApiErrorMap } from "@/lib/api"

const formSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    first_name: z.string().optional().or(z.literal('')),
    last_name: z.string().optional().or(z.literal('')),
    email: z.string().email("Valid email is required"),
    password: z.string().min(8, "Password must be at least 8 characters").optional().or(z.literal('')),
    role_id: z.string().min(1, "Role is required"),
    is_active: z.boolean().default(true),
    work_center_ids: z.array(z.string()).default([]),
    machine_ids: z.array(z.string()).default([]),
    extra_permissions: z.array(z.string()).default([]),
})
type UserFormValues = z.infer<typeof formSchema>

const setupSteps = [
    { key: "basic", label: "Basic Info" },
    { key: "role", label: "Role & Access" },
    { key: "assignments", label: "Assignments" },
] as const

function humanize(value: string) {
    return String(value || "")
        .replace(/[_\-]+/g, " ")
        .replace(/\./g, " ")
        .trim()
        .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
}

function permissionTitle(entry: PermissionCatalogEntry) {
    const moduleName = humanize(entry.module || "")
    const actionName = humanize(entry.action || "")
    if (!moduleName && !actionName) return humanize(entry.permission)
    if (!moduleName) return actionName
    if (!actionName) return moduleName
    return `${moduleName} - ${actionName}`
}

function formatServerErrorValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(formatServerErrorValue).filter(Boolean).join(", ")
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>)
            .map(([key, nestedValue]) => `${humanize(key)}: ${formatServerErrorValue(nestedValue)}`)
            .filter(Boolean)
            .join(" | ")
    }
    return String(value ?? "").trim()
}

function extractApiErrorMap(err: unknown): Record<string, string> {
    const shared = extractSharedApiErrorMap(err)
    if (Object.keys(shared).length > 0) return shared
    const payload = (err as { response?: { data?: unknown } } | null | undefined)?.response?.data
    if (!payload || typeof payload !== "object") return {}
    return Object.entries(payload as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
        const message = formatServerErrorValue(value)
        if (message) acc[key] = message
        return acc
    }, {})
}

function errorDetail(err: unknown) {
    const typedError = err as {
        code?: string
        message?: string
        response?: { data?: { detail?: unknown } }
    }
    if (typedError?.code === "ERR_NETWORK") {
        return "Backend API is not reachable. Start backend server (expected on http://127.0.0.1:8000) and retry."
    }
    const described = describeApiError(err, "")
    if (described) return described
    const fieldErrors = extractApiErrorMap(err)
    const fieldErrorSummary = Object.entries(fieldErrors)
        .map(([field, message]) => `${humanize(field)}: ${message}`)
        .join(" | ")
    if (fieldErrorSummary) return fieldErrorSummary
    return typedError?.message || "Request failed"
}

function firstValidationMessage(errors: FieldErrors<UserFormValues>) {
    const entries = Object.entries(errors)
    if (!entries.length) return "Complete the highlighted required fields, then save again."
    return entries
        .map(([field, value]) => {
            const message = typeof value?.message === "string" ? value.message : "Invalid value"
            return `${humanize(field)}: ${message}`
        })
        .join(" | ")
}

function tabForInvalidField(errors: FieldErrors<UserFormValues>): string {
    if (errors.username || errors.email || errors.password || errors.first_name || errors.last_name || errors.is_active) return "basic"
    if (errors.role_id || errors.extra_permissions) return "role"
    return "assignments"
}

export default function UserDetailPage() {
    const { toast } = useToast()
    const router = useRouter()
    const params = useParams()
    const queryClient = useQueryClient()
    const userId = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "")
    const isNew = userId === "new"

    // Data Fetching
    const { data: user, isLoading: userLoading } = useQuery({
        queryKey: ["user", userId],
        queryFn: () => systemUserService.getUser(userId),
        enabled: !isNew && !!userId
    })
    const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: systemUserService.getRoles })
    const workCentersQuery = useQuery({ queryKey: ["work-centers"], queryFn: factoryService.getWorkCenters })
    const machinesQuery = useQuery({ queryKey: ["machines"], queryFn: factoryService.getMachines })
    const permissionCatalogQuery = useQuery({
        queryKey: ["permission-catalog"],
        queryFn: systemUserService.getPermissionCatalog,
    })
    const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data])
    const workCenters = useMemo(() => workCentersQuery.data ?? [], [workCentersQuery.data])
    const machines = useMemo(() => machinesQuery.data ?? [], [machinesQuery.data])
    const permissionCatalog = useMemo(() => permissionCatalogQuery.data ?? [], [permissionCatalogQuery.data])

    const [activeTab, setActiveTab] = useState<string>("basic")
    const [permissionSearch, setPermissionSearch] = useState("")
    const [workCenterSearch, setWorkCenterSearch] = useState("")
    const [machineSearch, setMachineSearch] = useState("")
    const [showSelectedOnly, setShowSelectedOnly] = useState(false)
    const [showBasePermissions, setShowBasePermissions] = useState(false)
    const [showAdvancedAccess, setShowAdvancedAccess] = useState(false)
    const [permissionOverridesAllowed, setPermissionOverridesAllowed] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const form: UseFormReturn<UserFormValues> = useForm<UserFormValues>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            username: "",
            first_name: "",
            last_name: "",
            email: "",
            password: "",
            role_id: "",
            is_active: true,
            work_center_ids: [] as string[],
            machine_ids: [] as string[],
            extra_permissions: [] as string[],
        },
    })

    // Populate form when user data loads
    useEffect(() => {
        if (user) {
            const existingExtraPermissions = user.extra_permissions || []
            form.reset({
                username: user.username || "",
                first_name: user.first_name || "",
                last_name: user.last_name || "",
                email: user.email || "",
                password: "",
                role_id: user.role_info?.id || "",
                is_active: user.is_active ?? true,
                work_center_ids: user.entitlements?.context?.work_centers || [],
                machine_ids: user.entitlements?.context?.machines || [],
                extra_permissions: existingExtraPermissions,
            })
            setPermissionOverridesAllowed(existingExtraPermissions.length > 0)
            setShowAdvancedAccess(existingExtraPermissions.length > 0)
        }
    }, [user, form])

    const selectedRoleId = form.watch("role_id")
    const selectedRole = roles.find((r: Role) => r.id === selectedRoleId)
    const roleCode = selectedRole?.code
    const roleDefaultPermissions = useMemo(
        () => selectedRole?.default_permissions ?? [],
        [selectedRole],
    )

    const showWcSelect = roleCode === "WORK_CENTER_MANAGER" || roleCode === "PLANNER"
    const showMachineSelect = false

    const watchedWcIds = form.watch("work_center_ids")
    const watchedMachineIds = form.watch("machine_ids")
    const watchedExtraPermissions = form.watch("extra_permissions")
    const selectedWcIds = useMemo(() => watchedWcIds ?? [], [watchedWcIds])
    const selectedMachineIds = useMemo(() => watchedMachineIds ?? [], [watchedMachineIds])
    const selectedExtraPermissions = useMemo(() => watchedExtraPermissions ?? [], [watchedExtraPermissions])
    const selectedOperatorWcId = showMachineSelect ? String(selectedWcIds[0] || "") : ""

    const assignablePermissions = useMemo(
        () =>
            permissionCatalog.filter(
                (entry: PermissionCatalogEntry) => Boolean(entry.assignable) && String(entry.permission || "").includes("."),
            ),
        [permissionCatalog],
    )

    const workCenterOptions = useMemo(() => {
        const query = workCenterSearch.trim().toLowerCase()
        return workCenters.filter((wc: WorkCenter) => {
            if (!query) return true
            const haystack = `${wc.name} ${wc.code} ${wc.plant_name || ""}`.toLowerCase()
            return haystack.includes(query)
        })
    }, [workCenters, workCenterSearch])

    const availableMachines = useMemo(
        () =>
            machines.filter((m: Machine) => {
                if (showMachineSelect) return String(m.work_center) === selectedOperatorWcId
                if (selectedWcIds.length > 0) return selectedWcIds.includes(String(m.work_center))
                return true
            }),
        [machines, showMachineSelect, selectedOperatorWcId, selectedWcIds],
    )

    const filteredMachines = useMemo(() => {
        const query = machineSearch.trim().toLowerCase()
        return availableMachines.filter((m: Machine) => {
            if (!query) return true
            const haystack = `${m.name} ${m.code} ${m.work_center_name || ""}`.toLowerCase()
            return haystack.includes(query)
        })
    }, [availableMachines, machineSearch])

    const permissionRows = useMemo(() => {
        const query = permissionSearch.trim().toLowerCase()
        return assignablePermissions.filter((entry) => {
            const permissionCode = String(entry.permission || "")
            const inRole = roleDefaultPermissions.includes(permissionCode)
            const inExtra = selectedExtraPermissions.includes(permissionCode)
            if (!showBasePermissions && inRole && !inExtra) return false
            if (showSelectedOnly && !inExtra) return false
            if (!query) return true
            const haystack = [
                permissionCode,
                permissionTitle(entry),
                entry.module || "",
                entry.action || "",
            ]
                .join(" ")
                .toLowerCase()
            return haystack.includes(query)
        })
    }, [
        assignablePermissions,
        permissionSearch,
        roleDefaultPermissions,
        selectedExtraPermissions,
        showBasePermissions,
        showSelectedOnly,
    ])

    const permissionsByCategory = useMemo(
        () =>
            permissionRows.reduce((acc: Record<string, PermissionCatalogEntry[]>, perm) => {
                const category = String(perm.module || "misc").toUpperCase()
                if (!acc[category]) acc[category] = []
                acc[category].push(perm)
                return acc
            }, {}),
        [permissionRows],
    )

    const setupProgress = useMemo(
        () => ({
            basic: Boolean(form.watch("username")) && Boolean(form.watch("email")),
            role: Boolean(selectedRoleId),
            assignments: showWcSelect ? selectedWcIds.length > 0 : true,
        }),
        [form, selectedRoleId, selectedWcIds.length, showWcSelect],
    )

    const setPermissionOverrides = (allowed: boolean) => {
        setPermissionOverridesAllowed(allowed)
        setShowAdvancedAccess(allowed)
        if (!allowed) {
            setShowSelectedOnly(false)
            form.setValue("extra_permissions", [])
        }
    }

    useEffect(() => {
        if (!showWcSelect) {
            form.setValue("work_center_ids", [])
            form.setValue("machine_ids", [])
            return
        }
        if (!showMachineSelect) {
            form.setValue("machine_ids", [])
            return
        }
        const currentWcs = form.getValues("work_center_ids") || []
        if (currentWcs.length > 1) {
            form.setValue("work_center_ids", [currentWcs[0]])
        }
        if (currentWcs.length === 0) {
            form.setValue("machine_ids", [])
        }
    }, [showMachineSelect, showWcSelect, form])

    useEffect(() => {
        if (!showMachineSelect || !machines.length) return
        const allowedMachineIds = new Set(
            (availableMachines || []).map((m: Machine) => String(m.id)),
        )
        const current = form.getValues("machine_ids") || []
        const filtered = current.filter((id: string) => allowedMachineIds.has(String(id)))
        if (filtered.length !== current.length) {
            form.setValue("machine_ids", filtered)
        }
    }, [availableMachines, machines, showMachineSelect, form])

    const applyApiErrorsToForm = (err: unknown) => {
        const apiErrors = extractApiErrorMap(err)
        const writableFields = new Set([
            "username",
            "first_name",
            "last_name",
            "email",
            "password",
            "role_id",
            "is_active",
            "work_center_ids",
            "machine_ids",
            "extra_permissions",
        ])
        Object.entries(apiErrors).forEach(([field, message]) => {
            if (!writableFields.has(field)) return
            form.setError(field as keyof UserFormValues, { type: "server", message })
        })
    }

    const handleInvalidSubmit = (errors: FieldErrors<UserFormValues>) => {
        const message = firstValidationMessage(errors)
        setSubmitError(message)
        const targetTab = tabForInvalidField(errors)
        setActiveTab(targetTab)
        toast({
            title: "Cannot save user yet",
            description: message,
            variant: "destructive",
        })
    }

    const saveMutation = useMutation({
        onMutate: () => {
            setSubmitError(null)
        },
        mutationFn: async (data: UserFormValues) => {
            if (isNew) {
                const newUser = await systemUserService.createUser({
                    username: data.username,
                    first_name: data.first_name,
                    last_name: data.last_name,
                    email: data.email,
                    password: data.password,
                    role_id: data.role_id,
                    is_active: data.is_active,
                    extra_permissions: data.extra_permissions,
                })
                await systemUserService.assignWorkCenters(newUser.id, data.work_center_ids || [])
                await systemUserService.assignMachines(newUser.id, data.machine_ids || [])
                return newUser
            } else {
                await systemUserService.updateUser(userId, {
                    username: data.username,
                    first_name: data.first_name,
                    last_name: data.last_name,
                    email: data.email,
                    role_id: data.role_id,
                    is_active: data.is_active,
                    extra_permissions: data.extra_permissions,
                    ...(data.password ? { password: data.password } : {})
                })
                await systemUserService.assignWorkCenters(userId, data.work_center_ids || [])
                await systemUserService.assignMachines(userId, data.machine_ids || [])
                return user
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["users"] })
            setSubmitError(null)
            toast({ title: "Success", description: isNew ? "User created." : "User updated." })
            router.push("/system/users")
        },
        onError: (err: unknown) => {
            const message = errorDetail(err)
            setSubmitError(message)
            applyApiErrorsToForm(err)
            toast({ title: "User save failed", description: message, variant: "destructive" })
        }
    })

    const handleSave = form.handleSubmit((data) => saveMutation.mutate(data), handleInvalidSubmit)

    if (userLoading && !isNew) {
        return (
            <div className="flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    const firstLoadError = rolesQuery.error || permissionCatalogQuery.error || workCentersQuery.error || machinesQuery.error

    return (
        <div className="space-y-6">
            <PageHeader
                title={isNew ? "Create New User" : `Edit User: ${user?.username || ''}`}
                description={isNew ? "Use the 3-step setup below to create the account quickly." : "Edit account, role access, and floor assignments."}
                actions={
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => router.push("/system/users")}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                        </Button>
                        <Button onClick={handleSave} disabled={saveMutation.isPending}>
                            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            <Save className="mr-2 h-4 w-4" /> Save User
                        </Button>
                    </div>
                }
            />

            {firstLoadError ? (
                <Alert variant="destructive">
                    <Info className="h-4 w-4" />
                    <AlertTitle>Data loading failed</AlertTitle>
                    <AlertDescription>{errorDetail(firstLoadError)}</AlertDescription>
                </Alert>
            ) : null}

            <Card className="border-blue-100 bg-blue-50/40">
                <CardContent className="pt-5">
                    <div className="grid gap-3 md:grid-cols-3">
                        {setupSteps.map((step) => {
                            const complete = setupProgress[step.key as keyof typeof setupProgress]
                            return (
                                <button
                                    key={step.key}
                                    type="button"
                                    onClick={() => setActiveTab(step.key)}
                                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${activeTab === step.key
                                        ? "border-blue-300 bg-white shadow-sm"
                                        : "border-blue-100 bg-white/80 hover:border-blue-200"
                                        }`}
                                >
                                    {complete ? (
                                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    ) : (
                                        <Circle className="h-4 w-4 text-slate-400" />
                                    )}
                                    <span className="text-sm font-medium text-slate-700">{step.label}</span>
                                </button>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {submitError ? (
                <Alert variant="destructive" data-testid="user-save-error">
                    <Info className="h-4 w-4" />
                    <AlertTitle>User was not saved</AlertTitle>
                    <AlertDescription>{submitError}</AlertDescription>
                </Alert>
            ) : null}

            <Card className="border-slate-200 bg-white" data-testid="user-access-contract">
                <CardContent className="grid gap-4 pt-5 md:grid-cols-4">
                    <button type="button" onClick={() => setActiveTab("role")} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-300">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Base role assigned</div>
                        <div className="mt-2 text-base font-black text-slate-950">{selectedRole ? getCanonicalRoleLabel(selectedRole.code, selectedRole.name) : "Not selected"}</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {selectedRole ? <Badge className="bg-blue-600">{selectedRole.code}</Badge> : <Badge variant="outline">Required before save</Badge>}
                        </div>
                    </button>
                    <button type="button" onClick={() => { setActiveTab("role"); setShowBasePermissions(true); setShowAdvancedAccess(permissionOverridesAllowed) }} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-300">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Base permissions</div>
                        <div className="mt-2 text-2xl font-black text-slate-950">{roleDefaultPermissions.length}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">Included from the selected role baseline.</div>
                    </button>
                    <button type="button" onClick={() => { setActiveTab("role"); setPermissionOverrides(true) }} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left transition hover:border-amber-400">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Overrides allowed</div>
                        <div className="mt-2 text-2xl font-black text-slate-950">{permissionOverridesAllowed ? "ON" : "OFF"}</div>
                        <div className="mt-1 text-xs font-semibold text-amber-800">{selectedExtraPermissions.length} user-level extra permission(s).</div>
                    </button>
                    <button type="button" onClick={() => setActiveTab("assignments")} className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-300">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Floor scope</div>
                        <div className="mt-2 text-base font-black text-slate-950">{selectedWcIds.length} WC / {selectedMachineIds.length} machines</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">Required for WCM, Planner, and Operator roles.</div>
                    </button>
                </CardContent>
            </Card>

            <Form {...form}>
                <form className="space-y-6" onSubmit={handleSave}>
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                        <TabsList className="w-full justify-start border-b bg-transparent p-0">
                            <TabsTrigger value="basic" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none">
                                Basic Info
                            </TabsTrigger>
                            <TabsTrigger value="role" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none">
                                Role & Access
                            </TabsTrigger>
                            <TabsTrigger value="assignments" className="data-[state=active]:border-b-2 data-[state=active]:border-blue-500 rounded-none">
                                Assignments
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="basic" className="pt-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Shield className="h-5 w-5 text-blue-600" /> Account Details
                                    </CardTitle>
                                    <CardDescription>Fill mandatory fields first: username and email.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <FormField
                                            control={form.control}
                                            name="username"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Username *</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="johndoe" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="email"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Email *</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="john@example.com" {...field} />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <FormField
                                            control={form.control}
                                            name="first_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>First Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="John" {...field} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="last_name"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Last Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="Doe" {...field} />
                                                    </FormControl>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <FormField
                                            control={form.control}
                                            name="password"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>Password {!isNew && "(Leave blank to keep current)"}</FormLabel>
                                                    <FormControl>
                                                        <PasswordInput {...field} />
                                                    </FormControl>
                                                    <FormDescription>
                                                        New passwords must be at least 8 characters and still pass the server security policy.
                                                    </FormDescription>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="is_active"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 pt-8">
                                                    <FormControl>
                                                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                                                    </FormControl>
                                                    <FormLabel className="font-normal">Active User</FormLabel>
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="role" className="pt-6 space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Key className="h-5 w-5 text-blue-600" /> Step 2: Choose Role
                                    </CardTitle>
                                    <CardDescription>Select one role baseline first. Only then add extra access if required.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <FormField
                                        control={form.control}
                                        name="role_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="w-full max-w-md">
                                                            <SelectValue placeholder="Select a role..." />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {roles.map((r: Role) => (
                                                            <SelectItem key={r.id} value={r.id}>
                                                                <div className="flex items-center gap-2">
                                                                    <Badge variant="outline" className="text-xs">{r.code}</Badge>
                                                                    {getCanonicalRoleLabel(r.code, r.name)}
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    {selectedRole ? (
                                        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge className="bg-blue-600">{selectedRole.code}</Badge>
                                                <span className="text-sm text-slate-600">{getCanonicalRoleLabel(selectedRole.code, selectedRole.name)}</span>
                                                <Badge variant="outline">{roleDefaultPermissions.length} base permissions</Badge>
                                            </div>
                                            {selectedRole.description ? (
                                                <p className="mt-2 text-xs text-slate-500">{selectedRole.description}</p>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <CardTitle className="text-lg flex items-center gap-2">
                                                <Shield className="h-5 w-5 text-blue-600" /> Advanced Access Overrides
                                            </CardTitle>
                                            <CardDescription>
                                                Keep the role baseline clean. Add only the minimum extra access this user actually needs.
                                            </CardDescription>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={!permissionOverridesAllowed}
                                            onClick={() => setShowAdvancedAccess((value) => !value)}
                                        >
                                            {showAdvancedAccess ? "Hide permission list" : "Review permission list"}
                                        </Button>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                        <Checkbox
                                            checked={permissionOverridesAllowed}
                                            disabled={!selectedRoleId}
                                            onCheckedChange={(checked) => setPermissionOverrides(Boolean(checked))}
                                        />
                                        <div>
                                            <div className="text-sm font-black text-slate-950">Allow extra permission overrides for this user</div>
                                            <div className="mt-1 text-xs font-semibold leading-relaxed text-amber-900">
                                                Base role stays assigned. Turn this on only when this single user needs access beyond {selectedRole?.code || "the selected role"}.
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <Badge variant="outline">Base role grants {roleDefaultPermissions.length}</Badge>
                                                <Badge className="bg-amber-600">Extra overrides {selectedExtraPermissions.length}</Badge>
                                            </div>
                                        </div>
                                    </label>

                                    {!selectedRoleId ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">
                                            Choose a role first to unlock extra access controls.
                                        </div>
                                    ) : !permissionOverridesAllowed ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">
                                            Overrides are off. The user will receive exactly the selected base role permissions.
                                        </div>
                                    ) : !showAdvancedAccess ? (
                                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-slate-500">
                                            Overrides are enabled. Press “Review permission list” to choose the exact extra permissions.
                                        </div>
                                    ) : (
                                        <FormField
                                            control={form.control}
                                            name="extra_permissions"
                                            render={({ field }) => (
                                                <FormItem className="space-y-3">
                                                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                                        <div className="relative w-full md:max-w-sm">
                                                            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                                            <Input
                                                                value={permissionSearch}
                                                                onChange={(event) => setPermissionSearch(event.target.value)}
                                                                placeholder="Search by module/action/permission..."
                                                                className="pl-9"
                                                            />
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant={showSelectedOnly ? "default" : "outline"}
                                                                onClick={() => setShowSelectedOnly((value) => !value)}
                                                            >
                                                                Selected only
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant={showBasePermissions ? "default" : "outline"}
                                                                onClick={() => setShowBasePermissions((value) => !value)}
                                                            >
                                                                Show base
                                                            </Button>
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="ghost"
                                                                onClick={() => field.onChange([])}
                                                            >
                                                                Clear extras
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-2 text-xs">
                                                        <Badge variant="outline">Base: {roleDefaultPermissions.length}</Badge>
                                                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                                                            Extra: {selectedExtraPermissions.length}
                                                        </Badge>
                                                        <Badge variant="outline">Visible: {permissionRows.length}</Badge>
                                                    </div>

                                                    <ScrollArea className="h-[460px] border rounded-lg p-4 bg-slate-50/50">
                                                        {Object.entries(permissionsByCategory).map(([category, perms]) => (
                                                            <div key={category} className="mb-6 last:mb-0">
                                                                <div className="mb-3 flex items-center gap-2 border-b pb-2">
                                                                    <span className="h-2 w-2 rounded-full bg-blue-400"></span>
                                                                    <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700">{category}</h4>
                                                                </div>
                                                                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                                                    {perms.map((perm) => {
                                                                        const isInRole = roleDefaultPermissions.includes(perm.permission)
                                                                        const isExtra = (field.value || []).includes(perm.permission)
                                                                        const isChecked = isInRole || isExtra
                                                                        return (
                                                                            <label
                                                                                key={perm.permission}
                                                                                className={`flex items-start justify-between gap-3 rounded-lg border p-3 transition ${isChecked
                                                                                    ? "border-blue-200 bg-white shadow-sm"
                                                                                    : "border-slate-200 bg-white hover:border-slate-300"
                                                                                    }`}
                                                                            >
                                                                                <div className="flex items-start gap-3">
                                                                                    <Checkbox
                                                                                        checked={isChecked}
                                                                                        disabled={isInRole}
                                                                                        onCheckedChange={(checked) => {
                                                                                            const current = field.value || []
                                                                                            if (checked) field.onChange([...current, perm.permission])
                                                                                            else field.onChange(current.filter((p: string) => p !== perm.permission))
                                                                                        }}
                                                                                        className={isInRole ? "data-[state=checked]:bg-slate-400 data-[state=checked]:border-slate-400" : ""}
                                                                                    />
                                                                                    <div>
                                                                                        <div className="text-sm font-semibold text-slate-900">{permissionTitle(perm)}</div>
                                                                                        <div className="text-[11px] text-slate-500 font-mono">{perm.permission}</div>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="flex items-center gap-1">
                                                                                    {isInRole ? <Badge variant="secondary" className="text-[10px]">Base</Badge> : null}
                                                                                    {isExtra ? <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">Extra</Badge> : null}
                                                                                </div>
                                                                            </label>
                                                                        )
                                                                    })}
                                                                </div>
                                                            </div>
                                                        ))}
                                                        {!Object.keys(permissionsByCategory).length && (
                                                            <div className="p-8 text-center text-sm text-slate-500">
                                                                No permissions found for current filters.
                                                            </div>
                                                        )}
                                                    </ScrollArea>
                                                </FormItem>
                                            )}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>

                        <TabsContent value="assignments" className="pt-6 space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Building2 className="h-5 w-5 text-blue-600" /> Work Center Assignment
                                    </CardTitle>
                                    <CardDescription>
                                        {showWcSelect
                                            ? showMachineSelect
                                                ? "Operator must be assigned to exactly one Work Center."
                                                : "Assign one or more Work Centers for this role."
                                            : "No work center assignment needed for this role."}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {showWcSelect ? (
                                        <FormField
                                            control={form.control}
                                            name="work_center_ids"
                                            render={({ field }) => (
                                                <FormItem className="space-y-3">
                                                    <div className="relative w-full md:max-w-sm">
                                                        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                                        <Input
                                                            value={workCenterSearch}
                                                            onChange={(event) => setWorkCenterSearch(event.target.value)}
                                                            placeholder="Search work centers..."
                                                            className="pl-9"
                                                        />
                                                    </div>
                                                    {showMachineSelect ? (
                                                        <Select
                                                            value={String((field.value || [])[0] || "")}
                                                            onValueChange={(value) => field.onChange(value ? [value] : [])}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger className="w-full md:max-w-md">
                                                                    <SelectValue placeholder="Select one work center..." />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {workCenterOptions.map((wc: WorkCenter) => (
                                                                    <SelectItem key={wc.id} value={String(wc.id)}>
                                                                        {wc.name} ({wc.code})
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <ScrollArea className="h-48 rounded-md border p-3">
                                                            {!workCenters.length ? (
                                                                <div className="flex items-center justify-center h-full text-slate-400 text-sm">No Work Centers found. Create one first.</div>
                                                            ) : (
                                                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                                    {workCenterOptions.map((wc: WorkCenter) => (
                                                                        <label key={wc.id} className="flex items-center space-x-3 rounded bg-slate-50 p-2 hover:bg-slate-100 transition-colors">
                                                                            <Checkbox
                                                                                checked={(field.value || []).includes(String(wc.id))}
                                                                                onCheckedChange={(checked) => {
                                                                                    const current = field.value || []
                                                                                    if (checked) field.onChange([...current, String(wc.id)])
                                                                                    else field.onChange(current.filter((id: string) => id !== String(wc.id)))
                                                                                }}
                                                                            />
                                                                            <span className="text-sm font-medium">{wc.name} <span className="text-xs text-slate-400 font-mono">({wc.code})</span></span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </ScrollArea>
                                                    )}
                                                    <FormDescription>
                                                        Selected: {(field.value || []).length} work center(s).
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                    ) : (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center text-sm italic text-slate-500">
                                            This role does not use floor assignment.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Cog className="h-5 w-5 text-blue-600" /> Machine Assignment
                                    </CardTitle>
                                    <CardDescription>
                                        {showMachineSelect
                                            ? "Assign one or more machines under the selected work center."
                                            : "Machine assignment applies only to Operator role."}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {showMachineSelect ? (
                                        <FormField
                                            control={form.control}
                                            name="machine_ids"
                                            render={({ field }) => (
                                                <FormItem className="space-y-3">
                                                    {!selectedOperatorWcId ? (
                                                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center text-sm text-slate-500">
                                                            Select a work center first.
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                                                <div className="relative w-full md:max-w-sm">
                                                                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                                                    <Input
                                                                        value={machineSearch}
                                                                        onChange={(event) => setMachineSearch(event.target.value)}
                                                                        placeholder="Search machines..."
                                                                        className="pl-9"
                                                                    />
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => {
                                                                            const visibleIds = filteredMachines.map((machine: Machine) => String(machine.id))
                                                                            field.onChange(Array.from(new Set([...(field.value || []), ...visibleIds])))
                                                                        }}
                                                                    >
                                                                        Select Visible
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        onClick={() => field.onChange([])}
                                                                    >
                                                                        Clear
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                            <ScrollArea className="h-64 rounded-md border p-3">
                                                                {!filteredMachines.length ? (
                                                                    <div className="flex items-center justify-center h-full text-slate-400 text-sm">No machines found for selected filters.</div>
                                                                ) : (
                                                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                                        {filteredMachines.map((machine: Machine) => (
                                                                            <label key={machine.id} className="flex items-center space-x-3 rounded bg-slate-50 p-2 hover:bg-slate-100 transition-colors">
                                                                                <Checkbox
                                                                                    checked={(field.value || []).includes(String(machine.id))}
                                                                                    onCheckedChange={(checked) => {
                                                                                        const current = field.value || []
                                                                                        if (checked) field.onChange([...current, String(machine.id)])
                                                                                        else field.onChange(current.filter((id: string) => id !== String(machine.id)))
                                                                                    }}
                                                                                />
                                                                                <div className="flex flex-col">
                                                                                    <span className="text-sm font-medium">{machine.name}</span>
                                                                                    <span className="text-[10px] text-slate-400 font-mono">{machine.code}</span>
                                                                                </div>
                                                                            </label>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </ScrollArea>
                                                            <FormDescription>
                                                                Selected: {(field.value || []).length} machine(s).
                                                            </FormDescription>
                                                        </>
                                                    )}
                                                </FormItem>
                                            )}
                                        />
                                    ) : (
                                        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-center text-sm italic text-slate-500">
                                            Select Operator role to assign machines.
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    <Card className="border-slate-200">
                        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                            <div className="text-sm text-slate-600">
                                Summary: <span className="font-semibold text-slate-900">{selectedRole?.code || "No role selected"}</span>
                                {" • "}
                                Extra Permissions: <span className="font-semibold text-slate-900">{selectedExtraPermissions.length}</span>
                                {" • "}
                                Work Centers: <span className="font-semibold text-slate-900">{selectedWcIds.length}</span>
                                {" • "}
                                Machines: <span className="font-semibold text-slate-900">{selectedMachineIds.length}</span>
                            </div>
                            <Button type="submit" disabled={saveMutation.isPending}>
                                {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                <Save className="mr-2 h-4 w-4" /> Save User
                            </Button>
                        </CardContent>
                    </Card>
                </form>
            </Form>
        </div>
    )
}
