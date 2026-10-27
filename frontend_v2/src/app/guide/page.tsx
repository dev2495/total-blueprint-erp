import type { Metadata } from "next";

import { GuideRouter, guideTitle, type GuideParams } from "@/components/help/guide/guide-views";

// Open to everyone (no sign-in): the same guide as Help inside the ERP, made to be shared.
export async function generateMetadata({ searchParams }: { searchParams: Promise<GuideParams> }): Promise<Metadata> {
  const params = await searchParams;
  return { title: `${guideTitle(params)} · TPP ERP help` };
}

export default async function PublicGuidePage({ searchParams }: { searchParams: Promise<GuideParams> }) {
  const params = await searchParams;
  return <GuideRouter basePath="/guide" params={params} publicView />;
}
