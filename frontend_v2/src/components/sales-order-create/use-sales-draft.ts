"use client";

/**
 * V3.4 Sales Order Create — draft reducer.
 *
 * Holds the customer + ship-to + lines[] cart state. Pure reducer; UI binds via
 * useSalesDraft() for state and dispatch.
 */

import * as React from "react";
import {
  freshLine,
  type DraftAction,
  type SalesOrderDraft,
  type SalesOrderLine,
} from "./types";

const TODAY = new Date();
const ISO_TODAY = TODAY.toISOString().slice(0, 10);
const NEXT_WEEK = new Date(TODAY.getTime() + 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

const INITIAL_DRAFT: SalesOrderDraft = {
  customer: "",
  ship_to_customer: "",
  address_override: "",
  order_name: "",
  delivery_date: NEXT_WEEK,
  remarks: "",
  lines: [],
  expanded_line_id: null,
};

function reducer(state: SalesOrderDraft, action: DraftAction): SalesOrderDraft {
  switch (action.type) {
    case "SET_CUSTOMER":
      return { ...state, customer: action.value };
    case "SET_SHIP_TO":
      return { ...state, ship_to_customer: action.value };
    case "SET_ADDRESS_OVERRIDE":
      return { ...state, address_override: action.value };
    case "SET_ORDER_NAME":
      return { ...state, order_name: action.value };
    case "SET_DELIVERY_DATE":
      return { ...state, delivery_date: action.value };
    case "SET_REMARKS":
      return { ...state, remarks: action.value };
    case "ADD_LINE": {
      const line = freshLine(action.line);
      return {
        ...state,
        lines: [...state.lines, line],
        // A newly-added line should immediately become the working line,
        // even when it came from a fully-filled overlay/repeat shortcut.
        expanded_line_id: line.id,
      };
    }
    case "REMOVE_LINE":
      return {
        ...state,
        lines: state.lines.filter((l) => l.id !== action.id),
        expanded_line_id:
          state.expanded_line_id === action.id ? null : state.expanded_line_id,
      };
    case "DUPLICATE_LINE": {
      const source = state.lines.find((l) => l.id === action.id);
      if (!source) return state;
      const clone = freshLine({
        ...source,
        id: undefined,
      } as Partial<SalesOrderLine>);
      const idx = state.lines.findIndex((l) => l.id === action.id);
      const next = [...state.lines];
      next.splice(idx + 1, 0, clone);
      return { ...state, lines: next, expanded_line_id: clone.id };
    }
    case "UPDATE_LINE":
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.id === action.id ? { ...l, ...action.patch } : l,
        ),
      };
    case "EXPAND_LINE":
      return { ...state, expanded_line_id: action.id };
    case "MOVE_LINE": {
      const from = state.lines.findIndex((l) => l.id === action.id);
      const to = from + action.by;
      if (from < 0 || to < 0 || to >= state.lines.length) return state;
      const next = [...state.lines];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...state, lines: next };
    }
    case "RESTORE_LINE": {
      if (state.lines.some((l) => l.id === action.line.id)) return state;
      const next = [...state.lines];
      next.splice(Math.max(0, Math.min(action.index, next.length)), 0, action.line);
      return { ...state, lines: next };
    }
    case "RESTORE_DRAFT":
      return { ...INITIAL_DRAFT, ...action.draft, expanded_line_id: null };
    case "RESET":
      return { ...INITIAL_DRAFT, customer: action.customer || "" };
    default:
      return state;
  }
}

function needsConfig(line: SalesOrderLine): boolean {
  return !line.product_master || !line.size_code || line.qty_value <= 0;
}

export interface UseSalesDraftResult {
  draft: SalesOrderDraft;
  dispatch: React.Dispatch<DraftAction>;
  setCustomer: (v: string) => void;
  setShipTo: (v: string) => void;
  setAddressOverride: (v: string) => void;
  setOrderName: (v: string) => void;
  setDeliveryDate: (v: string) => void;
  setRemarks: (v: string) => void;
  addLine: (seed?: Partial<SalesOrderLine>) => void;
  removeLine: (id: string) => void;
  duplicateLine: (id: string) => void;
  updateLine: (id: string, patch: Partial<SalesOrderLine>) => void;
  expandLine: (id: string | null) => void;
  moveLine: (id: string, by: -1 | 1) => void;
  restoreLine: (line: SalesOrderLine, index: number) => void;
  /** A draft left from an earlier visit (autosaved in this browser), offered to resume. */
  savedDraft: { draft: SalesOrderDraft; savedAt: string } | null;
  resumeSavedDraft: () => void;
  discardSavedDraft: () => void;
  /** When the current draft was last autosaved here. */
  savedAt: string;
  reset: (customer?: string) => void;
  cartTotalKg: number;
  cartTotalValue: number;
  isReadyToSubmit: boolean;
  blockingIssues: string[];
  warnings: string[];
}

const DRAFT_KEY = "erp.sales.composerDraft.v1";

