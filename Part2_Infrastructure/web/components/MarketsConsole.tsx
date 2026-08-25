"use client";

/**
 * Prices — the Kalshi venue as it is quoted, before anything is proved about it.
 *
 * A contract that pays a dollar if an event happens is a probability with a
 * price on it. This tab is the READING: which families the engine watches and
 * what a whole dollar of one costs, the two bid ladders the exchange really
 * sends, the measure a strike ladder implies and what to stake on it, what the
 * venue charges for touching any of it, and the same universe walked as a
 * filesystem. What FOLLOWS from those prices — the de Finetti test, the settled
 * scorecard, the absorption study — is the Proofs tab.
 *
 * THE TAB ID IS `markets` AND SO, SINCE 2026-08-25, IS THE LABEL. It read
 * "Quotes" for a day — house practice on this row is that the two differ
 * (`live` renders "Execution", `activity` renders "Blotter"), and six
 * characters beat seven on a header row the ladder is tight on. The reader
 * asked for "Markets", and the width turned out not to be the objection it
 * looked like: re-measured with fresh loads and the desk's real content the
 * row overflows at no width either side of the change. `lib/workspace-nav.ts`
 * carries the measurement. The id is untouched, so every `#markets/<section>`
 * link, the relocation table and the desk sweep still resolve.
 *
 * FIFTH RESTRUCTURE OF ONE DAY, AND THE HISTORY IS WORTH ONE PARAGRAPH so the
 * next reader does not re-derive it. 2026-08-24 went: one tab of eleven (what
 * `origin/main` publishes) → Markets + Coherence → seventeen sections, when six
 * in-pane `.seg` views were promoted to rails → back to one tab → consolidated
 * to nine → these two tabs → and then Stake back out of the lattice, which is
 * the only move of the five that ADDED a section. It is not the consolidation
 * being unpicked: consolidating merged sections that asked one question, and
 * this splits one that was asking two — what measure the quotes imply, and what
 * to bet against it — over two reads, with a second control row as the cost of
 * pretending otherwise. Six here answer "what is it quoted at".
 *
 * WHAT A `.seg` VIEW GIVES UP, said once for the whole engine: it is not in the
 * URL, not in the command palette, and not walked by `scripts/desk-sweep.mjs`.
 * Three of this tab's sections carry a subject that used to be addressable —
 * Settlement, Dispersion, Ablation — and `RELOCATED_SECTIONS` in
 * `lib/workspace-hash.ts` is what keeps every link to them resolving: it lands
 * on the SECTION that carries the subject, on THIS tab, and the view inside is
 * component state no hash can name. Stake was a fourth and is a section again,
 * so its entry is a tab move now rather than a demotion.
 *
 * Panes are `.seg` groups inside a section, never a nested `<WorkspaceSubtabs>`
 * — a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records. A section with five views is still one seg.
 *
 * NO "ORDER PATH" METRIC HERE, and its absence is a decision. The engine reads,
 * records and certifies and there is no send path in this version; that is one
 * claim about one engine and it is made ONCE, on Proofs, where a reader meets a
 * certificate that is literally a portfolio with legs and fees on it. Repeating
 * it over a page of quotes would be the third telling of a fact the reader has
 * already been given — exactly what this pass was asked to stop.
 *
 * TWO PLANE CLASSES ON THE ROOT. `.coherence-plane` is the engine's shared
 * ladder — both tabs draw the same figures, tables and chips out of the same
 * component library, so their density pass is one pass. `.markets-plane` is
 * this tab's own, and it exists so a rule that can only ever match here says so
 * in its selector instead of floating over a plane where its class never
 * appears. `14q-markets-density.css` owns this pair; `14r` owns the other.
 */

import { useCallback, useEffect, useState } from "react";

