"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Plus,
  X,
  Lock,
  Eraser,
  EyeOff,
  Eye,
  History,
  ShieldCheck,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  pouchStyleService,
  computeChildTargetWidthMm,
  defaultLinearTermsForFields,
  makeFieldTerm,
  termToString,
  type PouchStyle,
  type PouchFormulaKind,
  type PouchFormulaTerm,
  type PouchFormulaFactor,
  type PouchAstNode,
  type PouchFieldDef,
} from "@/services/pouch-style";

const AXIS_OPTS: Array<{
  value: "WIDTH" | "HEIGHT" | "BOTH" | "NONE";
  label: string;
}> = [
  { value: "WIDTH", label: "Width axis" },
  { value: "HEIGHT", label: "Height axis" },
  { value: "BOTH", label: "Both axes" },
  { value: "NONE", label: "None (informational)" },
];

const STOCK_FORM_OPTIONS = [
  {
    value: "OPEN_WEB",
    label: "Open web / sheet",
    basis: "OPEN_WEB_WIDTH",
    factor: 1,
    slit: "SLIT_ALLOWED",
  },
  {
    value: "LAYFLAT_TUBE",
    label: "Lay-flat tube",
    basis: "LAYFLAT_WIDTH",
    factor: 2,
    slit: "EXACT_ONLY",
  },
  {
    value: "FOLDED_WEB",
    label: "Folded web",
    basis: "FOLDED_WIDTH",
    factor: 1,
    slit: "EXACT_ONLY",
  },
] as const;

const WIDTH_BASIS_LABEL: Record<string, string> = {
  OPEN_WEB_WIDTH: "open-web width",
  LAYFLAT_WIDTH: "lay-flat tube width",
  FOLDED_WIDTH: "folded width",
};

const SLIT_POLICY_LABEL: Record<string, string> = {
  SLIT_ALLOWED: "Slitting allowed",
  EXACT_ONLY: "Exact width only",
};

const FIELD_PRESETS = [
  {
    key: "gusset",
    label: "Gusset",
    suggested_axis: "WIDTH",
    suggested_coeff: 2,
    suggested_default: 0,
  },
  {
    key: "flap",
    label: "Flap reach",
    suggested_axis: "WIDTH",
    suggested_coeff: 1,
    suggested_default: 0,
  },
  {
    key: "overlap",
    label: "Seal overlap",
    suggested_axis: "HEIGHT",
    suggested_coeff: 1,
    suggested_default: 10,
  },
  {
    key: "bottom_factor",
    label: "Bottom factor",
    suggested_axis: "WIDTH",
    suggested_coeff: 0,
    suggested_default: 1,
  },
  {
    key: "stick_factor",
    label: "Stick factor",
    suggested_axis: "WIDTH",
    suggested_coeff: 0,
    suggested_default: 1.05,
  },
  {
    key: "override_width",
    label: "Direct roll width",
    suggested_axis: "NONE",
    suggested_coeff: 0,
    suggested_default: 0,
  },
] as const;

const FIELD_TONE: Record<string, string> = {
  W: "bg-info-bg text-info-fg ring-info-border",
  H: "bg-warning-bg text-warning-fg ring-warning-border",
  gusset: "bg-success-bg text-success-fg ring-success-border",
  flap: "bg-order-bg text-order-fg ring-order-border",
  overlap: "bg-order-bg text-order-fg ring-order-border",
  bottom_factor: "bg-danger-bg text-danger-fg ring-danger-border",
  stick_factor: "bg-order-bg text-order-fg ring-order-border",
  override_width: "bg-line text-content-1 ring-line-strong",
};
const DEFAULT_TONE = "bg-success-bg text-success-fg ring-success-border";
function toneFor(field: string) {
  return FIELD_TONE[field] || DEFAULT_TONE;
}

interface PouchStyleEditorProps {
  id?: string;
  initialMode?: "new" | "edit";
}

