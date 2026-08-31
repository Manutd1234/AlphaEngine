"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BadgeX,
  ChevronRight,
  Clock3,
  Filter,
  LockKeyhole,
  RadioTower,
  Stamp,
  TimerReset,
} from "lucide-react";
import type { CSSProperties } from "react";

import { fmt, pct } from "@/lib/format";
import type { FormationStage } from "./FormationDiagram";
import type { PendingMinute } from "./PendingMinutes";
import { useRovingListbox } from "./use-stable-selection-key";
import styles from "./SettlementInstruments.module.css";

type JourneyStyle = CSSProperties & { "--journey-progress": string };
type SpreadStyle = CSSProperties & { "--spread-fill": string };

const STAGE_META = [
  { label: "Signal source", Icon: RadioTower, tone: "source" },
  { label: "QC gate", Icon: Filter, tone: "quality" },
  { label: "Minute seal", Icon: Stamp, tone: "published" },
  { label: "Fixing clock", Icon: TimerReset, tone: "window" },
] as const;

function mark(holds: boolean | null): string {
  return holds === null ? "◌" : holds ? "✓" : "▲";
}

function stateLabel(holds: boolean | null, index: number): string {
  if (holds === null) return index === 3 ? "Configured convention" : "Not evaluated";
  if (index === 0) return holds ? "Panel observed" : "Panel missing";
  if (index === 1) return holds ? "Rules named" : "Rules missing";
  if (index === 2) return holds ? "Rule reproduced" : "Mismatch found";
  return holds ? "Venue supplied" : "Needs attention";
}

function compactUnit(units: string): string {
  return units.trim().toLowerCase() === "fahrenheit" ? "°F" : units;
}

function compactValue(value: string | null): string {
  const parsed = finite(value);
  return parsed == null ? "—" : fmt(parsed, 2);
}

