import { InterPlantPrintClient } from "@/components/inventory/inter-plant-print-client";

export const dynamic = "force-dynamic";

export default async function InterPlantPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const id = String(resolvedParams?.id || "");

  return <InterPlantPrintClient challanId={id} />;
}
