import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import "@/components/gate/gate-tokens.css";
import Providers from "@/components/providers";
import { installServerConsoleFilters } from "@/lib/server-console-filters";

installServerConsoleFilters();

export const metadata: Metadata = {
  title: "Total Poly Print ERP",
  description: "Total Poly Print ERP",
  icons: {
    icon: [{ url: "/brand/tpp-logo-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/tpp-logo-mark.svg",
    apple: "/brand/tpp-logo-mark.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce") || undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Fonts are self-hosted (see @font-face in globals.css); preload the primary face so text paints once. */}
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <Script src="/theme-bootstrap.js" nonce={nonce} strategy="beforeInteractive" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
