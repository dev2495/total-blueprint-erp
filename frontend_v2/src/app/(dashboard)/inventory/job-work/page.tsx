"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { AxiosError } from "axios";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import { inventoryService, JobWorkOrder } from "@/services/inventory";
import { factoryService } from "@/services/factory";
import { masterDataService } from "@/services/master-data";
import { productionService } from "@/services/production";
import { recipeService } from "@/services/recipes";

const createOrderSchema = z
  .object({
    plant: z.string().min(1, "Plant is required"),
    vendor: z.string().min(1, "Vendor is required"),
    mode: z.enum(["PLANNED_STEP", "EMERGENCY"]),
    sent_material_type: z.enum(["RM", "WIP", "FG"]),
    expected_return_type: z.enum(["RM", "WIP", "FG"]),
    production_job: z.string().optional(),
    emergency_reason: z.string().optional(),
    notes: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "PLANNED_STEP" && !value.production_job) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["production_job"],
        message: "Production job is required for planned-step jobwork.",
      });
    }
    if (
      value.mode === "EMERGENCY" &&
      !String(value.emergency_reason || "").trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["emergency_reason"],
        message: "Emergency reason is required.",
      });
    }
  });

type CreateOrderFormInput = z.input<typeof createOrderSchema>;
type CreateOrderFormOutput = z.output<typeof createOrderSchema>;

const receiveSchema = z.object({
  target_location_id: z.string().min(1, "Target location is required"),
  received_rolls: z
    .array(
      z.object({
        label_id: z.string().optional(),
        material_id: z.string().min(1, "Material is required"),
        thickness_micron: z.coerce.number().positive(),
        width_mm: z.coerce.number().positive(),
        weight_kg: z.coerce.number().positive(),
        grade_id: z.string().optional(),
        batch_no: z.string().optional(),
      }),
    )
    .min(1, "At least one return roll is required"),
});

type ReceiveFormInput = z.input<typeof receiveSchema>;
type ReceiveFormOutput = z.output<typeof receiveSchema>;

