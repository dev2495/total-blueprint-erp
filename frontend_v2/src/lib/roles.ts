/**
 * Canonical role metadata and landing pages.
 * Frontend labels must stay aligned with backend Role.name.
 */

export const ROLE_LANDING_PAGES: Record<string, string> = {
  ADMIN: '/dashboard/admin',
  OWNER: '/dashboard/owner',
  SUPER_ADMIN: '/dashboard/admin',
  SALES: '/dashboard/sales',
  PLANNER: '/dashboard/planner',
  WORK_CENTER_MANAGER: '/production/work-center',
  OPERATOR: '/production/machine-selector',
  STORE: '/inventory/rolls',
  DISPATCH: '/dashboard/logistics',
  ENGINEERING: '/engineering/artworks',
  PLANT_MANAGER: '/analytics/kpis',
}

export const CANONICAL_ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Admin',
  OWNER: 'Owner',
  SUPER_ADMIN: 'Super Admin',
  SALES: 'Sales',
  PLANNER: 'Planner',
  WORK_CENTER_MANAGER: 'Work Center Manager',
  OPERATOR: 'Operator',
  ENGINEERING: 'Engineering',
  STORE: 'Store',
  DISPATCH: 'Dispatch',
  PLANT_MANAGER: 'Plant Manager',
}

export const LEGACY_ROLE_CODE_ALIASES: Record<string, string> = {
  ENGINEER: 'ENGINEERING',
  WC_MANAGER: 'WORK_CENTER_MANAGER',
  INVENTORY: 'STORE',
  PRODUCTION_MANAGER: 'PLANT_MANAGER',
}

export function getCanonicalRoleCode(roleCode?: string | null): string {
  const normalized = String(roleCode || '').trim().toUpperCase()
  if (!normalized) return ''
  return LEGACY_ROLE_CODE_ALIASES[normalized] || normalized
}

export const ROLES = Object.entries(CANONICAL_ROLE_LABELS)
  .filter(([code]) => code !== 'SUPER_ADMIN')
  .map(([code, name]) => ({ code, name }))

export function getLandingPage(role: string | undefined): string {
  const normalized = getCanonicalRoleCode(role)
  if (!normalized) {
    return ROLE_LANDING_PAGES.ADMIN
  }
  return ROLE_LANDING_PAGES[normalized] || ROLE_LANDING_PAGES.ADMIN
}

export function getCanonicalRoleLabel(roleCode?: string | null, fallback?: string | null): string {
  const normalized = getCanonicalRoleCode(roleCode)
  if (normalized && CANONICAL_ROLE_LABELS[normalized]) {
    return CANONICAL_ROLE_LABELS[normalized]
  }
  const fallbackLabel = String(fallback || '').trim()
  if (fallbackLabel) {
    return fallbackLabel
  }
  if (!normalized) {
    return 'Guest'
  }
  return normalized
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

type RoleLike = {
  id: string
  code: string
  name: string
  description: string
  default_permissions: string[]
}

export function canonicalizeRoleRows<T extends RoleLike>(roles: T[]): T[] {
  const byCanonicalCode = new Map<string, T>()

  for (const role of roles || []) {
    const canonicalCode = getCanonicalRoleCode(role.code)
    if (!canonicalCode || !CANONICAL_ROLE_LABELS[canonicalCode]) continue

    const candidate = {
      ...role,
      code: canonicalCode,
      name: getCanonicalRoleLabel(canonicalCode, role.name),
    }

    const existing = byCanonicalCode.get(canonicalCode)
    if (!existing || existing.code !== canonicalCode) {
      byCanonicalCode.set(canonicalCode, candidate as T)
    }
  }

  return Array.from(byCanonicalCode.values()).sort((left, right) => left.name.localeCompare(right.name))
}

type RoleMatrixRow = {
  default_permissions: string[]
  database_permissions: string[]
}

export function canonicalizeRoleMatrixRows<T extends RoleMatrixRow>(matrix: Record<string, T>): Record<string, T> {
  return Object.entries(matrix || {}).reduce<Record<string, T>>((acc, [roleCode, row]) => {
    const canonicalCode = getCanonicalRoleCode(roleCode)
    if (!canonicalCode || !CANONICAL_ROLE_LABELS[canonicalCode]) {
      return acc
    }
    const existing = acc[canonicalCode]
    if (!existing) {
      acc[canonicalCode] = {
        ...row,
        default_permissions: Array.from(new Set(row.default_permissions || [])).sort(),
        database_permissions: Array.from(new Set(row.database_permissions || [])).sort(),
      } as T
      return acc
    }
    acc[canonicalCode] = {
      ...existing,
      default_permissions: Array.from(new Set([...(existing.default_permissions || []), ...(row.default_permissions || [])])).sort(),
      database_permissions: Array.from(new Set([...(existing.database_permissions || []), ...(row.database_permissions || [])])).sort(),
    } as T
    return acc
  }, {})
}
