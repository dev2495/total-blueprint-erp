"use client"

const NAMED_COLOR_HEX: Array<[RegExp, string]> = [
    [/\b(BLACK|KEY|K)\b/, "#111827"],
    [/\b(WHITE|W)\b/, "#f8fafc"],
    [/\b(RED|PROCESS\s*M|MAGENTA|RUBINE)\b/, "#dc2626"],
    [/\b(CYAN|PROCESS\s*C)\b/, "#06b6d4"],
    [/\bBLUE\b/, "#2563eb"],
    [/\b(YELLOW|PROCESS\s*Y)\b/, "#facc15"],
    [/\bGREEN\b/, "#16a34a"],
    [/\bORANGE\b/, "#f97316"],
    [/\b(VIOLET|PURPLE)\b/, "#7c3aed"],
    [/\bBROWN\b/, "#92400e"],
    [/\bGOLD\b/, "#d97706"],
    [/\b(SILVER|ALU|ALUMINIUM|ALUMINUM)\b/, "#94a3b8"],
]

export function colorHexFromName(name: string | null | undefined, fallback = "#64748b"): string {
    const normalized = String(name || "")
        .toUpperCase()
        .replace(/[_-]+/g, " ")
    const match = NAMED_COLOR_HEX.find(([pattern]) => pattern.test(normalized))
    return match?.[1] || fallback
}

export function coerceColorHex(hex: string | null | undefined, name?: string | null, fallback = "#64748b"): string {
    const value = String(hex || "").trim()
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) return value
    if (/^#[0-9A-Fa-f]{3}$/.test(value)) return value
    return colorHexFromName(name, fallback)
}