import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import EngineStatePanel, { EngineChips } from "@/components/coherence/EngineStatePanel";
import LiveControls from "@/components/coherence/LiveControls";
import BooksSection from "@/components/coherence/BooksSection";
import FeesSection from "@/components/coherence/FeesSection";
import { EXAMPLES } from "@/components/coherence/FeesPane";
import MakersSection from "@/components/coherence/MakersSection";
import SettlementSection from "@/components/coherence/SettlementSection";
import ShellPane from "@/components/coherence/ShellPane";
import StatusPane from "@/components/coherence/StatusPane";
import StakePane from "@/components/coherence/StakePane";
import SurfacePane from "@/components/coherence/SurfacePane";
import UniverseSection from "@/components/coherence/UniverseSection";
import { MARKETS_SECTIONS, type MarketsSection } from "@/lib/sections";
import { PUBLISHED_CITY } from "@/components/coherence/SettlementPane";
import { booksRoute, feesRoute, settlementRoute, shellRoute, statusRoute, universeRoute } from "@/lib/coherence/routes";
import { COHERENCE_POLL_MS, useCoherenceRead, warmCoherenceRead } from "@/lib/coherence/use-coherence";
import type { CoherenceStatus, CoherenceUniverse } from "@/lib/coherence/types";
import { useSectionWarming } from "@/lib/coherence/use-section-warming";

export { type MarketsSection } from "@/lib/sections";

/**
 * What each section asks the gateway for the moment it opens.
 *
 * The view a section OPENS on, not every view it has, and that distinction does
 * real work on this tab. Fees warms the worked example because that is what a
 * reader lands on; it does NOT warm the replay behind its Ablation view. The
 * lattice and the stake warm the UNIVERSE instead of their own reads, because
 * `/surface` and `/stake` both name a family the reader has not picked yet —
 * warming one would guess at an answer rather than at a question, and spend the
 * exchange's token bucket on a family nobody selected. They are the same entry
 * for the same reason, not a copy: the universe read is what both pickers are
 * built from, and `read-cache.ts` answers the second from the first.
 *
 * TWO READS ARE DELIBERATELY ABSENT, and they are listed rather than left to be
 * noticed, because an empty entry that is a decision and one that is an
 * oversight look identical in a diff:
 *
 *   - The RFQ channel, behind Books → Dispersion and Books → Channel. It is a
 *     SIGNED private-channel call on a 25-second gateway budget. As a rail
 *     section it was warmed, and that was right: opening the section was the
 *     only thing a reader could do with it. As one of four views it is not —
 *     warming would spend the desk's slowest signed call for every reader who
 *     came to look at a ladder.
 *   - `/replay?limit=20000`, behind Fees → Ablation and Fees → Replay table.
 *     The largest read on the tab, warmed by NOTHING, for the same reason it
 *     never was: the point of warming is to spend a read early, not to spend
 *     one nobody wanted.
 *
 * Each is gated on its VIEW where it is read, beside the read rather than from
 * up here at a distance, so leaving the view ends the call. Built from
 * `lib/coherence/routes` so a query string cannot drift between the pane that
 * asks and the rail that warms.
 */
const SECTION_READS: Record<MarketsSection, readonly string[]> = {
  universe: [universeRoute()],
  settlement: [settlementRoute(PUBLISHED_CITY)],
  books: [booksRoute()],
  // The one section on the tab that warms NOTHING, and it is the third entry
  // this plan has left deliberately empty. `/rfq` is a SIGNED private-channel
  // call on a 25-second gateway budget, and on any deployment without a key it
  // answers "no view, unsigned" every time. Warming it would spend the desk's
  // slowest read to pre-fetch a refusal.
  dispersion: [],
  lattice: [universeRoute()],
  stake: [universeRoute()],
  fees: [feesRoute(EXAMPLES[0].price, EXAMPLES[0].contracts, EXAMPLES[0].fills)],
  // Still warmed although Shell now OPENS on Map, which reads nothing: the warm
  // is for Browse, which is the next thing a reader presses and the only view
  // here that waits on the venue.
  shell: [shellRoute("/", "ls")],
};

