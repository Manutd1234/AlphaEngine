import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";
// Must come AFTER globals.css: tailwind.css ships unlayered utilities that win
// specificity ties by source order (see the cascade note in that file).
import "./tailwind.css";

/** Self-hosted variable fonts. next/font downloads the WOFF2 at build time and
 *  serves it from /_next/static on this origin — no runtime request to Google,
 *  no third-party connection, one variable file per family instead of a file
 *  per weight. `display: "swap"` keeps text on the metric-matched fallback
 *  while the font arrives, and the generated fallback metrics make that swap
 *  layout-stable. The `variable` names are consumed by the `--sans`/`--mono`
 *  stacks in globals.css — the single binding point every surface reads. */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

const TITLE = "AlphaEngine — Quant Operating System (Developer Case Study)";
const DESCRIPTION =
  "An educational case-study demonstration of quant trading infrastructure, built for a "
  + "developer assessment. Not a brokerage or investment service: it opens no brokerage accounts, "
  + "holds no funds and sends no real orders, and its optional sign-in stores workspace "
  + "preferences, a display name and an avatar — nothing else. A connected workspace for "
  + "quant researchers, traders, portfolio managers, risk managers, developers, data engineers "
  + "and SREs — from strategy evidence to paper execution, risk validation and data lineage.";

/** Static, not generateMetadata: reading request headers just to learn the
 *  host forces every request through dynamic rendering. The base comes from
 *  the deployment environment instead, so the route stays prerenderable and
 *  the relative image URLs below resolve against it. The canonical production
 *  alias is the last production resort because prebuilt CLI deploys pull an
 *  env with neither variable set — without it the shipped OG tags would read
 *  localhost, and nothing would fail visibly. */
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined)
  ?? (process.env.NODE_ENV === "production"
    ? "https://alphaengine-workspace.vercel.app"
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    images: [{
      url: "/og-alphaengine-v2.png",
      width: 1200,
      height: 630,
      alt: "AlphaEngine — one operating context from signal to decision",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-alphaengine-v2.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* Opting into the full screen means owning all four insets — which the
     sticky header, the shell gutters and the bottom nav now pay. Without it
     a notched phone in landscape puts the header's left edge under the
     sensor housing. */
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5efe9" },
    // Tracks --surface-0. A themeColor left behind after a palette move puts a
    // near-black browser chrome above a lighter page — visible on iOS as a
    // seam across the top of every screen.
    { media: "(prefers-color-scheme: dark)", color: "#0b0e12" },
  ],
};

/** Applies the saved theme before first paint so the page never flashes the
 *  wrong palette.
 *
 *  Only an explicit choice is stamped. "system" — and an unset key, which has
 *  always meant the same thing — deliberately stamps nothing, because an absent
 *  `data-theme` is what lets the stylesheet's `prefers-color-scheme` block
 *  answer, and keep answering when the OS flips while the tab is open. Stamping
 *  a resolved palette here would freeze System at whatever the OS said during
 *  this one page load. See `lib/theme.ts` for the matching rule on write. */
const THEME_BOOTSTRAP = `
try {
  var savedTheme = localStorage.getItem('alphaengine-theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.dataset.theme = savedTheme;
  }
  var savedTextSize = localStorage.getItem('alphaengine-text-size');
  if (savedTextSize === 'compact' || savedTextSize === 'large') {
    document.documentElement.dataset.textSize = savedTextSize;
  }
} catch (e) {}
try {
  if (window.location.pathname === '/dashboard' || window.location.pathname.indexOf('/dashboard/') === 0) {
    document.documentElement.dataset.workspaceBoot = 'pending';
    window.setTimeout(function () {
      if (document.documentElement.dataset.workspaceBoot === 'pending') {
        document.documentElement.dataset.workspaceBoot = 'fallback';
      }
    }, 4000);
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetBrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      {/* Browser writing assistants such as Grammarly add data attributes to
          body before React hydrates. Suppress only this root attribute drift;
          descendants still report real application hydration mismatches. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
