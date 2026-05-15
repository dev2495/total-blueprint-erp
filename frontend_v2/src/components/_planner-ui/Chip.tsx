import { ReactNode } from "react";

/**
 * The 9-axis chip taxonomy + 4 status chips.
 * DO NOT INVENT NEW KINDS. If a new use-case appears, add it here once + reuse.
 */
export type ChipKind =
  // 9-axis attribute taxonomy (sales · planner · machine all share)
  | "fg-roll" | "fg-pouch" | "fg-bag"
  | "size" | "thick" | "mat" | "grade" | "print" | "tpl" | "pack" | "brand"
  // status
  | "running" | "ready" | "paused" | "blocked";

interface ChipProps {
  kind: ChipKind;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * Chip — a tiny coloured label.
 *
 * <Chip kind="fg-roll">ROLL</Chip>
 * <Chip kind="size">1260 × 50 mm</Chip>
 * <Chip kind="thick">46μ</Chip>
 *
 * The kind determines the colour. Read once, transfers everywhere — a planner sees
 * the same chip for "LDPE" that a sales rep sees, and the same chip for "ROLL" that
 * the machine terminal shows.
 */
export function Chip({ kind, children, className = "", onClick }: ChipProps) {
  const Cmp = onClick ? "button" : "span";
  return (
    <Cmp
      className={`ds-chip k-${kind} ${className}`.trim()}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      {children}
    </Cmp>
  );
}

export default Chip;
