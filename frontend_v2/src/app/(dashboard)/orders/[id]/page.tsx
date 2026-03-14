import { redirect } from "next/navigation"

export default async function OrderLegacyRedirectPage({ params }: { params: Promise<{ id: string }> }) {
    const resolvedParams = await params
    redirect(`/sales/orders/${resolvedParams.id}`)
}
