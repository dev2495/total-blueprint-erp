import { redirect } from "next/navigation";

export default async function OrderTrackingLegacyRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = await params;
  redirect(`/sales/orders/${resolvedParams.id}/tracking`);
}
