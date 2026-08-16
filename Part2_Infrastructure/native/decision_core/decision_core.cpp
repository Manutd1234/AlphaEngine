// AlphaEngine native pre-trade decision core (slice S3).
//
// One of two implementations of the same seventeen-gate battery. The Python
// reference lives in modules/risk_proxy.py::RiskGateway.submit; this is the
// native core it delegates the *book arithmetic and the numeric gates* to when
// DECISION_CORE selects it. modules/tools/gate_fixture.py pins both to one
// committed fixture (web/tests/fixtures/gate-parity.json), and
// tests/test_decision_core_native.py asserts this core reproduces every
// scenario EXACTLY — the same accept/reject, the same observed and limit
// floats — so the boundary below is drawn for bit-for-bit parity, not for size.
//
// ---------------------------------------------------------------------------
// WHAT THIS CORE COMPUTES (timed with std::chrono::steady_clock in decide()):
//   * BookLadder: price->size ladders with dict-snapshot semantics (filter
//     size>0, dedupe keeping the last size per price, sort bids desc / asks
//     asc), best_bid/best_ask/mid, and depth_usd(side, k) folded left-to-right
//     over the first k levels in the SAME order Python's sum() folds them.
//   * mark: the order symbol's consolidated (depth-weighted) mid across its
//     live venue ladders — TCAEngine.consolidated_mid — or, for a paper-equity
//     order, the supplied quote price (no L2 book is consolidated then).
//   * qty/notional derivation from mark, and price_available / order_sized.
//   * max_order_notional, symbol_concentration (projected_symbol_notional with
//     the resting book), gross_exposure (projected), price_band (dev_bps),
//     daily_drawdown (equity -> daily_pnl -> drawdown), and reduce_only
//     (reduce_only_active + the reducing test + budget_used).
//
// WHAT PYTHON STILL COMPUTES (deliberately NOT in this core):
//   * kill_switch, symbol_halt, symbol_whitelist, paper_execution_model,
//     reference_freshness, duplicate_order — pure input booleans / clock reads
//     with no book arithmetic; and rate_limit, which mutates the token bucket
//     and so must run exactly once, in Python.
//   * working_book — a bare len(self.working) < cap, no book maths.
//   * est_slippage (gate 17) — the routed slippage_bps from
//     TCAEngine.route_estimate / _merged_walk. That walk decrements a running
//     remainder across a *merged* ladder whose venues can tie on price; the
//     order those ties fold in changes the last ULP of the VWAP, and the paper
//     partial/None branches carry their own detail. Reproducing that float
//     sequence bit-for-bit was judged higher risk than its value here, so gate
//     17 stays Python's exact code. This core does not touch it.
//   * per-position marks for gross_exposure / daily_drawdown: each is an
//     independent multi-venue consolidation (self.mark(sym)); Python computes
//     them and passes them in, and this core does only the |qty|*mark folds.
//     The ORDER symbol's mark IS computed here from its ladders.
//
// Everything here is plain IEEE-754 double, sequential, no FMA
// (-ffp-contract=off), evaluated in the same association Python uses, so the
// results match the reference to the bit.

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace py = pybind11;

// CPython's built-in sum() does NOT plain-fold floats: since 3.12 it uses
// Neumaier (Kahan-Babuska) compensated summation, so `sum(xs)` can land a ULP
// away from a running `acc += x` loop. The Python reference is split down this
// exact line — BookState.depth_usd, realized_pnl() and unrealized_pnl() go
// through sum() (compensated), while TCAEngine.consolidated_mid and
// gross_exposure() are hand-rolled `+=` loops (plain). This core reproduces
// each fold with the matching algorithm; using the wrong one is a silent
// 1-ULP parity break, the class of defect the fixture exists to catch.
class Neumaier {
public:
    void add(double x) {
        const double t = sum_ + x;
        if (std::fabs(sum_) >= std::fabs(x)) {
            c_ += (sum_ - t) + x;
        } else {
            c_ += (x - t) + sum_;
        }
        sum_ = t;
    }
    double value() const { return sum_ + c_; }

private:
    double sum_ = 0.0;
    double c_ = 0.0;
};

// Belt and braces with the -ffp-contract=off compile flag: forbid the compiler
// fusing a multiply-add into a single-rounding FMA anywhere in this translation
// unit. CPython evaluates `p*q` and then the addition as two separately rounded
// double operations; an FMA rounds once and lands a ULP away, which is exactly
// the kind of silent parity break this core exists to avoid. The standard
// pragma is honoured even where a stray flag ordering might not be.
#pragma STDC FP_CONTRACT OFF

