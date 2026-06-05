"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilmVariant } from "@/services/film-variants";
import { filmFamilyService } from "@/services/film-families";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { commercialFamilyService } from "@/services/commercial-families";

const formSchema = z.object({
  code: z.string().min(1, "Variant Code is required"),
  name: z.string().min(1, "Name is required"),
  parent_family: z.string().min(1, "Family is required"),
  commercial_family: z.string().optional(),
  is_extrudable: z.boolean().default(false),
  is_purchasable: z.boolean().default(true),
  is_sellable: z.boolean().default(false),
  default_gst_pct: z.coerce.number().nullable().optional(),
});

interface FilmVariantFormProps {
  initialData?: FilmVariant;
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading?: boolean;
}

export function FilmVariantForm({
  initialData,
  onSubmit,
  isLoading,
}: FilmVariantFormProps) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      parent_family: "",
      commercial_family: "",
      is_extrudable: false,
      is_purchasable: true,
      is_sellable: false,
      default_gst_pct: null,
    },
  });
  const isSellable = form.watch("is_sellable");
  // Fetch Families for Dropdown
  const { data: families } = useQuery({
    queryKey: ["film-families"],
    queryFn: filmFamilyService.getAll,
  });
  const { data: commercialFamilies = [] } = useQuery({
    queryKey: ["commercial-families"],
    queryFn: commercialFamilyService.getAll,
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        code: initialData.code,
        name: initialData.name,
        parent_family: initialData.parent_family,
        commercial_family: initialData.commercial_family ?? "__NONE__",
        is_extrudable: initialData.is_extrudable,
        is_purchasable: initialData.is_purchasable,
        is_sellable: (initialData as any).is_sellable ?? false,
        default_gst_pct: (initialData as any).default_gst_pct ?? null,
      });
    }
  }, [initialData, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Variant Code</FormLabel>
              <FormControl>
                <Input placeholder="e.g. F-101" {...field} />
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
              <FormLabel>Variant Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. Standard Transparent" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="parent_family"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Film Family</FormLabel>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
                value={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a family" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {families?.map((family) => (
                    <SelectItem key={family.id} value={String(family.id)}>
                      {family.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Base material family for this variant.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="commercial_family"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Business Family</FormLabel>
              <Select
                value={field.value || "__NONE__"}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Optional shared business alias" />
                  </SelectTrigger>
                </FormControl>
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
              <FormDescription>
                Shared business naming group used across stock intelligence and
                reports.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="is_extrudable"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Extrudable</FormLabel>
                <FormDescription>
                  Make in-house via recipe. Grade is chosen on sales order, GRN,
                  and recipe; not on this master.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="is_purchasable"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Purchasable</FormLabel>
                <FormDescription>
                  Allow purchase inward. If this is also extrudable, GRN will
                  ask for the physical roll grade.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        {/* Sales / Trade Order section */}
        <div className="rounded-2xl border border-success-border bg-success-bg p-4 space-y-3">
          <div className="text-[11px] font-black uppercase tracking-wider text-success-fg">
            Sales · Trade Orders
          </div>
          <FormField
            control={form.control}
            name="is_sellable"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Sellable as trading good</FormLabel>
                  <FormDescription>
                    Enable to make this material available in Trade Orders.
                  </FormDescription>
                </div>
              </FormItem>
            )}
          />
          {isSellable ? (
            <FormField
              control={form.control}
              name="default_gst_pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default GST %</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 18"
                      value={(field.value as number | null | undefined) ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === "" ? null : Number(e.target.value),
                        )
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
