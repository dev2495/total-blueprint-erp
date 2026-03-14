import { api } from "@/lib/api";
import { canonicalizeRoleRows } from "@/lib/roles";

// --- Types ---
export interface Role {
    id: string;
    code: string;
    name: string;
    description: string;
    default_permissions: string[];
}

export interface User {
    id: string;
    username: string;
    email: string;
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    avatar_url?: string;
    email_missing?: boolean;
    is_active: boolean;
    role_info?: Role;
    role_id?: string;
    full_name: string;
    is_owner: boolean;
    extra_permissions: string[];
    entitlements?: {
        role: string;
        permissions: string[];
        permission_map?: Record<string, string[]>;
        module_permissions?: Array<{ module: string; actions: string[] }>;
        context: {
            work_centers: string[];
            machines: string[];
        };
        landing_page: string;
    };
}

export interface ProfileChangeRequest {
    id: string;
    requested_by: string;
    requested_by_username?: string;
    target_user: string;
    target_username?: string;
    requested_changes: Record<string, string>;
    status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
    review_notes?: string;
    reviewed_by?: string | null;
    reviewed_by_username?: string | null;
    reviewed_at?: string | null;
    created_at: string;
    updated_at: string;
}

export interface PermissionCatalogEntry {
    permission: string;
    module: string;
    action: string;
    source: string;
    sources?: string[];
    assignable: boolean;
}

// --- Service ---
export const systemUserService = {
    // Roles
    getRoles: async () => {
        const { data } = await api.get<Role[]>("/api/users/roles/");
        return canonicalizeRoleRows(data);
    },
    getPermissionCatalog: async () => {
        const { data } = await api.get<PermissionCatalogEntry[]>("/api/users/roles/permissions/catalog/");
        return data;
    },

    // Users
    getUsers: async () => {
        const { data } = await api.get<User[]>("/api/users/users/");
        return data;
    },
    getUser: async (id: string) => {
        const { data } = await api.get<User>(`/api/users/users/${id}/`);
        return data;
    },
    createUser: async (data: Partial<User> & { password?: string }) => {
        const { data: res } = await api.post<User>("/api/users/users/", data);
        return res;
    },
    updateUser: async (id: string, data: Partial<User>) => {
        const { data: res } = await api.patch<User>(`/api/users/users/${id}/`, data);
        return res;
    },
    deleteUser: async (id: string) => {
        await api.delete(`/api/users/users/${id}/`);
    },

    // Assignments
    assignWorkCenters: async (userId: string, wcIds: string[]) => {
        const { data } = await api.post(`/api/users/users/${userId}/assign-work-centers/`, { work_center_ids: wcIds });
        return data;
    },
    assignMachines: async (userId: string, machineIds: string[]) => {
        const { data } = await api.post(`/api/users/users/${userId}/assign-machines/`, { machine_ids: machineIds });
        return data;
    },

    logout: async () => {
        await api.post("/api/users/logout/", {});
    },

    changePassword: async (currentPassword: string, newPassword: string) => {
        const { data } = await api.post("/api/users/change-password/", {
            current_password: currentPassword,
            new_password: newPassword,
        });
        return data as { status: string; require_relogin: boolean };
    },

    getProfileChangeRequests: async (params?: { status?: string; user_id?: string }) => {
        const { data } = await api.get<ProfileChangeRequest[]>("/api/users/profile-change-requests/", { params });
        return data;
    },

    createProfileChangeRequest: async (requestedChanges: Record<string, string>) => {
        const { data } = await api.post<ProfileChangeRequest>("/api/users/profile-change-requests/", {
            requested_changes: requestedChanges,
        });
        return data;
    },

    reviewProfileChangeRequest: async (
        requestId: string,
        decision: "APPROVE" | "REJECT",
        notes = "",
    ) => {
        const { data } = await api.patch<ProfileChangeRequest>(
            `/api/users/profile-change-requests/${requestId}/review/`,
            { decision, notes },
        );
        return data;
    },

    cancelProfileChangeRequest: async (requestId: string) => {
        const { data } = await api.post<ProfileChangeRequest>(
            `/api/users/profile-change-requests/${requestId}/cancel/`,
            {},
        );
        return data;
    },
};
