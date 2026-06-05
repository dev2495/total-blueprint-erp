import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-surface-1 p-6 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          404
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          The page you are looking for does not exist.
        </p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <Link href="/login">Go to login</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