export function PouchStyleEditor({ id, initialMode }: PouchStyleEditorProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const isNew = initialMode === "new" || !id;

  const { data: existing, isLoading } = useQuery({
    queryKey: ["pouch-style", id],
    queryFn: () => pouchStyleService.get(id!),
    enabled: !isNew && !!id,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ["pouch-style-versions", existing?.code],
    queryFn: () => pouchStyleService.versions(existing!.code),
    enabled: !!existing?.code,
  });

  const [draft, setDraft] = React.useState<Partial<PouchStyle>>(() =>
    emptyDraft(),
  );
  const [previewInputs, setPreviewInputs] = React.useState<
    Record<string, number>
  >({ W: 127, H: 203 });
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  React.useEffect(() => {
    if (existing) {
      setDraft(existing);
      const next: Record<string, number> = { W: 127, H: 203 };
      for (const [k, def] of Object.entries(existing.allowed_fields || {})) {
        if (def && typeof def.default === "number") next[k] = def.default;
      }
      setPreviewInputs((prev) => ({ ...next, ...prev }));
    }
  }, [existing]);

  const allowedFields: Record<string, PouchFieldDef> =
    (draft.allowed_fields as any) || {};
  const formulaParams = (draft.formula_params as Record<string, any>) || {};
  const fieldAdjustments =
    (draft.field_adjustments as Record<string, any>) || {};
  const terms: PouchFormulaTerm[] = Array.isArray(formulaParams.terms)
    ? formulaParams.terms
    : [];
  const trim = Number(formulaParams.trim_mm ?? 0);
  const isLocked = !!draft.locked;
  const stockForm = String(
    draft.default_stock_form || "OPEN_WEB",
  ).toUpperCase();
  const widthBasis = String(
    draft.default_width_basis || defaultWidthBasis(stockForm),
  ).toUpperCase();
  const slitPolicy = String(
    draft.default_slit_policy || defaultSlitPolicy(stockForm),
  ).toUpperCase();
  const filmAreaFactor = resolveFilmAreaFactor(draft, stockForm);
  const rollAxis = normalizeAreaRollAxis(draft.default_roll_axis);

  const set = <K extends keyof PouchStyle>(
    key: K,
    v: PouchStyle[K] | undefined,
  ) => setDraft((d) => ({ ...d, [key]: v as any }));

  const setParams = (next: Record<string, any>) =>
    set("formula_params", next as any);
  const setFieldAdjustments = (patch: Record<string, any>) =>
    set(
      "field_adjustments",
      cleanFieldAdjustments({ ...fieldAdjustments, ...patch }) as any,
    );
  const setTerms = (next: PouchFormulaTerm[]) =>
    setParams({ ...formulaParams, terms: next });
  const setTrim = (v: number) => {
    setParams({ ...formulaParams, trim_mm: v });
    setFieldAdjustments({ trim_default_mm: v });
  };

  const liveTarget = React.useMemo(() => {
    try {
      return computeChildTargetWidthMm(
        {
          formula_kind: (draft.formula_kind || "LINEAR") as PouchFormulaKind,
          formula_params: formulaParams,
          formula_ast: (draft.formula_ast || {}) as PouchAstNode,
          field_adjustments: (draft.field_adjustments || {}) as any,
        },
        previewInputs,
      );
    } catch {
      return 0;
    }
  }, [
    draft.formula_kind,
    formulaParams,
    draft.formula_ast,
    draft.field_adjustments,
    previewInputs,
  ]);

  const buildPayload = React.useCallback(() => {
    return {
      code: draft.code || "",
      name: draft.name || "",
      description: draft.description || "",
      visual_emoji: draft.visual_emoji || "🛍️",
      visual_svg: draft.visual_svg || "",
      default_roll_axis: rollAxis as any,
      default_stock_form: stockForm as any,
      default_width_basis: widthBasis as any,
      default_slit_policy: slitPolicy as any,
      stock_form_options: normalizeStockFormOptions(draft.stock_form_options),
      allowed_fields: allowedFields,
      field_adjustments: cleanFieldAdjustments(draft.field_adjustments || {}),
      formula_kind: (draft.formula_kind || "LINEAR") as PouchFormulaKind,
      formula_params: formulaParams,
      formula_ast: (draft.formula_ast as any) || {},
      formula_expression: prettyExpression(
        draft.formula_kind as PouchFormulaKind,
        terms,
        trim,
      ),
      deprecated: !!draft.deprecated,
      sort_order: Number(draft.sort_order || 100),
      notes: draft.notes || "",
    };
  }, [
    allowedFields,
    draft,
    formulaParams,
    rollAxis,
    stockForm,
    widthBasis,
    slitPolicy,
    terms,
    trim,
  ]);

  const hasMeaningfulChanges = React.useMemo(() => {
    if (isNew || !existing) return true;
    return (
      stableStringify(buildPayload()) !==
      stableStringify(styleToPayload(existing))
    );
  }, [buildPayload, existing, isNew]);

  const returnToLanding = React.useCallback(() => {
    router.push("/master/pouch-styles");
  }, [router]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = buildPayload();
      if (isNew) return pouchStyleService.create(body);
      return pouchStyleService.update(id!, body);
    },
    onSuccess: (saved) => {
      const versionMsg =
        saved.version &&
        existing &&
        existing.version &&
        saved.version > existing.version
          ? ` · new v${saved.version} created (v${existing.version} preserved)`
          : ` · v${saved.version}`;
      toast({
        title: isNew ? "Pouch style created" : "Saved",
        description: `${saved.code}${versionMsg}`,
      });
      setDraft(saved);
      qc.setQueryData(["pouch-style", saved.id], saved);
      qc.invalidateQueries({ queryKey: ["pouch-styles"] });
      qc.invalidateQueries({ queryKey: ["pouch-style-versions", saved.code] });
      returnToLanding();
    },
    onError: (e: any) =>
      toast({
        title: "Save failed",
        description: String(
          e?.response?.data?.detail ||
            e?.response?.data?.code ||
            e?.message ||
            e,
        ),
        variant: "destructive",
      }),
  });

  const approveMutation = useMutation({
    mutationFn: async () => pouchStyleService.approve(id!),
    onSuccess: (saved) => {
      toast({
        title: "Approved + locked",
        description: `${saved.code} v${saved.version} can now be used on Product Master sizes.`,
      });
      qc.invalidateQueries({ queryKey: ["pouch-styles"] });
      qc.invalidateQueries({ queryKey: ["pouch-style", id] });
      qc.invalidateQueries({ queryKey: ["pouch-style-versions", saved.code] });
      setDraft(saved);
      returnToLanding();
    },
    onError: (e: any) =>
      toast({
        title: "Approve failed",
        description: String(e?.response?.data?.detail || e?.message || e),
        variant: "destructive",
      }),
  });

  const saveAndApproveMutation = useMutation({
    mutationFn: async () => {
      const body = buildPayload();
      const savedDraft = isNew
        ? await pouchStyleService.create(body)
        : await pouchStyleService.update(id!, body);
      return pouchStyleService.approve(savedDraft.id);
    },
    onSuccess: (saved) => {
      toast({
        title: "Approved + locked",
        description: `${saved.code} v${saved.version} is ready for Product Master sizes.`,
      });
      qc.setQueryData(["pouch-style", saved.id], saved);
      qc.invalidateQueries({ queryKey: ["pouch-styles"] });
      qc.invalidateQueries({ queryKey: ["pouch-style-versions", saved.code] });
      setDraft(saved);
      returnToLanding();
    },
    onError: (e: any) =>
      toast({
        title: "Approve failed",
        description: String(
          e?.response?.data?.detail ||
            e?.response?.data?.code ||
            e?.message ||
            e,
        ),
        variant: "destructive",
      }),
  });

  const disableMutation = useMutation({
    mutationFn: async () => pouchStyleService.disable(id!),
    onSuccess: (saved) => {
      toast({
        title: "Disabled",
        description: `${saved.code} hidden from pickers. Historical FKs preserved.`,
      });
      qc.invalidateQueries({ queryKey: ["pouch-styles"] });
      qc.invalidateQueries({ queryKey: ["pouch-style", id] });
    },
    onError: (e: any) =>
      toast({
        title: "Disable failed",
        description: String(e?.message || e),
        variant: "destructive",
      }),
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => pouchStyleService.reactivate(id!),
    onSuccess: (saved) => {
      toast({
        title: "Reactivated",
        description: `${saved.code} is visible again.`,
      });
      qc.invalidateQueries({ queryKey: ["pouch-styles"] });
      qc.invalidateQueries({ queryKey: ["pouch-style", id] });
    },
    onError: (e: any) =>
      toast({
        title: "Reactivate failed",
        description: String(e?.message || e),
        variant: "destructive",
      }),
  });

  // — Field actions —
  function addField(key: string, def: PouchFieldDef, alsoAddTerm = true) {
    const next = { ...allowedFields, [key]: def };
    set("allowed_fields", next as any);
    if (alsoAddTerm && !terms.find((t) => t.field === key)) {
      const coeff =
        typeof def.default_coefficient === "number"
          ? def.default_coefficient
          : 1;
      setTerms([...terms, { field: key, coefficient: coeff }]);
    }
  }
  function removeField(key: string) {
    const next = { ...allowedFields };
    delete next[key];
    set("allowed_fields", next as any);
    setTerms(terms.filter((t) => t.field !== key));
  }
  function patchField(key: string, patch: Partial<PouchFieldDef>) {
    const next = {
      ...allowedFields,
      [key]: { ...(allowedFields[key] || {}), ...patch },
    };
    set("allowed_fields", next as any);
  }

  // — Term actions (product-chain model) —
  function setTerm(idx: number, next: PouchFormulaTerm) {
    setTerms(terms.map((t, i) => (i === idx ? next : t)));
  }
  function removeTerm(idx: number) {
    setTerms(terms.filter((_, i) => i !== idx));
  }
  function addTerm(field: string) {
    const def = allowedFields[field];
    const coeff =
      def && typeof def.default_coefficient === "number"
        ? def.default_coefficient
        : 1;
    // Default = {coeff} × field — e.g. 2 × W
    const t: PouchFormulaTerm = {
      factors: [
        { kind: "NUMBER", value: coeff || 1 },
        { kind: "FIELD", field },
      ],
    };
    setTerms([...terms, t]);
  }
  function addEmptyTerm() {
    setTerms([...terms, { factors: [{ kind: "NUMBER", value: 1 }] }]);
  }

  if (!isNew && isLoading) {
    return (
      <div className="p-10 text-center text-sm text-content-3">
        Loading pouch style…
      </div>
    );
  }

  const hasW = !!allowedFields.W;
  const hasH = !!allowedFields.H;
  const extraFieldsAvailable = FIELD_PRESETS.filter(
    (p) => !allowedFields[p.key],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
      <GradientHero
        palette="indigo"
        eyebrow={isNew ? "MASTER · POUCH STYLE · NEW" : "MASTER · POUCH STYLE"}
        title={
          isNew
            ? "Build a pouch shape"
            : `${draft.visual_emoji || "🛍️"} ${draft.name || draft.code || "Pouch style"}`
        }
        subtitle="Pick the input fields, build the child stock-width formula, then define how that stock width becomes film area for BOM, costing, and roll allocation."
        chips={
          [
            !isNew && isLocked
              ? {
                  icon: <Lock className="h-4 w-4" />,
                  label: "Locked",
                  value: "v" + (draft.version || 1),
                  tone: "info",
                }
              : null,
            !isNew
              ? {
                  label: "Version",
                  value: `v${draft.version || 1}`,
                  tone: "violet",
                }
              : null,
            !isNew
              ? {
                  label: "Used by sizes",
                  value: String(draft.sizes_count || 0),
                  tone: "ok",
                }
              : null,
            !isNew && draft.deprecated
              ? { label: "Status", value: "Disabled", tone: "error" }
              : null,
          ].filter(Boolean) as any
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/master/pouch-styles")}
            className="inline-flex items-center gap-1 rounded-full bg-surface-1/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur ring-1 ring-surface-1/20 hover:bg-surface-1/25"
          >
            <ArrowLeft className="h-3 w-3" /> back to pouch styles
          </button>
          {versions.length > 1 ? (
            <div className="inline-flex items-center gap-1 rounded-full bg-surface-1/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur ring-1 ring-surface-1/20">
              <History className="h-3 w-3" />
              <select
                className="bg-transparent text-white outline-none"
                value={String(id || "")}
                onChange={(e) =>
                  router.push(`/master/pouch-styles/${e.target.value}`)
                }
              >
                {versions.map((v) => (
                  <option key={v.id} value={v.id} className="text-content-1">
                    v{v.version} · {v.locked ? "locked" : "draft"}
                    {v.deprecated ? " · disabled" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </GradientHero>

      {isLocked && !isNew ? (
        <div className="mt-4 rounded-2xl border-2 border-warning-border bg-warning-bg px-4 py-3 text-[12px] text-warning-fg">
          <div className="flex items-center gap-2 font-bold">
            <Lock className="h-3.5 w-3.5" /> This version is locked because
            product sizes are using it.
          </div>
          <p className="mt-1 text-[11px]">
            Saving real changes creates a{" "}
            <b>new draft v{(draft.version || 1) + 1}</b> and hides this v
            {draft.version || 1} from new pickers. Old sizes keep their existing
            snapshot.
          </p>
        </div>
      ) : null}
      {!isNew && !draft.deprecated && !isLocked ? (
        <div className="mt-4 rounded-2xl border-2 border-order-border bg-order-bg px-4 py-3 text-[12px] text-order-fg">
          <div className="flex items-center gap-2 font-bold">
            <ShieldCheck className="h-3.5 w-3.5" /> Draft style · not selectable
            yet.
          </div>
          <p className="mt-1 text-[11px]">
            Save the draft, then approve + lock it before Product Master sizes
            can use it.
          </p>
        </div>
      ) : null}
      {draft.deprecated && !isNew ? (
        <div className="mt-4 rounded-2xl border-2 border-danger-border bg-danger-bg px-4 py-3 text-[12px] text-danger-fg">
          <div className="flex items-center gap-2 font-bold">
            <EyeOff className="h-3.5 w-3.5" /> This style is disabled.
          </div>
          <p className="mt-1 text-[11px]">
            Hidden from pickers, historical references preserved. Click
            Reactivate to bring it back.
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* LEFT */}
        <div className="space-y-5">
          {/* Identity */}
          <Card index={1} title="Identity" tone="indigo">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code (unique per code)">
                <Input
                  value={draft.code || ""}
                  onChange={(e) =>
                    set("code", e.target.value.toUpperCase() as any)
                  }
                  placeholder="ACME_STAND_UP"
                  className="font-mono"
                  disabled={!isNew && isLocked}
                />
                {!isNew && isLocked ? (
                  <div className="mt-1 text-[10px] text-warning-fg">
                    Code is fixed across versions.
                  </div>
                ) : null}
              </Field>
              <Field label="Name">
                <Input
                  value={draft.name || ""}
                  onChange={(e) => set("name", e.target.value as any)}
                  placeholder="Stand-up pouch · Acme line"
                />
              </Field>
              <Field label="Emoji">
                <Input
                  value={draft.visual_emoji || ""}
                  onChange={(e) => set("visual_emoji", e.target.value as any)}
                  placeholder="🛍️"
                  className="text-center"
                />
              </Field>
              <Field label="Sort order">
                <Input
                  type="number"
                  value={Number(draft.sort_order || 100)}
                  onChange={(e) =>
                    set("sort_order", Number(e.target.value || 100) as any)
                  }
                />
              </Field>
            </div>
            <Field label="Description (optional)" className="mt-3">
              <Textarea
                rows={2}
                value={draft.description || ""}
                onChange={(e) => set("description", e.target.value as any)}
                placeholder="Short note about when to use this pouch."
              />
            </Field>
          </Card>

          {/* Allowed fields */}
          <Card index={2} title="Allowed input fields" tone="violet">
            <p className="-mt-1 mb-3 text-[11px] text-content-3">
              Choose which fields this pouch needs. W and H are the dimensions
              the operator types on the size editor; gusset / flap / etc. are
              extras that further shape the roll width.
            </p>

            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <FieldChip
                label="Width (W)"
                present={hasW}
                onAdd={() =>
                  addField("W", {
                    required: true,
                    label: "Width",
                    applies_to: "WIDTH",
                    default_coefficient: 2,
                  })
                }
                onRemove={() => removeField("W")}
                pinned
              />
              <FieldChip
                label="Height (H)"
                present={hasH}
                onAdd={() =>
                  addField("H", {
                    required: true,
                    label: "Height",
                    applies_to: "HEIGHT",
                    default_coefficient: 0,
                  })
                }
                onRemove={() => removeField("H")}
                pinned
              />
            </div>

            {Object.keys(allowedFields).filter((k) => k !== "W" && k !== "H")
              .length > 0 ? (
              <div className="space-y-2">
                {Object.entries(allowedFields)
                  .filter(([k]) => k !== "W" && k !== "H")
                  .map(([key, def]) => (
                    <ExtraFieldRow
                      key={key}
                      fieldKey={key}
                      def={def}
                      onPatch={(p) => patchField(key, p)}
                      onRemove={() => removeField(key)}
                    />
                  ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-line-strong bg-surface-2 px-3 py-3 text-[11px] text-content-3">
                No extras yet. Add gusset / flap / overlap / etc. from below if
                your pouch needs them.
              </div>
            )}

            {extraFieldsAvailable.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-order-border bg-order-bg p-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-order-fg">
                  Add a field
                </span>
                {extraFieldsAvailable.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() =>
                      addField(p.key, {
                        required: false,
                        label: p.label,
                        applies_to: p.suggested_axis as any,
                        default_coefficient: p.suggested_coeff,
                        default: p.suggested_default,
                      })
                    }
                    className="rounded-md bg-surface-1 px-2 py-1 text-[11px] font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                  >
                    <Plus className="mr-0.5 inline h-3 w-3" />
                    {p.label}
                  </button>
                ))}
                <CustomFieldAdder
                  onAdd={(k) =>
                    addField(k, {
                      required: false,
                      label: k,
                      applies_to: "WIDTH",
                      default_coefficient: 1,
                    })
                  }
                />
              </div>
            ) : null}
          </Card>

          {/* Formula builder — VISUAL */}
          <Card index={3} title="Child-width formula builder" tone="emerald">
            <p className="-mt-1 mb-2 text-[11px] text-content-3">
              <b>Child stock width = sum of (coefficient × field) + trim.</b>{" "}
              Click <b>+ Add</b> to drop in a field. Set its coefficient —
              that&apos;s how many times it contributes to the physical stocked
              width.
            </p>
            <p className="mb-3 text-[10.5px] text-content-3">
              If the child width comes from H, W becomes the cut pitch for
              weight. If the child width comes from W, H becomes the cut pitch.
            </p>

            <VisualLinearBuilder
              allowedFields={allowedFields}
              terms={terms}
              trim={trim}
              onSetTerm={setTerm}
              onRemoveTerm={removeTerm}
              onAddTerm={addTerm}
              onAddEmptyTerm={addEmptyTerm}
              onSetTrim={setTrim}
              onResetTerms={() =>
                setTerms(defaultLinearTermsForFields(allowedFields))
              }
              onApplyPreset={(preset) => {
                // Ensure preset's required fields are allowed
                const nextFields = { ...allowedFields };
                for (const f of preset.fields) {
                  if (!nextFields[f]) {
                    const guess = FIELD_PRESETS.find((p) => p.key === f);
                    nextFields[f] = {
                      required: false,
                      label: guess?.label || f,
                      applies_to: (guess?.suggested_axis as any) || "WIDTH",
                      default_coefficient: guess?.suggested_coeff ?? 1,
                      default: guess?.suggested_default ?? 0,
                    };
                  }
                }
                set("allowed_fields", nextFields as any);
                setParams({
                  ...formulaParams,
                  terms: preset.terms,
                  trim_mm: preset.trim,
                });
                if (preset.rollAxis)
                  set("default_roll_axis", preset.rollAxis as any);
                setFieldAdjustments({
                  trim_default_mm: preset.trim,
                  ...(preset.rollAxis ? { trim_axis: preset.rollAxis } : {}),
                });
              }}
            />

            <FormulaPolicyPanel
              rollAxis={rollAxis}
              trimAxis={(fieldAdjustments.trim_axis || "WIDTH") as any}
              onPatch={(patch) => {
                if (patch.default_roll_axis) {
                  set("default_roll_axis", patch.default_roll_axis as any);
                }
                const { default_roll_axis, ...rest } = patch;
                if (Object.keys(rest).length > 0) setFieldAdjustments(rest);
              }}
            />

            <StockAreaPolicyPanel
              stockForm={stockForm}
              widthBasis={widthBasis}
              slitPolicy={slitPolicy}
              filmAreaFactor={filmAreaFactor}
              onStockFormChange={(nextForm) => {
                const nextBasis = defaultWidthBasis(nextForm);
                const nextSlit = defaultSlitPolicy(nextForm);
                set("default_stock_form", nextForm as any);
                set("default_width_basis", nextBasis as any);
                set("default_slit_policy", nextSlit as any);
                patchStockFormOption(set, draft.stock_form_options, nextForm, {
                  enabled: true,
                  width_basis: nextBasis,
                  slit_policy: nextSlit,
                  film_area_factor: defaultFilmAreaFactor(nextForm),
                });
              }}
              onPatch={(patch) => {
                const next = {
                  width_basis: widthBasis,
                  slit_policy: slitPolicy,
                  film_area_factor: filmAreaFactor,
                  ...patch,
                  enabled: true,
                };
                if (patch.width_basis)
                  set("default_width_basis", patch.width_basis as any);
                if (patch.slit_policy)
                  set("default_slit_policy", patch.slit_policy as any);
                patchStockFormOption(
                  set,
                  draft.stock_form_options,
                  stockForm,
                  next,
                );
              }}
            />

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <FormulaEquation
                label="Child stock-width formula"
                value={`child width = ${prettyExpression("LINEAR", terms, trim) || "(empty — add a term above)"}`}
                tone="emerald"
              />
              <FormulaEquation
                label="Film-area formula"
                value={`area / pouch = (child width × ${formatNumber(filmAreaFactor)}) × ${rollAxis === "HEIGHT" ? "W" : "H"} / 1,000,000`}
                tone="violet"
              />
            </div>

            {/* Advanced toggle — keeps CUSTOM_AST + SHAPED_OVERRIDE for power users */}
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="mt-4 text-[11px] font-bold text-success-fg hover:underline"
            >
              {showAdvanced
                ? "Hide advanced options ▴"
                : "Show advanced options ▾"}
            </button>
            {showAdvanced ? (
              <div className="mt-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-3 text-[11px] text-warning-fg">
                <div className="font-bold">
                  Switch formula kind (most pouches don&apos;t need this)
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => set("formula_kind", "LINEAR")}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                      (draft.formula_kind || "LINEAR") === "LINEAR"
                        ? "bg-success-fg text-white ring-success-border"
                        : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
                    )}
                  >
                    LINEAR (default)
                  </button>
                  <button
                    type="button"
                    onClick={() => set("formula_kind", "SHAPED_OVERRIDE")}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                      draft.formula_kind === "SHAPED_OVERRIDE"
                        ? "bg-warning-fg text-white ring-warning-border"
                        : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
                    )}
                  >
                    Shaped (operator types width)
                  </button>
                </div>
                {draft.formula_kind === "SHAPED_OVERRIDE" ? (
                  <div className="mt-2 text-[10.5px]">
                    Make sure the field{" "}
                    <code className="font-mono">override_width</code> is in your
                    allowed inputs. Operator types it directly on each size.
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        </div>

        {/* RIGHT */}
        <div className="space-y-5">
          <Card index={4} title="Live preview" tone="amber">
            <p className="-mt-1 mb-3 text-[11px] text-content-3">
              Sample values only. This shows the physical child stock width, the
              pitch side, and the exact film area used for BOM/costing.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(allowedFields).map((k) => (
                <Field key={k} label={allowedFields[k].label || k}>
                  <Input
                    type="number"
                    step="any"
                    value={Number(previewInputs[k] ?? "")}
                    onChange={(e) =>
                      setPreviewInputs((p) => ({
                        ...p,
                        [k]: Number(e.target.value || 0),
                      }))
                    }
                  />
                </Field>
              ))}
            </div>

            <AreaPreviewCard
              liveTarget={liveTarget}
              filmAreaFactor={filmAreaFactor}
              rollAxis={rollAxis}
              previewInputs={previewInputs}
              stockForm={stockForm}
              widthBasis={widthBasis}
              expression={
                prettyExpression("LINEAR", terms, trim) ||
                "computed by your formula"
              }
            />

            <p className="mt-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[10.5px] text-warning-fg">
              Lane-up belongs to sales order / production planning. The style
              only owns width and area math.
            </p>
          </Card>

          <Card index={5} title="Actions" tone="slate">
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={
                  saveMutation.isPending ||
                  saveAndApproveMutation.isPending ||
                  !draft.code ||
                  !draft.name ||
                  (!isNew && !hasMeaningfulChanges)
                }
                variant={isNew || !isLocked ? "outline" : "default"}
                className={
                  isNew || !isLocked
                    ? "border-order-border text-order-fg hover:bg-order-bg"
                    : "bg-order-fg text-white hover:bg-order-fg"
                }
              >
                <Save className="mr-1.5 h-4 w-4" />
                {saveMutation.isPending
                  ? "Saving…"
                  : isNew
                    ? "Create draft"
                    : isLocked
                      ? hasMeaningfulChanges
                        ? `Save as draft v${(draft.version || 1) + 1}`
                        : "No changes to save"
                      : hasMeaningfulChanges
                        ? "Save draft"
                        : "Draft saved"}
              </Button>
              {isNew || (!draft.deprecated && !isLocked) ? (
                <Button
                  onClick={() => {
                    if (isNew || hasMeaningfulChanges) {
                      saveAndApproveMutation.mutate();
                    } else {
                      approveMutation.mutate();
                    }
                  }}
                  disabled={
                    approveMutation.isPending ||
                    saveMutation.isPending ||
                    saveAndApproveMutation.isPending ||
                    !draft.code ||
                    !draft.name
                  }
                  className="bg-success-fg text-white hover:bg-success-fg disabled:opacity-60"
                  title="Save this draft if needed, then approve and lock it for Product Master sizes."
                >
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  {approveMutation.isPending || saveAndApproveMutation.isPending
                    ? "Approving…"
                    : isNew || hasMeaningfulChanges
                      ? "Save + approve + lock"
                      : "Approve + lock"}
                </Button>
              ) : null}
              {isNew || (!draft.deprecated && !isLocked) ? (
                <div className="rounded-xl bg-success-bg px-3 py-2 text-[10.5px] font-medium text-success-fg ring-1 ring-success-border">
                  Use <b>Save + approve + lock</b> when the formula is ready.
                  Draft styles stay hidden from Product Master size pickers.
                </div>
              ) : null}
              {!isNew && !draft.deprecated ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      confirm(
                        "Disable this pouch style? It will be hidden from pickers but historical references preserved.",
                      )
                    )
                      disableMutation.mutate();
                  }}
                  className="border-danger-border text-danger-fg hover:bg-danger-bg"
                >
                  <EyeOff className="mr-1.5 h-4 w-4" /> Disable
                </Button>
              ) : !isNew && draft.deprecated ? (
                <Button
                  variant="outline"
                  onClick={() => reactivateMutation.mutate()}
                  className="border-success-border text-success-fg hover:bg-success-bg"
                >
                  <Eye className="mr-1.5 h-4 w-4" /> Reactivate
                </Button>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function emptyDraft(): Partial<PouchStyle> {
  return {
    code: "",
    name: "",
    description: "",
    version: 1,
    locked: false,
    visual_emoji: "🛍️",
    default_roll_axis: "WIDTH",
    default_stock_form: "OPEN_WEB",
    default_width_basis: "OPEN_WEB_WIDTH",
    default_slit_policy: "SLIT_ALLOWED",
    stock_form_options: defaultStockFormOptions(),
    allowed_fields: {
      W: {
        required: true,
        label: "Width",
        applies_to: "WIDTH",
        default_coefficient: 2,
      },
      H: {
        required: true,
        label: "Height",
        applies_to: "HEIGHT",
        default_coefficient: 1,
      },
    } as any,
    field_adjustments: { trim_default_mm: 5 } as any,
    formula_kind: "LINEAR",
    formula_params: {
      terms: [
        {
          factors: [
            { kind: "NUMBER", value: 2 },
            { kind: "FIELD", field: "W" },
          ],
        },
      ],
      trim_mm: 5,
    } as any,
    formula_ast: {},
    formula_expression: "(empty — add a term)",
    sort_order: 100,
    deprecated: false,
    notes: "",
  };
}

function cleanFieldAdjustments(value?: Record<string, any>) {
  const cleaned = { ...(value || {}) };
  delete cleaned.default_lane_count;
  return cleaned;
}

function styleToPayload(style: PouchStyle) {
  const stockForm = String(
    style.default_stock_form || "OPEN_WEB",
  ).toUpperCase();
  const widthBasis = String(
    style.default_width_basis || defaultWidthBasis(stockForm),
  ).toUpperCase();
  const slitPolicy = String(
    style.default_slit_policy || defaultSlitPolicy(stockForm),
  ).toUpperCase();
  const params = (style.formula_params || {}) as Record<string, any>;
  const terms = Array.isArray(params.terms) ? params.terms : [];
  const trim = Number(params.trim_mm ?? 0);
  return {
    code: style.code || "",
    name: style.name || "",
    description: style.description || "",
    visual_emoji: style.visual_emoji || "🛍️",
    visual_svg: style.visual_svg || "",
    default_roll_axis: normalizeAreaRollAxis(style.default_roll_axis) as any,
    default_stock_form: stockForm as any,
    default_width_basis: widthBasis as any,
    default_slit_policy: slitPolicy as any,
    stock_form_options: normalizeStockFormOptions(style.stock_form_options),
    allowed_fields: style.allowed_fields || {},
    field_adjustments: cleanFieldAdjustments(style.field_adjustments || {}),
    formula_kind: (style.formula_kind || "LINEAR") as PouchFormulaKind,
    formula_params: params,
    formula_ast: (style.formula_ast as any) || {},
    formula_expression:
      style.formula_expression ||
      prettyExpression(style.formula_kind as PouchFormulaKind, terms, trim),
    deprecated: !!style.deprecated,
    sort_order: Number(style.sort_order || 100),
    notes: style.notes || "",
  };
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: any): any {
  if (Array.isArray(value)) return value.map(sortStable);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = sortStable(value[key]);
          return acc;
        },
        {} as Record<string, any>,
      );
  }
  return value;
}

function prettyExpression(
  kind: PouchFormulaKind,
  terms: PouchFormulaTerm[],
  trim: number,
  ast?: PouchAstNode,
): string {
  if (kind === "SHAPED_OVERRIDE") return "override_width (operator-typed)";
  if (kind === "CUSTOM_AST") return ast && (ast as any).op ? "custom AST" : "";
  const pieces = (terms || []).map((t) => termToString(t)).filter((s) => !!s);
  const joined = pieces.join(" + ");
  const trimPart =
    Number(trim || 0) !== 0 ? `${pieces.length ? " + " : ""}${trim}` : "";
  if (!joined && !trimPart) return "";
  return joined + trimPart;
}

function defaultFilmAreaFactor(stockForm?: string) {
  return String(stockForm || "").toUpperCase() === "LAYFLAT_TUBE" ? 2 : 1;
}

function defaultWidthBasis(stockForm?: string) {
  if (String(stockForm || "").toUpperCase() === "LAYFLAT_TUBE")
    return "LAYFLAT_WIDTH";
  if (String(stockForm || "").toUpperCase() === "FOLDED_WEB")
    return "FOLDED_WIDTH";
  return "OPEN_WEB_WIDTH";
}

function defaultSlitPolicy(stockForm?: string) {
  return String(stockForm || "").toUpperCase() === "OPEN_WEB"
    ? "SLIT_ALLOWED"
    : "EXACT_ONLY";
}

function defaultStockFormOptions() {
  return {
    OPEN_WEB: {
      enabled: true,
      film_area_factor: 1,
      width_basis: "OPEN_WEB_WIDTH",
      slit_policy: "SLIT_ALLOWED",
    },
    LAYFLAT_TUBE: {
      enabled: false,
      film_area_factor: 2,
      width_basis: "LAYFLAT_WIDTH",
      slit_policy: "EXACT_ONLY",
    },
    FOLDED_WEB: {
      enabled: false,
      film_area_factor: 1,
      width_basis: "FOLDED_WIDTH",
      slit_policy: "EXACT_ONLY",
    },
  };
}

function normalizeStockFormOptions(raw?: Record<string, any>) {
  const base = defaultStockFormOptions();
  const source = raw && typeof raw === "object" ? raw : {};
  const out: Record<string, any> = {};
  for (const option of STOCK_FORM_OPTIONS) {
    const cfg =
      source[option.value] && typeof source[option.value] === "object"
        ? source[option.value]
        : {};
    out[option.value] = {
      ...base[option.value],
      ...cfg,
      width_basis: cfg.width_basis || option.basis,
      slit_policy: cfg.slit_policy || option.slit,
      film_area_factor: Number(cfg.film_area_factor || option.factor),
    };
  }
  return out;
}

function resolveFilmAreaFactor(style: Partial<PouchStyle>, stockForm: string) {
  const options = normalizeStockFormOptions(style.stock_form_options);
  const factor = Number(
    options[stockForm]?.film_area_factor || defaultFilmAreaFactor(stockForm),
  );
  return Number.isFinite(factor) && factor > 0
    ? factor
    : defaultFilmAreaFactor(stockForm);
}

function patchStockFormOption(
  setValue: <K extends keyof PouchStyle>(
    key: K,
    v: PouchStyle[K] | undefined,
  ) => void,
  raw: Record<string, any> | undefined,
  stockForm: string,
  patch: Record<string, any>,
) {
  const next = normalizeStockFormOptions(raw);
  next[stockForm] = {
    ...(next[stockForm] || {}),
    ...patch,
  };
  setValue("stock_form_options", next as any);
}

function normalizeAreaRollAxis(value?: string | null): "WIDTH" | "HEIGHT" {
  return String(value || "").toUpperCase() === "HEIGHT" ? "HEIGHT" : "WIDTH";
}

function stockFormLabel(value?: string) {
  if (String(value || "").toUpperCase() === "LAYFLAT_TUBE")
    return "lay-flat tube";
  if (String(value || "").toUpperCase() === "FOLDED_WEB") return "folded web";
  return "open web";
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-content-3">
        {label}
      </div>
      {children}
    </label>
  );
}

