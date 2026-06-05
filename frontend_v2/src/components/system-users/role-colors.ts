// Role → tailwind color palette for badges, rings, accents.
// Keys are canonical role codes (uppercase).

export type RolePaletteKey =
  | "OWNER"
  | "ADMIN"
  | "SUPER_ADMIN"
  | "SALES"
  | "PLANNER"
  | "WORK_CENTER_MANAGER"
  | "OPERATOR"
  | "STORE"
  | "DISPATCH"
  | "ENGINEERING"
  | "PLANT_MANAGER"
  | "DEFAULT";

interface Palette {
  bg: string;
  text: string;
  ring: string;
  stripe: string; // bg-gradient-to-r class
  chipOn: string;
  chipOff: string;
}

export const ROLE_PALETTE: Record<RolePaletteKey, Palette> = {
  OWNER: {
    bg: "bg-danger-bg",
    text: "text-danger-fg",
    ring: "ring-danger-border",
    stripe: "from-danger-solid to-danger-solid",
    chipOn: "bg-danger-bg text-danger-fg ring-danger-border",
    chipOff: "ring-danger-border text-danger-fg",
  },
  ADMIN: {
    bg: "bg-warning-bg",
    text: "text-warning-fg",
    ring: "ring-warning-border",
    stripe: "from-warning-fg to-warm",
    chipOn: "bg-warning-bg text-warning-fg ring-warning-border",
    chipOff: "ring-warning-border text-warning-fg",
  },
  SUPER_ADMIN: {
    bg: "bg-order-bg",
    text: "text-order-fg",
    ring: "ring-order-border",
    stripe: "from-order-fg to-danger-solid",
    chipOn: "bg-order-bg text-order-fg ring-order-border",
    chipOff: "ring-order-border text-order-fg",
  },
  SALES: {
    bg: "bg-order-bg",
    text: "text-order-fg",
    ring: "ring-order-border",
    stripe: "from-order-fg to-purple-500",
    chipOn: "bg-order-bg text-order-fg ring-order-border",
    chipOff: "ring-order-border text-order-fg",
  },
  PLANNER: {
    bg: "bg-info-bg",
    text: "text-primary",
    ring: "ring-info-border",
    stripe: "from-primary to-info-fg",
    chipOn: "bg-info-bg text-primary ring-info-border",
    chipOff: "ring-info-border text-primary",
  },
  WORK_CENTER_MANAGER: {
    bg: "bg-order-bg",
    text: "text-order-fg",
    ring: "ring-order-border",
    stripe: "from-order-fg to-primary",
    chipOn: "bg-order-bg text-order-fg ring-order-border",
    chipOff: "ring-order-border text-order-fg",
  },
  OPERATOR: {
    bg: "bg-surface-2",
    text: "text-content-2",
    ring: "ring-line-strong",
    stripe: "from-surface-2 to-surface-2",
    chipOn: "bg-line text-content-2 ring-line-strong",
    chipOff: "ring-line-strong text-content-2",
  },
  STORE: {
    bg: "bg-success-bg",
    text: "text-success-fg",
    ring: "ring-success-border",
    stripe: "from-success-fg to-success-bg0",
    chipOn: "bg-success-bg text-success-fg ring-success-border",
    chipOff: "ring-success-border text-success-fg",
  },
  DISPATCH: {
    bg: "bg-info-bg",
    text: "text-info-fg",
    ring: "ring-info-border",
    stripe: "from-info-fg to-info-fg",
    chipOn: "bg-info-bg text-info-fg ring-info-border",
    chipOff: "ring-info-border text-info-fg",
  },
  ENGINEERING: {
    bg: "bg-purple-50",
    text: "text-purple-700",
    ring: "ring-purple-200",
    stripe: "from-purple-500 to-order-fg",
    chipOn: "bg-purple-100 text-purple-800 ring-purple-200",
    chipOff: "ring-purple-200 text-purple-700",
  },
  PLANT_MANAGER: {
    bg: "bg-success-bg",
    text: "text-success-fg",
    ring: "ring-success-border",
    stripe: "from-success-bg0 to-success-fg",
    chipOn: "bg-success-bg text-success-fg ring-success-border",
    chipOff: "ring-success-border text-success-fg",
  },
  DEFAULT: {
    bg: "bg-surface-2",
    text: "text-content-2",
    ring: "ring-line",
    stripe: "from-surface-2 to-surface-2",
    chipOn: "bg-line text-content-2 ring-line-strong",
    chipOff: "ring-line-strong text-content-2",
  },
};

export function paletteFor(roleCode?: string | null): Palette {
  const key = String(roleCode || "")
    .trim()
    .toUpperCase() as RolePaletteKey;
  return ROLE_PALETTE[key] || ROLE_PALETTE.DEFAULT;
}

// Modules we surface in the override UI. Order matters for display.
export const MODULE_ORDER: { key: string; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "sales", label: "Sales" },
  { key: "production", label: "Production" },
  { key: "inventory", label: "Inventory" },
  { key: "master", label: "Master Data" },
  { key: "templates", label: "Templates" },
  { key: "engineering", label: "Engineering" },
  { key: "routing", label: "Routing" },
  { key: "factory", label: "Factory" },
  { key: "mrp", label: "MRP" },
  { key: "analytics", label: "Analytics" },
  { key: "costing", label: "Costing" },
  { key: "ops", label: "Ops" },
  { key: "tooling", label: "Tooling" },
  { key: "notifications", label: "Notifications" },
  { key: "rbac", label: "RBAC" },
  { key: "users", label: "Users" },
  { key: "reports", label: "Reports" },
];
