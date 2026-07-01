"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { factoryService, Process } from "@/services/factory";
import { AxiosError } from "axios";
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  Settings2,
  Trash2,
  ArrowRight,
  Layout,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
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
  FormDescription,
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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/components/auth-provider";
import { Switch } from "@/components/ui/switch";

const apiErr = (
  err: AxiosError<{ detail?: string; error?: string; message?: string }>,
) =>
  err.response?.data?.detail ||
  err.response?.data?.error ||
  err.response?.data?.message ||
  err.message;

// --- Form Schema (Phase 53.5 - Physical Only) ---
const formSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  input_form: z
    .enum(["BULK", "ROLL", "NONE", ""])
    .refine((v) => v !== "", { message: "Select input form" }),
  output_form: z
    .enum(["BULK", "ROLL", ""])
    .refine((v) => v !== "", { message: "Select output form" }),
  roll_behavior: z
    .enum([
      "CREATE_NEW",
      "MODIFY_EXISTING",
      "MULTI_INPUT_COMBINE",
      "SPLIT",
      "NONE",
      "",
    ])
    .default(""),
  allowed_input_stock_forms: z.array(z.string()).default([]),
  allowed_output_stock_forms: z.array(z.string()).default([]),
  allows_optional_at_planning: z.boolean().default(false),
  allows_skip_after_previous_output: z.boolean().default(false),
  stock_form_output_mode: z
    .enum(["PRESERVE", "TARGET_DECIDES", "OPERATOR_DECIDES", "CONVERTS_FORM"])
    .default("PRESERVE"),
  stock_form_notes: z.string().optional(),
});

type ProcessFormValues = z.infer<typeof formSchema>;

const STOCK_FORM_OPTIONS = [
  { code: "OPEN_WEB", label: "Open web", hint: "Flat sheet/full web width" },
  {
    code: "LAYFLAT_TUBE",
    label: "Lay-flat tube",
    hint: "Tube measured as lay-flat width",
  },
  { code: "FOLDED_WEB", label: "Folded web", hint: "Folded sheet/folded roll" },
];

const OUTPUT_MODE_OPTIONS = [
  {
    code: "PRESERVE",
    label: "Preserve input",
    hint: "Printing/lamination style steps keep the incoming form.",
  },
  {
    code: "TARGET_DECIDES",
    label: "Target decides",
    hint: "The pouch/order target decides the output form.",
  },
  {
    code: "OPERATOR_DECIDES",
    label: "Operator decides",
    hint: "Extrusion can output sheet/tube/folded based on setup.",
  },
  {
    code: "CONVERTS_FORM",
    label: "Converts form",
    hint: "This process intentionally changes stock form.",
  },
] as const;

function StockFormChecklist({
  value,
  onChange,
  title,
  description,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  title: string;
  description: string;
}) {
  const selected = Array.isArray(value) ? value : [];
  const toggle = (code: string) => {
    onChange(
      selected.includes(code)
        ? selected.filter((item) => item !== code)
        : [...selected, code],
    );
  };
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <div className="mb-3">
        <div className="text-sm font-black text-content-1">{title}</div>
        <div className="text-xs text-content-3">{description}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {STOCK_FORM_OPTIONS.map((option) => {
          const active = selected.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => toggle(option.code)}
              className={`rounded-xl border p-3 text-left transition ${active ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2 hover:border-info-border"}`}
            >
              <div className="text-xs font-black uppercase tracking-[0.12em]">
                {option.label}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-content-3">
                {option.hint}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] font-semibold text-content-3">
        Leave all unchecked to keep legacy unrestricted behavior.
      </div>
    </div>
  );
}

