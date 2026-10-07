import type { Metadata, Viewport } from "next";
import "@/components/gate/gate-tokens.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Visitor Registration · Total Poly Print",
  description: "Register your visit at the Total Poly Print factory gate.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e2848",
};

export default function VisitLayout({ children }: { children: React.ReactNode }) {
  return <div className="gate-canvas min-h-[100dvh]">{children}</div>;
}
