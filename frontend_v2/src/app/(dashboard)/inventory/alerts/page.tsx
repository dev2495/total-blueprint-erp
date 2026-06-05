"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { AlertTriangle, CheckCircle2, RefreshCw, Search, ShieldAlert, Siren, TimerReset } from "lucide-react"

import { ChartSurface } from "@/components/ui-custom/chart-surface"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { observabilityApi, type InventoryAlert } from "@/services/observability"
import { getSemanticMeta, humanizeToken } from "@/lib/visual-semantics"

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function AlertsCenterPage() {
  const [alerts, setAlerts] = useState<InventoryAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterResolved, setFilterResolved] = useState<boolean | undefined>(false)
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [selectedAlert, setSelectedAlert] = useState<InventoryAlert | null>(null)
  const [resolutionNote, setResolutionNote] = useState("")

  const loadAlerts = async () => {
    try {
      setLoading(true)
      const data = await observabilityApi.getAlerts({ resolved: filterResolved })
      setAlerts(data)
    } catch (error) {
      console.error("Failed to load alerts:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAlerts()
  }, [filterResolved])

  const handleResolve = async () => {
    if (!selectedAlert) return
    try {
      await observabilityApi.resolveAlert(selectedAlert.id, resolutionNote)
      setResolveDialogOpen(false)
      setResolutionNote("")
      setSelectedAlert(null)
      await loadAlerts()
    } catch (error) {
      console.error("Failed to resolve alert:", error)
    }
  }

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((alert) =>
        [
          alert.message,
          alert.type_display,
          alert.material_code || "",
          alert.roll_label || "",
          alert.plant_name || "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(searchTerm.toLowerCase()),
      ),
    [alerts, searchTerm],
  )

  const openAlerts = filteredAlerts.filter((alert) => !alert.resolved)
  const resolvedAlerts = filteredAlerts.filter((alert) => alert.resolved)
  const criticalCount = openAlerts.filter((alert) => String(alert.severity).toUpperCase() === "CRITICAL").length
  const severityRows = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((severity) => ({
    severity,
    count: filteredAlerts.filter((alert) => String(alert.severity).toUpperCase() === severity).length,
    color: getSemanticMeta("severity", severity).chartColor,
  }))
  const alertTypeRows = Array.from(
    filteredAlerts.reduce((accumulator, alert) => {
      const label = alert.type_display || humanizeToken(alert.type)
      accumulator.set(label, (accumulator.get(label) || 0) + 1)
      return accumulator
    }, new Map<string, number>()),
  )
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6)

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-40 rounded-[2rem]" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-[1.75rem]" />
          ))}
        </div>
        <Skeleton className="h-[420px] rounded-[2rem]" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <section className="relative overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 p-6 shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-r from-rose-500/12 via-amber-400/10 to-sky-400/10" />
        <div className="pointer-events-none absolute -right-10 -top-8 h-36 w-36 rounded-full bg-rose-500/10 blur-3xl" />
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-rose-50/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-danger-fg">
              <ShieldAlert className="h-3.5 w-3.5" />
              Inventory Alert Console
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-900">Alerts Center</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-slate-500">
                One place to triage stock anomalies, close alert loops, and see which plants or materials are carrying unresolved risk.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[280px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
              <Input
                placeholder="Search alert, material, roll, or plant"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="h-12 rounded-2xl border-slate-200 bg-white/90 pl-10 shadow-sm"
              />
            </div>
            <Button variant={filterResolved === false ? "default" : "outline"} className="rounded-xl" onClick={() => setFilterResolved(false)}>
              Open
            </Button>
            <Button variant={filterResolved === true ? "default" : "outline"} className="rounded-xl" onClick={() => setFilterResolved(true)}>
              Resolved
            </Button>
            <Button variant={filterResolved === undefined ? "default" : "outline"} className="rounded-xl" onClick={() => setFilterResolved(undefined)}>
              All
            </Button>
            <Button variant="outline" className="rounded-xl border-slate-200 bg-white/90 shadow-sm" onClick={loadAlerts}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryStatCard label="Open alerts" value={openAlerts.length.toLocaleString()} subLabel="Alerts still needing action" icon={Siren} toneClassName="bg-danger-bg text-danger-fg" />
        <SummaryStatCard label="Critical now" value={criticalCount.toLocaleString()} subLabel="Highest-severity unresolved alerts" icon={AlertTriangle} toneClassName="bg-orange-50 text-orange-700" />
        <SummaryStatCard label="Resolved in view" value={resolvedAlerts.length.toLocaleString()} subLabel="Closed alerts within the current filter" icon={CheckCircle2} toneClassName="bg-success-bg text-success-fg" />
        <SummaryStatCard label="Current filter" value={filterResolved === false ? "Open" : filterResolved === true ? "Resolved" : "All"} subLabel={`${filteredAlerts.length.toLocaleString()} alert rows visible`} icon={TimerReset} toneClassName="bg-blue-50 text-blue-700" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100/80 bg-white/70">
            <CardTitle className="text-lg font-black tracking-tight text-slate-900">Severity mix</CardTitle>
            <p className="text-sm text-slate-500">If critical or high bars stay elevated, the store and planning teams need intervention.</p>
          </CardHeader>
          <CardContent className="p-6">
            <ChartSurface className="min-h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityRows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="severity" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="count" radius={[10, 10, 0, 0]}>
                    {severityRows.map((row) => (
                      <Cell key={row.severity} fill={row.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartSurface>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <CardHeader className="border-b border-slate-100/80 bg-white/70">
            <CardTitle className="text-lg font-black tracking-tight text-slate-900">Top alert families</CardTitle>
            <p className="text-sm text-slate-500">Most frequent alert categories in the current filter window.</p>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {alertTypeRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-500">
                No alert families to chart yet.
              </div>
            ) : (
              alertTypeRows.map((row, index) => (
                <div key={row.type} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{row.type}</div>
                      <div className="mt-1 text-xs text-slate-500">Rank #{index + 1}</div>
                    </div>
                    <div className="text-2xl font-black tracking-tight text-slate-900">{row.count}</div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
        <CardHeader className="border-b border-slate-100/80 bg-white/70">
          <CardTitle className="text-lg font-black tracking-tight text-slate-900">Alert queue</CardTitle>
          <p className="text-sm text-slate-500">Current anomalies with severity, location context, and clear resolve actions.</p>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          {filteredAlerts.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-success-border bg-emerald-50/70 p-10 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <div className="mt-4 text-base font-black tracking-tight text-slate-900">No alerts found</div>
              <div className="mt-1 text-sm text-slate-500">The current filter window is clean. Switch to All if you want to review historical closes.</div>
            </div>
          ) : (
            filteredAlerts.map((alert) => (
              <div key={alert.id} className={`rounded-[1.5rem] border p-5 transition-colors ${alert.resolved ? "border-slate-200 bg-slate-50/70" : "border-slate-200 bg-surface-1 hover:bg-blue-50/20"}`}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <SemanticBadge kind="severity" value={alert.severity} />
                      <SemanticBadge value={alert.resolved ? "APPROVED" : "REVIEW"} label={alert.resolved ? "Resolved" : "Needs action"} />
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-content-4">{alert.type_display}</div>
                    </div>
                    <div>
                      <div className="text-base font-black tracking-tight text-slate-900">{alert.message}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500">
                        {alert.material_code ? <span>Material: <strong className="text-slate-700">{alert.material_code}</strong></span> : null}
                        {alert.roll_label ? <span>Roll: <strong className="text-slate-700">{alert.roll_label}</strong></span> : null}
                        {alert.plant_name ? <span>Plant: <strong className="text-slate-700">{alert.plant_name}</strong></span> : null}
                        <span>{formatDate(alert.created_at)}</span>
                      </div>
                      {alert.resolved && (
                        <div className="mt-3 rounded-xl border border-success-border bg-emerald-50/80 px-3 py-2 text-xs text-success-fg">
                          Resolved by <span className="font-black">{alert.resolved_by_name || "ERP user"}</span>
                          {alert.resolved_at ? ` on ${formatDate(alert.resolved_at)}` : ""}
                          {alert.resolution_note ? ` • ${alert.resolution_note}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                  {!alert.resolved ? (
                    <Button
                      variant="outline"
                      className="rounded-xl border-slate-200 bg-white/90 shadow-sm"
                      onClick={() => {
                        setSelectedAlert(alert)
                        setResolveDialogOpen(true)
                      }}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent className="rounded-[1.75rem] border-white/70 bg-white/95 shadow-[0_24px_70px_-45px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle>Resolve alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-content-4">Alert</div>
              <div className="mt-1 text-sm font-bold text-slate-900">{selectedAlert?.type_display || "Inventory alert"}</div>
              <div className="mt-2 text-sm text-content-3">{selectedAlert?.message || "Choose an alert from the queue."}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="resolution-note">Resolution note</Label>
              <Textarea
                id="resolution-note"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                placeholder="Document what was checked or corrected."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleResolve()}>Mark resolved</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
