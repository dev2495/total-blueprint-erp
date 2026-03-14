"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function HelpPageRouteRedirectPage() {
  const params = useParams<{ route?: string[] | string }>();
  const router = useRouter();

  useEffect(() => {
    const rawRoute = params?.route;
    const segments = Array.isArray(rawRoute) ? rawRoute : rawRoute ? [rawRoute] : [];
    const route = `/${segments.join("/")}`;
    router.replace(`/help?route=${encodeURIComponent(route)}`);
  }, [params?.route, router]);

  return null;
}
