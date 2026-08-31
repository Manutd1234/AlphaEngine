"""Turning the lab's kernel objects into wire models.

Extracted from ``coherence_lab.py`` when that module reached its length
ceiling, along the seam it already had: the router decides *what to read* and
these functions decide *how it crosses the wire*. Keeping them apart means the
mapping can be tested without a request and the routes stay readable as a list
of questions.

The one rule every function here obeys: a ``None`` from the kernel arrives as a
``null`` on the wire. No default of zero, no empty string standing in for a
missing price. A mean that could not be computed and a mean of nought are
different facts, and the panes render them differently.
"""

from __future__ import annotations

from typing import Any

from modules.schemas import (
    CoherenceBin,
    CoherenceCalibration,
    CoherenceCombo,
    CoherenceComboLeg,
    CoherenceComboRow,
    CoherenceCombos,
    CoherenceCompositionRow,
    CoherenceDispersion,
    CoherenceKelly,
    CoherenceMapPoint,
    CoherencePendingMinute,
    CoherenceProbe,
    CoherenceReliabilityBin,
    CoherenceRfqPanel,
    CoherenceSeriesBias,
    CoherenceSettlementFeed,
    CoherenceShell,
    CoherenceShellEntry,
    CoherenceStake,
    CoherenceSurface,
    CoherenceWeatherSample,
)


def text(value: Any) -> str | None:
    """A Decimal to its wire string, and None straight through."""
    return None if value is None else str(value)


def surface_view(reading: Any, event_ticker: str) -> CoherenceSurface:
    variance = reading.variance
    return CoherenceSurface(
        state="unavailable" if reading.engine == "unavailable" else "available",
        engine=reading.engine,
        basis=reading.basis,
        event_ticker=event_ticker,
        probes=[
            CoherenceProbe(
                strike=str(probe.strike),
                survival=str(probe.survival),
                ticker=probe.ticker,
                label=probe.label,
                origin=probe.origin,
            )
            for probe in reading.probes
        ],
        bins=[
            CoherenceBin(
                label=item.label,
                low=text(item.low),
                high=text(item.high),
                mass=str(item.mass),
                representative=text(item.representative),
                negative=item.is_negative,
            )
            for item in reading.bins
        ],
        total_mass=text(reading.total_mass),
        tail_mass_low=text(reading.tail_mass_low),
        tail_mass_high=text(reading.tail_mass_high),
        mean=text(reading.mean),
        variance=text(variance),
        standard_deviation=text(variance.sqrt()) if variance is not None and variance >= 0 else None,
        skewness=text(reading.skewness),
        excess_kurtosis=text(reading.excess_kurtosis),
        moments_note=reading.moments_note,
        negative_bins=list(reading.negative_bins),
        detail=reading.detail,
    )


def kelly_view(plan: Any) -> CoherenceKelly:
    return CoherenceKelly(
        state="unavailable" if plan.engine == "unavailable" else "available",
        engine=plan.engine,
        stakes=[
            CoherenceStake(
                ticker=stake.ticker,
                label=stake.label,
                probability=str(stake.probability),
                price=str(stake.price),
                edge=str(stake.edge),
                full_fraction=str(stake.full_fraction),
                fraction=str(stake.fraction),
                admitted=stake.admitted,
            )
            for stake in plan.stakes
        ],
        shrinkage=str(plan.shrinkage),
        reserve_rate=text(plan.reserve_rate),
        cash_fraction=text(plan.cash_fraction),
        staked_fraction=text(plan.staked_fraction),
        growth_rate=text(plan.growth_rate),
        full_growth_rate=text(plan.full_growth_rate),
        worst_case_wealth=text(plan.worst_case_wealth),
        basket_cost=text(plan.basket_cost),
        arbitrage_available=plan.arbitrage_available,
        riskless_growth=text(plan.riskless_growth),
        detail=plan.detail,
    )


