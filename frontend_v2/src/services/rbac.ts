import { api } from '@/lib/api'
import { canonicalizeRoleMatrixRows } from '@/lib/roles'

export interface RoleMatrixRow {
    default_permissions: string[]
    database_permissions: string[]
}

export type RoleMatrix = Record<string, RoleMatrixRow>

export interface EntitlementValidation {
    role: string
    granted_permissions: string[]
    granted_permission_map?: Record<string, string[]>
    expected_baseline_permissions: string[]
    expected_permission_map?: Record<string, string[]>
    missing_from_baseline: string[]
    extra_overrides: string[]
    signoff: {
        role_code: string
        total: number
        approved: number
        pending: number
        ready: boolean
    }
    context: {
        work_centers: string[]
        machines: string[]
    }
}

export const RbacService = {
    async exportRoleMatrix(): Promise<RoleMatrix> {
        const { data } = await api.get('/api/users/roles/matrix/export')
        return canonicalizeRoleMatrixRows(data)
    },

    async importRoleMatrix(matrix: Record<string, string[]>): Promise<{ updated_roles: string[] }> {
        const { data } = await api.post('/api/users/roles/matrix/import', { matrix })
        return data
    },

    async syncRoleMatrixDefaults(): Promise<{ updated_roles: string[] }> {
        const { data } = await api.post('/api/users/roles/matrix/sync-defaults')
        return data
    },

    async validateMyEntitlements(): Promise<EntitlementValidation> {
        const { data } = await api.get('/api/users/users/entitlements/validate')
        return data
    },

    async validateUserEntitlements(userId: string): Promise<EntitlementValidation> {
        const { data } = await api.get(`/api/users/users/${userId}/entitlements/validate`)
        return data
    },

    async revalidateRoleVisibility(): Promise<Record<string, EntitlementValidation['signoff']>> {
        const { data } = await api.get('/api/users/roles/visibility/revalidate')
        return data
    },

    async bootstrapRoleVisibilitySignoffs(): Promise<{ created_rows: number }> {
        const { data } = await api.post('/api/users/roles/visibility/bootstrap-signoffs')
        return data
    },
}
