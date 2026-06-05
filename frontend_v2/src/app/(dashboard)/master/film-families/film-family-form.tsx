"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { FilmFamily } from "@/services/film-families";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { commercialFamilyService } from "@/services/commercial-families";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  density_gcm3: z.coerce.number().min(0.0001, "Density must be positive"),
  commercial_family: z.string().optional(),
});

interface FilmFamilyFormProps {
  initialData?: FilmFamily;
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading?: boolean;
}

export function FilmFamilyForm({
  initialData,
  onSubmit,
  isLoading,
}: FilmFamilyFormProps) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      density_gcm3: 0,
      commercial_family: "",
    },
  });
  const { data: commercialFamilies = [] } = useQuery({
    queryKey: ["commercial-families"],
    queryFn: commercialFamilyService.getAll,
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        name: initialData.name,
        density_gcm3: initialData.density_gcm3,
        commercial_family: initialData.commercial_family ?? "__NONE__",
      });
    }
  }, [initialData, form]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Family Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. LDPE, HDPE" {...field} />
              </FormControl>
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
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="density_gcm3"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Density (g/cm³)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder="0.9200"
                  {...field}
                  value={field.value as number}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
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
