/**
 * V3.4 Sales Order Create — types for the multi-line cart.
 *
 * Per docs/sales_order_v34_create_redesign.md.
 *
 * The cart is the source of truth. Each line is a self-contained order item
 * configuration. On submit, the draft maps cleanly to
 * salesService.createOrder({ items: SalesOrderLine[] }).
 */

import type { LayerRowState } from "@/components/erp/axis-layer-matrix";
import type {
  ArtworkAssignment,
  ArtworkAssignmentMode,
} from "@/components/erp/artwork-section";

export type LineId = string;

/**
 * One configurable order line. Mirrors the shape the backend's
 * salesService.createOrder({ items: [...] }) endpoint accepts.
 */
export interface SalesOrderLine {
  id: LineId;
  /** Product master id; empty until user picks one. */
  product_master: string;
  /** Optional customer-specific overlay id. Sales uses it for item code, artwork, packing and price defaults. */
  customer_product_overlay?: string;
  /** Live route template id (optional). */
  template_id: string | null;
  /** Selected size code (e.g. "SNK-250"). */
  size_code: string;
  /** Per-layer values keyed by 1-based layer position. */
  layer_values: Record<number, LayerRowState>;
  /** Selected addon codes (multi-enum axis). */
  addons: string[];
  /**
   * Catalog-backed axis values. Keys are axis names declared on the master's
   * variant_axes with master_data_source set (e.g. pod_variant, packaging_inner,
   * packaging_outer). Values are catalog row codes.
   */
  axis_values: Record<string, any>;
  /** Artwork mode + optional assignment. */
  artwork_mode: ArtworkAssignmentMode;
  artwork_assignment?: ArtworkAssignment;
  /** Print attributes — only meaningful when master is print_capable. */
  print_type: "FLEXO" | "ROTO";
  film_type: "SHEET" | "TUBING";
  /** Quantity + UOM for this line. */
  qty_value: number;
  qty_uom: "KG" | "PCS";
  /** Production lane count for N-up parent web planning. */
  preferred_lane_count: number;
  lane_count_source: "REPEAT_DEFAULT" | "OPERATOR_CHOICE" | "POLICY_DEFAULT";
  /** Optional sales-planner lane trim override, seeded from the product master size/policy. */
  lane_trim_mm_override?: string;
  /** Sales override for pouch inner packing; blank falls back to overlay or Product Master packaging default. */
  inner_pouch_pcs_per_pack?: string;
  /** Line-level hard blockers discovered while editing artwork/ink/packing. */
  pre_submit_blockers?: string[];
  /** Pricing. */
  unit_price: string;
  price_basis: "KG" | "PCS";
  /** Per-line remarks (rare; cart-level remarks are more common). */
  remarks: string;
}

/**
 * The whole cart — the user's draft.
 */
export interface SalesOrderDraft {
  customer: string;
  ship_to_customer: string;
  address_override: string;
  order_name: string;
  delivery_date: string;
  remarks: string;
  lines: SalesOrderLine[];
  /** id of the line currently expanded for inline editing; null = all collapsed. */
  expanded_line_id: LineId | null;
}

/**
 * A "Quick Start" card surfaced after customer is picked.
 * Three variants — last_order, preset, overlay_default — but all collapse to
 * a SalesOrderLine seed when clicked.
 */
export type QuickStartCardKind = "last_order" | "preset" | "overlay_default";

export interface QuickStartCard {
  id: string;
  kind: QuickStartCardKind;
  title: string;
  subtitle?: string;
  /** Right-side metric (e.g. "Apr 18 · ₹312" for last_order, "used 42×" for preset). */
  metric?: string;
  /** Whether to show a "Most used" sparkle. */
  badge?: "popular" | "default" | "recent";
  /** Pre-filled line. Click "+ Add line" → cart receives a clone of this. */
  seed: Partial<SalesOrderLine>;
}

/**
 * Reducer actions.
 */
export type DraftAction =
  | { type: "SET_CUSTOMER"; value: string }
  | { type: "SET_SHIP_TO"; value: string }
  | { type: "SET_ADDRESS_OVERRIDE"; value: string }
  | { type: "SET_ORDER_NAME"; value: string }
  | { type: "SET_DELIVERY_DATE"; value: string }
  | { type: "SET_REMARKS"; value: string }
  | { type: "ADD_LINE"; line?: Partial<SalesOrderLine> }
  | { type: "REMOVE_LINE"; id: LineId }
  | { type: "DUPLICATE_LINE"; id: LineId }
  | { type: "UPDATE_LINE"; id: LineId; patch: Partial<SalesOrderLine> }
  | { type: "EXPAND_LINE"; id: LineId | null }
  | { type: "RESET" };

/**
 * Defaults for a fresh line. Applied on ADD_LINE and DUPLICATE_LINE.
 */
export function freshLine(seed?: Partial<SalesOrderLine>): SalesOrderLine {
  const qtyValue = toFiniteNumber(seed?.qty_value, 1000);
  const { id: _seedId, qty_value: _seedQtyValue, ...safeSeed } = seed || {};
  return {
    id: cryptoRandomId(),
    product_master: "",
    template_id: null,
    size_code: "",
    layer_values: {},
    addons: [],
    axis_values: {},
    artwork_mode: "DEFER",
    artwork_assignment: undefined,
    print_type: "ROTO",
    film_type: "SHEET",
    qty_value: qtyValue,
    qty_uom: "KG",
    preferred_lane_count: 1,
    lane_count_source: "POLICY_DEFAULT",
    lane_trim_mm_override: "",
    inner_pouch_pcs_per_pack: "",
    pre_submit_blockers: [],
    unit_price: "0.00",
    price_basis: "KG",
    remarks: "",
    ...safeSeed,
  } as SalesOrderLine;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
