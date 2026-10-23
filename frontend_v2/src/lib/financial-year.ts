/**
 * Which financial year the long lists show. "" = the working set (this year plus
 * anything still open from earlier years); "2025-2026" = that year, archived or not;
 * "all" = every year. Lists read it through the `fy` query parameter, which the API
 * client adds to every GET while a year is picked. Detail pages are never scoped.
 */
const KEY = "tpp.financialYear";
const EVENT = "tpp:financial-year";

export type FinancialYearChoice = "" | "all" | string;

export function getFinancialYear(): FinancialYearChoice {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function setFinancialYear(value: FinancialYearChoice) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(KEY, value);
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the choice lasts until reload through the event below.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
}

export function onFinancialYearChange(listener: (value: FinancialYearChoice) => void) {
  const handler = (event: Event) => listener(String((event as CustomEvent).detail || ""));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
