import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Help guide · Total Poly Print ERP",
  description: "How to use the Total Poly Print ERP: every screen, step by step, in English and Hindi.",
  robots: { index: false, follow: false },
};

export default function GuideLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-surface-2">{children}</div>;
}
