const DATE_LOCALE = "en-GB";

export function toDisplayDate(value?: string | number | Date | null): Date | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDisplayDate(value?: string | number | Date | null, fallback = "—"): string {
  const date = toDisplayDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

export function formatDisplayDateTime(value?: string | number | Date | null, fallback = "—"): string {
  const date = toDisplayDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date).replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());
}

export function formatDisplayDateTimeWithSeconds(value?: string | number | Date | null, fallback = "—"): string {
  const date = toDisplayDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date).replace(/\b(am|pm)\b/i, (match) => match.toUpperCase());
}
