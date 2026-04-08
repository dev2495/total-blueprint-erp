"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Archive, BellRing, Download, FileText, RefreshCw, ShieldCheck, Sparkles } from "lucide-react"

import { analyticsApi, type ReportDispatchRun, type ReportDistributionProfile } from "@/services/analytics"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { getApiErrorStatus } from "@/lib/api"

function formatTimestamp(value?: string | null) {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function statusTone(status: string) {
  if (status === "SUCCEEDED") return "border-emerald-200 bg-emerald-50 text-emerald-700"
  if (status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700"
  return "border-amber-200 bg-amber-50 text-amber-700"
}

export function ReportAdminCenter() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [draftProfiles, setDraftProfiles] = useState<Record<string, ReportDistributionProfile>>({})

  const profilesQuery = useQuery({
    queryKey: ["report-center-distributions"],
    queryFn: analyticsApi.getReportDistributions,
    retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
  })
  const runsQuery = useQuery({
    queryKey: ["report-center-runs"],
    queryFn: () => analyticsApi.getReportRuns(80, 45),
    retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
    refetchInterval: 60_000,
  })

  const profiles = profilesQuery.data ?? []
  const runs = runsQuery.data ?? []
  const accessDenied =
    getApiErrorStatus(profilesQuery.error) === 403 || getApiErrorStatus(runsQuery.error) === 403

  useEffect(() => {
    const next: Record<string, ReportDistributionProfile> = {}
    for (const profile of profiles) {
      next[profile.report_code] = { ...profile }
    }
    setDraftProfiles(next)
  }, [profiles])

  const saveMutation = useMutation({
    mutationFn: async () => analyticsApi.updateReportDistributions(Object.values(draftProfiles)),
    onSuccess: () => {
      toast({ title: "Report center saved", description: "Daily archive generation states were updated." })
      queryClient.invalidateQueries({ queryKey: ["report-center-distributions"] })
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Could not save report center",
        description: error?.response?.data?.detail || error?.message || "Save failed.",
      })
    },
  })

  const generateMutation = useMutation({
    mutationFn: async (reportCode: string) => analyticsApi.sendReportDistribution(reportCode),
    onSuccess: (_run, reportCode) => {
      toast({
        title: "Daily pack generated",
        description: `${reportCode.replaceAll("_", " ")} was archived and owner/admin were notified in-app.`,
      })
      queryClient.invalidateQueries({ queryKey: ["report-center-runs"] })
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Could not generate report pack",
        description: error?.response?.data?.detail || error?.message || "Generation failed.",
      })
    },
  })

  const latestRunByCode = useMemo(() => {
    const map = new Map<string, ReportDispatchRun>()
    for (const run of runs) {
      if (!map.has(run.report_code)) map.set(run.report_code, run)
    }
    return map
  }, [runs])

  const totals = useMemo(() => {
    const activeProfiles = Object.values(draftProfiles).filter((profile) => profile.active)
    const successfulRuns = runs.filter((run) => run.status === "SUCCEEDED")
    const pdfBytes = successfulRuns.reduce((sum, run) => sum + Number(run.pdf_size_bytes || 0), 0)
    return {
      activePacks: activeProfiles.length,
      archivedRuns: runs.length,
      archivedSizeMb: pdfBytes / (1024 * 1024),
      successfulRuns: successfulRuns.length,
    }
  }, [draftProfiles, runs])

  const updateProfile = (reportCode: string, patch: Partial<ReportDistributionProfile>) => {
    setDraftProfiles((prev) => ({
      ...prev,
      [reportCode]: {
        ...prev[reportCode],
        ...patch,
      },
    }))
  }

  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.16),_transparent_24%),linear-gradient(180deg,#f8fbff_0%,#f7f5ef_100%)] p-6">
        <Card className="mx-auto max-w-3xl rounded-[2rem] border-white/10 bg-white/95 shadow-[0_30px_80px_-40px_rgba(15,23,42,0.6)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-2xl font-black text-slate-900">
              <ShieldCheck className="h-6 w-6 text-indigo-600" />
              Report Center Restricted
            </CardTitle>
            <CardDescription>
              Daily archives and generation logs are available only to report admins.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.16),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(20,184,166,0.12),_transparent_20%),linear-gradient(180deg,#f8fbff_0%,#f7f5ef_100%)] p-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="rounded-[2.2rem] border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#eef5ff_48%,#ecfeff_100%)] p-6 shadow-[0_35px_90px_-52px_rgba(15,23,42,0.22)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.34em] text-sky-700">Administration</div>
              <h1 className="mt-3 text-4xl font-black tracking-[-0.05em] text-slate-950">Report Center</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Daily report packs are generated here, archived for audit, and announced to owner/admin in the in-app notification tray.
                Email delivery and per-pack scheduling are intentionally removed from the workflow.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="rounded-full border-slate-200 bg-white/90 text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  profilesQuery.refetch()
                  runsQuery.refetch()
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh archive
              </Button>
              <Button
                className="rounded-full bg-slate-950 text-white hover:bg-slate-800"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                {saveMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save active packs
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Active daily packs" value={String(totals.activePacks)} sublabel="Included in the next daily archive cycle" />
            <MetricTile label="Successful archives" value={String(totals.successfulRuns)} sublabel="Runs stored and ready for review" />
            <MetricTile label="Archive shelf" value={String(totals.archivedRuns)} sublabel="Recent generated runs retained for audit" />
            <MetricTile label="Stored PDF size" value={`${totals.archivedSizeMb.toFixed(1)} MB`} sublabel="Archive footprint across the recent window" />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_430px]">
          <section className="rounded-[2rem] border border-slate-200 bg-white/95 p-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Daily packs</div>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-900">Generation controls</h2>
              </div>
              <Badge className="rounded-full border border-slate-200 bg-slate-50 text-slate-700">Owner/Admin inbox notice</Badge>
            </div>

            <div className="mt-5 grid max-h-[calc(100vh-20rem)] gap-4 overflow-y-auto pr-2">
              {(profiles.length ? profiles : Object.values(draftProfiles)).map((profile) => {
                const draft = draftProfiles[profile.report_code] || profile
                const latestRun = latestRunByCode.get(profile.report_code)
                return (
                  <div key={profile.report_code} className="rounded-[1.7rem] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="rounded-full bg-sky-100 p-2 text-sky-700">
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-lg font-black tracking-[-0.03em] text-slate-900">{profile.label}</div>
                            <div className="text-sm text-slate-500">{profile.report_code.replaceAll("_", " ")}</div>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-3">
                          <InfoPill title="Inbox audience" value={(draft.target_roles || ["OWNER", "ADMIN"]).join(" · ")} />
                          <InfoPill title="Latest archive" value={latestRun ? formatTimestamp(latestRun.sent_at || latestRun.created_at) : "—"} />
                          <InfoPill title="Latest status" value={latestRun?.status || "No run yet"} />
                        </div>
                      </div>

                      <div className="w-full shrink-0 rounded-[1.5rem] border border-slate-200 bg-white p-4 xl:w-[280px]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Archive state</div>
                            <div className="mt-2 text-lg font-black text-slate-900">{draft.active ? "Active" : "Paused"}</div>
                          </div>
                          <Switch
                            checked={draft.active}
                            onCheckedChange={(checked) => updateProfile(profile.report_code, { active: checked })}
                          />
                        </div>
                        <div className="mt-4 rounded-[1rem] border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                          Generating a pack writes the PDF/detail files to archive and pushes a live inbox notification instead of sending email.
                        </div>
                        <Button
                          className="mt-4 w-full rounded-full bg-slate-950 text-white hover:bg-slate-800"
                          disabled={generateMutation.isPending}
                          onClick={() => generateMutation.mutate(profile.report_code)}
                        >
                          <Sparkles className="mr-2 h-4 w-4" />
                          Generate now
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white/95 p-5 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500">Archive shelf</div>
                  <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] text-slate-900">Recent generated packs</h2>
                </div>
                <Badge className="rounded-full border border-slate-200 bg-slate-50 text-slate-700">Last 45 days</Badge>
              </div>
              <div className="mt-5 h-[calc(100vh-20rem)] min-h-[520px] space-y-3 overflow-y-auto pr-4">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-[1.4rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-black capitalize text-slate-900">{run.report_code.replaceAll("_", " ")}</div>
                        <div className="mt-1 text-xs text-slate-500">{run.report_date}</div>
                      </div>
                      <Badge className={`rounded-full border ${statusTone(run.status)}`}>{run.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-600">
                      <div className="flex items-center gap-2">
                        <BellRing className="h-3.5 w-3.5" />
                        Audience: {(run.recipients || []).join(" · ") || "OWNER · ADMIN"}
                      </div>
                      <div className="flex items-center gap-2">
                        <Archive className="h-3.5 w-3.5" />
                        {formatTimestamp(run.sent_at || run.created_at)}
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5" />
                        {run.pdf_file_name || "PDF ready"}{run.pdf_size_bytes ? ` • ${(Number(run.pdf_size_bytes) / 1024).toFixed(0)} KB` : ""}
                      </div>
                      {run.warning_text ? <div className="text-amber-700">Warning: {run.warning_text}</div> : null}
                      {run.error_text ? <div className="text-rose-700">Error: {run.error_text}</div> : null}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button asChild size="sm" variant="outline" className="rounded-full">
                        <a href={analyticsApi.getReportRunPreviewUrl(run.id)} rel="noreferrer" target="_blank">
                          <FileText className="mr-2 h-4 w-4" />
                          Preview
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="rounded-full">
                        <a href={analyticsApi.getReportRunPdfDownloadUrl(run.id)} rel="noreferrer" target="_blank">
                          <Download className="mr-2 h-4 w-4" />
                          Download PDF
                        </a>
                      </Button>
                      {run.detail_file_name ? (
                        <Button asChild size="sm" variant="outline" className="rounded-full">
                          <a href={analyticsApi.getReportRunDetailUrl(run.id)} rel="noreferrer" target="_blank">
                            Detail workbook
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
                {!runs.length ? (
                  <div className="rounded-[1.6rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
                    No archived report packs yet.
                  </div>
                ) : null}
              </div>
            </section>

            <Card className="rounded-[2rem] border-slate-200 bg-white/95 shadow-[0_24px_70px_-42px_rgba(15,23,42,0.45)]">
              <CardHeader>
                <CardTitle className="text-lg font-black text-slate-900">Related admin surfaces</CardTitle>
                <CardDescription>Analytics stays in the workspace; this center handles archive generation and audit retrieval.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/analytics">Reports Hub</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/analytics/costing">Costing Center</Link>
                </Button>
                <Button asChild variant="outline" className="rounded-full">
                  <Link href="/dashboard/admin">System Health</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricTile({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-white/88 p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">{label}</div>
      <div className="mt-3 text-3xl font-black tracking-[-0.05em] text-slate-950">{value}</div>
      <div className="mt-2 text-xs text-slate-500">{sublabel}</div>
    </div>
  )
}

function InfoPill({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{title}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
