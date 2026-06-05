"use client";

import { useParams } from "next/navigation";
import { PouchStyleEditor } from "@/components/pouch-style/pouch-style-editor";

export default function PouchStyleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || "";
  return <PouchStyleEditor id={id} initialMode="edit" />;
}
