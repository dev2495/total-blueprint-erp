"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Loader2, ShieldCheck, UserCircle2 } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { type ProfileChangeRequest, systemUserService } from "@/services/system-users";

const PROFILE_FIELDS: Array<{ key: keyof ProfileDraft; label: string; placeholder: string }> = [
    { key: "first_name", label: "First name", placeholder: "First name" },
    { key: "last_name", label: "Last name", placeholder: "Last name" },
    { key: "email", label: "Email", placeholder: "name@company.com" },
    { key: "phone_number", label: "Phone", placeholder: "+91..." },
    { key: "avatar_url", label: "Avatar URL", placeholder: "https://..." },
];

type ProfileDraft = {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    avatar_url: string;
};

function normalize(value?: string | null) {
    return String(value || "").trim();
}

function getErrorDetail(error: unknown) {
    const maybe = error as { response?: { data?: { detail?: string; message?: string } }; message?: string };
    const detail = maybe?.response?.data?.detail;
    if (Array.isArray(detail)) return detail.join(", ");
    return detail || maybe?.response?.data?.message || maybe?.message || "Please try again.";
}

function formatDateTime(value?: string | null) {
    if (!value) return "—";
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
}

export default function ProfilePage() {
    const { user, logout } = useAuth();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<"profile" | "requests" | "security">("profile");

    const [draft, setDraft] = useState<ProfileDraft>({
        first_name: "",
        last_name: "",
        email: "",
        phone_number: "",
        avatar_url: "",
    });
    const [security, setSecurity] = useState({
        current_password: "",
        new_password: "",
        confirm_password: "",
    });

    useEffect(() => {
        if (!user) return;
        setDraft({
            first_name: normalize(user.first_name),
            last_name: normalize(user.last_name),
            email: normalize(user.email),
            phone_number: normalize(user.phone_number),
            avatar_url: normalize(user.avatar_url),
        });
    }, [user]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const tabParam = new URLSearchParams(window.location.search).get("tab");
        if (tabParam === "security" || tabParam === "requests" || tabParam === "profile") {
            setActiveTab(tabParam);
        }
    }, []);

    const requestsQuery = useQuery({
        queryKey: ["my-profile-change-requests"],
        queryFn: () => systemUserService.getProfileChangeRequests(),
        enabled: Boolean(user),
    });

    const submitProfileMutation = useMutation({
        mutationFn: (changes: Record<string, string>) => systemUserService.createProfileChangeRequest(changes),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["my-profile-change-requests"] });
            toast({
                title: "Request submitted",
                description: "Your profile update request is pending admin approval.",
            });
        },
        onError: (error: unknown) => {
            toast({
                title: "Failed to submit request",
                description: getErrorDetail(error),
                variant: "destructive",
            });
        },
    });

    const cancelMutation = useMutation({
        mutationFn: (requestId: string) => systemUserService.cancelProfileChangeRequest(requestId),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["my-profile-change-requests"] });
            toast({ title: "Request cancelled" });
        },
        onError: (error: unknown) => {
            toast({
                title: "Cancel failed",
                description: getErrorDetail(error),
                variant: "destructive",
            });
        },
    });

    const changePasswordMutation = useMutation({
        mutationFn: () => systemUserService.changePassword(security.current_password, security.new_password),
        onSuccess: async () => {
            toast({
                title: "Password updated",
                description: "Please sign in again with your new password.",
            });
            await logout();
        },
        onError: (error: unknown) => {
            toast({
                title: "Password change failed",
                description: getErrorDetail(error),
                variant: "destructive",
            });
        },
    });

    const profileCompleteness = useMemo(() => {
        const required = [normalize(draft.first_name), normalize(draft.last_name), normalize(draft.email)];
        const done = required.filter(Boolean).length;
        return { done, total: required.length, complete: done === required.length };
    }, [draft.first_name, draft.last_name, draft.email]);

    if (!user) {
        return (
            <div className="p-8">
                <Card>
                    <CardContent className="py-10 text-center text-slate-500">Loading profile...</CardContent>
                </Card>
            </div>
        );
    }

    const submitProfileRequest = () => {
        const currentUserValues: Partial<Record<keyof ProfileDraft, string>> = {
            first_name: normalize(user.first_name),
            last_name: normalize(user.last_name),
            email: normalize(user.email),
            phone_number: normalize(user.phone_number),
            avatar_url: normalize(user.avatar_url),
        };
        const changedEntries = PROFILE_FIELDS.reduce<Record<string, string>>((acc, field) => {
            const next = normalize(draft[field.key]);
            const current = normalize(currentUserValues[field.key]);
            if (next !== current) {
                acc[field.key] = next;
            }
            return acc;
        }, {});

        if (!Object.keys(changedEntries).length) {
            toast({ title: "No changes detected", description: "Update at least one profile field before submitting." });
            return;
        }
        if (!normalize(draft.email)) {
            toast({ title: "Email required", description: "Email is mandatory for all users.", variant: "destructive" });
            return;
        }
        submitProfileMutation.mutate(changedEntries);
    };

    const submitPasswordChange = () => {
        if (!security.current_password || !security.new_password || !security.confirm_password) {
            toast({ title: "Missing fields", description: "Fill current, new, and confirm password.", variant: "destructive" });
            return;
        }
        if (security.new_password !== security.confirm_password) {
            toast({ title: "Password mismatch", description: "New password and confirmation must match.", variant: "destructive" });
            return;
        }
        changePasswordMutation.mutate();
    };

    const pendingCount = (requestsQuery.data || []).filter((r) => r.status === "PENDING").length;

    return (
        <div className="space-y-6 p-6 lg:p-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 rounded-full border border-sky-100 bg-info-bg px-3 py-1 text-[10px] font-black uppercase tracking-widest text-info-fg">
                        <UserCircle2 className="h-3 w-3" /> Account Center
                    </div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900">My Profile</h1>
                    <p className="text-sm text-slate-500">Manage your personal details, security settings, and approval requests.</p>
                </div>
                <div className="flex items-center gap-2">
                    {profileCompleteness.complete ? (
                        <Badge className="bg-emerald-600">
                            <CheckCircle2 className="mr-1 h-3 w-3" /> Profile complete
                        </Badge>
                    ) : (
                        <Badge variant="secondary">
                            {profileCompleteness.done}/{profileCompleteness.total} required fields complete
                        </Badge>
                    )}
                    <Badge variant={pendingCount ? "secondary" : "outline"}>{pendingCount} pending request(s)</Badge>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="requests">Requests</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                </TabsList>

                <TabsContent value="profile">
                    <Card>
                        <CardHeader>
                            <CardTitle>Profile Update Request</CardTitle>
                            <CardDescription>
                                Changes to profile fields go through admin approval before they become active.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2">
                            {PROFILE_FIELDS.map((field) => (
                                <div className="space-y-1.5" key={field.key}>
                                    <label className="text-xs font-semibold text-content-3">{field.label}</label>
                                    <Input
                                        type={field.key === "email" ? "email" : "text"}
                                        value={draft[field.key]}
                                        placeholder={field.placeholder}
                                        onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                            <div className="md:col-span-2">
                                <Button onClick={submitProfileRequest} disabled={submitProfileMutation.isPending}>
                                    {submitProfileMutation.isPending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting...
                                        </>
                                    ) : (
                                        "Submit For Approval"
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="requests">
                    <Card>
                        <CardHeader>
                            <CardTitle>My Change Requests</CardTitle>
                            <CardDescription>Track approval status for your submitted profile updates.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Submitted</TableHead>
                                        <TableHead>Requested changes</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Reviewed</TableHead>
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {(requestsQuery.data || []).map((row: ProfileChangeRequest) => (
                                        <TableRow key={row.id}>
                                            <TableCell className="text-xs">{formatDateTime(row.created_at)}</TableCell>
                                            <TableCell className="max-w-[320px] text-xs text-content-3">
                                                {Object.entries(row.requested_changes || {}).map(([k, v]) => `${k}: ${v}`).join(" | ") || "—"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={row.status === "APPROVED" ? "outline" : "secondary"}>{row.status}</Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-500">{formatDateTime(row.reviewed_at)}</TableCell>
                                            <TableCell className="text-right">
                                                {row.status === "PENDING" ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => cancelMutation.mutate(row.id)}
                                                        disabled={cancelMutation.isPending}
                                                    >
                                                        Cancel
                                                    </Button>
                                                ) : (
                                                    "—"
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {!requestsQuery.data?.length ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="py-10 text-center text-slate-500">
                                                No profile change requests yet.
                                            </TableCell>
                                        </TableRow>
                                    ) : null}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="security">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <KeyRound className="h-4 w-4" /> Change Password
                            </CardTitle>
                            <CardDescription>Update your account password instantly after current-password verification.</CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-content-3">Current password</label>
                                <PasswordInput
                                    value={security.current_password}
                                    onChange={(e) => setSecurity((prev) => ({ ...prev, current_password: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-semibold text-content-3">New password</label>
                                <PasswordInput
                                    value={security.new_password}
                                    onChange={(e) => setSecurity((prev) => ({ ...prev, new_password: e.target.value }))}
                                />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <label className="text-xs font-semibold text-content-3">Confirm new password</label>
                                <PasswordInput
                                    value={security.confirm_password}
                                    onChange={(e) => setSecurity((prev) => ({ ...prev, confirm_password: e.target.value }))}
                                />
                            </div>
                            <div className="md:col-span-2">
                                <Button onClick={submitPasswordChange} disabled={changePasswordMutation.isPending}>
                                    {changePasswordMutation.isPending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
                                        </>
                                    ) : (
                                        <>
                                            <ShieldCheck className="mr-2 h-4 w-4" /> Update Password
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