const TONE: Record<string, string> = {
  indigo: "border-order-border bg-order-bg text-order-fg",
  violet: "border-order-border bg-order-bg text-order-fg",
  emerald: "border-success-border bg-success-bg text-success-fg",
  rose: "border-danger-border bg-danger-bg text-danger-fg",
  amber: "border-warning-border bg-warning-bg text-warning-fg",
  slate: "border-line bg-surface-2 text-content-2",
};

function Card({
  index,
  title,
  tone,
  children,
}: {
  index: number;
  title: string;
  tone: keyof typeof TONE;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border bg-surface-1 p-4 shadow-sm",
        TONE[tone].split(" ")[0],
      )}
    >
      <header className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "grid h-5 w-5 place-items-center rounded text-[10px] font-black",
            TONE[tone],
          )}
        >
          {index}
        </span>
        <h2 className="font-display text-sm font-bold text-content-1">
          {title}
        </h2>
      </header>
      {children}
    </section>
  );
}

function FieldChip({
  label,
  present,
  onAdd,
  onRemove,
  pinned,
}: {
  label: string;
  present: boolean;
  onAdd: () => void;
  onRemove: () => void;
  pinned?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-xl px-3 py-2 ring-1",
        present
          ? "bg-success-bg ring-success-border"
          : "bg-surface-2 ring-line",
      )}
    >
      <span
        className={cn(
          "text-[12px] font-bold",
          present ? "text-success-fg" : "text-content-3",
        )}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        {pinned ? (
          <Badge variant="outline" className="border-line-strong text-[9px]">
            always shown
          </Badge>
        ) : null}
        {present ? (
          <button
            type="button"
            onClick={() => {
              if (pinned && !confirm(`Remove ${label}? Most pouches need it.`))
                return;
              onRemove();
            }}
            className="rounded-md p-1 text-content-4 hover:bg-danger-bg hover:text-danger-fg"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-md bg-success-fg px-2 py-0.5 text-[10px] font-bold text-white hover:bg-success-fg"
          >
            + Add
          </button>
        )}
      </div>
    </div>
  );
}

