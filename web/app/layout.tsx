import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "AlphaEngine Trading Automation — Strategy Research Portal",
  description:
    "Parameter sweeps with multiple-testing correction: run a strategy across a grid, see the trend, and find out whether the winner is edge or selection bias.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
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
