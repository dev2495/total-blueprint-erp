import { redirect } from "next/navigation";

export default async function InterPlantPrintRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  const id = String(resolvedParams?.id || "");
  const target = `/inter-plant/print/${id}`;
  redirect(target);
}
