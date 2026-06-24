"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { routingService, RoutingRule, RouteGraph, RouteGraphNode } from "@/services/routing";
import { factoryService, Process } from "@/services/factory";
import { AxiosError } from "axios";
import { PageHeader } from "@/components/ui-custom/page-header";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  ArrowRight,
  GitBranch,
  Factory,
  MoreHorizontal,
  Trash2,
  Edit2,
  CheckCircle2,
  PowerOff,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { StepEditor } from "./step-editor";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";

const apiErr = (
  err: AxiosError<{ detail?: string; error?: string; message?: string }>,
) =>
  err.response?.data?.detail ||
  err.response?.data?.error ||
  err.response?.data?.message ||
  err.message;

// --- Form Component ---
const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  ordered_processes: z
    .array(z.string())
    .min(1, "At least one step is required"),
  route_graph: z.any().optional(),
  interplant_required: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

const slug = (value: string) =>
  String(value || "NODE")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "NODE";

const nodeIdFor = (processCode: string, index: number) =>
  `step_${index + 1}_${slug(processCode)}`;

const processName = (processCode: string, allProcesses: Process[]) =>
  allProcesses.find((p) => p.code === processCode || p.id === processCode)?.name ||
  processCode;

const policyFromGraph = (graph?: RouteGraph | null) => ({
  default_batch_size_kg:
    graph?.execution_policy?.default_batch_size_kg === undefined
      ? ""
      : String(graph.execution_policy.default_batch_size_kg || ""),
  default_batch_size_pcs:
    graph?.execution_policy?.default_batch_size_pcs === undefined
      ? ""
      : String(graph.execution_policy.default_batch_size_pcs || ""),
});

function normalizeRouteGraph(
  orderedProcesses: string[],
  graph: RouteGraph | null | undefined,
): RouteGraph {
  const existingNodes = Array.isArray(graph?.nodes) ? graph?.nodes || [] : [];
  const usedIds = new Set<string>();
  const nodes: RouteGraphNode[] = orderedProcesses
    .filter(Boolean)
    .map((processCode, index) => {
      const previous =
        existingNodes.find((node) => Number(node.route_index) === index) ||
        existingNodes.find(
          (node) =>
            node.process_code === processCode &&
            !usedIds.has(String(node.id || "")),
        );
      const id = String(
        previous?.id || (previous as any)?.node_id || nodeIdFor(processCode, index),
      );
      usedIds.add(id);
      return {
        id,
        label: previous?.label || processCode,
        process_code: processCode,
        route_index: index,
        branch_key: previous?.branch_key || "MAIN",
        join_key: previous?.join_key || "",
        parallel_group: previous?.parallel_group || "",
        predecessor_node_ids:
          Array.isArray(previous?.predecessor_node_ids) &&
          previous.predecessor_node_ids.length
            ? previous.predecessor_node_ids
            : index > 0
              ? [nodeIdFor(orderedProcesses[index - 1], index - 1)]
              : [],
        matching_rule: previous?.matching_rule || {},
      };
    });
  const validIds = new Set(nodes.map((node) => node.id));
  const cleanedNodes = nodes.map((node, index) => {
    const predecessors = (node.predecessor_node_ids || []).filter(
      (id) => validIds.has(id) && id !== node.id,
    );
    return {
      ...node,
      route_index: index,
      predecessor_node_ids:
        index > 0 && !predecessors.length ? [nodes[index - 1].id] : predecessors,
    };
  });
  return {
    nodes: cleanedNodes,
    edges: cleanedNodes.flatMap((node) =>
      (node.predecessor_node_ids || []).map((id) => ({ from: id, to: node.id })),
    ),
    execution_policy: {
      allow_partial_movement:
        graph?.execution_policy?.allow_partial_movement ?? true,
      auto_release_parallel_branches:
        graph?.execution_policy?.auto_release_parallel_branches ?? true,
      join_requires_all_inputs:
        graph?.execution_policy?.join_requires_all_inputs ?? true,
      default_batch_size_kg: graph?.execution_policy?.default_batch_size_kg || "",
      default_batch_size_pcs: graph?.execution_policy?.default_batch_size_pcs || "",
    },
  };
}

