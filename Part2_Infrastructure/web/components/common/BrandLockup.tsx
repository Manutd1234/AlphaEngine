/**
 * The AlphaEngine mark and wordmark, in the one place they are drawn.
 *
 * The header has carried this lockup since the workspace shipped; the sign-in
 * page carried nothing at all, which is how a reader arrived at a bare form with
 * no indication of what they were signing into. Copying the markup across would
 * have made a second mark to keep in step — and a logo that drifts between the
 * page you sign in on and the page you land on reads as two different products.
 *
 * The α glyph and its two rails are CSS, not an image file. `public/` does hold
 * `alphaengine-mark.svg` for the favicon and the OG card, where a file is
 * required, but an inline mark inherits `currentColor` and the theme's type
 * scale, so it stays legible in both themes and in forced-colors mode without a
 * second asset to maintain.
 *
 * Interactivity is the caller's decision. In the header this is the way back to
 * the Overview tab, so it is a button; on the sign-in page there is nowhere to
 * go yet, so it is inert and must not be focusable — a tab stop that does
 * nothing is worse than no tab stop.
 */

interface BrandLockupProps {
  /** Present in the header, absent on the sign-in page. */
  onClick?: () => void;
  /** Required when `onClick` is given: the label describes the destination. */
  label?: string;
  /**
   * `lg` is the sign-in page, where the lockup is the page's masthead rather
   * than one item in a crowded utility row.
   */
  size?: "sm" | "lg";
  /** Hide the wordmark, keeping the mark alone. Unused today; the header's
   *  narrow breakpoints may want it. */
  markOnly?: boolean;
}

export default function BrandLockup({
  onClick,
  label,
  size = "sm",
  markOnly = false,
}: BrandLockupProps) {
  const className = [
    "brand-lockup",
    size === "lg" ? "brand-lockup--lg" : null,
    onClick ? null : "brand-lockup--static",
  ].filter(Boolean).join(" ");

  const content = (
    <>
      <span className="brand-mark" aria-hidden>
        <span className="brand-mark__alpha">α</span>
        <span className="brand-mark__rails"><i /><i /></span>
      </span>
      {!markOnly && (
        <span className="brand-copy">
          <strong>AlphaEngine</strong>
          <small>Quant operating system</small>
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-label={label}>
        {content}
      </button>
    );
  }

  // Not a button, and deliberately not focusable: on the sign-in page this is
  // the masthead, and the first tab stop should be the email field.
  return <span className={className}>{content}</span>;
}
