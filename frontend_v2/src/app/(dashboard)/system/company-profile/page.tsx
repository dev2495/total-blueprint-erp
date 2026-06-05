"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  MapPin,
  FileText,
  Landmark,
  PenSquare,
  Save,
  ShieldAlert,
  Loader2,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/hooks/use-toast";
import {
  companyProfileService,
  type CompanyProfile,
} from "@/services/company-profile";

function hasSystemManage(user: any): boolean {
  if (!user) return false;
  if (user.is_superuser || user.is_owner) return true;
  const perms: string[] = user?.entitlements?.permissions || [];
  if (perms.includes("*")) return true;
  return perms.includes("system.manage");
}

function hasSystemView(user: any): boolean {
  if (!user) return false;
  if (hasSystemManage(user)) return true;
  const perms: string[] = user?.entitlements?.permissions || [];
  return perms.includes("system.view");
}

interface FieldProps {
  label: string;
  helper?: string;
  children: React.ReactNode;
}

function Field({ label, helper, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] font-semibold uppercase tracking-wider text-content-3">
        {label}
      </Label>
      {children}
      {helper ? (
        <p className="text-[11px] leading-4 text-content-3">{helper}</p>
      ) : null}
    </div>
  );
}

export default function CompanyProfilePage() {
  const { user: me } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const canView = hasSystemView(me);
  const canEdit = hasSystemManage(me);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["company-profile"],
    queryFn: () => companyProfileService.get(),
    enabled: canView,
    staleTime: 30_000,
  });

  const [form, setForm] = React.useState<Partial<CompanyProfile>>({});

  React.useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const setField = <K extends keyof CompanyProfile>(
    field: K,
    value: CompanyProfile[K],
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const mutation = useMutation({
    mutationFn: (body: Partial<CompanyProfile>) =>
      companyProfileService.update(body),
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["company-profile"] });
      toast({
        title: "Company profile saved",
        description:
          "Quotation and invoice templates will use the updated details.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description:
          err?.response?.data?.detail ||
          err?.message ||
          "Could not save changes. Try again.",
        variant: "destructive",
      });
    },
  });

  if (!canView) {
    return (
      <div className="space-y-6 p-6">
        <Card className="border-danger-border bg-danger-bg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-danger-fg">
              <ShieldAlert className="h-5 w-5" /> Access denied
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-danger-fg">
            You don&apos;t have permission to view the company profile. Ask an
            OWNER or ADMIN to grant the{" "}
            <code className="rounded bg-surface-1 px-1">system.view</code>{" "}
            permission.
          </CardContent>
        </Card>
      </div>
    );
  }

  const profile = form;

  return (
    <div className="space-y-6 p-6 pb-32">
      <GradientHero
        eyebrow="System · Branding"
        title="Company Profile"
        subtitle="Edit how your company appears on quotations, invoices, and customer-facing documents. Changes apply to all future PDFs immediately."
        palette="indigo"
        chips={[
          {
            label: "Used in",
            value: "Quotations · Invoices · POs",
            tone: "info",
          },
          {
            label: "Last updated",
            value: data?.updated_at
              ? new Date(data.updated_at).toLocaleString()
              : "—",
          },
        ]}
      />

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-content-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading company
            profile…
          </CardContent>
        </Card>
      ) : isError ? (
        <Card className="border-danger-border bg-danger-bg">
          <CardContent className="p-6 text-sm text-danger-fg">
            Failed to load profile: {String((error as any)?.message || error)}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          {/* ── Editor ───────────────────────────────────────────────── */}
          <Card className="border-line">
            <CardContent className="p-0">
              <Tabs defaultValue="identity">
                <div className="border-b border-line px-4 pt-3">
                  <TabsList className="bg-surface-2">
                    <TabsTrigger value="identity">
                      <Building2 className="mr-1.5 h-3.5 w-3.5" /> Identity
                    </TabsTrigger>
                    <TabsTrigger value="address">
                      <MapPin className="mr-1.5 h-3.5 w-3.5" /> Address &amp;
                      Contact
                    </TabsTrigger>
                    <TabsTrigger value="tax">
                      <FileText className="mr-1.5 h-3.5 w-3.5" /> Tax &amp;
                      Statutory
                    </TabsTrigger>
                    <TabsTrigger value="bank">
                      <Landmark className="mr-1.5 h-3.5 w-3.5" /> Bank
                    </TabsTrigger>
                    <TabsTrigger value="terms">
                      <PenSquare className="mr-1.5 h-3.5 w-3.5" /> Terms &amp;
                      Signatory
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="p-5">
                  <TabsContent value="identity" className="m-0 space-y-4">
                    <Field
                      label="Legal Name"
                      helper="Appears bold on the quotation header and PDF metadata."
                    >
                      <Input
                        value={profile.legal_name ?? ""}
                        onChange={(e) => setField("legal_name", e.target.value)}
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field
                      label="Trading Name"
                      helper="Optional brand or DBA name shown when distinct from legal name."
                    >
                      <Input
                        value={profile.trading_name ?? ""}
                        onChange={(e) =>
                          setField("trading_name", e.target.value)
                        }
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field
                      label="Tagline"
                      helper="Italicised line under the legal name on the quotation letterhead."
                    >
                      <Input
                        value={profile.tagline ?? ""}
                        onChange={(e) => setField("tagline", e.target.value)}
                        disabled={!canEdit}
                      />
                    </Field>
                    <Field
                      label="Logo Path"
                      helper="Relative to frontend_v2/public/. Default: brand/tpp-logo-pdf.svg"
                    >
                      <Input
                        value={profile.logo_path ?? ""}
                        onChange={(e) => setField("logo_path", e.target.value)}
                        disabled={!canEdit}
                      />
                    </Field>
                  </TabsContent>

                  <TabsContent value="address" className="m-0 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Address Line 1">
                        <Input
                          value={profile.address_line1 ?? ""}
                          onChange={(e) =>
                            setField("address_line1", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Address Line 2">
                        <Input
                          value={profile.address_line2 ?? ""}
                          onChange={(e) =>
                            setField("address_line2", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="City">
                        <Input
                          value={profile.city ?? ""}
                          onChange={(e) => setField("city", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="State">
                        <Input
                          value={profile.state ?? ""}
                          onChange={(e) => setField("state", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Country">
                        <Input
                          value={profile.country ?? ""}
                          onChange={(e) => setField("country", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Pincode">
                        <Input
                          value={profile.pincode ?? ""}
                          onChange={(e) => setField("pincode", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Primary Phone">
                        <Input
                          value={profile.phone_primary ?? ""}
                          onChange={(e) =>
                            setField("phone_primary", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Secondary Phone">
                        <Input
                          value={profile.phone_secondary ?? ""}
                          onChange={(e) =>
                            setField("phone_secondary", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Email">
                        <Input
                          type="email"
                          value={profile.email ?? ""}
                          onChange={(e) => setField("email", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Website">
                        <Input
                          value={profile.website ?? ""}
                          onChange={(e) => setField("website", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>
                  </TabsContent>

                  <TabsContent value="tax" className="m-0 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="GSTIN"
                        helper="Appears in the letterhead and footer of every quote."
                      >
                        <Input
                          value={profile.gstin ?? ""}
                          onChange={(e) => setField("gstin", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="PAN">
                        <Input
                          value={profile.pan ?? ""}
                          onChange={(e) => setField("pan", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="CIN">
                        <Input
                          value={profile.cin ?? ""}
                          onChange={(e) => setField("cin", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Udyam Reg.">
                        <Input
                          value={profile.udyam ?? ""}
                          onChange={(e) => setField("udyam", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="IEC Code">
                        <Input
                          value={profile.iec_code ?? ""}
                          onChange={(e) => setField("iec_code", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>
                  </TabsContent>

                  <TabsContent value="bank" className="m-0 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Bank Name">
                        <Input
                          value={profile.bank_name ?? ""}
                          onChange={(e) =>
                            setField("bank_name", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Bank Branch">
                        <Input
                          value={profile.bank_branch ?? ""}
                          onChange={(e) =>
                            setField("bank_branch", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Account Number">
                        <Input
                          value={profile.bank_account_no ?? ""}
                          onChange={(e) =>
                            setField("bank_account_no", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="IFSC Code">
                        <Input
                          value={profile.bank_ifsc ?? ""}
                          onChange={(e) =>
                            setField("bank_ifsc", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field
                        label="UPI ID"
                        helper="Optional. Shown on quote PDF if populated."
                      >
                        <Input
                          value={profile.bank_upi ?? ""}
                          onChange={(e) => setField("bank_upi", e.target.value)}
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>
                  </TabsContent>

                  <TabsContent value="terms" className="m-0 space-y-4">
                    <Field
                      label="Default Payment Terms"
                      helper="Shown in the meta strip on every quotation."
                    >
                      <Input
                        value={profile.default_payment_terms ?? ""}
                        onChange={(e) =>
                          setField("default_payment_terms", e.target.value)
                        }
                        disabled={!canEdit}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Default Jurisdiction"
                        helper="Used in the standard T&C block (e.g., 'Daman, India')."
                      >
                        <Input
                          value={profile.default_jurisdiction ?? ""}
                          onChange={(e) =>
                            setField("default_jurisdiction", e.target.value)
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field
                        label="Quote Validity (days)"
                        helper="Default expiry for new quotations."
                      >
                        <Input
                          type="number"
                          min={1}
                          value={profile.quote_validity_days ?? 12}
                          onChange={(e) =>
                            setField(
                              "quote_validity_days",
                              Number(e.target.value) || 1,
                            )
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>
                    <Field
                      label="Standard Terms &amp; Conditions"
                      helper="Optional custom block. Leave blank to use the built-in defaults."
                    >
                      <Textarea
                        rows={6}
                        value={profile.quote_terms_text ?? ""}
                        onChange={(e) =>
                          setField("quote_terms_text", e.target.value)
                        }
                        disabled={!canEdit}
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Authorised Signatory Name"
                        helper="Printed under the signature line on outgoing quotes."
                      >
                        <Input
                          value={profile.authorised_signatory_name ?? ""}
                          onChange={(e) =>
                            setField(
                              "authorised_signatory_name",
                              e.target.value,
                            )
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                      <Field label="Signatory Role">
                        <Input
                          value={profile.authorised_signatory_role ?? ""}
                          onChange={(e) =>
                            setField(
                              "authorised_signatory_role",
                              e.target.value,
                            )
                          }
                          disabled={!canEdit}
                        />
                      </Field>
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>

          {/* ── Live Preview Rail ──────────────────────────────────── */}
          <div className="space-y-4">
            <Card className="border-line">
              <CardHeader className="border-b border-line pb-3">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-content-3">
                  Letterhead preview
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <div className="text-base font-bold text-content-1">
                  {profile.legal_name || "—"}
                </div>
                {profile.tagline ? (
                  <div className="mt-0.5 text-xs italic text-danger-fg">
                    {profile.tagline}
                  </div>
                ) : null}
                <div className="mt-3 text-xs leading-5 text-content-3">
                  {[profile.address_line1, profile.address_line2]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                <div className="text-xs leading-5 text-content-3">
                  {[
                    profile.city,
                    profile.state,
                    profile.country,
                    profile.pincode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                <div className="mt-2 text-xs leading-5 text-content-2">
                  {[profile.phone_primary, profile.phone_secondary]
                    .filter(Boolean)
                    .join(" / ")}
                </div>
                <div className="text-xs leading-5 text-content-2">
                  {profile.email}
                </div>
                <div className="text-xs leading-5 text-content-2">
                  {profile.website}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {profile.gstin ? (
                    <Badge variant="outline">GSTIN {profile.gstin}</Badge>
                  ) : null}
                  {profile.pan ? (
                    <Badge variant="outline">PAN {profile.pan}</Badge>
                  ) : null}
                  {profile.cin ? (
                    <Badge variant="outline">CIN {profile.cin}</Badge>
                  ) : null}
                </div>
                {profile.authorised_signatory_name ? (
                  <div className="mt-4 border-t border-dashed border-line pt-3 text-xs text-content-3">
                    <div className="font-semibold text-content-2">
                      {profile.authorised_signatory_name}
                    </div>
                    <div>
                      {profile.authorised_signatory_role ||
                        "Authorised Signatory"}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── Sticky Save Bar ────────────────────────────────────────────── */}
      {canEdit ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1/95 px-6 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <div className="text-xs text-content-3">
              Changes apply to all quotations and invoices generated from now
              on.
            </div>
            <Button
              disabled={mutation.isPending || !canEdit}
              onClick={() => mutation.mutate(form)}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save changes
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