function RouteGraphEditor({
  orderedProcesses,
  value,
  onChange,
  allProcesses,
}: {
  orderedProcesses: string[];
  value?: RouteGraph | null;
  onChange: (value: RouteGraph) => void;
  allProcesses: Process[];
}) {
  const graph = normalizeRouteGraph(orderedProcesses, value);
  const nodes = graph.nodes || [];
  const policy = policyFromGraph(graph);

  const updateGraph = (
    nextNodes: RouteGraphNode[],
    nextPolicy = graph.execution_policy || {},
  ) => {
    const validIds = new Set(nextNodes.map((node) => node.id));
    const cleanedNodes = nextNodes.map((node, index) => ({
      ...node,
      route_index: index,
      predecessor_node_ids: (node.predecessor_node_ids || []).filter(
        (id) => validIds.has(id) && id !== node.id,
      ),
    }));
    onChange({
      nodes: cleanedNodes,
      edges: cleanedNodes.flatMap((node) =>
        (node.predecessor_node_ids || []).map((id) => ({ from: id, to: node.id })),
      ),
      execution_policy: nextPolicy,
    });
  };

  const updateNode = (index: number, patch: Partial<RouteGraphNode>) => {
    updateGraph(nodes.map((node, i) => (i === index ? { ...node, ...patch } : node)));
  };

  const updatePolicy = (patch: Partial<NonNullable<RouteGraph["execution_policy"]>>) => {
    updateGraph(nodes, { ...(graph.execution_policy || {}), ...patch });
  };

  if (!orderedProcesses.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2 p-5 text-sm font-semibold text-content-3">
        Add production steps first. The route graph is generated from those steps.
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-info-border bg-info-bg/40 p-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-content-1">
            <GitBranch className="h-4 w-4 text-primary" /> Batch route graph
          </div>
          <p className="mt-1 text-xs font-semibold text-content-3">
            Define branches, join inputs, and live batch splitting. Ordered steps
            remain the fallback for simple routes.
          </p>
        </div>
        <Badge className="w-fit border-info-border bg-surface-1 text-primary" variant="outline">
          {nodes.length} nodes · {graph.edges?.length || 0} edges
        </Badge>
      </div>

      <div className="grid gap-3">
        {nodes.map((node, index) => {
          const earlierNodes = nodes.slice(0, index);
          const predecessorIds = new Set(node.predecessor_node_ids || []);
          return (
            <div key={`${node.id}-${index}`} className="rounded-xl border border-line bg-surface-1 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-[190px]">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">
                    Node {index + 1}
                  </div>
                  <div className="mt-1 text-sm font-black text-content-1">
                    {processName(node.process_code, allProcesses)}
                  </div>
                  <div className="mt-1 text-[11px] font-mono text-content-4">
                    {node.id}
                  </div>
                </div>
                <div className="grid flex-1 gap-3 md:grid-cols-3">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
                      Branch
                    </span>
                    <Input
                      value={node.branch_key || "MAIN"}
                      onChange={(event) =>
                        updateNode(index, {
                          branch_key:
                            event.target.value.trim().toUpperCase() || "MAIN",
                        })
                      }
                      placeholder="MAIN / A / B"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
                      Parallel group
                    </span>
                    <Input
                      value={node.parallel_group || ""}
                      onChange={(event) =>
                        updateNode(index, {
                          parallel_group: event.target.value.trim().toUpperCase(),
                        })
                      }
                      placeholder="LAM-1"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
                      Join key
                    </span>
                    <Input
                      value={node.join_key || ""}
                      onChange={(event) =>
                        updateNode(index, {
                          join_key: event.target.value.trim().toUpperCase(),
                        })
                      }
                      placeholder="JOIN-1"
                    />
                  </label>
                </div>
              </div>
              <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
                  Required inputs before this node releases
                </div>
                {earlierNodes.length ? (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {earlierNodes.map((previous) => (
                      <label
                        key={previous.id}
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs font-semibold text-content-2"
                      >
                        <Checkbox
                          checked={predecessorIds.has(previous.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(predecessorIds);
                            if (checked) next.add(previous.id);
                            else next.delete(previous.id);
                            updateNode(index, {
                              predecessor_node_ids: Array.from(next),
                            });
                          }}
                        />
                        <span>
                          {processName(previous.process_code, allProcesses)} ·{" "}
                          {previous.branch_key || "MAIN"}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs font-semibold text-content-3">
                    First node. It releases when the sales-line batch is released.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-xl border border-line bg-surface-1 p-3 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
            Default batch size KG
          </span>
          <Input
            inputMode="decimal"
            value={policy.default_batch_size_kg}
            onChange={(event) =>
              updatePolicy({ default_batch_size_kg: event.target.value })
            }
            placeholder="e.g. 500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
            Default batch size PCS
          </span>
          <Input
            inputMode="numeric"
            value={policy.default_batch_size_pcs}
            onChange={(event) =>
              updatePolicy({ default_batch_size_pcs: event.target.value })
            }
            placeholder="Optional"
          />
        </label>
        {[
          ["allow_partial_movement", "Allow partial movement"],
          ["auto_release_parallel_branches", "Auto-release parallel branches"],
          ["join_requires_all_inputs", "Join waits for all inputs"],
        ].map(([key, label]) => (
          <div key={key} className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2">
            <span className="text-xs font-black text-content-2">{label}</span>
            <Switch
              checked={Boolean((graph.execution_policy as any)?.[key])}
              onCheckedChange={(checked) =>
                updatePolicy({ [key]: checked } as any)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function RoutingRuleForm({
  initialData,
  allProcesses,
  onSubmit,
  isLoading,
}: {
  initialData?: RoutingRule;
  allProcesses: Process[];
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initialData?.name || "",
      description: initialData?.description || "",
      ordered_processes: initialData?.ordered_processes || [],
      route_graph: normalizeRouteGraph(
        initialData?.ordered_processes || [],
        initialData?.route_graph,
      ),
      interplant_required: initialData?.interplant_required || false,
      is_active: initialData?.is_active ?? true,
    },
  });
  const orderedProcesses = form.watch("ordered_processes") || [];

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) =>
          onSubmit({
            ...data,
            route_graph: normalizeRouteGraph(
              data.ordered_processes,
              data.route_graph,
            ),
          }),
        )}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Route Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Standard 3-Layer PE" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input
                  placeholder="Brief details about this routing..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="ordered_processes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <GitBranch className="h-3 w-3" /> Process Sequence
              </FormLabel>
              <FormControl>
                <StepEditor
                  value={field.value}
                  onChange={field.onChange}
                  allProcesses={allProcesses}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="route_graph"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <RouteGraphEditor
                  orderedProcesses={orderedProcesses}
                  value={field.value}
                  onChange={field.onChange}
                  allProcesses={allProcesses}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="interplant_required"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="text-xs">Interplant Logistics?</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                <FormLabel className="text-xs">Active Status</FormLabel>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-primary hover:bg-primary"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Routing Rule
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Main Page ---
export default function RoutingRulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveRole, user } = useAuth();
  const isAdminActor = Boolean(
    user?.is_owner ||
      user?.is_superuser ||
      ["ADMIN", "SUPER_ADMIN", "OWNER"].includes(
        String(effectiveRole || user?.role_info?.code || "").toUpperCase(),
      ),
  );
  const canManageRoutes =
    isAdminActor ||
    Boolean(
      user?.entitlements?.permissions?.includes("*") ||
        user?.entitlements?.permissions?.includes("routing.manage") ||
        user?.entitlements?.permissions?.includes("templates.manage") ||
        user?.extra_permissions?.includes("routing.manage") ||
        user?.extra_permissions?.includes("templates.manage"),
    );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RoutingRule | null>(null);
  const [itemToDelete, setItemToDelete] = useState<RoutingRule | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "DISABLED" | "ALL">("ACTIVE");

  const { data: rules, isLoading } = useQuery({
    queryKey: ["routing-rules"],
    queryFn: () => routingService.getRules({ include_inactive: "1" }),
  });

  const { data: processes } = useQuery({
    queryKey: ["processes"],
    queryFn: factoryService.getProcesses,
  });

  const createMutation = useMutation({
    mutationFn: routingService.createRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast({ title: "Success", description: "Routing Rule created." });
      setIsCreateOpen(false);
    },
    onError: (
      err: AxiosError<{ detail?: string; error?: string; message?: string }>,
    ) =>
      toast({
        title: "Error",
        description: apiErr(err),
        variant: "destructive",
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: z.infer<typeof formSchema>;
    }) => routingService.updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast({ title: "Success", description: "Routing Rule updated." });
      setEditingItem(null);
    },
    onError: (
      err: AxiosError<{ detail?: string; error?: string; message?: string }>,
    ) =>
      toast({
        title: "Error",
        description: apiErr(err),
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: routingService.deleteRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast({ title: "Success", description: "Routing Rule deleted." });
    },
    onError: (
      err: AxiosError<{ detail?: string; error?: string; message?: string }>,
    ) =>
      toast({
        title: "Error",
        description: apiErr(err),
        variant: "destructive",
      }),
  });

  const disableMutation = useMutation({
    mutationFn: routingService.disableRule,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] });
      toast({ title: "Route disabled", description: "Route is hidden from new template selectors." });
    },
    onError: (
      err: AxiosError<{ detail?: string; error?: string; message?: string }>,
    ) =>
      toast({
        title: "Error",
        description: apiErr(err),
        variant: "destructive",
      }),
  });

  const routeList = rules || [];
  const activeCount = routeList.filter((rule) => rule.is_active).length;
  const disabledCount = routeList.filter((rule) => !rule.is_active).length;
  const filteredRules = routeList.filter((rule) => {
    if (statusFilter === "ACTIVE") return rule.is_active;
    if (statusFilter === "DISABLED") return !rule.is_active;
    return true;
  });

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Routing Studio"
        description="Design production workflows and process sequences."
        actions={
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-success-fg hover:bg-success-fg shadow-sm">
                <Plus className="mr-2 h-4 w-4" /> New Route
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New Routing Rule</DialogTitle>
              </DialogHeader>
              <RoutingRuleForm
                allProcesses={processes || []}
                onSubmit={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center h-[50vh] text-content-4">
          <Loader2 className="h-8 w-8 animate-spin text-success-border" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-1 p-3">
            {([
              ["ACTIVE", "Active", activeCount],
              ["DISABLED", "Disabled", disabledCount],
              ["ALL", "All", routeList.length],
            ] as Array<[typeof statusFilter, string, number]>).map(([value, label, count]) => (
              <Button
                key={value}
                variant={statusFilter === value ? "default" : "ghost"}
                size="sm"
                onClick={() => setStatusFilter(value)}
                className={cn(
                  "h-9 rounded-xl px-4 text-[10px] font-black uppercase tracking-wider",
                  statusFilter === value
                    ? "bg-surface-3 text-white"
                    : "text-content-3 hover:text-content-1",
                )}
              >
                {label} · {count}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {filteredRules.map((rule: any) => (
            <Card
              key={rule.id}
              className="group hover:border-success-border transition-all duration-300"
            >
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold">
                      {rule.name}
                    </CardTitle>
                    {!rule.is_active && (
                      <Badge variant="destructive" className="text-[10px] h-5">
                        Inactive
                      </Badge>
                    )}
                    {rule.interplant_required && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] h-5 bg-warning-bg text-warning-fg border-warning-border"
                      >
                        Interplant
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-content-4 font-mono">
                    {rule.description || "No description provided."}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="outline" className="border-info-border bg-info-bg text-primary">
                      {(rule.route_graph?.nodes || []).length || rule.ordered_processes?.length || 0} route nodes
                    </Badge>
                    {(rule.route_graph?.edges || []).length ? (
                      <Badge variant="outline" className="border-success-border bg-success-bg text-success-fg">
                        Graph edges: {rule.route_graph.edges.length}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-line bg-surface-2 text-content-3">
                        Linear fallback
                      </Badge>
                    )}
                    {rule.route_graph?.execution_policy?.default_batch_size_kg ||
                    rule.route_graph?.execution_policy?.default_batch_size_pcs ? (
                      <Badge variant="outline" className="border-warning-border bg-warning-bg text-warning-fg">
                        Batch split configured
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 -mr-2"
                    >
                      <MoreHorizontal className="h-4 w-4 text-content-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditingItem(rule)}>
                      <Edit2 className="h-3.5 w-3.5 mr-2" /> Edit
                    </DropdownMenuItem>
                    {canManageRoutes && rule.is_active ? (
                      <DropdownMenuItem
                        className="text-warning-fg focus:text-warning-fg"
                        onClick={() => {
                          if (window.confirm("Disable this route and hide it from new template selectors?")) {
                            disableMutation.mutate(rule.id);
                          }
                        }}
                      >
                        <PowerOff className="h-3.5 w-3.5 mr-2" /> Disable
                      </DropdownMenuItem>
                    ) : null}
                    {canManageRoutes ? (
                      <DropdownMenuItem
                        className="text-danger-fg focus:text-danger-fg"
                        onClick={() => setItemToDelete(rule)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent>
                <div className="relative pt-2 pb-2">
                  {/* Visual Flow Line */}
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-surface-2 -z-10" />

                  <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide mask-linear-fade">
                    {rule.ordered_processes?.map(
                      (procId: string, i: number, arr: string[]) => {
                        const proc = processes?.find(
                          (p: any) => p.id === procId || p.code === procId,
                        );
                        return (
                          <div key={i} className="flex items-center shrink-0">
                            <div
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold whitespace-nowrap shadow-sm bg-surface-1",
                                i === 0
                                  ? "border-success-border text-success-fg"
                                  : i === arr.length - 1
                                    ? "border-info-border text-primary"
                                    : "border-line text-content-3",
                              )}
                            >
                              {i === 0 ? (
                                <Factory className="h-3 w-3" />
                              ) : (
                                <div className="h-1.5 w-1.5 rounded-full bg-line" />
                              )}
                              {proc?.name || procId}
                            </div>
                            {i < arr.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-content-4 mx-1 shrink-0" />
                            )}
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              </CardContent>
              <CardFooter className="pt-0 pb-4 text-[10px] text-content-4 font-mono">
                <CheckCircle2 className="h-3 w-3 mr-1.5 text-success-fg" />
                {rule.ordered_processes?.length || 0} steps ·{" "}
                {(rule.route_graph?.edges || []).length ? "graph execution" : "linear execution"}
              </CardFooter>
            </Card>
          ))}
          {/* Empty State */}
          {filteredRules.length === 0 && (
            <div className="col-span-full py-12 text-center border-2 border-dashed border-line rounded-xl">
              <p className="text-content-4 text-sm">
                No routing rules in this view.
              </p>
            </div>
          )}
        </div>
        </>
      )}

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Routing Rule</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <RoutingRuleForm
              allProcesses={processes || []}
              initialData={editingItem}
              onSubmit={(data) =>
                updateMutation.mutate({ id: editingItem.id, data })
              }
              isLoading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!itemToDelete}
        onOpenChange={(open) => !open && setItemToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Route?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the sequence{" "}
              <strong>{itemToDelete?.name}</strong>. Disable linked templates
              first; active jobs still protect their route history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (itemToDelete) {
                  deleteMutation.mutate(itemToDelete.id);
                  setItemToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
