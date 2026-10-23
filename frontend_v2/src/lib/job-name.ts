/**
 * The job name sales types when placing an order (order_name). Orders placed without
 * one used to get "Order YYYY-MM-DD" filled in; that is not a job name and is never shown.
 */
const AUTO = /^order \d{4}-\d{2}-\d{2}$/i;

export function cleanJobName(value: unknown): string {
  const text = String(value ?? "").trim();
  return !text || AUTO.test(text) ? "" : text;
}

/** "SO-2026-0141 · Diwali gift pack" when a job name exists, else the order number. */
export function orderWithJobName(orderNumber: unknown, jobName: unknown): string {
  const number = String(orderNumber ?? "").trim();
  const name = cleanJobName(jobName);
  return name ? `${number} · ${name}` : number;
}