function readSavedDraft(): { draft: SalesOrderDraft; savedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.draft || !Array.isArray(parsed.draft.lines)) return null;
    if (!parsed.draft.customer && !parsed.draft.lines.length) return null;
    return { draft: parsed.draft as SalesOrderDraft, savedAt: String(parsed.savedAt || "") };
  } catch {
    return null;
  }
}

export function useSalesDraft(initialCustomer = ""): UseSalesDraftResult {
  const [draft, dispatch] = React.useReducer(reducer, {
    ...INITIAL_DRAFT,
    customer: initialCustomer,
  });
  // Drafts autosave in this browser; one left from an earlier visit is offered, never forced.
  const [savedDraft, setSavedDraft] = React.useState<{ draft: SalesOrderDraft; savedAt: string } | null>(null);
  const [savedAt, setSavedAt] = React.useState("");
  const offeredRef = React.useRef(false);
  React.useEffect(() => {
    if (offeredRef.current) return;
    offeredRef.current = true;
    if (!initialCustomer) setSavedDraft(readSavedDraft());
  }, [initialCustomer]);
  React.useEffect(() => {
    if (!draft.customer && !draft.lines.length) return;
    const timer = window.setTimeout(() => {
      try {
        const at = new Date().toISOString();
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: { ...draft, expanded_line_id: null }, savedAt: at }));
        setSavedAt(at);
        setSavedDraft(null);
      } catch {
        // Autosave is a convenience; the order still places without it.
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft]);

  const cartTotalKg = React.useMemo(
    () =>
      draft.lines.reduce((sum, l) => {
        const qty = Number(l.qty_value);
        if (l.qty_uom === "KG" && Number.isFinite(qty)) return sum + qty;
        return sum;
      }, 0),
    [draft.lines],
  );

  const cartTotalValue = React.useMemo(
    () =>
      draft.lines.reduce((sum, l) => {
        const unit = parseFloat(l.unit_price || "0") || 0;
        const qty = Number(l.qty_value);
        return sum + unit * (Number.isFinite(qty) ? qty : 0);
      }, 0),
    [draft.lines],
  );

  const blockingIssues = React.useMemo(() => {
    const out: string[] = [];
    if (!draft.customer) out.push("Pick a customer");
    if (draft.lines.length === 0)
      out.push("Cart is empty — add at least one line");
    draft.lines.forEach((l, i) => {
      if (!l.product_master) out.push(`Line ${i + 1}: pick a product master`);
      if (!l.size_code && l.product_master)
        out.push(`Line ${i + 1}: pick a size`);
      if (l.qty_value <= 0) out.push(`Line ${i + 1}: quantity must be > 0`);
      const unit = parseFloat(l.unit_price || "0") || 0;
      if (l.product_master && unit <= 0)
        out.push(`Line ${i + 1}: set unit price`);
      (l.pre_submit_blockers || []).forEach((issue) => {
        if (issue) out.push(`Line ${i + 1}: ${issue}`);
      });
    });
    if (!draft.delivery_date) out.push("Set a promised dispatch date");
    return out;
  }, [draft]);

  const warnings = React.useMemo(() => {
    const out: string[] = [];
    draft.lines.forEach((l, i) => {
      if (l.artwork_mode === "DEFER" && l.product_master) {
        // Soft warning — DEFER is fine but flagged.
      }
    });
    return out;
  }, [draft]);

  const isReadyToSubmit = blockingIssues.length === 0;

  return {
    draft,
    dispatch,
    setCustomer: (v) => dispatch({ type: "SET_CUSTOMER", value: v }),
    setShipTo: (v) => dispatch({ type: "SET_SHIP_TO", value: v }),
    setAddressOverride: (v) =>
      dispatch({ type: "SET_ADDRESS_OVERRIDE", value: v }),
    setOrderName: (v) => dispatch({ type: "SET_ORDER_NAME", value: v }),
    setDeliveryDate: (v) => dispatch({ type: "SET_DELIVERY_DATE", value: v }),
    setRemarks: (v) => dispatch({ type: "SET_REMARKS", value: v }),
    addLine: (seed) => dispatch({ type: "ADD_LINE", line: seed }),
    removeLine: (id) => dispatch({ type: "REMOVE_LINE", id }),
    duplicateLine: (id) => dispatch({ type: "DUPLICATE_LINE", id }),
    updateLine: (id, patch) => dispatch({ type: "UPDATE_LINE", id, patch }),
    expandLine: (id) => dispatch({ type: "EXPAND_LINE", id }),
    moveLine: (id, by) => dispatch({ type: "MOVE_LINE", id, by }),
    restoreLine: (line, index) => dispatch({ type: "RESTORE_LINE", line, index }),
    savedDraft,
    resumeSavedDraft: () => {
      if (savedDraft) dispatch({ type: "RESTORE_DRAFT", draft: savedDraft.draft });
      setSavedDraft(null);
    },
    discardSavedDraft: () => {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // nothing to clear
      }
      setSavedDraft(null);
    },
    savedAt,
    reset: (customer) => {
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // nothing to clear
      }
      setSavedAt("");
      dispatch({ type: "RESET", customer });
    },
    cartTotalKg,
    cartTotalValue,
    isReadyToSubmit,
    blockingIssues,
    warnings,
  };
}