// --------------------------------------------------------------------------- //
// BookLadder — one venue's two ladders for one symbol.
// --------------------------------------------------------------------------- //
class BookLadder {
public:
    // bids sorted descending by price, asks ascending — the views
    // BookState.sorted_bids()/sorted_asks() present to every reader.
    std::vector<std::pair<double, double>> bids;
    std::vector<std::pair<double, double>> asks;

    BookLadder() = default;

    // Mirror BookState.apply_snapshot: {p: q for p, q in side if q > 0} (a dict,
    // so a later size at a price replaces an earlier one) then a sort. Sizes at
    // or below zero are dropped and never delete an earlier positive size.
    void snapshot(const std::vector<std::pair<double, double>> &bids_in,
                  const std::vector<std::pair<double, double>> &asks_in) {
        bids = build(bids_in, /*descending=*/true);
        asks = build(asks_in, /*descending=*/false);
    }

    std::optional<double> best_bid() const {
        if (bids.empty()) return std::nullopt;
        return bids.front().first;
    }

    std::optional<double> best_ask() const {
        if (asks.empty()) return std::nullopt;
        return asks.front().first;
    }

    // (best_bid + best_ask) / 2, or None when either side is empty or zero —
    // Python's `(bb + ba) / 2 if bb and ba else None`.
    std::optional<double> mid() const {
        auto bb = best_bid();
        auto ba = best_ask();
        if (!bb || !ba || *bb == 0.0 || *ba == 0.0) return std::nullopt;
        return (*bb + *ba) / 2.0;
    }

    // sum(p * q for p, q in levels[:k]) — Neumaier-compensated over the first k
    // sorted levels, matching CPython's sum() bit-for-bit (see the Neumaier
    // note above; a plain += fold lands a ULP off on a deep ladder).
    double depth_usd(const std::string &side, int k) const {
        const std::vector<std::pair<double, double>> &levels =
            (side == "bid") ? bids : asks;
        int limit = k;
        if (limit < 0) limit = 0;
        Neumaier acc;
        int i = 0;
        for (const auto &lvl : levels) {
            if (i >= limit) break;
            acc.add(lvl.first * lvl.second);
            ++i;
        }
        return acc.value();
    }

private:
    static std::vector<std::pair<double, double>>
    build(const std::vector<std::pair<double, double>> &side, bool descending) {
        // Dict semantics: last positive size per price wins.
        std::unordered_map<double, double> book;
        book.reserve(side.size() * 2);
        for (const auto &lvl : side) {
            if (lvl.second > 0.0) book[lvl.first] = lvl.second;
        }
        std::vector<std::pair<double, double>> out;
        out.reserve(book.size());
        for (const auto &kv : book) out.emplace_back(kv.first, kv.second);
        if (descending) {
            std::sort(out.begin(), out.end(),
                      [](const std::pair<double, double> &a,
                         const std::pair<double, double> &b) {
                          return a.first > b.first;
                      });
        } else {
            std::sort(out.begin(), out.end(),
                      [](const std::pair<double, double> &a,
                         const std::pair<double, double> &b) {
                          return a.first < b.first;
                      });
        }
        return out;
    }
};

// --------------------------------------------------------------------------- //
// CoreResult — the numbers submit() renders its CheckResult vector from.
// --------------------------------------------------------------------------- //
struct CoreResult {
    long long elapsed_ns = 0;
    std::optional<double> mark;
    bool has_price = false;
    std::optional<double> qty;
    std::optional<double> notional;
    double projected_sym = 0.0;
    double projected_gross = 0.0;
    double dev_bps = 0.0;
    double dd = 0.0;
    bool reduce_only_active = false;
    bool reducing = false;
    double budget_used = 0.0;
};

