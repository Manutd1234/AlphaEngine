/** Regression contract for Diffusion's sparse deployments and deep links. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { returnFanReading } from "../components/coherence/diffusion/ReturnFan";
import { layoutGapFloors } from "../components/coherence/diffusion/InstrumentThreshold";
import {
  DIFFUSION_SPARSE_SPECS,
  sampleStateLabel,
} from "../components/coherence/diffusion/DiffusionSparseState";
import { defaultView, locationHash, railView, viewsFor } from "../lib/section-views";
import { read, stripNonCode } from "./helpers/workspace-sources";

const DESTINATIONS = {
  arm: [["absorption", "Absorption"], ["floor", "Control"], ["clocks", "Clocks"]],
  meetings: [["table", "Meeting by meeting"], ["calendar", "Calendar"], ["mechanism", "Mechanism"]],
  episodes: [["survival", "Survival"], ["episodes", "Episodes"]],
  model: [["measurement", "Measurement"]],
  instrument: [["instrument", "Instrument"]],
  sandbox: [["halflife", "Half-life"], ["simulator", "Simulator"], ["spectrum", "Spectrum"]],
  findings: [["plot", "Effect plot"], ["table", "Findings table"], ["instrument", "Instrument"]],
} as const;

const RENDER_CLASS = {
  "arm/absorption": "sparse-capable",
  "arm/floor": "sparse-capable",
  "arm/clocks": "sparse-capable",
  "meetings/table": "sparse-capable",
  "meetings/calendar": "sparse-capable",
  "meetings/mechanism": "static",
  "episodes/survival": "sparse-capable",
  "episodes/episodes": "sparse-capable",
  "model/measurement": "static",
  "instrument/instrument": "static",
  "sandbox/halflife": "static",
  "sandbox/simulator": "static",
  "sandbox/spectrum": "static",
  "findings/plot": "sparse-capable",
  "findings/table": "sparse-capable",
  "findings/instrument": "static",
} as const;

describe("all sixteen Diffusion destinations have one canonical address", () => {
  it("declares the complete section/view matrix from one registry", () => {
    let count = 0;
    for (const [section, expected] of Object.entries(DESTINATIONS)) {
      assert.deepEqual(viewsFor("diffusion", section), expected, `${section} is not canonical`);
      count += expected.length;
    }
    assert.equal(count, 16);
  });

  it("keeps default links short and resolves every non-default link", () => {
    for (const [section, views] of Object.entries(DESTINATIONS)) {
      assert.equal(defaultView("diffusion", section), views[0][0]);
      assert.equal(locationHash("diffusion", section, views[0][0]), `diffusion/${section}`);
      for (const [view] of views.slice(1)) {
        assert.equal(locationHash("diffusion", section, view), `diffusion/${section}/${view}`);
        assert.equal(railView("diffusion", section, view), view);
      }
      assert.equal(railView("diffusion", section, "retired"), views[0][0]);
    }
  });

  it("wires the registry through routing and into the Diffusion console", () => {
    const rails = read("../lib/use-rail-sections.ts");
    const routing = read("../lib/use-workspace-routing.ts");
    const panels = read("../components/workspace/EnginePanels.tsx");
    const console_ = read("../components/DiffusionConsole.tsx");

    assert.match(rails, /diffusion: bind\(DIFFUSION_SECTION_IDS, setDiffusionSection, "diffusion"\)/);
    assert.match(routing, /useViewWriter\([^;]+"diffusion", setSectionView\)/);
    assert.match(panels, /views=\{sectionViews\.diffusion \?\? \{\}\}/);
    assert.match(panels, /setSectionView\("diffusion", section, next\)/);
    assert.match(console_, /views: Record<string, string>/);
    assert.match(console_, /onViewChange: \(section: string, view: string\) => void/);
  });

  it("classifies every destination as static or sparse-capable", () => {
    const routes = Object.entries(DESTINATIONS)
      .flatMap(([section, views]) => views.map(([view]) => `${section}/${view}`))
      .sort();
    assert.deepEqual(Object.keys(RENDER_CLASS).sort(), routes);
    assert.equal(Object.values(RENDER_CLASS).filter((value) => value === "static").length, 7);
    assert.equal(Object.values(RENDER_CLASS).filter((value) => value === "sparse-capable").length, 9);
  });

  it("renders component-owned figures rather than historical screenshot assets", () => {
    const sources = [
      read("../components/DiffusionConsole.tsx"),
      ...[
        "InformationDiffusionPane", "MeetingsSection", "KalshiArm", "ModelSection",
        "InstrumentSection", "SandboxSection", "FindingsPane",
      ].map((file) => read(`../components/coherence/diffusion/${file}.tsx`)),
    ].join("\n");
    assert.doesNotMatch(sources, /diffusion-now|s4-fan2|s6-watch|s7-head|\.png/i);
    assert.match(sources, /<Figure|<ModelFormulas|<HalfLifeCalculator/);
  });
});

describe("sparse Diffusion reads remain truthful and visible", () => {
  it("keeps unresolved leading horizons inside the return-fan domain", () => {
    const fan = stripNonCode(read("../components/coherence/diffusion/ReturnFan.tsx"));
    assert.match(fan, /index\s*\/\s*\(horizons\.length\s*-\s*1\)/);
    assert.match(fan, /width=\{Math\.max\(0, x\(firstMeasured\) - left\)\}/);
    assert.doesNotMatch(fan, /returnFanXFraction/);
  });

  it("distinguishes an unread sample from zero samples and one sample", () => {
    assert.equal(sampleStateLabel(null), "sample unavailable");
    assert.equal(sampleStateLabel(0), "n 0");
    assert.equal(sampleStateLabel(1), "n 1");
  });

  it("keeps a structural contract for every data-driven sparse destination", () => {
    assert.deepEqual(Object.keys(DIFFUSION_SPARSE_SPECS), [
      "absorption", "paths", "floor", "control", "clocks", "meetings",
      "calendar", "survival", "episodes", "effects", "matrix",
    ]);
    for (const [kind, spec] of Object.entries(DIFFUSION_SPARSE_SPECS)) {
      assert.equal(spec.steps.length, 3, `${kind} has no input-estimator-output structure`);
      assert.ok(spec.axis.length >= 2, `${kind} has no scale or stage axis`);
    }
    assert.deepEqual(DIFFUSION_SPARSE_SPECS.survival.gates, [
      { at: 2, label: "curve" },
      { at: 8, label: "median" },
    ]);
  });

  it("uses the original pressed-button control for every routed multi-view section", () => {
    const control = read("../components/coherence/diffusion/DiffusionViewControl.tsx");
    assert.doesNotMatch(control, /ToggleGroup/);
    assert.match(control, /role="group"/);
    assert.match(control, /aria-pressed=\{value === name\}/);
    for (const file of ["ArmSection", "MeetingsSection", "EpisodesSection", "SandboxSection", "FindingsPane"]) {
      assert.match(
        read(`../components/coherence/diffusion/${file}.tsx`),
        /<DiffusionViewControl\b/,
        `${file} still hand-rolls its view controls`,
      );
    }
  });

  it("reserves responsive plot geometry for sparse figures", () => {
    const css = read("../app/globals/14zzc-diffusion-workbench.css");
    assert.match(css, /\.diff-sparse\s*\{[^}]*min-block-size:/s);
    assert.match(css, /\.diff-sparse__svg\s*\{[^}]*block-size:/s);
    assert.match(css, /\.diff-sparse__svg\s*\{[^}]*min-inline-size:\s*0/s);
    assert.match(css, /\.diff-sparse__svg\s*\{[^}]*max-inline-size:\s*100%/s);
    assert.doesNotMatch(css, /\.diff-sparse__svg\s*\{[^}]*min-inline-size:\s*34rem/s);
    assert.match(css, /@media \(max-width: 720px\)/);
    assert.doesNotMatch(css, /prefers-reduced-motion|forced-colors/,
      "the shared global accessibility blocks are the only owners of these media queries");
  });

  it("zero paths make no universal claim", () => {
    assert.equal(returnFanReading({ pathCount: 0, refused: 0, refusedPeak: null, clearedPeak: null }), null);
    assert.equal(
      returnFanReading({ pathCount: 1, refused: 0, refusedPeak: null, clearedPeak: 12 }),
      "Every recorded run cleared the noise floor.",
    );
  });

  it("zero absorption rows do not claim a populated control arm", () => {
    const console_ = read("../components/DiffusionConsole.tsx");
    assert.match(console_, /runs\.some\(\(run\) => run\.controls_used > 0\)/,
      "the head never checks whether a matched control window exists");
    assert.match(console_, /configured, empty/,
      "a configured ledger with zero controls has no state of its own");
    assert.match(console_, /including refusals/,
      "Runs recorded still describes only measured stages although it counts every run");
  });

  it("Findings Instrument draws its six structural gates when no study exists", () => {
    const paneSource = read("../components/coherence/diffusion/FindingsPane.tsx");
    const pane = stripNonCode(paneSource);
    const fitSource = read("../components/coherence/diffusion/InstrumentFit.tsx");
    const fit = stripNonCode(fitSource);
    assert.doesNotMatch(pane, /\{study \? \([\s\S]*?<InstrumentFit[\s\S]*?\) : null\}/,
      "a missing study still removes the whole instrument");
    assert.match(pane, /<InstrumentFit study=\{study\} gate=\{gate\} absenceReason=\{studyAbsenceReason\}/);
    assert.match(fit, /study: DiffusionStudy \| null/);
    assert.match(fit, /absenceReason: string/);
    assert.match(paneSource, /study has not been built|study was not built/i);
    assert.match(paneSource, /study could not be read/i,
      "an unavailable backend is currently reported as if the study did not exist");
  });

  it("backend failure cannot gate the mechanism or browser-computed sections", () => {
    const meetings = stripNonCode(read("../components/coherence/diffusion/MeetingsSection.tsx"));
    assert.ok(meetings.indexOf('view === "mechanism"') < meetings.indexOf("absorptionNotice(data, error)"),
      "the static mechanism is hidden behind the backend notice");

    for (const file of ["ModelSection", "InstrumentSection", "SandboxSection"]) {
      const source = read(`../components/coherence/diffusion/${file}.tsx`);
      assert.doesNotMatch(source, /useCoherenceRead|fetch\(|absorptionRoute|findingsRoute|episodesRoute/,
        `${file} became dependent on the backend`);
    }
  });

  it("every data-dependent sparse branch names the missing sample instead of returning a blank frame", () => {
    const files = [
      "InformationDiffusionPane", "FloorDistance", "ControlRank", "ClockAgreement",
      "MeetingTable", "MeetingCalendar", "KalshiArm", "EffectField", "EvidenceMatrix", "InstrumentThreshold",
    ];
    for (const file of files) {
      const source = read(`../components/coherence/diffusion/${file}.tsx`);
      assert.match(source, /DiffusionSparseState|FigureEmpty|EpisodeWatch|EpisodeTape|MeetingsEmpty/,
        `${file} has no structural or named empty state`);
    }
  });

  it("keeps the restored Diffusion figures inside a phone-width owner", () => {
    for (const file of ["StageWindows", "EffectField", "EvidenceMatrix", "InstrumentThreshold"]) {
      const source = read(`../components/coherence/diffusion/${file}.tsx`);
      assert.doesNotMatch(source, /<Plot[^>]*minWidth=\{(?:520|560)\}/,
        `${file} still forces its SVG beyond the mobile figure boundary`);
    }
    const threshold = read("../components/coherence/diffusion/InstrumentThreshold.tsx");
    assert.match(threshold, /className="diff-thresh__legend"/,
      "the instrument key is still trapped in the fixed-width SVG instead of reflowing below it");
    assert.match(threshold, /width - MARGIN\.left - GAP_LABEL_RAIL/,
      "the no-reading caption has no reserved rail beside the threshold field");
    assert.match(threshold, /className="diff-thresh__gaplabel"[\s\S]*?x=\{x\(1\) \+ GAP_LABEL_GAP\}[\s\S]*?textAnchor="start"/,
      "the no-reading caption is still anchored over the rightmost absent capsule");
  });

  it("packs all six missing readings without capsule or caption collisions", () => {
    const placements = layoutGapFloors([0, 0.9, 0.9, 0, 0, 0], 96);
    assert.equal(placements.length, 6);
    for (const lane of [0, 1]) {
      const offsets = placements
        .filter((placement) => placement.lane === lane)
        .map((placement) => placement.offset)
        .sort((left, right) => left - right);
      for (let index = 1; index < offsets.length; index += 1) {
        assert.ok(offsets[index] - offsets[index - 1] >= 33,
          `lane ${lane} still contains overlapping missing-reading capsules`);
      }
    }
    assert.ok(Math.max(...placements.map((placement) => placement.offset)) <= 81,
      "a missing-reading capsule entered the caption rail");
  });

  it("keeps the empty episode watch fluid instead of creating an unnamed scrollport", () => {
    const watch = read("../components/coherence/diffusion/EpisodeWatch.tsx");
    // This timeline derives every x coordinate from Plot's measured width; it
    // has no fixed label gutter that needs a floor. A 420px minimum therefore
    // only pushed the SVG 118px past its 302px owner at 390px viewport width.
    assert.match(watch, /<Plot height=\{HEIGHT\}>/);
    assert.doesNotMatch(watch, /<Plot[^>]*minWidth=/,
      "the sparse survival state has regained a fixed-width horizontal overflow");
  });

  it("keeps a view-specific figure beneath loading, error and unconfigured notices", () => {
    const arm = stripNonCode(read("../components/coherence/diffusion/InformationDiffusionPane.tsx"));
    assert.doesNotMatch(arm, /if\s*\(!absorptionReady\(read\)\)\s*return notice/,
      "the announcement arm still replaces every view with one text line");
    assert.match(arm, /function UnavailableArmFigure[\s\S]*?<Figure[\s\S]*?<FigureEmpty/,
      "the announcement arm has no honest visual frame while its ledger is unreadable");
    assert.match(arm, /if\s*\(!absorptionReady\(read\)\)\s*\{[\s\S]*?return\s*\([\s\S]*?\{notice\}[\s\S]*?<UnavailableArmFigure/,
      "the announcement arm does not keep its existing notice above the structural figure");

    const episodes = stripNonCode(read("../components/coherence/diffusion/KalshiArm.tsx"));
    assert.doesNotMatch(episodes, /if\s*\(!data\)\s*return\s*<p/,
      "the episode arm still replaces both views with loading text");
    assert.match(episodes, /if\s*\(!data\)\s*return\s*\([\s\S]*?\{notice\}[\s\S]*?view === ""[\s\S]*?<Figure[\s\S]*?<DiffusionSparseState[\s\S]*?EpisodeTape/,
      "the episode views do not retain their own visual structures under the notice");

    const meetings = stripNonCode(read("../components/coherence/diffusion/MeetingsSection.tsx"));
    assert.doesNotMatch(meetings, /if\s*\(!absorptionReady\(data\)\)\s*return notice/,
      "the meeting views still collapse to one text line");
    assert.match(meetings, /if\s*\(!absorptionReady\(data\)\)\s*return\s*\([\s\S]*?\{notice\}[\s\S]*?MeetingCalendar[\s\S]*?MeetingTable/,
      "calendar and meeting-ledger states are not kept visible under the notice");

    const calendar = stripNonCode(read("../components/coherence/diffusion/MeetingCalendar.tsx"));
    assert.match(calendar, /read: AbsorptionRead \| null/);
    assert.ok(calendar.indexOf("if (!read?.runs.length)") < calendar.indexOf("toISOString"),
      "an empty calendar still derives dates from an empty timestamp set");
  });
});

describe("Diffusion source-derived summary copy has a measured density budget", () => {
  it("reduces section-header properties by ten to fifteen per cent", () => {
    const files = [
      "../components/DiffusionConsole.tsx",
      "../components/coherence/diffusion/ArmSection.tsx",
      "../components/coherence/diffusion/MeetingsSection.tsx",
      "../components/coherence/diffusion/EpisodesSection.tsx",
      "../components/coherence/diffusion/ModelSection.tsx",
      "../components/coherence/diffusion/InstrumentSection.tsx",
      "../components/coherence/diffusion/SandboxSection.tsx",
      "../components/coherence/diffusion/FindingsSection.tsx",
    ];
    const words = files.reduce((total, file) => {
      const source = read(file);
      const copy = [...source.matchAll(/(?:kicker|title|note|description|lede)="([^"]+)"/g)]
        .map((match) => match[1]);
      return total + copy.join(" ").trim().split(/\s+/).filter(Boolean).length;
    }, 0);
    const before = 340;
    const reduction = (before - words) / before;
    assert.ok(reduction >= 0.10, `only ${(reduction * 100).toFixed(1)}% shorter (${words} words)`);
    assert.ok(reduction <= 0.15, `${(reduction * 100).toFixed(1)}% shorter loses too much context (${words} words)`);
  });
});
