"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeIndianRupee,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  Info,
  Loader2,
  Mail,
  Package,
  Plus,
  Save,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  Users,
  Wand2,
  XCircle,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  quotationService,
  type CustomerSummary,
  type QuoteLineSpec,
  type QuotationItem,
  type QuotationListItem,
} from "@/services/quotation";
import QuotationLineCard, {
  type DraftItem,
} from "@/components/quotations/quotation-line-card";
import CostBuildWorkspace from "@/components/quotations/cost-build-workspace";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  SENT: "Sent",
  APPROVED: "Approved",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  VOID: "Void",
  CONVERTED: "Converted",
};

const STATUS_DOT: Record<string, string> = {
  DRAFT: "bg-line",
  PENDING_APPROVAL: "bg-warning-fg",
  SENT: "bg-brand-blue",
  APPROVED: "bg-success-fg",
  ACCEPTED: "bg-success-fg",
  REJECTED: "bg-brand-red",
  EXPIRED: "bg-brand-orange",
  CANCELLED: "bg-brand-red",
  VOID: "bg-brand-red",
  CONVERTED: "bg-brand-navy",
};

const PRESET_TERMS = [
  {
    id: "net45-exworks",
    label: "Net 45 EOM · Ex-works",
    body: "Payment: Net 45 days end of month.\nDelivery: Ex-works our plant.\nGST extra at applicable rate.",
  },
  {
    id: "net30-cif-mumbai",
    label: "Net 30 · CIF Mumbai",
    body: "Payment: Net 30 days.\nDelivery: CIF Mumbai.\nGST extra at applicable rate.",
  },
  {
    id: "advance-50",
    label: "50% Advance · Balance against PI",
    body: "50% advance with PO. Balance against pro-forma invoice before dispatch.\nDelivery: Ex-works.",
  },
];

interface QuotationWorkspaceProps {
  mode: "new" | "edit";
  quotationId?: string;
}

function inrFmt(v: number | string | undefined | null): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

