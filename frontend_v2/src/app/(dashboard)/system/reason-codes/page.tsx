"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CornerDownRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  Tags,
  Trash2,
  X,
} from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { describeApiError } from "@/lib/api"
import {
  groupReasonCodes,
  reasonCodesService,
  type ReasonCode,
  type ReasonCodeKind,
} from "@/services/reason-codes"

const KIND_META: Record<ReasonCodeKind, { title: string; accent: string; subtitle: string }> = {
  scrap: {
    title: "Scrap reasons",
    accent: "rose",
    subtitle: "Why material was scrapped during a step.",
  },
  downtime: {
    title: "Downtime reasons",
    accent: "amber",
    subtitle: "Why a machine stopped running.",
  },
}

interface DraftState {
  code: string
  label: string
  sort_order: string
  parent_id: string | null
}

const EMPTY_DRAFT: DraftState = { code: "", label: "", sort_order: "0", parent_id: null }

function queryKeyFor(kind: ReasonCodeKind) {
  return ["reason-codes", kind] as const
}

function AddReasonForm({
  kind,
  parentId,
  parentCode,
  onDone,
}: {
  kind: ReasonCodeKind
  parentId: string | null
  parentCode?: string | null
  onDone: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DraftState>({ ...EMPTY_DRAFT, parent_id: parentId })

  const createMutation = useMutation({
    mutationFn: () =>
      reasonCodesService.create(kind, {
        code: draft.code.trim(),
        label: draft.label.trim(),
        parent_id: parentId,
        sort_order: Number(draft.sort_order || 0),
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyFor(kind) })
      toast({ title: "Reason added", description: `${draft.code.trim()} created.` })
      setDraft({ ...EMPTY_DRAFT, parent_id: parentId })
      onDone()
    },
    onError: (error) => {
      toast({ title: "Could not add reason", description: describeApiError(error), variant: "destructive" })
    },
  })

  const canSubmit = draft.code.trim().length > 0 && draft.label.trim().length > 0 && !createMutation.isPending

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line-strong bg-slate-50/70 p-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Code</label>
        <Input
          value={draft.code}
          onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value.toUpperCase() }))}
          placeholder={parentCode ? `${parentCode}_SUB` : "REASON_CODE"}
          className="font-mono"
        />
      </div>
      <div className="flex-[2]">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Label</label>
        <Input
          value={draft.label}
          onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
          placeholder="Human-readable description"
        />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Sort</label>
        <Input
          type="number"
          value={draft.sort_order}
          onChange={(event) => setDraft((prev) => ({ ...prev, sort_order: event.target.value }))}
          className="font-mono tabular-nums"
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => createMutation.mutate()} disabled={!canSubmit}>
          {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {parentId ? "Add sub-code" : "Add"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          <X className="size-4" /> Cancel
        </Button>
      </div>
    </div>
  )
}