export default function JobWorkPage() {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["job-work-orders"],
    queryFn: inventoryService.getOrders,
  });

  return (
    <div className="space-y-6" data-testid="jobwork-page">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Job Work</h1>
          <p className="text-muted-foreground">
            Dispatch to vendor, receive back, and continue production lineage.
          </p>
        </div>
        <CreateOrderDialog />
      </div>

      {isLoading ? (
        <Loader2 className="animate-spin" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Plant</TableHead>
              <TableHead>Linked Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">
                  {order.id.substring(0, 8)}...
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      order.mode === "PLANNED_STEP" ? "default" : "secondary"
                    }
                  >
                    {order.mode || "EMERGENCY"}
                  </Badge>
                </TableCell>
                <TableCell>{order.vendor_name || "—"}</TableCell>
                <TableCell>{order.plant_name || "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {order.production_job_number || "—"}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{order.status}</Badge>
                </TableCell>
                <TableCell>
                  {new Date(order.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right gap-2 flex justify-end">
                  <DispatchDialog order={order} />
                  <ReceiveDialog order={order} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CreateOrderDialog() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<any[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const queryClient = useQueryClient();
  const { data: plants = [] } = useQuery({
    queryKey: ["plants"],
    queryFn: factoryService.getPlants,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: inventoryService.getVendors,
  });

  const form = useForm<CreateOrderFormInput, any, CreateOrderFormOutput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      mode: "EMERGENCY",
      sent_material_type: "WIP",
      expected_return_type: "WIP",
      notes: "",
    },
  });

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const rows = await productionService.getJobs({
        job_state: "RELEASED,EXECUTING,PAUSED",
      });
      setJobs(Array.isArray(rows) ? rows : []);
    } catch (error) {
      setJobs([]);
      toast.error("Could not load eligible production jobs.");
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadJobs();
  }, [loadJobs, open]);

  const selectedProductionJob = form.watch("production_job");
  const selectedMode = form.watch("mode");

  const { data: vendorCandidates = [] } = useQuery({
    queryKey: ["jobwork-vendor-candidates", selectedProductionJob],
    queryFn: () =>
      inventoryService.getJobWorkVendorCandidates({
        production_job_id: selectedProductionJob,
      }),
    enabled: Boolean(selectedProductionJob),
  });

  const candidateVendorMap = useMemo(
    () => new Map(vendorCandidates.map((row) => [row.id, row])),
    [vendorCandidates],
  );

  const vendorOptions = useMemo(() => {
    if (selectedProductionJob && vendorCandidates.length)
      return vendorCandidates;
    return (vendors || [])
      .filter((v) =>
        ["JOBWORK", "BOTH"].includes(String(v.type || "").toUpperCase()),
      )
      .filter((v) => String(v.status || "").toUpperCase() === "ACTIVE")
      .map((v) => ({
        id: v.id,
        name: v.name,
        code: v.code,
        turnaround_hours: Number(v.turnaround_hours || 48),
        qc_required: !!v.qc_required,
        vendor_capability_match: true,
        match_reasons: [],
      }));
  }, [selectedProductionJob, vendorCandidates, vendors]);

  const mutation = useMutation({
    mutationFn: inventoryService.createOrder,
    onSuccess: () => {
      toast.success("Job Work Order Created");
      setOpen(false);
      form.reset({
        mode: "EMERGENCY",
        sent_material_type: "WIP",
        expected_return_type: "WIP",
        notes: "",
      });
      queryClient.invalidateQueries({ queryKey: ["job-work-orders"] });
    },
    onError: (err: AxiosError<any>) => {
      const fieldErrors = err.response?.data?.field_errors;
      if (fieldErrors && typeof fieldErrors === "object") {
        Object.entries(fieldErrors).forEach(([field, value]) => {
          form.setError(field as any, {
            type: "server",
            message: String(value),
          });
        });
        toast.error("Please fix validation errors.");
        return;
      }
      toast.error(
        err.response?.data?.message ||
          err.response?.data?.error ||
          "Failed to create job work order.",
      );
    },
  });

  const eligibleJobs = useMemo(
    () =>
      (jobs || []).filter((job: any) =>
        ["RELEASED", "EXECUTING", "PAUSED"].includes(
          String(job.job_state || "").toUpperCase(),
        ),
      ),
    [jobs],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="jobwork-new-order">New Job Order</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New Job Work Order</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
            className="space-y-4"
          >
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="plant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plant</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="jobwork-create-plant">
                          <SelectValue placeholder="Select plant" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {plants.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mode</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="jobwork-create-mode">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="EMERGENCY">
                          Emergency Handoff
                        </SelectItem>
                        <SelectItem value="PLANNED_STEP">
                          Planned Route Step
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="production_job"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Production Job</FormLabel>
                  <Select
                    onOpenChange={(nextOpen) => {
                      if (nextOpen && !jobs.length) void loadJobs();
                    }}
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="jobwork-create-production-job">
                        <SelectValue placeholder="Select eligible job (optional for emergency)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {!jobsLoading && !eligibleJobs.length ? (
                        <SelectItem value="__no_eligible_jobs" disabled>
                          No released jobs available
                        </SelectItem>
                      ) : null}
                      {eligibleJobs.map((job: any) => (
                        <SelectItem key={job.id} value={job.id}>
                          {job.job_number} • {job.job_state} •{" "}
                          {job.process_code || "PROC"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {jobsLoading ? (
                    <p className="text-xs text-muted-foreground">
                      Loading eligible jobs...
                    </p>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vendor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="jobwork-create-vendor">
                        <SelectValue placeholder="Select compatible vendor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {vendorOptions.map((v: any) => {
                        const reason = candidateVendorMap
                          .get(v.id)
                          ?.match_reasons?.join(" | ");
                        return (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name} ({v.code}) • TAT {v.turnaround_hours}h
                            {v.qc_required ? " • QC" : ""}
                            {reason ? ` • ${reason}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedMode === "EMERGENCY" ? (
              <FormField
                control={form.control}
                name="emergency_reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emergency Reason</FormLabel>
                    <FormControl>
                      <Input
                        data-testid="jobwork-create-emergency-reason"
                        placeholder="Machine breakdown / capacity issue / urgent dispatch..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="sent_material_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sent Material</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="RM">Raw Material</SelectItem>
                        <SelectItem value="WIP">WIP</SelectItem>
                        <SelectItem value="FG">Finished Goods</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expected_return_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Expected Return</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="RM">Raw Material</SelectItem>
                        <SelectItem value="WIP">WIP</SelectItem>
                        <SelectItem value="FG">Finished Goods</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="jobwork-create-notes"
                      placeholder="Optional operational notes..."
                      {...field}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <Button
              type="submit"
              data-testid="jobwork-create-submit"
              disabled={mutation.isPending}
            >
              Create Order
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DispatchDialog({ order }: { order: JobWorkOrder }) {
  const [open, setOpen] = useState(false);
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: eligibleRolls = [], isLoading } = useQuery({
    queryKey: ["jobwork-eligible-rolls", order.id],
    queryFn: () => inventoryService.getJobWorkEligibleRolls(order.id),
    enabled: open && order.status !== "CLOSED",
  });

  const mutation = useMutation({
    mutationFn: (ids: string[]) =>
      inventoryService.dispatchOrder(order.id, { roll_ids: ids }),
    onSuccess: () => {
      toast.success("Jobwork dispatched.");
      setOpen(false);
      setSelectedRollIds([]);
      queryClient.invalidateQueries({ queryKey: ["job-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] });
    },
    onError: (err: AxiosError<{ detail?: string; error?: string }>) => {
      toast.error(
        err.response?.data?.detail ||
          err.response?.data?.error ||
          "Dispatch failed",
      );
    },
  });

  const toggleRoll = (id: string) => {
    setSelectedRollIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  if (order.status === "CLOSED") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`jobwork-dispatch-trigger-${order.id}`}
        >
          Dispatch
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Dispatch to {order.vendor_name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Select eligible rolls from plant {order.plant_name}. If this order
            is linked to a production job, source rolls are prioritized.
          </p>
          {isLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <div className="max-h-[360px] overflow-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[44px]"></TableHead>
                    <TableHead>Roll</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Weight (kg)</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Job</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eligibleRolls.map((roll) => {
                    const checked = selectedRollIds.includes(roll.id);
                    return (
                      <TableRow key={roll.id}>
                        <TableCell>
                          <Checkbox
                            data-testid={`jobwork-dispatch-roll-${order.id}-${roll.id}`}
                            checked={checked}
                            onCheckedChange={() => toggleRoll(roll.id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {roll.label_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{roll.status}</Badge>
                        </TableCell>
                        <TableCell>{roll.material_name || "—"}</TableCell>
                        <TableCell>
                          {Number(roll.weight_kg || 0).toFixed(3)}
                        </TableCell>
                        <TableCell>{roll.location_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {roll.production_job_number || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!eligibleRolls.length ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center text-muted-foreground py-8"
                      >
                        No eligible rolls found.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Selected:{" "}
              <span className="font-semibold">{selectedRollIds.length}</span>
            </div>
            <Button
              data-testid={`jobwork-dispatch-submit-${order.id}`}
              onClick={() => mutation.mutate(selectedRollIds)}
              disabled={mutation.isPending || selectedRollIds.length === 0}
            >
              Confirm Dispatch
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReceiveDialog({ order }: { order: JobWorkOrder }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: locations = [] } = useQuery({
    queryKey: ["locations", order.plant],
    queryFn: () => inventoryService.getLocations(order.plant),
    enabled: open && !!order.plant,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["materials-variants"],
    queryFn: masterDataService.getFilmVariants,
    enabled: open,
  });
  const { data: grades = [] } = useQuery({
    queryKey: ["recipe-grades"],
    queryFn: () => recipeService.getGrades(),
    enabled: open,
  });

  const form = useForm<ReceiveFormInput, any, ReceiveFormOutput>({
    resolver: zodResolver(receiveSchema),
    defaultValues: {
      target_location_id: "",
      received_rolls: [
        {
          label_id: "",
          material_id: "",
          thickness_micron: 0,
          width_mm: 0,
          weight_kg: 0,
          grade_id: "",
          batch_no: "",
        },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "received_rolls",
  });
  const watchedRows = form.watch("received_rolls");
  const materialById = useMemo(
    () =>
      new Map(
        (materials || []).map((material: any) => [
          String(material.id),
          material,
        ]),
      ),
    [materials],
  );

  const mutation = useMutation({
    mutationFn: (data: ReceiveFormOutput) =>
      inventoryService.receiveOrder(order.id, data),
    onSuccess: () => {
      toast.success("Received from jobwork.");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["job-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-rolls"] });
      queryClient.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (err: AxiosError<{ detail?: string; error?: string }>) => {
      toast.error(
        err.response?.data?.detail ||
          err.response?.data?.error ||
          "Receive failed",
      );
    },
  });

  if (order.status === "CLOSED") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          data-testid={`jobwork-receive-trigger-${order.id}`}
        >
          Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive from {order.vendor_name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((data) => {
            const missingGradeIndex = (data.received_rolls || []).findIndex(
              (row) => {
                const material = materialById.get(
                  String(row.material_id || ""),
                );
                return (
                  Boolean(material?.is_extrudable) &&
                  !String(row.grade_id || "").trim()
                );
              },
            );
            if (missingGradeIndex >= 0) {
              toast.error("Grade required", {
                description: `Return roll ${missingGradeIndex + 1} requires a grade for the selected extrudable variant.`,
              });
              return;
            }
            mutation.mutate(data);
          })}
        >
          <Form {...form}>
            <FormField
              control={form.control}
              name="target_location_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Location</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger
                        data-testid={`jobwork-receive-location-${order.id}`}
                      >
                        <SelectValue placeholder="Select target location" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {locations
                        .filter(
                          (l: any) =>
                            l.is_active &&
                            ["WAREHOUSE", "QC", "WIP", "FG"].includes(l.type),
                        )
                        .map((l: any) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name} ({l.code})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </Form>

          <div className="border rounded-md p-4 bg-muted/20">
            <div className="flex justify-between items-center mb-4">
              <h4 className="text-sm font-semibold">Return Rolls</h4>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  append({
                    label_id: "",
                    material_id: "",
                    thickness_micron: 0,
                    width_mm: 0,
                    weight_kg: 0,
                    grade_id: "",
                    batch_no: "",
                  })
                }
              >
                <Plus className="h-4 w-4 mr-1" /> Add Row
              </Button>
            </div>
            <div className="space-y-4">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 gap-3 border-b pb-4 last:border-b-0 md:grid-cols-2 xl:grid-cols-[2fr_1.25fr_1fr_1fr_1fr_1.5fr_1.25fr_auto]"
                >
                  {(() => {
                    const rowMaterial = materialById.get(
                      String(watchedRows?.[index]?.material_id || ""),
                    );
                    const gradeRequired = Boolean(rowMaterial?.is_extrudable);
                    return (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Material
                          </label>
                          <Select
                            onValueChange={(val) => {
                              form.setValue(
                                `received_rolls.${index}.material_id`,
                                val,
                              );
                              const selectedMaterial = materialById.get(
                                String(val),
                              );
                              if (!selectedMaterial?.is_extrudable) {
                                form.setValue(
                                  `received_rolls.${index}.grade_id`,
                                  "",
                                );
                              }
                            }}
                            value={form.watch(
                              `received_rolls.${index}.material_id`,
                            )}
                          >
                            <SelectTrigger
                              data-testid={
                                index === 0
                                  ? `jobwork-receive-material-${order.id}`
                                  : undefined
                              }
                            >
                              <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                              {materials.map((m: any) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name} ({m.code})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Label ID
                          </label>
                          <Input
                            data-testid={
                              index === 0
                                ? `jobwork-receive-label-${order.id}`
                                : undefined
                            }
                            placeholder="Auto if empty"
                            {...form.register(
                              `received_rolls.${index}.label_id`,
                            )}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Thickness (µm)
                          </label>
                          <Input
                            data-testid={
                              index === 0
                                ? `jobwork-receive-thickness-${order.id}`
                                : undefined
                            }
                            type="number"
                            step="0.1"
                            {...form.register(
                              `received_rolls.${index}.thickness_micron`,
                              { valueAsNumber: true },
                            )}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Width (mm)
                          </label>
                          <Input
                            data-testid={
                              index === 0
                                ? `jobwork-receive-width-${order.id}`
                                : undefined
                            }
                            type="number"
                            {...form.register(
                              `received_rolls.${index}.width_mm`,
                              { valueAsNumber: true },
                            )}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Weight (kg)
                          </label>
                          <Input
                            data-testid={
                              index === 0
                                ? `jobwork-receive-weight-${order.id}`
                                : undefined
                            }
                            type="number"
                            step="0.001"
                            {...form.register(
                              `received_rolls.${index}.weight_kg`,
                              { valueAsNumber: true },
                            )}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Grade {gradeRequired ? "(required)" : "(optional)"}
                          </label>
                          <Select
                            value={
                              form.watch(`received_rolls.${index}.grade_id`) ||
                              ""
                            }
                            onValueChange={(val) =>
                              form.setValue(
                                `received_rolls.${index}.grade_id`,
                                val,
                              )
                            }
                            disabled={!gradeRequired}
                          >
                            <SelectTrigger
                              data-testid={
                                index === 0
                                  ? `jobwork-receive-grade-${order.id}`
                                  : undefined
                              }
                            >
                              <SelectValue
                                placeholder={
                                  gradeRequired
                                    ? "Select grade"
                                    : "Not required"
                                }
                              />
                            </SelectTrigger>
                            <SelectContent>
                              {(grades || []).map((grade: any) => (
                                <SelectItem key={grade.id} value={grade.id}>
                                  {grade.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] uppercase font-bold text-muted-foreground">
                            Batch
                          </label>
                          <Input
                            {...form.register(
                              `received_rolls.${index}.batch_no`,
                            )}
                          />
                        </div>
                        <div className="flex justify-end pb-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            data-testid={`jobwork-receive-submit-${order.id}`}
            className="w-full"
            disabled={mutation.isPending}
          >
            Confirm Receipt
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
