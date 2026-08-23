/**
 * Kalshi prices on the browser side, kept exact.
 *
 * The gateway holds prices as Python `Decimal` and sends them as strings, and
 * this module is why they arrive that way. JSON has one numeric type and it is
 * binary64, so serialising a price as a number would hand this file the float
 * the kernel exists to avoid — and every comparison the desk shows a reader
 * would then be taken at a precision the exchange does not use.
 *
 * Prices are held as **integer centicents** ($0.0001 units), which is Kalshi's
 * finest tick and the quantum its trade fee ceils to. A dollar is 10,000 of
 * them, every price on every grid is a whole number of them, and integer
 * arithmetic in JavaScript is exact to 2^53 — about 900 billion dollars in
 * these units, which is comfortably more than any basket this desk will price.
 *
 * Nothing here rounds. A value that cannot be read is `null`, and `null` is
 * rendered as a dash with a reason beside it.
 */

/** $1, in centicents. The payoff of one contract that resolves YES. */
export const DOLLAR_CC = 10_000;

/** Kalshi emits up to six decimals; anything longer is not a price we know. */
const MAX_DECIMALS = 6;

/**
 * A venue price string to integer centicents, or null.
 *
 * Parsed by splitting on the decimal point rather than by `Number()`: the
 * whole point is to avoid binary64, and `Number("0.4200") * 10000` is
 * 4199.999999999999 on some inputs.
 */
export function toCenticents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const text = raw.trim();
  if (!text) return null;
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  if (fraction.length > MAX_DECIMALS) return null;
  const padded = (fraction + "0000").slice(0, 4);
  const dropped = fraction.slice(4);
  // Digits finer than a centicent are not roundable here: the exchange does not
  // quote them, so their presence means this is not a price from a book.
  if (dropped && /[1-9]/.test(dropped)) return null;
  const value = Number(whole || "0") * DOLLAR_CC + Number(padded);
  return sign === "-" ? -value : value;
}

/** Centicents back to the canonical four-decimal wire form. */
export function fromCenticents(value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const negative = value < 0;
  const abs = Math.abs(Math.round(value));
  const whole = Math.floor(abs / DOLLAR_CC);
  const fraction = String(abs % DOLLAR_CC).padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/**
 * A price for display: four decimals, dash when absent.
 *
 * Deliberately not `priceDp` from `lib/format`: that helper returns five
 * decimals below a dollar, which is the right rule for a crypto pair and the
 * wrong one here — every Kalshi price is a four-decimal quantity and a
 * trailing zero that is not in the quote is a digit the exchange did not send.
 */
export function priceLabel(raw: string | null | undefined): string {
  const parsed = toCenticents(raw);
  return parsed == null ? "—" : (fromCenticents(parsed) as string);
}

/** A price as cents, for prose: `$0.4200` reads as `42¢` in a sentence. */
export function centsLabel(raw: string | null | undefined): string {
  const parsed = toCenticents(raw);
  if (parsed == null) return "—";
  const cents = parsed / 100;
  return `${Number.isInteger(cents) ? cents : cents.toFixed(2)}c`;
}

/** Sum a list of prices. Any absent member makes the whole sum absent. */
export function sumPrices(values: Array<string | null | undefined>): number | null {
  let total = 0;
  for (const value of values) {
    const parsed = toCenticents(value);
    if (parsed == null) return null;
    total += parsed;
  }
  return total;
}

/** How far a total sits from $1, signed. Positive means above a dollar. */
export function distanceFromDollar(totalCc: number | null): number | null {
  return totalCc == null ? null : totalCc - DOLLAR_CC;
}

/**
 * What a basket total means, as a discriminated state.
 *
 * Four members and no default: an absent total is not "even", and a caller
 * that forgets one gets a compile error rather than a silently neutral badge.
 */
export type BasketVerdict = "dutch-book-buy" | "dutch-book-sell" | "coherent" | "unknown";

export function verdictForBuy(totalCc: number | null): BasketVerdict {
  if (totalCc == null) return "unknown";
  return totalCc < DOLLAR_CC ? "dutch-book-buy" : "coherent";
}

export function verdictForSell(totalCc: number | null): BasketVerdict {
  if (totalCc == null) return "unknown";
  return totalCc > DOLLAR_CC ? "dutch-book-sell" : "coherent";
}

/** The mark that carries each verdict when colour is unavailable. */
export const VERDICT_MARK: Record<BasketVerdict, string> = {
  "dutch-book-buy": "▲",
  "dutch-book-sell": "▲",
  coherent: "●",
  unknown: "◌",
};

/** The word that carries each verdict. Never a colour on its own. */
export const VERDICT_WORD: Record<BasketVerdict, string> = {
  "dutch-book-buy": "Dutch book",
  "dutch-book-sell": "Dutch book",
  coherent: "Coherent",
  unknown: "Not measurable",
};
