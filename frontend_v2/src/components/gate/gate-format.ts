import type { GateDirection, GateReconciliation, VisitorStatus } from "@/services/gate";

const TIME = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
const DAY = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" });
const DAY_YEAR = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function parse(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function gateTime(value?: string | null): string {
  const date = parse(value);
  return date ? TIME.format(date).replace(/\s?(am|pm)$/i, (m) => m.toUpperCase()) : "—";
}

export function gateDay(value?: string | null, withYear = false): string {
  const date = parse(value);
  return date ? (withYear ? DAY_YEAR : DAY).format(date) : "—";
}

export function gateDayTime(value?: string | null): string {
  const date = parse(value);
  return date ? `${gateDay(value, true)} · ${gateTime(value)}` : "—";
}

/** "1h 05m" style elapsed time; minutes only below an hour. */
export function gateElapsed(from?: string | null, to?: string | null, now = Date.now()): string {
  const start = parse(from);
  if (!start) return "—";
  const end = parse(to)?.getTime() ?? now;
  const minutes = Math.max(0, Math.floor((end - start.getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function gateMinutesSince(from?: string | null, now = Date.now()): number {
  const start = parse(from);
  return start ? Math.max(0, Math.floor((now - start.getTime()) / 60000)) : 0;
}

export function gateQty(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function gateAmount(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "Not known";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function todayIso(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86400000);
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export const DIRECTION_META: Record<GateDirection, { label: string; verb: string; party: string; partyKind: "VENDOR" | "CUSTOMER"; tone: string; soft: string; edge: string }> = {
  INWARD: {
    label: "Inward",
    verb: "Goods coming in",
    party: "Supplier",
    partyKind: "VENDOR",
    tone: "var(--gate-in)",
    soft: "var(--gate-in-soft)",
    edge: "var(--gate-in-edge)",
  },
  OUTWARD: {
    label: "Outward",
    verb: "Goods going out",
    party: "Customer",
    partyKind: "CUSTOMER",
    tone: "var(--gate-out)",
    soft: "var(--gate-out-soft)",
    edge: "var(--gate-out-edge)",
  },
};

export const VISITOR_STATUS_META: Record<VisitorStatus, { label: string; tone: string; soft: string; edge: string }> = {
  PENDING: { label: "Waiting at gate", tone: "var(--gate-pending)", soft: "var(--gate-pending-soft)", edge: "var(--gate-pending-edge)" },
  INSIDE: { label: "Inside", tone: "var(--gate-inside)", soft: "var(--gate-inside-soft)", edge: "var(--gate-inside-edge)" },
  EXITED: { label: "Exited", tone: "var(--gate-exited)", soft: "var(--surface-2)", edge: "var(--border-default)" },
  CANCELLED: { label: "Not admitted", tone: "var(--gate-exited)", soft: "var(--surface-2)", edge: "var(--border-default)" },
};

export const RECON_META: Record<string, { label: string; hint: string; tone: string; soft: string; edge: string }> = {
  MATCHED: { label: "Matched", hint: "ERP document agrees", tone: "var(--gate-inside)", soft: "var(--gate-inside-soft)", edge: "var(--gate-inside-edge)" },
  UNMATCHED: { label: "Owner review", hint: "No ERP document linked", tone: "var(--gate-pending)", soft: "var(--gate-pending-soft)", edge: "var(--gate-pending-edge)" },
  DISCREPANCY: { label: "Mismatch", hint: "Gate observation differs from ERP", tone: "var(--gate-alert)", soft: "var(--gate-alert-soft)", edge: "var(--gate-alert-edge)" },
};

export function reconMeta(status?: GateReconciliation | null) {
  return RECON_META[String(status || "UNMATCHED")] ?? RECON_META.UNMATCHED;
}

/** Normalise a typed vehicle number to plate form: uppercase, single spaces. */
export function normalizeVehicle(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trimStart();
}

export function normalizeInvoice(value: string): string {
  return value.replace(/\s+/g, " ").trimStart();
}

/** Accepts 10-digit Indian mobiles with optional +91 / 91 prefix and separators. */
export function normalizeMobile(value: string): string {
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return digits.slice(0, 10);
}

export function isValidMobile(value: string): boolean {
  return /^[6-9][0-9]{9}$/.test(normalizeMobile(value));
}
