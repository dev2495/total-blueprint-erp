"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ChevronDown,
  Disc,
  Droplet,
  EyeOff,
  Image as ImageIcon,
  PaintBucket,
  Palette,
  PauseCircle,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type ArtworkAssignmentMode =
  | "APPROVED"
  | "OVERLAY_DEFAULT"
  | "REPLACE"
  | "DEFER";
export type PrintType = "FLEXO" | "ROTO";
export type FilmType = "SHEET" | "TUBING";

export interface ArtworkColorSlot {
  /** 1-based position. */
  index: number;
  name: string;
  hex?: string;
  role?: string;
  pantone?: string;
  ink_base_family?: "POLY" | "PET" | string;
  ink_material_id?: string;
  swatch_source?: "ARTWORK_COLOR" | string;
  /** When true the user has overridden this slot relative to the source artwork. */
  overridden?: boolean;
}

export interface ArtworkColorway {
  id: string;
  name: string;
  family: string;
  /** Cover thumbnail. Optional — falls back to a procedural gradient. */
  thumbnail_url?: string;
  accent_hex?: string;
  is_approved: boolean;
  color_count: number;
  source_artwork?: unknown;
}

export interface ArtworkAssignment {
  artwork_id: string;
  design_family_code: string;
  design_family_name?: string;
  colorway_id?: string;
  colorway_name?: string;
  accent_hex?: string;
  color_count?: number;
  ink_gsm_total?: number;
  /** Stylised preview pulled from artwork master, falls back to procedural. */
  cover_url?: string;
  /** Front face colors. */
  front_colors: ArtworkColorSlot[];
  /** Optional back face colors (TUBING film only). */
  back_colors?: ArtworkColorSlot[];
  cylinder_required?: boolean;
  cylinder_ready?: boolean;
  artwork_approved?: boolean;
  print_type?: PrintType | string;
  film_type?: FilmType | string;
  substrate_mode?: FilmType | string;
}

interface ArtworkSectionProps {
  /** Current chosen mode. */
  mode: ArtworkAssignmentMode;
  onModeChange: (mode: ArtworkAssignmentMode) => void;
  printType: PrintType;
  onPrintTypeChange?: (next: PrintType) => void;
  filmType: FilmType;
  onFilmTypeChange?: (next: FilmType) => void;
  assignment?: ArtworkAssignment;
  /** When the user opens the colorway/artwork picker. */
  onPickArtwork?: () => void;
  onReplaceColor?: (slot: ArtworkColorSlot) => void;
  /** Approved artworks bound to this product master (for the inline strip). */
  options?: ArtworkColorway[];
  onSelectColorway?: (colorway: ArtworkColorway) => void;
  overlayDefault?: {
    id: string;
    label: string;
    thumbnail_url?: string;
    accent_hex?: string;
  };
  inkBaseFamily?: "POLY" | "PET";
  filterSummary?: string;
  /** Called when the user toggles the Defer banner. */
  deferReason?: string;
  /** Disable section entirely (e.g. route has no artwork step). */
  disabled?: boolean;
  className?: string;
}

const MODE_CARDS: Array<{
  id: ArtworkAssignmentMode;
  label: string;
  icon: React.ReactNode;
  helper: string;
  accent: string;
}> = [
  {
    id: "APPROVED",
    label: "Pick approved artwork",
    icon: <CheckCircle2 className="h-4 w-4" />,
    helper: "Select an approved design matching print type and sheet/tube.",
    accent: "border-success-border bg-success-bg text-success-fg",
  },
  {
    id: "OVERLAY_DEFAULT",
    label: "Use customer overlay",
    icon: <Sparkles className="h-4 w-4" />,
    helper: "Apply the artwork stored on this customer item overlay.",
    accent: "border-info-border bg-info-bg text-primary",
  },
  {
    id: "DEFER",
    label: "Defer to planner",
    icon: <PauseCircle className="h-4 w-4" />,
    helper: "Planner must assign approved artwork before release.",
    accent: "border-warning-border bg-warning-bg text-warning-fg",
  },
];

