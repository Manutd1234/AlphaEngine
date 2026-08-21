"use client";

/**
 * What is behind the answer, and what is behind THAT.
 *
 * Both marks read the provider registry and the failover graph, which are built
 * while the health request is served and are therefore populated on every
 * instance — unlike the validation and cache counters, which belong to the
 * quote lambdas and read empty here by construction.
 *
 * The ring is a partition of the provider list, classified once per provider
 * (see `deriveProviderSupply`); the bars are the depth of each ranked failover
 * chain. A capability whose chain is one node deep is a single point of failure
 * even while it is green, which is the fact neither "8/8 ready" nor "9 route
 * graphs" could ever show.
 */

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { RouteState, SystemHealth } from "@/components/systems/types";
import { deriveFailoverDepth, deriveProviderSupply } from "@/lib/data-trust";
import { routeLabel } from "@/lib/providers/route-labels";

import { ROUTE_STATE_FILL, ROUTE_STATE_WORD } from "./trust-marks";

/** Drawn in this order in every row, so a reader compares positions. */
const STATE_ORDER: RouteState[] = [
  "ready",
  "quota_reserved",
  "quota_exhausted",
  "circuit_open",
  "simulated_outage",
  "unlicensed",
  "not_configured",
];

export default function SupplyPosture({ health }: { health: SystemHealth | null }) {
  const supply = deriveProviderSupply(health);
  const depth = deriveFailoverDepth(health);

  const slices: DonutSlice[] = [
    { label: "routable", value: supply.ready, colour: "var(--status-good)" },
    { label: "circuit open", value: supply.circuitOpen, colour: "var(--status-critical)" },
    { label: "quota spent", value: supply.quotaExhausted, colour: "var(--status-warning)" },
    { label: "outage drill", value: supply.simulatedOutage, colour: "var(--series-2)" },
    { label: "configured, blocked", value: supply.blocked, colour: "var(--series-1)" },
    { label: "no key configured", value: supply.notConfigured, colour: "var(--axis)" },
  ];

  const rows: BarRow[] = depth.map((route) => ({
    label: routeLabel(route.capability, route.asset),
    // Colour is never the only carrier: the note names every state present in
    // the chain and prints its count, so the row survives greyscale.
    note: STATE_ORDER
      .filter((state) => route.byState[state] > 0)
      .map((state) => `${route.byState[state]} ${ROUTE_STATE_WORD[state]}`)
      .join(", "),
    segments: STATE_ORDER.map((state) => ({
      label: ROUTE_STATE_WORD[state],
      value: route.byState[state],
      color: ROUTE_STATE_FILL[state],
    })),
  }));

  const noFallback = depth.filter((route) => route.ready === 1).length;
  const noRoute = depth.filter((route) => route.ready === 0).length;

  return (
    <section className="card" aria-labelledby="trust-supply-heading">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Answer supply</span>
          <h2 id="trust-supply-heading">Providers &amp; failover depth</h2>
        </div>
        <span className="section-note">
          {supply.total ? `${supply.ready}/${supply.total} routable` : "registry not observed"}
        </span>
      </div>

      <div className="data-trust-composition">
        <DonutChart
          slices={slices}
          total={supply.total || undefined}
          centreValue={supply.total ? String(supply.ready) : undefined}
          centreLabel="routable"
          ariaLabel="Every registered provider, by whether it can answer a request now."
          emptyNote="No provider registry in this snapshot, so nothing can be said about supply."
        />
        <CategoryBars
          rows={rows}
          ariaLabel="Ranked failover chain per capability and asset, by node routing state."
          emptyNote="No failover chain is exposed in this snapshot."
        />
      </div>

      {/* The registry counts left this note deliberately: the section-note
          prints ready/total and the ring's legend prints every state with its
          count, so prose repeating them was the same fact three times over.
          What stays is what no chart above can say — the chains one node from
          silence — and the rank-order caveat that stops the bars being
          misread. When no chain is reported, the bars' own emptyNote already
          states it, so the note stands down rather than restating an absence. */}
      {depth.length > 0 && (
        <>
          <p className="research-note">
            Thinnest chains first.{" "}
            {noRoute > 0 && (
              <><strong>{noRoute}</strong> {noRoute === 1 ? "chain has" : "chains have"} no routable
                node at all. </>
            )}
            {noFallback > 0
              ? <><strong>{noFallback}</strong> of {depth.length} {noFallback === 1 ? "has" : "have"}{" "}
                exactly one routable node — green, and a single point of failure. </>
              : depth.length > noRoute
                // Only when something IS routable: after "9 chains have no
                // routable node", a reassurance about the rest would be
                // vacuously true and read as comfort.
                ? <>Every routable chain has more than one node able to serve it. </>
                : null}
          </p>
          {/* The counted half stays above; only the rank caveat folds. It is a
              chart-reading rule, not a measurement: each row already prints
              its own states as words ("2 ready, 1 no key"), so the bars stay
              readable closed. The summary asks the exact misreading it
              prevents, which is the part that cannot be allowed to go quiet. */}
          <details className="disclosure">
            <summary>Does a bar&rsquo;s left-to-right order say which node is tried first?</summary>
            <p className="research-note">
              Each bar groups a chain&rsquo;s nodes by state, <strong>not</strong> by rank; which
              provider answers first lives in Providers.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
