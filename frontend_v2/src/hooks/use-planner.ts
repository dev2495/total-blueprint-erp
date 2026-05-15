import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    plannerService,
    type ClaimStockPayload,
    type CreateStockOrderPayload,
    type PlannerControlHubParams,
} from "@/services/planner"
import { getRollExplorer } from "@/services/rolls"

const POLL_MS = 15_000

const KEYS = {
    controlHub: (params?: PlannerControlHubParams) => ["planner", "control-hub", params ?? null] as const,
    demand: () => ["planner", "demand"] as const,
    stock: () => ["planner", "stock"] as const,
    jobs: () => ["planner", "jobs"] as const,
    claimCandidates: (salesOrderItemId: string) => ["planner", "claim-candidates", salesOrderItemId] as const,
}

export function usePlannerControlHub(params?: PlannerControlHubParams) {
    return useQuery({
        queryKey: KEYS.controlHub(params),
        queryFn: () => plannerService.getControlHub(params),
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
    })
}

export function usePlannerDemand() {
    return useQuery({
        queryKey: KEYS.demand(),
        queryFn: () => plannerService.getDemand(),
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
    })
}

export function usePlannerStock() {
    return useQuery({
        queryKey: KEYS.stock(),
        queryFn: () => plannerService.getStock(),
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
    })
}

export function usePlannerJobs() {
    return useQuery({
        queryKey: KEYS.jobs(),
        queryFn: () => plannerService.getJobs(),
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
    })
}

export function usePoolRolls(filters?: { plant?: string; stage?: string; status?: string }) {
    return useQuery({
        queryKey: ["planner", "pool-rolls", filters ?? null] as const,
        queryFn: () => getRollExplorer({ ...filters, mode: "table" }),
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
    })
}

export function useClaimCandidates(salesOrderItemId: string | null | undefined) {
    return useQuery({
        queryKey: KEYS.claimCandidates(String(salesOrderItemId || "")),
        queryFn: () => plannerService.getClaimCandidates(String(salesOrderItemId)),
        enabled: !!salesOrderItemId,
    })
}

function invalidatePlanner(qc: ReturnType<typeof useQueryClient>) {
    qc.invalidateQueries({ queryKey: ["planner", "control-hub"] })
    qc.invalidateQueries({ queryKey: KEYS.demand() })
    qc.invalidateQueries({ queryKey: KEYS.stock() })
    qc.invalidateQueries({ queryKey: KEYS.jobs() })
}

export function useClaimStockMutation() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ salesOrderItemId, payload }: { salesOrderItemId: string; payload: ClaimStockPayload }) =>
            plannerService.claimStockToSales(salesOrderItemId, payload),
        onSuccess: () => invalidatePlanner(qc),
    })
}

export function useCreateStockOrderMutation() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (payload: CreateStockOrderPayload) => plannerService.createStockOrder(payload),
        onSuccess: () => invalidatePlanner(qc),
    })
}

export function useResumeStockRouteMutation() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: ({ salesOrderItemId, stockOrderId }: { salesOrderItemId: string; stockOrderId: string }) =>
            plannerService.resumeStockRouteToSales(salesOrderItemId, stockOrderId),
        onSuccess: () => invalidatePlanner(qc),
    })
}

export const PLANNER_QUERY_KEYS = KEYS
