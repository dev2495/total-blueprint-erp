"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  RefreshCw,
  Save,
  ShieldCheck,
  ShieldQuestion,
  TableProperties,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ProfileApprovalsTab } from "@/components/governance/profile-approvals-tab";
import {
  NotificationService,
  type NotificationRule,
  type RoleVisibilitySignoff,
} from "@/services/notifications";
import { RbacService } from "@/services/rbac";
import { systemUserService } from "@/services/system-users";
import { formatDisplayDateTime } from "@/lib/date-format";

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
const CHANNELS = ["IN_APP", "EMAIL"] as const;

type RuleFormState = {
  event_key: string;
  target_roles: string[];
  channels: ("IN_APP" | "EMAIL")[];
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  active: boolean;
  escalation_minutes: number;
  email_subject_template: string;
  email_body_template: string;
};

type SignoffFormState = {
  role_code: string;
  module_key: string;
  action_key: string;
  approved: boolean;
  notes: string;
};

const EMPTY_RULE_FORM: RuleFormState = {
  event_key: "",
  target_roles: [],
  channels: ["IN_APP"],
  priority: "NORMAL",
  active: true,
  escalation_minutes: 0,
  email_subject_template: "",
  email_body_template: "",
};

const EMPTY_SIGNOFF_FORM: SignoffFormState = {
  role_code: "SALES",
  module_key: "",
  action_key: "view",
  approved: false,
  notes: "",
};

function formatTs(value?: string | null) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return formatDisplayDateTime(dt);
}