function ExtraFieldRow({
  fieldKey,
  def,
  onPatch,
  onRemove,
}: {
  fieldKey: string;
  def: PouchFieldDef;
  onPatch: (p: Partial<PouchFieldDef>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid items-center gap-2 rounded-xl border border-line bg-surface-1 p-2.5 sm:grid-cols-[120px_minmax(0,1fr)_120px_140px_100px_auto]">
      <span
        className={cn(
          "rounded-md px-2 py-0.5 text-center font-mono text-[11px] font-bold ring-1",
          toneFor(fieldKey),
        )}
      >
        {fieldKey}
      </span>
      <Input
        value={def.label || ""}
        onChange={(e) => onPatch({ label: e.target.value })}
        className="h-8 text-[12px]"
        placeholder="Field label"
      />
      <label className="flex items-center gap-1 text-[11px] font-bold">
        <input
          type="checkbox"
          checked={!!def.required}
          onChange={(e) => onPatch({ required: e.target.checked })}
        />
        required
      </label>
      <Select
        value={String(def.applies_to || "WIDTH")}
        onValueChange={(v) => onPatch({ applies_to: v as any })}
      >
        <SelectTrigger className="h-8 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AXIS_OPTS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        step="any"
        value={def.default == null ? "" : String(def.default)}
        onChange={(e) =>
          onPatch({
            default: e.target.value === "" ? undefined : Number(e.target.value),
          })
        }
        className="h-8 text-[11px]"
        placeholder="default"
      />
      <button
        type="button"
        onClick={onRemove}
        className="rounded-md p-1 text-content-4 hover:bg-danger-bg hover:text-danger-fg"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

interface FormulaPreset {
  code: string;
  emoji: string;
  label: string;
  formula: string;
  fields: string[]; // fields to ensure present
  terms: PouchFormulaTerm[];
  trim: number;
  rollAxis?: "WIDTH" | "HEIGHT" | "BOTH";
}

const FORMULA_PRESETS: FormulaPreset[] = [
  {
    code: "PILLOW",
    emoji: "📦",
    label: "Pillow / 3-side",
    formula: "2W + trim",
    fields: ["W"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "W" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "STAND_UP_K",
    emoji: "🛍",
    label: "Stand-up · K-bottom",
    formula: "2W + G + trim",
    fields: ["W", "gusset"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "W" },
        ],
      },
      {
        factors: [
          { kind: "NUMBER", value: 1 },
          { kind: "FIELD", field: "gusset" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "SIDE_GUSSET",
    emoji: "📁",
    label: "Side gusset",
    formula: "2W + 2G + trim",
    fields: ["W", "gusset"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "W" },
        ],
      },
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "gusset" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "QUAD_SEAL",
    emoji: "🟦",
    label: "Quad seal",
    formula: "2W + 2G + trim",
    fields: ["W", "gusset"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "W" },
        ],
      },
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "gusset" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "CENTER_SEAL",
    emoji: "↕️",
    label: "Center seal · H-axis",
    formula: "H + overlap + trim",
    fields: ["H", "overlap"],
    rollAxis: "HEIGHT",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 1 },
          { kind: "FIELD", field: "H" },
        ],
      },
      {
        factors: [
          { kind: "NUMBER", value: 1 },
          { kind: "FIELD", field: "overlap" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "DOUBLE_H",
    emoji: "↕️",
    label: "2H feed",
    formula: "2H + trim",
    fields: ["H"],
    rollAxis: "HEIGHT",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "H" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "W_PLUS_H",
    emoji: "⊞",
    label: "W + H",
    formula: "W + H + trim",
    fields: ["W", "H"],
    rollAxis: "BOTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 1 },
          { kind: "FIELD", field: "W" },
        ],
      },
      {
        factors: [
          { kind: "NUMBER", value: 1 },
          { kind: "FIELD", field: "H" },
        ],
      },
    ],
    trim: 5,
  },
  {
    code: "STICK_PACK",
    emoji: "📏",
    label: "Stick pack",
    formula: "W × stick_factor + trim",
    fields: ["W", "stick_factor"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "FIELD", field: "W" },
          { kind: "FIELD", field: "stick_factor" },
        ],
      },
    ],
    trim: 3,
  },
  {
    code: "K_WITH_FACTOR",
    emoji: "🏷",
    label: "K-bottom × factor",
    formula: "2W + G × bottom_factor + trim",
    fields: ["W", "gusset", "bottom_factor"],
    rollAxis: "WIDTH",
    terms: [
      {
        factors: [
          { kind: "NUMBER", value: 2 },
          { kind: "FIELD", field: "W" },
        ],
      },
      {
        factors: [
          { kind: "FIELD", field: "gusset" },
          { kind: "FIELD", field: "bottom_factor" },
        ],
      },
    ],
    trim: 5,
  },
];

