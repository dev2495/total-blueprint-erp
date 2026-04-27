import * as React from "react"
import Link from "next/link"

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">404</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900">Page not found</h1>
        <p className="mt-3 text-sm text-slate-600">
          The page you tried to open is unavailable. Return to the dashboard and continue from there.
        </p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