static CoreResult decide(
    bool side_is_buy,
    bool order_type_is_limit,
    std::optional<double> order_quantity,
    std::optional<double> order_notional,
    std::optional<double> limit_price,
    bool is_paper,
    std::optional<double> paper_price,
    const std::vector<BookLadder> &order_books,
    const std::vector<double> &pos_quantities,
    const std::vector<double> &pos_avg_prices,
    const std::vector<double> &pos_realized,
    const std::vector<std::optional<double>> &pos_marks,
    const std::vector<bool> &pos_is_order_symbol,
    double working_buys,
    double working_sells,
    double starting_equity,
    double carried_realized_pnl,
    double start_of_day_equity,
    double max_order_notional_usd,
    double max_symbol_notional_usd,
    double max_gross_exposure_usd,
    double max_price_deviation_bps,
    double max_daily_drawdown_pct,
    double reduce_only_threshold,
    bool reduce_only_override) {
    (void)max_order_notional_usd;
    (void)max_symbol_notional_usd;
    (void)max_gross_exposure_usd;
    (void)max_price_deviation_bps;
    // The limits above are echoed straight back into submit()'s add() calls on
    // the Python side; they are accepted here for signature completeness and so
    // a future in-core boolean can use them without another crossing.

    CoreResult r;
    const auto t0 = std::chrono::steady_clock::now();

    const double sign = side_is_buy ? 1.0 : -1.0;

    // --- mark: paper quote, or the consolidated depth-weighted mid --------- //
    std::optional<double> mark;
    if (is_paper) {
        mark = paper_price;
    } else {
        double num = 0.0;
        double den = 0.0;
        for (const auto &book : order_books) {
            auto m = book.mid();
            if (!m) continue;
            double w = book.depth_usd("bid", 5) + book.depth_usd("ask", 5);
            w = std::max(w, 1.0);
            num += (*m) * w;
            den += w;
        }
        if (den != 0.0) mark = num / den;
    }

    // --- price discovery and sizing --------------------------------------- //
    std::optional<double> ref_price;
    if (limit_price && *limit_price != 0.0) {
        ref_price = limit_price;  // `req.limit_price or mark`
    } else {
        ref_price = mark;
    }
    const bool has_price = ref_price.has_value() && *ref_price > 0.0;

    std::optional<double> qty = order_quantity;
    std::optional<double> notional = order_notional;
    if (has_price) {
        if (!qty && notional) {
            qty = (*notional) / (*ref_price);
        } else if (!notional && qty) {
            notional = (*qty) * (*ref_price);
        }
    }

    // --- price_ref for the projections ------------------------------------ //
    // `price_ref = mark or ref_price or 0`
    double price_ref;
    if (mark && *mark != 0.0) {
        price_ref = *mark;
    } else if (ref_price && *ref_price != 0.0) {
        price_ref = *ref_price;
    } else {
        price_ref = 0.0;
    }

    // held quantity of the order symbol (positions are keyed by symbol, so at
    // most one row is flagged).
    double held = 0.0;
    const std::size_t n = pos_quantities.size();
    for (std::size_t i = 0; i < n; ++i) {
        if (pos_is_order_symbol[i]) {
            held = pos_quantities[i];
            break;
        }
    }

    // projected_symbol_notional(order, signed_qty, price_ref)
    const double signed_qty_conc = (qty ? *qty : 0.0) * sign;
    const double if_buys = std::abs(held + signed_qty_conc + working_buys);
    const double if_sells = std::abs(held + signed_qty_conc - working_sells);
    r.projected_sym = std::max(if_buys, if_sells) * price_ref;

    // gross_exposure() and symbol_notional(order): |q_i| * (self.mark(s) or avg)
    double gross = 0.0;
    double sym_notional_order = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const auto &pm = pos_marks[i];
        double m = (pm && *pm != 0.0) ? *pm : pos_avg_prices[i];
        double contrib = std::abs(pos_quantities[i]) * m;
        gross += contrib;
        if (pos_is_order_symbol[i]) sym_notional_order = contrib;
    }
    r.projected_gross = gross - sym_notional_order + r.projected_sym;

    // --- daily drawdown ---------------------------------------------------- //
    // realized_pnl() and unrealized_pnl() are each `sum(...)` over every
    // position in insertion order, so both are Neumaier-compensated. The
    // unrealized generator yields 0.0 for a position with no mark or zero qty
    // (adding 0.0 is a no-op under Neumaier), so every position is folded.
    Neumaier realized_acc;
    for (std::size_t i = 0; i < n; ++i) realized_acc.add(pos_realized[i]);
    const double realized = realized_acc.value();
    Neumaier unrealized_acc;
    for (std::size_t i = 0; i < n; ++i) {
        const auto &pm = pos_marks[i];
        // PositionState.unrealized(mark): 0.0 unless mark truthy and qty != 0.
        double term = (pm && *pm != 0.0 && pos_quantities[i] != 0.0)
                          ? (*pm - pos_avg_prices[i]) * pos_quantities[i]
                          : 0.0;
        unrealized_acc.add(term);
    }
    const double unrealized = unrealized_acc.value();
    // equity() adds four scalars with `+` (not sum()), so it is a plain fold.
    const double equity = starting_equity + carried_realized_pnl + realized + unrealized;
    const double daily_pnl = equity - start_of_day_equity;
    r.dd = (start_of_day_equity != 0.0)
               ? std::max(0.0, -daily_pnl / start_of_day_equity)
               : 0.0;

    // --- reduce-only ------------------------------------------------------- //
    if (reduce_only_override) {
        r.reduce_only_active = true;
    } else if (max_daily_drawdown_pct <= 0.0 || reduce_only_threshold >= 1.0) {
        r.reduce_only_active = false;
    } else {
        r.reduce_only_active = (r.dd / max_daily_drawdown_pct) >= reduce_only_threshold;
    }

    std::optional<double> signed_qty_ro;
    if (qty) signed_qty_ro = (*qty) * sign;
    r.reducing = signed_qty_ro.has_value() && std::abs(held) > 1e-12 &&
                 ((held > 0.0) != (*signed_qty_ro > 0.0)) &&
                 std::abs(*signed_qty_ro) <= std::abs(held) + 1e-9;
    r.budget_used = (max_daily_drawdown_pct != 0.0) ? r.dd / max_daily_drawdown_pct : 0.0;

    // --- price band deviation (only meaningful for a LIMIT with a mark) ---- //
    if (order_type_is_limit && limit_price && *limit_price != 0.0 && mark && *mark != 0.0) {
        r.dev_bps = std::abs(*limit_price - *mark) / (*mark) * 1e4;
    }

    r.mark = mark;
    r.has_price = has_price;
    r.qty = qty;
    r.notional = notional;

    const auto t1 = std::chrono::steady_clock::now();
    r.elapsed_ns =
        std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count();
    return r;
}

