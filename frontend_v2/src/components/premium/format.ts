/** Shared number formatting for dashboards (Indian grouping, compact units). */

export const inrCompact = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(1)} L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

export const kgCompact = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Math.abs(n) >= 1000
    ? `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} t`
    : `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
};

export const pct = (value: unknown, digits = 1) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString("en-IN", { maximumFractionDigits: digits })}%` : "—";
};

export const count = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : "—";
};

export const dayLabel = (value: unknown) => {
  const text = String(value ?? "");
  const d = new Date(text.length <= 10 ? `${text}T00:00:00` : text);
  return Number.isNaN(d.getTime()) ? text : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export const sentence = (value: unknown) => {
  const text = String(value ?? "").replace(/_/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "—";
};

export const relativeTime = (value: unknown) => {
  const d = new Date(String(value ?? ""));
  if (Number.isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
