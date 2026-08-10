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
 *    still beat loose matches on short ones.
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

  // On otherwise-equal evidence, the shorter target is the likelier intent.
  return score - Math.floor(t.length / 8);
}