function VisualLinearBuilder({
  allowedFields,
  terms,
  trim,
  onSetTerm,
  onRemoveTerm,
  onAddTerm,
  onAddEmptyTerm,
  onSetTrim,
  onResetTerms,
  onApplyPreset,
}: {
  allowedFields: Record<string, PouchFieldDef>;
  terms: PouchFormulaTerm[];
  trim: number;
  onSetTerm: (idx: number, next: PouchFormulaTerm) => void;
  onRemoveTerm: (idx: number) => void;
  onAddTerm: (field: string) => void;
  onAddEmptyTerm: () => void;
  onSetTrim: (v: number) => void;
  onResetTerms: () => void;
  onApplyPreset: (preset: FormulaPreset) => void;
}) {
  const allFieldKeys = Object.keys(allowedFields).filter(
    (k) => k !== "override_width",
  );

  return (
    <div className="rounded-2xl border border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg p-3">
      {/* Preset bar */}
      <div className="mb-3 rounded-xl border border-success-border bg-surface-1 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-success-fg">
            Quick presets
          </div>
          <div className="text-[10px] text-content-3">
            click to fill the formula in one go
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FORMULA_PRESETS.map((p) => (
            <button
              key={p.code}
              type="button"
              onClick={() => onApplyPreset(p)}
              className="group flex items-center gap-1.5 rounded-lg border border-success-border bg-success-bg px-2 py-1 text-[11px] font-bold text-success-fg hover:bg-success-bg"
              title={p.formula}
            >
              <span>{p.emoji}</span>
              <span>{p.label}</span>
              <span className="hidden font-mono text-[9px] text-success-fg opacity-70 group-hover:inline">
                {p.formula}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-success-fg">
        Child stock width =
      </div>

      {/* Term list, stacked vertically each as a product chain */}
      <div className="space-y-2">
        {terms.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-success-border bg-surface-1 px-3 py-4 text-center text-[11px] text-success-fg">
            No terms yet — pick a field below to start the formula.
          </div>
        ) : (
          terms.map((t, idx) => (
            <React.Fragment key={idx}>
              <TermRow
                term={normalizeTerm(t)}
                allowedFields={allowedFields}
                onChange={(next) => onSetTerm(idx, next)}
                onRemove={() => onRemoveTerm(idx)}
                onAddTerm={(field) => {
                  if (field === "__NUMBER__") {
                    onAddEmptyTerm();
                  } else {
                    onAddTerm(field);
                  }
                }}
              />
              <div className="pl-3 text-base font-bold text-success-fg">+</div>
            </React.Fragment>
          ))
        )}

        {/* Trim row */}
        <div className="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2 ring-1 ring-line-strong">
          <span className="text-[10px] font-black uppercase tracking-widest text-content-3">
            trim constant
          </span>
          <input
            type="number"
            step="any"
            value={Number(trim || 0)}
            onChange={(e) => onSetTrim(Number(e.target.value || 0))}
            className="h-8 w-20 rounded-md border border-surface-1 bg-surface-1 px-1.5 text-center font-mono text-sm font-bold"
          />
          <span className="text-[10px] font-bold text-content-3">mm</span>
        </div>
      </div>

      {/* Add-term tray */}
      {allFieldKeys.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-success-border bg-surface-1 px-3 py-2">
          <span className="text-[10px] font-black uppercase tracking-widest text-success-fg">
            + Add term
          </span>
          {allFieldKeys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAddTerm(k)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 hover:opacity-90",
                toneFor(k),
              )}
            >
              <Plus className="mr-0.5 inline h-3 w-3" /> {k}
            </button>
          ))}
          <button
            type="button"
            onClick={onAddEmptyTerm}
            className="rounded-lg bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-content-2 ring-1 ring-line-strong hover:bg-line"
          >
            <Plus className="mr-0.5 inline h-3 w-3" /> blank
          </button>
        </div>
      ) : null}

      {/* Help + reset */}
      <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-[10px] text-content-3">
          Each term is a <b>product chain</b> · 2 × W, W × bottom_factor, gusset
          × 2, etc. Click the <b>×</b> between chips to add another factor.
        </span>
        <Button variant="outline" size="sm" onClick={onResetTerms}>
          <Eraser className="mr-1 h-3 w-3" /> Reset to defaults
        </Button>
      </div>
    </div>
  );
}

