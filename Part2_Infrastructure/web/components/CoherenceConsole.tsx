"use client";

/**
 * Proofs — what this engine proves about the prices the exchange quotes.
 *
 * Four sections, one argument. The de Finetti test and the portfolio its
 * failure hands back; whether the prices were right at all, once settled and
 * over time; how fast anything the market did not know is absorbed; and the
 * curriculum that says which of those claims rests on which line of the kernel.
 * The READING those four argue about — the families, the ladders, the implied
 * measure, the fee model, the filesystem — is the Quotes tab.
 *
 * THE TAB ID IS `coherence` AND THE LABEL IS "Proofs". The id is not a typo to
 * tidy: `coherence` is the ONLY Kalshi tab id `origin/main` has ever published,
 * so keeping it means every `#coherence/<section>` link that exists in the world
 * still resolves natively, and it stays on the half that carries the proof. Ids
 * disagreeing with labels is the row's own practice — `codex` renders
 * "Strategies", `model` renders "Risk engine".
 *
 * WHY THIS SPLIT, AFTER THREE OTHERS THE SAME DAY. 2026-08-24 went: one tab of
 * eleven → Markets + Coherence → seventeen sections, when six in-pane `.seg`
 * views were promoted to rails → back to one tab → consolidated to nine → these
 * two. The consolidation is the part every later move kept, and it is why this
 * rail is four rather than seven: `combos` folded into the Dutch book because
 * the Fréchet bounds test IS a coherence test on a conjunction the venue states,
 * and `index` folded into the scorecard because a distance measured on every
 * poll and a score taken once settled are one question asked twice.
 *
 * BOTH FOLDS SPENT A PUBLISHED ID, which is the expensive part and the reason
 * `RELOCATED_SECTIONS` in `lib/workspace-hash.ts` is not a courtesy: a view is
 * not in the URL, not in the command palette and not walked by
 * `scripts/desk-sweep.mjs`, so `#coherence/combos` and `#coherence/index` are
 * migrated to the SECTION that carries each. They land on the section; which
 * view opens is component state no hash can name. The same table sends the five
 * reading ids — universe, books, lattice, fees, shell — across to `markets`,
 * because those were published under `#coherence/` too.
 *
 * Panes are `.seg` groups inside a section, never a nested `<WorkspaceSubtabs>`
 * — a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records. Dutch book's SIX views are still one seg, and
 * `14r` lets that control wrap rather than shrinking its type.
 *
 * TWO PLANE CLASSES ON THE ROOT. `.coherence-plane` is the engine's shared
 * ladder — both tabs draw the same figures, tables and chips out of one
 * component library, so their density pass is one pass and lives in two files
 * cut by CONCERN: `14q` the prose ladder, `14r` (this tab's owner) the diagram
 * ladder and the packing. `.proofs-plane` is this tab's own, so a rule that can
 * only ever match here says so in its selector.
 */

