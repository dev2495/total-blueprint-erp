"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";

import { gateApi, type GateVisitor } from "@/services/gate";
import { useGate } from "./gate-shell";
import { useNow } from "./gate-home";
import { GateAction } from "./gate-ui";
import { invalidateVisitorQueues, VisitorPass } from "./visitor-cards";
import { VisitorForm, type VisitorDraft } from "./visitor-form";
import { useGateOperation } from "./use-gate-operation";

const FALLBACK_PURPOSES = ["Meeting", "Delivery", "Collection", "Service / maintenance", "Interview", "Official visit", "Other"];

export function WalkInVisitor() {
  const { plantId, plant } = useGate();
  const qc = useQueryClient();
  const now = useNow();
  const mastersQuery = useQuery({
    queryKey: ["gate", "masters", plantId, ""],
    queryFn: () => gateApi.masters({ plant: plantId }),
    enabled: Boolean(plantId),
    staleTime: 60_000,
    meta: { suppressGlobalError: true },
  });
  const purposes = mastersQuery.data?.purposes?.length ? mastersQuery.data.purposes : FALLBACK_PURPOSES;

  const op = useGateOperation<VisitorDraft, GateVisitor>({
    send: (payload) => gateApi.createWalkIn(plantId, payload),
    onSaved: () => invalidateVisitorQueues(qc),
  });

  if (op.phase === "saved" && op.result) {
    return (
      <div className="mx-auto max-w-[640px] space-y-4">
        <div className="px-1 pt-1">
          <div className="text-[13px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--gate-inside)" }}>
            Owner walk-in · registered
          </div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-content-1">Record entry when they come in</h1>
          <p className="mt-1 text-[14px] text-content-3">Registration is saved. Entry time is stamped when you tap Record entry.</p>
        </div>
        <VisitorPass visitor={op.result} now={now} />
        <div className="grid grid-cols-2 gap-3">
          <GateAction tone="plain" onClick={op.reset}>
            Another walk-in
          </GateAction>
          <Link
            href="/gate/visitors"
            className="gate-press flex min-h-[56px] items-center justify-center rounded-2xl text-[16px] font-semibold text-white"
            style={{ background: "var(--gate-ink-2)" }}
          >
            Visitor queue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px]">
      <div className="mb-4 flex items-center gap-2 pt-1">
        <Link href="/gate/visitors" className="gate-press -ml-2 flex h-12 w-12 items-center justify-center rounded-full text-content-2" aria-label="Back to visitors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-content-1">Walk-in visitor</h1>
          <p className="text-[13px] text-content-3">For visitors without a phone · {plant?.name}</p>
        </div>
      </div>
      <div className="gate-card p-4">
        <VisitorForm
          audience="watchman"
          purposes={purposes}
          phase={op.phase}
          error={op.error}
          onSubmit={(draft) => void op.submit(draft)}
          onRetry={() => void op.retry()}
          submitLabel="Register visitor"
        />
      </div>
    </div>
  );
}
