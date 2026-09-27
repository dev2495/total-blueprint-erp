"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { factoryService, Location, Plant } from "@/services/factory";
import { AxiosError } from "axios";
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  MapPin,
  Warehouse,
  Settings2,
  Trash2,
  Box,
  Truck,
  ShieldCheck,
  Archive,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { Pager, Pill } from "@/components/logistics/yard-ui";
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
import { Badge } from "@/components/ui/badge";

// --- Form Component ---
const formSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  plant: z.string().min(1, "Plant is required"),
  type: z.string().min(1, "Type is required"),
});

function LocationForm({
  initialData,
  plants,
  onSubmit,
  isLoading,
}: {
  initialData?: Location;
  plants: Plant[];
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: initialData?.code || "",
      name: initialData?.name || "",
      plant: initialData?.plant || "",
      type: initialData?.type || "WAREHOUSE",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="plant"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Plant</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select plant" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {plants?.map((plant) => (
                    <SelectItem key={plant.id} value={plant.id}>
                      {plant.name} ({plant.code})
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
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location Code</FormLabel>
              <FormControl>
                <Input placeholder="e.g. F-01" {...field} />
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
              <FormLabel>Location Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Finished Goods Warehouse" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location Type</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="WAREHOUSE">Warehouse</SelectItem>
                  <SelectItem value="RM">Raw Materials</SelectItem>
                  <SelectItem value="QC">Quality Control</SelectItem>
                  <SelectItem value="WIP">WIP Area</SelectItem>
                  <SelectItem value="FG">Finished Goods</SelectItem>
                  <SelectItem value="DISPATCH">Dispatch Area</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
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

const getLocationColor = (type: string) => {
  switch (type) {
    case "FG":
      return "bg-success-bg text-success-fg hover:bg-success-bg";
    case "RM":
      return "bg-info-bg text-primary hover:bg-info-bg";
    case "WIP":
      return "bg-warning-bg text-warning-fg hover:bg-warm";
    case "QC":
      return "bg-info-bg text-primary hover:bg-info-bg";
    case "DISPATCH":
      return "bg-warning-bg text-warning-fg hover:bg-warning-bg";
    default:
      return "bg-surface-2 text-content-2 hover:bg-line";
  }
};

const getLocationIcon = (type: string) => {
  switch (type) {
    case "FG":
      return Box;
    case "RM":
      return Box;
    case "WIP":
      return Archive;
    case "QC":
      return ShieldCheck;
    case "DISPATCH":
      return Truck;
    default:
      return Warehouse;
  }
};

// --- Main Page ---
export default function LocationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Location | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Location | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [plantFilter, setPlantFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 40;

  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: factoryService.getLocations,
  });

  const { data: plants } = useQuery({
    queryKey: ["plants"],
    queryFn: factoryService.getPlants,
  });

  const createMutation = useMutation({
    mutationFn: factoryService.createLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Success", description: "Location created." });
      setIsCreateOpen(false);
    },
    onError: (err: AxiosError<{ detail: string }>) =>
      toast({
        title: "Error",
        description: err.response?.data?.detail || err.message,
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
    }) => factoryService.updateLocation(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Success", description: "Location updated." });
      setEditingItem(null);
    },
    onError: (err: AxiosError<{ detail: string }>) =>
      toast({
        title: "Error",
        description: err.response?.data?.detail || err.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: factoryService.deleteLocation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["locations"] });
      toast({ title: "Success", description: "Location deleted." });
    },
    onError: (err: AxiosError<{ detail: string }>) =>
      toast({
        title: "Error",
        description: err.response?.data?.detail || err.message,
        variant: "destructive",
      }),
  });

  const plantNames = useMemo(
    () => new Map((plants || []).map((p) => [p.id, p.name])),
    [plants],
  );
  const locationTypes = useMemo(
    () => Array.from(new Set((locations || []).map((loc) => loc.type).filter(Boolean))).sort(),
    [locations],
  );
  const filteredLocations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return (locations || []).filter((loc) => {
      if (plantFilter !== "ALL" && loc.plant !== plantFilter) return false;
      if (typeFilter !== "ALL" && loc.type !== typeFilter) return false;
      if (!term) return true;
      return (
        loc.name.toLowerCase().includes(term) ||
        loc.code.toLowerCase().includes(term) ||
        loc.type.toLowerCase().includes(term) ||
        String(plantNames.get(loc.plant) || loc.plant_name || "").toLowerCase().includes(term)
      );
    });
  }, [locations, plantFilter, plantNames, searchQuery, typeFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredLocations.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedLocations = filteredLocations.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => setPage(1), [searchQuery, plantFilter, typeFilter]);

  return (
    <FactoryPageLayout
      title="Locations"
      description="Manage inventory locations, warehouses, and storage areas within plants."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search locations..."
      actions={
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
              <Plus className="mr-2 h-4 w-4" /> Add Location
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Location</DialogTitle>
            </DialogHeader>
            <LocationForm
              plants={plants || []}
              onSubmit={(data) => createMutation.mutate(data)}
              isLoading={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={plantFilter}
          onChange={(e) => setPlantFilter(e.target.value)}
          className="h-9 rounded-xl border border-line bg-surface-1 pl-3 pr-8 text-[12.5px] font-medium"
          aria-label="Filter by plant"
        >
          <option value="ALL">All plants</option>
          {(plants || []).map((plant) => (
            <option key={plant.id} value={plant.id}>
              {plant.name}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="h-9 rounded-xl border border-line bg-surface-1 pl-3 pr-8 text-[12.5px] font-medium"
          aria-label="Filter by type"
        >
          <option value="ALL">All types</option>
          {locationTypes.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, " ").toLowerCase()}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[12px] text-content-3">
          {filteredLocations.length.toLocaleString("en-IN")} of {(locations || []).length.toLocaleString("en-IN")} locations
        </span>
      </div>
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2/80 text-left text-[11.5px] text-content-3">
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 font-medium">Code</th>
                <th className="px-3 py-2.5 font-medium">Plant</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedLocations.map((location) => {
                const Icon = getLocationIcon(location.type);
                return (
                  <tr key={location.id} className="erp-manifest-row border-b border-line last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`grid h-7 w-7 place-items-center rounded-lg ${getLocationColor(location.type).split(" ").slice(0, 2).join(" ")}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <span className="font-medium text-content-1">{location.name}</span>
                        {location.is_system ? <Pill tone="neutral">System</Pill> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[12px] text-content-2">{location.code}</td>
                    <td className="px-3 py-2.5 text-content-2">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3 text-content-4" />
                        {plantNames.get(location.plant) || location.plant_name || "Unknown plant"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge className={`${getLocationColor(location.type)} border-transparent`}>{location.type}</Badge>
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={location.is_active === false ? "neutral" : "good"} dot>
                        {location.is_active === false ? "Inactive" : "Active"}
                      </Pill>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${location.code}`} onClick={() => setEditingItem(location)}>
                          <Settings2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:text-danger-fg"
                          aria-label={`Delete ${location.code}`}
                          disabled={location.is_system}
                          onClick={() => setItemToDelete(location)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pagedLocations.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-content-3">
                    {locations ? "No locations match these filters." : "Loading locations…"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
            <span>
              Page {safePage} of {pageCount}
            </span>
            <Pager page={safePage} pageCount={pageCount} onPageChange={setPage} testId="locations-page" />
          </div>
        ) : null}
      </div>

      <Dialog
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Location</DialogTitle>
          </DialogHeader>
          {editingItem && (
            <LocationForm
              plants={plants || []}
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
    </FactoryPageLayout>
  );
}