function FormulaPolicyPanel({
  rollAxis,
  trimAxis,
  onPatch,
}: {
  rollAxis: "WIDTH" | "HEIGHT";
  trimAxis: "WIDTH" | "HEIGHT" | "BOTH" | "NONE";
  onPatch: (patch: Record<string, any>) => void;
}) {
  return (
    <div className="mt-3 grid gap-3 rounded-2xl border border-info-border bg-gradient-to-br from-info-bg via-white to-info-bg p-3 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-info-fg">
          Roll axis policy
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {(["WIDTH", "HEIGHT"] as const).map((axis) => (
            <button
              key={axis}
              type="button"
              onClick={() => onPatch({ default_roll_axis: axis })}
              className={cn(
                "rounded-lg px-2 py-2 text-[11px] font-black ring-1 transition",
                rollAxis === axis
                  ? "bg-info-fg text-white ring-info-border"
                  : "bg-surface-1 text-info-fg ring-info-border hover:bg-info-bg",
              )}
            >
              {axis === "WIDTH"
                ? "Web from W-side · pitch H"
                : "Web from H-side · pitch W"}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[10px] text-info-fg">
          Choose the axis that the child-width formula represents. The other
          side becomes the film-area pitch.
        </div>
      </div>
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-info-fg">
          Trim rule
        </div>
        <Select
          value={trimAxis}
          onValueChange={(value) => onPatch({ trim_axis: value })}
        >
          <SelectTrigger className="mt-2 h-9 bg-surface-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AXIS_OPTS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-1 text-[10px] text-info-fg">
          Use this to document whether trim belongs to W, H, both, or neither.
        </div>
      </div>
    </div>
  );
}

function StockAreaPolicyPanel({
  stockForm,
  widthBasis,
  slitPolicy,
  filmAreaFactor,
  onStockFormChange,
  onPatch,
}: {
  stockForm: string;
  widthBasis: string;
  slitPolicy: string;
  filmAreaFactor: number;
  onStockFormChange: (next: string) => void;
  onPatch: (patch: Record<string, any>) => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-order-border bg-gradient-to-br from-order-bg via-white to-order-bg p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-order-fg">
            Area formula builder
          </div>
          <p className="mt-1 max-w-[620px] text-[10.5px] text-order-fg">
            The width formula gives the physical child stock width. The area
            formula decides how much film wall that stock represents for
            BOM/costing.
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-order-border bg-surface-1 text-[10px] font-black text-order-fg"
        >
          film area = child × {formatNumber(filmAreaFactor)} × pitch
        </Badge>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_110px]">
        <Field label="Default stock form">
          <Select value={stockForm} onValueChange={onStockFormChange}>
            <SelectTrigger className="h-9 bg-surface-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STOCK_FORM_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Stored width means">
          <Select
            value={widthBasis}
            onValueChange={(value) => onPatch({ width_basis: value })}
          >
            <SelectTrigger className="h-9 bg-surface-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OPEN_WEB_WIDTH">Open-web width</SelectItem>
              <SelectItem value="LAYFLAT_WIDTH">Lay-flat width</SelectItem>
              <SelectItem value="FOLDED_WIDTH">Folded width</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Allocator rule">
          <Select
            value={slitPolicy}
            onValueChange={(value) => onPatch({ slit_policy: value })}
          >
            <SelectTrigger className="h-9 bg-surface-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SLIT_ALLOWED">Slitting allowed</SelectItem>
              <SelectItem value="EXACT_ONLY">Exact width only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Area factor">
          <Input
            type="number"
            min={0.1}
            step="0.1"
            value={Number(filmAreaFactor || 1)}
            onChange={(event) =>
              onPatch({ film_area_factor: Number(event.target.value || 1) })
            }
            className="h-9 bg-surface-1 text-right text-xs"
          />
        </Field>
      </div>
      <div className="mt-2 grid gap-2 text-[10.5px] text-order-fg md:grid-cols-3">
        <div className="rounded-xl bg-surface-1 px-3 py-2 ring-1 ring-order-border">
          <b>Open web:</b> film area width equals the stocked web width.
        </div>
        <div className="rounded-xl bg-surface-1 px-3 py-2 ring-1 ring-order-border">
          <b>Tube:</b> stocked width is lay-flat, film area is doubled so weight
          is not understated.
        </div>
        <div className="rounded-xl bg-surface-1 px-3 py-2 ring-1 ring-order-border">
          <b>{SLIT_POLICY_LABEL[slitPolicy] || slitPolicy}:</b> controls whether
          WCM may slit wider parent rolls.
        </div>
      </div>
    </div>
  );
}

function AreaPreviewCard({
  liveTarget,
  filmAreaFactor,
  rollAxis,
  previewInputs,
  stockForm,
  widthBasis,
  expression,
}: {
  liveTarget: number;
  filmAreaFactor: number;
  rollAxis: "WIDTH" | "HEIGHT";
  previewInputs: Record<string, number>;
  stockForm: string;
  widthBasis: string;
  expression: string;
}) {
  const pitchField = rollAxis === "HEIGHT" ? "W" : "H";
  const pitchValue = Number(previewInputs[pitchField] || 0);
  const childWidth = Number.isFinite(liveTarget) ? liveTarget : 0;
  const filmAreaWidth = childWidth * Number(filmAreaFactor || 1);
  const areaM2 = (filmAreaWidth * pitchValue) / 1_000_000;

  return (
    <div className="mt-3 rounded-2xl border-2 border-order-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-order-fg">
            Width + film area preview
          </div>
          <div className="mt-1 font-mono text-[11px] font-bold text-order-fg">
            {expression}
          </div>
        </div>
        <Badge
          variant="outline"
          className="border-order-border bg-order-bg text-[10px] font-black text-order-fg"
        >
          {stockFormLabel(stockForm)}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <PreviewMetric
          label="Child stock width"
          value={`${formatNumber(childWidth)} mm`}
          tone="emerald"
        />
        <PreviewMetric
          label="Film area width"
          value={`${formatNumber(filmAreaWidth)} mm`}
          tone="violet"
        />
        <PreviewMetric
          label="Pitch side"
          value={`${pitchField} = ${formatNumber(pitchValue)} mm`}
        />
        <PreviewMetric
          label="Area / pouch"
          value={`${formatNumber(areaM2, 4)} m²`}
          tone="violet"
        />
      </div>
      <div className="mt-3 rounded-xl bg-order-bg px-3 py-2 font-mono text-[11px] leading-5 text-order-fg">
        <div>
          stock form: {stockFormLabel(stockForm)} · width basis:{" "}
          {WIDTH_BASIS_LABEL[widthBasis] || widthBasis}
        </div>
        <div>
          film area width = {formatNumber(childWidth)} ×{" "}
          {formatNumber(filmAreaFactor)} = {formatNumber(filmAreaWidth)} mm
        </div>
        <div>
          area = {formatNumber(filmAreaWidth)} × {formatNumber(pitchValue)} /
          1,000,000 = {formatNumber(areaM2, 4)} m²
        </div>
      </div>
    </div>
  );
}

function PreviewMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "violet" | "emerald";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 ring-1",
        tone === "violet"
          ? "bg-order-bg text-order-fg ring-order-border"
          : tone === "emerald"
            ? "bg-success-bg text-success-fg ring-success-border"
            : "bg-surface-2 text-content-1 ring-line",
      )}
    >
      <div className="text-[9px] font-black uppercase tracking-widest opacity-60">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[14px] font-black">{value}</div>
    </div>
  );
}

