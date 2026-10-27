"use client";

/**
 * Sales order composer — the lines table.
 *
 * One dense row per order line (product and line label, size in mm and inches, layers with the
 * total gauge, print, quantity, rate, value and a status that names the first thing missing),
 * a totals row, and a keyboard quick-add row: product → size → quantity → rate → Enter.
 * A row opens the full line editor; nothing is edited in the table beyond adding.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Copy, CornerDownLeft, MoreHorizontal, Pencil, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { inchesText } from "@/lib/size-naming";
import { specFromMasterLine } from "@/components/plate/spec-from-master";
import { productMasterService, type ProductMaster } from "@/services/product-master";

import { QUICK_ADD_CHECK, type SalesOrderLine } from "./types";

// One template for the header, every row and the totals so the columns always line up.
const GRID =
  "xl:grid xl:grid-cols-[32px_minmax(150px,1.5fr)_minmax(104px,0.85fr)_minmax(130px,1.15fr)_minmax(90px,0.8fr)_80px_88px_100px_minmax(132px,1.1fr)] xl:items-center xl:gap-x-2.5";

const inr = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;
const qtyText = (value: number, uom: string) =>
  `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: uom === "PCS" ? 0 : 2 })}`;
const trim1 = (value: number) => String(Math.round(value * 10) / 10);

/** What a line still needs, in two or three words (the full sentence stays in the tooltip). */
export function shortIssue(issue: string): string {
  const text = issue.toLowerCase();
  if (text.includes("unavailable")) return "Blocked";
  if (text.includes("product master")) return "Needs product";
  if (text.includes("size")) return "Needs size";
  if (text.includes("quantity")) return "Needs qty";
  if (text.includes("unit price") || text.includes("rate")) return "Needs rate";
  if (text.includes("artwork") || text.includes("ink") || text.includes("cylinder")) return "Needs artwork";
  if (text.includes("open the line")) return "Check the line";
  if (text.includes("preview") || text.includes("bom")) return "Preview down";
  if (text.includes("pack") || text.includes("inner") || text.includes("pouch")) return "Needs packing";
  if (text.includes("add-on") || text.includes("addon")) return "Needs add-on";
  if (text.includes("reason")) return "Needs reason";
  return "Needs a fix";
}

export function lineIssues(line: SalesOrderLine, perLineIssues: Record<string, string[]>): string[] {
  const issues = [...(perLineIssues[line.id] || [])];
  const rate = parseFloat(line.unit_price || "0") || 0;
  if (line.product_master && rate <= 0 && !issues.some((issue) => /unit price|rate/i.test(issue))) issues.push("Set unit price");
  return issues;
}

