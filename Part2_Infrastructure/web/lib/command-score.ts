/**
 * Subsequence scorer for the ⌘K palette.
 *
 * Hand-rolled on purpose: the whole requirement is "does the query appear in
 * order, and how deliberately" — forty lines, not a dependency. `null` means
 * no match (the query is not a subsequence); otherwise higher is better.
 *
 * The bonuses encode how people actually type into palettes:
 *  - a match at the very start of the text is almost always what was meant;
 *  - a match starting a word ("wf" → **W**alk-**f**orward) beats one buried
 *    mid-word;
 *  - consecutive runs ("hull" → **Hull** trend) beat scattered letters;
 *  - characters skipped between matches cost, so tight matches on long labels
 *    still beat loose matches on short ones;
 *  - a query that is a WHOLE WORD of the label beats a scatter, and one that
 *    is the label's LAST word beats that. Measured 2026-08-26: every Markets
 *    label begins "Markets →", so "mass" was a subsequence of most of them
 *    (M-a-r-k-e-t-S…) and the one label that ends in the word fell off a
 *    twenty-item cap. The view word is what a reader types.
 */
export function commandScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;

  let score = 0;
  let searchFrom = 0;
  let lastMatch = -2;

  for (const ch of q) {
    const found = t.indexOf(ch, searchFrom);
    if (found === -1) return null;

    if (found === 0) score += 8;
    else if (!/[a-z0-9]/.test(t[found - 1])) score += 6;
    if (found === lastMatch + 1) score += 4;
    score -= found - searchFrom;

    lastMatch = found;
    searchFrom = found + 1;
  }

  // The last word of the query against the label's words: whole-word and
  // last-word bonuses sized to outweigh a scatter's skips, never a prefix's.
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const wanted = q.split(/\s+/).pop() ?? q;
  if (words.includes(wanted)) score += 10;
  if (words[words.length - 1] === wanted) score += 12;

  // On otherwise-equal evidence, the shorter target is the likelier intent.
  return score - Math.floor(t.length / 8);
}
