"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { routingService, RoutingRule } from "@/services/routing";
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
  interplant_required: z.boolean().default(false),
  is_active: z.boolean().default(true),
});

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
      interplant_required: initialData?.interplant_required || false,
      is_active: initialData?.is_active ?? true,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
            <DialogContent className="max-w-2xl">
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
                {rule.ordered_processes?.length || 0} Step Standard Process
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
        <DialogContent className="max-w-2xl">
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
