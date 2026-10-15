"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type UserRow = { id: string; username: string; full_name?: string; role_info?: { code: string } };

/** People who can be assigned maintenance work; tolerant of the users API shape. */
export function useMaintenanceUsers() {
  return useQuery({
    queryKey: ["maintenance", "users"],
    queryFn: async () => {
      for (const url of ["/api/users/users/", "/api/users/"]) {
        try {
          const { data } = await api.get(url, { params: { page_size: 300 } });
          const rows = (Array.isArray(data) ? data : data?.results || data?.data || []) as UserRow[];
          if (rows.length) return rows;
        } catch {
          // try the next shape
        }
      }
      return [] as UserRow[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
