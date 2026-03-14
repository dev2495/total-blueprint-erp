"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Mail, RefreshCw, Send, Settings2 } from "lucide-react"

import { analyticsApi, type ReportDistributionProfile, type ReportDispatchRun } from "@/services/analytics"
import { useToast } from "@/hooks/use-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { getApiErrorStatus } from "@/lib/api"

function parseList(value: string) {
    return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
}

function formatTimestamp(value?: string | null) {
    if (!value) return "—"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleString()
}

function formatSchedule(profile: ReportDistributionProfile) {
    return `${String(profile.schedule_hour).padStart(2, "0")}:${String(profile.schedule_minute).padStart(2, "0")}`
}

export default function SettingsPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [draftProfiles, setDraftProfiles] = useState<Record<string, ReportDistributionProfile>>({})

    const profilesQuery = useQuery({
        queryKey: ["report-distributions"],
        queryFn: analyticsApi.getReportDistributions,
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
    })
    const runsQuery = useQuery({
        queryKey: ["report-runs", 10],
        queryFn: () => analyticsApi.getReportRuns(10),
        retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 3,
    })
    const profiles = profilesQuery.data ?? []
    const runs = runsQuery.data ?? []
    const profilesLoading = profilesQuery.isLoading
    const runsLoading = runsQuery.isLoading
    const refetchRuns = runsQuery.refetch
    const reportAccessDenied =
        getApiErrorStatus(profilesQuery.error) === 403 || getApiErrorStatus(runsQuery.error) === 403

    useEffect(() => {
        const next: Record<string, ReportDistributionProfile> = {}
        for (const profile of profiles) {
            next[profile.report_code] = {
                ...profile,
                target_roles: [...(profile.target_roles || [])],
                extra_recipients: [...(profile.extra_recipients || [])],
            }
        }
        setDraftProfiles(next)
    }, [profiles])

    const saveMutation = useMutation({
        mutationFn: async () => analyticsApi.updateReportDistributions(Object.values(draftProfiles)),
        onSuccess: () => {
            toast({ title: "Report settings saved", description: "Daily report schedules and recipients were updated." })
            queryClient.invalidateQueries({ queryKey: ["report-distributions"] })
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "Could not save report settings",
                description: error?.response?.data?.detail || error?.message || "Save failed.",
            })
        },
    })

    const sendMutation = useMutation({
        mutationFn: async (reportCode: string) => analyticsApi.sendReportDistribution(reportCode),
        onSuccess: (_run, reportCode) => {
            toast({ title: "Report send started", description: `${reportCode} was generated and dispatched.` })
            queryClient.invalidateQueries({ queryKey: ["report-runs"] })
        },
        onError: (error: any) => {
            toast({
                variant: "destructive",
                title: "Manual send failed",
                description: error?.response?.data?.detail || error?.message || "Send failed.",
            })
        },
    })

    const totals = useMemo(() => {
        const rows = Object.values(draftProfiles)
        return {
            active: rows.filter((row) => row.active).length,
            recipients: rows.reduce(
                (total, row) => total + (row.target_roles?.length || 0) + (row.extra_recipients?.length || 0),
                0
            ),
            successfulRuns: runs.filter((row) => row.status === "SUCCEEDED").length,
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

    return (
        <div className="min-h-screen bg-slate-50/40 p-6 space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-3xl font-black tracking-tight text-slate-900">
                            <Settings2 className="h-7 w-7 text-indigo-600" />
                            Reports & Email
                        </h1>
                        <p className="mt-1 text-sm text-slate-600">
                            Configure daily production and stock-standing report packs, recipients, and delivery windows.
                        </p>
                    </div>
                    {!reportAccessDenied ? (
                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => refetchRuns()} disabled={runsLoading}>
                                <RefreshCw className={`mr-2 h-4 w-4 ${runsLoading ? "animate-spin" : ""}`} />
                                Refresh runs
                            </Button>
                            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || profilesLoading}>
                                {saveMutation.isPending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Save changes
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>

            {reportAccessDenied ? (
                <Card className="border-slate-200">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-lg font-black text-slate-900">Access Restricted</CardTitle>
                        <CardDescription>
                            Report schedules, recipients, dispatch runs, and PDF previews are limited to report admins.
                        </CardDescription>
                    </CardHeader>
                </Card>
            ) : (
                <>
                    <div className="grid gap-4 md:grid-cols-3">
                        <Card className="border-slate-200">
                            <CardContent className="p-5">
                                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Active packs</div>
                                <div className="mt-1 text-3xl font-black text-slate-900">{totals.active}</div>
                            </CardContent>
                        </Card>
                        <Card className="border-slate-200">
                            <CardContent className="p-5">
                                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Configured recipients</div>
                                <div className="mt-1 text-3xl font-black text-slate-900">{totals.recipients}</div>
                            </CardContent>
                        </Card>
                        <Card className="border-slate-200">
                            <CardContent className="p-5">
                                <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Successful recent runs</div>
                                <div className="mt-1 text-3xl font-black text-slate-900">{totals.successfulRuns}</div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                        <div className="space-y-4">
                            {(profilesLoading ? [] : Object.values(draftProfiles)).map((profile) => (
                                <Card key={profile.report_code} className="border-slate-200">
                                    <CardHeader className="pb-4">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <CardTitle className="text-lg font-black text-slate-900">{profile.label}</CardTitle>
                                                <CardDescription>
                                                    Delivery window {formatSchedule(profile)} daily. Role-based pack with optional direct emails.
                                                </CardDescription>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge variant="outline" className={profile.active ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "bg-slate-50"}>
                                                    {profile.active ? "Active" : "Paused"}
                                                </Badge>
                                                <Switch
                                                    checked={profile.active}
                                                    onCheckedChange={(checked) => updateProfile(profile.report_code, { active: checked })}
                                                />
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Target roles</Label>
                                                <Input
                                                    value={(profile.target_roles || []).join(", ")}
                                                    onChange={(e) => updateProfile(profile.report_code, { target_roles: parseList(e.target.value).map((row) => row.toUpperCase()) })}
                                                    placeholder="OWNER, ADMIN, PLANNER"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Extra emails</Label>
                                                <Input
                                                    value={(profile.extra_recipients || []).join(", ")}
                                                    onChange={(e) => updateProfile(profile.report_code, { extra_recipients: parseList(e.target.value) })}
                                                    placeholder="ops@company.com, planthead@company.com"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Schedule hour</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={23}
                                                    value={profile.schedule_hour}
                                                    onChange={(e) => updateProfile(profile.report_code, { schedule_hour: Number(e.target.value || 0) })}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Schedule minute</Label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    max={59}
                                                    value={profile.schedule_minute}
                                                    onChange={(e) => updateProfile(profile.report_code, { schedule_minute: Number(e.target.value || 0) })}
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Email subject template</Label>
                                            <Input
                                                value={profile.email_subject_template}
                                                onChange={(e) => updateProfile(profile.report_code, { email_subject_template: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[11px] font-black uppercase tracking-wide text-slate-500">Email body template</Label>
                                            <Input
                                                value={profile.email_body_template}
                                                onChange={(e) => updateProfile(profile.report_code, { email_body_template: e.target.value })}
                                            />
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                            <div className="text-xs text-slate-600">
                                                Updated {formatTimestamp(profile.updated_at)} by {profile.updated_by || "system"}
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => sendMutation.mutate(profile.report_code)}
                                                disabled={sendMutation.isPending}
                                            >
                                                <Send className="mr-2 h-4 w-4" />
                                                Send now
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>

                        <Card className="border-slate-200">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
                                    <Mail className="h-5 w-5 text-indigo-600" />
                                    Recent dispatch runs
                                </CardTitle>
                                <CardDescription>Audit trail for generated PDFs, recipients, and provider responses.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {runs.map((run: ReportDispatchRun) => (
                                    <div key={run.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{run.report_code.replaceAll("_", " ")}</div>
                                                <div className="text-xs text-slate-500">{run.report_date}</div>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    run.status === "SUCCEEDED"
                                                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                                                        : run.status === "FAILED"
                                                            ? "border-rose-300 bg-rose-50 text-rose-700"
                                                            : run.status === "SKIPPED_EMAIL"
                                                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                                            : run.status === "SKIPPED"
                                                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                                                : "bg-white"
                                                }
                                            >
                                                {run.status}
                                            </Badge>
                                        </div>
                                        <div className="grid gap-2 text-xs text-slate-600">
                                            <div>Recipients: {run.recipient_count}</div>
                                            <div>Sent at: {formatTimestamp(run.sent_at || run.created_at)}</div>
                                            <div>Provider: {run.provider || "—"}</div>
                                            {run.warning_text ? <div className="text-amber-700">Warning: {run.warning_text}</div> : null}
                                            {run.error_text ? <div className="text-rose-700">Error: {run.error_text}</div> : null}
                                        </div>
                                        <a
                                            href={analyticsApi.getReportRunPreviewUrl(run.id)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="inline-flex text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                                        >
                                            Preview PDF
                                        </a>
                                        {run.detail_file_name ? (
                                            <a
                                                href={analyticsApi.getReportRunDetailUrl(run.id)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="ml-4 inline-flex text-xs font-semibold text-slate-700 hover:text-slate-900"
                                            >
                                                Download detail workbook
                                            </a>
                                        ) : null}
                                    </div>
                                ))}
                                {!runs.length && (
                                    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500">
                                        No report dispatch runs yet.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}
