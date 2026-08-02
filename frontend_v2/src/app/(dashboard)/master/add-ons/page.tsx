"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { masterDataService, Addon } from "@/services/master-data";
import { PageHeader } from "@/components/ui-custom/page-header";
import { DataTable } from "@/components/ui/data-table";
import { getColumns } from "./columns";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const formSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  weight_mode: z.enum(["PER_MM", "PER_PIECE", "FIXED"]),
  weight_value: z.coerce.number().min(0, "Value must be positive"),
  is_purchasable: z.boolean().default(false),
  addon_is_purchased: z.boolean().default(false),
  addon_purchase_uom: z.enum(["KG", "PCS", "METER"]).default("KG"),
});

function AddonForm({
  initialData,
  onSubmit,
  isLoading,
}: {
  initialData?: Addon;
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: initialData?.code || "",
      name: initialData?.name || "",
      weight_mode:
        (initialData?.weight_mode as "PER_MM" | "PER_PIECE" | "FIXED") ||
        "PER_PIECE",
      weight_value: initialData?.weight_value || 0,
      is_purchasable: Boolean(
        initialData?.is_purchasable ?? initialData?.addon_is_purchased,
      ),
      addon_is_purchased: Boolean(
        initialData?.is_purchasable ?? initialData?.addon_is_purchased,
      ),
      addon_purchase_uom:
        (initialData?.addon_purchase_uom as "KG" | "PCS" | "METER") || "KG",
    },
  });

  const purchased = form.watch("is_purchasable");
  const weightMode = form.watch("weight_mode");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          onSubmit({ ...values, addon_is_purchased: values.is_purchasable }),
        )}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Addon Code</FormLabel>
              <FormControl>
                <Input placeholder="e.g. ZIP-25" {...field} />
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
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 25mm Zipper" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="weight_mode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Consumption Mode</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="PER_MM">Per Millimeter</SelectItem>
                    <SelectItem value="PER_PIECE">Per Piece</SelectItem>
                    <SelectItem value="FIXED">Fixed Weight</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="weight_value"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {weightMode === "PER_MM"
                    ? "Weight coefficient (g/mm)"
                    : weightMode === "PER_PIECE"
                      ? "Weight per piece (g)"
                      : "Fixed weight (g)"}
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.0001"
                    {...field}
                    value={field.value as number}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="is_purchasable"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchasable?</FormLabel>
                <Select
                  onValueChange={(value) => field.onChange(value === "YES")}
                  value={field.value ? "YES" : "NO"}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="NO">No</SelectItem>
                    <SelectItem value="YES">Yes</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="addon_purchase_uom"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase UOM</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value}
                  disabled={!purchased}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="KG">KG</SelectItem>
                    <SelectItem value="PCS">PCS</SelectItem>
                    <SelectItem value="METER">METER</SelectItem>
                  </SelectContent>
                </Select>
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

export default function AddonsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Addon | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Addon | null>(null);

  const { data: addons } = useQuery({
    queryKey: ["addons"],
    queryFn: masterDataService.getAddons,
  });

  const createMutation = useMutation({
    mutationFn: masterDataService.createAddon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      toast({ title: "Success", description: "Addon created." });
      setIsCreateOpen(false);
    },
    onError: (err: Error) =>
      toast({
        title: "Error",
        description: err.message,
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
    }) => masterDataService.updateAddon(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      toast({ title: "Success", description: "Addon updated." });
      setEditingItem(null);
    },
    onError: (err: Error) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: masterDataService.deleteAddon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["addons"] });
      toast({ title: "Success", description: "Addon deleted." });
    },
    onError: (err: Error) =>
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add-ons & Misc Materials"
        description="Manage auxiliary materials like zippers, spouts, handles, and specialty attachments."
        actions={
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Add Addon
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Addon</DialogTitle>
                <DialogDescription>
                  Define how this add-on is consumed in orders and whether store
                  can inward it as purchased stock.
                </DialogDescription>
              </DialogHeader>
              <AddonForm
                onSubmit={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <DataTable
        columns={getColumns({
          onEdit: setEditingItem,
          onDelete: (item) => setItemToDelete(item),
        })}
        data={addons || []}
        filterColumn="name"
        filterPlaceholder="Filter add-ons..."
      />

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Addon</DialogTitle>
            <DialogDescription>
              Update add-on consumption rules and purchased-stock handling.
            </DialogDescription>
          </DialogHeader>
          {editingItem && (
            <AddonForm
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
              . This action cannot be undone.
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