function makeLocalId(): string {
  return `draft-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function toDraftItems(items: QuotationItem[] | undefined): DraftItem[] {
  if (!items) return [];
  return items.map((it, idx) => {
    const lineKind = (it.line_kind as DraftItem["line_kind"]) || "CATALOG";
    const spec = (it.spec_snapshot || {}) as DraftItem["spec_snapshot"];
    const costing = (it.costing_snapshot || {}) as Record<string, unknown>;
    return {
      id: it.id,
      local_id: it.id || makeLocalId(),
      line_no: idx + 1,
      line_kind: lineKind,
      line_name:
        it.line_name ||
        (lineKind === "AD_HOC" ? "Ad-hoc line" : "Catalog line"),
      qty: Number(it.qty_value || 0),
      uom: (it.qty_uom as DraftItem["uom"]) || "KG",
      rate: Number(it.quoted_unit_price || 0),
      margin_pct: Number((costing.margin_pct as number) ?? 0) || null,
      margin_lock: Boolean(it.margin_lock ?? true),
      spec_snapshot: spec,
      costing_snapshot: costing,
    };
  });
}

function asNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function lineSpecRecord(d: DraftItem): QuoteLineSpec & Record<string, unknown> {
  return (d.spec_snapshot || {}) as QuoteLineSpec & Record<string, unknown>;
}

function effectiveLayerGsm(layer: Record<string, unknown>): number {
  const gsm = asNumber(layer.gsm);
  if (gsm > 0) return gsm;
  const micron = asNumber(layer.micron);
  const density = asNumber(layer.density_gcm3);
  return micron > 0 && density > 0 ? Number((micron * density).toFixed(2)) : 0;
}

function buildPrintingSnapshot(
  spec: QuoteLineSpec & Record<string, unknown>,
): Record<string, unknown> {
  if (!spec.print_capable) return { enabled: false };
  const nestedInk = (spec.ink || {}) as Record<string, unknown>;
  const inkGsm =
    asNumber(spec.artwork_ink_gsm_total) ||
    asNumber(spec.ink_gsm) ||
    asNumber(nestedInk.gsm);
  const printType = String(spec.artwork_print_type || spec.print_type || "").toUpperCase();
  const substrateMode = String(
    spec.artwork_substrate_mode || spec.substrate_mode || "",
  ).toUpperCase();
  return {
    enabled: true,
    artwork_id: spec.artwork_id || null,
    artwork_design_code: spec.artwork_code || "",
    artwork_name: spec.artwork_name || "",
    print_type: printType || undefined,
    type: printType || undefined,
    method: printType || undefined,
    substrate_mode: substrateMode || undefined,
    film_type: substrateMode || undefined,
    front_colors_count: asNumber(spec.artwork_front_colors_count) || undefined,
    back_colors_count: asNumber(spec.artwork_back_colors_count) || 0,
    ink_gsm_total: inkGsm,
    ink_gsm: inkGsm,
    manual_ink: !spec.artwork_id,
  };
}

function lineReadinessIssues(d: DraftItem): string[] {
  const spec = lineSpecRecord(d);
  const label = d.line_name || `Line ${d.line_no}`;
  const issues: string[] = [];
  if (d.qty <= 0) issues.push(`${label}: quantity must be greater than zero.`);
  if (d.rate <= 0) issues.push(`${label}: sale rate must be greater than zero.`);
  if (d.line_kind === "CATALOG") {
    if (!spec.product_master_id) issues.push(`${label}: pick a Product Master.`);
    if (!spec.size_id) issues.push(`${label}: pick a saved size.`);
  }
  if (d.line_kind === "AD_HOC") {
    if (!spec.base_product_master_id) {
      issues.push(`${label}: pick a base Product Master layer stack first.`);
    }
    if (!spec.pouch_style_id) {
      issues.push(`${label}: pick an approved pouch style.`);
    }
  }
  if (!asNumber(spec.width_mm) || !asNumber(spec.height_mm)) {
    issues.push(`${label}: enter finished width and height.`);
  }
  const layers = Array.isArray(spec.layers)
    ? (spec.layers as Array<Record<string, unknown>>)
    : [];
  if (layers.length === 0) {
    issues.push(`${label}: add at least one film layer.`);
  }
  layers.forEach((layer, idx) => {
    if (!layer.material_id) issues.push(`${label}: L${idx + 1} needs material.`);
    if (effectiveLayerGsm(layer) <= 0) issues.push(`${label}: L${idx + 1} needs GSM.`);
    if (!layer.material_id && asNumber(layer.rate_per_kg) <= 0) {
      issues.push(`${label}: L${idx + 1} needs material costing or manual rate.`);
    }
  });
  const printing = buildPrintingSnapshot(spec);
  if (spec.print_capable && spec.artwork_required && !printing.artwork_id && asNumber(printing.ink_gsm_total) <= 0) {
    issues.push(`${label}: select approved artwork or enter manual ink GSM.`);
  }
  return issues;
}

function toApiItems(drafts: DraftItem[]): QuotationItem[] {
  return drafts.map((d) => {
    const spec = lineSpecRecord(d);
    const innerPack = spec.optional_inner_pack;
    return {
      id: d.id,
      line_kind: d.line_kind,
      line_name: d.line_name,
      qty_value: d.qty,
      qty_uom: d.uom,
      price_basis: d.uom,
      quoted_unit_price: d.rate,
      quoted_line_total: Number((d.qty * d.rate).toFixed(4)),
      product_master:
        d.line_kind === "CATALOG"
          ? ((spec.product_master_id as string | undefined) || undefined)
          : undefined,
      size:
        d.line_kind === "CATALOG"
          ? ((spec.size_id as string | undefined) || undefined)
          : undefined,
      spec_snapshot: d.spec_snapshot,
      costing_snapshot: d.costing_snapshot,
      printing_snapshot: buildPrintingSnapshot(spec),
      margin_lock: d.margin_lock,
      manual_rate_override: d.margin_lock ? null : d.rate,
      packaging_snapshot:
        innerPack && typeof innerPack === "object"
          ? { optional_inner_pack: innerPack }
          : undefined,
    };
  });
}

export default function QuotationWorkspace({
  mode,
  quotationId,
}: QuotationWorkspaceProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [savedTick, setSavedTick] = useState<number>(0); // re-render every 10s for "saved Xs ago"
  const [dirty, setDirty] = useState<boolean>(false);
  const [sendDialog, setSendDialog] = useState<null | "open">(null);
  const [rejectDialog, setRejectDialog] = useState<null | "open">(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectGate, setRejectGate] = useState<"COMMERCIAL" | "FINANCE">("COMMERCIAL");
  const [convertDialog, setConvertDialog] = useState<null | "open">(null);
  const [clientOutcome, setClientOutcome] = useState<null | "ACCEPTED" | "REJECTED">(null);
  const [clientReference, setClientReference] = useState("");
  const [clientOutcomeReason, setClientOutcomeReason] = useState("");
  const [terminalAction, setTerminalAction] = useState<null | "CANCEL" | "VOID">(null);
  const [terminalReason, setTerminalReason] = useState("");
  const seededRef = useRef<string | null>(null);

  // Commercials local state (synced into payload on save)
  const [discountPct, setDiscountPct] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [freightAmount, setFreightAmount] = useState<number>(0);
  const [freightIncluded, setFreightIncluded] = useState<boolean>(true);
  const [otherCharges, setOtherCharges] = useState<
    Array<{ label: string; amount: number }>
  >([]);
  const [gstRate, setGstRate] = useState<number>(18);
  const [customTerms, setCustomTerms] = useState<string>("");
  const [termsTemplate, setTermsTemplate] = useState<string>("");
  const [enquiryReference, setEnquiryReference] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [deliveryTerms, setDeliveryTerms] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("");

  const quoteQuery = useQuery({
    queryKey: ["quotation", quotationId],
    queryFn: () =>
      quotationId ? quotationService.get(quotationId) : Promise.resolve(null),
    enabled: mode === "edit" && Boolean(quotationId),
  });

  const quote = quoteQuery.data as QuotationListItem | null;

  // Seed local draft + commercials from server payload (once per refetch).
  useEffect(() => {
    if (!quote) return;
    const key = `${quote.id}|${quote.updated_at}`;
    if (seededRef.current === key) return;
    seededRef.current = key;
    const seeded = toDraftItems(quote.items);
    setDrafts(seeded);
    if (seeded.length > 0 && !openId) setOpenId(seeded[0].local_id);
    setDiscountPct(Number(quote.discount_pct || 0));
    setDiscountAmount(Number(quote.discount_amount || 0));
    setFreightAmount(Number(quote.freight_amount || 0));
    setFreightIncluded(quote.freight_included !== false);
    setOtherCharges(
      Array.isArray(quote.other_charges) ? quote.other_charges : [],
    );
    setGstRate(Number(quote.gst_rate || 18));
    setCustomTerms(quote.custom_terms || "");
    setEnquiryReference(quote.enquiry_reference || "");
    setContactName(quote.contact_name || "");
    setContactEmail(quote.contact_email || "");
    setContactPhone(quote.contact_phone || "");
    setBillingAddress(quote.billing_address || "");
    setShippingAddress(quote.shipping_address || "");
    setValidUntil(quote.valid_until || "");
    setPaymentTerms(quote.payment_terms || "");
    setDeliveryTerms(quote.delivery_terms || "");
    setRequestedDeliveryDate(quote.requested_delivery_date || "");
    setPlaceOfSupply(quote.place_of_supply || "");
    setDirty(false);
  }, [quote?.id, quote?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick "saved Xs ago" every 10s.
  useEffect(() => {
    if (!lastSavedAt) return;
    const t = setInterval(() => setSavedTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [lastSavedAt]);

  // Local-edit dirty flag — comparison-by-stringify is cheap for our payload.
  useEffect(() => {
    if (!quote) return;
    // Skip until first seed runs.
    if (seededRef.current !== `${quote.id}|${quote.updated_at}`) return;
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    drafts,
    discountPct,
    discountAmount,
    freightAmount,
    freightIncluded,
    otherCharges,
    gstRate,
    customTerms,
    enquiryReference,
    contactName,
    contactEmail,
    contactPhone,
    billingAddress,
    shippingAddress,
    validUntil,
    paymentTerms,
    deliveryTerms,
    requestedDeliveryDate,
    placeOfSupply,
  ]);

  const persistDraft = useCallback(async () => {
    if (!quotationId) {
      throw new Error("Save the quotation header first before persisting lines.");
    }
    await quotationService.update(quotationId, {
      discount_pct: discountPct,
      discount_amount: discountAmount,
      freight_amount: freightAmount,
      freight_included: freightIncluded,
      other_charges: otherCharges,
      gst_rate: gstRate,
      custom_terms: customTerms,
      enquiry_reference: enquiryReference,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      billing_address: billingAddress,
      shipping_address: shippingAddress,
      valid_until: validUntil || null,
      payment_terms: paymentTerms,
      delivery_terms: deliveryTerms,
      requested_delivery_date: requestedDeliveryDate || null,
      place_of_supply: placeOfSupply,
    });
    return quotationService.bulkUpdateItems(quotationId, toApiItems(drafts));
  }, [
    quotationId,
    discountPct,
    discountAmount,
    freightAmount,
    freightIncluded,
    otherCharges,
    gstRate,
    customTerms,
    enquiryReference,
    contactName,
    contactEmail,
    contactPhone,
    billingAddress,
    shippingAddress,
    validUntil,
    paymentTerms,
    deliveryTerms,
    requestedDeliveryDate,
    placeOfSupply,
    drafts,
  ]);

  // ─────────────────────────── Mutations ───────────────────────────

  const cloneMut = useMutation({
    mutationFn: (id: string) => quotationService.cloneRevision(id),
    onSuccess: (q) => {
      void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] });
      toast({
        title: "Quotation duplicated",
        description: `New ${q.quote_number} opened.`,
      });
      router.push(`/sales/quotations/${q.id}`);
    },
    onError: (e: Error) =>
      toast({
        title: "Clone failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const sendMut = useMutation({
    mutationFn: async ({
      id,
      via,
    }: {
      id: string;
      via: "email" | "whatsapp" | "pdf_only";
    }) => {
      await persistDraft();
      if (via !== "email") throw new Error("Only evidenced email delivery is available.");
      const recipient = contactEmail.trim();
      if (!recipient) throw new Error("Add the client email address before sending.");
      return quotationService.send(id, { recipients: [recipient] });
    },
    onSuccess: () => {
      setSendDialog(null);
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] });
      toast({
        title: "Quotation sent",
        description: "Customer notification recorded.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Send failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const approveMut = useMutation({
    mutationFn: ({ id, gate }: { id: string; gate: "COMMERCIAL" | "FINANCE" }) =>
      quotationService.approve(id, gate),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      toast({
        title: "Quote approved",
        description: "Ready to convert to sales order.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Approve failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const submitMut = useMutation({
    mutationFn: async (id: string) => {
      await persistDraft();
      return quotationService.submitForApproval(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] });
      toast({ title: "Submitted for approval", description: "This exact revision and Cost Build are now frozen." });
    },
    onError: (e: Error) => toast({ title: "Submission blocked", description: e.message, variant: "destructive" }),
  });

  const outcomeMut = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "ACCEPTED" | "REJECTED" }) =>
      quotationService.recordClientOutcome(id, {
        outcome,
        reference: clientReference,
        channel: "EMAIL",
        reason: clientOutcomeReason,
      }),
    onSuccess: () => {
      setClientOutcome(null);
      setClientReference("");
      setClientOutcomeReason("");
      void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] });
      toast({ title: "Client outcome recorded", description: "The immutable revision timeline has been updated." });
    },
    onError: (e: Error) => toast({ title: "Outcome could not be recorded", description: e.message, variant: "destructive" }),
  });

  const terminalMut = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "CANCEL" | "VOID" }) =>
      action === "CANCEL" ? quotationService.cancel(id, terminalReason) : quotationService.void(id, terminalReason),
    onSuccess: () => {
      setTerminalAction(null);
      setTerminalReason("");
      void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] });
      toast({ title: "Quotation record updated", description: "The reason is preserved in the audit timeline." });
    },
    onError: (e: Error) => toast({ title: "Action blocked", description: e.message, variant: "destructive" }),
  });

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      quotationService.reject(id, reason, rejectGate),
    onSuccess: () => {
      setRejectDialog(null);
      setRejectReason("");
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      toast({
        title: "Quote rejected",
        description: "Reason captured on the timeline.",
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Reject failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const expireMut = useMutation({
    mutationFn: (id: string) => quotationService.expire(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      toast({ title: "Quote marked expired" });
    },
    onError: (e: Error) =>
      toast({
        title: "Mark expired failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const convertMut = useMutation({
    mutationFn: (id: string) => quotationService.convertToOrder(id),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      toast({
        title: "Converted to sales order",
        description: `SO ${res.sales_order_number} created.`,
      });
      router.push(`/sales/orders/${res.sales_order_id}`);
    },
    onError: (e: Error) =>
      toast({
        title: "Convert failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      quotationService.create(body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] });
      toast({
        title: "Quotation started",
        description: `New ${created.quote_number} opened.`,
      });
      router.push(`/sales/quotations/${created.id}`);
    },
    onError: (e: Error) =>
      toast({
        title: "Could not create quotation",
        description: e.message,
        variant: "destructive",
      }),
  });

  const saveMut = useMutation({
    mutationFn: persistDraft,
    onMutate: () => {
      // Optimistic — show pulse via lastSavedAt clearing
    },
    onSuccess: () => {
      setLastSavedAt(Date.now());
      setDirty(false);
      void queryClient.invalidateQueries({
        queryKey: ["quotation", quotationId],
      });
      toast({ title: "Saved", description: "Quotation persisted." });
    },
    onError: (e: Error) =>
      toast({
        title: "Save failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  // ⌘+S / Ctrl+S triggers save.
  const triggerSave = useCallback(() => {
    if (!quotationId) return;
    if (saveMut.isPending) return;
    saveMut.mutate();
  }, [quotationId, saveMut]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        triggerSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triggerSave]);

  // ─────────────────── Customer context fetch ──────────────────────

  const customerId =
    (quote as { customer?: string } | null)?.customer || undefined;
  const customerQuery = useQuery<CustomerSummary>({
    queryKey: ["customer", customerId],
    queryFn: () => quotationService.getCustomer(customerId!),
    enabled: Boolean(customerId),
  });
  const lastOrderQuery = useQuery({
    queryKey: ["customer-orders", customerId],
    queryFn: () =>
      quotationService.listCustomerOrders(customerId!, { limit: 1 }),
    enabled: Boolean(customerId),
  });

  // ─────────────────────────── Derived ──────────────────────────────

  const validDays = useMemo(() => {
    if (!quote?.valid_until) return null;
    const target = new Date(quote.valid_until).getTime();
    const now = Date.now();
    if (!Number.isFinite(target)) return null;
    return Math.max(0, Math.ceil((target - now) / (24 * 60 * 60 * 1000)));
  }, [quote?.valid_until]);

  const totals = (quote?.totals_snapshot || {}) as Record<
    string,
    number | boolean | undefined
  >;
  const subtotal = drafts.reduce((s, d) => s + d.qty * d.rate, 0);
  const computedDiscount =
    discountAmount > 0 ? discountAmount : (subtotal * discountPct) / 100;
  const freightExtra = freightIncluded ? 0 : freightAmount;
  const otherChargesTotal = otherCharges.reduce(
    (s, c) => s + Number(c.amount || 0),
    0,
  );
  const taxable = Math.max(
    0,
    subtotal - computedDiscount + freightExtra + otherChargesTotal,
  );
  const tax = (taxable * gstRate) / 100;
  const grand = taxable + tax;
  const blockingLineIssues = useMemo(
    () => drafts.flatMap((draft) => lineReadinessIssues(draft)),
    [drafts],
  );

  // Production readiness check
  const readiness: { level: "GREEN" | "AMBER" | "RED"; reasons: string[] } =
    useMemo(() => {
      const reasons: string[] = [];
      let amber = false;
      let red = false;
      if (drafts.length === 0) {
        red = true;
        reasons.push("No quote lines.");
      }
      if (blockingLineIssues.length > 0) {
        red = true;
        reasons.push(...blockingLineIssues.slice(0, 5));
        if (blockingLineIssues.length > 5) {
          reasons.push(`${blockingLineIssues.length - 5} more line issues.`);
        }
      }
      const authoritativeReadiness = quote?.readiness;
      if (authoritativeReadiness && !authoritativeReadiness.ready) {
        red = true;
        reasons.push(...authoritativeReadiness.errors.slice(0, 5));
      }
      if (
        validDays !== null &&
        validDays === 0 &&
        quote?.status !== "CONVERTED"
      ) {
        red = true;
        reasons.push("Validity has expired.");
      }
      if (customerQuery.data) {
        const cl = Number(customerQuery.data.credit_limit || 0);
        if (cl > 0 && grand > cl) {
          red = true;
          reasons.push(
            `Quote ${inrFmt(grand)} exceeds credit limit ${inrFmt(cl)}.`,
          );
        }
      }
      if (red) return { level: "RED", reasons };
      if (amber) return { level: "AMBER", reasons };
      return {
        level: "GREEN",
        reasons: ["All lines have valid BOM, costing, and credit headroom."],
      };
    }, [drafts, blockingLineIssues, validDays, quote?.status, quote?.readiness, customerQuery.data, grand]);

  const status = quote?.status || "DRAFT";

  if (mode === "edit" && quoteQuery.isLoading) {
    return (
      <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8">
        <div className="rounded-2xl bg-surface-1 ring-1 ring-line p-10 text-center text-sm font-semibold text-content-3">
          Loading quotation…
        </div>
      </main>
    );
  }

  if (mode === "edit" && !quote) {
    return (
      <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8">
        <div className="rounded-2xl bg-surface-1 ring-1 ring-line p-10 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto text-warning-fg" />
          <div className="mt-3 font-bold text-content-2">
            Quotation not found.
          </div>
          <Link
            href="/sales/quotations"
            className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-order-fg text-white font-extrabold text-sm hover:bg-order-fg"
          >
            <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
            Back to list
          </Link>
        </div>
      </main>
    );
  }

  if (mode === "new" && !quotationId) {
    return (
      <NewQuotationOnboarding
        onPick={(customer, repeatFromId) => {
          if (repeatFromId) {
            cloneMut.mutate(repeatFromId);
          } else {
            createMut.mutate({
              customer: customer.id,
              customer_name: customer.name,
              status: "DRAFT",
              currency: "INR",
            });
          }
        }}
        creating={createMut.isPending || cloneMut.isPending}
      />
    );
  }

  const headerNumber = quote?.quote_number || "NEW QUOTE";
  const headerStatus = quote
    ? STATUS_LABEL[quote.status] || quote.status
    : "draft";
  const customerLabel = quote?.customer_name || "Pick customer";
  const showValidChip = validDays !== null;
  const canPersist = Boolean(quotationId);

  const handleAddCatalog = () => {
    const id = makeLocalId();
    setDrafts((prev) => [
      ...prev,
      {
        local_id: id,
        line_no: prev.length + 1,
        line_kind: "CATALOG",
        line_name: "New catalog line",
        qty: 1,
        uom: "KG",
        rate: 0,
        margin_pct: 25,
        margin_lock: true,
        spec_snapshot: {},
      },
    ]);
    setOpenId(id);
  };

  const handleAddAdhoc = () => {
    const id = makeLocalId();
    setDrafts((prev) => [
      ...prev,
      {
        local_id: id,
        line_no: prev.length + 1,
        line_kind: "AD_HOC",
        line_name: "Ad-hoc pouch",
        qty: 100,
        uom: "KG",
        rate: 0,
        margin_pct: 25,
        margin_lock: true,
        spec_snapshot: {
          width_mm: 0,
          height_mm: 0,
          gusset_mm: 0,
          flap_mm: 0,
          layers: [],
          adhesive: { name: "Adhesive", gsm: 0, rate_per_kg: 0 },
          ink: { name: "Ink", gsm: 0, rate_per_kg: 0, coverage: "MEDIUM" },
          addons: [],
          features: {},
          optional_inner_pack: null,
        },
      },
    ]);
    setOpenId(id);
  };

  const handleChange = (local_id: string, next: DraftItem) => {
    setDrafts((prev) => prev.map((d) => (d.local_id === local_id ? next : d)));
  };

  const handleRemove = (local_id: string) => {
    setDrafts((prev) => {
      const filtered = prev.filter((d) => d.local_id !== local_id);
      return filtered.map((d, idx) => ({ ...d, line_no: idx + 1 }));
    });
    if (openId === local_id) setOpenId(null);
  };

  const handleDuplicate = (local_id: string) => {
    setDrafts((prev) => {
      const source = prev.find((d) => d.local_id === local_id);
      if (!source) return prev;
      const clone: DraftItem = {
        ...source,
        local_id: makeLocalId(),
        id: undefined,
        line_no: prev.length + 1,
        line_name: `${source.line_name} (copy)`,
      };
      return [...prev, clone];
    });
  };

  const handleApplyTermsTemplate = (templateId: string) => {
    setTermsTemplate(templateId);
    const tpl = PRESET_TERMS.find((t) => t.id === templateId);
    if (tpl) setCustomTerms(tpl.body);
  };

  const counts = {
    total: drafts.length,
    catalog: drafts.filter((d) => d.line_kind === "CATALOG").length,
    adhoc: drafts.filter((d) => d.line_kind === "AD_HOC").length,
  };

  const creditLimit = Number(customerQuery.data?.credit_limit || 0);
  const creditWarning =
    creditLimit > 0 && grand > creditLimit
      ? {
          level: "RED" as const,
          msg: `Exceeds credit limit by ₹${inrFmt(grand - creditLimit)}.`,
        }
      : creditLimit > 0 && grand > creditLimit * 0.9
        ? { level: "AMBER" as const, msg: `Within 10% of credit limit.` }
        : null;

  // ── Send / approve / convert client-side guards ──────────────────────────
  const hasLines = drafts.length > 0;
  const linesValid =
    drafts.length > 0 && drafts.every((d) => d.qty > 0 && d.rate > 0);
  const approveBlockedReason = !quote
    ? "Save the quotation first."
    : !hasLines
      ? "Add at least one line."
      : !linesValid
        ? "Every line needs qty > 0 and rate > 0."
        : null;

  // Blended margin across all lines.
  const totalCost = drafts.reduce((s, d) => {
    const costing = d.costing_snapshot as
      | { total_cost_per_kg?: number }
      | undefined;
    const cost = Number(costing?.total_cost_per_kg || 0);
    return s + cost * d.qty;
  }, 0);
  const blendedMargin =
    subtotal > 0 ? ((subtotal - totalCost) / subtotal) * 100 : 0;
  const totalKg = drafts.reduce((s, d) => s + (d.uom === "KG" ? d.qty : 0), 0);
  // Margin colour bucket.
  const marginColor =
    blendedMargin >= 20
      ? "text-success-fg bg-success-bg ring-success-border"
      : blendedMargin >= 10
        ? "text-warning-fg bg-warning-bg ring-warning-border"
        : "text-danger-fg bg-danger-bg ring-danger-border";
  return (
    <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8 pb-32 space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-order-fg via-order-fg to-order-fg p-6 text-white shadow-[0_24px_60px_-36px_rgba(79,70,229,0.6)]">
        <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-surface-1/10 blur-3xl" />
        <div className="absolute -left-10 -bottom-20 h-56 w-56 rounded-full bg-order-fg blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.22em] text-order-border">
              <Link
                href="/sales/quotations"
                className="inline-flex items-center gap-1 hover:underline"
              >
                <ArrowLeft className="h-3 w-3" strokeWidth={2.5} />
                Quotations
              </Link>
              <span>·</span>
              <span>Workspace</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mt-1.5">
              <span className="font-mono">{headerNumber}</span>
              <span className="ml-2 text-base font-bold text-order-border">
                {headerStatus.toLowerCase()}
              </span>
            </h1>
            <p className="text-sm font-semibold text-order-border mt-1">
              Use a ready catalog product or build a quote-scoped configuration
              under an existing Base Product. Masters are never created or changed here.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-extrabold bg-surface-1/15 backdrop-blur text-white ring-1 ring-surface-1/20">
                CUSTOMER · {customerLabel}
              </span>
              {showValidChip ? (
                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-extrabold bg-success-fg text-success-border ring-1 ring-success-border">
                  VALID {validDays} DAYS
                </span>
              ) : null}
              {/* Production readiness chip */}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-extrabold ring-1",
                  readiness.level === "GREEN" &&
                    "bg-success-fg text-success-border ring-success-border",
                  readiness.level === "AMBER" &&
                    "bg-warning-fg text-warning-border ring-warning-border",
                  readiness.level === "RED" &&
                    "bg-danger-fg text-danger-border ring-danger-border",
                )}
                title={readiness.reasons.join(" · ")}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", {
                    "bg-success-fg": readiness.level === "GREEN",
                    "bg-warning-fg": readiness.level === "AMBER",
                    "bg-danger-fg": readiness.level === "RED",
                  })}
                />
                {readiness.level === "GREEN"
                  ? "Ready"
                  : readiness.level === "AMBER"
                    ? "Needs review"
                    : "Blocked"}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {quote ? (
              <a
                href={quotationService.pdfUrl(quote.id)}
                target="_blank"
                rel="noopener"
                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-surface-1/10 backdrop-blur text-white font-bold text-sm ring-1 ring-surface-1/20 hover:bg-surface-1/15"
              >
                <Download className="h-4 w-4" strokeWidth={2.5} />
                Preview PDF
              </a>
            ) : null}
            {quote && quote.status === "ACCEPTED" ? (
              <button
                onClick={() => setConvertDialog("open")}
                disabled={convertMut.isPending}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-surface-1 text-order-fg font-extrabold text-sm hover:bg-order-bg shadow-md disabled:opacity-60"
              >
                {convertMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Truck className="h-4 w-4" strokeWidth={2.5} />
                )}
                Convert to Sales Order
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {/* Status-driven banner */}
      {quote ? (
        <StatusBanner
          quote={quote}
          drafts={drafts}
          onConvert={() => setConvertDialog("open")}
          onClone={() => cloneMut.mutate(quote.id)}
          onSend={() => setSendDialog("open")}
        />
      ) : null}

      {/* Live summary chip */}
      {quote ? (
        <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-3 flex flex-wrap items-center gap-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-order-bg text-order-fg ring-1 ring-order-border">
            <FileText className="h-3 w-3" /> {counts.total} lines
          </span>
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-info-bg text-info-fg ring-1 ring-info-border font-mono">
            {inrFmt(totalKg)} KG
          </span>
          <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-success-bg text-success-fg ring-1 ring-success-border font-mono">
            ₹ {inrFmt(grand)}
          </span>
          {subtotal > 0 ? (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold ring-1 font-mono",
                marginColor,
              )}
            >
              {blendedMargin.toFixed(1)}% blended margin
            </span>
          ) : null}
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-warning-bg text-warning-fg ring-1 ring-warning-border">
              <span className="h-1.5 w-1.5 rounded-full bg-warning-fg animate-pulse" />
              Unsaved changes
            </span>
          ) : lastSavedAt ? (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-surface-2 text-content-3 ring-1 ring-line">
              <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
              Saved {savedAgo(lastSavedAt, savedTick)}
            </span>
          ) : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
        <div className="space-y-5 min-w-0">
          {/* Meta strip */}
          <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-[11px] font-extrabold uppercase tracking-widest text-content-3">
              <div>
                <div>Customer</div>
                <div className="mt-1 text-sm font-bold text-content-1 normal-case tracking-normal truncate">
                  {quote?.customer_name || "—"}
                </div>
              </div>
              <div>
                <div>Plant</div>
                <div className="mt-1 text-sm font-bold text-content-1 normal-case tracking-normal">
                  {quote?.plant_name || "—"}
                </div>
              </div>
              <div>
                <div>Currency</div>
                <div className="mt-1 text-sm font-bold text-content-1 font-mono normal-case tracking-normal">
                  {quote?.currency || "INR"}
                </div>
              </div>
              <div>
                <div>Status</div>
                <div className="mt-1 text-sm font-bold text-content-1 normal-case tracking-normal flex items-center gap-2">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      STATUS_DOT[status],
                    )}
                  />
                  {headerStatus}
                </div>
              </div>
              <div>
                <div>Valid until</div>
                <div className="mt-1 text-sm font-bold text-content-1 font-mono normal-case tracking-normal">
                  {quote?.valid_until || "—"}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-extrabold text-content-1">Client and enquiry context</h3>
                <p className="mt-1 text-[11px] font-semibold text-content-4">These values are snapshotted on this revision. Missing Customer Master details remain visible blockers; nothing is invented.</p>
              </div>
              {status !== "DRAFT" ? <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wider text-content-3 ring-1 ring-line">Frozen revision</span> : null}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <QuoteField label="Enquiry / RFQ reference" value={enquiryReference} onChange={setEnquiryReference} disabled={status !== "DRAFT"} />
              <QuoteField label="Contact name" value={contactName} onChange={setContactName} disabled={status !== "DRAFT"} required />
              <QuoteField label="Contact email" value={contactEmail} onChange={setContactEmail} disabled={status !== "DRAFT"} type="email" required />
              <QuoteField label="Contact phone" value={contactPhone} onChange={setContactPhone} disabled={status !== "DRAFT"} />
              <QuoteField label="Valid until" value={validUntil} onChange={setValidUntil} disabled={status !== "DRAFT"} type="date" required />
              <QuoteField label="Requested delivery" value={requestedDeliveryDate} onChange={setRequestedDeliveryDate} disabled={status !== "DRAFT"} type="date" />
              <QuoteField label="Place of supply" value={placeOfSupply} onChange={setPlaceOfSupply} disabled={status !== "DRAFT"} />
              <QuoteField label="Payment terms" value={paymentTerms} onChange={setPaymentTerms} disabled={status !== "DRAFT"} required />
              <QuoteField label="Delivery terms" value={deliveryTerms} onChange={setDeliveryTerms} disabled={status !== "DRAFT"} required />
              <QuoteField label="Bill-to address" value={billingAddress} onChange={setBillingAddress} disabled={status !== "DRAFT"} multiline required />
              <QuoteField label="Ship-to address" value={shippingAddress} onChange={setShippingAddress} disabled={status !== "DRAFT"} multiline required />
            </div>
          </section>

          {/* Action rail */}
          {quote ? (
            <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 flex flex-wrap gap-2 items-center shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
              <button
                onClick={() => cloneMut.mutate(quote.id)}
                disabled={cloneMut.isPending}
                className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-surface-2 text-content-2 font-bold text-sm hover:bg-line disabled:opacity-60"
              >
                {cloneMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={2.2} />
                )}
                Duplicate quotation
              </button>
              {quote.status === "DRAFT" ? (
                <button
                  onClick={() => submitMut.mutate(quote.id)}
                  disabled={submitMut.isPending || Boolean(approveBlockedReason)}
                  title={approveBlockedReason || "Freeze and request commercial and finance approval"}
                  className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-order-fg text-white font-bold text-sm disabled:opacity-60"
                >
                  {submitMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Submit for approval
                </button>
              ) : null}
              {quote.status === "PENDING_APPROVAL" ? (
                <>
                  {(quote.approval_gates || []).filter((gate) => gate.status === "PENDING").map((gate) => (
                    <button
                      key={gate.id}
                      onClick={() => approveMut.mutate({ id: quote.id, gate: gate.gate as "COMMERCIAL" | "FINANCE" })}
                      disabled={approveMut.isPending}
                      className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-success-fg text-white font-bold text-sm disabled:opacity-60"
                    >
                      <ShieldCheck className="h-4 w-4" /> Approve {gate.gate.toLowerCase()}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      const pending = (quote.approval_gates || []).find((gate) => gate.status === "PENDING");
                      setRejectGate((pending?.gate as "COMMERCIAL" | "FINANCE") || "COMMERCIAL");
                      setRejectDialog("open");
                    }}
                    disabled={rejectMut.isPending}
                    className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-danger-bg text-danger-fg ring-1 ring-danger-border font-bold text-sm disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" /> Reject pending gate
                  </button>
                </>
              ) : null}
              {quote.status === "APPROVED" ? (
                <button
                  onClick={() => setSendDialog("open")}
                  disabled={sendMut.isPending || !contactEmail.trim()}
                  title={contactEmail.trim() ? "Release frozen client PDF by evidenced email" : "Client email is required"}
                  className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-bold text-sm disabled:opacity-60"
                >
                  <Send className="h-4 w-4" /> Send frozen revision
                </button>
              ) : null}
              {quote.status === "SENT" ? <>
                <button onClick={() => setClientOutcome("ACCEPTED")} className="h-10 px-3 rounded-xl bg-success-fg text-white font-bold text-sm">Record acceptance</button>
                <button onClick={() => setClientOutcome("REJECTED")} className="h-10 px-3 rounded-xl bg-danger-bg text-danger-fg ring-1 ring-danger-border font-bold text-sm">Record rejection</button>
                <button onClick={() => expireMut.mutate(quote.id)} disabled={expireMut.isPending} className="h-10 px-3 rounded-xl text-warning-fg hover:bg-warning-bg font-bold text-sm">Mark expired</button>
              </> : null}
              {!["CONVERTED", "CANCELLED", "VOID"].includes(quote.status) ? <>
                <button onClick={() => setTerminalAction("CANCEL")} className="h-10 px-3 rounded-xl text-content-3 hover:bg-surface-2 font-bold text-sm">Cancel</button>
                <button onClick={() => setTerminalAction("VOID")} className="h-10 px-3 rounded-xl text-danger-fg hover:bg-danger-bg font-bold text-sm">Void</button>
              </> : null}
              {["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"].includes(quote.status) ? (
                <a
                  href={quotationService.pdfUrl(quote.id, { customerView: true })}
                  target="_blank"
                  rel="noopener"
                  className="h-10 px-3 inline-flex items-center gap-2 rounded-xl text-content-3 hover:bg-surface-2 font-bold text-sm ml-auto"
                >
                  <Eye className="h-4 w-4" strokeWidth={2.2} />
                  Customer view
                </a>
              ) : null}
            </section>
          ) : null}

          {/* Lines */}
          <section className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-order-fg" />
                <h3 className="text-base font-extrabold text-content-1">
                  Quote Lines
                </h3>
                <span className="text-[11px] font-bold uppercase tracking-wider text-content-3">
                  {counts.total} lines · {counts.catalog} catalog ·{" "}
                  {counts.adhoc} ad-hoc · ₹ {inrFmt(subtotal)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddCatalog}
                  className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-success-bg text-success-fg ring-1 ring-success-border font-extrabold text-xs uppercase tracking-widest hover:bg-success-bg"
                >
                  <Package className="h-3.5 w-3.5" />
                  <Plus className="h-3.5 w-3.5 -ml-1" />
                  Catalog line
                </button>
                <button
                  onClick={handleAddAdhoc}
                  className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-order-bg text-order-fg ring-1 ring-order-border font-extrabold text-xs uppercase tracking-widest hover:bg-order-bg"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  <Plus className="h-3.5 w-3.5 -ml-1" />
                  Ad-hoc pouch
                </button>
              </div>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-2xl bg-surface-1 ring-1 ring-line p-10 text-center">
                <div className="text-sm font-extrabold text-content-2">
                  No lines yet.
                </div>
                <p className="mt-1 text-[12px] font-semibold text-content-3">
                  Add a ready catalog product, or build a quote-scoped pouch
                  configuration under an existing Base Product.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {drafts.map((draft) => (
                  <QuotationLineCard
                    key={draft.local_id}
                    item={draft}
                    isOpen={openId === draft.local_id}
                    onToggle={() =>
                      setOpenId((cur) =>
                        cur === draft.local_id ? null : draft.local_id,
                      )
                    }
                    onChange={(next) => handleChange(draft.local_id, next)}
                    onRemove={() => handleRemove(draft.local_id)}
                    onDuplicate={() => handleDuplicate(draft.local_id)}
                    onSaveLine={() => saveMut.mutate()}
                    canPersist={canPersist}
                  />
                ))}
              </div>
            )}
          </section>

          {quote ? <CostBuildWorkspace quote={quote} /> : null}

          {quote?.items?.some((item) => item.actual_variance) ? (
            <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-content-1">Quote vs actual cost</h3>
                  <p className="mt-1 text-xs font-semibold text-content-3">
                    Source-backed downstream actuals; partial coverage is labelled and never presented as final.
                  </p>
                </div>
                <span className="rounded-full bg-info-bg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-info-fg ring-1 ring-info-border">
                  Converted workflow
                </span>
              </div>
              <div className="mt-4 space-y-2">
                {quote.items.filter((item) => item.actual_variance).map((item, index) => {
                  const variance = item.actual_variance!;
                  const amount = Number(variance.variance_amount || 0);
                  return (
                    <div key={item.id || index} className="grid gap-3 rounded-xl bg-surface-2 p-3 text-xs font-bold md:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,0.7fr))]">
                      <div className="min-w-0">
                        <div className="truncate text-content-1">{item.line_name || `Line ${index + 1}`}</div>
                        <div className="mt-1 text-[10px] text-content-3">Actual coverage {Number(variance.actual_coverage_pct || 0).toFixed(2)}%</div>
                      </div>
                      <Metric label="Quoted cost" value={`₹ ${inrFmt(Number(variance.quoted_total_cost || 0))}`} />
                      <Metric label="Actual cost" value={`₹ ${inrFmt(Number(variance.actual_total_cost || 0))}`} />
                      <Metric label="Variance" value={`${amount >= 0 ? "+" : "−"}₹ ${inrFmt(Math.abs(amount))}`} />
                      <Metric label="Variance %" value={`${Number(variance.variance_percent || 0).toFixed(2)}%`} />
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Commercials */}
          <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)] space-y-4">
            <div className="flex items-center gap-2">
              <BadgeIndianRupee className="h-5 w-5 text-success-fg" />
              <h3 className="text-base font-extrabold text-content-1">
                Commercials
              </h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="block">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Discount %
                </span>
                <input
                  type="number"
                  value={discountPct}
                  onChange={(e) => {
                    setDiscountPct(Number(e.target.value));
                    setDiscountAmount(0);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Discount ₹
                </span>
                <input
                  type="number"
                  value={discountAmount}
                  onChange={(e) => {
                    setDiscountAmount(Number(e.target.value));
                    if (e.target.value) setDiscountPct(0);
                  }}
                  className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Freight ₹
                </span>
                <input
                  type="number"
                  value={freightAmount}
                  onChange={(e) => setFreightAmount(Number(e.target.value))}
                  className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  GST %
                </span>
                <input
                  type="number"
                  value={gstRate}
                  onChange={(e) => setGstRate(Number(e.target.value))}
                  className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-content-3">
              <input
                type="checkbox"
                checked={freightIncluded}
                onChange={(e) => setFreightIncluded(e.target.checked)}
              />
              Freight included in line rate (otherwise charged extra)
            </label>

            {/* Other charges */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Other charges (tooling, samples, dies)
                </div>
                <button
                  onClick={() =>
                    setOtherCharges((prev) => [
                      ...prev,
                      { label: "Charge", amount: 0 },
                    ])
                  }
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-surface-2 text-content-2 text-[11px] font-extrabold uppercase tracking-wider hover:bg-line"
                >
                  <Plus className="h-3 w-3" strokeWidth={2.5} />
                  Add
                </button>
              </div>
              {otherCharges.length === 0 ? (
                <div className="text-[11px] font-bold text-content-4">
                  None.
                </div>
              ) : (
                otherCharges.map((c, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_140px_auto] gap-2 items-center"
                  >
                    <input
                      type="text"
                      value={c.label}
                      onChange={(e) =>
                        setOtherCharges((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                      className="h-9 rounded-lg border border-line px-2 text-sm font-bold outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                    />
                    <input
                      type="number"
                      value={c.amount}
                      onChange={(e) =>
                        setOtherCharges((prev) =>
                          prev.map((x, i) =>
                            i === idx
                              ? { ...x, amount: Number(e.target.value) }
                              : x,
                          ),
                        )
                      }
                      className="h-9 rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                    />
                    <button
                      onClick={() =>
                        setOtherCharges((prev) =>
                          prev.filter((_, i) => i !== idx),
                        )
                      }
                      className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-content-4 hover:text-danger-fg hover:bg-danger-bg"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Totals summary */}
            <div className="rounded-xl border border-line p-4 bg-surface-2 space-y-1.5">
              <Row label="Subtotal" value={`₹ ${inrFmt(subtotal)}`} />
              {computedDiscount > 0 ? (
                <Row
                  label="Discount"
                  value={`- ₹ ${inrFmt(computedDiscount)}`}
                  color="text-danger-fg"
                />
              ) : null}
              {freightAmount > 0 ? (
                <Row
                  label={
                    freightIncluded ? "Freight (incl.)" : "Freight (extra)"
                  }
                  value={
                    freightIncluded ? "Included" : `₹ ${inrFmt(freightAmount)}`
                  }
                />
              ) : null}
              {otherCharges.length > 0 ? (
                <Row
                  label="Other charges"
                  value={`₹ ${inrFmt(otherChargesTotal)}`}
                />
              ) : null}
              <Row label="Taxable" value={`₹ ${inrFmt(taxable)}`} bold />
              <Row label={`GST ${gstRate}%`} value={`₹ ${inrFmt(tax)}`} />
              <div className="border-t border-line my-2" />
              <Row label="Grand total" value={`₹ ${inrFmt(grand)}`} bold huge />
            </div>

            {/* Terms */}
            <div className="space-y-2 pt-2">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                Terms preset
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TERMS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleApplyTermsTemplate(t.id)}
                    className={cn(
                      "h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition",
                      termsTemplate === t.id
                        ? "bg-surface-3 text-white ring-line-strong"
                        : "bg-surface-2 text-content-3 ring-line hover:bg-surface-2",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea
                value={customTerms}
                onChange={(e) => setCustomTerms(e.target.value)}
                placeholder="Custom terms — payment, delivery, conditions…"
                rows={4}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
              />
            </div>
          </section>
        </div>

        {/* Right rail */}
        <aside className="space-y-4">
          {/* Customer context */}
          {quote ? (
            <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-brand-navy" />
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                    Customer
                  </div>
                </div>
                {customerId ? (
                  <Link
                    href="/sales/customers"
                    className="text-[11px] font-extrabold uppercase tracking-wider text-order-fg hover:underline inline-flex items-center gap-1"
                  >
                    Open master <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                  </Link>
                ) : null}
              </div>
              <div className="mt-2 text-sm font-extrabold text-content-1 truncate">
                {customerQuery.data?.name || quote.customer_name}
              </div>
              <div className="text-[11px] font-bold text-content-3 font-mono">
                {customerQuery.data?.code || "—"}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-content-3">
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-content-4">
                    Credit limit
                  </div>
                  <div className="font-mono text-content-1">
                    ₹ {inrFmt(customerQuery.data?.credit_limit)}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-content-4">
                    Credit days
                  </div>
                  <div className="font-mono text-content-1">
                    {customerQuery.data?.credit_days ?? "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-content-4">
                    Outstanding
                  </div>
                  <div className="font-mono text-content-3 italic">
                    — <span className="text-[9px]">AR not yet wired</span>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-content-4">
                    Last order
                  </div>
                  <div className="font-mono text-content-1">
                    {lastOrderQuery.data && lastOrderQuery.data.length > 0
                      ? formatDisplayDate(lastOrderQuery.data[0].created_at)
                      : "—"}
                  </div>
                </div>
              </div>
              {creditWarning ? (
                <div
                  className={cn(
                    "mt-3 rounded-lg px-3 py-2 text-[11px] font-extrabold flex items-start gap-2",
                    creditWarning.level === "RED"
                      ? "bg-danger-bg text-danger-fg ring-1 ring-danger-border"
                      : "bg-warning-bg text-warning-fg ring-1 ring-warning-border",
                  )}
                >
                  <ShieldAlert
                    className="h-3.5 w-3.5 mt-0.5 shrink-0"
                    strokeWidth={2.5}
                  />
                  {creditWarning.msg}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* Lifecycle timeline */}
          {quote ? (
            <section className="rounded-2xl bg-surface-1 ring-1 ring-line p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-brand-blue" />
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Lifecycle
                </div>
              </div>
              <ul className="space-y-2">
                <TimelineRow
                  label="Created"
                  at={quote.created_at}
                  actor="System"
                  dot="bg-line"
                />
                {quote.sent_at ? (
                  <TimelineRow
                    label="Sent"
                    at={quote.sent_at}
                    actor={quote.sent_by_name || "—"}
                    dot="bg-brand-blue"
                  />
                ) : null}
                {quote.approved_at ? (
                  <TimelineRow
                    label="Approved"
                    at={quote.approved_at}
                    actor={quote.approved_by_name || "—"}
                    dot="bg-success-fg"
                  />
                ) : null}
                {(quote.status_history || []).map((entry, idx) => (
                  <TimelineRow
                    key={idx}
                    label={STATUS_LABEL[entry.status] || entry.status}
                    at={entry.at}
                    actor={entry.by_name || "—"}
                    note={entry.note}
                    dot={STATUS_DOT[entry.status] || "bg-line"}
                  />
                ))}
                {quote.converted_sales_order_number ? (
                  <TimelineRow
                    label={`Converted → ${quote.converted_sales_order_number}`}
                    at={quote.updated_at}
                    actor="—"
                    dot="bg-brand-navy"
                  />
                ) : null}
              </ul>
            </section>
          ) : null}

        </aside>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-line bg-surface-1/95 backdrop-blur shadow-[0_-12px_28px_-12px_rgba(15,23,42,0.16)]">
        <div className="mx-auto max-w-[1480px] px-5 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-content-3">
            {saveMut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-order-fg" />
                Saving…
              </>
            ) : dirty ? (
              <>
                <span className="h-2 w-2 rounded-full bg-warning-fg animate-pulse" />
                Unsaved changes
              </>
            ) : lastSavedAt ? (
              <>
                <span className="h-2 w-2 rounded-full bg-success-fg" />
                Saved {savedAgo(lastSavedAt, savedTick)}
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-line" />
                Idle
              </>
            )}
            <span className="hidden md:inline text-content-4 ml-2">
              ⌘S to save
            </span>
          </div>
          <div className="font-mono text-[12px] font-bold text-content-3">
            {counts.total} lines · {counts.adhoc} ad-hoc · {counts.catalog}{" "}
            catalog · ₹ {inrFmt(grand)} total
          </div>
          <div className="ml-auto flex items-center gap-2">
            {quote && ["APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"].includes(quote.status) ? (
              <a
                href={quotationService.pdfUrl(quote.id, { customerView: true })}
                target="_blank"
                rel="noopener"
                className="h-10 px-3 inline-flex items-center gap-2 rounded-xl text-content-3 hover:bg-surface-2 font-bold text-sm"
              >
                <Eye className="h-4 w-4" strokeWidth={2.2} />
                Customer view
              </a>
            ) : null}
            {canPersist && quote?.status === "DRAFT" ? (
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-order-fg text-white font-extrabold text-sm hover:bg-order-fg disabled:opacity-60"
              >
                {saveMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save draft
              </button>
            ) : null}
            {quote?.status === "APPROVED" ? (
              <button
                onClick={() => setSendDialog("open")}
                disabled={!contactEmail.trim() || sendMut.isPending}
                title={contactEmail.trim() ? "Send frozen PDF to customer" : "Client email is required"}
                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-extrabold text-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Send className="h-4 w-4" />
                Send
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Send dialog */}
      {sendDialog === "open" && quote ? (
        <Dialog onClose={() => setSendDialog(null)}>
          <div className="flex items-center gap-2 mb-3">
            <Send className="h-5 w-5 text-brand-blue" />
            <h3 className="text-base font-extrabold text-content-1">
              Send to customer
            </h3>
          </div>
          <p className="text-[12px] font-semibold text-content-3 mb-4">
            Release the approved frozen PDF to <strong>{contactEmail || "missing client email"}</strong>. The provider ID, recipient, artifact checksum and time are stored as delivery evidence.
          </p>
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-info-bg p-3 text-xs font-bold text-info-fg ring-1 ring-info-border"><Mail className="h-4 w-4" /> Evidenced email delivery</div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setSendDialog(null)}
              className="h-10 px-4 rounded-xl text-content-3 hover:bg-surface-2 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={() => sendMut.mutate({ id: quote.id, via: "email" })}
              disabled={sendMut.isPending || !contactEmail.trim()}
              className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-extrabold hover:opacity-90 disabled:opacity-60"
            >
              {sendMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* Reject dialog */}
      {rejectDialog === "open" && quote ? (
        <Dialog onClose={() => setRejectDialog(null)}>
          <div className="flex items-center gap-2 mb-3">
            <XCircle className="h-5 w-5 text-danger-fg" />
            <h3 className="text-base font-extrabold text-content-1">
              Reject quotation
            </h3>
          </div>
          <p className="text-[12px] font-semibold text-content-3 mb-3">
            Capture a short reason so future follow-up quotes retain the context.
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="E.g. Customer asked for revised pricing on the 25-micron layer."
            rows={4}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold outline-none focus:border-danger-border focus:ring-2 focus:ring-danger-border mb-4"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRejectDialog(null)}
              className="h-10 px-4 rounded-xl text-content-3 hover:bg-surface-2 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                rejectMut.mutate({ id: quote.id, reason: rejectReason })
              }
              disabled={rejectMut.isPending}
              className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-danger-solid text-white font-extrabold hover:bg-danger-solid disabled:opacity-60"
            >
              {rejectMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Reject
            </button>
          </div>
        </Dialog>
      ) : null}

      {/* Convert-to-SO dialog */}
      {convertDialog === "open" && quote ? (
        <Dialog onClose={() => setConvertDialog(null)}>
          <div className="flex items-center gap-2 mb-3">
            <Truck className="h-5 w-5 text-brand-navy" />
            <h3 className="text-base font-extrabold text-content-1">
              Convert to Sales Order
            </h3>
          </div>
          <p className="text-[13px] font-semibold text-content-3 mb-4">
            Convert{" "}
            <span className="font-mono font-extrabold text-content-1">
              {quote.quote_number}
            </span>{" "}
            to a Sales Order? This locks the quotation as{" "}
            <span className="font-extrabold">CONVERTED</span> and creates a new
            SO ready for production planning.
          </p>
          <div className="rounded-lg bg-surface-2 ring-1 ring-line p-3 mb-4 text-[12px] text-content-2">
            <div className="font-extrabold text-content-1">
              {counts.total} lines · ₹ {inrFmt(grand)}
            </div>
            <div className="text-[11px] text-content-3 mt-0.5">
              {quote.customer_name}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setConvertDialog(null)}
              className="h-10 px-4 rounded-xl text-content-3 hover:bg-surface-2 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setConvertDialog(null);
                convertMut.mutate(quote.id);
              }}
              disabled={convertMut.isPending}
              className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-navy text-white font-extrabold hover:bg-brand-navy-600 disabled:opacity-60"
            >
              {convertMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Convert
            </button>
          </div>
        </Dialog>
      ) : null}

      {clientOutcome && quote ? (
        <Dialog onClose={() => setClientOutcome(null)}>
          <h3 className="text-base font-extrabold text-content-1">Record client {clientOutcome.toLowerCase()}</h3>
          <p className="mt-1 text-xs font-semibold text-content-3">Record the evidence received against this exact sent revision.</p>
          {clientOutcome === "ACCEPTED" ? (
            <input autoFocus value={clientReference} onChange={(event) => setClientReference(event.target.value)} placeholder="PO / email / acceptance reference" className="mt-4 h-11 w-full rounded-lg border border-line px-3 text-sm font-semibold" />
          ) : (
            <textarea autoFocus rows={4} value={clientOutcomeReason} onChange={(event) => setClientOutcomeReason(event.target.value)} placeholder="Customer rejection reason" className="mt-4 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold" />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setClientOutcome(null)} className="h-10 px-4 rounded-xl font-bold text-content-3">Cancel</button>
            <button
              onClick={() => outcomeMut.mutate({ id: quote.id, outcome: clientOutcome })}
              disabled={outcomeMut.isPending || (clientOutcome === "ACCEPTED" ? !clientReference.trim() : !clientOutcomeReason.trim())}
              className="h-10 px-4 rounded-xl bg-success-fg font-extrabold text-white disabled:opacity-50"
            >Record outcome</button>
          </div>
        </Dialog>
      ) : null}

      {terminalAction && quote ? (
        <Dialog onClose={() => setTerminalAction(null)}>
          <h3 className="text-base font-extrabold text-content-1">{terminalAction === "CANCEL" ? "Cancel" : "Void"} quotation</h3>
          <p className="mt-1 text-xs font-semibold text-content-3">The record remains immutable and searchable. A reason is required.</p>
          <textarea autoFocus rows={4} value={terminalReason} onChange={(event) => setTerminalReason(event.target.value)} placeholder="Reason" className="mt-4 w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold" />
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setTerminalAction(null)} className="h-10 px-4 rounded-xl font-bold text-content-3">Back</button>
            <button
              onClick={() => terminalMut.mutate({ id: quote.id, action: terminalAction })}
              disabled={terminalMut.isPending || !terminalReason.trim()}
              className="h-10 px-4 rounded-xl bg-danger-solid font-extrabold text-white disabled:opacity-50"
            >Confirm {terminalAction.toLowerCase()}</button>
          </div>
        </Dialog>
      ) : null}

    </main>
  );
}

function QuoteField({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  multiline = false,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  type?: string;
  multiline?: boolean;
  required?: boolean;
}) {
  const controlClass = "mt-1 w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm font-semibold text-content-1 outline-none focus:border-order-border focus:ring-2 focus:ring-order-border disabled:bg-surface-2 disabled:text-content-3";
  return (
    <label className={multiline ? "md:col-span-3" : ""}>
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-content-3">
        {label}{required ? " *" : ""}
      </span>
      {multiline ? (
        <textarea rows={2} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={controlClass} />
      ) : (
        <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={controlClass} />
      )}
    </label>
  );
}

function Row({
  label,
  value,
  color,
  bold,
  huge,
}: {
  label: string;
  value: string;
  color?: string;
  bold?: boolean;
  huge?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={cn(
          "text-[11px] font-bold uppercase tracking-wider",
          bold ? "text-content-2" : "text-content-3",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "font-mono",
          huge
            ? "text-lg font-extrabold text-content-1"
            : bold
              ? "text-sm font-extrabold text-content-1"
              : "text-sm font-bold text-content-2",
          color,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-wider text-content-4">{label}</div>
      <div className="mt-1 font-mono text-content-1">{value}</div>
    </div>
  );
}

function TimelineRow({
  label,
  at,
  actor,
  note,
  dot,
}: {
  label: string;
  at: string;
  actor?: string;
  note?: string;
  dot: string;
}) {
  let display = at;
  try {
    display = formatDisplayDateTime(at);
  } catch {
    /* ignore */
  }
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", dot)} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-extrabold text-content-2">{label}</div>
        <div className="text-[10px] font-mono text-content-3">{display}</div>
        {actor ? (
          <div className="text-[10px] font-bold text-content-3">{actor}</div>
        ) : null}
        {note ? (
          <div className="text-[10px] italic text-content-3 mt-0.5">{note}</div>
        ) : null}
      </div>
    </li>
  );
}

function Dialog({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-surface-3" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-2xl bg-surface-1 p-5 shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Status-driven banner shown below the hero.
// ────────────────────────────────────────────────────────────────────────────

interface StatusBannerProps {
  quote: QuotationListItem;
  drafts: DraftItem[];
  onConvert: () => void;
  onClone: () => void;
  onSend: () => void;
}

function StatusBanner({
  quote,
  drafts,
  onConvert,
  onClone,
  onSend,
}: StatusBannerProps) {
  const fmt = (iso?: string | null) => {
    if (!iso) return "—";
    try {
      return formatDisplayDate(iso);
    } catch {
      return iso;
    }
  };
  let body: {
    tone: "amber" | "sky" | "emerald" | "rose" | "violet";
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    action?: React.ReactNode;
  } = {
    tone: "sky",
    icon: <Info className="h-4 w-4" />,
    title: "Quotation ready",
  };
  if (quote.status === "DRAFT" && drafts.length === 0) {
    body = {
      tone: "amber",
      icon: <AlertTriangle className="h-4 w-4" />,
      title: "Empty quotation",
      subtitle: "Add at least one line to proceed.",
    };
  } else if (quote.status === "DRAFT" && drafts.length > 0) {
    body = {
      tone: "sky",
      icon: <Info className="h-4 w-4" />,
      title: "Draft ready",
      subtitle: "Complete Cost Build and submit this revision for approval.",
    };
  } else if (quote.status === "SENT") {
    body = {
      tone: "sky",
      icon: <Send className="h-4 w-4" />,
      title: `Sent on ${fmt(quote.sent_at)}`,
      subtitle: "Waiting for customer response.",
    };
  } else if (quote.status === "APPROVED") {
    body = {
      tone: "emerald",
      icon: <CheckCircle2 className="h-4 w-4" />,
      title: `Internal approval completed on ${fmt(quote.approved_at)}`,
      subtitle: "Release the frozen client PDF by evidenced email.",
      action: (
        <button
          onClick={onSend}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-success-fg text-white text-[12px] font-extrabold hover:bg-success-fg"
        >
          Send <Send className="h-3.5 w-3.5" />
        </button>
      ),
    };
  } else if (quote.status === "ACCEPTED") {
    body = {
      tone: "emerald",
      icon: <CheckCircle2 className="h-4 w-4" />,
      title: `Client acceptance recorded on ${fmt(quote.accepted_at)}`,
      subtitle: `Reference: ${quote.acceptance_reference || "—"}. Ready for controlled conversion.`,
      action: (
        <button onClick={onConvert} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-success-fg text-white text-[12px] font-extrabold">
          Convert <ArrowRight className="h-3.5 w-3.5" />
        </button>
      ),
    };
  } else if (quote.status === "REJECTED") {
    body = {
      tone: "rose",
      icon: <XCircle className="h-4 w-4" />,
      title: "Rejected",
      subtitle: quote.rejection_reason
        ? `Reason: ${quote.rejection_reason}. Clone to revise.`
        : "Clone to revise.",
      action: (
        <button
          onClick={onClone}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-danger-solid text-white text-[12px] font-extrabold hover:bg-danger-solid"
        >
          <Copy className="h-3.5 w-3.5" /> Clone
        </button>
      ),
    };
  } else if (quote.status === "EXPIRED") {
    body = {
      tone: "amber",
      icon: <Clock className="h-4 w-4" />,
      title: `Validity ended on ${fmt(quote.valid_until)}`,
      subtitle: "Clone or extend validity.",
      action: (
        <button
          onClick={onClone}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-warning-fg text-white text-[12px] font-extrabold hover:bg-warning-fg"
        >
          <Copy className="h-3.5 w-3.5" /> Clone
        </button>
      ),
    };
  } else if (quote.status === "CONVERTED") {
    body = {
      tone: "violet",
      icon: <Truck className="h-4 w-4" />,
      title: `Converted to ${quote.converted_sales_order_number || "SO"}`,
      subtitle: `On ${fmt(quote.updated_at)}.`,
      action: quote.converted_sales_order ? (
        <Link
          href={`/sales/orders/${quote.converted_sales_order}`}
          className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-order-fg text-white text-[12px] font-extrabold hover:bg-order-fg"
        >
          Open SO <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ) : undefined,
    };
  }
  const toneClasses: Record<typeof body.tone, string> = {
    amber: "bg-warning-bg text-warning-fg ring-warning-border",
    sky: "bg-info-bg text-info-fg ring-info-border",
    emerald: "bg-success-bg text-success-fg ring-success-border",
    rose: "bg-danger-bg text-danger-fg ring-danger-border",
    violet: "bg-order-bg text-order-fg ring-order-border",
  };
  const dotClasses: Record<typeof body.tone, string> = {
    amber: "bg-warning-fg",
    sky: "bg-info-fg",
    emerald: "bg-success-fg",
    rose: "bg-danger-solid",
    violet: "bg-order-fg",
  };
  return (
    <section
      className={cn(
        "rounded-2xl ring-1 p-4 flex items-start gap-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]",
        toneClasses[body.tone],
      )}
    >
      <span
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded-full text-white shrink-0",
          dotClasses[body.tone],
        )}
      >
        {body.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-extrabold">{body.title}</div>
        {body.subtitle ? (
          <div className="text-[12px] font-semibold opacity-90 mt-0.5">
            {body.subtitle}
          </div>
        ) : null}
      </div>
      {body.action ? <div>{body.action}</div> : null}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// "Saved Xs ago" helper.
// ────────────────────────────────────────────────────────────────────────────

function savedAgo(ts: number, _tick: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// ────────────────────────────────────────────────────────────────────────────
// New-quote onboarding card.
// ────────────────────────────────────────────────────────────────────────────

interface NewQuotationOnboardingProps {
  onPick: (customer: CustomerSummary, repeatFromId?: string) => void;
  creating: boolean;
}

function NewQuotationOnboarding({
  onPick,
  creating,
}: NewQuotationOnboardingProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerSummary | null>(null);
  const customersQuery = useQuery({
    queryKey: ["sales", "customers", "list"],
    queryFn: () => quotationService.listCustomers({ page_size: 200 }),
  });
  const customers = customersQuery.data || [];
  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return customers.slice(0, 20);
    return customers
      .filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(t))
      .slice(0, 20);
  }, [customers, search]);

  // Recent customers — last 5 the user has interacted with via quotes.
  const recentQuotesQuery = useQuery({
    queryKey: ["quotations", "list", "recent"],
    queryFn: () => quotationService.list({ page_size: 25 }),
  });
  const recents = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const q of recentQuotesQuery.data || []) {
      const cid = q.customer || `name:${q.customer_name}`;
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      out.push({ id: cid, name: q.customer_name });
      if (out.length >= 5) break;
    }
    return out;
  }, [recentQuotesQuery.data]);

  // Customer's last quote — for "repeat last quote" hint.
  const lastQuoteQuery = useQuery({
    queryKey: ["quotations", "list", "for-customer", selected?.id],
    queryFn: () =>
      quotationService.listCustomerQuotes(selected!.id, { limit: 1 }),
    enabled: Boolean(selected?.id),
  });
  const lastQuote =
    lastQuoteQuery.data && lastQuoteQuery.data.length > 0
      ? lastQuoteQuery.data[0]
      : null;

  return (
    <main className="mx-auto max-w-[920px] px-5 py-10 lg:px-8 lg:py-12">
      <div className="rounded-[28px] bg-gradient-to-br from-order-fg via-order-fg to-order-fg p-1 shadow-[0_40px_80px_-40px_rgba(79,70,229,0.6)]">
        <div className="rounded-[26px] bg-surface-1 px-6 py-8 lg:px-10 lg:py-12">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-order-fg inline-flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" />
                New quotation
              </div>
              <h1 className="mt-2 text-2xl lg:text-3xl font-extrabold tracking-tight text-content-1">
                Start a new quotation
              </h1>
              <p className="mt-1 text-sm font-semibold text-content-3">
                Pick a customer to begin. Their pricing rules and credit profile
                load automatically.
              </p>
            </div>
            <Link
              href="/sales/quotations"
              className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg text-content-3 hover:bg-surface-2 font-bold text-sm"
            >
              <ArrowLeft className="h-4 w-4" /> Quotations
            </Link>
          </div>

          {/* Customer combobox */}
          <div className="mt-6">
            <label className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
              Customer
            </label>
            <div className="mt-1 flex items-center gap-2 h-12 rounded-xl border-2 border-order-border focus-within:border-order-border px-3 bg-surface-1">
              <Search className="h-4 w-4 text-content-4" />
              <input
                autoFocus
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                placeholder="Search customer by name or code…"
                className="flex-1 bg-transparent outline-none text-sm font-semibold text-content-1"
              />
              {customersQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-order-fg" />
              ) : null}
            </div>

            {customersQuery.isError ? (
              <div className="mt-3 rounded-lg bg-danger-bg ring-1 ring-danger-border p-3 text-[12px] font-bold text-danger-fg flex items-center justify-between">
                Couldn&apos;t load customers.
                <button
                  onClick={() => customersQuery.refetch()}
                  className="text-danger-fg underline font-extrabold"
                >
                  Retry
                </button>
              </div>
            ) : !customersQuery.isLoading && customers.length === 0 ? (
              <div className="mt-3 rounded-lg bg-warning-bg ring-1 ring-warning-border p-4 text-[12px] font-bold text-warning-fg">
                No customers in the system yet.
                <Link href="/sales/customers" className="ml-2 underline">
                  Open Customer Master
                </Link>{" "}
                first to start quoting.
              </div>
            ) : (
              <div className="mt-2 max-h-72 overflow-y-auto rounded-xl ring-1 ring-line bg-surface-2">
                {filtered.length === 0 ? (
                  <div className="p-4 text-[12px] font-bold text-content-4">
                    No matches.
                  </div>
                ) : (
                  filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setSelected(c);
                        setSearch(c.name);
                      }}
                      className={cn(
                        "w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-order-bg border-b border-line last:border-b-0",
                        selected?.id === c.id && "bg-order-bg",
                      )}
                    >
                      <Users className="h-4 w-4 text-order-fg shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-extrabold text-content-1 truncate">
                          {c.name}
                        </div>
                        <div className="text-[11px] font-mono text-content-3">
                          {c.code}
                        </div>
                      </div>
                      {selected?.id === c.id ? (
                        <CheckCircle2 className="h-4 w-4 text-order-fg shrink-0" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            )}

            {/* Recent customers chips */}
            {recents.length > 0 && !selected ? (
              <div className="mt-4">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                  Or pick from recent customers
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {recents.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        const match = customers.find(
                          (c) => c.id === r.id || c.name === r.name,
                        );
                        if (match) {
                          setSelected(match);
                          setSearch(match.name);
                        }
                      }}
                      className="h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-order-bg text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Last quote callout */}
            {selected && lastQuote ? (
              <div className="mt-4 rounded-xl bg-success-bg ring-1 ring-success-border p-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[12px] text-success-fg font-bold">
                  Repeat last quote:{" "}
                  <span className="font-mono font-extrabold">
                    {lastQuote.quote_number}
                  </span>
                  {lastQuote.items ? ` · ${lastQuote.items.length} lines` : ""}
                </div>
                <button
                  onClick={() => onPick(selected, lastQuote.id)}
                  disabled={creating}
                  className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full bg-success-fg text-white text-[11px] font-extrabold uppercase tracking-wider hover:bg-success-fg disabled:opacity-60"
                >
                  <Copy className="h-3 w-3" /> Clone
                </button>
              </div>
            ) : null}
          </div>

          {/* Primary action */}
          <div className="mt-8 flex items-center justify-end gap-2">
            <Link
              href="/sales/quotations"
              className="h-11 px-4 rounded-xl text-content-3 hover:bg-surface-2 font-bold text-sm"
            >
              Cancel
            </Link>
            <button
              onClick={() => selected && onPick(selected)}
              disabled={!selected || creating}
              className="h-11 px-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-order-fg via-order-fg to-order-fg text-white font-extrabold text-sm shadow-md hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Start quotation
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
