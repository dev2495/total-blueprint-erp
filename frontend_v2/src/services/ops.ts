import { api } from '@/lib/api'

export interface BackupRecord {
    id: string
    kind: string
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
    started_at?: string | null
    finished_at?: string | null
    duration_seconds?: number | null
    file_name: string
    object_key: string
    storage_provider: string
    checksum_sha256: string
    size_bytes?: number | null
    metadata: Record<string, unknown>
    error_text: string
    created_at: string
}

export interface RestoreDrillRecord {
    id: string
    backup_record?: string | null
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED'
    started_at?: string | null
    finished_at?: string | null
    duration_seconds?: number | null
    rpo_minutes?: number | null
    rto_minutes?: number | null
    smoke_test_command: string
    smoke_test_passed: boolean
    notes: string
    error_text: string
    details: Record<string, unknown>
    created_at: string
}

export interface OpsSummary {
    generated_at: string
    backups: {
        last_24h_total: number
        last_24h_failed: number
        latest: Record<string, unknown> | null
    }
    restore_drills: {
        last_24h_total: number
        last_24h_failed: number
        latest: Record<string, unknown> | null
    }
    notifications: {
        last_24h_total_delivery_attempts: number
        last_24h_successful: number
        last_24h_failed: number
        delivery_success_rate_pct: number
    }
    queue: {
        active_workers: number
        default_queue_depth: number
        inspected: boolean
    }
}

export const OpsService = {
    async getSummary(): Promise<OpsSummary> {
        const { data } = await api.get('/api/ops/metrics/summary')
        return data
    },

    async listBackups(): Promise<BackupRecord[]> {
        const { data } = await api.get('/api/ops/backups')
        return data
    },

    async runBackupNow(): Promise<{ status: string; task_id: string }> {
        const { data } = await api.post('/api/ops/backups/run-now')
        return data
    },

    async pruneBackups(retentionDays = 30): Promise<{
        deleted_records: number
        deleted_local_files: number
        deleted_s3_objects: number
        retention_days: number
    }> {
        const { data } = await api.post('/api/ops/backups/prune', {
            retention_days: retentionDays,
        })
        return data
    },

    async listRestoreDrills(): Promise<RestoreDrillRecord[]> {
        const { data } = await api.get('/api/ops/restore-drills')
        return data
    },

    async runRestoreDrillNow(): Promise<{ status: string; task_id: string }> {
        const { data } = await api.post('/api/ops/restore-drills/run-now')
        return data
    },
}