function FormulaEquation({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "violet";
}) {
  return (
    <div
      className={cn(
        "rounded-xl px-3 py-2 font-mono text-[12px] leading-5 ring-1",
        tone === "emerald"
          ? "bg-[#10233f] text-success-border ring-success-border"
          : "bg-order-fg text-order-border ring-order-border",
      )}
    >
      <div className="mb-1 font-sans text-[9px] font-black uppercase tracking-widest opacity-70">
        {label}
      </div>
      {value}
    </div>
  );
}

function normalizeTerm(t: PouchFormulaTerm): PouchFormulaTerm {
  // Migrate legacy { field, coefficient } to factors[] on the fly.
  if (Array.isArray(t.factors) && t.factors.length > 0) return t;
  if (t.field) {
    return {
      factors: [
        {
          kind: "NUMBER",
          value: typeof t.coefficient === "number" ? t.coefficient : 1,
        },
        { kind: "FIELD", field: t.field },
      ],
    };
  }
  return { factors: [{ kind: "NUMBER", value: 1 }] };
}

function TermRow({
  term,
  allowedFields,
  onChange,
  onRemove,
  onAddTerm,
}: {
  term: PouchFormulaTerm;
  allowedFields: Record<string, PouchFieldDef>;
  onChange: (next: PouchFormulaTerm) => void;
  onRemove: () => void;
  onAddTerm: (field: string) => void;
}) {
  const factors = term.factors || [];
  const allFieldKeys = Object.keys(allowedFields).filter(
    (k) => k !== "override_width",
  );

  const setFactor = (idx: number, next: PouchFormulaFactor) => {
    const out = factors.map((f, i) => (i === idx ? next : f));
    onChange({ factors: out });
  };
  const removeFactor = (idx: number) => {
    const out = factors.filter((_, i) => i !== idx);
    onChange({ factors: out.length ? out : [{ kind: "NUMBER", value: 1 }] });
  };
  const addFactor = (next: PouchFormulaFactor) => {
    onChange({ factors: [...factors, next] });
  };

  return (
    <div className="relative rounded-2xl border border-success-border bg-surface-1 p-2.5 shadow-sm">
      <button
        type="button"
        onClick={onRemove}
        className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-danger-solid text-white shadow hover:bg-danger-solid"
        title="Remove this term"
      >
        <X className="h-3 w-3" />
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        {factors.length === 0 ? (
          <span className="text-[11px] text-content-4">empty term</span>
        ) : null}
        {factors.map((f, idx) => (
          <React.Fragment key={idx}>
            <FactorChip
              factor={f}
              allowedFields={allowedFields}
              onChange={(next) => setFactor(idx, next)}
              onRemove={() => removeFactor(idx)}
            />
            {idx < factors.length - 1 ? (
              <span className="text-[14px] font-bold text-success-fg">×</span>
            ) : null}
          </React.Fragment>
        ))}
        {/* + extend formula */}
        <FactorAdder
          allFieldKeys={allFieldKeys}
          onAddNumber={() => addFactor({ kind: "NUMBER", value: 1 })}
          onAddField={(k) => addFactor({ kind: "FIELD", field: k })}
          onAddTermNumber={() => onAddTerm("__NUMBER__")}
          onAddTermField={(k) => onAddTerm(k)}
        />
      </div>
    </div>
  );
}