export function ArtworkSection({
  mode,
  onModeChange,
  printType,
  filmType,
  assignment,
  onPickArtwork,
  onReplaceColor,
  options = [],
  onSelectColorway,
  overlayDefault,
  inkBaseFamily,
  filterSummary,
  deferReason,
  disabled,
  className,
}: ArtworkSectionProps) {
  const effectivePrintType = String(
    assignment?.print_type || printType || "",
  ).toUpperCase();
  const effectiveFilmType = String(
    assignment?.substrate_mode || assignment?.film_type || filmType || "",
  ).toUpperCase();
  const cylinderRequired =
    assignment?.cylinder_required ?? effectivePrintType === "ROTO";

  if (disabled) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-line bg-surface-2 px-5 py-6 text-center",
          className,
        )}
      >
        <EyeOff className="mx-auto h-5 w-5 text-content-4" />
        <div className="mt-2 text-sm font-bold text-content-2">
          No artwork step on this route
        </div>
        <p className="text-xs text-content-3">
          Artwork section is disabled for this product master / template.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {cylinderRequired ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-order-bg px-2.5 py-1 text-[11px] font-bold text-order-fg ring-1 ring-order-border">
            <Disc className="h-3.5 w-3.5" />
            Artwork cylinder required
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-[11px] font-bold text-success-fg ring-1 ring-success-border">
            <CheckCircle2 className="h-3.5 w-3.5" />
            FLEXO / non-ROTO · no cylinder required
          </span>
        )}
        {assignment ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-content-2 ring-1 ring-line">
            {effectivePrintType || "PRINT"} ·{" "}
            {effectiveFilmType || "FORM FROM ARTWORK"}
          </span>
        ) : null}
        {inkBaseFamily ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-order-bg px-2.5 py-1 text-[11px] font-bold text-order-fg ring-1 ring-order-border">
            Ink family · {inkBaseFamily}
          </span>
        ) : null}
        {filterSummary ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-bold text-content-3 ring-1 ring-line">
            {filterSummary}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {MODE_CARDS.map((m) => {
          const active = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onModeChange(m.id)}
              className={cn(
                "flex items-start gap-2 rounded-xl border bg-surface-1 px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                active
                  ? "border-primary ring-2 ring-info-border"
                  : "border-line hover:border-line-strong",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md ring-1 ring-inset",
                  active ? "bg-primary text-white ring-primary" : m.accent,
                )}
              >
                {m.icon}
              </span>
              <div>
                <div className="text-sm font-bold text-content-1">
                  {m.label}
                </div>
                <div className="text-[11px] leading-4 text-content-3">
                  {m.helper}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {mode === "DEFER" ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-warning-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
          <div className="text-xs">
            <div className="font-bold">
              Planner must assign approved artwork before release.
            </div>
            <div className="mt-0.5 text-[11px]">
              {deferReason ||
                "Order can be created without an artwork. Print release will be blocked until approved artwork is assigned; cylinders are checked only for ROTO."}
            </div>
          </div>
        </div>
      ) : null}

      {mode === "OVERLAY_DEFAULT" ? (
        <OverlayDefaultPanel
          overlayDefault={overlayDefault}
          onPickArtwork={onPickArtwork}
          onSwitchToApproved={() => onModeChange("APPROVED")}
        />
      ) : null}

      {mode === "APPROVED" || mode === "REPLACE" ? (
        <ArtworkPickerPanel
          options={options}
          assignment={assignment}
          onSelectColorway={onSelectColorway}
          onPickArtwork={onPickArtwork}
          showReplaceCta={false}
        />
      ) : null}

      {assignment ? (
        <ArtworkPreviewPanel
          assignment={assignment}
          filmType={(effectiveFilmType || filmType) as FilmType}
          cylinderRequired={cylinderRequired}
          canReplace={false}
          onReplaceColor={onReplaceColor}
          onPickArtwork={onPickArtwork}
        />
      ) : null}
    </div>
  );
}

