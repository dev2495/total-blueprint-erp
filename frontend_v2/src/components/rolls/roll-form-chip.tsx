import { cn } from "@/lib/utils";

/** One look for a roll's physical form everywhere: open web, folded (with flap) or lay-flat tube. */
export function normalizeRollForm(value: unknown): "OPEN_WEB" | "FOLDED_WEB" | "LAYFLAT_TUBE" {
  const raw = String(value || "OPEN_WEB").toUpperCase();
  if (raw === "TUBE" || raw === "TUBING" || raw === "LAY_FLAT_TUBE" || raw === "LAYFLAT_TUBE") return "LAYFLAT_TUBE";
  if (raw === "FOLDED" || raw === "FOLDED_WEB") return "FOLDED_WEB";
  return "OPEN_WEB";
}

const FORM_WORD = { OPEN_WEB: "Open", FOLDED_WEB: "Folded", LAYFLAT_TUBE: "Tube" } as const;
const FORM_TONE = {
  OPEN_WEB: "border-info-border bg-info-bg text-info-fg",
  FOLDED_WEB: "border-order-border bg-order-bg text-order-fg",
  LAYFLAT_TUBE: "border-warning-border bg-warning-bg text-warning-fg",
} as const;

/** "Folded 300 mm + 20 flap" from the backend's form_text, or built from form / width / fold. */
export function rollFormText(roll: {
  stock_form?: unknown;
  form_text?: string | null;
  width_mm?: unknown;
  fold?: { flap_mm?: number | null } | null;
  meta_json?: Record<string, any> | null;
}, withWidth = true): string {
  const form = normalizeRollForm(roll?.stock_form);
  if (roll?.form_text && withWidth) return roll.form_text;
  const width = Number(roll?.width_mm || 0);
  const flap = Number(roll?.fold?.flap_mm ?? roll?.meta_json?.fold?.flap_mm ?? 0);
  return [
    FORM_WORD[form],
    withWidth && width > 0 ? `${Math.round(width * 100) / 100} mm` : "",
    form !== "OPEN_WEB" && flap > 0 ? `+ ${flap} flap` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function RollFormChip({
  roll,
  withWidth = true,
  className,
}: {
  roll: Parameters<typeof rollFormText>[0];
  withWidth?: boolean;
  className?: string;
}) {
  const form = normalizeRollForm(roll?.stock_form);
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-caption font-semibold",
        FORM_TONE[form],
        className,
      )}
      data-testid="roll-form-chip"
      data-form={form}
    >
      {rollFormText(roll, withWidth)}
    </span>
  );
}
