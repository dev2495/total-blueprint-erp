import type { Metadata } from "next";
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
