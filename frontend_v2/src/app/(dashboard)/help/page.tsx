import { Suspense } from "react";

import HelpCenterClientPage from "@/app/(dashboard)/help/help-client";

export default function HelpCenterPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">Loading help center...</div>}>
      <HelpCenterClientPage />
    </Suspense>
  );
}
