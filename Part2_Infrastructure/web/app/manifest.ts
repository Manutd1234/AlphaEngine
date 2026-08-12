import type { MetadataRoute } from "next";

/**
 * Installability, at the level this app actually supports.
 *
 * `display: standalone` and nothing else: there is no service worker and no
 * offline story, so claiming more in the manifest than the app can do would
 * hand a reader a broken window when their connection drops. What this buys
 * is a real icon and a title bar instead of a browser screenshot when someone
 * adds the desk to a home screen.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AlphaEngine — Quant Operating System",
    short_name: "AlphaEngine",
    description:
      "Research evidence, portfolio risk, execution intent and data health in one operating context.",
    // /dashboard, not "/": an installed app opening on the root would take a
    // redirect on every launch, and a home-screen icon that flashes a sign-in
    // page before the desk reads as a broken install.
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0b",
    theme_color: "#0a0a0b",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180", purpose: "maskable" },
    ],
  };
}
