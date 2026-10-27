import { GuideRouter, type GuideParams } from "@/components/help/guide/guide-views";

// Help inside the ERP: the same guide as the public /guide page, inside the app frame.
export default async function HelpCenterPage({ searchParams }: { searchParams: Promise<GuideParams> }) {
  const params = await searchParams;
  return <GuideRouter basePath="/help" params={params} />;
}
