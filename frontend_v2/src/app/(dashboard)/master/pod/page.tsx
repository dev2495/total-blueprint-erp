"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import {
  Factory,
  Loader2,
  Package,
  PackageOpen,
  Plus,
  Radio,
} from "lucide-react";

import {
  masterDataService,
  type Material,
  type PodSkuVariant,
} from "@/services/master-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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
import { MasterRegistryShell } from "@/components/master/master-registry-shell";

const podFormSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  pod_type: z.enum(["SINGLE", "DOUBLE"]),
  pod_fixed_height_mm: z.coerce.number().positive("Height must be > 0"),
  pod_thickness_micron: z.coerce.number().positive("Thickness must be > 0"),
  pod_panel_count: z.coerce.number().int().positive("Panel count must be > 0"),
  density_gcm3: z.coerce.number().positive("Density must be > 0"),
  pod_is_inhouse_produced: z.boolean(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

type PodFormInput = z.input<typeof podFormSchema>;
type PodFormOutput = z.output<typeof podFormSchema>;

function PODForm({
  initialData,
  isLoading,
  onSubmit,
}: {
  initialData?: Material;
  isLoading: boolean;
  onSubmit: (data: PodFormOutput) => void;
}) {
  const isCore = Boolean(initialData?.code?.startsWith("POD-"));
  const form = useForm<PodFormInput, any, PodFormOutput>({
    resolver: zodResolver(podFormSchema),
    defaultValues: {
      code: initialData?.code || "",
      name: initialData?.name || "",
      pod_type: (initialData?.pod_type as "SINGLE" | "DOUBLE") || "SINGLE",
      pod_fixed_height_mm: Number(initialData?.pod_fixed_height_mm ?? 200),
      pod_thickness_micron: Number(initialData?.pod_thickness_micron ?? 30),
      pod_panel_count: Number(initialData?.pod_panel_count ?? 1),
      density_gcm3: Number(initialData?.density_gcm3 ?? 0.92),
      pod_is_inhouse_produced: Boolean(
        initialData?.pod_is_inhouse_produced ?? true,
      ),
      status: (initialData?.status as "ACTIVE" | "INACTIVE") || "ACTIVE",
    },
  });

  return (
    <Form {...form}>
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code</FormLabel>
                <FormControl>
                  <Input {...field} disabled={isCore || isLoading} />
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
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} disabled={isLoading} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="pod_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>POD Type</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={isLoading}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="SINGLE">Single</SelectItem>
                    <SelectItem value="DOUBLE">Double</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="status"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={isLoading}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="pod_fixed_height_mm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fixed Height (mm)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    value={typeof field.value === "number" ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pod_thickness_micron"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Thickness (micron)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.001"
                    value={typeof field.value === "number" ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="pod_panel_count"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Panel Count</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="1"
                    value={typeof field.value === "number" ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="density_gcm3"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Density (g/cm3)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.0001"
                    value={typeof field.value === "number" ? field.value : ""}
                    onChange={(e) => field.onChange(e.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                    disabled={isLoading}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="pod_is_inhouse_produced"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <FormLabel>In-house capable</FormLabel>
                <div className="mt-0.5 text-[11px] text-content-3">
                  Manual Product Master link supplies the production contract.
                </div>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isLoading}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}

// --- Main Page ---
export default function PODPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Material | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Material | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: podMaterials = [] } = useQuery({
    queryKey: ["pod-materials"],
    queryFn: masterDataService.getPODMaterials,
  });
  const { data: podSkuVariants = [] } = useQuery({
    queryKey: ["master-pod-sku-variants", "active"],
    queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
    staleTime: 60_000,
  });

  const podVariantsByMaterial = useMemo(() => {
    const map = new Map<string, PodSkuVariant[]>();
    for (const variant of podSkuVariants) {
      const list = map.get(variant.material) || [];
      list.push(variant);
      map.set(variant.material, list);
    }
    return map;
  }, [podSkuVariants]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return podMaterials;
    return podMaterials.filter((row) => {
      const skuRows = podVariantsByMaterial.get(row.id) || [];
      const hay = [
        row.code,
        row.name,
        row.pod_type,
        row.product_master_link?.master_code,
        row.product_master_link?.variant_code,
        ...skuRows.flatMap((sku) => [
          sku.code,
          sku.name,
          sku.pod_sku_code,
          sku.material_code,
        ]),
      ]
        .map((value) => String(value || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [podMaterials, podVariantsByMaterial, searchQuery]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const pmBacked = filtered.filter((row) => !!row.product_master_link).length;
    const unlinkedInHouse = filtered.filter(
      (row) => row.pod_is_inhouse_produced && !row.product_master_link,
    ).length;
    return {
      total,
      pmBacked,
      unlinkedInHouse,
      skuVariants: podSkuVariants.length,
    };
  }, [filtered, podSkuVariants.length]);

  const createMutation = useMutation({
    mutationFn: masterDataService.createPODMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pod-materials"] });
      queryClient.invalidateQueries({ queryKey: ["master-pod-sku-variants"] });
      toast({ title: "POD profile created." });
      setIsCreateOpen(false);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Create failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not create POD profile.",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: z.infer<typeof podFormSchema>;
    }) => masterDataService.updatePODMaterial(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pod-materials"] });
      queryClient.invalidateQueries({ queryKey: ["master-pod-sku-variants"] });
      toast({ title: "POD profile updated." });
      setEditingItem(null);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Update failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not update POD profile.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: masterDataService.deletePODMaterial,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pod-materials"] });
      queryClient.invalidateQueries({ queryKey: ["master-pod-sku-variants"] });
      toast({ title: "POD profile deleted." });
      setItemToDelete(null);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not delete POD profile.",
      });
    },
  });

  return (
    <MasterRegistryShell
      title="POD Master"
      description="Fixed POD roll SKUs. Product Master variants link here manually for in-house production; SKU rows are created only from this master page."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search POD code, SKU variant, roll profile, or linked PM variant"
      actions={
        <div className="flex items-center gap-2">
          <Link
            href="/master/products?kind=POD"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-order-border bg-gradient-to-r from-order-bg to-order-bg px-3 text-[11px] font-bold text-order-fg hover:from-order-bg hover:to-order-bg transition"
            title="Create a POD Product Master variant, then manually link it to an existing fixed POD SKU"
          >
            <Plus className="h-3.5 w-3.5" /> Build production master
          </Link>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add POD Roll
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create POD Roll SKU</DialogTitle>
              </DialogHeader>
              <PODForm
                onSubmit={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>
      }
      stats={[
        {
          label: "POD Rolls",
          value: stats.total,
          icon: Radio,
          toneClassName: "bg-order-bg text-order-fg",
        },
        {
          label: "SKU Variants",
          value: stats.skuVariants,
          icon: Package,
          toneClassName: "bg-info-bg text-primary",
        },
        {
          label: "PM-Linked",
          value: stats.pmBacked,
          subLabel: "manual links",
          icon: PackageOpen,
          toneClassName: "bg-success-bg text-success-fg",
        },
        {
          label: "Unlinked In-House",
          value: stats.unlinkedInHouse,
          subLabel: "needs PM link",
          icon: Factory,
          toneClassName: "bg-danger-bg text-danger-fg",
        },
      ]}
    >
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => {
          const link = row.product_master_link;
          const skuRows = podVariantsByMaterial.get(row.id) || [];
          const unlinkedInHouse = row.pod_is_inhouse_produced && !link;
          return (
            <Card key={row.id} className="border-0 shadow-sm ring-1 ring-line">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black tracking-tight text-content-1">
                      {row.name}
                    </div>
                    <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-content-4">
                      {row.code}
                    </div>
                  </div>
                  <span className="inline-flex rounded-full bg-order-bg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-order-fg ring-1 ring-order-border">
                    POD roll
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                      row.pod_is_inhouse_produced
                        ? "bg-success-bg text-success-fg ring-success-border"
                        : "bg-surface-2 text-content-3 ring-line"
                    }`}
                  >
                    {row.pod_is_inhouse_produced
                      ? "In-house capable"
                      : "Catalog only"}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                      link
                        ? "bg-success-bg text-success-fg ring-success-border"
                        : unlinkedInHouse
                          ? "bg-danger-bg text-danger-fg ring-danger-border"
                          : "bg-surface-2 text-content-3 ring-line"
                    }`}
                  >
                    {link
                      ? "PM-linked"
                      : unlinkedInHouse
                        ? "Needs PM link"
                        : "Unlinked"}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ${
                      row.status === "ACTIVE"
                        ? "bg-info-bg text-primary ring-info-border"
                        : "bg-danger-bg text-danger-fg ring-danger-border"
                    }`}
                  >
                    {row.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Base UOM
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      {row.base_uom || "KG"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Roll profile
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      {row.pod_type || "SINGLE"} · {row.pod_panel_count || 1}{" "}
                      panel
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Fixed height
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      {Number(row.pod_fixed_height_mm || 0).toLocaleString(
                        "en-IN",
                      )}{" "}
                      mm
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Thickness
                    </div>
                    <div className="mt-1 font-bold text-content-1">
                      {Number(row.pod_thickness_micron || 0).toLocaleString(
                        "en-IN",
                      )}{" "}
                      μ
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      Product Master Link
                    </div>
                    <div
                      className={`mt-1 rounded-xl px-3 py-2 text-sm ${
                        link
                          ? "bg-success-bg text-success-fg ring-1 ring-success-border"
                          : unlinkedInHouse
                            ? "bg-danger-bg text-danger-fg ring-1 ring-danger-border"
                            : "bg-surface-1 text-content-2 ring-1 ring-line"
                      }`}
                    >
                      {link ? (
                        <>
                          <div className="font-black">
                            {link.master_code} · {link.master_name}
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] font-bold">
                            {link.variant_code}
                          </div>
                        </>
                      ) : unlinkedInHouse ? (
                        <span className="font-bold">
                          In-house capable but not linked to a POD Product
                          Master variant
                        </span>
                      ) : (
                        <span>Fixed POD catalog row</span>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                      POD SKU Variants
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {skuRows.length ? (
                        skuRows.map((sku) => (
                          <span
                            key={sku.id}
                            className="inline-flex rounded-full bg-surface-1 px-2 py-1 font-mono text-[10px] font-bold text-content-2 ring-1 ring-line"
                          >
                            {sku.pod_sku_code} · {sku.code}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-content-3">
                          No POD SKU variant row yet
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditingItem(row)}
                  >
                    Edit
                  </Button>
                  {!row.code?.startsWith("POD-") ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setItemToDelete(row)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit POD Roll SKU</DialogTitle>
          </DialogHeader>
          {editingItem ? (
            <PODForm
              initialData={editingItem}
              isLoading={updateMutation.isPending}
              onSubmit={(data) =>
                updateMutation.mutate({ id: editingItem.id, data })
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!itemToDelete}
        onOpenChange={(open) => !open && setItemToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete POD Roll SKU?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{itemToDelete?.code}</strong>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (itemToDelete) deleteMutation.mutate(itemToDelete.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MasterRegistryShell>
  );
}
