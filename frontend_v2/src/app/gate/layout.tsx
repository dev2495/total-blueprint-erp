import type { Metadata, Viewport } from "next";
import "@/components/gate/gate-tokens.css";
import { GateShell } from "@/components/gate/gate-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gate Register · Total Poly Print",
  description: "Watchman gate register for goods and visitors",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1e2848",
};

export default function GateLayout({ children }: { children: React.ReactNode }) {
  return <GateShell>{children}</GateShell>;
}
