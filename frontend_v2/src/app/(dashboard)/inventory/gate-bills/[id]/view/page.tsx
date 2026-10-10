"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { BillPopoutFrame, BillPopoutMessage, BillPopoutView } from "@/components/documents/bill-popout";
import { inwardBillDocument } from "@/components/documents/inward-bill-document";
import { isWatchmanUser } from "@/components/gate/gate-access";
import { useBillReviewAccess } from "@/components/inventory/gate-bills/bill-common";
import { gateBillsApi } from "@/services/gate-bills";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pop-out bill viewer (second window / second monitor). Opened from the bill
 * workspace beside a GRN; page, zoom, rotation and pin follow the form window.
 */
export default function GateBillPopoutPage() {
  const params = useParams();
  const raw = typeof params?.id === "string" ? params.id : Array.isArray(params?.id) ? params.id[0] : "";
  const id = UUID.test(raw) ? raw : "";
  const { user, effectiveRole } = useAuth();
  const access = useBillReviewAccess();
  const documents = (user as { entitlements?: { documents?: Record<string, boolean> } } | null)?.entitlements?.documents;
  const allowed = access.allowed || (Boolean(user) && !isWatchmanUser(user, effectiveRole) && documents?.["documents.view"] === true);
  const load = useCallback(() => gateBillsApi.get(id).then(inwardBillDocument), [id]);

  if (access.loading) {
    return (
      <BillPopoutFrame>
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-content-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> Checking access…
        </div>
      </BillPopoutFrame>
    );
  }
  if (!allowed) {
    return (
      <BillPopoutMessage
        icon={<Lock className="h-6 w-6" />}
        title="You cannot open this bill"
        body="Bills and documents are for the inventory team. Ask an administrator for the documents permission if you need it."
      />
    );
  }
  if (!id) return <BillPopoutMessage title="This bill link is not valid" body="Open the bill again from the bill register or the GRN screen." />;
  return <BillPopoutView key={id} loadDocument={load} />;
}
