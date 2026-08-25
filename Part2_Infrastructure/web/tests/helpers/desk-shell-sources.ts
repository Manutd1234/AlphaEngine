/**
 * The desk shell, read as text, with its comments blanked.
 *
 * Nothing about a cross-link's destination is visible to a type checker — the
 * section id is a string in a hash — so the suites that police the desk's
 * interconnections read the source files themselves. They read the same set of
 * files, and a copy of this list that fell one file behind a refactor would be
 * a scan that finds nothing and reports success, so the list lives here once.
 *
 * Paths are stated relative to `web/` and read through `readSource`, which
 * throws on a file that is missing or empty rather than handing a scan an empty
 * haystack — `assert.doesNotMatch("", /…/)` is green for ever, and a guard that
 * passes by scanning nothing is the exact failure these suites exist to catch.
 */

import { readSource } from "./source-files";

/**
 * Comments blanked before anything is scanned.
 *
 * Every assertion in these suites is about a call or a literal, and the code
 * they police carries comments that quote the very form being banned — "a bare
 * `navigate(\"live\")` handed a promoted candidate…" sits directly above the
 * call that replaced it. Reading prose as code has produced false greens and
 * false reds in this suite before.
 */
export const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * The shell is five files now, not one.
 *
 * `page.tsx` runs the hooks and draws the header;
 * `components/workspace/WorkspacePanels.tsx` mounts the eight panels and holds
 * every cross-link prop threaded into them; `lib/use-workspace-routing.ts` owns
 * where the reader is and every helper that moves them; `lib/workspace-hash.ts`
 * owns the URL vocabulary; and the Research tab's panels moved into
 * `components/ResearchWorkspace.tsx` and its children, which is where the two
 * cross-links that live inside Research JSX now are. Scanning only page.tsx
 * after that split would be a scan that finds nothing and reports success —
 * so the cross-link measurements read the whole shell.
 */
export const pageCode = strip(readSource("app/dashboard/page.tsx"));
/**
 * BOTH panel files, joined.
 *
 * The three engine tabs moved to `EnginePanels.tsx` on 2026-08-25, when
 * Diffusion became the eleventh tab and `WorkspacePanels` stood at 399 of the
 * four-hundred-line ceiling. Every suite reading this constant is asking about
 * the desk's PANELS rather than about one file, so a scan left on the original
 * would silently stop covering three tabs — which is the shape of failure the
 * split itself was made to avoid.
 */
export const panelsCode = [
  strip(readSource("components/workspace/WorkspacePanels.tsx")),
  strip(readSource("components/workspace/EnginePanels.tsx")),
].join("\n");
export const routingCode = strip(readSource("lib/use-workspace-routing.ts"));
export const hashCode = strip(readSource("lib/workspace-hash.ts"));
export const tourCode = strip(readSource("lib/workspace-tour.ts"));
export const researchCode = strip(readSource("components/ResearchWorkspace.tsx"));
export const attributionCode = strip(readSource("components/research/AttributionSection.tsx"));
export const decisionCode = strip(readSource("components/research/DecisionSection.tsx"));
export const shellCode = [pageCode, panelsCode, routingCode, hashCode, researchCode, decisionCode].join("\n");
export const overview = strip(readSource("components/WorkspaceOverview.tsx"));
export const pipeline = strip(readSource("components/overview/DecisionLoopPipeline.tsx"));
export const footerCode = strip(readSource("components/common/NextStepFooter.tsx"));
export const roleCards = strip(readSource("components/overview/RoleCards.tsx"));
export const controls = strip(readSource("components/Controls.tsx"));
