"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-surface-1 p-6 shadow-sm">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-danger-fg">
            Something went wrong
          </p>
          <h1 className="text-2xl font-semibold text-gray-900">
            We hit an unexpected error.
          </h1>
          <p className="text-sm text-gray-600">
            Please retry. If this keeps happening, return to login and try
            again.
          </p>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button onClick={reset}>Retry</Button>
          <Button variant="outline" asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
