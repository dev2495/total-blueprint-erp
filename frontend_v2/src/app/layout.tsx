import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import Providers from "@/components/providers";
import { installServerConsoleFilters } from "@/lib/server-console-filters";

installServerConsoleFilters();

export const metadata: Metadata = {
  title: "Total Poly Print ERP",
  description: "Next Gen ERP System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script
          id="tbp-chunk-pre-hydration-recovery"
          src="/chunk-load-recovery.js"
          strategy="beforeInteractive"
          nonce={nonce}
        />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