PYBIND11_MODULE(_decision_core, m) {
    m.doc() =
        "AlphaEngine native pre-trade decision core: book ladders + the numeric "
        "gates. See the file header for the exact Python/C++ boundary.";

    py::class_<BookLadder>(m, "BookLadder")
        .def(py::init<>())
        .def("snapshot", &BookLadder::snapshot, py::arg("bids"), py::arg("asks"),
             "Load both ladders with dict-snapshot semantics (size>0, last size "
             "per price wins, bids desc / asks asc).")
        .def("best_bid", &BookLadder::best_bid)
        .def("best_ask", &BookLadder::best_ask)
        .def("mid", &BookLadder::mid)
        .def("depth_usd", &BookLadder::depth_usd, py::arg("side"), py::arg("k"),
             "sum(p*q) over the first k levels of 'bid' or 'ask'.")
        .def_property_readonly(
            "bids", [](const BookLadder &b) { return b.bids; })
        .def_property_readonly(
            "asks", [](const BookLadder &b) { return b.asks; });

    py::class_<CoreResult>(m, "CoreResult")
        .def_readonly("elapsed_ns", &CoreResult::elapsed_ns)
        .def_readonly("mark", &CoreResult::mark)
        .def_readonly("has_price", &CoreResult::has_price)
        .def_readonly("qty", &CoreResult::qty)
        .def_readonly("notional", &CoreResult::notional)
        .def_readonly("projected_sym", &CoreResult::projected_sym)
        .def_readonly("projected_gross", &CoreResult::projected_gross)
        .def_readonly("dev_bps", &CoreResult::dev_bps)
        .def_readonly("dd", &CoreResult::dd)
        .def_readonly("reduce_only_active", &CoreResult::reduce_only_active)
        .def_readonly("reducing", &CoreResult::reducing)
        .def_readonly("budget_used", &CoreResult::budget_used);

    m.def("decide", &decide,
          py::arg("side_is_buy"),
          py::arg("order_type_is_limit"),
          py::arg("order_quantity"),
          py::arg("order_notional"),
          py::arg("limit_price"),
          py::arg("is_paper"),
          py::arg("paper_price"),
          py::arg("order_books"),
          py::arg("pos_quantities"),
          py::arg("pos_avg_prices"),
          py::arg("pos_realized"),
          py::arg("pos_marks"),
          py::arg("pos_is_order_symbol"),
          py::arg("working_buys"),
          py::arg("working_sells"),
          py::arg("starting_equity"),
          py::arg("carried_realized_pnl"),
          py::arg("start_of_day_equity"),
          py::arg("max_order_notional_usd"),
          py::arg("max_symbol_notional_usd"),
          py::arg("max_gross_exposure_usd"),
          py::arg("max_price_deviation_bps"),
          py::arg("max_daily_drawdown_pct"),
          py::arg("reduce_only_threshold"),
          py::arg("reduce_only_override"),
          "Evaluate the book arithmetic and the numeric gates, timing only the "
          "compute with steady_clock. Returns a CoreResult.");
}