def combos_view(observation: Any) -> CoherenceCombos:
    by_ticker = {combo.ticker: combo for combo in observation.combos}
    # A row belongs to the parlay it names as a leg. Counted per combo so a
    # pane can tell "quoted outside a band built from mids" — which proves
    # nothing on its own — from "a portfolio here costs less than it pays".
    violated: dict[str, int] = {}
    for row in observation.rows:
        if not row.violated:
            continue
        for leg in row.legs:
            if leg.ticker in by_ticker:
                violated[leg.ticker] = violated.get(leg.ticker, 0) + 1
    return CoherenceCombos(
        state="available" if observation.readings else "unavailable",
        combos=[
            CoherenceCombo(
                ticker=reading.combo_ticker,
                label=getattr(by_ticker.get(reading.combo_ticker), "label", reading.combo_ticker),
                collection_ticker=getattr(by_ticker.get(reading.combo_ticker), "collection_ticker", ""),
                scope=getattr(by_ticker.get(reading.combo_ticker), "scope", "cross-shard"),
                legs=[
                    CoherenceComboLeg(
                        ticker=leg.ticker,
                        label=leg.label,
                        side=leg.side,
                        probability=text(leg.probability),
                        buy_cost=text(leg.buy_cost),
                        opposite_cost=text(leg.opposite_cost),
                    )
                    for leg in reading.legs
                ],
                combo_bid=text(reading.combo_bid),
                combo_ask=text(reading.combo_ask),
                combo_mid=text(reading.combo_mid),
                price=text(reading.price),
                price_basis=reading.price_basis,
                lower_bound=text(reading.lower_bound),
                upper_bound=text(reading.upper_bound),
                independence=text(reading.independence),
                band_width=text(reading.band_width),
                band_position=text(reading.band_position),
                dependence=reading.dependence,
                inside_band=reading.inside_band,
                violated_rows=violated.get(reading.combo_ticker, 0),
                detail=reading.detail,
            )
            for reading in observation.readings
        ],
        rows=[
            CoherenceComboRow(
                because=row.because,
                scope=row.scope,
                bound=str(row.bound),
                cost=text(row.cost),
                slack=text(row.slack),
                violated=row.violated,
                legs=[
                    CoherenceComboLeg(
                        ticker=leg.ticker,
                        label=leg.label,
                        side=leg.side,
                        buy_cost=text(leg.price) if leg.direction == "buy" else None,
                    )
                    for leg in row.legs
                ],
            )
            for row in observation.rows
        ],
        quoted=len(observation.quoted),
        outside_band=len(observation.outside_band),
        violations=sum(1 for row in observation.rows if row.violated),
        notes=observation.notes,
    )


def calibration_view(report: Any, detail: str, horizon_s: int | None = None) -> CoherenceCalibration:
    unavailable = report.engine == "unavailable"
    return CoherenceCalibration(
        state="unavailable" if unavailable else "available",
        engine=report.engine,
        # Null on an unavailable report: no floor was applied to nothing.
        horizon_s=None if unavailable or horizon_s is None else int(horizon_s),
        count=report.count,
        base_rate=text(report.base_rate),
        brier=text(report.brier),
        reliability=text(report.reliability),
        resolution=text(report.resolution),
        uncertainty=text(report.uncertainty),
        binning=text(report.binning),
        skill=text(report.skill),
        bias_slope=text(report.bias_slope),
        bias_by_series=[
            CoherenceSeriesBias(series_ticker=series, slope=str(slope))
            for series, slope in report.bias_by_series
        ],
        median_horizon_s=report.median_horizon_s,
        thin=report.thin,
        bins=[
            CoherenceReliabilityBin(
                label=item.label,
                low=str(item.low),
                high=str(item.high),
                count=item.count,
                mean_forecast=text(item.mean_forecast),
                outcome_rate=text(item.outcome_rate),
                deviation=text(item.deviation),
            )
            for item in report.bins
        ],
        isotonic_map=[
            CoherenceMapPoint(quoted=str(point.quoted), calibrated=str(point.calibrated), weight=point.weight)
            for point in report.isotonic_map
        ],
        composition=[
            CoherenceCompositionRow(series_ticker=series, count=count) for series, count in report.composition
        ],
        detail=detail,
    )