import { useCallback, useMemo, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import EngineStatePanel from "@/components/coherence/EngineStatePanel";
import BasketSection from "@/components/coherence/BasketSection";
import CalibrationPane from "@/components/coherence/CalibrationPane";
import CertificatePane from "@/components/coherence/CertificatePane";
import CombosSection from "@/components/coherence/CombosSection";
import IndexSection from "@/components/coherence/IndexSection";
import LessonsPane from "@/components/coherence/LessonsPane";
import StatusPane from "@/components/coherence/StatusPane";
import { COHERENCE_SECTIONS, type CoherenceSection } from "@/lib/sections";
import {
  calibrationHistoryRoute, calibrationRoute, combosRoute, indexRoute, statusRoute, universeRoute,
} from "@/lib/coherence/routes";
import { COHERENCE_POLL_MS, useCoherenceRead, warmCoherenceRead } from "@/lib/coherence/use-coherence";
import type { CoherenceStatus, CoherenceUniverse } from "@/lib/coherence/types";
import { useSectionWarming } from "@/lib/coherence/use-section-warming";

export { type CoherenceSection } from "@/lib/sections";

/**
 * What each section asks the gateway for the moment it opens.
 *
 * The view a section OPENS on, not every view it has. Dutch book warms the
 * UNIVERSE rather than its own `certify` call, because certify names a family
 * the reader has not chosen yet: warming it would guess at an answer rather
 * than at a question. That read is shared with the Quotes tab's baskets and
 * lattice — `read-cache.ts` holds one answer per URL, so it crosses the tab
 * boundary for free.
 *
 * ONE ENTRY IS EMPTY ON PURPOSE. `lessons` is rendered from
 * `lib/coherence/lessons.ts` and asks the gateway for nothing at all, so there
 * is nothing to warm. It is stated here rather than left to be noticed, because
 * an empty list that is a decision and one that is an oversight look identical
 * in a diff.
 *
 * The two expensive reads this engine gates on a VIEW rather than a section —
 * the signed RFQ channel and the 20,000-row replay — are both on the Quotes
 * tab and are argued beside `MarketsConsole`'s own plan. Neither appears here,
 * and neither should: warming a read from a tab that cannot draw it would spend
 * it for nobody.
 */
const SECTION_READS: Record<CoherenceSection, readonly string[]> = {
  certificate: [universeRoute()],
  portfolio: [universeRoute()],
  // The one section that warms its OWN slow call rather than the universe,
  // and the difference is what it needs to know first: a parlay is a listing
  // the venue publishes, not a family the reader picks, so there is no choice
  // to guess at. `certify` stays unwarmed for exactly the opposite reason.
  combos: [combosRoute()],
  calibration: [calibrationRoute()],
  // WARMS BOTH, since 2026-08-25. This entry read `[]` and argued that the
  // section has TWO reads — the calibration history behind Score trend, the
  // index series behind the other two — so warming it would have to pick one,
  // and picking is guessing at the view a reader wants.
  //
  // That argument assumed warming costs something. It does not, here: both are
  // DuckDB-only and were measured at 1.63ms and 2.98ms, so warming BOTH costs
  // about five milliseconds and there is no choice left to guess at. They were
  // the only two reads on the tab already fast enough to need no warming and
  // the only two still showing a spinner for want of it.
  index: [indexRoute(), calibrationHistoryRoute()],
  lessons: [],
};

export interface CoherenceConsoleProps {
  section: CoherenceSection;
  onSectionChange: (section: CoherenceSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function CoherenceConsole({ section, onSectionChange, active = true }: CoherenceConsoleProps) {
  const status = useCoherenceRead<CoherenceStatus>(statusRoute(), active);
  const onFamily = section === "certificate" || section === "portfolio";
  const universe = useCoherenceRead<CoherenceUniverse>(universeRoute(), active && onFamily);

  // THE FAMILY IS THE CONSOLE'S, AND THAT REVERSES A RECORDED REJECTION.
  // `FamilyPicker` argued against hoisting it here on the grounds that the
  // console would own state only some of its sections can use, and that a
  // reader choosing a family to read a proof has not asked the neighbouring
  // section to move with them. Both were right while Dutch book was ONE
  // section. The 2026-08-25 split made Coherence test and Basket two sections
  // over ONE `certify` read of ONE family — a verdict and the portfolio that
  // verdict hands back — so a reader who picks a family on one and finds the
  // other on a different family has been told something false about which
  // answer they are looking at. Parlays needs no family and takes none.
  const [family, setFamily] = useState<string | null>(null);
  const events = useMemo(() => universe.data?.events ?? [], [universe.data]);
  const target = family ?? events[0]?.event_ticker ?? "";
  // "Has not answered either way" rather than the hook's own `loading`, which
  // is false-until-mount-with-enabled and misses the section-switch case: a
  // reader landing on the certificate mid-flight must see reading, not "none
  // has been read".
  const familiesPending = !universe.data && !universe.error;

  useSectionWarming(SECTION_READS, active);


  const openSection = (next: CoherenceSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`coherence-subtab-${next}`)?.focus());
  };
  const warmSection = useCallback((next: CoherenceSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);

  return (
    <div className="coherence-plane proofs-plane">
      <PageHead
        kicker="Proofs"
        title="Prices as probabilities, tested for coherence"
        description="A family of contracts admitting no probability measure hands back a basket that wins in every state, and this is the test."
        actions={
          <EngineStatePanel
            status={status.data}
            error={status.error}
            updatedAt={status.updatedAt}
            pollMs={COHERENCE_POLL_MS}
            paused={!active}
            familiesPriced={universe.data ? `${universe.data.events.length} read live` : null}
            // Said ONCE on the whole engine, and said by this tab: it is where
            // a reader meets a certificate that is literally a portfolio with
            // legs, quantities and fees on it, so it is the tab where "and then
            // it is traded" is the reachable misreading. Quotes passes nothing.
            readOnlyNote="this engine reads, records and certifies; it sends nothing"
          />
        }
        status={
          status.data
            ? { label: status.data.state === "ok" ? "Reading the exchange" : status.data.state, tone: status.data.state === "ok" ? "good" : "warn" }
            : undefined
        }
      />

      <WorkspaceSubtabs
        workspaceId="coherence"
        label="Proofs sections"
        tabs={COHERENCE_SECTIONS}
        activeId={section}
        onChange={openSection}
        onIntent={warmSection}
        secondary={["lessons"]}
        active={active}
      />

      {/* Three sections over two reads. Coherence test and Basket share the
          `certify` answer for one family — the read cache holds one answer per
          URL, so the second costs nothing — and Parlays is the `combos` call,
          which names no family at all. */}
      <WorkspaceSubtabPanel workspaceId="coherence" tabId="certificate" activeId={section}>
        <CertificatePane
          events={events}
          target={target}
          onFamily={setFamily}
          active={active && section === "certificate"}
          eventsPending={familiesPending}
          eventsError={universe.error}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="portfolio" activeId={section}>
        <BasketSection
          events={events}
          target={target}
          onFamily={setFamily}
          active={active && section === "portfolio"}
          eventsPending={familiesPending}
          eventsError={universe.error}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="combos" activeId={section}>
        <CombosSection active={active && section === "combos"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="calibration" activeId={section}>
        {/* The coherence index is two views of this section: a distance
            measured on every poll and a score taken once settled both answer
            "were these prices right", and the index read is gated on its own
            two views so a reader scoring the corpus never pays for the tape. */}
        <CalibrationPane active={active && section === "calibration"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="index" activeId={section}>
        <IndexSection active={active && section === "index"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="coherence" tabId="lessons" activeId={section}>
        <LessonsPane />
      </WorkspaceSubtabPanel>

      <div className="coh-console__status">
        <StatusPane status={status.data} error={status.error} />
      </div>
    </div>
  );
}
