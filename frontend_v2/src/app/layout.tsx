import type { Metadata } from "next";
import "./globals.css";
import Providers from "@/components/providers";
import { installServerConsoleFilters } from "@/lib/server-console-filters";

installServerConsoleFilters();

export const metadata: Metadata = {
  title: "Total Poly Print ERP",
  description: "Total Poly Print ERP",
  icons: {
    icon: [
      { url: "/brand/tpp-logo-mark.svg", type: "image/svg+xml" },
    ],
    shortcut: "/brand/tpp-logo-mark.svg",
    apple: "/brand/tpp-logo-mark.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700;9..144,800&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
