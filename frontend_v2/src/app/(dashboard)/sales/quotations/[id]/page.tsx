import QuotationWorkspace from "@/components/quotations/quotation-workspace"

interface PageProps {
    params: Promise<{ id: string }>
}

export default async function QuotationDetailPage({ params }: PageProps) {
    const { id } = await params
    return <QuotationWorkspace mode="edit" quotationId={id} />
}