function OverlayDefaultPanel({
  overlayDefault,
  onPickArtwork,
  onSwitchToApproved,
}: {
  overlayDefault?: ArtworkSectionProps["overlayDefault"];
  onPickArtwork?: () => void;
  onSwitchToApproved: () => void;
}) {
  if (!overlayDefault) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-info-border bg-info-bg px-4 py-3 text-primary">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
        <div className="text-xs">
          <div className="font-bold">No overlay default for this customer</div>
          <div className="mt-0.5 text-[11px]">
            Pick an approved artwork instead.
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onSwitchToApproved}
              className="rounded-full bg-surface-1 px-3 py-1 text-[11px] font-bold text-primary ring-1 ring-info-border hover:bg-info-bg"
            >
              Pick approved artwork
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-xl border border-info-border bg-gradient-to-r from-info-bg via-white to-order-bg px-4 py-3">
      <ArtworkThumb
        url={overlayDefault.thumbnail_url}
        accent={overlayDefault.accent_hex}
        size={56}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
          Customer overlay default
        </div>
        <div className="truncate text-sm font-bold text-content-1">
          {overlayDefault.label}
        </div>
      </div>
      <button
        type="button"
        onClick={onPickArtwork}
        className="inline-flex items-center gap-1 rounded-full bg-surface-1 px-3 py-1.5 text-xs font-bold text-primary ring-1 ring-info-border hover:bg-info-bg"
      >
        <Search className="h-3 w-3" /> Browse other approved
      </button>
    </div>
  );
}

