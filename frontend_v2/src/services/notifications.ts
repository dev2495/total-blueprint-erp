// Notification Service - Phase 63
import { api } from '@/lib/api'

export interface NotificationDeliveryAttempt {
    id: string
    channel: 'IN_APP' | 'EMAIL'
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED'
    attempt_no: number
    recipient: string
    provider_message_id: string
    error_text: string
    created_at: string
    delivered_at?: string | null
}

export interface Notification {
    id: string
    event_key?: string
    type: string
    title: string
    message: string
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
    channels?: ('IN_APP' | 'EMAIL')[]
    delivery_state?: Record<string, string>
    is_read: boolean
    created_at: string
    related_object_type?: string
    related_object_id?: string
    /** Server-provided in-app route (e.g. /inventory/gate-bills/<id>); preferred over type mapping. */
    deep_link?: string
    plant?: string | null
    delivery_attempts?: NotificationDeliveryAttempt[]
}

export interface NotificationRule {
    id: string
    event_key: string
    target_roles: string[]
    channels: ('IN_APP' | 'EMAIL')[]
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
    active: boolean
    escalation_minutes: number
    email_subject_template: string
    email_body_template: string
    updated_at: string
}

export interface RoleVisibilitySignoff {
    id: string
    role_code: string
    module_key: string
    action_key: string
    approved: boolean
    approved_at?: string | null
    approved_by?: string | null
    notes: string
}

export interface PermissionAuditRow {
    id: string
    action: 'DENIED' | 'ROLE_OVERRIDE' | 'ROLE_CHANGED' | 'SIGNOFF_UPDATED'
    method: string
    path: string
    required_permission: string
    effective_role: string
    user?: string | null
    details: Record<string, unknown>
    created_at: string
}

export const NotificationService = {
    /** Throws on failure so callers can show "could not refresh" instead of a false empty list. */
    async getNotifications(unreadOnly = false, limit = 50): Promise<Notification[]> {
        const { data } = await api.get('/api/users/notifications/list', {
            params: { unread_only: unreadOnly, limit }
        })
        if (!Array.isArray(data)) throw new Error("Invalid notification response")
        return data
    },

    /** Throws on failure (never a false zero). */
    async getUnreadCount(): Promise<number> {
        const { data } = await api.get('/api/users/notifications/unread-count')
        const count = data?.count
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
            throw new Error("Invalid unread count response")
        }
        return count
    },

    /** Throws on failure so the UI never marks an item read that the server did not. */
    async markAsRead(notificationId: string): Promise<void> {
        await api.post(`/api/users/notifications/${notificationId}/mark-read`)
    },

    async markAllAsRead(): Promise<void> {
        await api.post('/api/users/notifications/mark-all-read')
    },

    async getRules(): Promise<NotificationRule[]> {
        const { data } = await api.get('/api/users/notifications/rules')
        return data
    },

    async upsertRule(payload: {
        event_key: string
        target_roles?: string[]
        channels?: ('IN_APP' | 'EMAIL')[]
        priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
        active?: boolean
        escalation_minutes?: number
        email_subject_template?: string
        email_body_template?: string
    }): Promise<NotificationRule> {
        const { data } = await api.post('/api/users/notifications/rules/upsert', payload)
        return data
    },

    async getRoleSignoffs(): Promise<RoleVisibilitySignoff[]> {
        const { data } = await api.get('/api/users/notifications/role-signoffs')
        return data
    },

    async upsertRoleSignoff(payload: {
        role_code: string
        module_key: string
        action_key: string
        approved: boolean
        notes?: string
    }): Promise<{ status: string; id: string }> {
        const { data } = await api.post('/api/users/notifications/role-signoffs/upsert', payload)
        return data
    },

    async getPermissionAudit(): Promise<PermissionAuditRow[]> {
        const { data } = await api.get('/api/users/notifications/permission-audit')
        return data
    }
}