export default function GovernancePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<
    "rules" | "signoffs" | "profiles" | "visibility"
  >("rules");

  const roleCode = (
    user?.entitlements?.role ||
    user?.role_info?.code ||
    ""
  ).toUpperCase();
  const canAccess = ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(roleCode);

  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [editingRuleEventKey, setEditingRuleEventKey] = useState<string>("");

  const [signoffForm, setSignoffForm] =
    useState<SignoffFormState>(EMPTY_SIGNOFF_FORM);
  const [editingSignoffId, setEditingSignoffId] = useState<string>("");

  const rolesQuery = useQuery({
    queryKey: ["governance-roles"],
    queryFn: systemUserService.getRoles,
    enabled: canAccess,
  });

  const rulesQuery = useQuery({
    queryKey: ["governance-notification-rules"],
    queryFn: NotificationService.getRules,
    enabled: canAccess,
  });

  const signoffsQuery = useQuery({
    queryKey: ["governance-role-signoffs"],
    queryFn: NotificationService.getRoleSignoffs,
    enabled: canAccess,
  });

  const visibilityQuery = useQuery({
    queryKey: ["governance-role-visibility"],
    queryFn: RbacService.revalidateRoleVisibility,
    enabled: canAccess,
  });

  const auditQuery = useQuery({
    queryKey: ["governance-permission-audit"],
    queryFn: NotificationService.getPermissionAudit,
    enabled: canAccess,
  });

  const availableRoleCodes = useMemo(() => {
    const fromApi = (rolesQuery.data || [])
      .map((r) => String(r.code || "").toUpperCase())
      .filter(Boolean);
    const fallback = [
      "OWNER",
      "ADMIN",
      "SALES",
      "ENGINEERING",
      "PLANNER",
      "WORK_CENTER_MANAGER",
      "STORE",
      "DISPATCH",
    ];
    const merged = new Set([...fromApi, ...fallback]);
    return Array.from(merged).sort();
  }, [rolesQuery.data]);

  const visibilityRows = useMemo(() => {
    const map = visibilityQuery.data || {};
    return Object.entries(map).map(([role, status]) => ({
      role,
      ...status,
    }));
  }, [visibilityQuery.data]);

  const signoffSummary = useMemo(() => {
    const rows = signoffsQuery.data || [];
    const total = rows.length;
    const approved = rows.filter((row) => row.approved).length;
    return {
      total,
      approved,
      pending: Math.max(total - approved, 0),
    };
  }, [signoffsQuery.data]);

  const saveRuleMutation = useMutation({
    mutationFn: NotificationService.upsertRule,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["governance-notification-rules"],
      });
      toast({
        title: "Rule saved",
        description: `Routing rule ${ruleForm.event_key} updated successfully.`,
      });
      setRuleForm(EMPTY_RULE_FORM);
      setEditingRuleEventKey("");
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to save notification rule";
      toast({
        title: "Rule save failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const saveSignoffMutation = useMutation({
    mutationFn: NotificationService.upsertRoleSignoff,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["governance-role-signoffs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["governance-role-visibility"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["governance-permission-audit"],
        }),
      ]);
      toast({
        title: "Signoff updated",
        description: "Role visibility signoff row was updated.",
      });
      setSignoffForm(EMPTY_SIGNOFF_FORM);
      setEditingSignoffId("");
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error ? error.message : "Failed to upsert signoff row";
      toast({
        title: "Signoff update failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const bootstrapMutation = useMutation({
    mutationFn: RbacService.bootstrapRoleVisibilitySignoffs,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["governance-role-signoffs"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["governance-role-visibility"],
        }),
      ]);
      toast({
        title: "Bootstrap complete",
        description: `Created ${result.created_rows} pending signoff row(s).`,
      });
    },
    onError: (error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to bootstrap signoff rows";
      toast({
        title: "Bootstrap failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requested = String(
      new URLSearchParams(window.location.search).get("tab") || "",
    )
      .toLowerCase()
      .trim();
    if (requested === "signoffs") setActiveTab("signoffs");
    else if (requested === "visibility") setActiveTab("visibility");
    else if (requested === "profiles" || requested === "profile-approvals")
      setActiveTab("profiles");
    else setActiveTab("rules");
  }, []);

  if (!canAccess) {
    return (
      <div className="p-6 lg:p-8">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            This governance console is limited to ADMIN/OWNER roles.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const saveRule = () => {
    if (!ruleForm.event_key.trim()) {
      toast({
        title: "Missing event key",
        description: "Event key is required (example: production.fg_ready).",
        variant: "destructive",
      });
      return;
    }
    saveRuleMutation.mutate({
      event_key: ruleForm.event_key.trim(),
      target_roles: ruleForm.target_roles,
      channels: ruleForm.channels,
      priority: ruleForm.priority,
      active: ruleForm.active,
      escalation_minutes: Number(ruleForm.escalation_minutes || 0),
      email_subject_template: ruleForm.email_subject_template,
      email_body_template: ruleForm.email_body_template,
    });
  };

  const saveSignoff = () => {
    if (
      !signoffForm.role_code ||
      !signoffForm.module_key.trim() ||
      !signoffForm.action_key.trim()
    ) {
      toast({
        title: "Missing required fields",
        description: "Role, module key, and action key are required.",
        variant: "destructive",
      });
      return;
    }
    saveSignoffMutation.mutate({
      role_code: signoffForm.role_code,
      module_key: signoffForm.module_key.trim(),
      action_key: signoffForm.action_key.trim(),
      approved: signoffForm.approved,
      notes: signoffForm.notes.trim(),
    });
  };

  const isBusy =
    rolesQuery.isLoading ||
    rulesQuery.isLoading ||
    signoffsQuery.isLoading ||
    visibilityQuery.isLoading;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-info-bg border border-info-border text-primary text-[10px] font-black uppercase tracking-widest">
            <ShieldCheck className="h-3 w-3" /> P0 Governance Console
          </div>
          <h1 className="text-2xl font-black tracking-tight text-content-1">
            RBAC + Notification Operations
          </h1>
          <p className="text-xs text-content-3">
            Manage routing rules, role signoffs, and visibility revalidation
            without calling APIs manually.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/system/role-matrix">Role Matrix</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void Promise.all([
                rulesQuery.refetch(),
                signoffsQuery.refetch(),
                visibilityQuery.refetch(),
                auditQuery.refetch(),
              ]);
            }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Notification rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">
              {rulesQuery.data?.length || 0}
            </div>
            <p className="text-xs text-content-3">
              Configured event routing rows
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">
              {(rulesQuery.data || []).filter((r) => r.active).length}
            </div>
            <p className="text-xs text-content-3">
              Currently dispatching events
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Signoff approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{signoffSummary.approved}</div>
            <p className="text-xs text-content-3">
              Approved module/action entries
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Signoff pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{signoffSummary.pending}</div>
            <p className="text-xs text-content-3">
              Rows awaiting department approval
            </p>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <ShieldQuestion className="h-4 w-4" />
        <AlertTitle>What this screen can do</AlertTitle>
        <AlertDescription>
          Create/update notification routing rules, bootstrap signoff matrix
          rows from role permissions, approve or revoke role visibility tuples,
          review profile update requests, and inspect recent permission audit
          events.
        </AlertDescription>
      </Alert>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as typeof activeTab)}
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="rules">Notification Rules</TabsTrigger>
          <TabsTrigger value="signoffs">Role Signoffs</TabsTrigger>
          <TabsTrigger value="profiles">Profile Approvals</TabsTrigger>
          <TabsTrigger value="visibility">Visibility + Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BellRing className="h-4 w-4" /> Rule Editor
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Event key
                  </label>
                  <Input
                    placeholder="production.fg_ready"
                    value={ruleForm.event_key}
                    onChange={(e) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        event_key: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Target roles
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {availableRoleCodes.map((code) => {
                      const selected = ruleForm.target_roles.includes(code);
                      return (
                        <Button
                          key={code}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          onClick={() =>
                            setRuleForm((prev) => ({
                              ...prev,
                              target_roles: selected
                                ? prev.target_roles.filter(
                                    (role) => role !== code,
                                  )
                                : [...prev.target_roles, code],
                            }))
                          }
                        >
                          {code}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Channels
                  </label>
                  <div className="flex items-center gap-6">
                    {CHANNELS.map((channel) => {
                      const selected = ruleForm.channels.includes(channel);
                      return (
                        <label
                          key={channel}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Switch
                            checked={selected}
                            onCheckedChange={(checked) =>
                              setRuleForm((prev) => ({
                                ...prev,
                                channels: checked
                                  ? Array.from(
                                      new Set([...prev.channels, channel]),
                                    )
                                  : prev.channels.filter((c) => c !== channel),
                              }))
                            }
                          />
                          <span>{channel}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-content-3">
                      Priority
                    </label>
                    <Select
                      value={ruleForm.priority}
                      onValueChange={(value) =>
                        setRuleForm((prev) => ({
                          ...prev,
                          priority: value as RuleFormState["priority"],
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Priority" />
                      </SelectTrigger>
                      <SelectContent>
                        {PRIORITIES.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {priority}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-content-3">
                      Escalation (minutes)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={ruleForm.escalation_minutes}
                      onChange={(e) =>
                        setRuleForm((prev) => ({
                          ...prev,
                          escalation_minutes: Number(e.target.value || 0),
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-semibold">Rule active</p>
                    <p className="text-xs text-content-3">
                      Inactive rules are not used for routing.
                    </p>
                  </div>
                  <Switch
                    checked={ruleForm.active}
                    onCheckedChange={(checked) =>
                      setRuleForm((prev) => ({ ...prev, active: checked }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Email subject template
                  </label>
                  <Input
                    placeholder="FG Ready: {{batch_number}}"
                    value={ruleForm.email_subject_template}
                    onChange={(e) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        email_subject_template: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Email body template
                  </label>
                  <Textarea
                    rows={4}
                    placeholder="Body template for email channel"
                    value={ruleForm.email_body_template}
                    onChange={(e) =>
                      setRuleForm((prev) => ({
                        ...prev,
                        email_body_template: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={saveRule}
                    disabled={saveRuleMutation.isPending || isBusy}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saveRuleMutation.isPending
                      ? "Saving..."
                      : editingRuleEventKey
                        ? "Update rule"
                        : "Create rule"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setRuleForm(EMPTY_RULE_FORM);
                      setEditingRuleEventKey("");
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TableProperties className="h-4 w-4" /> Existing Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>Targets</TableHead>
                      <TableHead>Channels</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(rulesQuery.data || []).map((rule: NotificationRule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="font-medium">{rule.event_key}</div>
                          <div className="text-xs text-content-3">
                            {rule.priority}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <div className="flex flex-wrap gap-1">
                            {(rule.target_roles || []).map((role) => (
                              <Badge key={role} variant="outline">
                                {role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(rule.channels || []).map((channel) => (
                              <Badge key={channel} variant="outline">
                                {channel}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          {rule.active ? (
                            <Badge className="bg-success-fg">ACTIVE</Badge>
                          ) : (
                            <Badge variant="secondary">INACTIVE</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRuleForm({
                                event_key: rule.event_key,
                                target_roles: [...(rule.target_roles || [])],
                                channels: [...(rule.channels || [])],
                                priority: rule.priority,
                                active: rule.active,
                                escalation_minutes: Number(
                                  rule.escalation_minutes || 0,
                                ),
                                email_subject_template:
                                  rule.email_subject_template || "",
                                email_body_template:
                                  rule.email_body_template || "",
                              });
                              setEditingRuleEventKey(rule.event_key);
                            }}
                          >
                            Edit
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rulesQuery.data?.length && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-content-3 py-8"
                        >
                          No notification rules found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="signoffs" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Role Signoff Editor</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-content-3">
                      Role
                    </label>
                    <Select
                      value={signoffForm.role_code}
                      onValueChange={(value) =>
                        setSignoffForm((prev) => ({
                          ...prev,
                          role_code: value.toUpperCase(),
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRoleCodes.map((code) => (
                          <SelectItem key={code} value={code}>
                            {code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-content-3">
                      Action
                    </label>
                    <Input
                      placeholder="view / manage"
                      value={signoffForm.action_key}
                      onChange={(e) =>
                        setSignoffForm((prev) => ({
                          ...prev,
                          action_key: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Module
                  </label>
                  <Input
                    placeholder="inventory / production / notifications"
                    value={signoffForm.module_key}
                    onChange={(e) =>
                      setSignoffForm((prev) => ({
                        ...prev,
                        module_key: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-semibold">Approved</p>
                    <p className="text-xs text-content-3">
                      Controls module/action visibility status.
                    </p>
                  </div>
                  <Switch
                    checked={signoffForm.approved}
                    onCheckedChange={(checked) =>
                      setSignoffForm((prev) => ({ ...prev, approved: checked }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-content-3">
                    Notes
                  </label>
                  <Textarea
                    rows={3}
                    placeholder="Department decision notes"
                    value={signoffForm.notes}
                    onChange={(e) =>
                      setSignoffForm((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={saveSignoff}
                    disabled={saveSignoffMutation.isPending}
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saveSignoffMutation.isPending
                      ? "Saving..."
                      : editingSignoffId
                        ? "Update signoff"
                        : "Create signoff"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSignoffForm(EMPTY_SIGNOFF_FORM);
                      setEditingSignoffId("");
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => bootstrapMutation.mutate()}
                    disabled={bootstrapMutation.isPending}
                  >
                    {bootstrapMutation.isPending
                      ? "Bootstrapping..."
                      : "Bootstrap pending rows"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Signoff Rows</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Module.Action</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(signoffsQuery.data || []).map(
                      (row: RoleVisibilitySignoff) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.role_code}
                          </TableCell>
                          <TableCell>
                            <code className="text-xs">
                              {row.module_key}.{row.action_key}
                            </code>
                            <div className="text-xs text-content-3">
                              {formatTs(row.approved_at)}
                            </div>
                          </TableCell>
                          <TableCell>
                            {row.approved ? (
                              <Badge className="bg-success-fg">APPROVED</Badge>
                            ) : (
                              <Badge variant="secondary">PENDING</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  saveSignoffMutation.mutate({
                                    role_code: row.role_code,
                                    module_key: row.module_key,
                                    action_key: row.action_key,
                                    approved: !row.approved,
                                    notes: row.notes || "",
                                  })
                                }
                              >
                                {row.approved ? "Revoke" : "Approve"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingSignoffId(row.id);
                                  setSignoffForm({
                                    role_code: row.role_code,
                                    module_key: row.module_key,
                                    action_key: row.action_key,
                                    approved: row.approved,
                                    notes: row.notes || "",
                                  });
                                }}
                              >
                                Edit
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                    {!signoffsQuery.data?.length && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-content-3 py-8"
                        >
                          No signoff rows yet. Use the bootstrap action to
                          generate baseline entries.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="visibility" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Role Visibility Revalidation
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void visibilityQuery.refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Revalidate
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Approved</TableHead>
                      <TableHead>Pending</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibilityRows.map((row) => (
                      <TableRow key={row.role}>
                        <TableCell className="font-medium">
                          {row.role}
                        </TableCell>
                        <TableCell>{row.total}</TableCell>
                        <TableCell>{row.approved}</TableCell>
                        <TableCell>{row.pending}</TableCell>
                        <TableCell>
                          {row.ready ? (
                            <Badge className="bg-success-fg">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> READY
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <AlertTriangle className="h-3 w-3 mr-1" /> PENDING
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!visibilityRows.length && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-content-3 py-8"
                        >
                          Visibility map is empty.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Recent Permission Audit
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void auditQuery.refetch()}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reload
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Path</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(auditQuery.data || []).slice(0, 30).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="text-xs">
                          {formatTs(row.created_at)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.action}</Badge>
                        </TableCell>
                        <TableCell>{row.user || "—"}</TableCell>
                        <TableCell className="max-w-[260px] truncate text-xs text-content-3">
                          {row.path || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!auditQuery.data?.length && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="text-center text-content-3 py-8"
                        >
                          No audit rows available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="profiles" className="space-y-4">
          <ProfileApprovalsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