function LineRow({
  index,
  count,
  line,
  master,
  issues,
  active,
  onOpen,
  onDuplicate,
  onRemove,
  onMove,
}: {
  index: number;
  count: number;
  line: SalesOrderLine;
  master?: ProductMaster;
  issues: string[];
  active: boolean;
  onOpen: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const { data: sizes = [] } = useQuery({
    queryKey: ["product-master-sizes", line.product_master],
    queryFn: () => productMasterService.listSizes(line.product_master),
    enabled: !!line.product_master,
    staleTime: 60_000,
  });
  const size = sizes.find((row) => row.code === line.size_code);
  const spec = master ? specFromMasterLine({ layers: master.layer_template, size, choices: line.layer_values }) : null;
  const layers = (spec?.layers || []).filter((layer) => layer.name);
  const gauge = layers.reduce((sum, layer) => sum + Number(layer.micron || 0), 0);
  const width = Number(size?.width_mm || 0);
  const height = Number(size?.height_mm || 0);
  const gusset = Number(size?.gusset_mm || 0);
  const printCapable = !!master?.fixed_attributes?.print_capable;
  const colours = Number(line.artwork_assignment?.color_count || 0);
  const artwork =
    line.artwork_mode === "DEFER"
      ? { text: "artwork later", tone: "muted" as const }
      : line.artwork_assignment?.design_family_code || line.artwork_assignment?.artwork_id
        ? { text: String(line.artwork_assignment?.design_family_code || "artwork set"), tone: "ok" as const }
        : { text: "pick artwork", tone: "warn" as const };
  const rate = parseFloat(line.unit_price || "0") || 0;
  const value = rate * (Number(line.qty_value) || 0);
  const ready = issues.length === 0;
  const label = line.line_label || line.line_name || "";

  return (
    <div
      role="row"
      tabIndex={0}
      aria-current={active ? "true" : undefined}
      data-testid={`sales-line-row-${index + 1}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        } else if (event.altKey && event.key === "ArrowUp") {
          event.preventDefault();
          onMove(-1);
        } else if (event.altKey && event.key === "ArrowDown") {
          event.preventDefault();
          onMove(1);
        } else if (event.key.toLowerCase() === "d" && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          onDuplicate();
        } else if (event.key === "Delete") {
          event.preventDefault();
          onRemove();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 border-t border-line px-3 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-4",
        GRID,
        active ? "bg-info-bg" : "hover:bg-surface-2",
      )}
    >
      {!ready ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-warning-fg" /> : null}
      <span role="cell" className="hidden h-7 w-7 place-items-center rounded-lg border border-line bg-surface-1 font-mono text-[12px] font-semibold text-content-2 xl:grid">
        {index + 1}
      </span>
      <div role="cell" className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-content-4 xl:hidden">L{index + 1}</span>
          <span className="truncate text-[14px] font-semibold text-content-1" title={master?.name || label}>
            {master?.name || label || "New line"}
          </span>
          {line.customer_product_overlay ? (
            <span className="shrink-0 rounded-md bg-success-bg px-1.5 py-px text-[10.5px] font-semibold text-success-fg">item</span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[11.5px] text-content-3" title={label || undefined}>
          {master?.code || "pick a product"}
          {label ? ` · ${label}` : ""}
        </div>
      </div>
      <div role="cell" className="min-w-0">
        {width ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-[16px] font-bold tracking-[-0.01em] text-content-1">
                {trim1(width)}
                {height ? <span className="px-0.5 text-content-3">×</span> : null}
                {height ? trim1(height) : ""}
                {gusset ? <span className="text-[12px] font-semibold text-content-3"> + {trim1(gusset)} G</span> : null}
              </span>
              <span className="text-[11px] text-content-3">mm</span>
            </div>
            <div className="truncate text-[11.5px] text-content-3">
              {height ? inchesText(width, height) : inchesText(width)}
              {spec?.style ? ` · ${String(spec.style).replaceAll("_", " ").toLowerCase()}` : ""}
            </div>
          </>
        ) : (
          <span className="text-[12.5px] text-content-4">{line.product_master ? "pick a size" : "—"}</span>
        )}
      </div>
      <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1">
        {layers.length ? (
          <>
            {layers.slice(0, 3).map((layer, layerIndex) => (
              <span
                key={`${layer.name}-${layerIndex}`}
                className="inline-flex max-w-[150px] items-center gap-1 truncate rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[11px] text-content-2"
                title={[layer.name, layer.micron ? `${layer.micron}µ` : "", layer.grade].filter(Boolean).join(" · ")}
              >
                <span className="truncate">{layer.name}</span>
                {layer.micron ? <b className="font-semibold text-content-1">{trim1(Number(layer.micron))}</b> : null}
              </span>
            ))}
            {layers.length > 3 ? <span className="text-[11px] text-content-3">+{layers.length - 3}</span> : null}
            {gauge ? <b className="font-mono text-[11.5px] text-content-1">= {trim1(gauge)}µ</b> : null}
          </>
        ) : (
          <span className="text-[12.5px] text-content-4">—</span>
        )}
      </div>
      <div role="cell" className="min-w-0 text-[12.5px]">
        {master ? (
          printCapable ? (
            <>
              <div className="font-semibold text-content-1">
                {line.print_type === "FLEXO" ? "Flexo" : "Roto"}
                {colours ? ` · ${colours}C` : ""}
              </div>
              <div
                className={cn(
                  "truncate text-[11.5px]",
                  artwork.tone === "warn" ? "text-warning-fg" : artwork.tone === "ok" ? "text-content-2" : "text-content-3",
                )}
              >
                {artwork.text}
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-content-2">Plain</div>
              <div className="text-[11.5px] text-content-3">no print step</div>
            </>
          )
        ) : (
          <span className="text-content-4">—</span>
        )}
      </div>
      <div role="cell" className="flex items-baseline gap-1 xl:block xl:text-right">
        <span className="font-mono text-[14px] font-semibold tabular-nums text-content-1">{line.qty_value > 0 ? qtyText(line.qty_value, line.qty_uom) : "—"}</span>
        <span className="text-[11.5px] text-content-3"> {line.qty_uom.toLowerCase()}</span>
      </div>
      <div role="cell" className="flex items-baseline gap-1 xl:block xl:text-right">
        {rate > 0 ? (
          <>
            <span className="font-mono text-[13.5px] font-semibold tabular-nums text-content-1">₹{line.unit_price}</span>
            <span className="text-[11.5px] text-content-3"> /{line.price_basis.toLowerCase()}</span>
          </>
        ) : (
          <span className="text-[12.5px] text-warning-fg">rate —</span>
        )}
      </div>
      <div role="cell" className="font-mono text-[14px] font-semibold tabular-nums text-content-1 xl:text-right">{value > 0 ? inr(value) : "—"}</div>
      <div role="cell" className="flex min-w-0 items-center justify-between gap-1.5">
        <span
          className={cn(
            "inline-flex min-w-0 max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[12px] font-semibold",
            ready ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg",
          )}
          title={issues.join("\n") || "Ready to place"}
          data-testid={`sales-line-status-${index + 1}`}
        >
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span className="truncate">{ready ? "Ready" : shortIssue(issues[0])}</span>
          {issues.length > 1 ? <span className="shrink-0 text-[11px] opacity-80">+{issues.length - 1}</span> : null}
        </span>
        {/* Row actions float over the status on wide screens so the status keeps its full width. */}
        <span className="flex shrink-0 items-center opacity-100 transition-opacity xl:pointer-events-none xl:absolute xl:right-3 xl:top-1/2 xl:-translate-y-1/2 xl:rounded-[10px] xl:border xl:border-line xl:bg-surface-1 xl:p-0.5 xl:opacity-0 xl:shadow-[var(--shadow-sm)] xl:group-hover:pointer-events-auto xl:group-hover:opacity-100 xl:group-focus-within:pointer-events-auto xl:group-focus-within:opacity-100">
          <button
            type="button"
            aria-label={`Edit line ${index + 1}`}
            title="Edit (Enter)"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className="grid h-7 w-7 place-items-center rounded-md text-content-3 hover:bg-surface-1 hover:text-content-1"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More for line ${index + 1}`}
                onClick={(event) => event.stopPropagation()}
                className="grid h-7 w-7 place-items-center rounded-md text-content-3 hover:bg-surface-1 hover:text-content-1"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy className="mr-2 h-3.5 w-3.5" /> Duplicate <span className="ml-auto font-mono text-[11px] text-content-4">D</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
                <ArrowUp className="mr-2 h-3.5 w-3.5" /> Move up <span className="ml-auto font-mono text-[11px] text-content-4">Alt ↑</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
                <ArrowDown className="mr-2 h-3.5 w-3.5" /> Move down <span className="ml-auto font-mono text-[11px] text-content-4">Alt ↓</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-danger-fg focus:text-danger-fg" onSelect={onRemove}>
                <Trash2 className="mr-2 h-3.5 w-3.5" /> Remove <span className="ml-auto font-mono text-[11px] text-content-4">Del</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </div>
  );
}

/** Product → size → quantity → rate → Enter. Shift+Enter (or Editor) opens the full line editor. */
export function QuickAddRow({
  masters,
  disabled,
  onAdd,
}: {
  masters: ProductMaster[];
  disabled?: boolean;
  onAdd: (seed: Partial<SalesOrderLine>, openEditor: boolean) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const [masterId, setMasterId] = React.useState("");
  const [sizeCode, setSizeCode] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [uom, setUom] = React.useState<"KG" | "PCS">("KG");
  const [rate, setRate] = React.useState("");
  const productRef = React.useRef<HTMLInputElement>(null);
  const sizeRef = React.useRef<HTMLSelectElement>(null);
  const qtyRef = React.useRef<HTMLInputElement>(null);
  const master = masters.find((row) => row.id === masterId);
  const { data: sizes = [] } = useQuery({
    queryKey: ["product-master-sizes", masterId],
    queryFn: () => productMasterService.listSizes(masterId),
    enabled: !!masterId,
    staleTime: 60_000,
  });
  const needle = query.trim().toLowerCase();
  const matches = React.useMemo(() => {
    if (!needle) return [];
    return masters.filter((m) => `${m.code} ${m.name} ${(m as any).display_code || ""}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [masters, needle]);
  React.useEffect(() => setHighlight(0), [needle]);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !disabled) {
        event.preventDefault();
        productRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);

  const pick = (row: ProductMaster) => {
    setMasterId(String(row.id));
    setQuery(row.name || row.code);
    setOpen(false);
    const pouch = String(row.fixed_attributes?.fg_type || "").toUpperCase() === "POUCH";
    setUom(pouch ? "PCS" : "KG");
    setSizeCode("");
    window.setTimeout(() => sizeRef.current?.focus(), 30);
  };
  const clear = () => {
    setQuery("");
    setMasterId("");
    setSizeCode("");
    setQty("");
    setRate("");
    window.setTimeout(() => productRef.current?.focus(), 30);
  };
  const ready = !!masterId;
  const needsEditor = !!master && (!!master.fixed_attributes?.print_capable || String(master.fixed_attributes?.fg_type || "").toUpperCase() === "POUCH");
  const submit = (openEditor: boolean) => {
    if (!masterId) return;
    const open = openEditor || !sizeCode || sizeCode === "__new";
    onAdd(
      {
        product_master: masterId,
        size_code: sizeCode === "__new" ? "" : sizeCode,
        qty_value: Number(qty) > 0 ? Number(qty) : 0,
        qty_uom: uom,
        price_basis: uom,
        unit_price: Number(rate) > 0 ? String(rate) : "0.00",
        pre_submit_blockers: needsEditor && !open ? [QUICK_ADD_CHECK] : [],
      },
      open,
    );
    clear();
  };
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && ready) {
      event.preventDefault();
      submit(event.shiftKey);
    }
  };
  const field =
    "h-9 min-w-0 rounded-[10px] border border-line-strong bg-surface-1 px-2.5 text-[13px] text-content-1 outline-none transition focus:border-primary focus:ring-2 focus:ring-info-bg disabled:bg-surface-2 disabled:text-content-4";

  return (
    <div className="border-t border-line bg-surface-2 px-3 py-2.5 sm:px-4" data-testid="sales-quick-add">
      <div className="grid gap-2 lg:grid-cols-[32px_minmax(180px,2fr)_minmax(110px,1fr)_92px_72px_100px_auto_auto] lg:items-center">
        <span className="hidden h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground lg:grid">
          <Plus className="h-4 w-4" aria-hidden />
        </span>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
          <input
            ref={productRef}
            value={query}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
              setMasterId("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((value) => Math.min(value + 1, Math.max(0, matches.length - 1)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((value) => Math.max(0, value - 1));
              } else if (event.key === "Enter" && open && matches[highlight]) {
                event.preventDefault();
                pick(matches[highlight]);
              } else if (event.key === "Enter") {
                onEnter(event);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Add a line: type product code or name"
            aria-label="Find a product to add"
            data-testid="sales-add-line-search"
            className={cn(field, "w-full pl-8 pr-12")}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface-1 px-1 font-mono text-[10.5px] text-content-4 sm:inline">⌘K</kbd>
          {open && matches.length ? (
            <ul
              role="listbox"
              aria-label="Matching products"
              className="absolute left-0 z-40 mt-1 max-h-72 w-full min-w-[320px] overflow-y-auto rounded-[12px] border border-line bg-surface-1 p-1 shadow-[var(--shadow-lg)]"
            >
              {matches.map((row, rowIndex) => (
                <li key={row.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={rowIndex === highlight}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(row)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[9px] px-2.5 py-1.5 text-left",
                      rowIndex === highlight ? "bg-info-bg" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-content-1">{row.name}</span>
                      <span className="block font-mono text-[11.5px] text-content-3">{row.code}</span>
                    </span>
                    <span className="text-[11.5px] text-content-3">
                      {(row.layer_template || []).length} layers · {String(row.product_kind || "").toLowerCase()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <select
          ref={sizeRef}
          value={sizeCode}
          disabled={!masterId}
          onChange={(event) => {
            setSizeCode(event.target.value);
            if (event.target.value) window.setTimeout(() => qtyRef.current?.focus(), 30);
          }}
          onKeyDown={onEnter}
          aria-label="Size for the new line"
          className={cn(field, "cursor-pointer")}
        >
          <option value="">{masterId ? (sizes.length ? "Size" : "No saved sizes") : "Size"}</option>
          {sizes.map((row) => (
            <option key={row.id} value={row.code}>
              {row.code}
              {row.width_mm ? ` · ${inchesText(Number(row.width_mm), Number(row.height_mm || 0) || undefined)}` : ""}
            </option>
          ))}
          {masterId ? <option value="__new">+ New size… (opens the editor)</option> : null}
        </select>
        <input
          ref={qtyRef}
          value={qty}
          disabled={!masterId}
          onChange={(event) => setQty(event.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={onEnter}
          inputMode="decimal"
          placeholder="Qty"
          aria-label="Quantity for the new line"
          className={cn(field, "text-right font-mono")}
        />
        <select
          value={uom}
          disabled={!masterId}
          onChange={(event) => setUom(event.target.value as "KG" | "PCS")}
          aria-label="Unit for the new line"
          className={cn(field, "cursor-pointer")}
        >
          <option value="KG">kg</option>
          <option value="PCS">pcs</option>
        </select>
        <input
          value={rate}
          disabled={!masterId}
          onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ""))}
          onKeyDown={onEnter}
          inputMode="decimal"
          placeholder={`₹ / ${uom.toLowerCase()}`}
          aria-label="Rate for the new line"
          className={cn(field, "text-right font-mono")}
        />
        <Button type="button" size="sm" disabled={!ready} onClick={() => submit(false)} className="h-9 gap-1.5 rounded-[10px]" data-testid="sales-quick-add-submit">
          Add <CornerDownLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={!ready} onClick={() => submit(true)} className="h-9 rounded-[10px] text-content-2" title="Add and open the full editor (Shift+Enter)">
          <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden /> Editor
        </Button>
      </div>
      {needsEditor && master ? (
        <p className="mt-1.5 pl-0 text-[11.5px] text-content-3 lg:pl-10">
          {master.name} needs print and packing choices: the line is added and marked to check, or press Shift+Enter to open it now.
        </p>
      ) : null}
    </div>
  );
}

/** The whole order at a glance: one row per line, totals, then the quick-add row. */
export function LinesTable({
  lines,
  masters,
  perLineIssues,
  activeId,
  onOpen,
  onDuplicate,
  onRemove,
  onMove,
  quickAdd,
  emptyHint,
}: {
  lines: SalesOrderLine[];
  masters: ProductMaster[];
  perLineIssues: Record<string, string[]>;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  quickAdd?: React.ReactNode;
  emptyHint?: string;
}) {
  const kg = lines.reduce((sum, line) => sum + (line.qty_uom === "KG" ? Number(line.qty_value) || 0 : 0), 0);
  const pcs = lines.reduce((sum, line) => sum + (line.qty_uom === "PCS" ? Number(line.qty_value) || 0 : 0), 0);
  const value = lines.reduce((sum, line) => sum + (parseFloat(line.unit_price || "0") || 0) * (Number(line.qty_value) || 0), 0);
  const toFix = lines.filter((line) => lineIssues(line, perLineIssues).length).length;
  return (
    <div data-testid="sales-lines-table">
      <div role="table" aria-label="Order lines">
      <div
        role="row"
        className={cn(
          "hidden bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-content-4 sm:px-4",
          GRID,
        )}
      >
        <span role="columnheader">#</span>
        <span role="columnheader">Product · line label</span>
        <span role="columnheader">Size</span>
        <span role="columnheader">Layers · gauge</span>
        <span role="columnheader">Print</span>
        <span role="columnheader" className="text-right">Qty</span>
        <span role="columnheader" className="text-right">Rate</span>
        <span role="columnheader" className="text-right">Value</span>
        <span role="columnheader">Status</span>
      </div>
      {!lines.length ? (
        <div role="row" className="border-t border-line" data-testid="sales-lines-empty">
        <div role="cell" className="grid place-items-center gap-1.5 px-4 py-10 text-center">
          <span className="mb-1 grid h-11 w-11 place-items-center rounded-[12px] bg-info-bg text-primary">
            <ShoppingCart className="h-5 w-5" aria-hidden />
          </span>
          <b className="text-[15px] font-semibold text-content-1">No lines yet</b>
          <span className="max-w-[460px] text-[13px] text-content-3">
            {emptyHint || "Type a product master code or name in the row below and press Enter, or start from the last order."}
          </span>
        </div>
        </div>
      ) : null}
      {lines.map((line, index) => (
        <LineRow
          key={line.id}
          index={index}
          count={lines.length}
          line={line}
          master={masters.find((row) => row.id === line.product_master)}
          issues={lineIssues(line, perLineIssues)}
          active={line.id === activeId}
          onOpen={() => onOpen(line.id)}
          onDuplicate={() => onDuplicate(line.id)}
          onRemove={() => onRemove(line.id)}
          onMove={(by) => onMove(line.id, by)}
        />
      ))}
      {lines.length ? (
        <div
          role="row"
          className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-strong bg-surface-1 px-3 py-2.5 text-[12.5px] sm:px-4", GRID)}
          data-testid="sales-lines-total"
        >
          <span role="cell" className="hidden xl:block" />
          <span role="cell" className="font-semibold text-content-1">
            Total · {lines.length} line{lines.length === 1 ? "" : "s"}
            {toFix ? <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-[11.5px] font-semibold text-warning-fg">{toFix} to fix</span> : null}
          </span>
          <span role="cell" className="hidden text-content-3 xl:col-span-3 xl:block">sends to the planner · plant chosen there</span>
          <span role="cell" className="font-mono font-semibold tabular-nums text-content-1 xl:col-span-2 xl:text-right">
            {[kg ? `${kg.toLocaleString("en-IN")} kg` : "", pcs ? `${pcs.toLocaleString("en-IN")} pcs` : ""].filter(Boolean).join(" + ") || "—"}
          </span>
          <span role="cell" className="font-mono text-[14px] font-bold tabular-nums text-content-1 xl:text-right">{value > 0 ? inr(value) : "₹ —"}</span>
          <span role="cell" className="hidden xl:block" />
        </div>
      ) : null}
      </div>
      {quickAdd}
    </div>
  );
}
