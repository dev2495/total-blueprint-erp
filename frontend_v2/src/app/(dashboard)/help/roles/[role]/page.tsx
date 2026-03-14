"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function HelpRoleRedirectPage() {
  const params = useParams<{ role: string }>();
  const router = useRouter();

  useEffect(() => {
    const role = String(params?.role || "").toUpperCase();
    router.replace(`/help?role=${encodeURIComponent(role)}`);
  }, [params?.role, router]);

  return null;
}
