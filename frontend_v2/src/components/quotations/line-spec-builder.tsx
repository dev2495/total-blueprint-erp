"use client";

import { useMemo } from "react";
import {
  Layers3,
  Plus,
  Ruler,
  Sparkles,
  Trash2,
  Droplets,
  Paintbrush,
  PackageCheck,
} from "lucide-react";

import { cn } from "@/lib/utils";
import MaterialPicker from "@/components/materials/material-picker";
import type {
  BomAddon,
  BomLayer,
  QuoteLineInnerPack,
  QuoteLineSpec,
} from "@/services/quotation";

export interface LineSpecValue {
  origin: "CATALOG" | "AD_HOC";
  product_master_id?: string;
  product_master_code?: string;
  product_master_name?: string;
  size_id?: string;
  size_code?: string;
  size_label?: string;
  base_product_master_id?: string;
  base_product_master_code?: string;
  base_product_master_name?: string;
  base_size_id?: string;
  base_size_code?: string;
  base_size_label?: string;
  pouch_style_id?: string;
  pouch_style_code?: string;
  pouch_style_roll_axis?: string;
  stock_form?: string;
  width_basis?: string;
  film_area_width_mm?: number | null;
  print_capable?: boolean | null;
  artwork_required?: boolean | null;
  child_target_width_mm?: number | null;
  width_mm: number;
  height_mm: number;
  gusset_mm: number;
  flap_mm: number;
  layers: BomLayer[];
  adhesive: {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
  };
  ink: {
    material_id?: string | null;
    code?: string;
    name?: string;
    gsm: number;
    rate_per_kg: number;
    coverage?: string;
  };
  addons: BomAddon[];
  optional_inner_pack?: QuoteLineInnerPack | null;
  features: Record<string, boolean>;
  save_as_master?: boolean;
}

interface LineSpecBuilderProps {
  value: LineSpecValue;
  onChange: (next: LineSpecValue) => void;
  catalogAddons?: BomAddon[];
  /** Set of paths (e.g. "width_mm", "layers[1].micron", "adhesive.gsm", "features.has_zipper") flagged as MODIFIED. */
  modifiedPaths?: Set<string>;
}

function dotIfModified(
  modifiedPaths: Set<string> | undefined,
  path: string,
): boolean {
  return Boolean(modifiedPaths?.has(path));
}

function ModChip({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center h-4 px-1 rounded text-[8px] font-extrabold uppercase tracking-widest bg-warning-bg text-warning-fg ring-1 ring-warning-border">
      mod
    </span>
  );
}

function FieldLabel({
  children,
  modified,
}: {
  children: React.ReactNode;
  modified?: boolean;
}) {
  return (
    <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3 inline-flex items-center gap-1.5">
      {children}
      <ModChip active={Boolean(modified)} />
    </span>
  );
}

