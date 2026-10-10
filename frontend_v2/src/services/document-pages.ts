import { api } from "@/lib/api";

/*
 * Shared private page helpers for inward bills and outward documents.
 * Rotation is a shared reading preference stored server-side; the original
 * image bytes are immutable evidence and never change.
 */

export type PageKind = "INWARD" | "OUTWARD";
export type PageRotation = 0 | 90 | 180 | 270;

export const documentPagesApi = {
  saveRotation: async (payload: { page_kind: PageKind; page_id: string; rotation: PageRotation }) => {
    const { data } = await api.post<{ page_kind: PageKind; page_id: string; display_rotation: PageRotation }>(
      "/api/gate/document-pages/rotation/",
      { ...payload, client_token: crypto.randomUUID() },
    );
    return data;
  },
};
