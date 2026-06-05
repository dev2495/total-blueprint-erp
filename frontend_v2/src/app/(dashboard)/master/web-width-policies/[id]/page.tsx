"use client";
import { useParams } from "next/navigation";
import { PolicyEditor } from "@/components/web-width-policy/policy-editor";
export default function PolicyDetailPage() {
  const params = useParams<{ id: string }>();
  return <PolicyEditor id={(params?.id as string) || ""} initialMode="edit" />;
}
