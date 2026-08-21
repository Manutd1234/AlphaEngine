/**
 * Visible prose, counted the way the Overview summarisation report counts it.
 *
 * A node is a rendered string literal or a JSX text node of two or more words.
 * Comments are stripped first. Interpolations become a marker and contribute no
 * words — `${usd(equity.start_of_day, 0)}` is data, not prose. Import paths,
 * class strings, CSS values and colour literals are dropped. Every occurrence
 * counts, because three cards each rendering "book connecting" are three lines
 * a reader can meet.
 *
 * It lives beside the suite rather than inside it because
 * `tests/file-size.test.ts` caps a file at 400 lines and a measuring apparatus
 * is not the measurement. `tests/summarised-overview.test.ts` is its only
 * caller, and asserts that it still sees sentences the tab definitely renders
 * before trusting any number it produces — a scanner that silently stopped
 * matching would report zero words and sail under every ceiling.
 */

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

interface Lexed {
  text: string;
  start: number;
  end: number;
}

/** Nesting-aware: a template's `${…}` is recursed into, not swallowed whole. */
function lex(source: string, offset = 0, out: Lexed[] = []): Lexed[] {
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = "";
      while (j < source.length && source[j] !== c && source[j] !== "\n") {
        if (source[j] === "\\") {
          buf += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        buf += source[j++];
      }
      out.push({ text: buf, start: offset + i, end: offset + j + 1 });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const start = i;
      let j = i + 1;
      let buf = "";
      while (j < source.length && source[j] !== "`") {
        if (source[j] === "\\") {
          buf += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < source.length && depth > 0) {
            if (source[k] === "{") depth++;
            else if (source[k] === "}") depth--;
            k++;
          }
          lex(source.slice(j + 2, k - 1), offset + j + 2, out);
          buf += " {} ";
          j = k;
          continue;
        }
        buf += source[j++];
      }
      out.push({ text: buf, start: offset + start, end: offset + j + 1 });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

const bare = (value: string) => value.replace(/\{\}/g, " ").replace(/\s+/g, " ").trim();

export const wordsIn = (value: string) =>
  bare(value).match(/[A-Za-z][A-Za-z'’]*(?:-[A-Za-z]+)*/g) ?? [];

const isClassLike = (value: string) => {
  const tokens = bare(value).split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0
    && tokens.every((token) => /^[a-z0-9][a-z0-9:_\-./[\]()%#]*$/.test(token))
    && /[-_[\]:/]/.test(bare(value))
  );
};

/** The one class string on this tab with no hyphen, colon or bracket to give it away. */
const TECHNICAL = new Set(["banner warn"]);

/** Prose shape for JSX text beside a brace: letters and punctuation, nothing else. */
const PLAIN = /^[A-Za-z0-9 ,;.'’&%×—–→↓-]+$/;

export function proseNodes(source: string): string[] {
  const text = stripComments(source);
  const out: string[] = [];
  const literals = lex(text);
  for (const { text: value } of literals) {
    if (/^@\/|^\.{1,2}\/|^\//.test(value)) continue;
    if (value === "use client" || TECHNICAL.has(value)) continue;
    if (/var\(--|linear-gradient|prefers-color-scheme/.test(value)) continue;
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) continue;
    if (/^[\d\s]*px[\dpxs\s]*$/.test(value) || /^[\d\s]+$/.test(value)) continue;
    if (isClassLike(value)) continue;
    if (wordsIn(value).length < 2) continue;
    out.push(bare(value));
  }
  // JSX text with a tag on both sides.
  for (const match of text.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) {
    const value = match[1].replace(/\s+/g, " ").trim();
    if (/[;={}]|=>|\bconst\b|\.\w+\(/.test(value)) continue;
    if (wordsIn(value).length < 2) continue;
    out.push(value);
  }
  // JSX text beside a {expression}, read from a copy with every literal blanked
  // out, so imports and code strings cannot be mistaken for prose.
  let blanked = text;
  for (const { start, end } of literals) {
    blanked =
      blanked.slice(0, start + 1)
      + " ".repeat(Math.max(0, end - start - 2))
      + blanked.slice(end - 1);
  }
  for (const match of blanked.matchAll(
    /\}([^<>{}]*[A-Za-z]{2}[^<>{}]*)[<{]|>([^<>{}]*[A-Za-z]{2}[^<>{}]*)\{/g,
  )) {
    const value = (match[1] ?? match[2]).replace(/\s+/g, " ").trim();
    if (!PLAIN.test(value)) continue;
    if (wordsIn(value).length < 2) continue;
    out.push(value);
  }
  return out;
}