export interface MarketsConsoleProps {
  section: MarketsSection;
  onSectionChange: (section: MarketsSection) => void;
  /** False while another tab is in front: every poll here is gated on it. */
  active?: boolean;
}

export default function MarketsConsole({ section, onSectionChange, active = true }: MarketsConsoleProps) {
  /**
   * The reader's own hold on this tab's polling, and the one piece of state on
   * this console that is not a read.
   *
   * `active` means "this tab is in front"; `paused` means "and the reader wants
   * it to keep reading". They are ANDed into one `live` flag every section
   * takes, so a pause genuinely stops asking Kalshi rather than freezing a
   * picture over live traffic. That distinction earns the state: these reads
   * spend a token bucket the exchange publishes no budget for, and a desk left
   * open on a second monitor is the case that spends it.
   *
   * The RAIL keeps plain `active`. Pausing the reads must not disable the
   * control that changes sections — a reader who paused to look at one figure
   * would be unable to leave it.
   */
  const [paused, setPaused] = useState(false);
  /**
   * A one-render dip in that gate, which is what "Read now" IS.
   *
   * `usePolling`'s effect depends on `enabled` and `PollingController` is built
   * with `immediate: true`, so taking the gate down and putting it back up
   * tears every loop down and starts it again — and the first thing a restarted
   * loop does is tick. `read-cache.ts` joins a request already in flight but
   * never answers from store, so that tick is a real fetch of every URL the
   * mounted sections are asking for rather than a replay of the last answer.
   *
   * A dip rather than a `refresh()` call because the reads are not here: each
   * section owns its own `useCoherenceRead`, and the alternative is a nonce
   * threaded through eight components into a hook that would have to grow a
   * parameter to receive it. This spends one render, in one file.
   *
   * Cleared in an EFFECT, not in the handler. Set and cleared inside one
   * handler, React batches both into a single render and the effect below
   * `usePolling` never sees the gate go down — so nothing restarts and the
   * button does nothing, silently.
   */
  const [rearming, setRearming] = useState(false);
  useEffect(() => {
    if (rearming) setRearming(false);
  }, [rearming]);

  const live = active && !paused && !rearming;

  const status = useCoherenceRead<CoherenceStatus>(statusRoute(), live);
  // Three sections here share this one read — the baskets, the lattice's family
  // picker and the stake's — and the Proofs tab's certificate shares it across
  // the tab boundary, because `read-cache.ts` holds one answer per URL. It is
  // the slowest read on the engine (a 28-second browser deadline), so it is
  // asked for once and cached rather than once per pane. Stake needs it for a
  // second reason the other two do not have: its declined branch names WHICH
  // families the solver can take, and the exchange's mutually-exclusive flag
  // for every watched family is on this payload and nowhere else.
  const universe = useCoherenceRead<CoherenceUniverse>(
    universeRoute(),
    live && (section === "universe" || section === "lattice" || section === "stake"),
  );

  useSectionWarming(SECTION_READS, live);


  const openSection = (next: MarketsSection) => {
    onSectionChange(next);
    requestAnimationFrame(() => document.getElementById(`markets-subtab-${next}`)?.focus());
  };
  const warmSection = useCallback((next: MarketsSection) => {
    for (const url of SECTION_READS[next]) warmCoherenceRead(url);
  }, []);

  return (
    <div className="coherence-plane markets-plane">
      {/* ONE BOX FOR THE TOP BAR, matching Proofs. See CoherenceConsole for the
          argument; the shape is the reader's, asked for on both engine tabs. */}
      <div className="coh-topbar">
      <PageHead
        kicker="Markets"
        title="The exchange as it is quoted"
        description="A contract paying $1 is a probability with a price on it, and these are the families, ladders and costs it is quoted at."
        actions={
          /* One COLUMN in the head's right slot: what the venue is doing, the
             reader's hold on it, then what this engine has read. A wrapper
             because `.page-heading__actions` is a flex row — bare children there
             sit side by side — and `display: contents` (14w) is what makes each
             of these a flex item of the slot with a line of its own.

             THE FACTS TABLE JOINED THEM on 2026-08-26. It used to be `PageHead`
             children, which render after `</header>` and therefore at the head's
             full width, leaving the head's own right half empty. Same change on
             Proofs, same commit: the layout is `.coherence-plane`-scoped, so one
             console moving alone would style itself and leave the other bare. */
          <div className="coh-headlive">
            <EngineChips
              status={status.data}
              error={status.error}
              updatedAt={status.updatedAt}
              pollMs={COHERENCE_POLL_MS}
              paused={!live}
            />
            <LiveControls
              updatedAt={status.updatedAt}
              pollMs={COHERENCE_POLL_MS}
              paused={paused}
              onPause={setPaused}
              onReadNow={() => setRearming(true)}
            />
            <EngineStatePanel
              status={status.data}
              error={status.error}
              familiesPriced={universe.data ? `${universe.data.events.length} read live` : null}
            />
          </div>
        }
        status={
          status.data
            ? { label: status.data.state === "ok" ? "Reading the exchange" : status.data.state, tone: status.data.state === "ok" ? "good" : "warn" }
            : undefined
        }
      />
      </div>

      <WorkspaceSubtabs
        workspaceId="markets"
        label="Prices sections"
        tabs={MARKETS_SECTIONS}
        activeId={section}
        onChange={openSection}
        onIntent={warmSection}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="markets" tabId="universe" activeId={section}>
        {/* Two views over one read now. Settlement was three of this section's
            five until 2026-08-25 and is its own rail entry again: the families
            are priced against an outcome, and the variable that outcome is read
            from is the next question the baskets raise — but the NEXT question
            is a different question, and a switcher holds views of one. */}
        {/* The read's own stamp, threaded from here because the read is. Every
            other section owns its `useCoherenceRead` and gets `updatedAt` with
            the payload; this one is handed the data, so it has to be handed the
            moment too or its tape would append a point per render. */}
        <UniverseSection universe={universe.data} error={universe.error} updatedAt={universe.updatedAt} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="settlement" activeId={section}>
        <SettlementSection active={live && section === "settlement"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="books" activeId={section}>
        {/* One read, gated on the section. Dispersion rode here on the argument
            that a book and a maker panel are both "what is this quoted at"; at
            that width so is every section on the tab. */}
        <BooksSection active={live && section === "books"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="dispersion" activeId={section}>
        {/* The signed channel, gated on its own section and warmed by nothing.
            As two views of Books it needed a predicate in that file whose whole
            job was to keep the desk's slowest call from firing for a reader who
            came to look at a ladder; a section gates itself. */}
        <MakersSection active={live && section === "dispersion"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="lattice" activeId={section}>
        <SurfacePane events={universe.data?.events ?? []} active={live && section === "lattice"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="stake" activeId={section}>
        {/* The bet, back on the rail after one day as a view. As a view it
            needed a second `.seg` under the lattice's, which put three rows of
            controls over the one answer a reader came for; as a section it has
            one read, one control row and an empty state that names what to
            press when the solver declines the family. */}
        <StakePane events={universe.data?.events ?? []} active={live && section === "stake"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="fees" activeId={section}>
        {/* Ablation is a view of Fees rather than a section: what the venue
            charges is a fact of the venue, and whether that cost changes the
            ANSWER is the same question one step on — which is what the tape
            replayed under four cost models measures. */}
        <FeesSection active={live && section === "fees"} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="markets" tabId="shell" activeId={section}>
        <ShellPane active={live && section === "shell"} />
      </WorkspaceSubtabPanel>

      <div className="coh-console__status">
        <StatusPane status={status.data} error={status.error} />
      </div>
    </div>
  );
}