export function SettlementAssembly({ stages, caption, reading, missing }: {
  stages: FormationStage[];
  caption: string;
  reading?: string | null;
  missing?: string | null;
}) {
  const stageKeys = stages.map((stage, index) => `${index}:${stage.title}`);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(stageKeys);
  const selected = Math.max(0, stageKeys.indexOf(selectedKey ?? ""));
  const active = stages[selected] ?? stages[0];
  const validation = stages[2];

  if (!active) {
    return (
      <figure className={styles.instrument} aria-label="No settlement transformation was returned">
        <figcaption className={styles.head}>
          <span><small>Settlement machine</small>{caption}</span><strong>empty</strong>
        </figcaption>
        <p className={styles.empty}>◌ No settlement transformation was returned.</p>
      </figure>
    );
  }

  const progress = stages.length <= 1 ? 1 : selected / (stages.length - 1);
  const next = (selected + 1) % stages.length;
  const nextLabel = stages[next]?.title ?? stages[0].title;
  const ValidationIcon = validation?.holds ? BadgeCheck : BadgeX;

  return (
    <figure
      className={styles.instrument}
      aria-label={stages.map((stage) => `${stage.title}: ${stage.value ?? "not measured"}`).join(". ")}
    >
      <figcaption className={styles.machineHead}>
        <span className={styles.machineTitle}>
          <small>Formation</small>
          <strong>{caption}</strong>
          <em>Select any step to see its detail</em>
        </span>
        <span className={styles.machineActions}>
          <span className={styles.verification} data-holds={validation?.holds ? "yes" : "no"}>
            <ValidationIcon aria-hidden="true" />
            <span><small>Rule check</small><strong>{validation ? `${validation.value ?? "not measured"} matched` : "Not measured"}</strong></span>
          </span>
          <button type="button" onClick={() => setSelectedKey(stageKeys[next])}>
            {selected === stages.length - 1 ? "Restart trace" : "Trace next"} <ArrowRight aria-hidden="true" /><span className="sr-only">: {nextLabel}</span>
          </button>
        </span>
      </figcaption>

      <div
        className={styles.machineCanvas}
        style={{ "--journey-progress": pct(progress, 1) } as JourneyStyle}
      >
        <div className={styles.signalRail} aria-hidden="true"><span /></div>
        <div className={styles.assembly} role="listbox" aria-label="Trace the settlement formation stages">
          {stages.map((stage, index) => {
            const meta = STAGE_META[index] ?? STAGE_META[STAGE_META.length - 1];
            const Icon = meta.Icon;
            return (
              <div className={styles.stageSlot} role="presentation" key={stageKeys[index]}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedKey === stageKeys[index]}
                  aria-label={`Stage ${index + 1}, ${stage.title}: ${stage.value ?? "not measured"}; ${stateLabel(stage.holds, index)}`}
                  className={styles.stage}
                  data-tone={meta.tone}
                  data-holds={stage.holds === null ? "unknown" : stage.holds ? "yes" : "no"}
                  data-passed={index <= selected || undefined}
                  {...optionProps(stageKeys[index], index)}
                  onClick={() => setSelectedKey(stageKeys[index])}
                >
                  <span className={styles.stageTopline}><b>{String(index + 1).padStart(2, "0")}</b><small>{mark(stage.holds)} {stateLabel(stage.holds, index)}</small></span>
                  <span className={styles.stageMain}>
                    <span className={styles.stageGlyph} aria-hidden="true"><Icon /></span>
                    <span className={styles.stageCopy}>
                      <small>{meta.label}</small>
                      <strong>{stage.title}</strong>
                      <span className="num">{stage.value ?? "—"}</span>
                    </span>
                  </span>
                </button>
                {index < stages.length - 1 ? (
                  <span className={styles.stageArrow} data-state={index < selected ? "passed" : index === selected ? "current" : "future"} aria-hidden="true">
                    <ArrowRight />
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.stageReadout}>
        <div className={styles.stageDetail}>
          <small>Step {selected + 1} of {stages.length} — {stateLabel(active.holds, selected)}</small>
          <span className={styles.detailTitle}><b aria-hidden="true">{mark(active.holds)}</b><strong>{active.title}</strong><span className="num">{active.value ?? "not measured"}</span></span>
          <p>{active.note}</p>
        </div>
        <div className={styles.handoff}>
          <small>Hands off to</small>
          <strong>{selected === stages.length - 1 ? "Contract fixing" : stages[selected + 1].title}</strong>
          <span className={styles.progressDots} aria-hidden="true">
            {stages.map((stage, index) => <i key={stage.title} data-current={index === selected || undefined} data-passed={index < selected || undefined} />)}
          </span>
        </div>
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {`Stage ${selected + 1} of ${stages.length}, ${active.title}, ${active.value ?? "not measured"}. ${stateLabel(active.holds, selected)}. ${active.note}`}
      </output>

      {reading ? <p className={styles.reading}><Activity aria-hidden="true" /> {reading}</p> : null}
      {missing ? <p className={styles.missing}>◌ {missing}</p> : null}
    </figure>
  );
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

function finite(value: string | null | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A labelled 1, 2, 5 scale with headroom, so one row never defines itself as 100%. */
export function niceSpreadCeiling(values: readonly (number | null)[]): number {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  const maximum = valid.length ? Math.max(...valid) : 0;
  if (maximum <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(maximum));
  const fraction = maximum / power;
  return (fraction < 2 ? 2 : fraction < 5 ? 5 : 10) * power;
}

function deltaLabel(left: string | null, right: string | null, units: string): string {
  const a = finite(left);
  const b = finite(right);
  if (a == null || b == null) return "—";
  const delta = a - b;
  if (delta === 0) return `0.00 ${units}`;
  if (Math.abs(delta) < 0.005) return `<0.01 ${units} ${delta > 0 ? "above" : "below"}`;
  return `${delta > 0 ? "+" : ""}${fmt(delta, 2)} ${units}`;
}

export interface PendingBoardContext {
  latestValue: string | null;
  windowAverage: string | null;
  windowMinutes: number;
  windowIsAssumed: boolean;
  formationHolds: boolean;
  formationAgreed: number;
  formationChecked: number;
}

export function PendingBoard({ rows, units, context }: {
  rows: PendingMinute[];
  units: string;
  context: PendingBoardContext;
}) {
  const ordered = [...rows].sort((a, b) => a.ts_ms - b.ts_ms);
  const minuteKeys = ordered.map((row) => String(row.ts_ms));
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(minuteKeys, minuteKeys.at(-1));
  const selected = Math.max(0, minuteKeys.indexOf(selectedKey ?? ""));
  const active = ordered[selected] ?? ordered[0];

  if (!active) {
    return (
      <figure className={styles.instrument} aria-label="No computable unpublished settlement minute was returned">
        <figcaption className={styles.head}>
          <span><small>Publication queue</small>Reported minutes waiting for an exchange seal</span><strong>0 returned</strong>
        </figcaption>
        <div className={styles.emptyQueue}>
          <Clock3 aria-hidden="true" /><strong>No computable minute was returned</strong><p>This read found no unpublished minute with usable station data.</p>
        </div>
      </figure>
    );
  }

  const parsedSpreads = ordered.map((row) => finite(row.spread));
  const ceiling = niceSpreadCeiling(parsedSpreads);
  const activeSpread = finite(active.spread);
  const knownSpreads = parsedSpreads.filter((value): value is number => value != null);
  const largestKnown = activeSpread != null && knownSpreads.length > 1 && activeSpread === Math.max(...knownSpreads);

  return (
    <figure className={styles.instrument} aria-label={`${ordered.length} reported minutes waiting for publication`}>
      <figcaption className={styles.pendingHead}>
        <span className={styles.pendingTitle}><small>Pending</small><strong>Minutes waiting to publish</strong><em>Select a minute to compare it with the published index</em></span>
        <span className={styles.queueCount}><Clock3 aria-hidden="true" /><strong>{ordered.length}</strong> waiting</span>
      </figcaption>

      <div className={styles.sealRoute} role="list" aria-label="Possible publication path: reported, quality control, then exchange seal">
        <span role="listitem" data-state="complete"><RadioTower aria-hidden="true" /><small>01 — received</small><strong>Reported</strong></span>
        <i aria-hidden="true"><ChevronRight /></i>
        <span role="listitem" data-state="possible"><Filter aria-hidden="true" /><small>02 — next</small><strong>QC review</strong></span>
        <i aria-hidden="true"><ChevronRight /></i>
        <span role="listitem" data-state="waiting"><LockKeyhole aria-hidden="true" /><small>03 — waiting</small><strong>Exchange seal</strong></span>
      </div>

      <div className={styles.queueShelf} role="listbox" aria-label="Inspect a pending publication minute">
        {ordered.map((row, index) => {
          const spread = parsedSpreads[index];
          const fill = spread == null ? null : Math.max(0, Math.min(1, spread / ceiling));
          return (
            <button
              type="button"
              role="option"
              aria-selected={selectedKey === minuteKeys[index]}
              aria-label={`${clock(row.ts_ms)} UTC, provisional index ${row.provisional ?? "not measured"}, station spread ${row.spread == null ? "not measured" : `${row.spread} ${units}`}, ${row.stations} station records`}
              key={row.ts_ms}
              className={styles.minuteTicket}
              data-spread={spread == null ? "unknown" : "known"}
              style={{ "--spread-fill": fill == null ? "0%" : pct(fill, 1) } as SpreadStyle}
              {...optionProps(minuteKeys[index], index)}
              onClick={() => setSelectedKey(minuteKeys[index])}
            >
              <span className={styles.ticketTop}><small>{clock(row.ts_ms)} UTC</small><b>{index + 1}</b></span>
              <span className={styles.ticketValue}><small>Provisional index</small><strong className="num">{compactValue(row.provisional)}</strong></span>
              <span className={styles.spreadRuler} aria-hidden="true"><i><b /></i><small>Spread 0</small><small>{ceiling} {compactUnit(units)}</small></span>
              <span className={styles.ticketFoot}><span>{row.spread == null ? "◌ Spread unavailable" : `↔ ${compactValue(row.spread)} ${compactUnit(units)}`}</span><span>{row.stations} stations</span></span>
            </button>
          );
        })}
      </div>

      <div className={styles.pendingReadout}>
        <span className={styles.provisionalHero}>
          <small>Selected — {clock(active.ts_ms)} UTC</small>
          <strong className="num">{compactValue(active.provisional)}</strong>
          <span>Provisional index — {active.stations} stations</span>
        </span>
        <dl className={styles.comparisonGrid}>
          <div data-reading="spread"><dt>Station spread</dt><dd className="num">{active.spread == null ? "—" : `${compactValue(active.spread)} ${compactUnit(units)}`}</dd><small>{active.spread == null ? "Not reported." : largestKnown ? "Widest in this queue." : `Scale: 0–${ceiling} ${compactUnit(units)}.`}</small></div>
          <div data-reading="latest"><dt>Latest index</dt><dd className="num">{deltaLabel(active.provisional, context.latestValue, compactUnit(units))}</dd><small>{context.latestValue == null ? "No comparison available." : `Published ${compactValue(context.latestValue)}.`}</small></div>
          <div data-reading="mean"><dt>{context.windowMinutes}-minute mean</dt><dd className="num">{deltaLabel(active.provisional, context.windowAverage, compactUnit(units))}</dd><small>{context.windowAverage == null ? "No mean available." : `${context.windowIsAssumed ? "Configured" : "Current"} ${compactValue(context.windowAverage)}.`}</small></div>
        </dl>
        <div className={styles.evidenceBadge} data-holds={context.formationHolds ? "yes" : "no"}>
          {context.formationHolds ? <BadgeCheck aria-hidden="true" /> : <BadgeX aria-hidden="true" />}
          <div><small>Formation check</small><strong>{mark(context.formationHolds)} {context.formationAgreed} / {context.formationChecked} minutes matched</strong><p>QC may still change the inputs before publication.</p></div>
        </div>
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {`${clock(active.ts_ms)} UTC, provisional index ${active.provisional ?? "not measured"}, station spread ${active.spread == null ? "not measured" : `${active.spread} ${units}`}, ${active.stations} station records in this minute.`}
      </output>

      <p className={styles.reading}><Activity aria-hidden="true" /> Provisional values use received station reports; they are not forecasts.</p>
      {active.spread == null ? <p className={styles.missing}>◌ A minute without a published spread stays dashed rather than a zero-length bar.</p> : null}
    </figure>
  );
}
