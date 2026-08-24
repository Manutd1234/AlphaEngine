"use client";

/**
 * Kalshi's parlays, against the bands their own legs impose.
 *
 * This is the one relation on the exchange that is stated rather than inferred:
 * a combo ticker carries its legs, so the conjunction is not a guess. It is
 * also the relation that pins down the least. The legs give a band and never a
 * price, and the pane is built around that gap rather than around a verdict.
 *
 * The failure mode this pane avoids is a reader taking "inside the band" for
 * "fairly priced". They are not the same claim and the second is not available:
 * every price between the two bounds is consistent with some dependence between
 * the legs, and nothing on this exchange quotes dependence. So the band width
 * leads, the position inside the band is called a position, and "mispriced"
 * appears only where a price is outside its band and a portfolio proves it.
 *
 * The second failure mode is the ask. Parlays are quoted one-sided almost
 * without exception — nobody bids for a parlay — so `price_basis` is "ask" and
 * the bounds are built from leg MIDS. A parlay priced above Πpᵢ is therefore
 * the expected reading even under independence, and calling that "positive
 * dependence" would be reading the maker's margin as information about the
 * world. `basisCaveat` says so ONCE per basis: as the band figure's `missing`
 * line, and once under Notes. It used to print again forty pixels above that
 * figure, on all six cards.
 *
 * Four views, one `.seg` — never a nested `<WorkspaceSubtabs>` — over ONE read.
 * The poll is gated on `active` alone, so switching view re-costs nothing: a
 * combos read is a book call per leg on top of its own and takes 25s.
 */

import { useState } from "react";

