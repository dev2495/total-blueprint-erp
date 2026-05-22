"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowLeft,
    Check,
    Crown,
    Info,
    Key,
    Loader2,
    Save,
    Shield,
    ShieldCheck,
    Sparkles,
    UserCog,
} from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { PasswordInput } from "@/components/ui/password-input"
import { useToast } from "@/hooks/use-toast"
import {
    systemUserService,
    type User,
    type Role,
    type PermissionCatalogEntry,
} from "@/services/system-users"
import { cn } from "@/lib/utils"
import { getCanonicalRoleLabel } from "@/lib/roles"
import { MODULE_ORDER, paletteFor } from "./role-colors"

type Mode = "new" | "edit"

interface Props {
    mode: Mode
    userId?: string
    canManage: boolean
    canEditOwnerToggle: boolean
}

interface FormState {
    username: string
    first_name: string
    last_name: string
    email: string
    phone_number: string
    is_active: boolean
    is_owner: boolean
    role_id: string
    extra_permissions: string[]
    password: string
}

const DEFAULT_FORM: FormState = {
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    phone_number: "",
    is_active: true,
    is_owner: false,
    role_id: "",
    extra_permissions: [],
    password: "",
}

export function UserEditor({ mode, userId, canManage, canEditOwnerToggle }: Props) {
    const router = useRouter()
    const qc = useQueryClient()
    const { toast } = useToast()

    const userQuery = useQuery({
        queryKey: ["user", userId],
        queryFn: () => systemUserService.getUser(userId!),
        enabled: mode === "edit" && !!userId,
    })

    const rolesQuery = useQuery({
        queryKey: ["roles"],
        queryFn: systemUserService.getRoles,
        staleTime: 60_000,
    })

    const catalogQuery = useQuery({
        queryKey: ["permission-catalog"],
        queryFn: systemUserService.getPermissionCatalog,
        staleTime: 5 * 60_000,
    })

    const [form, setForm] = React.useState<FormState>(DEFAULT_FORM)
    const [pendingDirty, setPendingDirty] = React.useState(0)
    const [pwDialogOpen, setPwDialogOpen] = React.useState(false)

    // hydrate
    React.useEffect(() => {
        if (mode === "edit" && userQuery.data) {
            const u = userQuery.data
            setForm({
                username: u.username || "",
                first_name: u.first_name || "",
                last_name: u.last_name || "",
                email: u.email || "",
                phone_number: u.phone_number || "",
                is_active: !!u.is_active,
                is_owner: !!u.is_owner,
                role_id: u.role_info?.id || u.role_id || "",
                extra_permissions: Array.isArray(u.extra_permissions)
                    ? [...u.extra_permissions]
                    : [],
                password: "",
            })
            setPendingDirty(0)
        }
    }, [mode, userQuery.data])

    const update = (patch: Partial<FormState>) => {
        setForm((prev) => ({ ...prev, ...patch }))
        setPendingDirty((n) => n + 1)
    }

    const roles = rolesQuery.data || []
    const catalog = catalogQuery.data || []
    const selectedRole = roles.find((r) => r.id === form.role_id) || null

    // permissions granted by the picked role (base)
    const basePermissions = React.useMemo(() => {
        if (!selectedRole) return new Set<string>()
        return new Set<string>(selectedRole.default_permissions || [])
    }, [selectedRole])

    const hasWildcard = basePermissions.has("*")

    const overrideSet = React.useMemo(
        () => new Set(form.extra_permissions),
        [form.extra_permissions],
    )

    const togglePermission = (permission: string) => {
        const isOn = overrideSet.has(permission)
        const next = isOn
            ? form.extra_permissions.filter((p) => p !== permission)
            : [...form.extra_permissions, permission]
        update({ extra_permissions: next })
    }

    const effectivePermissions = React.useMemo(() => {
        if (hasWildcard) return new Set<string>(["*"])
        const out = new Set<string>(basePermissions)
        for (const p of form.extra_permissions) out.add(p)
        return out
    }, [basePermissions, form.extra_permissions, hasWildcard])

    const grouped = React.useMemo(() => {
        const byModule = new Map<string, PermissionCatalogEntry[]>()
        for (const entry of catalog) {
            if (!entry.assignable) continue
            const mod = entry.module || "misc"
            const arr = byModule.get(mod) || []
            arr.push(entry)
            byModule.set(mod, arr)
        }
        for (const arr of byModule.values()) {
            arr.sort((a, b) => a.permission.localeCompare(b.permission))
        }
        return byModule
    }, [catalog])

    // ── mutations
    const createMut = useMutation({
        mutationFn: () =>
            systemUserService.createUser({
                username: form.username,
                first_name: form.first_name,
                last_name: form.last_name,
                email: form.email,
                phone_number: form.phone_number,
                is_active: form.is_active,
                is_owner: canEditOwnerToggle ? form.is_owner : undefined,
                // backend accepts role_id (write-only)
                ...(form.role_id ? { role_id: form.role_id } : {}),
                extra_permissions: form.extra_permissions,
                ...(form.password ? { password: form.password } : {}),
            } as any),
        onSuccess: (saved) => {
            toast({ title: "User created", description: saved.username })
            qc.invalidateQueries({ queryKey: ["users"] })
            router.push(`/system/users/${saved.id}`)
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Create failed")
            toast({ title: "Create failed", description: msg, variant: "destructive" })
        },
    })

    const updateMut = useMutation({
        mutationFn: () => {
            const payload: any = {
                username: form.username,
                first_name: form.first_name,
                last_name: form.last_name,
                email: form.email,
                phone_number: form.phone_number,
                is_active: form.is_active,
                extra_permissions: form.extra_permissions,
            }
            if (canEditOwnerToggle) payload.is_owner = form.is_owner
            if (form.role_id) payload.role_id = form.role_id
            return systemUserService.updateUser(userId!, payload)
        },
        onSuccess: (saved) => {
            toast({ title: "User saved", description: saved.username })
            qc.invalidateQueries({ queryKey: ["users"] })
            qc.invalidateQueries({ queryKey: ["user", userId] })
            setPendingDirty(0)
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Save failed")
            toast({ title: "Save failed", description: msg, variant: "destructive" })
        },
    })

    const passwordMut = useMutation({
        mutationFn: (newPassword: string) =>
            systemUserService.updateUser(userId!, { password: newPassword } as any),
        onSuccess: () => {
            toast({ title: "Password reset", description: "User will need to re-login." })
            setPwDialogOpen(false)
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Password reset failed")
            toast({ title: "Reset failed", description: msg, variant: "destructive" })
        },
    })

    const onSubmit = () => {
        if (mode === "new") createMut.mutate()
        else updateMut.mutate()
    }

    const isPending = createMut.isPending || updateMut.isPending
    const palette = paletteFor(selectedRole?.code)

    return (
        <div className="min-h-screen bg-gradient-to-b from-indigo-50/40 via-white to-fuchsia-50/30 px-4 py-4 sm:px-6">
            <GradientHero
                palette="indigo"
                eyebrow={mode === "new" ? "SYSTEM · USERS · NEW" : "SYSTEM · USERS · EDIT"}
                title={
                    mode === "new"
                        ? "Add a user"
                        : userQuery.data?.full_name || userQuery.data?.username || "Edit user"
                }
                subtitle="Roles set the baseline. Overrides grant one-off access. Effective view shows what they can actually do."
                actions={
                    <Link href="/system/users">
                        <Button variant="secondary" className="bg-white/95 text-indigo-700 hover:bg-white">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to users
                        </Button>
                    </Link>
                }
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                {/* LEFT COLUMN */}
                <div className="space-y-6 lg:col-span-2">
                    {/* Identity */}
                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                        <header className="mb-4 flex items-center gap-2">
                            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-100 text-indigo-700">
                                <UserCog className="h-4 w-4" />
                            </div>
                            <div>
                                <h3 className="font-display text-sm font-bold text-slate-900">Identity</h3>
                                <p className="text-[11px] text-slate-500">Login credentials & contact</p>
                            </div>
                        </header>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Username *">
                                <Input
                                    value={form.username}
                                    onChange={(e) => update({ username: e.target.value })}
                                    placeholder="e.g. priya.s"
                                    disabled={!canManage}
                                />
                            </Field>
                            <Field label="Email *">
                                <Input
                                    type="email"
                                    value={form.email}
                                    onChange={(e) => update({ email: e.target.value })}
                                    placeholder="user@company.com"
                                    disabled={!canManage}
                                />
                            </Field>
                            <Field label="First name">
                                <Input
                                    value={form.first_name}
                                    onChange={(e) => update({ first_name: e.target.value })}
                                    disabled={!canManage}
                                />
                            </Field>
                            <Field label="Last name">
                                <Input
                                    value={form.last_name}
                                    onChange={(e) => update({ last_name: e.target.value })}
                                    disabled={!canManage}
                                />
                            </Field>
                            <Field label="Phone">
                                <Input
                                    value={form.phone_number}
                                    onChange={(e) => update({ phone_number: e.target.value })}
                                    disabled={!canManage}
                                />
                            </Field>
                            {mode === "new" ? (
                                <Field label="Initial password">
                                    <PasswordInput
                                        value={form.password}
                                        onChange={(e) => update({ password: e.target.value })}
                                        placeholder="At least 8 characters"
                                        disabled={!canManage}
                                    />
                                </Field>
                            ) : (
                                <div className="flex flex-col justify-end">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => setPwDialogOpen(true)}
                                        disabled={!canManage}
                                        className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                                    >
                                        <Key className="mr-1.5 h-4 w-4" /> Reset password
                                    </Button>
                                </div>
                            )}
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                                <div>
                                    <div className="text-sm font-bold text-slate-800">Active</div>
                                    <div className="text-[11px] text-slate-500">Disabling blocks all sign-ins</div>
                                </div>
                                <Switch
                                    checked={form.is_active}
                                    onCheckedChange={(v) => update({ is_active: v })}
                                    disabled={!canManage}
                                />
                            </label>
                            <label className={cn(
                                "flex items-center justify-between rounded-2xl border px-4 py-3",
                                canEditOwnerToggle ? "border-rose-200 bg-rose-50/40" : "border-slate-200 opacity-60",
                            )}>
                                <div>
                                    <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                                        <Crown className="h-3.5 w-3.5 text-rose-500" /> Owner flag
                                    </div>
                                    <div className="text-[11px] text-slate-500">
                                        {canEditOwnerToggle
                                            ? "Bypasses all permission checks"
                                            : "Only an existing OWNER may change this"}
                                    </div>
                                </div>
                                <Switch
                                    checked={form.is_owner}
                                    onCheckedChange={(v) => update({ is_owner: v })}
                                    disabled={!canEditOwnerToggle}
                                />
                            </label>
                        </div>
                    </section>

                    {/* Role */}
                    <section className={cn(
                        "rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 overflow-hidden",
                    )}>
                        <div className={cn("-m-6 mb-4 h-1.5 bg-gradient-to-r", palette.stripe)} />
                        <header className="mb-4 mt-2 flex items-center gap-2">
                            <div className={cn("grid h-9 w-9 place-items-center rounded-2xl", palette.bg, palette.text)}>
                                <Shield className="h-4 w-4" />
                            </div>
                            <div>
                                <h3 className="font-display text-sm font-bold text-slate-900">Base role</h3>
                                <p className="text-[11px] text-slate-500">
                                    Sets the baseline permission tier. Pick one card.
                                </p>
                            </div>
                        </header>

                        {rolesQuery.isLoading ? (
                            <div className="flex items-center justify-center p-8 text-xs text-slate-500">
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading roles…
                            </div>
                        ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                                {roles.map((r) => (
                                    <RoleCard
                                        key={r.id}
                                        role={r}
                                        selected={form.role_id === r.id}
                                        onSelect={() => update({ role_id: r.id })}
                                        disabled={!canManage}
                                    />
                                ))}
                            </div>
                        )}

                        {selectedRole ? (
                            <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                                <summary className="cursor-pointer text-xs font-bold text-slate-700">
                                    Base permissions inherited from {getCanonicalRoleLabel(selectedRole.code, selectedRole.name)}
                                    {" "}
                                    <span className="font-mono text-slate-500">
                                        ({hasWildcard ? "ALL (*)" : `${selectedRole.default_permissions?.length || 0}`})
                                    </span>
                                </summary>
                                <div className="mt-3 flex flex-wrap gap-1.5">
                                    {hasWildcard ? (
                                        <Badge className="bg-rose-100 text-rose-800 ring-1 ring-rose-200">
                                            Full access (*)
                                        </Badge>
                                    ) : (
                                        (selectedRole.default_permissions || []).map((p) => (
                                            <code
                                                key={p}
                                                className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-700 ring-1 ring-slate-200"
                                            >
                                                {p}
                                            </code>
                                        ))
                                    )}
                                </div>
                            </details>
                        ) : null}
                    </section>

                    {/* Overrides */}
                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                        <div className="-m-6 mb-4 h-1.5 bg-gradient-to-r from-amber-400 to-amber-500" />
                        <header className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-amber-50 text-amber-700">
                                    <Sparkles className="h-4 w-4" />
                                </div>
                                <div>
                                    <h3 className="font-display text-sm font-bold text-slate-900">
                                        Permission overrides
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        Use sparingly — prefer changing the role if many users need it.
                                    </p>
                                </div>
                            </div>
                            <Badge className="bg-amber-100 text-amber-800 ring-1 ring-amber-200">
                                {form.extra_permissions.length} override{form.extra_permissions.length === 1 ? "" : "s"} added
                            </Badge>
                        </header>

                        {hasWildcard ? (
                            <div className="rounded-2xl border border-dashed border-rose-200 bg-rose-50/40 p-4 text-xs text-rose-800">
                                <Info className="mr-1.5 inline h-3.5 w-3.5" />
                                This role already grants <b>full access (*)</b>. Overrides are unnecessary.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {MODULE_ORDER.filter((m) => grouped.has(m.key)).map((mod) => {
                                    const entries = grouped.get(mod.key) || []
                                    return (
                                        <div
                                            key={mod.key}
                                            className="rounded-2xl border border-slate-200 bg-slate-50/30 p-4"
                                        >
                                            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                                {mod.label}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {entries.map((e) => {
                                                    const fromRole = basePermissions.has(e.permission)
                                                    const isOverride = overrideSet.has(e.permission)
                                                    if (fromRole) {
                                                        return (
                                                            <span
                                                                key={e.permission}
                                                                title={`Granted by ${selectedRole?.code || "role"}`}
                                                                className="cursor-default rounded-md bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-500 ring-1 ring-slate-200"
                                                            >
                                                                {e.permission} · via role
                                                            </span>
                                                        )
                                                    }
                                                    return (
                                                        <button
                                                            key={e.permission}
                                                            type="button"
                                                            onClick={() => canManage && togglePermission(e.permission)}
                                                            disabled={!canManage}
                                                            className={cn(
                                                                "rounded-md px-2 py-1 font-mono text-[10px] ring-1 transition",
                                                                isOverride
                                                                    ? "bg-emerald-100 text-emerald-800 ring-emerald-200 hover:bg-emerald-200/70"
                                                                    : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                                                !canManage && "cursor-not-allowed opacity-60",
                                                            )}
                                                        >
                                                            {isOverride ? (
                                                                <Check className="-ml-0.5 mr-1 inline h-3 w-3" />
                                                            ) : null}
                                                            {e.permission}
                                                        </button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </section>
                </div>

                {/* RIGHT COLUMN (sticky) */}
                <div className="space-y-6">
                    <div className="lg:sticky lg:top-4 space-y-6">
                        {/* Effective permissions */}
                        <section className="rounded-3xl bg-gradient-to-br from-slate-50 to-indigo-50 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                            <header className="mb-3 flex items-center gap-2">
                                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-indigo-100 text-indigo-700">
                                    <ShieldCheck className="h-4 w-4" />
                                </div>
                                <div>
                                    <h3 className="font-display text-sm font-bold text-slate-900">
                                        Effective permissions
                                    </h3>
                                    <p className="text-[11px] text-slate-500">
                                        Union of role + overrides
                                    </p>
                                </div>
                            </header>
                            <div className="mb-3 flex items-center justify-between">
                                <Badge className="bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200">
                                    {hasWildcard ? "ALL" : effectivePermissions.size} permission{effectivePermissions.size === 1 ? "" : "s"}
                                </Badge>
                                <span className="font-mono text-[10px] text-slate-500">
                                    {hasWildcard ? "wildcard" : "computed"}
                                </span>
                            </div>

                            {hasWildcard ? (
                                <p className="text-xs text-slate-700">
                                    This user holds <b>full access (*)</b> through their role.
                                </p>
                            ) : (
                                <Tabs defaultValue={MODULE_ORDER[0].key}>
                                    <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                                        {MODULE_ORDER.filter((m) =>
                                            Array.from(effectivePermissions).some((p) =>
                                                p.startsWith(`${m.key}.`),
                                            ),
                                        ).map((m) => (
                                            <TabsTrigger
                                                key={m.key}
                                                value={m.key}
                                                className="rounded-full bg-white px-3 py-1 text-[10px] font-bold ring-1 ring-slate-200 data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                                            >
                                                {m.label}
                                            </TabsTrigger>
                                        ))}
                                    </TabsList>
                                    {MODULE_ORDER.map((m) => {
                                        const inMod = Array.from(effectivePermissions).filter((p) =>
                                            p.startsWith(`${m.key}.`),
                                        )
                                        if (inMod.length === 0) return null
                                        return (
                                            <TabsContent key={m.key} value={m.key} className="mt-3 space-y-1.5">
                                                {inMod.sort().map((p) => {
                                                    const fromRole = basePermissions.has(p)
                                                    return (
                                                        <div
                                                            key={p}
                                                            className="flex items-center justify-between rounded-md bg-white px-2 py-1 ring-1 ring-slate-200"
                                                        >
                                                            <code className="font-mono text-[10px] text-slate-800">
                                                                {p}
                                                            </code>
                                                            <span
                                                                className={cn(
                                                                    "rounded px-1.5 py-0.5 text-[9px] font-bold",
                                                                    fromRole
                                                                        ? "bg-slate-100 text-slate-600"
                                                                        : "bg-emerald-100 text-emerald-700",
                                                                )}
                                                            >
                                                                {fromRole ? "ROLE" : "OVERRIDE"}
                                                            </span>
                                                        </div>
                                                    )
                                                })}
                                            </TabsContent>
                                        )
                                    })}
                                </Tabs>
                            )}
                        </section>

                        {/* Save bar */}
                        <section className="rounded-3xl bg-white p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
                                <span>{pendingDirty > 0 ? `${pendingDirty} pending changes` : "All changes saved"}</span>
                                {pendingDirty > 0 ? (
                                    <span className="font-bold text-amber-600">●</span>
                                ) : (
                                    <span className="font-bold text-emerald-600">●</span>
                                )}
                            </div>
                            <Button
                                onClick={onSubmit}
                                disabled={!canManage || isPending}
                                className="w-full bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                                {isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="mr-2 h-4 w-4" />
                                )}
                                {mode === "new" ? "Create user" : "Save changes"}
                            </Button>
                            <Link href="/system/users" className="mt-2 block">
                                <Button variant="ghost" className="w-full text-slate-500">
                                    Cancel
                                </Button>
                            </Link>
                            <div className="mt-3 text-[10px] text-slate-400">
                                <Link
                                    href="/help?topic=roles"
                                    className="font-bold text-indigo-600 hover:underline"
                                >
                                    Role reference →
                                </Link>
                            </div>
                        </section>
                    </div>
                </div>
            </div>

            {/* Password dialog */}
            <Dialog open={pwDialogOpen} onOpenChange={setPwDialogOpen}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Reset password</DialogTitle>
                        <DialogDescription>
                            User will need to log in again with the new password.
                        </DialogDescription>
                    </DialogHeader>
                    <PasswordResetBody
                        loading={passwordMut.isPending}
                        onSubmit={(pw) => passwordMut.mutate(pw)}
                    />
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Sub-components

function RoleCard({
    role,
    selected,
    onSelect,
    disabled,
}: {
    role: Role
    selected: boolean
    onSelect: () => void
    disabled?: boolean
}) {
    const palette = paletteFor(role.code)
    const count = role.default_permissions?.length || 0
    const wildcard = role.default_permissions?.includes("*")
    const label = getCanonicalRoleLabel(role.code, role.name)

    return (
        <button
            type="button"
            onClick={onSelect}
            disabled={disabled}
            className={cn(
                "group relative overflow-hidden rounded-2xl border bg-white p-4 text-left transition",
                selected
                    ? cn("border-transparent ring-2", palette.ring, "shadow-[0_10px_30px_-15px_rgba(15,23,42,0.25)]")
                    : "border-slate-200 hover:border-slate-300",
                disabled && "cursor-not-allowed opacity-60",
            )}
        >
            <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", palette.stripe)} />
            <div className="flex items-start justify-between">
                <div>
                    <div className="font-display text-sm font-bold text-slate-900">{label}</div>
                    <div className="font-mono text-[10px] text-slate-500">{role.code}</div>
                </div>
                {selected ? (
                    <div className={cn("grid h-6 w-6 place-items-center rounded-full ring-2", palette.ring, palette.bg, palette.text)}>
                        <Check className="h-3 w-3" />
                    </div>
                ) : (
                    <div className="h-6 w-6 rounded-full border-2 border-slate-200" />
                )}
            </div>
            <p className="mt-2 line-clamp-2 text-[11px] text-slate-600">
                {role.description || "—"}
            </p>
            <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
                <Badge className={cn(palette.bg, palette.text, "ring-1", palette.ring)}>
                    {wildcard ? "Full access" : `${count} perms`}
                </Badge>
            </div>
        </button>
    )
}

function PasswordResetBody({
    onSubmit,
    loading,
}: {
    onSubmit: (pw: string) => void
    loading: boolean
}) {
    const [pw, setPw] = React.useState("")
    return (
        <>
            <div className="mt-2">
                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                    New password
                </Label>
                <PasswordInput
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="At least 8 characters"
                    className="mt-1.5"
                />
            </div>
            <DialogFooter>
                <Button
                    type="button"
                    onClick={() => pw.length >= 8 && onSubmit(pw)}
                    disabled={loading || pw.length < 8}
                    className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                    Reset password
                </Button>
            </DialogFooter>
        </>
    )
}

function Field({
    label,
    children,
    className = "",
}: {
    label: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={className}>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                {label}
            </Label>
            <div className="mt-1.5">{children}</div>
        </div>
    )
}
