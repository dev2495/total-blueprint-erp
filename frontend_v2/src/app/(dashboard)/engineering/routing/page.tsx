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
  ArrowDown,
  GitBranch,
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

type RouteFlowStage = {
  stageIndex: number;
  nodes: RouteGraphNode[];
};

const flowTone = (index: number) =>
  [
    "border-info-border bg-info-bg text-primary",
    "border-success-border bg-success-bg text-success-fg",
    "border-warning-border bg-warning-bg text-warning-fg",
    "border-order-border bg-order-bg text-order-fg",
  ][index % 4];

function existingNodesFor(
  orderedProcesses: string[],
  graph: RouteGraph | null | undefined,
): RouteGraphNode[] {
  const rawNodes = Array.isArray(graph?.nodes) ? graph?.nodes || [] : [];
  const usedIds = new Set<string>();
  return orderedProcesses.filter(Boolean).map((processCode, index) => {
    const previous =
      rawNodes.find(
        (node) =>
          node.process_code === processCode &&
          !usedIds.has(String(node.id || "")),
      ) ||
      rawNodes.find(
        (node) =>
          Number(node.route_index) === index &&
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
      route_index:
        Number.isFinite(Number(previous?.route_index))
          ? Number(previous?.route_index)
          : index,
      branch_key: previous?.branch_key || "MAIN",
      join_key: previous?.join_key || "",
      parallel_group: previous?.parallel_group || "",
      predecessor_node_ids: Array.isArray(previous?.predecessor_node_ids)
        ? previous?.predecessor_node_ids || []
        : [],
      matching_rule: previous?.matching_rule || {},
    };
  });
}

function compactStageIndexes(nodes: RouteGraphNode[]) {
  const uniqueIndexes = Array.from(
    new Set(nodes.map((node, index) => Number(node.route_index ?? index))),
  ).sort((a, b) => a - b);
  const indexMap = new Map(uniqueIndexes.map((value, index) => [value, index]));
  return nodes.map((node, index) => ({
    ...node,
    route_index: indexMap.get(Number(node.route_index ?? index)) ?? index,
  }));
}

function parallelFlagsFromGraph(
  orderedProcesses: string[],
  graph: RouteGraph | null | undefined,
) {
  const nodes = compactStageIndexes(existingNodesFor(orderedProcesses, graph));
  return orderedProcesses.map(
    (_processCode, index) =>
      index > 0 && nodes[index]?.route_index === nodes[index - 1]?.route_index,
  );
}

function groupRouteStages(nodes: RouteGraphNode[]): RouteFlowStage[] {
  const groups = new Map<number, RouteGraphNode[]>();
  compactStageIndexes(nodes).forEach((node) => {
    const stageIndex = Number(node.route_index || 0);
    groups.set(stageIndex, [...(groups.get(stageIndex) || []), node]);
  });
  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([stageIndex, nodes]) => ({ stageIndex, nodes }));
}

function buildRouteGraphFromFlags(
  orderedProcesses: string[],
  graph: RouteGraph | null | undefined,
  parallelFlags: boolean[],
): RouteGraph {
  const existingNodes = existingNodesFor(orderedProcesses, graph);
  let stageIndex = 0;
  const draft = orderedProcesses.filter(Boolean).map((processCode, index) => {
    if (index > 0 && !parallelFlags[index]) stageIndex += 1;
    const previous = existingNodes[index];
    return {
      id: previous?.id || nodeIdFor(processCode, index),
      label: previous?.label || processCode,
      process_code: processCode,
      route_index: stageIndex,
      matching_rule: previous?.matching_rule || {},
    };
  });

  const stageCounts = new Map<number, number>();
  draft.forEach((node) => {
    stageCounts.set(node.route_index, (stageCounts.get(node.route_index) || 0) + 1);
  });

  const stagePositions = new Map<number, number>();
  const nodes: RouteGraphNode[] = draft.map((node) => {
    const position = (stagePositions.get(node.route_index) || 0) + 1;
    stagePositions.set(node.route_index, position);
    const hasParallelPeers = (stageCounts.get(node.route_index) || 0) > 1;
    const previousStageIsParallel =
      node.route_index > 0 && (stageCounts.get(node.route_index - 1) || 0) > 1;
    return {
      ...node,
      branch_key: hasParallelPeers ? `B${position}` : "MAIN",
      parallel_group: hasParallelPeers ? `STAGE_${node.route_index + 1}` : "",
      join_key: previousStageIsParallel ? `JOIN_${node.route_index + 1}` : "",
      predecessor_node_ids: [],
    };
  });

  const byStage = new Map<number, RouteGraphNode[]>();
  nodes.forEach((node) => {
    byStage.set(node.route_index, [...(byStage.get(node.route_index) || []), node]);
  });
  const nodesWithDeps = nodes.map((node) => ({
    ...node,
    predecessor_node_ids: (byStage.get(node.route_index - 1) || []).map(
      (previous) => previous.id,
    ),
  }));

  return {
    nodes: nodesWithDeps,
    edges: nodesWithDeps.flatMap((node) =>
      (node.predecessor_node_ids || []).map((id) => ({ from: id, to: node.id })),
    ),
  };
}