function ArtworkPickerPanel({
  options,
  assignment,
  onSelectColorway,
  onPickArtwork,
  showReplaceCta,
}: {
  options: ArtworkColorway[];
  assignment?: ArtworkAssignment;
  onSelectColorway?: (cw: ArtworkColorway) => void;
  onPickArtwork?: () => void;
  showReplaceCta?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const selected = options.find((cw) => assignment?.colorway_id === cw.id);
  const filteredOptions = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((cw) =>
      `${cw.name} ${cw.family}`.toLowerCase().includes(normalized),
    );
  }, [options, query]);

  if (!options.length) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
        <div className="flex items-center gap-3">
          <ImageIcon className="h-4 w-4 text-content-4" />
          <div>
            <div className="text-sm font-bold text-content-1">
              Pick an approved artwork
            </div>
            <div className="text-[11px] text-content-3">
              Browse design families and colorways bound to this master.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onPickArtwork}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary"
        >
          <Search className="h-3 w-3" /> Open library
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {selected ? (
            <ArtworkThumb
              url={selected.thumbnail_url}
              accent={selected.accent_hex}
              size={48}
            />
          ) : (
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-lg border border-dashed border-line bg-surface-2">
              <ImageIcon className="h-4 w-4 text-content-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
              Approved artwork
            </div>
            <div className="truncate text-sm font-bold text-content-1">
              {selected?.name || assignment?.colorway_name || "Not selected"}
            </div>
            <div className="truncate text-[11px] text-content-3">
              {selected?.family ||
                assignment?.design_family_name ||
                `${options.length} approved option${options.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white hover:bg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            <Search className="h-3.5 w-3.5" />
            {selected || assignment ? "Change artwork" : "Choose artwork"}
          </button>
          {onPickArtwork ? (
            <button
              type="button"
              onClick={onPickArtwork}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs font-bold text-content-2 hover:border-line-strong"
            >
              Manage library
            </button>
          ) : null}
        </div>
      </div>
      <Dialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setQuery("");
        }}
      >
        <DialogContent
          data-testid="sales-order-artwork-picker"
          className="flex h-[min(78vh,720px)] max-h-[78vh] max-w-3xl flex-col overflow-hidden p-0"
        >
          <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-12">
            <DialogTitle>Choose approved artwork</DialogTitle>
            <DialogDescription>
              Select one approved artwork for this print type and film form.
            </DialogDescription>
            <div className="relative pt-2">
              <Search className="absolute left-3 top-[18px] h-4 w-4 text-content-4" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search artwork or design family"
                className="pl-9"
                aria-label="Search approved artwork"
              />
            </div>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 px-5 pb-5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filteredOptions.map((cw) => {
                const active = assignment?.colorway_id === cw.id;
                return (
                  <button
                    key={cw.id}
                    type="button"
                    onClick={() => {
                      onSelectColorway?.(cw);
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex min-w-0 items-center gap-3 rounded-xl border bg-surface-1 p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                      active
                        ? "border-primary bg-info-bg ring-1 ring-info-border"
                        : "border-line hover:border-line-strong",
                    )}
                  >
                    <ArtworkThumb
                      url={cw.thumbnail_url}
                      accent={cw.accent_hex}
                      size={56}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-content-1">
                        {cw.name}
                      </div>
                      <div className="truncate text-[11px] text-content-3">
                        {cw.family}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold text-content-3">
                        {cw.color_count} colors · Approved
                      </div>
                    </div>
                    {active ? (
                      <CheckCircle2 className="h-4 w-4 flex-none text-primary" />
                    ) : null}
                  </button>
                );
              })}
            </div>
            {filteredOptions.length === 0 ? (
              <div className="py-16 text-center text-sm text-content-3">
                No approved artwork matches this search.
              </div>
            ) : null}
          </ScrollArea>
          <div className="shrink-0 border-t border-line bg-surface-2 px-5 py-3 text-[11px] text-content-3">
            {filteredOptions.length} of {options.length} approved artworks shown
          </div>
        </DialogContent>
      </Dialog>
      {showReplaceCta ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onPickArtwork}
            className="inline-flex items-center gap-1.5 rounded-full bg-order-bg px-3 py-1.5 text-[11px] font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
          >
            <Wand2 className="h-3 w-3" /> Replace entire artwork
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ArtworkPreviewPanel({
  assignment,
  filmType,
  cylinderRequired,
  canReplace,
  onReplaceColor,
  onPickArtwork,
}: {
  assignment: ArtworkAssignment;
  filmType: FilmType;
  cylinderRequired: boolean;
  canReplace?: boolean;
  onReplaceColor?: (slot: ArtworkColorSlot) => void;
  onPickArtwork?: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface-1">
      <div className="flex flex-wrap items-start gap-4 border-b border-line px-4 py-3">
        <ArtworkThumb
          url={assignment.cover_url}
          accent={assignment.accent_hex}
          size={88}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
            Selected artwork
          </div>
          <div className="truncate text-base font-bold text-content-1">
            {assignment.colorway_name ||
              assignment.design_family_name ||
              assignment.artwork_id}
          </div>
          <div className="truncate text-xs text-content-3">
            {assignment.design_family_code}
            {assignment.colorway_id ? ` · ${assignment.colorway_id}` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {assignment.artwork_approved ? (
              <Pill tone="emerald" icon={<CheckCircle2 className="h-3 w-3" />}>
                Artwork approved
              </Pill>
            ) : (
              <Pill tone="amber" icon={<AlertTriangle className="h-3 w-3" />}>
                Approval pending
              </Pill>
            )}
            {cylinderRequired ? (
              assignment.cylinder_ready ? (
                <Pill tone="emerald" icon={<Disc className="h-3 w-3" />}>
                  Cylinder ready
                </Pill>
              ) : (
                <Pill tone="rose" icon={<Disc className="h-3 w-3" />}>
                  Cylinder pending
                </Pill>
              )
            ) : null}
            <Pill tone="slate" icon={<Palette className="h-3 w-3" />}>
              {assignment.front_colors.length} front
              {assignment.back_colors?.length
                ? ` + ${assignment.back_colors.length} back`
                : ""}
            </Pill>
          </div>
        </div>
        {canReplace ? (
          <button
            type="button"
            onClick={onPickArtwork}
            className="inline-flex items-center gap-1.5 rounded-full bg-order-fg px-3 py-1.5 text-xs font-bold text-white hover:bg-order-fg"
          >
            <ArrowLeftRight className="h-3 w-3" /> Replace artwork
          </button>
        ) : null}
      </div>

      <ColorSlots
        title={`Front face (${assignment.front_colors.length})`}
        slots={assignment.front_colors}
        canReplace={canReplace}
        onReplace={onReplaceColor}
      />
      {filmType === "TUBING" && assignment.back_colors?.length ? (
        <ColorSlots
          title={`Back face (${assignment.back_colors.length})`}
          slots={assignment.back_colors}
          canReplace={canReplace}
          onReplace={onReplaceColor}
        />
      ) : null}
    </div>
  );
}

function ColorSlots({
  title,
  slots,
  canReplace,
  onReplace,
}: {
  title: string;
  slots: ArtworkColorSlot[];
  canReplace?: boolean;
  onReplace?: (slot: ArtworkColorSlot) => void;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.22em] text-content-3 hover:bg-surface-2"
      >
        {title}
        <ChevronDown
          className={cn("h-4 w-4 transition", open ? "rotate-0" : "-rotate-90")}
        />
      </button>
      {open ? (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4">
          {slots.map((s) => (
            <ColorSlot
              key={`${title}-${s.index}`}
              slot={s}
              canReplace={canReplace}
              onReplace={onReplace}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ColorSlot({
  slot,
  canReplace,
  onReplace,
}: {
  slot: ArtworkColorSlot;
  canReplace?: boolean;
  onReplace?: (slot: ArtworkColorSlot) => void;
}) {
  const colorName = String(slot.name || "").trim();
  const pantone = String(slot.pantone || "").trim();
  const missingName = !colorName && !pantone;
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border bg-surface-1 px-3 py-2 transition",
        missingName
          ? "border-danger-border bg-danger-bg"
          : slot.overridden
            ? "border-order-border ring-1 ring-order-border"
            : "border-line",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 flex-none items-center justify-center rounded-lg border text-[11px] font-black",
          missingName
            ? "border-danger-border bg-danger-bg text-danger-fg"
            : "border-line bg-surface-2 text-content-2",
        )}
      >
        C{slot.index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-bold text-content-1">
          {colorName || pantone || "Color name missing"}
        </div>
        <div className="truncate text-[10px] font-medium text-content-3">
          {pantone || "Artwork color text"}
          {slot.role ? ` · ${slot.role}` : ""}
        </div>
      </div>
      {canReplace ? (
        <button
          type="button"
          onClick={() => onReplace?.(slot)}
          className="rounded-full bg-surface-2 p-1.5 text-content-3 transition hover:bg-order-bg hover:text-order-fg"
          title="Replace this color"
        >
          <PaintBucket className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function ArtworkThumb({
  url,
  accent = "#4338ca",
  size = 64,
}: {
  url?: string;
  accent?: string;
  size?: number;
}) {
  if (url) {
    return (
      <div
        className="relative overflow-hidden rounded-xl ring-1 ring-line"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${accent} 0%, #fff 100%)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="artwork" className="h-full w-full object-cover" />
      </div>
    );
  }
  return (
    <div
      className="relative flex flex-none items-center justify-center overflow-hidden rounded-xl ring-1 ring-line"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${accent} 0%, #ffffff 60%, ${accent}33 100%)`,
      }}
    >
      <Droplet className="h-5 w-5 text-white drop-shadow" />
    </div>
  );
}

function Pill({
  tone,
  icon,
  children,
}: {
  tone: "emerald" | "amber" | "rose" | "slate" | "blue" | "violet";
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    emerald: "bg-success-bg text-success-fg ring-success-border",
    amber: "bg-warning-bg text-warning-fg ring-warning-border",
    rose: "bg-danger-bg text-danger-fg ring-danger-border",
    slate: "bg-surface-2 text-content-2 ring-line",
    blue: "bg-info-bg text-primary ring-info-border",
    violet: "bg-order-bg text-order-fg ring-order-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
        tones[tone],
      )}
    >
      {icon}
      {children}
    </span>
  );
}