import type { CoherenceCombo, CoherenceComboLeg, CoherenceComboRow, CoherenceCombos } from "@/lib/coherence/types-lab";
import { priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import { combosRoute } from "@/lib/coherence/routes";
import PaneHead, { PaneHeadEmpty } from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FrechetBand, { DEPENDENCE_WORD, basisCaveat, probLabel, toUnit } from "./FrechetBand";
import { StateChip } from "./Figure";

const FORMULA = "max(0, Σpᵢ − (n−1))  ≤  P(all legs)  ≤  min pᵢ";

/** Said on the card whose Πpᵢ is missing, and once under Notes. Never both. */
const NO_INDEPENDENCE =
  "At least one leg is unquoted on the side the parlay needs, so Πpᵢ has no value and neither do the bounds. That is a missing quote, not a probability of zero.";

type ComboView = "bands" | "parlays" | "bounds" | "notes";

/** Where in the band a price sits, as prose. A location, never a verdict. */
function positionSentence(combo: CoherenceCombo): string {
  const position = toUnit(combo.band_position);
  if (position == null) {
    return combo.price == null
      ? "No position in the band: the parlay carries no price on either side, so there is nothing to place."
      : "No position in the band: the band has no width here, so there is no fraction to take.";
  }
  if (position < 0 || position > 1) {
    return "Quoted outside the band its legs allow, which is the only reading on this pane that is a mispricing.";
  }
  return `Quoted ${Math.round(position * 100)}% of the way from the lower bound to the upper, which is a location in the band and not a verdict on it.`;
}

function LegTable({ combo }: { combo: CoherenceCombo }) {
  const unpriced = combo.legs.filter((leg) => leg.probability == null).length;
  return (
    <details className="coh-combo__legs" open={combo.legs.length <= 6}>
      <summary>{`The ${combo.legs.length} legs, and what each side of each one costs`}</summary>
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Implied p is the mid of the side the parlay needs, and it is what both bounds are built from. Buy cost is
            the offer on that same side; opposite cost is the offer on the other one, which the cover portfolio pays.
          </caption>
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Must land</th>
              <th scope="col" className="num">Implied p</th>
              <th scope="col" className="num">Buy cost</th>
              <th scope="col" className="num">Opposite cost</th>
            </tr>
          </thead>
          <tbody>
            {combo.legs.map((leg, index) => (
              <tr key={`${leg.ticker}-${leg.side}-${index}`}>
                <th scope="row">{leg.ticker}</th>
                <td>
                  <span className="coh-combo__side">{leg.side}</span>
                </td>
                <td className="num">{priceLabel(leg.probability)}</td>
                <td className="num">{priceLabel(leg.buy_cost)}</td>
                <td className="num">{priceLabel(leg.opposite_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unpriced ? (
        <p className="coh-combo__note">
          {`${unpriced} of these legs show a dash for implied p. That is an unquoted side, not a zero probability, and it is why this parlay has no band.`}
        </p>
      ) : null}
    </details>
  );
}

function RowLegs({ legs }: { legs: CoherenceComboLeg[] }) {
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          The portfolio this bound is tested with. Cost is carried only for the legs bought, so a sold leg shows a
          dash: its price is absent from the payload, not zero.
        </caption>
        <thead>
          <tr>
            <th scope="col">Leg</th>
            <th scope="col">Direction</th>
            <th scope="col">Side</th>
            <th scope="col" className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {legs.map((leg, index) => (
            <tr key={`${leg.ticker}-${index}`}>
              <th scope="row">{leg.label || leg.ticker}</th>
              <td>{leg.buy_cost == null ? "Sell" : "Buy"}</td>
              <td>
                <span className="coh-combo__side">{leg.side}</span>
              </td>
              <td className="num">{priceLabel(leg.buy_cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every shown bound in one table, a row each.
 *
 * These four numbers used to be a `<dl>` inside each row block, so two violated
 * rows arrived as two free-standing lists and no column could be read down.
 */
function RowFacts({ rows }: { rows: CoherenceComboRow[] }) {
  const untested = rows.some((row) => row.cost == null || row.slack == null);
  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          One row per bound, so the four numbers can be read down a column. Slack is the portfolio's cost minus the
          bound it is tested against: negative is the violation, and how large it is before fees.
          {untested ? " A dash in cost or slack means a leg lost its quote between the read and this row, so the claim was not tested. It is not a cost of nothing." : ""}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="num">Bound</th>
            <th scope="col" className="num">Portfolio cost</th>
            <th scope="col" className="num">Slack</th>
            <th scope="col">Scope</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`facts-${index}`}>
              <th scope="row" className="num">{priceLabel(row.bound)}</th>
              <td className="num">{priceLabel(row.cost)}</td>
              <td className="num">{priceLabel(row.slack)}</td>
              <td>{row.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowBlock({ row, tightest }: { row: CoherenceComboRow; tightest: boolean }) {
  const mark = row.violated ? "▲" : "●";
  const word = row.violated ? "Violated, a Dutch book before fees" : tightest ? "Satisfied, and the closest of them" : "Satisfied";
  return (
    <div className="coh-combo__row">
      <p className="coh-combo__because">
        <span aria-hidden="true">{mark}</span> {word}: {row.because}
      </p>
      <RowLegs legs={row.legs} />
    </div>
  );
}

function ComboChips({ combo }: { combo: CoherenceCombo }) {
  const inside = combo.inside_band;
  return (
    <div className="coh-combo__chips">
      <StateChip mark={inside == null ? "◌" : inside ? "●" : "▲"}
                 word={inside == null ? "Unquoted, nothing to place" : inside ? "Inside the band" : "Outside the band"}
                 value={combo.price == null ? null : priceLabel(combo.price)}
                 tone={inside == null ? "muted" : inside ? "good" : "critical"} />
      <StateChip mark="◇" word="Band width" value={priceLabel(combo.band_width)} tone="muted" />
      {combo.independence == null ? (
        <StateChip mark="◌" word="No independence figure" tone="muted" />
      ) : (
        <>
          <StateChip mark="○" word="Independence Πpᵢ" value={probLabel(combo.independence)} tone="muted" />
          <StateChip mark="◇" word={DEPENDENCE_WORD[combo.dependence] ?? combo.dependence} tone="muted" />
        </>
      )}
    </div>
  );
}

function ComboCard({ combo }: { combo: CoherenceCombo }) {
  return (
    <article className="coh-combo">
      <h5 className="coh-combo__title">{combo.ticker}</h5>
      <p className="coh-combo__meta">
        {`${combo.legs.length} legs, ${combo.scope}, listed in ${combo.collection_ticker || "no collection"}`}
      </p>
      <p className="coh-combo__legend">{combo.label}</p>

      <ComboChips combo={combo} />
      {/* The ask caveat is NOT repeated here: FrechetBand prints it as the
          figure's `missing` line, forty pixels below. */}
      {combo.independence == null ? <p className="coh-combo__caveat">{NO_INDEPENDENCE}</p> : null}

      <FrechetBand reading={combo} />
      <p className="coh-combo__where">{positionSentence(combo)}</p>
      <LegTable combo={combo} />
    </article>
  );
}

function BandsView({ combos }: { combos: CoherenceCombo[] }) {
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">The bands, and where each price sits</h4>
      <p className="coh-combos__lead">
        The band&rsquo;s width is how far the parlay can move with no leg price moving at all. Only a price OUTSIDE it
        is a Dutch book, and each one arrives with the portfolio that proves it.
      </p>
      {combos.map((combo) => (
        <div className="coh-combo__row" key={combo.ticker}>
          <h5 className="coh-combo__title">{combo.ticker}</h5>
          <ComboChips combo={combo} />
          <p className="coh-combo__where">{positionSentence(combo)}</p>
        </div>
      ))}
    </section>
  );
}

function ParlaysView({ combos }: { combos: CoherenceCombo[] }) {
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">{`Each of the ${combos.length} parlays, its band and its legs`}</h4>
      {combos.map((combo) => <ComboCard key={combo.ticker} combo={combo} />)}
    </section>
  );
}

function BoundsView(
  { rows, violated, tightest }: { rows: CoherenceComboRow[]; violated: CoherenceComboRow[]; tightest: CoherenceComboRow | null },
) {
  const shown = violated.length ? violated : tightest ? [tightest] : [];
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">What the bounds test found</h4>
      <p className="coh-combo__meta">
        {violated.length
          ? `${violated.length} of ${rows.length} testable rows are violated. Each portfolio below pays at least its bound in every future and costs less than that bound to put on, before fees.`
          : rows.length
            ? `None of the ${rows.length} testable rows is violated: no parlay on this read is priced outside the band its legs impose. That is the normal reading, and it is about the bounds only — it says nothing about whether any of these parlays is worth its price.`
            : "No row could be tested on this read: every one of them needed a leg that was unquoted on the side the bound uses."}
      </p>
      {!violated.length && tightest ? (
        <p className="coh-combo__meta">
          {`The closest of them still leaves ${priceLabel(tightest.slack)} between the portfolio and its bound.`}
        </p>
      ) : null}
      {shown.length ? <RowFacts rows={shown} /> : null}
      {shown.map((row, index) => <RowBlock key={`row-${index}`} row={row} tightest={!violated.length} />)}
    </section>
  );
}

function NotesView({ combos, notes }: { combos: CoherenceCombo[]; notes: string[] }) {
  // One caveat per basis actually present in the read, not one per card: on a
  // normal read every parlay is quoted on the ask and this is a single line.
  const bases = [...new Set(combos.map((combo) => combo.price_basis))];
  const unquoted = combos.filter((combo) => combo.independence == null).length;
  return (
    <section className="coh-combos__rows">
      <h4 className="console-subhead">What this read reports, and what it cannot</h4>
      {bases.map((basis) => <p className="coh-combo__caveat" key={basis}>{basisCaveat(basis)}</p>)}
      {unquoted ? (
        <p className="coh-combo__caveat">
          {`${unquoted} of these parlays show no independence figure. ${NO_INDEPENDENCE}`}
        </p>
      ) : null}
      {notes.length ? (
        <ul className="coh-notes">
          {notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : (
        <p className="coh-combo__note">The gateway returned no notes on this read, which is not the same as no caveats: the two above hold on every read.</p>
      )}
    </section>
  );
}

export default function CombosPane({ active }: { active: boolean }) {
  const [view, setView] = useState<ComboView>("bands");
  const { data, error } = useCoherenceRead<CoherenceCombos>(combosRoute(), active);

  const head = {
    kicker: "Combos",
    title: "Parlays & the bands their legs leave",
    id: "coherence-combos-heading",
    note: data ? `${data.combos.length} with a band, ${data.quoted} quoted` : "listed parlays",
    lede: "A parlay pays a dollar only when every leg lands. Its legs do not determine that probability, they bound it — and inside the band every price is consistent with some dependence, which nothing here quotes.",
  };
  const framed = (mark: string, body: React.ReactNode) => (
    <section className="card console-card coh-combos" aria-labelledby="coherence-combos-heading">
      <PaneHeadEmpty head={head} mark={mark}>{body}</PaneHeadEmpty>
    </section>
  );

  if (error && !data) return framed("✕", <>The parlays could not be read: {error}</>);
  if (!data) return framed("◌", "Reading the listed parlays…");
  if (data.state !== "available" || !data.combos.length) {
    // Three answers used to arrive here as one sentence with the gateway's own
    // reason thrown away; `notes` carries the venue's account of which.
    const notes = data.notes ?? [];
    return (
      <section className="card console-card coh-combos" aria-labelledby="coherence-combos-heading">
        <PaneHead {...head} />
        <p className="console-empty">
          <span aria-hidden="true">◌</span>{" "}
          {data.state !== "available"
            ? "The parlays could not be read on this poll, so nothing below is a statement about what the exchange is listing."
            : "The exchange is listing no open parlay whose book this read could reach. Each one needs a book call per leg on top of its own, so a read that finds no combo book returns nothing rather than a band built from part of one."}
        </p>
        {notes.length ? (
          <ul className="coh-notes">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </section>
    );
  }

  const violated = data.rows.filter((row) => row.violated);
  const satisfied = data.rows.filter((row) => !row.violated);
  const tightest = satisfied.reduce<CoherenceComboRow | null>((best, row) => {
    const slack = toCenticents(row.slack);
    if (slack == null) return best;
    const bestSlack = best == null ? null : toCenticents(best.slack);
    return bestSlack == null || slack < bestSlack ? row : best;
  }, null);

  return (
    <section className="card console-card coh-combos" aria-labelledby="coherence-combos-heading">
      <PaneHead {...head} />
      <code className="coh-combo__formula">{FORMULA}</code>

      <div className="coh-status__chips">
        <StateChip mark="◇" word="Parlays with a band" value={String(data.combos.length)} tone="muted" />
        <StateChip mark="◇" word="Quoted on their own book" value={String(data.quoted)} tone="muted" />
        <StateChip mark={data.outside_band ? "▲" : "●"} word="Priced outside their band"
                   value={String(data.outside_band)} tone={data.outside_band ? "critical" : "good"} />
        <StateChip mark={data.violations ? "▲" : "●"} word="Bounds violated"
                   value={String(data.violations)} tone={data.violations ? "critical" : "good"} />
      </div>

      <div className="seg" role="group" aria-label="Combos view">
        <button type="button" aria-pressed={view === "bands"} onClick={() => setView("bands")}>Bands</button>
        <button type="button" aria-pressed={view === "parlays"} onClick={() => setView("parlays")}>Parlays</button>
        <button type="button" aria-pressed={view === "bounds"} onClick={() => setView("bounds")}>Bounds test</button>
        <button type="button" aria-pressed={view === "notes"} onClick={() => setView("notes")}>Notes</button>
      </div>

      {view === "bands" ? (
        <BandsView combos={data.combos} />
      ) : view === "parlays" ? (
        <ParlaysView combos={data.combos} />
      ) : view === "bounds" ? (
        <BoundsView rows={data.rows} violated={violated} tightest={tightest} />
      ) : (
        <NotesView combos={data.combos} notes={data.notes} />
      )}
    </section>
  );
}
