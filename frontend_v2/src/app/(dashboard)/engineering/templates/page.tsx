"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, ArrowRight, Trash2 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { templateService, type TemplateBlueprint } from "@/services/templates";
import { routingService } from "@/services/routing";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { commercialFamilyService } from "@/services/commercial-families";
import { useAuth } from "@/components/auth-provider";

type DraftPouchStyle = NonNullable<TemplateBlueprint["pouch_style"]>;

export default function EngineeringTemplatesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { effectiveRole, user } = useAuth();
  const isAdminActor = Boolean(
    user?.is_owner ||
      user?.is_superuser ||
      ["ADMIN", "SUPER_ADMIN", "OWNER"].includes(
        String(effectiveRole || user?.role_info?.code || "").toUpperCase(),
      ),
  );
  const canManageTemplates =
    isAdminActor ||
    Boolean(
      user?.entitlements?.permissions?.includes("*") ||
        user?.entitlements?.permissions?.includes("templates.manage") ||
        user?.extra_permissions?.includes("templates.manage"),
    );
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [createOpen, setCreateOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftFgType, setDraftFgType] = useState<"POUCH" | "ROLL">("POUCH");
  const [draftPouchStyle, setDraftPouchStyle] =
    useState<DraftPouchStyle>("PILLOW");
  const [draftRoutingRule, setDraftRoutingRule] = useState<string>("__NONE__");
  const [draftCommercialFamily, setDraftCommercialFamily] =
    useState<string>("__NONE__");

  const {
    data: templates,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["templates", "admin-registry"],
    queryFn: () => templateService.getTemplates({ include_obsolete: "1", options: "1" }),
  });
  const { data: schemaHealth } = useQuery({
    queryKey: ["templates-schema-health"],
    queryFn: () => templateService.getSchemaHealth(),
    retry: false,
  });
  const { data: routingRules } = useQuery({
    queryKey: ["routing-rules"],
    queryFn: () => routingService.getRules(),
  });
  const { data: commercialFamilies = [] } = useQuery({
    queryKey: ["commercial-families"],
    queryFn: commercialFamilyService.getAll,
  });

  const createTemplateMutation = useMutation({
    mutationFn: () => {
      const name = draftName.trim();
      if (!name) throw new Error("Template name is required.");
      return templateService.createTemplate({
        name,
        fg_type: draftFgType,
        pouch_style: draftFgType === "POUCH" ? draftPouchStyle : "",
        commercial_family:
          draftCommercialFamily === "__NONE__" ? null : draftCommercialFamily,
        routing_rule: draftRoutingRule === "__NONE__" ? null : draftRoutingRule,
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setCreateOpen(false);
      setDraftName("");
      setDraftFgType("POUCH");
      setDraftPouchStyle("PILLOW");
      setDraftRoutingRule("__NONE__");
      setDraftCommercialFamily("__NONE__");
      toast({
        title: "Template created",
        description: "Route template draft created successfully.",
      });
      router.push(`/engineering/templates/${created.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Create failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not create template.",
        variant: "destructive",
      });
    },
  });

  const purgeDraftsMutation = useMutation({
    mutationFn: () => templateService.purgeDraftTemplates(true),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({
        title: "Draft templates cleaned",
        description: `${response.deleted} deleted, ${response.disabled} disabled because history exists.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Draft cleanup failed",
        description:
          err?.response?.data?.detail ||
          err?.response?.data?.message ||
          err?.message ||
          "Could not clean draft templates.",
        variant: "destructive",
      });
    },
  });

  const templateList = Array.isArray(templates) ? templates : [];
  const statusCounts = templateList.reduce<Record<string, number>>(
    (acc, template) => {
      acc[template.status] = (acc[template.status] || 0) + 1;
      return acc;
    },
    {},
  );
  const correctionDrafts = templateList.filter((template) =>
    Boolean(template.source_template),
  ).length;
  const filtered = templateList.filter((t) => {
    const matchesSearch =
      t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.id.includes(searchTerm);
    const matchesStatus =
      statusFilter === "ACTIVE"
        ? t.status !== "OBSOLETE"
        : statusFilter === "DISABLED"
          ? t.status === "OBSOLETE"
          : t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const visibleTemplates = filtered.slice(0, 100);

  const getStatusBadge = (template: TemplateBlueprint) => {
    const status = template.status;
    if (template.source_template) {
      return (
        <Badge className="bg-info-bg text-primary hover:bg-info-bg">
          Correction draft
        </Badge>
      );
    }
    switch (status) {
      case "DRAFT":
        return <Badge variant="secondary">Draft</Badge>;
      case "ENGINEERING":
        return (
          <Badge className="bg-info-bg text-primary hover:bg-info-bg">
            Engineering
          </Badge>
        );
      case "APPROVED":
        return (
          <Badge className="bg-info-bg text-primary hover:bg-info-bg">
            Approved
          </Badge>
        );
      case "LIVE":
        return (
          <Badge className="bg-success-bg text-success-fg hover:bg-success-bg">
            Live
          </Badge>
        );
      case "OBSOLETE":
        return (
          <Badge variant="outline" className="text-content-4">
            Disabled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <section className="overflow-hidden rounded-[2rem] border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-col gap-5 p-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <Badge
                variant="outline"
                className="border-line-strong bg-surface-3 px-2 py-0.5 text-[10px] font-black tracking-[0.18em] text-white"
              >
                ENGINEERING HUB
              </Badge>
              <Badge
                variant="outline"
                className="border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black tracking-[0.18em] text-primary"
              >
                ROUTE CONTRACTS
              </Badge>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-content-1">
              Template Studio
            </h1>
            <p className="mt-2 text-sm font-semibold text-content-3">
              Build reusable route templates with clear stages, material issue
              rules, and review gates before planner use.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[640px]">
            {[
              ["Total", templateList.length],
              ["Live", statusCounts.LIVE || 0],
              ["Engineering", statusCounts.ENGINEERING || 0],
              ["Disabled", statusCounts.OBSOLETE || 0],
              ["Corrections", correctionDrafts],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-2xl border border-line bg-surface-2 px-4 py-3"
              >
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                  {label}
                </div>
                <div className="mt-1 text-2xl font-black text-content-1">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-line bg-surface-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            className="h-11 rounded-xl bg-primary px-7 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-lg hover:bg-surface-3"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> New Template
          </Button>
          {canManageTemplates ? (
            <Button
              variant="outline"
              className="h-11 rounded-xl border-danger-border bg-surface-1 px-5 text-[11px] font-black uppercase tracking-[0.14em] text-danger-fg hover:bg-danger-bg"
              disabled={purgeDraftsMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    "Delete all unreferenced draft/review templates and disable any draft already referenced by history?",
                  )
                ) {
                  purgeDraftsMutation.mutate();
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clean drafts
            </Button>
          ) : null}
        </div>
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Route Template</DialogTitle>
            <DialogDescription>
              Templates define final product type, route contract, step material
              policy, and roll handling rules.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 py-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-content-3">
                Template Name
              </p>
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="e.g. Pouch Route V2"
              />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-content-3">
                  FG Type
                </p>
                <Select
                  value={draftFgType}
                  onValueChange={(v: "POUCH" | "ROLL") => setDraftFgType(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POUCH">POUCH</SelectItem>
                    <SelectItem value="ROLL">ROLL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {draftFgType === "POUCH" ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-content-3">
                    Pouch Style
                  </p>
                  <Select
                    value={draftPouchStyle}
                    onValueChange={(value) =>
                      setDraftPouchStyle(value as DraftPouchStyle)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="THREE_SIDE_SEAL">
                        Three Side Seal
                      </SelectItem>
                      <SelectItem value="PILLOW">Pillow</SelectItem>
                      <SelectItem value="STAND_UP">Stand Up</SelectItem>
                      <SelectItem value="SIDE_GUSSET">Side Gusset</SelectItem>
                      <SelectItem value="QUAD_SEAL">Quad Seal</SelectItem>
                      <SelectItem value="FLAT_BOTTOM">Flat Bottom</SelectItem>
                      <SelectItem value="SPOUT">Spout</SelectItem>
                      <SelectItem value="SHAPED">Shaped</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-content-3">
                Business Family
              </p>
              <Select
                value={draftCommercialFamily}
                onValueChange={setDraftCommercialFamily}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Optional family alias" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">
                    No linked business family
                  </SelectItem>
                  {commercialFamilies.map((family) => (
                    <SelectItem key={family.id} value={family.id}>
                      {family.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-content-3">
                Routing Rule
              </p>
              <Select
                value={draftRoutingRule}
                onValueChange={setDraftRoutingRule}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select route" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">No route yet</SelectItem>
                  {(routingRules || []).map((rule: any) => (
                    <SelectItem key={rule.id} value={rule.id}>
                      {rule.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createTemplateMutation.mutate()}
              disabled={createTemplateMutation.isPending}
            >
              {createTemplateMutation.isPending
                ? "Creating..."
                : "Create & Open Studio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <Card className="rounded-[1.5rem] border-line bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              placeholder="Search template name or id..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 rounded-2xl border-line bg-surface-2 pl-9 font-semibold focus-visible:ring-primary"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:border-l xl:border-line xl:pl-4">
            {([
              ["ACTIVE", "Active", templateList.filter((t) => t.status !== "OBSOLETE").length],
              ["LIVE", "Live", statusCounts.LIVE || 0],
              ["ENGINEERING", "Engineering", statusCounts.ENGINEERING || 0],
              ["APPROVED", "Approved", statusCounts.APPROVED || 0],
              ["DRAFT", "Draft", statusCounts.DRAFT || 0],
              ["DISABLED", "Disabled", statusCounts.OBSOLETE || 0],
            ] as Array<[string, string, number]>).map(([status, label, count]) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "h-9 rounded-xl px-4 text-[10px] font-black uppercase tracking-wider",
                    statusFilter === status
                      ? "bg-surface-3 text-white"
                      : "text-content-3 hover:text-content-1",
                  )}
                >
                  {label} · {count}
                </Button>
              ))}
          </div>
        </div>
      </Card>

      {schemaHealth && schemaHealth.healthy === false ? (
        <div className="rounded-2xl border border-warning-border bg-warning-bg px-5 py-4 text-sm text-warning-fg">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-warning-fg">
            Template Schema Warning
          </div>
          <div className="mt-1 font-semibold">{schemaHealth.message}</div>
          {schemaHealth.detail ? (
            <div className="mt-1 text-xs">{schemaHealth.detail}</div>
          ) : null}
        </div>
      ) : null}

      <Card className="overflow-hidden rounded-[1.5rem] border-line bg-surface-1 shadow-sm">
        <CardHeader className="border-b border-line bg-surface-2 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-lg font-black tracking-tight text-content-1">
                Template registry
              </CardTitle>
              <p className="mt-1 text-xs font-semibold text-content-3">
                Showing {visibleTemplates.length} of {filtered.length} matching
                template{filtered.length === 1 ? "" : "s"}
                {statusFilter === "DISABLED" ? " in the disabled registry" : ""}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-surface-2">
              <TableRow className="border-none hover:bg-transparent">
                <TableHead className="px-6 text-[9px] font-black uppercase text-content-4 tracking-widest">
                  Template
                </TableHead>
                <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">
                  Type
                </TableHead>
                <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">
                  Business Family
                </TableHead>
                <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">
                  Status
                </TableHead>
                <TableHead className="text-right px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-20">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10">
                    <div className="rounded-2xl border border-danger-border bg-danger-bg px-5 py-4 text-sm text-danger-fg">
                      <div className="font-bold">
                        Template registry could not load.
                      </div>
                      <div className="mt-1 text-xs">
                        {(error as any)?.response?.data?.detail ||
                          (error as Error)?.message ||
                          "Unknown template registry error."}
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-24 text-[11px] font-black uppercase text-content-4 tracking-[0.2em]"
                  >
                    No templates found
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {visibleTemplates.map((t) => (
                    <TableRow
                      key={t.id}
                      className="group cursor-pointer border-b border-line transition-colors hover:bg-info-bg"
                    >
                      <TableCell className="px-6 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-black tracking-tight text-content-1 transition-colors group-hover:text-primary">
                            {t.name}
                          </span>
                          <span className="mt-1 text-[10px] font-semibold text-content-4">
                            ID {t.id.slice(0, 8)} · route{" "}
                            {t.routing_rule_name || "not linked"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-content-3">
                          {t.fg_type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-semibold text-content-3">
                          {t.commercial_family_name || "—"}
                        </span>
                      </TableCell>
                      <TableCell>{getStatusBadge(t)}</TableCell>
                      <TableCell className="text-right px-6">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          className="rounded-xl border-line bg-surface-1 font-bold hover:border-info-border hover:bg-info-bg hover:text-primary"
                        >
                          <Link href={`/engineering/templates/${t.id}`}>
                            Studio <ArrowRight className="h-3 w-3 ml-1" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length > visibleTemplates.length ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="px-6 py-4 text-center text-xs font-semibold text-content-3"
                      >
                        Showing first {visibleTemplates.length} matches. Use
                        search or status filters to narrow the registry.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
