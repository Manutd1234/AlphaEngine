import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "./globals.css";
// Must come AFTER globals.css: tailwind.css ships unlayered utilities that win
// specificity ties by source order (see the cascade note in that file).
import "./tailwind.css";

const TITLE = "AlphaEngine — Quant Operating System (Developer Case Study)";
const DESCRIPTION =
  "An educational case-study demonstration of quant trading infrastructure, built for a "
  + "developer assessment. Not a brokerage or investment service: it opens no accounts, holds "
  + "no funds, collects no credentials and sends no real orders. A connected workspace for "
  + "quant researchers, traders, portfolio managers, risk managers, developers, data engineers "
  + "and SREs — from strategy evidence to paper execution, risk validation and data lineage.";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProtocol ?? (host.startsWith("localhost") ? "http" : "https");
  let metadataBase: URL;
  try {
    metadataBase = new URL(`${protocol}://${host}`);
  } catch {
    metadataBase = new URL("http://localhost:3000");
  }
  const image = new URL("/og-alphaengine-v2.png", metadataBase).toString();

  return {
    metadataBase,
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      type: "website",
      images: [{ url: image, width: 1200, height: 630, alt: "AlphaEngine — one operating context from signal to decision" }],
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: [image],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#081321" },
  ],
};

/** Applies the saved theme before first paint so the page never flashes the
 *  wrong palette. */
const THEME_BOOTSTRAP = `
try {
  var t = localStorage.getItem('alphaengine-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
