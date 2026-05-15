/**
 * Barrel export — lets pages import everything from one path:
 *
 *    import { Hero, Card, KPI, Chip, Button, EmptyState, DataTable } from "@/components/ds";
 *
 * Drop this at frontend_v2/src/components/ds/index.ts
 */

export { Card } from "./Card";
export { KPI } from "./KPI";
export { Hero } from "./Hero";
export { Chip, type ChipKind } from "./Chip";
export { Button, type ButtonVariant, type ButtonSize } from "./Button";
export { EmptyState } from "./EmptyState";
export { DataTable, type DataTableColumn } from "./DataTable";