function FactorChip({
  factor,
  allowedFields,
  onChange,
  onRemove,
}: {
  factor: PouchFormulaFactor;
  allowedFields: Record<string, PouchFieldDef>;
  onChange: (next: PouchFormulaFactor) => void;
  onRemove: () => void;
}) {
  if (factor.kind === "NUMBER") {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-[#10233f] px-2 py-1 ring-1 ring-primary">
        <input
          type="number"
          step="any"
          value={Number(factor.value ?? 0)}
          onChange={(e) =>
            onChange({ kind: "NUMBER", value: Number(e.target.value || 0) })
          }
          className="h-6 w-14 rounded-md border border-line-strong bg-line px-1.5 text-center font-mono text-sm font-bold text-success-border"
        />
        <button
          type="button"
          onClick={onRemove}
          className="grid h-4 w-4 place-items-center rounded-full bg-danger-solid text-white hover:bg-danger-solid"
          title="Remove factor"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </span>
    );
  }
  // FIELD
  const fieldKey = String(factor.field || "");
  const tone = toneFor(fieldKey);
  const def = allowedFields[fieldKey] || {};
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-sm font-extrabold ring-1",
        tone,
      )}
    >
      <span>{fieldKey || "?"}</span>
      {def.applies_to ? (
        <span className="rounded-full bg-surface-1/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest opacity-80">
          {def.applies_to}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="grid h-4 w-4 place-items-center rounded-full bg-danger-solid text-white hover:bg-danger-solid"
        title="Remove factor"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

function FactorAdder({
  allFieldKeys,
  onAddNumber,
  onAddField,
  onAddTermNumber,
  onAddTermField,
}: {
  allFieldKeys: string[];
  onAddNumber: () => void;
  onAddField: (k: string) => void;
  onAddTermNumber: () => void;
  onAddTermField: (k: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!open) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);
  return (
    <span ref={wrapperRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border-2 border-dashed px-2.5 py-1.5 text-[11px] font-bold transition",
          open
            ? "border-success-border bg-success-bg text-success-fg"
            : "border-success-border bg-surface-1 text-success-fg hover:bg-success-bg",
        )}
        title="Multiply by another factor OR add a new term"
      >
        <Plus className="h-3 w-3" />
        <span>extend formula…</span>
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[320px] rounded-xl border border-success-border bg-surface-1 p-3 shadow-xl">
          {/* MULTIPLY (in this term) */}
          <div className="rounded-lg border-2 border-success-border bg-success-bg p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-success-fg">
                × multiply this term by…
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => {
                  onAddNumber();
                  setOpen(false);
                }}
                className="rounded-md bg-[#10233f] px-2 py-1 text-[11px] font-bold text-success-border hover:bg-[#18375f]"
                title="Multiply by a constant number"
              >
                a number
              </button>
              {allFieldKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onAddField(k);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                    toneFor(k),
                  )}
                  title={`Multiply this term by ${k}`}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {/* ADD (new term) */}
          <div className="mt-2 rounded-lg border-2 border-warning-border bg-warning-bg p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-warning-fg">
                + add a NEW term with…
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => {
                  onAddTermNumber();
                  setOpen(false);
                }}
                className="rounded-md bg-[#10233f] px-2 py-1 text-[11px] font-bold text-warning-border hover:bg-[#18375f]"
                title="Add a new constant term"
              >
                a number
              </button>
              {allFieldKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onAddTermField(k);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                    toneFor(k),
                  )}
                  title={`Add ${k} as a new term`}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-warning-fg">
              Use this when you want <b>W + H</b>, <b>2W + flap</b>, etc. —
              separate term that adds to the formula.
            </div>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function CustomFieldAdder({ onAdd }: { onAdd: (k: string) => void }) {
  const [v, setV] = React.useState("");
  return (
    <div className="flex items-center gap-1">
      <Input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="custom_key"
        className="h-8 w-32 text-[12px]"
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          if (v.trim()) {
            onAdd(v.trim());
            setV("");
          }
        }}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  );
}
