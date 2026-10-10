"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { RightsDenied, useDocumentRights } from "@/components/outward/document-rights";
import { newClientToken } from "@/components/gate/use-gate-operation";
import { describeApiError } from "@/lib/api";
import { gatePassesApi } from "@/services/gate-passes";

import { GatePassForm } from "./gate-pass-form";

export function GatePassNew() {
  const rights = useDocumentRights();
  const router = useRouter();
  if (rights.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!rights.has("gatepass.manage")) {
    return (
      <RightsDenied
        title="Raising gate passes needs the gate pass right"
        body="Inventory users, administrators and owners raise RGP / NRGP. Ask an administrator for the “Create, issue, return and close gate passes” right if you need it."
        href="/inventory/gate-passes"
        linkLabel="Gate passes"
      />
    );
  }
  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <Link href="/inventory/gate-passes" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-content-2 hover:text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
        <ArrowLeft className="h-4 w-4" /> Gate passes
      </Link>
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-content-1">New gate pass</h1>
        <p className="mt-1 text-[14px] text-content-3">Saved as a draft first. Issue it to get its number and the QR the watchman scans when the items leave.</p>
      </div>
      <GatePassForm
        onSaved={async (saved, issueNow) => {
          if (issueNow) {
            try {
              const issued = await gatePassesApi.issue(saved.id, { client_token: newClientToken(), version: saved.version });
              toast.success(`Issued as ${issued.number}. Print it and hand it over with the items.`);
            } catch (error) {
              toast.error(`Draft saved, but it could not be issued: ${describeApiError(error, "try Issue on the next screen")}`);
            }
          } else {
            toast.success("Draft saved.");
          }
          router.push(`/inventory/gate-passes/${saved.id}`);
        }}
      />
    </div>
  );
}
