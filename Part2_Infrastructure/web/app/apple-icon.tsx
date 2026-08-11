import { ImageResponse } from "next/og";

/**
 * The home-screen icon for iOS.
 *
 * Safari's Add to Home Screen ignores SVG icons and falls back to a screenshot
 * of the page, which on a dark dashboard is an unreadable grey square. This
 * renders the mark as a real 180×180 PNG at build time — no new dependency,
 * `next/og` ships with the framework.
 *
 * Drawn rather than imported so it cannot drift from the brand ramp: the same
 * three blues as app/icon.svg and the accent used across the workspace.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #3B82F6 0%, #2563EB 55%, #1E40AF 100%)",
          color: "#ffffff",
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: "-0.04em",
        }}
      >
        α
      </div>
    ),
    size,
  );
}
