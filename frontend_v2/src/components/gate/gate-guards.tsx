"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { useGate } from "./gate-shell";

function Denied({ body }: { body: string }) {
  return (
    <div className="gate-card mx-auto mt-6 max-w-[420px] p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-3 text-[18px] font-semibold text-content-1">Not available</h1>
      <p className="mt-1 text-[14px] text-content-3">{body}</p>
      <Link href="/gate" className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-2xl px-5 text-[15px] font-semibold text-content-1 underline">
        Gate home
      </Link>
    </div>
  );
}

/** Pages that write to the register need gate.log. */
export function GuardLog({ children }: { children: React.ReactNode }) {
  const { canLog } = useGate();
  if (!canLog) return <Denied body="Your account can view gate history but cannot log entries." />;
  return <>{children}</>;
}

/** Owner-only pages (history, corrections, audit, QR). The API enforces this too. */
export function GuardOwner({ children }: { children: React.ReactNode }) {
  const { isOwner } = useGate();
  if (!isOwner) return <Denied body="Gate history and the visitor QR are available to the owner only." />;
  return <>{children}</>;
}
