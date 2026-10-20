"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

import { useNavAccessContext } from "@/components/layout/use-nav-access";
import { canOpenPath } from "@/lib/page-access";
import { getCanonicalRoleLabel, getLandingPage } from "@/lib/roles";

/** Shows the page only to accounts that may open it; everyone else gets a calm explanation. */
export function PageAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const context = useNavAccessContext();
  if (canOpenPath(pathname, context)) return <>{children}</>;
  const landing = getLandingPage(context.currentRoleCode);
  return (
    <section
      className="mx-auto mt-10 grid max-w-lg place-items-center rounded-[20px] border border-line bg-surface-1 px-6 py-10 text-center shadow-[var(--shadow-sm)]"
      data-testid="page-no-access"
      role="alert"
    >
      <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-content-2 ring-1 ring-line">
        <Lock className="h-5 w-5" aria-hidden />
      </span>
      <h1 className="mt-4 text-[18px] font-semibold text-content-1">This page is not part of your role</h1>
      <p className="mt-1.5 max-w-sm text-[13.5px] leading-5 text-content-3">
        {getCanonicalRoleLabel(context.currentRoleCode)} accounts do not open this page. If you need it for your work, ask an admin to give
        you access on the Users page.
      </p>
      <Link
        href={landing}
        className="mt-5 inline-flex min-h-10 items-center rounded-[10px] bg-primary px-4 text-[13.5px] font-semibold text-white hover:opacity-95"
      >
        Go to my start page
      </Link>
    </section>
  );
}
