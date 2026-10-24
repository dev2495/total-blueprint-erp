/**
 * Sizes, one way everywhere.
 *
 *   code   — short, mm only, no spaces, unique per master. Roll `500` / `500X45` (width × micron);
 *            pouch or bag `140X305` / `140X305G40` (width × height, gusset after G).
 *   label  — what people read: `500 mm web · 45 µ`, `140 × 305 mm + 40 G`.
 *   inches — never typed; always worked out from mm and shown beside it ("140 × 305 mm · 5.5 × 12 in").
 *
 * New sizes get code and label from their dimensions (editable before saving); existing sizes keep
 * whatever they were saved with.
 */

type SizeDims = {
  width_mm?: number | string | null;
  height_mm?: number | string | null;
  gusset_mm?: number | string | null;
  roll_width_mm?: number | string | null;
  thickness_micron?: number | string | null;
};

const positive = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** 1 decimal at most, no trailing zero: 305 → "305", 232.5 → "232.5". */
const mm = (value: number) => String(Math.round(value * 10) / 10);

/** Inches to 1 decimal, no trailing zero: 305 mm → "12", 140 mm → "5.5". Empty when not a size. */
export function inches(valueMm: number | string | null | undefined): string {
  const v = positive(valueMm);
  if (!v) return "";
  return String(Math.round((v / 25.4) * 10) / 10);
}

/** "5.5 × 12 in" for a pouch, "19.7 in" for a web or roll width; empty when there is no width. */
export function inchesText(widthMm: number | string | null | undefined, heightMm?: number | string | null): string {
  const w = inches(widthMm);
  if (!w) return "";
  const h = inches(heightMm ?? null);
  return h ? `${w} × ${h} in` : `${w} in`;
}

/** "140 × 305 mm · 5.5 × 12 in" / "655 mm · 25.8 in" — for plain-text places (titles, options, exports on screen). */
export function mmWithInches(widthMm: number | string | null | undefined, heightMm?: number | string | null): string {
  const w = positive(widthMm);
  if (!w) return "";
  const h = positive(heightMm ?? null);
  const metric = h ? `${mm(w)} × ${mm(h)} mm` : `${mm(w)} mm`;
  return `${metric} · ${inchesText(w, h || null)}`;
}

/**
 * Finds "W × H mm" / "W x H mm" / "W mm" inside a size label and adds the inches after it, once.
 * Leaves labels that already carry inches, or have no mm size, as they are.
 */
export function withInches(label: string | null | undefined): string {
  const text = String(label ?? "");
  if (!text || /\bin\b|″|"/.test(text.replace(/\bmm\b/g, ""))) return text;
  const pair = text.match(/(\d+(?:\.\d+)?)\s*[x×X]\s*(\d+(?:\.\d+)?)\s*mm/);
  if (pair) {
    const extra = inchesText(pair[1], pair[2]);
    return extra ? text.replace(pair[0], `${pair[0]} · ${extra}`) : text;
  }
  const single = text.match(/(\d+(?:\.\d+)?)\s*mm(?:\s+(?:roll|web))?/);
  if (single) {
    const extra = inchesText(single[1]);
    return extra ? text.replace(single[0], `${single[0]} · ${extra}`) : text;
  }
  return text;
}

/** The standard code and label for a size's dimensions, or null until the needed dimensions are in. */
export function standardSizeName(size: SizeDims, isRoll: boolean): { code: string; label: string } | null {
  const micron = positive(size.thickness_micron);
  if (isRoll) {
    const width = positive(size.width_mm) || positive(size.roll_width_mm);
    if (!width) return null;
    return {
      code: micron ? `${mm(width)}X${mm(micron)}` : mm(width),
      label: [`${mm(width)} mm web`, micron ? `${mm(micron)} µ` : ""].filter(Boolean).join(" · "),
    };
  }
  const width = positive(size.width_mm);
  const height = positive(size.height_mm);
  if (!width || !height) return null;
  const gusset = positive(size.gusset_mm);
  return {
    code: `${mm(width)}X${mm(height)}${gusset ? `G${mm(gusset)}` : ""}`,
    label: `${mm(width)} × ${mm(height)} mm${gusset ? ` + ${mm(gusset)} G` : ""}`,
  };
}

/** True while a field is blank, a placeholder, or still the name the previous dimensions gave. */
export function isAutoSizeName(
  value: string | null | undefined,
  kind: "code" | "label",
  previous: { code: string; label: string } | null,
): boolean {
  const text = String(value || "").trim();
  if (!text) return true;
  if (kind === "code" && /^SZ-\d+$/i.test(text)) return true;
  if (kind === "label" && /^Size \d+$/i.test(text)) return true;
  return Boolean(previous && previous[kind] === text);
}