function ProcessForm({
  initialData,
  onSubmit,
  isLoading,
}: {
  initialData?: Process;
  onSubmit: (data: ProcessFormValues) => void;
  isLoading: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: initialData?.code || "",
      name: initialData?.name || "",
      description: initialData?.description || "",
      input_form: initialData?.input_form || "",
      output_form: initialData?.output_form || "",
      roll_behavior: initialData?.roll_behavior || "",
      allowed_input_stock_forms: initialData?.allowed_input_stock_forms || [],
      allowed_output_stock_forms: initialData?.allowed_output_stock_forms || [],
      allows_optional_at_planning:
        initialData?.allows_optional_at_planning || false,
      allows_skip_after_previous_output:
        initialData?.allows_skip_after_previous_output || false,
      stock_form_output_mode: initialData?.stock_form_output_mode || "PRESERVE",
      stock_form_notes: initialData?.stock_form_notes || "",
    },
  });

  const inputForm = form.watch("input_form");
  const outputForm = form.watch("output_form");
  const derivedBehavior = (() => {
    if (!inputForm || !outputForm) return null; // Not selected yet
    if (inputForm === "BULK" && outputForm === "ROLL") return "CREATE_NEW";
    if (inputForm === "ROLL" && outputForm === "BULK") return "NONE";
    if (inputForm === "NONE") return "NONE";
    if (inputForm === "ROLL" && outputForm === "ROLL") return null; // User must pick
    return null;
  })();
  const behaviorLocked = derivedBehavior !== null && inputForm && outputForm;
  const immutableBehavior = Boolean(initialData?.id);
  useEffect(() => {
    if (behaviorLocked && derivedBehavior) {
      const currentValue = form.getValues("roll_behavior");
      if (currentValue !== derivedBehavior) {
        form.setValue("roll_behavior", derivedBehavior as any, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    }
  }, [inputForm, outputForm, behaviorLocked, derivedBehavior, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Help Text */}
        <Alert className="bg-info-bg border-info-border">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-primary text-sm">
            Process defines <strong>ONLY physical behavior</strong>. Quantity is
            always template-driven. Finished Good vs WIP is decided by Route
            position automatically.
          </AlertDescription>
        </Alert>

        {/* Stock-form capabilities */}
        <div className="space-y-4 rounded-3xl border border-info-border bg-info-bg p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-primary p-2 text-white">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-black text-content-1">
                Stock-form capability
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-content-3">
                This is where sheet/tube/folded compatibility is declared.
                Product and pouch style decide the required form; WCM and
                machine screens use these chips to filter, warn, and block
                incompatible rolls.
              </p>
            </div>
          </div>
          <FormField
            control={form.control}
            name="allowed_input_stock_forms"
            render={({ field }) => (
              <FormItem>
                <StockFormChecklist
                  value={field.value || []}
                  onChange={field.onChange}
                  title="Allowed input stock forms"
                  description="What physical roll forms this process can consume."
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="allowed_output_stock_forms"
            render={({ field }) => (
              <FormItem>
                <StockFormChecklist
                  value={field.value || []}
                  onChange={field.onChange}
                  title="Allowed output stock forms"
                  description="What physical roll forms this process can produce."
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="stock_form_output_mode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Output stock-form mode</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value || "PRESERVE"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select output mode" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OUTPUT_MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.code} value={option.code}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  {OUTPUT_MODE_OPTIONS.find(
                    (option) => option.code === field.value,
                  )?.hint || "How output stock form is resolved."}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Basic Info */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-content-2">
            Basic Information
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Process Code</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. EXT" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Process Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Extrusion" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Physics behavior notes..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* IO Configuration */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-content-2">
            IO Configuration
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="input_form"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Input Form</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select input form" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="BULK">Bulk</SelectItem>
                      <SelectItem value="ROLL">Roll</SelectItem>
                      <SelectItem value="NONE">None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    What form of material this process consumes
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="output_form"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Output Form</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select output form" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="BULK">Bulk</SelectItem>
                      <SelectItem value="ROLL">Roll</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    What form of material this process produces
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Behavior Flags */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-content-2">Behavior</h4>
          <div className="space-y-3">
            <FormField
              control={form.control}
              name="roll_behavior"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Roll Behavior</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || ""}
                    disabled={Boolean(behaviorLocked) || immutableBehavior}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select roll behavior" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="CREATE_NEW">Create New</SelectItem>
                      <SelectItem value="MODIFY_EXISTING">
                        Modify Existing
                      </SelectItem>
                      <SelectItem value="MULTI_INPUT_COMBINE">
                        Multi Input Combine
                      </SelectItem>
                      <SelectItem value="SPLIT">Split</SelectItem>
                      <SelectItem value="NONE">None</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {immutableBehavior
                      ? "Roll behavior is immutable after process creation."
                      : "Defines roll physics for this process"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Route behavior capabilities */}
        <div className="space-y-4 rounded-3xl border border-warning-border bg-warm p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-warning-fg p-2 text-white">
              <ArrowRight className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-sm font-black text-content-1">
                Route behavior capability
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-content-3">
                This is the process-level ceiling only. Existing route steps
                stay required by default; Template Route Dispatch decides where
                planner skip or WCM skip is actually allowed.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField
              control={form.control}
              name="allows_optional_at_planning"
              render={({ field }) => (
                <FormItem className="rounded-2xl border border-line bg-surface-1 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <FormLabel>Planner can make optional</FormLabel>
                      <FormDescription>
                        Route Dispatch may expose this process as skippable at
                        release/replan.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={Boolean(field.value)}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </div>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="allows_skip_after_previous_output"
              render={({ field }) => (
                <FormItem className="rounded-2xl border border-line bg-surface-1 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <FormLabel>WCM can skip after previous output</FormLabel>
                      <FormDescription>
                        The next batch step may be skipped only after the prior
                        step output is posted.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={Boolean(field.value)}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </div>

        {/* Stock-form notes */}
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-content-2">
              Stock-form notes
            </h4>
            <p className="mt-1 text-xs text-content-3">
              Optional operator guidance shown to admins when reviewing process
              physics.
            </p>
          </div>
          <FormField
            control={form.control}
            name="stock_form_notes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stock-form notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Example: Extrusion can output open web or lay-flat tube; printing preserves input form."
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Main Page ---
export default function ProcessesPage() {
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Process | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Process | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: processes } = useQuery({
    queryKey: ["processes"],
    queryFn: factoryService.getProcesses,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => {
      const payload = { ...data, roll_behavior: data.roll_behavior || "NONE" };
      return factoryService.createProcess(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      toast({ title: "Success", description: "Process created." });
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
    mutationFn: ({ id, data }: { id: string; data: any }) => {
      const payload = { ...data, roll_behavior: data.roll_behavior || "NONE" };
      return factoryService.updateProcess(id, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      toast({ title: "Success", description: "Process updated." });
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
    mutationFn: factoryService.deleteProcess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["processes"] });
      toast({ title: "Success", description: "Process deleted." });
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

  const processList = Array.isArray(processes) ? processes : [];
  const filteredProcesses = processList.filter(
    (proc) =>
      proc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      proc.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <FactoryPageLayout
      title="Processes"
      description="Physical transformation rules. FG/WIP is determined by Route position."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search processes..."
      actions={
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
              <Plus className="mr-2 h-4 w-4" /> Add Process
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Process</DialogTitle>
              <DialogDescription>
                Define process physics only. Quantities and consumption are
                handled by templates and execution engine.
              </DialogDescription>
            </DialogHeader>
            <ProcessForm
              onSubmit={(data) => createMutation.mutate(data)}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredProcesses.map((process) => {
          const statusRaw = String((process as any).status || "").toUpperCase();
          const statusCodeRaw = String(
            (process as any).status_code || "",
          ).toUpperCase();
          const explicitInactiveCodes = new Set([
            "INACTIVE",
            "DISABLED",
            "ARCHIVED",
            "DELETED",
          ]);
          const explicitActiveCodes = new Set([
            "ACTIVE",
            "ENABLED",
            "LIVE",
            "PUBLISHED",
          ]);
          const combinedStatusCode = statusRaw || statusCodeRaw;
          // Legacy rows often have stale `is_active=false`; treat unknown status as active.
          const isActive = explicitActiveCodes.has(combinedStatusCode)
            ? true
            : explicitInactiveCodes.has(combinedStatusCode)
              ? false
              : true;
          const isRollProcess =
            process.input_form === "ROLL" || process.output_form === "ROLL";
          const needsStockFormReview =
            isRollProcess &&
            !process.allowed_input_stock_forms?.length &&
            !process.allowed_output_stock_forms?.length;
          return (
            <Card
              key={process.id}
              className="rounded-2xl border-none shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 bg-surface-2 border-b border-line">
                <Badge
                  variant="outline"
                  className="bg-surface-1 text-xs font-mono"
                >
                  {process.code}
                </Badge>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:text-primary"
                    onClick={() => setEditingItem(process)}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                  {isAdminActor ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:text-danger-fg"
                      onClick={() => setItemToDelete(process)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-danger-bg text-danger-fg rounded-lg">
                      <Layout className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg text-content-1 leading-tight">
                        {process.name}
                      </h3>
                      <div className="flex items-center gap-1 text-xs text-content-3 mt-1">
                        {process.roll_behavior && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-5 px-1.5 bg-info-bg text-primary"
                          >
                            {process.roll_behavior.replace(/_/g, " ")}
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className={
                            !isActive
                              ? "text-[10px] h-5 px-1.5 border-danger-border text-danger-fg bg-danger-bg"
                              : "text-[10px] h-5 px-1.5 border-success-border text-success-fg bg-success-bg"
                          }
                        >
                          {!isActive ? "INACTIVE" : "ACTIVE"}
                        </Badge>
                        {needsStockFormReview ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 px-1.5 border-warning-border bg-warning-bg text-warning-fg"
                          >
                            REVIEW STOCK FORMS
                          </Badge>
                        ) : null}
                        {process.allows_optional_at_planning ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 px-1.5 border-warning-border bg-warning-bg text-warning-fg"
                          >
                            PLANNER OPTIONAL
                          </Badge>
                        ) : null}
                        {process.allows_skip_after_previous_output ? (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-5 px-1.5 border-info-border bg-info-bg text-primary"
                          >
                            WCM SKIPPABLE
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-line text-xs text-content-3">
                  <div className="flex items-center gap-1">
                    <span className="font-medium">In:</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {process.input_form}
                    </Badge>
                  </div>
                  <ArrowRight className="h-3 w-3 text-content-4" />
                  <div className="flex items-center gap-1">
                    <span className="font-medium">Out:</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {process.output_form}
                    </Badge>
                  </div>
                </div>
                {process.output_form === "ROLL" ||
                process.input_form === "ROLL" ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap gap-1">
                      {(process.allowed_input_stock_forms?.length
                        ? process.allowed_input_stock_forms
                        : ["Any input"]
                      ).map((form) => (
                        <Badge
                          key={`in-${form}`}
                          variant="outline"
                          className="border-info-border bg-surface-1 text-[10px] text-primary"
                        >
                          In {String(form).replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {(process.allowed_output_stock_forms?.length
                        ? process.allowed_output_stock_forms
                        : ["Any output"]
                      ).map((form) => (
                        <Badge
                          key={`out-${form}`}
                          variant="outline"
                          className="border-success-border bg-surface-1 text-[10px] text-success-fg"
                        >
                          Out {String(form).replace(/_/g, " ")}
                        </Badge>
                      ))}
                    </div>
                    <div className="text-[10px] font-black uppercase tracking-[0.12em] text-content-3">
                      Mode{" "}
                      {(process.stock_form_output_mode || "PRESERVE").replace(
                        /_/g,
                        " ",
                      )}
                    </div>
                    {needsStockFormReview ? (
                      <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] font-semibold leading-snug text-warning-fg">
                        Capability review pending. Until reviewed, this process
                        stays unrestricted so existing routes keep running.
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Process</DialogTitle>
            <DialogDescription>
              Update process physics, including sheet/tube/folded roll
              compatibility used by WCM allocation.
            </DialogDescription>
          </DialogHeader>
          {editingItem && (
            <ProcessForm
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
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{itemToDelete?.code}</strong>
              . Delete linked routing rules first; active jobs still protect
              process history.
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
    </FactoryPageLayout>
  );
}