function normalizeRouteGraph(
  orderedProcesses: string[],
  graph: RouteGraph | null | undefined,
): RouteGraph {
  return buildRouteGraphFromFlags(
    orderedProcesses,
    graph,
    parallelFlagsFromGraph(orderedProcesses, graph),
  );
}

function RouteFlowPreview({
  orderedProcesses,
  graph,
  allProcesses,
  compact = false,
}: {
  orderedProcesses: string[];
  graph?: RouteGraph | null;
  allProcesses: Process[];
  compact?: boolean;
}) {
  const normalized = normalizeRouteGraph(orderedProcesses, graph);
  const stages = groupRouteStages(normalized.nodes || []);

  if (!orderedProcesses.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2 p-5 text-sm font-semibold text-content-3">
        Add production steps first. The flow preview will appear here.
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {stages.map((stage, stagePosition) => (
        <div key={stage.stageIndex} className="flex flex-col items-center">
          <div
            className={cn(
              "w-full rounded-2xl border bg-surface-1 p-3 transition-colors",
              stage.nodes.length > 1
                ? "border-warning-border bg-warning-bg/50"
                : "border-line",
              compact && "rounded-xl p-2",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                Stage {stagePosition + 1}
              </span>
              {stage.nodes.length > 1 ? (
                <span className="rounded-full border border-warning-border bg-surface-1 px-2 py-0.5 text-[10px] font-black text-warning-fg">
                  + parallel
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {stage.nodes.map((node, nodeIndex) => (
                <div key={node.id} className="flex items-center gap-2">
                  {nodeIndex > 0 ? (
                    <span className="text-base font-black text-warning-fg">+</span>
                  ) : null}
                  <span
                    className={cn(
                      "inline-flex min-h-10 items-center rounded-xl border px-3 py-2 text-xs font-black shadow-sm",
                      flowTone(nodeIndex + stagePosition),
                      compact && "min-h-8 px-2 py-1 text-[11px]",
                    )}
                  >
                    {processName(node.process_code, allProcesses)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {stagePosition < stages.length - 1 ? (
            <div className="flex flex-col items-center py-1 text-content-4">
              <ArrowDown className="h-4 w-4" />
              {stage.nodes.length > 1 && !compact ? (
                <span className="text-[10px] font-bold">match all, then continue</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function RouteFlowBuilder({
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
  const flags = parallelFlagsFromGraph(orderedProcesses, graph);
  const parallelGroups = groupRouteStages(nodes).filter(
    (stage) => stage.nodes.length > 1,
  ).length;

  const setRunsWithPrevious = (index: number, checked: boolean) => {
    const nextFlags = [...flags];
    nextFlags[index] = checked;
    onChange(buildRouteGraphFromFlags(orderedProcesses, graph, nextFlags));
  };

  if (!orderedProcesses.length) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5 text-sm font-semibold text-content-3">
        Add route steps above. Then mark any step that can run with the step
        before it.
      </div>
    );
  }

  return (
    <div className="rounded-[1.5rem] border border-info-border bg-info-bg/40 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black text-content-1">
            <GitBranch className="h-4 w-4 text-primary" /> Route flow
          </div>
          <p className="mt-1 max-w-2xl text-xs font-semibold leading-5 text-content-3">
            Route Master only decides the path. Use <span className="font-black text-warning-fg">+</span>{" "}
            when two processes can run at the same time; the next stage waits
            for every process in that row.
          </p>
        </div>
        <Badge className="w-fit border-info-border bg-surface-1 text-primary" variant="outline">
          {groupRouteStages(nodes).length} stages · {parallelGroups} parallel
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <RouteFlowPreview
            orderedProcesses={orderedProcesses}
            graph={graph}
            allProcesses={allProcesses}
          />
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-line bg-surface-1 p-3 text-xs font-semibold text-content-3">
            Batch size, lot prefix, movement flags, and release rules are set in
            Template Studio.
          </div>
          {nodes.slice(1).map((node, offset) => {
            const index = offset + 1;
            const previous = nodes[index - 1];
            const runsTogether = Boolean(flags[index]);
            return (
              <div
                key={node.id}
                className={cn(
                  "rounded-2xl border px-3 py-3 transition-colors",
                  runsTogether
                    ? "border-warning-border bg-warning-bg"
                    : "border-line bg-surface-1",
                )}
              >
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-content-4">
                  Step {index + 1}
                </div>
                <div className="mt-1 text-xs font-black text-content-1">
                  {processName(node.process_code, allProcesses)}
                </div>
                <div className="mt-2 text-[11px] font-semibold text-content-3">
                  {runsTogether ? (
                    <>
                      Runs with {processName(previous.process_code, allProcesses)}
                    </>
                  ) : (
                    <>
                      Starts after {processName(previous.process_code, allProcesses)}
                    </>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={runsTogether ? "default" : "outline"}
                  onClick={() => setRunsWithPrevious(index, !runsTogether)}
                  className={cn(
                    "mt-3 h-8 w-full rounded-xl text-[11px] font-black",
                    runsTogether
                      ? "bg-warning-fg text-white hover:bg-warning-fg/90"
                      : "bg-surface-1",
                  )}
                >
                  {runsTogether ? "+ Runs together" : "↓ Starts after previous"}
                </Button>
              </div>
            );
          })}
        </div>
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
                <GitBranch className="h-3 w-3" /> 1. Route steps
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
                <RouteFlowBuilder
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
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(24);

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
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredRules = routeList
    .filter((rule) => {
      if (statusFilter === "ACTIVE") return rule.is_active;
      if (statusFilter === "DISABLED") return !rule.is_active;
      return true;
    })
    .filter((rule) => {
      if (!normalizedSearch) return true;
      const searchable = [
        rule.name,
        rule.description,
        ...(Array.isArray(rule.ordered_processes) ? rule.ordered_processes : []),
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return searchable.includes(normalizedSearch);
    });
  const visibleRules = filteredRules.slice(0, visibleCount);
  const remainingRules = Math.max(filteredRules.length - visibleRules.length, 0);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Routing Studio"
        description="Define only how production moves: steps, parallel plus branches, and joins."
        actions={
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-success-fg hover:bg-success-fg shadow-sm">
                <Plus className="mr-2 h-4 w-4" /> New Route
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New route flow</DialogTitle>
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
                onClick={() => {
                  setStatusFilter(value);
                  setVisibleCount(24);
                }}
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
            <div className="min-w-[220px] flex-1 sm:ml-2">
              <Input
                data-testid="routing-rule-search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setVisibleCount(24);
                }}
                placeholder="Search route, process, or description"
                aria-label="Search routing rules"
              />
            </div>
            <span
              className="text-xs font-semibold text-content-4"
              data-testid="routing-rule-visible-count"
            >
              Showing {visibleRules.length} of {filteredRules.length}
            </span>
          </div>
          <div
            className="grid grid-cols-1 xl:grid-cols-2 gap-6"
            data-testid="routing-rule-grid"
          >
          {visibleRules.map((rule: any) => {
            const normalizedRuleGraph = normalizeRouteGraph(
              rule.ordered_processes || [],
              rule.route_graph,
            );
            const stages = groupRouteStages(normalizedRuleGraph.nodes || []);
            const parallelCount = stages.filter((stage) => stage.nodes.length > 1).length;
            return (
            <Card
              key={rule.id}
              data-testid="routing-rule-card"
              className="group hover:border-success-border transition-all duration-300"
            >
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base font-bold" data-testid="routing-rule-name">
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
                      {stages.length} stages
                    </Badge>
                    {parallelCount ? (
                      <Badge variant="outline" className="border-warning-border bg-warning-bg text-warning-fg">
                        {parallelCount} + branch{parallelCount === 1 ? "" : "es"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-line bg-surface-2 text-content-3">
                        straight flow
                      </Badge>
                    )}
                    <Badge variant="outline" className="border-success-border bg-success-bg text-success-fg">
                      flow only
                    </Badge>
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
                <RouteFlowPreview
                  orderedProcesses={rule.ordered_processes || []}
                  graph={normalizedRuleGraph}
                  allProcesses={processes || []}
                  compact
                />
              </CardContent>
              <CardFooter className="pt-0 pb-4 text-[10px] text-content-4 font-mono">
                <CheckCircle2 className="h-3 w-3 mr-1.5 text-success-fg" />
                {rule.ordered_processes?.length || 0} steps · Route Master controls flow only
              </CardFooter>
            </Card>
            );
          })}
          {/* Empty State */}
          {filteredRules.length === 0 && (
            <div className="col-span-full py-12 text-center border-2 border-dashed border-line rounded-xl">
              <p className="text-content-4 text-sm">
                No routing rules in this view.
              </p>
            </div>
          )}
        </div>
        {remainingRules > 0 && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => setVisibleCount((count) => count + 24)}
              data-testid="routing-rule-show-more"
            >
              Show 24 more · {remainingRules} remaining
            </Button>
          </div>
        )}
        </>
      )}

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit route flow</DialogTitle>
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
