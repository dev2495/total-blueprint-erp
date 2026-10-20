"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type UserRow = { id: string; username: string; full_name?: string; role_info?: { code: string } };

/** People who can be assigned maintenance work; tolerant of the users API shape. */
export function useMaintenanceUsers() {
  return useQuery({
    queryKey: ["maintenance", "users"],
    queryFn: async () => {
      // Every maintenance viewer may read the maintenance people list; older servers without it
      // fall back to the admin user list.
      for (const url of ["/api/maintenance/people/", "/api/users/users/"]) {
        try {
          const { data } = await api.get(url, { params: { page_size: 300 } });
          return (Array.isArray(data) ? data : data?.results || data?.data || []) as UserRow[];
        } catch {
          // try the next source
        }
      }
      return [] as UserRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
