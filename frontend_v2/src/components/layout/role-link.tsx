"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { useCanFollowLink } from "@/components/layout/use-nav-access";

/** A link that is left out for accounts whose role does not open the target page. */
export function RoleLink(props: ComponentProps<typeof Link>) {
  const canFollow = useCanFollowLink();
  const href = typeof props.href === "string" ? props.href : props.href?.pathname || "";
  if (!canFollow(href)) return null;
  return <Link {...props} />;
}
