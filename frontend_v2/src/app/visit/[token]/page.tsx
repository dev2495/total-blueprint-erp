import { PublicVisitorRegistration } from "@/components/gate/public-visitor";

export default async function VisitTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PublicVisitorRegistration token={decodeURIComponent(token)} />;
}
