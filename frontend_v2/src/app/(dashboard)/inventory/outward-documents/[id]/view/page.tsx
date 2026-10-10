"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

import { BillPopoutFrame, BillPopoutMessage, BillPopoutView } from "@/components/documents/bill-popout";
import { useDocumentRights } from "@/components/outward/document-rights";
import { outwardWorkspaceDocument } from "@/components/outward/outward-common";
import { outwardApi } from "@/services/outward";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pop-out viewer for outward photos (second window / second monitor). Page,
 * zoom, rotation and pin follow the matching screen.
 */
export default function OutwardDocumentPopoutPage() {
  const params = useParams();
  const raw = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const id = UUID.test(raw) ? raw : "";
  const rights = useDocumentRights();
  const load = useCallback(() => outwardApi.get(id).then(outwardWorkspaceDocument), [id]);

  if (rights.loading) {
    return (
      <BillPopoutFrame>
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-content-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> Checking access…
        </div>
      </BillPopoutFrame>
    );
  }
  if (!rights.has("outward.reconcile")) {
    return (
      <BillPopoutMessage
        icon={<Lock className="h-6 w-6" />}
        title="You cannot open these photos"
        body="Outward gate photos are for the inventory team. Ask an administrator for the “Match outward gate photos” right if you need it."
      />
    );
  }
  if (!id) return <BillPopoutMessage title="This link is not valid" body="Open the photos again from the outward documents queue." />;
  return <BillPopoutView key={id} loadDocument={load} />;
}
