/** Categorical slots in validated order. Assign by entity, never by rank. */
export const VIZ = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
  "var(--viz-8)",
] as const;

export const vizColor = (index: number) => VIZ[index % VIZ.length];

export type SeriesDef = { key: string; label: string; color?: string };

export const compactNumber = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(value / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`;
  if (abs >= 1e5) return `${(value / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}k`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
};
