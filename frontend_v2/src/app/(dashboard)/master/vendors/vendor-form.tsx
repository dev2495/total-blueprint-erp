"use client";

import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Vendor } from "@/services/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { MapPin, Plus, Trash2 } from "lucide-react";

const addressSchema = z.object({
  label: z.string().optional(),
  name: z.string().optional(),
  address: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  pincode: z.string().optional(),
  contact_person: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

const vendorSchema = z.object({
  name: z.string().min(1, "Name is required"),
  code: z.string().min(1, "Code is required"),
  type: z.enum(["RM", "JOBWORK", "SERVICE", "BOTH"]),
  status: z.enum(["ACTIVE", "INACTIVE", "BLACKLISTED"]),
  under_group: z.string().optional(),
  gst_no: z.string().optional(),
  pan_no: z.string().optional(),
  phone_number: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  contact_person: z.string().optional(),
  contact_details: z.string().optional(),
  payment_terms: z.string().optional(),
  address: z.string().optional(),
  mailing_name: z.string().optional(),
  mailing_state: z.string().optional(),
  mailing_country: z.string().optional(),
  mailing_pincode: z.string().optional(),
  additional_addresses: z.array(addressSchema).default([]),
  credit_days: z
    .number()
    .min(0, "Credit period must be zero or positive")
    .default(0),
  interest_calculation: z.string().optional(),
  bank_details: z.string().optional(),
  tds_deductable: z.boolean().default(false),
  tcs_deductable: z.boolean().default(false),
  lead_time_days: z.number().min(0, "Lead time must be positive").default(0),
  turnaround_hours: z
    .number()
    .min(0, "Turnaround must be zero or positive")
    .default(0),
  qc_required: z.boolean().default(false),
  jobwork_capabilities_text: z.string().optional(),
  jobwork_plants_text: z.string().optional(),
});

type VendorFormInput = z.input<typeof vendorSchema>;
type VendorFormValues = z.output<typeof vendorSchema>;

interface Props {
  initialData?: Vendor;
  onSubmit: (data: VendorFormValues) => void;
  isLoading?: boolean;
}

export function VendorForm({ initialData, onSubmit, isLoading }: Props) {
  const parseCsv = (value?: string) =>
    String(value || "")
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);
  const blankAddress = () => ({
    label: "",
    name: "",
    address: "",
    state: "",
    country: "",
    pincode: "",
    contact_person: "",
    phone: "",
    email: "",
  });
  const normalizeAddresses = (entries: z.infer<typeof addressSchema>[]) =>
    entries.filter((entry) =>
      Object.values(entry).some((value) => String(value || "").trim()),
    );

  const form = useForm<VendorFormInput, any, VendorFormValues>({
    resolver: zodResolver(vendorSchema),
    defaultValues: {
      name: initialData?.name || "",
      code: initialData?.code || "",
      type: (initialData?.type as any) || "RM",
      status: (initialData?.status as any) || "ACTIVE",
      under_group: initialData?.under_group || "",
      gst_no: initialData?.gst_no || "",
      pan_no: initialData?.pan_no || "",
      phone_number: initialData?.phone_number || "",
      email: initialData?.email || "",
      contact_person: initialData?.contact_person || "",
      contact_details: initialData?.contact_details || "",
      payment_terms: initialData?.payment_terms || "",
      address: initialData?.address || "",
      mailing_name: initialData?.mailing_name || "",
      mailing_state: initialData?.mailing_state || "",
      mailing_country: initialData?.mailing_country || "",
      mailing_pincode: initialData?.mailing_pincode || "",
      additional_addresses: initialData?.additional_addresses?.length
        ? initialData.additional_addresses
        : [],
      credit_days: Number(initialData?.credit_days || 0),
      interest_calculation: initialData?.interest_calculation || "",
      bank_details: initialData?.bank_details || "",
      tds_deductable: Boolean(initialData?.tds_deductable),
      tcs_deductable: Boolean(initialData?.tcs_deductable),
      lead_time_days: Number(initialData?.lead_time_days || 0),
      turnaround_hours: Number(initialData?.turnaround_hours || 0),
      qc_required: initialData?.qc_required ?? false,
      jobwork_capabilities_text: (initialData?.jobwork_capabilities || []).join(
        ", ",
      ),
      jobwork_plants_text: (initialData?.jobwork_plants || []).join(", "),
    },
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additional_addresses",
  });
  const vendorType = form.watch("type");
  const isJobworkVendor = vendorType === "JOBWORK" || vendorType === "BOTH";

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) =>
          onSubmit({
            ...values,
            additional_addresses: normalizeAddresses(
              values.additional_addresses || [],
            ),
            turnaround_hours: isJobworkVendor
              ? Number(values.turnaround_hours || 0)
              : 0,
            qc_required: isJobworkVendor ? Boolean(values.qc_required) : false,
            jobwork_capabilities: isJobworkVendor
              ? parseCsv(values.jobwork_capabilities_text)
              : [],
            jobwork_plants: isJobworkVendor
              ? parseCsv(values.jobwork_plants_text)
              : [],
          } as any),
        )}
        className="space-y-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Vendor Code
                </Label>
                <FormControl>
                  <Input
                    placeholder="V-001"
                    className="font-mono text-sm"
                    {...field}
                  />
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
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Vendor Name
                </Label>
                <FormControl>
                  <Input
                    placeholder="Acme Corp"
                    className="text-sm font-semibold"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="under_group"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Under Group
                </Label>
                <FormControl>
                  <Input
                    placeholder="Sundry Creditors"
                    className="text-sm font-semibold"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Type
                </Label>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="RM">Raw Material Supplier</SelectItem>
                    <SelectItem value="JOBWORK">Job Worker</SelectItem>
                    <SelectItem value="SERVICE">Service Provider</SelectItem>
                    <SelectItem value="BOTH">Both (Supplier & JW)</SelectItem>
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
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Status
                </Label>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                    <SelectItem value="BLACKLISTED">Blacklisted</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="gst_no"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  GST No (Optional)
                </Label>
                <FormControl>
                  <Input
                    placeholder="27XXXX"
                    className="text-sm font-mono"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pan_no"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  PAN No (Optional)
                </Label>
                <FormControl>
                  <Input
                    placeholder="ABCDE1234F"
                    className="text-sm font-mono"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="contact_person"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Contact Person
                </Label>
                <FormControl>
                  <Input
                    placeholder="Primary contact"
                    className="text-sm font-semibold"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Email (Optional)
                </Label>
                <FormControl>
                  <Input
                    placeholder="accounts@vendor.com"
                    className="text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lead_time_days"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Lead Time (Days)
                </Label>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    className="text-sm"
                    value={field.value ?? 0}
                    onChange={(e) =>
                      field.onChange(Number(e.target.value || 0))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="phone_number"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Phone Number (Optional)
                </Label>
                <FormControl>
                  <Input
                    placeholder="+91..."
                    className="text-sm font-mono"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contact_details"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Contact Details
                </Label>
                <FormControl>
                  <Input
                    placeholder="Department or alternate contact note"
                    className="text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="rounded-2xl border border-line bg-surface-2 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-black text-content-1">
                Primary Mailing Address
              </p>
              <p className="text-xs font-semibold text-content-3">
                Main commercial/contact address for this vendor.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="mailing_name"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    Mailing Name
                  </Label>
                  <FormControl>
                    <Input
                      placeholder="Purchase / Accounts / Plant"
                      className="text-sm font-semibold bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mailing_pincode"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    Pincode
                  </Label>
                  <FormControl>
                    <Input
                      placeholder="400001"
                      className="text-sm font-semibold bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="address"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Primary Address
                </Label>
                <FormControl>
                  <Textarea
                    placeholder="Full address"
                    className="text-sm resize-none bg-surface-1"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="mailing_state"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    State
                  </Label>
                  <FormControl>
                    <Input
                      className="text-sm font-semibold bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="mailing_country"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    Country
                  </Label>
                  <FormControl>
                    <Input
                      className="text-sm font-semibold bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-surface-1 p-4 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-black text-content-1">
                Additional Mailing Details
              </p>
              <p className="text-xs font-semibold text-content-3">
                Optional branch, plant, or alternate billing addresses.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => append(blankAddress())}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Address
            </Button>
          </div>
          {fields.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-6 text-sm text-content-4">
              No additional mailing details yet.
            </div>
          ) : (
            fields.map((field, index) => (
              <div
                key={field.id}
                className="rounded-2xl border border-line bg-surface-2 p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-content-3">
                    Address {index + 1}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4 text-danger-fg" />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    placeholder="Label"
                    {...form.register(`additional_addresses.${index}.label`)}
                  />
                  <Input
                    placeholder="Mailing name"
                    {...form.register(`additional_addresses.${index}.name`)}
                  />
                  <Textarea
                    placeholder="Address"
                    className="min-h-[88px] md:col-span-2"
                    {...form.register(`additional_addresses.${index}.address`)}
                  />
                  <Input
                    placeholder="State"
                    {...form.register(`additional_addresses.${index}.state`)}
                  />
                  <Input
                    placeholder="Country"
                    {...form.register(`additional_addresses.${index}.country`)}
                  />
                  <Input
                    placeholder="Pincode"
                    {...form.register(`additional_addresses.${index}.pincode`)}
                  />
                  <Input
                    placeholder="Contact person"
                    {...form.register(
                      `additional_addresses.${index}.contact_person`,
                    )}
                  />
                  <Input
                    placeholder="Phone"
                    {...form.register(`additional_addresses.${index}.phone`)}
                  />
                  <Input
                    placeholder="Email"
                    className="md:col-span-2"
                    {...form.register(`additional_addresses.${index}.email`)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField
            control={form.control}
            name="credit_days"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Credit Period (Days)
                </Label>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    className="text-sm"
                    value={field.value ?? 0}
                    onChange={(e) =>
                      field.onChange(Number(e.target.value || 0))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="payment_terms"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Payment Terms
                </Label>
                <FormControl>
                  <Input
                    placeholder="Net 30, 45 days, advance"
                    className="text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="interest_calculation"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Interest Calculation
                </Label>
                <FormControl>
                  <Input
                    placeholder="Monthly / Simple / None"
                    className="text-sm"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="bank_details"
            render={({ field }) => (
              <FormItem>
                <Label className="text-xs font-bold text-content-3 uppercase">
                  Bank Details
                </Label>
                <FormControl>
                  <Textarea
                    placeholder="Bank name, branch, account, IFSC..."
                    className="text-sm resize-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4">
            <FormField
              control={form.control}
              name="tds_deductable"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-3">
                  <div>
                    <Label className="text-xs font-bold text-content-3 uppercase">
                      TDS Deductable
                    </Label>
                    <p className="text-xs text-content-4 mt-1">
                      Enable if deduction applies for this vendor.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tcs_deductable"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-xl border border-line bg-surface-2 px-3 py-3">
                  <div>
                    <Label className="text-xs font-bold text-content-3 uppercase">
                      TCS Deductable
                    </Label>
                    <p className="text-xs text-content-4 mt-1">
                      Enable if collection applies for this vendor.
                    </p>
                  </div>
                  <FormControl>
                    <Switch
                      checked={!!field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </div>
        </div>

        {isJobworkVendor && (
          <div className="rounded-2xl border border-info-border bg-info-bg p-4 space-y-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
                Jobwork controls
              </p>
              <p className="text-xs font-semibold text-content-3">
                Optional routing and QC details for jobwork vendors only.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="turnaround_hours"
                render={({ field }) => (
                  <FormItem>
                    <Label className="text-xs font-bold text-content-3 uppercase">
                      Jobwork Turnaround (Hours)
                    </Label>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        className="text-sm"
                        value={field.value ?? 0}
                        onChange={(e) =>
                          field.onChange(Number(e.target.value || 0))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="qc_required"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-xl border border-info-border bg-surface-1 px-3 py-2.5 mt-6">
                    <div>
                      <Label className="text-xs font-bold text-content-3 uppercase">
                        QC Required on Return
                      </Label>
                      <p className="text-xs text-content-4 mt-1">
                        Optional. Enable only if returns must stay blocked for
                        QC.
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="jobwork_capabilities_text"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    Jobwork Process Capabilities
                  </Label>
                  <FormControl>
                    <Input
                      placeholder="PRINTING, LAMINATION, SLITTING"
                      className="text-sm font-mono bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-content-4">
                    Optional comma-separated process codes. Keep empty for
                    generic compatibility.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="jobwork_plants_text"
              render={({ field }) => (
                <FormItem>
                  <Label className="text-xs font-bold text-content-3 uppercase">
                    Jobwork Plant Coverage
                  </Label>
                  <FormControl>
                    <Input
                      placeholder="PLANT_A, PLANT_B"
                      className="text-sm font-mono bg-surface-1"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-content-4">
                    Optional comma-separated plant IDs/codes. Keep empty for all
                    plants.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button
            type="submit"
            disabled={isLoading}
            className="font-bold shadow-md"
          >
            {isLoading
              ? "Saving..."
              : initialData
                ? "Update Vendor"
                : "Create Vendor"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