function ReasonRow({
  kind,
  row,
  isChild,
}: {
  kind: ReasonCodeKind
  row: ReasonCode
  isChild?: boolean
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(row.label)
  const [sortOrder, setSortOrder] = useState(String(row.sort_order))

  const updateMutation = useMutation({
    mutationFn: (payload: { label?: string; sort_order?: number; is_active?: boolean }) =>
      reasonCodesService.update(kind, row.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyFor(kind) })
    },
    onError: (error) => {
      toast({ title: "Update failed", description: describeApiError(error), variant: "destructive" })
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => reasonCodesService.remove(kind, row.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeyFor(kind) })
      toast({ title: "Reason removed", description: `${row.code} deleted.` })
    },
    onError: (error) => {
      toast({ title: "Delete failed", description: describeApiError(error), variant: "destructive" })
    },
  })

  const saveEdit = () => {
    updateMutation.mutate(
      { label: label.trim(), sort_order: Number(sortOrder || 0) },
      {
        onSuccess: () => {
          setEditing(false)
          toast({ title: "Saved", description: `${row.code} updated.` })
        },
      }
    )
  }

  const cancelEdit = () => {
    setLabel(row.label)
    setSortOrder(String(row.sort_order))
    setEditing(false)
  }

  return (
    <div
      className={cnRow(isChild, row.is_active)}
      data-testid={`reason-row-${row.code}`}
    >
      {isChild ? <CornerDownRight className="mt-0.5 size-3.5 shrink-0 text-slate-300" /> : null}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700">{row.code}</code>
          {!row.is_active ? (
            <Badge variant="secondary" className="uppercase">Inactive</Badge>
          ) : null}
          {row.parent_code && !isChild ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-content-4">↳ {row.parent_code}</span>
          ) : null}
        </div>
        {editing ? (
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="mt-1.5 h-8"
            autoFocus
          />
        ) : (
          <div className="mt-0.5 truncate text-sm font-semibold text-content-2">{row.label || "—"}</div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {editing ? (
          <Input
            type="number"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            className="h-8 w-16 font-mono tabular-nums"
            aria-label="Sort order"
          />
        ) : (
          <span className="hidden font-mono text-xs tabular-nums text-content-4 sm:inline">#{row.sort_order}</span>
        )}

        {editing ? (
          <>
            <Button type="button" size="sm" onClick={saveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancelEdit}>
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5 pr-1">
              <Switch
                checked={row.is_active}
                onCheckedChange={(checked) =>
                  updateMutation.mutate(
                    { is_active: checked },
                    {
                      onSuccess: () =>
                        toast({
                          title: checked ? "Activated" : "Deactivated",
                          description: `${row.code} ${checked ? "enabled" : "disabled"}.`,
                        }),
                    }
                  )
                }
                aria-label={row.is_active ? "Deactivate reason" : "Activate reason"}
              />
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit reason">
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-rose-600 hover:bg-danger-bg hover:text-danger-fg"
              onClick={() => {
                if (window.confirm(`Delete reason "${row.code}"? Existing logs keep their stored reason text.`)) {
                  removeMutation.mutate()
                }
              }}
              disabled={removeMutation.isPending}
              aria-label="Delete reason"
            >
              {removeMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function cnRow(isChild?: boolean, active?: boolean) {
  return [
    "flex items-start gap-2 rounded-2xl border px-3 py-2.5 transition-colors",
    isChild ? "ml-6 border-slate-100 bg-slate-50/60" : "border-slate-200 bg-surface-1",
    active ? "" : "opacity-60",
  ].join(" ")
}

function ReasonCodeTab({ kind }: { kind: ReasonCodeKind }) {
  const meta = KIND_META[kind]
  const [addingTopLevel, setAddingTopLevel] = useState(false)
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: queryKeyFor(kind),
    queryFn: () => reasonCodesService.list(kind, { include_inactive: true }),
  })

  const groups = useMemo(() => groupReasonCodes(data ?? []), [data])
  const total = data?.length ?? 0
  const activeCount = (data ?? []).filter((row) => row.is_active).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono tabular-nums">{total} codes</Badge>
          <Badge variant="default" className="font-mono tabular-nums">{activeCount} active</Badge>
          <span className="text-xs text-slate-500">{meta.subtitle}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? "size-4 animate-spin" : "size-4"} /> Refresh
          </Button>
          <Button type="button" size="sm" onClick={() => setAddingTopLevel((prev) => !prev)}>
            <Plus className="size-4" /> New reason
          </Button>
        </div>
      </div>

      {addingTopLevel ? (
        <AddReasonForm kind={kind} parentId={null} onDone={() => setAddingTopLevel(false)} />
      ) : null}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-surface-1 py-12 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" /> Loading {meta.title.toLowerCase()}…
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-danger-border bg-danger-bg p-6 text-center">
          <AlertTriangle className="mx-auto mb-2 size-6 text-rose-600" />
          <div className="text-sm font-semibold text-rose-900">Failed to load reasons</div>
          <div className="mt-1 text-xs text-danger-fg">{describeApiError(error)}</div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="size-4" /> Try again
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-slate-50 p-10 text-center">
          <Tags className="mx-auto mb-2 size-7 text-slate-300" />
          <div className="font-display text-sm font-bold text-slate-700">No {meta.title.toLowerCase()} yet</div>
          <p className="mt-1 text-xs text-slate-500">Add your first reason code to get started.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.parent.id} className="space-y-2">
              <ReasonRow kind={kind} row={group.parent} />
              {group.children.map((child) => (
                <ReasonRow key={child.id} kind={kind} row={child} isChild />
              ))}
              {addingSubFor === group.parent.id ? (
                <div className="ml-6">
                  <AddReasonForm
                    kind={kind}
                    parentId={group.parent.id}
                    parentCode={group.parent.code}
                    onDone={() => setAddingSubFor(null)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingSubFor(group.parent.id)}
                  className="ml-6 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-700"
                >
                  <Plus className="size-3.5" /> Add sub-code under {group.parent.code}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ReasonCodesPage() {
  const { user, effectiveRole, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<ReasonCodeKind>("scrap")

  const roleCode = String(effectiveRole || user?.role_info?.code || "").toUpperCase()
  const permissions = (user?.entitlements?.permissions || []) as string[]
  const canManage =
    Boolean(user?.is_owner || user?.is_superuser) ||
    ["OWNER", "ADMIN", "SUPER_ADMIN"].includes(roleCode) ||
    permissions.includes("production.manage")

  if (!authLoading && user && !canManage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6" data-testid="reason-codes-access-denied">
        <div className="max-w-md rounded-3xl border border-danger-border bg-danger-bg p-8 text-center shadow-sm ring-1 ring-rose-100/60">
          <ShieldOff className="mx-auto mb-3 size-10 text-rose-600" />
          <h2 className="font-display text-lg font-bold text-rose-900">Access denied</h2>
          <p className="mt-1 text-sm text-danger-fg">
            Your role ({roleCode || "n/a"}) needs <code className="font-mono">production.manage</code> (OWNER or ADMIN) to
            manage scrap and downtime reason codes.
          </p>
          <Button asChild variant="destructive" className="mt-4">
            <Link href="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Gradient hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-6 text-white shadow-lg ring-1 ring-white/10 lg:p-8">
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 size-48 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-blue-100">
              <Tags className="size-3" /> Production · Reason Codes
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Scrap &amp; Downtime Reasons</h1>
            <p className="max-w-xl text-sm text-blue-100/80">
              Maintain the controlled vocabulary operators choose from when logging scrap or machine downtime. Group
              detailed sub-codes under broad parents and control their order and availability.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-blue-100/70">
            <ChevronRight className="size-3.5" />
            <Link href="/system" className="font-semibold underline-offset-4 hover:underline">
              System
            </Link>
          </div>
        </div>
      </div>

      <Card className="mt-6 rounded-3xl ring-1 ring-slate-100/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Reason library</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(value) => setTab(value as ReasonCodeKind)}>
            <TabsList className="grid w-full max-w-md grid-cols-2 rounded-2xl">
              <TabsTrigger value="scrap" className="rounded-xl data-[state=active]:bg-danger-bg data-[state=active]:text-danger-fg">
                Scrap reasons
              </TabsTrigger>
              <TabsTrigger value="downtime" className="rounded-xl data-[state=active]:bg-warning-bg data-[state=active]:text-warning-fg">
                Downtime reasons
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scrap" className="mt-5">
              <ReasonCodeTab kind="scrap" />
            </TabsContent>
            <TabsContent value="downtime" className="mt-5">
              <ReasonCodeTab kind="downtime" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
