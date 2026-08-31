import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("operator surfaces stay compact without losing their evidence", () => {
  it("uses one bounded readout for Research performance and walk-forward marks", () => {
    const equity = read("components/EquityChart.tsx");
    const walkForward = read("components/research/WalkForwardTimeline.tsx");
    const markReadout = read("lib/coherence/use-mark-readout.ts");

    assert.match(equity, /width=\{mc \? 264 : 248\}/);
    assert.match(walkForward, /data-mark-title=\{/);
    assert.doesNotMatch(walkForward, /<title>\{`Fold/);
    assert.match(markReadout, /getAttribute\("data-mark-title"\)/);
    assert.match(markReadout, /querySelectorAll\(MARK_SELECTOR\)/);
  });

  it("labels candidate filtering and keeps its count unambiguous", () => {
    const ranking = read("components/research/CandidateRanking.tsx");
    assert.match(ranking, /placeholder=\{title\}/);
    assert.match(ranking, /aria-label=\{MATCHING_LABEL\}/);
  });

  it("places the regime-method disclosure immediately after the stress-window caveat", () => {
    const regimes = read("components/research/RegimePanel.tsx");
    const footnote = regimes.indexOf("— marks a window outside the loaded bars; extend the bar count to test it.");
    const disclosure = regimes.indexOf('className="disclosure regime-method"');
    const sectionEnd = regimes.indexOf("</section>", footnote);
    assert.ok(footnote >= 0 && disclosure > footnote && sectionEnd > disclosure);
    assert.match(regimes, /\{regimes\.note\}/, "the full quantitative note must remain available");
  });

  it("renders Portfolio and Risk role labels with their explanatory line", () => {
    const panels = read("components/workspace/WorkspacePanels.tsx");
    const portfolio = panels.slice(panels.indexOf('kicker="Portfolio manager"'), panels.indexOf("<PortfolioTab"));
    const risk = panels.slice(panels.indexOf('kicker="Risk manager"'), panels.indexOf("<RiskTab"));
    assert.doesNotMatch(portfolio, /showDescription=\{false\}/);
    assert.doesNotMatch(risk, /showDescription=\{false\}/);
    assert.match(portfolio, /Whether the book is where it was meant to be/);
    assert.match(risk, /How much this book can lose before a limit stops it/);
  });

  it("promotes and top-aligns the three engine identities without moving their controls", () => {
    const css = read("app/globals/14zzi-header-alignment-followup.css");
    assert.match(css, /:is\(\.markets-plane, \.proofs-plane, \.diffusion-plane\) \.page-heading__copy \{[^}]*min-height: 0;[^}]*padding-block: 0;[^}]*justify-content: flex-start;/s);
    assert.match(css, /:is\(\.markets-plane, \.proofs-plane, \.diffusion-plane\) \.page-kicker \{[^}]*font-size: var\(--fs-hero-line\);[^}]*text-transform: none;/s);
    assert.doesNotMatch(css, /:is\(\.markets-plane, \.proofs-plane, \.diffusion-plane\) \.page-heading__actions/);
  });

  it("keeps the announcement recorder facts in aligned, readable columns", () => {
    const watch = read("components/coherence/diffusion/EpisodeWatch.tsx");
    const css = read("app/globals/14zzi-header-alignment-followup.css");
    assert.match(watch, /className="coh-status__chips coh-episode-watch-stats"/);
    assert.match(css, /\.coh-status__chips\.coh-episode-watch-stats\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*grid-auto-rows:\s*minmax\(68px, 1fr\);/s);
    assert.match(css, /\.coh-episode-watch-stats > \*\s*\{[^}]*inline-size:\s*100%;[^}]*min-inline-size:\s*0;/s);
    assert.match(css, /\.coh-episode-watch-stats :is\(\.coh-chip__word, \.coh-chip__value\)\s*\{[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
      "the family list is still clipped or allowed to move the next row");
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 480px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("keeps Diffusion figure focus and caption tools visible at narrow widths", () => {
    const density = read("app/globals/14zzh-interface-density.css");
    const followup = read("app/globals/14zzi-header-alignment-followup.css");
    assert.match(density, /\.coherence-plane\.diffusion-plane \.coh-figure__focus:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--series-1\);[^}]*outline-offset:\s*2px;/s);
    assert.match(density, /\.coh-plot > svg\[tabindex="0"\]:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--series-1\);/s);
    assert.match(followup, /@media \(max-width: 760px\)[\s\S]*?\.coherence-plane\.diffusion-plane \.coh-figure__caption\s*\{[^}]*flex-wrap:\s*wrap;/s);
    assert.match(followup, /\.coherence-plane\.diffusion-plane \.coh-figure__tools\s*\{[^}]*flex-wrap:\s*wrap;[^}]*max-inline-size:\s*100%;/s);
  });

  it("separates composition from the Live DAG and wraps long DAG labels", () => {
    const planes = read("components/systems/ReliabilityPlanes.tsx");
    const dag = read("components/systems/DependencyDag.tsx");
    assert.match(planes, /type DependencyPane = "map" \| "dag" \| "providers" \| "platform" \| "latency"/);
    assert.match(planes, /id: "dag", label: DEPENDENCY_DAG_TITLE/);
    assert.match(planes, /pane === "dag"/);
    assert.match(dag, /dependencyNodeLabelLines/);
    assert.match(dag, /<tspan/);
  });

  it("suppresses one-page log pagination and aligns queue actions to their row", () => {
    const timeline = read("components/systems/TraceTimeline.tsx");
    const queueCss = read("app/globals/14l-work-queues.css");
    const followupCss = read("app/globals/14zzj-layout-review-followup.css");
    assert.match(timeline, /\{pageCount > 1 \? \(/);
    assert.doesNotMatch(timeline, /console-trace-follow-state/);
    assert.match(queueCss, /\.developer-work__table tbody td\s*\{[^}]*vertical-align:\s*middle/s);
    assert.match(
      followupCss,
      /\.developer-work__table tbody :is\(td:nth-child\(3\), td\.developer-work__actions-cell\)\s*\{[^}]*vertical-align:\s*top/s,
    );
    assert.match(followupCss, /\.developer-work__table \.developer-work__delete\s*\{[^}]*block-size:\s*38px/s);
  });

  it("uses tokenised marker insets and card gaps on the two engine workbenches", () => {
    const followupCss = read("app/globals/14zzj-layout-review-followup.css");
    assert.match(followupCss, /\.coherence-plane \.coh-notes\s*\{[^}]*padding-inline-start:\s*var\(--space-5\)/s);
    assert.match(followupCss, /\.coh-notes li \+ li\s*\{[^}]*margin-block-start:\s*var\(--space-2\)/s);
    assert.match(followupCss, /grid-template-columns:\s*0\.75rem minmax\(0, 1fr\)/);
    assert.match(followupCss, /:is\(\.markets-plane, \.proofs-plane\) \.coh-grid\s*\{[^}]*gap:\s*var\(--space-3\)/s);
  });

  it("opens Markets and Proofs diagram-first while retaining authored evidence", () => {
    const markets = read("components/MarketsConsole.tsx");
    const proofs = read("components/CoherenceConsole.tsx");
    const evidence = read("components/coherence/EngineViewEvidence.tsx");
    const density = read("app/globals/14zzh-interface-density.css");

    for (const consoleSource of [markets, proofs]) {
      assert.match(consoleSource, /const \[detailsVisible, setDetailsVisible\] = useState\(false\)/);
      assert.match(consoleSource, /data-workbench-details=\{detailsVisible \? "true" : "false"\}/);
      assert.match(consoleSource, /onDetailsVisibleChange=\{setDetailsVisible\}/);
    }
    assert.match(evidence, /aria-pressed=\{detailsVisible\}/);
    assert.match(evidence, /aria-label=\{DETAILS_LABEL\[/);
    assert.match(evidence, /<FileText aria-hidden="true" \/>/);
    assert.match(evidence, /Technical provenance for the active/);
    assert.match(density, /data-workbench-details="false"/);
    assert.match(density, /\.coh-figure__reading/);
  });

  it("bounds shared popups and adds motion-safe discovery to original Diffusion figures", () => {
    const density = read("app/globals/14zzh-interface-density.css");
    const diffusion = read("components/DiffusionConsole.tsx");

    assert.match(density, /\[data-slot="dialog-content"\],\s*\[data-slot="sheet-content"\]/);
    assert.match(density, /max-height:\s*calc\(100dvh - 2 \* var\(--space-3\)\)/);
    assert.match(density, /\.coherence-plane\.diffusion-plane \.coh-figure:focus-within/);
    assert.doesNotMatch(density, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(diffusion, /ArmSection/);
    assert.match(diffusion, /MeetingsSection/);
    assert.match(diffusion, /EpisodesSection/);
    assert.match(diffusion, /FindingsSection/);
  });

  it("keeps focused figures compact, zoomable and aligned around the live mark", () => {
    const frame = read("components/coherence/FigureDialogFrame.tsx");
    const figure = read("components/coherence/Figure.tsx");
    const evidenceCss = read("app/globals/14z-engine-evidence.css");

    assert.match(frame, /const \[zoom, setZoom\] = useState\(1\)/);
    assert.match(frame, /interactionReadout\?: string/);
    assert.match(frame, /aria-label=\{ZOOM_OUT_FIGURE\}/);
    assert.match(frame, /aria-label=\{ZOOM_IN_FIGURE\}/);
    assert.match(frame, /\{RESET_ZOOM\}/);
    assert.match(frame, /pct\(zoom, 0\)/);
    assert.match(frame, /className=\{focused \? "coh-figure-dialog__body" : "coh-figure__inline-body"\}/);
    assert.match(frame, /onPointerMove=\{movePan\}/);
    assert.match(frame, /\{DRAG_TO_PAN\}/);
    assert.equal(frame.match(/renderBody\(plotId\)/g)?.length, 1,
      "Focus remounts a second chart subtree and loses its crosshair or pin state");
    assert.match(frame, /target\.appendChild\(viewport\)/,
      "the mounted chart is not moved into the dialog host");
    assert.match(
      frame,
      /className="coh-figure-dialog__pan-hint" data-active=\{pannable \? "true" : "false"\}/,
      "the stable drag-hint slot does not follow the measured overflow state",
    );
    assert.match(
      evidenceCss,
      /\.coh-figure-dialog__pan-hint\[data-active="false"\]\s*\{\s*opacity:\s*0;/,
      "the reserved drag-hint slot is visible when the figure has no overflow to pan",
    );
    assert.match(figure, /interactionReadout=\{announced\}/);
    assert.match(evidenceCss, /\.coh-figure-dialog__body/);
    assert.match(evidenceCss, /zoom:\s*var\(--figure-zoom\)/,
      "zoom changes only width instead of scaling both figure axes");
    assert.doesNotMatch(evidenceCss, /min\(70dvh|min\(62dvh/);
  });

  it("uses one analytical interaction grammar across Markets, Proofs and Diffusion", () => {
    const density = read("app/globals/14zzh-interface-density.css");
    assert.match(density, /\.markets-plane,\s*\.proofs-plane,\s*\.diffusion-plane/);
    assert.match(density, /cursor:\s*crosshair/);
    assert.match(density, /background-image:\s*none/);
    assert.doesNotMatch(density, /linear-gradient\(to right/);
    assert.match(density, /\.diffusion-plane \.coh-figure__focus\s*\{[^}]*display:\s*inline-flex/s);
    assert.match(density, /\.diffusion-plane >? .*\.coh-figure__reading/);
    assert.match(density, /\.coh-figure--dialog \.coh-figure__reading/);
  });

  it("extends the opaque sticky rail through the shell gutter", () => {
    const density = read("app/globals/14zzh-interface-density.css");
    assert.match(
      density,
      /\.workspace-subtabs\s*\{[^}]*top:\s*calc\(var\(--space-4\) \* -1 - 1px\)/s,
    );
    assert.match(
      density,
      /\.workspace-subtabs::before\s*\{[^}]*inset-block-start:\s*calc\(var\(--space-4\) \* -1\)/s,
    );
  });
});
