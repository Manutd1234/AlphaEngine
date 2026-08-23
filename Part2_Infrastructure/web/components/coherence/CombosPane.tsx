"use client";

/**
 * Kalshi's parlays, against the bands their own legs impose.
 *
 * This is the one relation on the exchange that is stated rather than inferred:
 * a combo ticker carries its legs, so the conjunction is not a guess. It is
 * also the relation that pins down the least. The legs give a band and never a
 * price, and the pane is built around that gap rather than around a verdict.
 *
 * The failure mode this pane is written to avoid is a reader taking "inside the
 * band" for "fairly priced". They are not the same claim and the second one is
 * not available: every price between the two bounds is consistent with some
 * dependence between the legs, and nothing on this exchange quotes dependence.
 * So the band width leads, the position inside the band is called a position,
 * and the word "mispriced" appears only where a price is outside its band and
 * a portfolio in `rows` proves it.
 *
 * The second failure mode is the ask. Parlays are quoted one-sided almost
 * without exception — nobody bids for a parlay — so `price_basis` is "ask" and
 * the bounds are built from leg MIDS. A parlay priced above Πpᵢ is therefore
 * the expected reading even under independence, and calling that "positive
 * dependence" would be reading the maker's margin as information about the
 * world. Every dependence chip on this pane sits directly above the sentence
 * that says so.
 */

import type { CoherenceCombo, CoherenceComboLeg, CoherenceComboRow, CoherenceCombos } from "@/lib/coherence/types-lab";
import { priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FrechetBand, { DEPENDENCE_WORD, basisCaveat, probLabel, toUnit } from "./FrechetBand";
import { StateChip } from "./Figure";

const FORMULA = "max(0, Σpᵢ − (n−1))  ≤  P(all legs)  ≤  min pᵢ";

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
            the offer on that same side; opposite cost is the offer on the other one, which is what the cover
            portfolio pays.
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

function RowBlock({ row, tightest }: { row: CoherenceComboRow; tightest: boolean }) {
  const mark = row.violated ? "▲" : "●";
  const word = row.violated ? "Violated, a Dutch book before fees" : tightest ? "Satisfied, and the closest of them" : "Satisfied";
  return (
    <div className="coh-combo__row">
      <p className="coh-combo__because">
        <span aria-hidden="true">{mark}</span> {word}: {row.because}
      </p>
      <dl className="coh-combo__facts">
        <div>
          <dt>Bound</dt>
          <dd>{priceLabel(row.bound)}</dd>
        </div>
        <div>
          <dt>Portfolio cost</dt>
          <dd>{priceLabel(row.cost)}</dd>
        </div>
        <div>
          <dt>Slack</dt>
          <dd>{priceLabel(row.slack)}</dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{row.scope}</dd>
        </div>
      </dl>
      {row.cost == null || row.slack == null ? (
        <p className="coh-combo__note">
          A dash in cost or slack means a leg lost its quote between the read and this row, so the claim was not
          tested. It is not a cost of nothing.
        </p>
      ) : null}
      <RowLegs legs={row.legs} />
    </div>
  );
}

function ComboCard({ combo }: { combo: CoherenceCombo }) {
  const inside = combo.inside_band;
  return (
    <article className="coh-combo">
      <h4 className="coh-combo__title">{combo.ticker}</h4>
      <p className="coh-combo__meta">
        {`${combo.legs.length} legs, ${combo.scope}, listed in ${combo.collection_ticker || "no collection"}`}
      </p>
      <p className="coh-combo__legend">{combo.label}</p>

      <div className="coh-combo__chips">
        <StateChip
          mark={inside == null ? "◌" : inside ? "●" : "▲"}
          word={inside == null ? "Unquoted, nothing to place" : inside ? "Inside the band" : "Outside the band"}
          value={combo.price == null ? null : priceLabel(combo.price)}
          tone={inside == null ? "muted" : inside ? "good" : "critical"}
        />
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
      <p className="coh-combo__caveat">
        {combo.independence == null
          ? "At least one leg is unquoted on the side this parlay needs, so Πpᵢ has no value and neither do the bounds. That is a missing quote, not a probability of zero."
          : basisCaveat(combo.price_basis)}
      </p>

      <FrechetBand reading={combo} />
      <p className="coh-combo__where">{positionSentence(combo)}</p>
      <LegTable combo={combo} />
    </article>
  );
}

export default function CombosPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceCombos>("/api/gateway/coherence/combos?limit=6", active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The parlays could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the listed parlays…</p>;
  if (data.state !== "available" || !data.combos.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No parlay was read on this poll. Each one needs a book call per leg on top of
        its own, so a read that finds no combo book returns nothing rather than a band built from part of one.
      </p>
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
    <div className="coh-combos">
      <p className="coh-combos__lead">
        A parlay pays a dollar only when every leg lands. Its legs do not determine that probability, they bound it.
      </p>
      <code className="coh-combo__formula">{FORMULA}</code>
      <p className="coh-combos__lead">
        Everything between those two bounds is consistent with some dependence between the legs, so a price inside the
        band is neither a mispricing nor a fair value; it is a price this evidence cannot rule out. The number to read
        is the width of the band, because that is how far the parlay can move with no leg price moving at all. Only a
        price outside the band is a Dutch book, and each one arrives with the portfolio that proves it.
      </p>

      <div className="coh-status__chips">
        <StateChip mark="◇" word="Parlays with a band" value={String(data.combos.length)} tone="muted" />
        <StateChip mark="◇" word="Quoted on their own book" value={String(data.quoted)} tone="muted" />
        <StateChip
          mark={data.outside_band ? "▲" : "●"}
          word="Priced outside their band"
          value={String(data.outside_band)}
          tone={data.outside_band ? "critical" : "good"}
        />
        <StateChip
          mark={data.violations ? "▲" : "●"}
          word="Bounds violated"
          value={String(data.violations)}
          tone={data.violations ? "critical" : "good"}
        />
      </div>

      <section className="coh-combos__rows">
        <h4 className="coh-combo__title">What the bounds test found</h4>
        {violated.length ? (
          <>
            <p className="coh-combo__meta">
              {`${violated.length} of ${data.rows.length} testable rows are violated. Each portfolio below pays at least its bound in every future and costs less than that bound to put on, before fees.`}
            </p>
            {violated.map((row, index) => (
              <RowBlock key={`violated-${index}`} row={row} tightest={false} />
            ))}
          </>
        ) : (
          <>
            <p className="coh-combo__meta">
              {data.rows.length
                ? `None of the ${data.rows.length} testable rows is violated, so no parlay on this read is priced outside the band its legs impose. That is the normal reading, and it is a statement about the bounds only: it says nothing about whether any of these parlays is worth its price.`
                : "No row could be tested on this read: every one of them needed a leg that was unquoted on the side the bound uses."}
            </p>
            {tightest ? (
              <>
                <p className="coh-combo__meta">
                  {`The closest of them still leaves ${priceLabel(tightest.slack)} between the portfolio and its bound.`}
                </p>
                <RowBlock row={tightest} tightest />
              </>
            ) : null}
          </>
        )}
      </section>

      {data.combos.map((combo) => (
        <ComboCard key={combo.ticker} combo={combo} />
      ))}

      {data.notes.length ? (
        <ul className="coh-notes">
          {data.notes.map((note, index) => (
            <li key={`${index}-${note}`}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