export default function LineSpecBuilder({
  value,
  onChange,
  catalogAddons = [],
  modifiedPaths,
}: LineSpecBuilderProps) {
  const layers = value.layers || [];
  const addons = value.addons || [];
  const adhesiveEnabled = layers.length > 1;
  const inkEnabled = Boolean(value.print_capable);

  const totalMicron = useMemo(
    () => layers.reduce((s, l) => s + (Number(l.micron) || 0), 0),
    [layers],
  );
  const totalGsm = useMemo(() => {
    const filmGsm = layers.reduce((s, l) => s + (Number(l.gsm) || 0), 0);
    return (
      filmGsm +
      (adhesiveEnabled ? Number(value.adhesive?.gsm || 0) : 0) +
      (inkEnabled ? Number(value.ink?.gsm || 0) : 0)
    );
  }, [adhesiveEnabled, inkEnabled, layers, value.adhesive?.gsm, value.ink?.gsm]);

  const childWebMm = useMemo(() => {
    const w = Number(value.width_mm) || 0;
    const g = Number(value.gusset_mm) || 0;
    return w + g;
  }, [value.width_mm, value.gusset_mm]);

  const updateLayer = (idx: number, patch: Partial<BomLayer>) => {
    const next = layers.map((l, i) => {
      if (i !== idx) return l;
      const merged: BomLayer = { ...l, ...patch };
      const density = patch.density_gcm3 ?? merged.density_gcm3;
      const micron = patch.micron ?? merged.micron;
      if (
        ("micron" in patch ||
          "density_gcm3" in patch ||
          "material_id" in patch) &&
        density &&
        micron
      ) {
        merged.gsm = Number((Number(micron) * Number(density)).toFixed(2));
      }
      return merged;
    });
    onChange({ ...value, layers: next });
  };

  const formatToken = (raw?: string | null, fallback = "Not set") => {
    const value = String(raw || "").trim();
    if (!value) return fallback;
    return value.replace(/_/g, " ").replace(/\s+/g, " ").toUpperCase();
  };

  const selectedSize =
    value.size_label ||
    value.base_size_label ||
    (value.origin === "CATALOG" ? "Pick a saved size" : "Ad-hoc size");
  const selectedStyle = formatToken(value.pouch_style_code, "Pouch style pending");
  const childTarget = Number(value.child_target_width_mm || 0);
  const filmArea = Number(value.film_area_width_mm || 0);

  return (
    <div className="space-y-4">
      {/* Section 1 — Pouch style + geometry */}
      <SectionCard
        icon={<Ruler className="h-4 w-4 text-order-fg" />}
        title="Pouch style & size geometry"
        accent="from-order-bg to-white"
      >
        <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2">
          <InfoPill label="Size" value={selectedSize} />
          <InfoPill label="Pouch style" value={selectedStyle} />
          <InfoPill
            label="Stock form"
            value={formatToken(value.stock_form, "From Product Master")}
          />
          <InfoPill
            label="Roll axis"
            value={formatToken(value.pouch_style_roll_axis, "Policy")}
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(
            [
              ["Finished width (mm)", "width_mm"],
              ["Finished height (mm)", "height_mm"],
              ["Gusset (mm)", "gusset_mm"],
              ["Flap / tape (mm)", "flap_mm"],
            ] as Array<[string, keyof LineSpecValue]>
          ).map(([label, key]) => {
            const isMod = dotIfModified(modifiedPaths, String(key));
            return (
              <label key={String(key)} className="block">
                <FieldLabel modified={isMod}>{label}</FieldLabel>
                <input
                  type="number"
                  value={Number(value[key] as number) || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: Number(e.target.value),
                    } as LineSpecValue)
                  }
                  className={cn(
                    "mt-1 h-10 w-full rounded-lg border px-3 text-sm font-bold font-mono text-right outline-none focus:ring-2 focus:ring-order-border",
                    isMod
                      ? "border-warning-border focus:border-warning-border bg-warning-bg"
                      : "border-line focus:border-order-border",
                  )}
                />
              </label>
            );
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-2 text-[11px] font-bold text-content-3">
          {childTarget || childWebMm ? (
            <span>
              Child web ≈{" "}
              <span className="font-mono font-extrabold text-content-2">
                {(childTarget || childWebMm).toFixed(0)} mm
              </span>
            </span>
          ) : (
            <span>Child web calculates after size.</span>
          )}
          {filmArea > 0 ? (
            <span>
              Film area width{" "}
              <span className="font-mono font-extrabold text-content-2">
                {filmArea.toFixed(0)} mm
              </span>
            </span>
          ) : null}
          {value.width_basis ? (
            <span>
              Width basis{" "}
              <span className="font-mono font-extrabold text-content-2">
                {formatToken(value.width_basis)}
              </span>
            </span>
          ) : null}
        </div>
      </SectionCard>

      {/* Section 2 — Film BOM */}
      <SectionCard
        icon={<Layers3 className="h-4 w-4 text-order-fg" />}
        title="Film bill of materials"
        accent="from-order-bg to-white"
        action={
          <button
            onClick={() =>
              onChange({
                ...value,
                layers: [
                  ...layers,
                  {
                    position: `L${layers.length + 1}`,
                    material_name: "",
                    micron: 0,
                    gsm: 0,
                    rate_per_kg: 0,
                  },
                ],
              })
            }
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-order-bg text-order-fg ring-1 ring-order-border text-[11px] font-extrabold uppercase tracking-wider hover:bg-order-bg"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            Layer
          </button>
        }
      >
        {layers.length === 0 ? (
          <div className="text-[11px] font-bold text-content-4">
            No layers. Use “Layer” to start the stack.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[36px_1fr_80px_88px_auto] gap-2 px-1 text-[9px] font-extrabold uppercase tracking-widest text-content-4">
              <span>L</span>
              <span>Film material</span>
              <span className="text-right">Thickness</span>
              <span className="text-right">GSM</span>
              <span />
            </div>
            {layers.map((l, idx) => {
              const isMatMod = dotIfModified(
                modifiedPaths,
                `layers[${idx}].material`,
              );
              const isMuMod = dotIfModified(
                modifiedPaths,
                `layers[${idx}].micron`,
              );
              const isGsmMod = dotIfModified(
                modifiedPaths,
                `layers[${idx}].gsm`,
              );
              return (
                <div
                  key={idx}
                  className="grid grid-cols-[36px_1fr_80px_88px_auto] gap-2 items-center"
                >
                  <span className="inline-flex items-center justify-center h-7 w-9 rounded-md bg-order-bg text-order-fg text-[10px] font-extrabold uppercase tracking-widest">
                    {l.position || `L${idx + 1}`}
                  </span>
                  <div className="min-w-0">
                    <MaterialPicker
                      categories={["FILM_FAMILY", "FILM_VARIANT"]}
                      value={{
                        id: l.material_id || undefined,
                        code: l.material_code,
                        name: l.material_name || l.material_code,
                      }}
                      placeholder="Pick film…"
                      compact
                      onSelect={(m) =>
                        updateLayer(idx, {
                          material_id: m.id,
                          material_code: m.code,
                          material_name: m.name,
                          density_gcm3: m.density_gcm3 || null,
                          rate_per_kg: m.avg_cost || l.rate_per_kg,
                        })
                      }
                    />
                    <div className="mt-0.5 flex items-center gap-1 text-[9px] font-bold text-content-4 font-mono">
                      {isMatMod ? <ModChip active /> : null}
                      {l.material_code ? <span>{l.material_code}</span> : null}
                      {l.density_gcm3 ? (
                        <span>· ρ {l.density_gcm3}</span>
                      ) : null}
                    </div>
                  </div>
                  <input
                    type="number"
                    placeholder="µ"
                    value={Number(l.micron) || ""}
                    onChange={(e) =>
                      updateLayer(idx, { micron: Number(e.target.value) })
                    }
                    className={cn(
                      "h-9 rounded-lg border px-2 text-sm font-bold font-mono text-right outline-none focus:ring-2 focus:ring-order-border",
                      isMuMod
                        ? "border-warning-border bg-warning-bg"
                        : "border-line focus:border-order-border",
                    )}
                  />
                  <div
                    className={cn(
                      "h-9 rounded-lg border px-2 text-right flex flex-col justify-center",
                      isGsmMod
                        ? "border-warning-border bg-warning-bg"
                        : "border-line bg-surface-2",
                    )}
                  >
                    <span className="text-[8px] font-extrabold uppercase tracking-widest text-content-4">
                      GSM auto
                    </span>
                    <span className="font-mono text-xs font-extrabold text-content-1">
                      {(Number(l.gsm) || 0).toFixed(2)}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      onChange({
                        ...value,
                        layers: layers.filter((_, i) => i !== idx),
                      })
                    }
                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-content-4 hover:text-danger-fg hover:bg-danger-bg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 pt-3 border-t border-line grid grid-cols-3 gap-3 text-center">
          <Totals label="Total µ" value={totalMicron.toFixed(0)} />
          <Totals label="Total GSM" value={totalGsm.toFixed(2)} />
          <Totals label="Layers" value={String(layers.length)} />
        </div>
      </SectionCard>

      {/* Section 3 — Adhesive + Ink */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {adhesiveEnabled ? (
          <SectionCard
            icon={<Droplets className="h-4 w-4 text-info-fg" />}
            title="Adhesive · manual GSM"
            accent="from-info-bg to-surface-1"
          >
            <div className="mb-2 text-[11px] font-semibold text-content-3">
              Shown because this stack has more than one film layer. Enter GSM
              from the cost sheet; material rate can be corrected for the quote.
            </div>
            <MaterialPicker
              categories={["ADHESIVE", "SOLVENT"]}
              value={{
                id: value.adhesive?.material_id || undefined,
                code: value.adhesive?.code,
                name: value.adhesive?.name || "Pick adhesive",
              }}
              placeholder="Pick adhesive…"
              compact
              onSelect={(m) =>
                onChange({
                  ...value,
                  adhesive: {
                    ...value.adhesive,
                    material_id: m.id,
                    code: m.code,
                    name: m.name,
                    rate_per_kg: m.avg_cost || value.adhesive.rate_per_kg,
                  },
                })
              }
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <FieldLabel
                  modified={dotIfModified(modifiedPaths, "adhesive.gsm")}
                >
                  GSM
                </FieldLabel>
                <input
                  type="number"
                  value={Number(value.adhesive.gsm) || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      adhesive: {
                        ...value.adhesive,
                        gsm: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
              <label className="block">
                <FieldLabel
                  modified={dotIfModified(modifiedPaths, "adhesive.rate")}
                >
                  ₹/kg
                </FieldLabel>
                <input
                  type="number"
                  value={Number(value.adhesive.rate_per_kg) || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      adhesive: {
                        ...value.adhesive,
                        rate_per_kg: Number(e.target.value),
                      },
                    })
                  }
                  className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
              </label>
            </div>
          </SectionCard>
        ) : (
          <SectionCard
            icon={<Droplets className="h-4 w-4 text-content-4" />}
            title="Adhesive"
            accent="from-surface-2 to-surface-1"
          >
            <div className="text-[11px] font-bold text-content-4">
              Hidden for single-layer stacks. Adhesive costing starts only when
              the film stack has two or more layers.
            </div>
          </SectionCard>
        )}

        {inkEnabled ? (
          <SectionCard
            icon={<Paintbrush className="h-4 w-4 text-danger-fg" />}
            title="Ink · artwork or manual GSM"
            accent="from-danger-bg to-white"
          >
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex h-6 items-center rounded-full bg-danger-bg px-2 text-[10px] font-extrabold uppercase tracking-widest text-danger-fg ring-1 ring-danger-border">
              Manual GSM
            </span>
            <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-[10px] font-extrabold uppercase tracking-widest text-content-3 ring-1 ring-line">
              No artwork assignment needed for quote costing
            </span>
          </div>
          <MaterialPicker
            categories={["INK"]}
            value={{
              id: value.ink?.material_id || undefined,
              code: value.ink?.code,
              name: value.ink?.name || "Pick ink",
            }}
            placeholder="Pick ink…"
            compact
            onSelect={(m) =>
              onChange({
                ...value,
                ink: {
                  ...value.ink,
                  material_id: m.id,
                  code: m.code,
                  name: m.name,
                  rate_per_kg: m.avg_cost || value.ink.rate_per_kg,
                },
              })
            }
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <FieldLabel modified={dotIfModified(modifiedPaths, "ink.gsm")}>
                GSM
              </FieldLabel>
              <input
                type="number"
                value={Number(value.ink.gsm) || ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    ink: { ...value.ink, gsm: Number(e.target.value) },
                  })
                }
                className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
              />
            </label>
            <label className="block">
              <FieldLabel modified={dotIfModified(modifiedPaths, "ink.rate")}>
                ₹/kg
              </FieldLabel>
              <input
                type="number"
                value={Number(value.ink.rate_per_kg) || ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    ink: {
                      ...value.ink,
                      rate_per_kg: Number(e.target.value),
                    },
                  })
                }
                className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
              />
            </label>
          </div>
          </SectionCard>
        ) : (
          <SectionCard
            icon={<Paintbrush className="h-4 w-4 text-content-4" />}
            title="Ink"
            accent="from-surface-2 to-surface-1"
          >
            <div className="text-[11px] font-bold text-content-4">
              {value.origin === "AD_HOC"
                ? "Printing is off for this ad-hoc quote line. Enable it only when this new pouch should be quoted with artwork/print costing."
                : "Hidden because the selected Product Master is not print-capable. Pick a print-capable master to enter manual ink GSM for quotation costing."}
            </div>
            {value.origin === "AD_HOC" ? (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    print_capable: true,
                    artwork_required: true,
                  })
                }
                className="mt-3 h-8 px-3 rounded-lg bg-danger-bg text-[11px] font-extrabold uppercase tracking-widest text-danger-fg ring-1 ring-danger-border hover:bg-danger-bg"
              >
                Enable print costing
              </button>
            ) : null}
          </SectionCard>
        )}
      </div>

      {/* Section 4 — Addons */}
      <SectionCard
        icon={<Sparkles className="h-4 w-4 text-warning-fg" />}
        title="Addons"
        accent="from-warning-bg to-white"
        action={
          <div className="flex flex-wrap gap-1">
            {catalogAddons.map((qa) => (
              <button
                key={`${qa.material_id || qa.code || qa.name}-${qa.qty_per_pouch}`}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    addons: [
                      ...addons,
                      {
                        material_id: qa.material_id || undefined,
                        code: qa.code,
                        name: qa.name,
                        qty_per_pouch: Number(qa.qty_per_pouch || 1),
                        rate_per_kg: Number(qa.rate_per_kg || 0),
                      },
                    ],
                  })
                }
                className="h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-warning-bg text-warning-fg ring-1 ring-warning-border hover:bg-warning-bg"
              >
                + {qa.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  addons: [
                    ...addons,
                    { name: "", qty_per_pouch: 1, rate_per_kg: 0 },
                  ],
                })
              }
              className="h-6 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-surface-1 text-content-2 ring-1 ring-line hover:bg-surface-2"
            >
              + add row
            </button>
          </div>
        }
      >
        {addons.length === 0 ? (
          <div className="text-[11px] font-bold text-content-4">
            No add-ons selected. Use Product Master add-ons above or add a real
            material row.
          </div>
        ) : (
          <div className="space-y-2">
            {addons.map((a, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_70px_90px_auto] gap-2 items-center"
              >
                <MaterialPicker
                  categories={["ADDON"]}
                  value={{
                    id: a.material_id || undefined,
                    code: a.code,
                    name: a.name,
                  }}
                  placeholder="Pick addon…"
                  compact
                  onSelect={(m) =>
                    onChange({
                      ...value,
                      addons: addons.map((x, i) =>
                        i === idx
                          ? {
                              ...x,
                              material_id: m.id,
                              code: m.code,
                              name: m.name,
                              rate_per_kg: m.avg_cost || x.rate_per_kg,
                            }
                          : x,
                      ),
                    })
                  }
                />
                <input
                  type="number"
                  placeholder="qty/pouch"
                  value={Number(a.qty_per_pouch) || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      addons: addons.map((x, i) =>
                        i === idx
                          ? { ...x, qty_per_pouch: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                  className="h-9 rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
                <input
                  type="number"
                  placeholder="₹/unit"
                  value={Number(a.rate_per_kg) || ""}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      addons: addons.map((x, i) =>
                        i === idx
                          ? { ...x, rate_per_kg: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                  className="h-9 rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                />
                <button
                  onClick={() =>
                    onChange({
                      ...value,
                      addons: addons.filter((_, i) => i !== idx),
                    })
                  }
                  className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-content-4 hover:text-danger-fg hover:bg-danger-bg"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Section 5 — Optional packing */}
      <SectionCard
        icon={<PackageCheck className="h-4 w-4 text-success-fg" />}
        title="Optional inner packing"
        accent="from-success-bg to-white"
        action={
          value.optional_inner_pack ? (
            <button
              type="button"
              onClick={() => onChange({ ...value, optional_inner_pack: null })}
              className="h-7 px-2 rounded-lg text-[11px] font-extrabold uppercase tracking-wider text-danger-fg hover:bg-danger-bg"
            >
              Clear
            </button>
          ) : null
        }
      >
        <div className="text-[11px] font-semibold text-content-3 mb-3">
          Quotes can be sent without inner packing. Select it only when the
          customer asks for a pack format or the cost sheet should carry a pack
          assumption.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_130px_120px] gap-2 items-end">
          <div>
            <FieldLabel>Inner pack material</FieldLabel>
            <div className="mt-1">
              <MaterialPicker
                categories={["PACKAGING"]}
                value={{
                  id: value.optional_inner_pack?.material_id || undefined,
                  code: value.optional_inner_pack?.code,
                  name:
                    value.optional_inner_pack?.name ||
                    "No inner packing selected",
                }}
                placeholder="Optional packing item…"
                compact
                onSelect={(m) =>
                  onChange({
                    ...value,
                    optional_inner_pack: {
                      ...(value.optional_inner_pack || {}),
                      material_id: m.id,
                      code: m.code,
                      name: m.name,
                      rate_per_kg:
                        m.avg_cost || value.optional_inner_pack?.rate_per_kg,
                      optional: true,
                    },
                  })
                }
              />
            </div>
          </div>
          <label className="block">
            <FieldLabel>PCS / inner</FieldLabel>
            <input
              type="number"
              value={Number(value.optional_inner_pack?.pcs_per_inner || 0)}
              onChange={(e) =>
                onChange({
                  ...value,
                  optional_inner_pack: {
                    ...(value.optional_inner_pack || { optional: true }),
                    pcs_per_inner: Number(e.target.value),
                  },
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
              placeholder="optional"
            />
          </label>
          <label className="block">
            <FieldLabel>₹ / kg</FieldLabel>
            <input
              type="number"
              value={Number(value.optional_inner_pack?.rate_per_kg || 0)}
              onChange={(e) =>
                onChange({
                  ...value,
                  optional_inner_pack: {
                    ...(value.optional_inner_pack || { optional: true }),
                    rate_per_kg: Number(e.target.value),
                  },
                })
              }
              className="mt-1 h-9 w-full rounded-lg border border-line px-2 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
              placeholder="optional"
            />
          </label>
        </div>
      </SectionCard>

    </div>
  );
}

/**
 * Build a `QuoteLineSpec` payload for the backend cost-preview from a
 * `LineSpecValue`. Centralized so catalog + ad-hoc serialize identically.
 */
export function lineSpecToBackendSpec(
  v: LineSpecValue,
): QuoteLineSpec & Record<string, unknown> {
  return {
    product_master_id: v.product_master_id,
    product_master_code: v.product_master_code,
    product_master_name: v.product_master_name,
    size_id: v.size_id,
    size_code: v.size_code,
    size_label: v.size_label,
    base_product_master_id: v.base_product_master_id,
    base_product_master_code: v.base_product_master_code,
    base_product_master_name: v.base_product_master_name,
    base_size_id: v.base_size_id,
    base_size_code: v.base_size_code,
    base_size_label: v.base_size_label,
    pouch_style_id: v.pouch_style_id,
    pouch_style_code: v.pouch_style_code,
    pouch_style_roll_axis: v.pouch_style_roll_axis,
    stock_form: v.stock_form,
    width_basis: v.width_basis,
    film_area_width_mm: v.film_area_width_mm,
    print_capable: v.print_capable,
    artwork_required: v.artwork_required,
    child_web_width_mm: v.child_target_width_mm || undefined,
    width_mm: v.width_mm,
    height_mm: v.height_mm,
    gusset_mm: v.gusset_mm,
    flap_mm: v.flap_mm,
    layers: (v.layers || []).map((l) => ({
      material_id: l.material_id || undefined,
      material_code: l.material_code,
      name: l.material_name,
      micron: l.micron,
      gsm: l.gsm,
      rate_per_kg: l.rate_per_kg,
      density_gcm3: l.density_gcm3 || undefined,
    })),
    adhesive_name: (v.layers || []).length > 1 ? v.adhesive?.name : "",
    adhesive_gsm: (v.layers || []).length > 1 ? v.adhesive?.gsm : 0,
    adhesive_rate_per_kg:
      (v.layers || []).length > 1 ? v.adhesive?.rate_per_kg : 0,
    ink_name: v.print_capable ? v.ink?.name : "",
    ink_gsm: v.print_capable ? v.ink?.gsm : 0,
    ink_rate_per_kg: v.print_capable ? v.ink?.rate_per_kg : 0,
    addons: (v.addons || []).map((a) => ({
      material_id: a.material_id || undefined,
      code: a.code,
      name: a.name,
      qty_per_pouch: a.qty_per_pouch,
      rate_per_kg: Number(a.rate_per_kg || 0),
    })),
    optional_inner_pack: v.optional_inner_pack || null,
    features: v.features,
    save_as_master: v.save_as_master,
  };
}

interface SectionCardProps {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

function SectionCard({
  icon,
  title,
  accent,
  children,
  action,
}: SectionCardProps) {
  return (
    <div className="rounded-xl ring-1 ring-line bg-surface-1 overflow-hidden">
      <div
        className={cn(
          "px-3 py-2 border-b border-line flex items-center gap-2 bg-gradient-to-r",
          accent,
        )}
      >
        {icon}
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-content-2">
          {title}
        </span>
        <div className="ml-auto">{action}</div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="text-[9px] font-extrabold uppercase tracking-widest text-content-4">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-extrabold text-content-1">
        {value}
      </div>
    </div>
  );
}

function Totals({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
        {label}
      </div>
      <div className="font-mono text-sm font-extrabold text-content-1">
        {value}
      </div>
    </div>
  );
}
