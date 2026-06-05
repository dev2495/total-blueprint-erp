import { Suspense } from "react";

import HelpCenterClientPage from "@/app/(dashboard)/help/help-client";

export default function HelpCenterPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-surface-1 p-6 text-sm text-content-3">Loading help center...</div>}>
      <HelpCenterClientPage />
    </Suspense>
  );
}