def settlement_view(feed: dict[str, Any], reference: dict[str, Any], city: str) -> CoherenceSettlementFeed:
    summary = feed.get("summary") or {}
    return CoherenceSettlementFeed(
        state=str(feed.get("state") or "unavailable"),
        detail=str(feed.get("detail") or ""),
        city=str(feed.get("city") or city),
        config_version=str(summary.get("config_version") or ""),
        samples=[
            CoherenceWeatherSample(
                ts_ms=int(sample["ts_ms"]),
                value=str(sample["value"]),
                contributors=int(sample["contributors"]),
                status=str(sample["status"]),
            )
            for sample in (feed.get("samples") or [])
        ],
        sample_count=int(summary.get("samples") or 0),
        degraded_samples=int(summary.get("degraded_samples") or 0),
        contributors_min=summary.get("contributors_min"),
        contributors_max=summary.get("contributors_max"),
        latest_value=summary.get("latest_value"),
        window_minutes=int(summary.get("window_minutes") or 60),
        window_average=summary.get("hour_average"),
        window_average_clean=summary.get("hour_average_clean"),
        spot_minus_window=summary.get("spot_minus_window"),
        reference_rate_state=str(reference.get("state") or "unavailable"),
        reference_rate_detail=str(reference.get("detail") or ""),
        units=str(summary.get("units") or ""),
        stations=list(summary.get("stations") or []),
        formation_checked=int(summary.get("formation_checked") or 0),
        formation_agreed=int(summary.get("formation_agreed") or 0),
        formation_holds=bool(summary.get("formation_holds")),
        formation_detail=str(summary.get("formation_detail") or ""),
        quorum_gaps=int(summary.get("quorum_gaps") or 0),
        window_is_assumed=bool(summary.get("window_is_assumed", True)),
        pending=[
            CoherencePendingMinute(
                ts_ms=int(row["ts_ms"]),
                provisional=row.get("provisional"),
                spread=row.get("spread"),
                stations=int(row.get("stations") or 0),
            )
            for row in (feed.get("pending") or [])
        ],
    )


def rfq_view(panel: dict[str, Any], usage: dict[str, Any] | None = None) -> CoherenceRfqPanel:
    """The panel, with each market's disagreement set against its own band.

    ``usage`` maps a market ticker to a ``frechet.BandUsage``. Absent, the
    band columns come across null and say nothing, which is the honest state
    when no combo reading covers the market a maker was quoting.
    """
    found = usage or {}
    return CoherenceRfqPanel(
        state=str(panel.get("state") or "refused"),
        detail=str(panel.get("detail") or ""),
        open_requests=len(panel.get("rfqs") or []),
        dispersions=[
            CoherenceDispersion(
                market_ticker=item.market_ticker,
                quotes=item.quotes,
                usable=item.usable,
                median=text(item.median),
                lowest=text(item.lowest),
                highest=text(item.highest),
                spread=text(item.spread),
                median_width=text(item.median_width),
                crossed=item.crossed,
                thin=item.thin,
                detail=item.detail,
                band_width=text(found[item.market_ticker].band_width)
                if item.market_ticker in found
                else None,
                band_fraction=text(found[item.market_ticker].fraction)
                if item.market_ticker in found
                else None,
                band_note=found[item.market_ticker].detail if item.market_ticker in found else "",
            )
            for item in (panel.get("dispersions") or [])
        ],
    )


def listing_view(listing: Any) -> CoherenceShell:
    return CoherenceShell(
        state="available" if listing.exists else "unavailable",
        path=listing.path,
        command="ls",
        exists=listing.exists,
        entries=[
            CoherenceShellEntry(name=entry.name, kind=entry.kind, detail=entry.detail)
            for entry in listing.entries
        ],
        detail=listing.detail,
    )


def file_view(body: Any, path: str) -> CoherenceShell:
    return CoherenceShell(
        state=body.state,
        path=path,
        command="cat",
        exists=body.state != "missing",
        body=body.body,
        detail=body.detail,
    )
