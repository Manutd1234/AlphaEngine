import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "./globals.css";

const TITLE = "AlphaEngine — Integrated Investment Infrastructure";
const DESCRIPTION =
  "A connected workspace for portfolio managers, traders, researchers and developers — from strategy evidence to live execution and data lineage.";

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
  const image = new URL("/og.png", metadataBase).toString();

  return {
    metadataBase,
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      type: "website",
      images: [{ url: image, width: 1731, height: 909, alt: "AlphaEngine connected investment workflow" }],
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
