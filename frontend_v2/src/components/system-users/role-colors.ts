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
    | "DEFAULT"

interface Palette {
    bg: string
    text: string
    ring: string
    stripe: string // bg-gradient-to-r class
    chipOn: string
    chipOff: string
}

export const ROLE_PALETTE: Record<RolePaletteKey, Palette> = {
    OWNER: {
        bg: "bg-rose-50",
        text: "text-rose-700",
        ring: "ring-rose-200",
        stripe: "from-rose-500 to-red-500",
        chipOn: "bg-rose-100 text-rose-800 ring-rose-200",
        chipOff: "ring-rose-200 text-rose-700",
    },
    ADMIN: {
        bg: "bg-amber-50",
        text: "text-amber-700",
        ring: "ring-amber-200",
        stripe: "from-amber-500 to-orange-500",
        chipOn: "bg-amber-100 text-amber-800 ring-amber-200",
        chipOff: "ring-amber-200 text-amber-700",
    },
    SUPER_ADMIN: {
        bg: "bg-fuchsia-50",
        text: "text-fuchsia-700",
        ring: "ring-fuchsia-200",
        stripe: "from-fuchsia-500 to-pink-500",
        chipOn: "bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200",
        chipOff: "ring-fuchsia-200 text-fuchsia-700",
    },
    SALES: {
        bg: "bg-violet-50",
        text: "text-violet-700",
        ring: "ring-violet-200",
        stripe: "from-violet-500 to-purple-500",
        chipOn: "bg-violet-100 text-violet-800 ring-violet-200",
        chipOff: "ring-violet-200 text-violet-700",
    },
    PLANNER: {
        bg: "bg-blue-50",
        text: "text-blue-700",
        ring: "ring-blue-200",
        stripe: "from-blue-500 to-cyan-500",
        chipOn: "bg-blue-100 text-blue-800 ring-blue-200",
        chipOff: "ring-blue-200 text-blue-700",
    },
    WORK_CENTER_MANAGER: {
        bg: "bg-indigo-50",
        text: "text-indigo-700",
        ring: "ring-indigo-200",
        stripe: "from-indigo-500 to-blue-500",
        chipOn: "bg-indigo-100 text-indigo-800 ring-indigo-200",
        chipOff: "ring-indigo-200 text-indigo-700",
    },
    OPERATOR: {
        bg: "bg-slate-100",
        text: "text-slate-700",
        ring: "ring-slate-300",
        stripe: "from-slate-500 to-slate-700",
        chipOn: "bg-slate-200 text-slate-800 ring-slate-300",
        chipOff: "ring-slate-300 text-slate-700",
    },
    STORE: {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        ring: "ring-emerald-200",
        stripe: "from-emerald-500 to-teal-500",
        chipOn: "bg-emerald-100 text-emerald-800 ring-emerald-200",
        chipOff: "ring-emerald-200 text-emerald-700",
    },
    DISPATCH: {
        bg: "bg-cyan-50",
        text: "text-cyan-700",
        ring: "ring-cyan-200",
        stripe: "from-cyan-500 to-sky-500",
        chipOn: "bg-cyan-100 text-cyan-800 ring-cyan-200",
        chipOff: "ring-cyan-200 text-cyan-700",
    },
    ENGINEERING: {
        bg: "bg-purple-50",
        text: "text-purple-700",
        ring: "ring-purple-200",
        stripe: "from-purple-500 to-violet-500",
        chipOn: "bg-purple-100 text-purple-800 ring-purple-200",
        chipOff: "ring-purple-200 text-purple-700",
    },
    PLANT_MANAGER: {
        bg: "bg-teal-50",
        text: "text-teal-700",
        ring: "ring-teal-200",
        stripe: "from-teal-500 to-emerald-500",
        chipOn: "bg-teal-100 text-teal-800 ring-teal-200",
        chipOff: "ring-teal-200 text-teal-700",
    },
    DEFAULT: {
        bg: "bg-slate-50",
        text: "text-slate-700",
        ring: "ring-slate-200",
        stripe: "from-slate-400 to-slate-600",
        chipOn: "bg-slate-200 text-slate-800 ring-slate-300",
        chipOff: "ring-slate-300 text-slate-700",
    },
}

export function paletteFor(roleCode?: string | null): Palette {
    const key = String(roleCode || "").trim().toUpperCase() as RolePaletteKey
    return ROLE_PALETTE[key] || ROLE_PALETTE.DEFAULT
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
]
