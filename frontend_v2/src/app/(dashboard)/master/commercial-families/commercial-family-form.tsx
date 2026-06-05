"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2 } from "lucide-react";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CommercialFamily } from "@/services/commercial-families";

const formSchema = z.object({
  code: z.string().min(2, "Code is required"),
  name: z.string().min(2, "Business family name is required"),
  default_form: z.enum(["ROLL", "POUCH"]),
  default_reporting_group: z.enum([
    "FILM",
    "PRINTED",
    "LAMINATED",
    "SEMI_FG",
    "FG",
    "PACKAGING",
    "OTHER",
  ]),
  active: z.boolean().default(true),
});

type CommercialFamilyFormValues = z.input<typeof formSchema>;
type CommercialFamilySubmitValues = z.output<typeof formSchema>;

interface Props {
  initialData?: CommercialFamily;
  onSubmit: (data: CommercialFamilySubmitValues) => void;
  isLoading?: boolean;
}

export function CommercialFamilyForm({
  initialData,
  onSubmit,
  isLoading,
}: Props) {
  const form = useForm<
    CommercialFamilyFormValues,
    unknown,
    CommercialFamilySubmitValues
  >({
    resolver: zodResolver(formSchema),
    defaultValues: {
      code: "",
      name: "",
      default_form: "ROLL",
      default_reporting_group: "FILM",
      active: true,
    } satisfies CommercialFamilyFormValues,
  });

  useEffect(() => {
    if (initialData) {
      form.reset({
        code: initialData.code,
        name: initialData.name,
        default_form: initialData.default_form,
        default_reporting_group: initialData.default_reporting_group,
        active: initialData.active,
      });
    }
  }, [form, initialData]);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Code</FormLabel>
              <FormControl>
                <Input placeholder="e.g. PET_PRINTED" {...field} />
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
              <FormLabel>Business Family Name</FormLabel>
              <FormControl>
                <Input placeholder="e.g. PET Printed Laminate" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="default_form"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Default Form</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="ROLL">Roll</SelectItem>
                    <SelectItem value="POUCH">Pouch</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="default_reporting_group"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Reporting Group</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="FILM">Film</SelectItem>
                    <SelectItem value="PRINTED">Printed</SelectItem>
                    <SelectItem value="LAMINATED">Laminated</SelectItem>
                    <SelectItem value="SEMI_FG">Semi-FG</SelectItem>
                    <SelectItem value="FG">FG</SelectItem>
                    <SelectItem value="PACKAGING">Packaging</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Active</FormLabel>
                <p className="text-sm text-content-3">
                  Inactive families stay in history but drop from new naming
                  selectors.
                </p>
              </div>
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
