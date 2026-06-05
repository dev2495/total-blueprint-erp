"use client";

import { useParams } from "next/navigation";
import { VariantEditorWorkspace } from "@/components/product-master/variant-editor-workspace";

export default function NewVariantPage() {
  const params = useParams<{ id: string }>();
  const id = (params?.id as string) || "";
  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-2 via-white to-surface-2 px-4 py-4 sm:px-6">
      <VariantEditorWorkspace productId={id} mode="create" />
    </div>
  );
}
