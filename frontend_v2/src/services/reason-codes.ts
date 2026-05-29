import { api } from "@/lib/api"

/**
 * A scrap or downtime reason code. Sub-codes reference a parent via
 * `parent_id`; top-level codes have `parent_id === null`.
 * Matches the backend serializer for
 *   /api/production/scrap-reasons/ and /api/production/downtime-reasons/.
 */
export interface ReasonCode {
  id: string
  code: string
  label: string
  parent_id: string | null
  parent_code: string | null
  is_active: boolean
  sort_order: number
}

export type ReasonCodeKind = "scrap" | "downtime"

/** Fields accepted when creating a reason code. */
export interface ReasonCodeCreateInput {
  code: string
  label: string
  parent_id?: string | null
  is_active?: boolean
  sort_order?: number
}

/** Partial update payload for an existing reason code. */
export type ReasonCodeUpdateInput = Partial<ReasonCodeCreateInput>

const ENDPOINTS: Record<ReasonCodeKind, string> = {
  scrap: "/api/production/scrap-reasons/",
  downtime: "/api/production/downtime-reasons/",
}

function endpointFor(kind: ReasonCodeKind): string {
  return ENDPOINTS[kind]
}

function unwrapList(data: unknown): ReasonCode[] {
  if (Array.isArray(data)) return data as ReasonCode[]
  if (data && typeof data === "object" && Array.isArray((data as { results?: ReasonCode[] }).results)) {
    return (data as { results: ReasonCode[] }).results
  }
  return []
}

async function list(kind: ReasonCodeKind, params?: { include_inactive?: boolean }): Promise<ReasonCode[]> {
  const search: Record<string, string> = {}
  if (params?.include_inactive) search.include_inactive = "1"
  const { data } = await api.get(endpointFor(kind), { params: search })
  return unwrapList(data)
}

async function create(kind: ReasonCodeKind, payload: ReasonCodeCreateInput): Promise<ReasonCode> {
  const { data } = await api.post<ReasonCode>(endpointFor(kind), payload)
  return data
}

async function update(kind: ReasonCodeKind, id: string, payload: ReasonCodeUpdateInput): Promise<ReasonCode> {
  const { data } = await api.patch<ReasonCode>(`${endpointFor(kind)}${id}/`, payload)
  return data
}

async function remove(kind: ReasonCodeKind, id: string): Promise<void> {
  await api.delete(`${endpointFor(kind)}${id}/`)
}

/**
 * Typed CRUD client for scrap + downtime reason codes.
 *
 * Generic helpers (`list`/`create`/`update`/`remove`) take the kind, and the
 * named `scrap.*` / `downtime.*` namespaces are thin pre-bound wrappers for
 * call sites that only deal with one kind.
 */
export const reasonCodesService = {
  list,
  create,
  update,
  remove,

  scrap: {
    list: (params?: { include_inactive?: boolean }) => list("scrap", params),
    create: (payload: ReasonCodeCreateInput) => create("scrap", payload),
    update: (id: string, payload: ReasonCodeUpdateInput) => update("scrap", id, payload),
    remove: (id: string) => remove("scrap", id),
  },

  downtime: {
    list: (params?: { include_inactive?: boolean }) => list("downtime", params),
    create: (payload: ReasonCodeCreateInput) => create("downtime", payload),
    update: (id: string, payload: ReasonCodeUpdateInput) => update("downtime", id, payload),
    remove: (id: string) => remove("downtime", id),
  },
}

/**
 * Group a flat reason-code list into parents with nested children, preserving
 * `sort_order` then `code` for stable rendering. Orphan sub-codes (parent not
 * present in the list) are surfaced as top-level rows so nothing is hidden.
 */
export interface ReasonCodeGroup {
  parent: ReasonCode
  children: ReasonCode[]
}

export function groupReasonCodes(rows: ReasonCode[]): ReasonCodeGroup[] {
  const byId = new Map<string, ReasonCode>()
  for (const row of rows) byId.set(row.id, row)

  const sortFn = (a: ReasonCode, b: ReasonCode) =>
    a.sort_order - b.sort_order || a.code.localeCompare(b.code)

  const parents = rows
    .filter((row) => !row.parent_id || !byId.has(row.parent_id))
    .sort(sortFn)

  const childrenByParent = new Map<string, ReasonCode[]>()
  for (const row of rows) {
    if (row.parent_id && byId.has(row.parent_id)) {
      const bucket = childrenByParent.get(row.parent_id) ?? []
      bucket.push(row)
      childrenByParent.set(row.parent_id, bucket)
    }
  }

  return parents.map((parent) => ({
    parent,
    children: (childrenByParent.get(parent.id) ?? []).sort(sortFn),
  }))
}

export default reasonCodesService
