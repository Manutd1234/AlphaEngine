/**
 * The one banner the security centre speaks through.
 *
 * Four panels report into it and it is drawn once, at the top of the page,
 * where an answer cannot be hidden by the panel the reader has scrolled past.
 * That is why the type lives here rather than in the screen: each card is its
 * own file now, and a card importing the screen to name this type would close
 * a cycle the module graph does not need.
 */

/**
 * The same three tones the login screen uses, and `context-change` is the
 * house's success styling — inventing `.banner.good` would be a new stylesheet
 * class for a state that already has one.
 */
export type BannerTone = "context-change" | "warn" | "error";
export type Banner = { tone: BannerTone; message: string } | null;

/** What a panel is handed so it can report an outcome it cannot draw itself. */
export type ReportBanner = (banner: Banner) => void;
