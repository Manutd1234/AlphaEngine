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
//     The ladders are now PERSISTENT: BookState owns one and refreshes it in
//     the two mutation funnels (apply_snapshot / apply_delta), so a decision
//     reads a ladder that is already built instead of rebuilding one per order.
//   * mark: the order symbol's consolidated (depth-weighted) mid across its
//     live venue ladders — TCAEngine.consolidated_mid — or, for a paper-equity
//     order, the supplied quote price (no L2 book is consolidated then).
//   * qty/notional derivation from mark, and price_available / order_sized.
//   * max_order_notional, symbol_concentration (projected_symbol_notional with
//     the resting book), gross_exposure (projected), price_band (dev_bps),
//     daily_drawdown (equity -> daily_pnl -> drawdown), and reduce_only
//     (reduce_only_active + the reducing test + budget_used).
//   * est_slippage — the ROUTED walk (TCAEngine.route_estimate /
//     _merged_walk): the cross-venue merge of every price level, the greedy
//     consumption of the requested notional, the per-venue notional/qty folds,
//     the blended VWAP, `absorbs()` and slippage_bps against the consolidated
//     mid. See the "routed slippage" block below for how each fold is matched.
//
// WHAT PYTHON STILL COMPUTES (deliberately NOT in this core):
//   * kill_switch, symbol_halt, symbol_whitelist, paper_execution_model,
//     reference_freshness, duplicate_order — pure input booleans, set
//     membership and clock reads with no book arithmetic; and rate_limit,
//     which mutates the token bucket and so must run exactly once, in Python.
//     Every one of these is a STATE READ, evaluated before this timer starts.
//   * working_book — a bare len(self.working) < cap, no book maths.
//   * the paper-equity branch of est_slippage — a fixed configured bps with no
//     ladder behind it; there is nothing to compute.
//   * per-position marks for gross_exposure / daily_drawdown: each is an
//     independent multi-venue consolidation (self.mark(sym)); Python computes
//     them and passes them in, and this core does only the |qty|*mark folds.
//     The ORDER symbol's mark IS computed here from its ladders.
//   * every round(), every f-string and every CheckResult. The core returns
//     raw doubles; Python's round() is decimal-half-even and rounding one of
//     these figures inside C++ would be a parity break waiting to happen.
//     `route_filled_notional` in particular is returned UNROUNDED and the
//     `round(filled, 2)` the display needs happens after the timer stops.
//
// NOT IN THE TIMED REGION, and deliberately so: pybind11's marshalling of the
// arguments and of CoreResult (both happen outside t0..t1), the ladder
// refreshes in the feed funnels, and the leg/venue string the detail line is
// rendered from — Python joins the venue names from route_venue_order after
// the clock has stopped.
//
// Everything here is plain IEEE-754 double, sequential, no FMA
// (-ffp-contract=off), evaluated in the same association Python uses, so the
// results match the reference to the bit.

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <optional>
#include <stdexcept>
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
        build(bids_in, /*descending=*/true, bids);
        build(asks_in, /*descending=*/false, asks);
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
    //
    // Two entry points, ONE fold. The bool form is what consolidated_mid calls,
    // four times per decision: the string form built a std::string temporary
    // and compared it against "bid" on each of those calls, to choose between
    // two members it already knew at the call site. The comparison is not
    // arithmetic and cannot change a result — it decided WHICH ladder to fold,
    // never HOW — so hoisting it to the call site leaves the fold, its order
    // and its compensation untouched. The string form stays because
    // BookLadder.depth_usd("bid", k) is bound to Python and the parity suite
    // calls it that way.
    double depth_usd_side(bool is_bid, int k) const {
        const std::vector<std::pair<double, double>> &levels = is_bid ? bids : asks;
        int limit = k;
        if (limit < 0) limit = 0;
        if (static_cast<std::size_t>(limit) > levels.size())
            limit = static_cast<int>(levels.size());
        Neumaier acc;
        for (int i = 0; i < limit; ++i) {
            acc.add(levels[static_cast<std::size_t>(i)].first *
                    levels[static_cast<std::size_t>(i)].second);
        }
        return acc.value();
    }

    double depth_usd(const std::string &side, int k) const {
        return depth_usd_side(side == "bid", k);
    }

private:
    // Dict semantics — {p: q for p, q in side if q > 0} — then a sort, without
    // the dict.
    //
    // This used to build an unordered_map<double, double>, walk it out into a
    // vector and sort that: a hash of every price, a node allocation per
    // distinct price, and a fresh vector per side per update. It runs in the
    // feed funnels, which is the hot path — BookState._mirror() calls it on
    // every snapshot and every delta, ~60 times a second per book, against a
    // decision that runs per order.
    //
    // And on that path the dict was doing nothing. _mirror() passes
    // `list(self.bids.items())`, whose keys are unique by construction, so
    // every insert was a hash lookup that could not collide followed by an
    // allocation that could not be reused. The dedupe is still implemented
    // here, because snapshot() is also bound to Python directly and raw lists
    // reach it from tests and callers, but it is now a scan rather than a map.
    //
    // The semantics are unchanged and the order is identical:
    //   * sizes at or below zero are dropped and never delete an earlier size;
    //   * a stable sort by price leaves equal prices in input order, so taking
    //     the LAST of each equal-price run is exactly "a later size at a price
    //     replaces an earlier one";
    //   * bids descend, asks ascend.
    // Scratch is thread_local and reused, so a steady feed does no allocation
    // at all after the first update of each size.
    static void build(const std::vector<std::pair<double, double>> &side,
                      bool descending,
                      std::vector<std::pair<double, double>> &out) {
        static thread_local std::vector<std::pair<double, double>> scratch;
        scratch.clear();
        scratch.reserve(side.size());
        for (const auto &lvl : side) {
            if (lvl.second > 0.0) scratch.push_back(lvl);
        }
        if (descending) {
            std::stable_sort(scratch.begin(), scratch.end(),
                             [](const std::pair<double, double> &a,
                                const std::pair<double, double> &b) {
                                 return a.first > b.first;
                             });
        } else {
            std::stable_sort(scratch.begin(), scratch.end(),
                             [](const std::pair<double, double> &a,
                                const std::pair<double, double> &b) {
                                 return a.first < b.first;
                             });
        }
        out.clear();
        out.reserve(scratch.size());
        for (std::size_t i = 0; i < scratch.size(); ++i) {
            // Not the last of its run: a later entry at this price supersedes it.
            if (i + 1 < scratch.size() && scratch[i].first == scratch[i + 1].first) continue;
            out.push_back(scratch[i]);
        }
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

    // --- est_slippage: the routed walk ------------------------------------ //
    //: Did the walk run here at all? False for a paper-equity order, for a
    //: gateway with no TCA engine, and for an order with no derived notional —
    //: the three cases where submit() evaluates no routed gate (or a fixed one).
    bool route_ran = false;
    //: TCAEngine.route_estimate would have returned None (no live book, or a
    //: walk that filled nothing) — submit() rejects with "no routable liquidity".
    bool route_none = false;
    bool route_fillable = false;
    //: UNROUNDED. Python applies round(x, 2) after the timer stops.
    double route_filled_notional = 0.0;
    //: slippage_bps is None when the consolidated mid is missing or zero, and
    //: submit() then adds NO est_slippage check at all — a distinct outcome
    //: from a failing one, so it needs its own flag rather than a sentinel.
    bool route_has_slip = false;
    double route_slippage_bps = 0.0;
    //: Indices into order_books, in leg order (notional descending, ties
    //: keeping first-touch order). Python joins the venue NAMES from this
    //: after the clock has stopped; no string work happens inside the timer.
    //:
    //: Held INLINE, not in a std::vector. A vector here was one malloc inside
    //: the timed region on every routed decision — and the allocator's own
    //: metadata is exactly as cold as everything else after the ~12 µs of
    //: Python that separates two orders, so that one allocation was a handful
    //: of cache misses, not a pointer bump. A desk routes across a handful of
    //: venues; `overflow` is the escape hatch above that and costs what the
    //: vector always cost. Nothing about the ORDER of the legs changes.
    static constexpr std::size_t kInlineVenues = 8;
    int inline_venue_order[kInlineVenues] = {};
    std::size_t venue_order_count = 0;
    std::vector<int> venue_order_overflow;

    /** Writable slots for `count` legs, inline where they fit. */
    int *venue_order_slots(std::size_t count) {
        venue_order_count = count;
        if (count <= kInlineVenues) return inline_venue_order;
        venue_order_overflow.resize(count);
        return venue_order_overflow.data();
    }

    const int *venue_order_data() const {
        return venue_order_count <= kInlineVenues ? inline_venue_order
                                                  : venue_order_overflow.data();
    }
};

// --------------------------------------------------------------------------- //
// consolidated_mid — TCAEngine.consolidated_mid, fold for fold.
//
// Depth-weighted mean of each venue's mid, weighted by the first five levels a
// side. A PLAIN `+=` accumulation, deliberately: the Python reference hand-rolls
// this loop rather than calling sum(), so reproducing it with the Neumaier
// compensation used for depth_usd would be a silent 1-ULP parity break. The
// split between the two is the contract — see the Neumaier note at the top.
//
// Extracted so the order symbol's mark and every held position's mark are the
// same arithmetic rather than two implementations that agree today.
// --------------------------------------------------------------------------- //
static std::optional<double> consolidated_mid(const std::vector<BookLadder *> &books) {
    double num = 0.0;
    double den = 0.0;
    for (const BookLadder *book : books) {
        if (book == nullptr) continue;
        auto m = book->mid();
        if (!m) continue;
        double w = book->depth_usd_side(true, 5) + book->depth_usd_side(false, 5);
        w = std::max(w, 1.0);
        num += (*m) * w;
        den += w;
    }
    if (den != 0.0) return num / den;
    return std::nullopt;
}

// --------------------------------------------------------------------------- //
// PositionBook — the held book, mirrored in C++ and mutated on fills.
//
// submit() used to rebuild five Python lists over every position on every
// order, and call RiskGateway.mark() once per position to fill the fifth.
// Those five lists change only when a fill lands; the marks change whenever a
// venue ticks, and they are derivable from ladders this core already owns.
//
// So the book lives here and the gateway mutates it at the two moments it
// actually changes — a fill, and a position closing — while the marks are
// computed inside decide()'s timed region from the mirrored ladders, using the
// same consolidated_mid() the order symbol uses.
//
// Mark resolution reproduces `live or paper` from RiskGateway.mark(): Python's
// `or` treats 0.0 as falsy, so a live mid of exactly zero falls through to the
// paper mark rather than being used. Spelled out below rather than written as
// `value_or`, because the two are not the same function.
// --------------------------------------------------------------------------- //
class PositionBook {
public:
    struct Entry {
        std::string symbol;
        double quantity = 0.0;
        double avg_price = 0.0;
        double realized = 0.0;
        std::vector<BookLadder *> books;
        /* The owning Python objects, held so `books` cannot dangle.
           BookState.native_ladder() documents the ladder as BORROWED — "a
           reader holds it only for the length of one synchronous call" — which
           is true of decide()'s order_books and is exactly what a stored mirror
           breaks. Keeping the raw pointers alone segfaulted the suite the first
           time a mirrored BookState was collected. These references are the
           mirror paying the cost that invariant was avoiding. */
        std::vector<py::object> book_refs;
        std::optional<double> paper_mark;
    };

    std::vector<Entry> entries;

    void clear() { entries.clear(); }

    std::size_t size() const { return entries.size(); }

    /** Insert or update one holding. Insertion order is the iteration order the
     *  Python dict had, which is what the parity fixture's folds depend on. */
    void upsert(const std::string &symbol, double quantity, double avg_price, double realized) {
        Entry *found = find(symbol);
        if (found == nullptr) {
            entries.push_back(Entry{symbol, quantity, avg_price, realized, {}, {}, std::nullopt});
            return;
        }
        found->quantity = quantity;
        found->avg_price = avg_price;
        found->realized = realized;
    }

    /** Takes the ladders as Python objects so their lifetime is owned here. */
    void set_books(const std::string &symbol, const py::sequence &ladders) {
        std::vector<BookLadder *> raw;
        std::vector<py::object> refs;
        raw.reserve(py::len(ladders));
        refs.reserve(py::len(ladders));
        for (const auto &item : ladders) {
            py::object held = py::reinterpret_borrow<py::object>(item);
            if (held.is_none())
                throw std::invalid_argument("ladders contains None; every entry must be a BookLadder");
            raw.push_back(held.cast<BookLadder *>());
            refs.push_back(std::move(held));
        }
        Entry *found = find(symbol);
        if (found == nullptr) {
            entries.push_back(Entry{symbol, 0.0, 0.0, 0.0, std::move(raw), std::move(refs), std::nullopt});
            return;
        }
        found->books = std::move(raw);
        found->book_refs = std::move(refs);
    }

    void set_paper_mark(const std::string &symbol, std::optional<double> mark) {
        Entry *found = find(symbol);
        if (found == nullptr) {
            entries.push_back(Entry{symbol, 0.0, 0.0, 0.0, {}, {}, mark});
            return;
        }
        found->paper_mark = mark;
    }

    void remove(const std::string &symbol) {
        for (auto it = entries.begin(); it != entries.end(); ++it) {
            if (it->symbol == symbol) {
                entries.erase(it);
                return;
            }
        }
    }

    /** `self.tca.last_price(sym) or self._paper_marks.get(sym)`. */
    std::optional<double> mark_of(const Entry &entry) const {
        auto live = consolidated_mid(entry.books);
        if (live && *live != 0.0) return live;
        return entry.paper_mark;
    }

private:
    Entry *find(const std::string &symbol) {
        for (Entry &entry : entries) {
            if (entry.symbol == symbol) return &entry;
        }
        return nullptr;
    }
};

// --------------------------------------------------------------------------- //
// Scratch — the memory the timed region reuses between decisions.
//
// Both blocks below exist because of WHERE this core runs, not what it
// computes. Two orders are ~12 µs of Python apart, and in that gap everything
// this function touched is evicted; the arithmetic is a few dozen nanoseconds
// and the cache misses around it were more. So the scratch is laid out to be
// touched in as few lines as possible, and to cost nothing to reach:
//
//   * ON THE STACK, not in five thread_locals. On Darwin every thread_local
//     access goes through a runtime wrapper, and a function-local one with a
//     non-trivial destructor adds a lazy-initialisation guard on top; five
//     std::vectors meant five wrappers, five guards and five heap blocks on
//     five different lines. WalkScratch is a fixed-size POD, so it needs no
//     allocation to reuse and lives in decide()'s own frame — which pybind11
//     has just walked to marshal the arguments, so it is the warmest memory
//     the function can reach.
//   * Interleaved, not parallel. The walk reads a venue's cursor and its slot
//     together, and a slot's venue, notional and qty together, so they sit
//     together: a two-venue desk touches ONE line of venue state and one of
//     slot state, where five parallel arrays touched five.
//
// Nothing here changes a fold, an order or a value. The overflow path above
// kInline keeps the old std::vector behaviour for a desk with more venues
// than the inline block holds, through the same pointers, so the walk itself
// has exactly one implementation.
// --------------------------------------------------------------------------- //
struct WalkScratch {
    static constexpr std::size_t kInline = 8;
    //: Per venue, in order_books order: how deep the walk has eaten, and which
    //: per_venue slot this venue owns (-1 until first touch).
    struct Venue {
        std::size_t cursor;
        int slot;
    };
    //: Per slot, in FIRST-TOUCH order — the insertion order of Python's
    //: per_venue dict, which is the order the two sum()s below fold in.
    struct Slot {
        int venue;
        double notional;
        double qty;
    };
    Venue venues[kInline];
    Slot slots[kInline];
};

//: The held book's DERIVED per-position state, expanded once per decision.
//:
//: Only two fields are derived. Quantity, average price and realized PnL are
//: already laid out in the PositionBook's own entries, so the folds below read
//: them in place; the five parallel std::vectors this used to be copied them
//: out for no reason but to make the two paths index alike. That copy was five
//: heap blocks on five cache lines behind one thread_local wrapper, reached
//: cold on every single order, holding values that already existed.
//:
//: Interleaved and inline for the same reason WalkScratch is: the mark and the
//: is-order flag of one position are read together, so they sit together, and
//: a desk holding a handful of symbols touches ONE line of this — on decide()'s
//: own stack frame, which pybind11 has just walked to marshal the arguments.
struct PositionScratch {
    static constexpr std::size_t kInline = 8;
    struct Row {
        std::optional<double> mark;
        bool is_order;
    };
    Row rows[kInline];
};

//: Above kInline the rows spill here: one thread_local behind one wrapper
//: call, resized on demand and never touched by a desk that fits inline.
static thread_local std::vector<PositionScratch::Row> g_rows;

static CoreResult decide(
    bool side_is_buy,
    bool order_type_is_limit,
    std::optional<double> order_quantity,
    std::optional<double> order_notional,
    std::optional<double> limit_price,
    bool is_paper,
    std::optional<double> paper_price,
    const std::vector<BookLadder *> &order_books,
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
    bool reduce_only_override,
    bool route_enabled,
    // When a PositionBook is supplied it SUPERSEDES the five pos_* vectors:
    // the gateway has mirrored the held book here and the marks are derived
    // below from ladders this core already owns, so nothing about the book
    // crosses the boundary per order. Null keeps the vector path, which is
    // what the parity fixture drives and what runs when no mirror exists.
    const PositionBook *position_book,
    const std::string &order_symbol) {
    (void)max_order_notional_usd;
    (void)max_symbol_notional_usd;
    (void)max_gross_exposure_usd;
    (void)max_price_deviation_bps;
    // The limits above are echoed straight back into submit()'s add() calls on
    // the Python side; they are accepted here for signature completeness and so
    // a future in-core boolean can use them without another crossing.

    // A None anywhere in the ladder list reaches C++ as a null pointer, and
    // every use below dereferences without checking. Rejecting it here turns a
    // segfault into a Python exception, which _native_decide catches and
    // answers with the reference engine. Argument validation, not gate
    // arithmetic — so it happens before the clock starts.
    for (const BookLadder *book : order_books) {
        if (book == nullptr)
            throw std::invalid_argument(
                "order_books contains None; every entry must be a BookLadder");
    }

    // The vector path indexes five parallel arrays from pos_quantities' size.
    // pybind11 validates each element's type, but it does not require those
    // arrays to have the same length; unchecked operator[] on a shorter peer
    // would therefore be undefined behaviour. A non-empty PositionBook owns
    // the rows and deliberately supersedes the vectors, so only the fallback
    // vector path needs this boundary check. Keep validation outside the core
    // timer: malformed arguments are binding work, not decision arithmetic.
    const bool use_book = position_book != nullptr && !position_book->entries.empty();
    if (!use_book) {
        const std::size_t position_count = pos_quantities.size();
        if (pos_avg_prices.size() != position_count ||
            pos_realized.size() != position_count ||
            pos_marks.size() != position_count ||
            pos_is_order_symbol.size() != position_count) {
            throw std::invalid_argument(
                "pos_* vectors must have identical lengths");
        }
    }

    CoreResult r;
    const auto t0 = std::chrono::steady_clock::now();

    // The ladders arrive COLD, and that — not the arithmetic — is what the
    // tail is made of. Roughly 12 µs of Python separates two orders, which is
    // long enough to evict every level this decision is about to fold:
    // measured on an M5 Pro, the same decide() that costs ~42 ns called back
    // to back costs ~80 ns when it is reached through submit(). Asking for
    // those lines up front lets the misses overlap instead of queueing behind
    // the header-then-data pointer chase, venue after venue.
    //
    // Reads nothing, computes nothing, changes no value. Empty and short
    // ladders are guarded before pointer arithmetic: a hardware prefetch may
    // tolerate a null/out-of-range address, but constructing that pointer in
    // C++ is still undefined behaviour. Five-level books touch two lines.
    for (const BookLadder *book : order_books) __builtin_prefetch(book, 0, 3);
    for (const BookLadder *book : order_books) {
        if (!book->bids.empty()) __builtin_prefetch(book->bids.data(), 0, 3);
        if (book->bids.size() > 4) __builtin_prefetch(book->bids.data() + 4, 0, 3);
        if (!book->asks.empty()) __builtin_prefetch(book->asks.data(), 0, 3);
        if (book->asks.size() > 4) __builtin_prefetch(book->asks.data() + 4, 0, 3);
    }

    const double sign = side_is_buy ? 1.0 : -1.0;

    // --- mark: paper quote, or the consolidated depth-weighted mid --------- //
    std::optional<double> mark;
    if (is_paper) {
        mark = paper_price;
    } else {
        mark = consolidated_mid(order_books);
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

    // --- the held book -----------------------------------------------------
    // Either the five vectors the caller passed, or the mirrored PositionBook
    // expanded here. Expanding INSIDE the timer is the point: this is the work
    // that used to be five Python list-builds and one mark() call per held
    // position, and moving it means measuring it here rather than not at all.
    // Scratch is thread_local and reused, so a steady desk allocates nothing.
    // An EMPTY mirror is expanded into five empty vectors, which every fold
    // below then folds nothing over. A flat book — start of day, or a desk
    // that has closed out — is a real state and a common one, and the
    // expansion of it provably cannot change a number: the caller leaves the
    // pos_* vectors empty whenever it passes a mirror, so both paths fold the
    // same zero elements. Skipping it skips the thread_local block entirely.
    const PositionBook::Entry *entries =
        use_book ? position_book->entries.data() : nullptr;
    const std::size_t n = use_book ? position_book->entries.size() : pos_quantities.size();

    PositionScratch scratch;
    PositionScratch::Row *rows = scratch.rows;
    if (use_book) {
        if (n > PositionScratch::kInline) {
            g_rows.resize(n);
            rows = g_rows.data();
        }
        for (std::size_t i = 0; i < n; ++i) {
            const PositionBook::Entry &entry = entries[i];
            // The order symbol's OWN holding consolidates its mark from the
            // very ladders `mark` was folded from a few lines above, in the
            // same order: `_sync_position_book` and `_native_decide` both take
            // them from `tca._live_books(symbol)`. consolidated_mid is a pure
            // function of that sequence, so folding it a second time over the
            // identical pointers returns the identical double, to the bit.
            // Reuse it instead — two mids and four five-level depth folds, or
            // twenty Neumaier steps, that a decision no longer repeats.
            //
            // Guarded on POINTER IDENTITY, not on the symbols matching. The
            // symbols agreeing is WHY it holds today; the pointers agreeing is
            // what can be CHECKED here, and the moment a venue joins, drops or
            // reorders, this falls back to the fold rather than to an
            // assumption. The paper branch is excluded because `mark` is then
            // the supplied quote, not a consolidation of anything.
            const bool same_books =
                !is_paper && entry.books.size() == order_books.size() &&
                std::equal(entry.books.begin(), entry.books.end(), order_books.begin());
            if (same_books) {
                // mark_of()'s `live or paper`: a live mid of exactly zero is
                // falsy in Python and falls through to the paper mark, so this
                // is deliberately not `value_or`.
                rows[i].mark = (mark && *mark != 0.0) ? mark : entry.paper_mark;
            } else {
                rows[i].mark = position_book->mark_of(entry);
            }
            rows[i].is_order = (entry.symbol == order_symbol);
        }
    }

    // One expression per field, resolved by `use_book`: either the mirrored
    // entries read where they already live, or the five vectors the caller
    // passed. Nothing is copied out to make the folds below index alike.
    const auto qty_at = [&](std::size_t i) -> double {
        return use_book ? entries[i].quantity : pos_quantities[i];
    };
    const auto avg_at = [&](std::size_t i) -> double {
        return use_book ? entries[i].avg_price : pos_avg_prices[i];
    };
    const auto real_at = [&](std::size_t i) -> double {
        return use_book ? entries[i].realized : pos_realized[i];
    };
    const auto mark_at = [&](std::size_t i) -> const std::optional<double> & {
        return use_book ? rows[i].mark : pos_marks[i];
    };
    const auto is_order_at = [&](std::size_t i) -> bool {
        return use_book ? rows[i].is_order : static_cast<bool>(pos_is_order_symbol[i]);
    };

    // held quantity of the order symbol (positions are keyed by symbol, so at
    // most one row is flagged).
    double held = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        if (is_order_at(i)) {
            held = qty_at(i);
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
        const auto &pm = mark_at(i);
        double m = (pm && *pm != 0.0) ? *pm : avg_at(i);
        double contrib = std::abs(qty_at(i)) * m;
        gross += contrib;
        if (is_order_at(i)) sym_notional_order = contrib;
    }
    r.projected_gross = gross - sym_notional_order + r.projected_sym;

    // --- daily drawdown ---------------------------------------------------- //
    // realized_pnl() and unrealized_pnl() are each `sum(...)` over every
    // position in insertion order, so both are Neumaier-compensated. The
    // unrealized generator yields 0.0 for a position with no mark or zero qty
    // (adding 0.0 is a no-op under Neumaier), so every position is folded.
    Neumaier realized_acc;
    for (std::size_t i = 0; i < n; ++i) realized_acc.add(real_at(i));
    const double realized = realized_acc.value();
    Neumaier unrealized_acc;
    for (std::size_t i = 0; i < n; ++i) {
        const auto &pm = mark_at(i);
        // PositionState.unrealized(mark): 0.0 unless mark truthy and qty != 0.
        double term = (pm && *pm != 0.0 && qty_at(i) != 0.0)
                          ? (*pm - avg_at(i)) * qty_at(i)
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

    // --- est_slippage: the routed walk ------------------------------------- //
    // TCAEngine.route_estimate -> _merged_walk, reproduced fold for fold.
    // submit() reaches this branch only as `elif self.tca and notional:` — the
    // paper-equity order took the fixed-model branch above it, and an order
    // with no derived notional gets no routed gate at all.
    if (route_enabled && !is_paper && notional && *notional != 0.0) {
        r.route_ran = true;
        const double target = *notional;
        // _dust(target) = max(target, 0.0) * FILL_TOLERANCE. Python's max()
        // keeps the FIRST argument unless the second is strictly greater, which
        // is what decides the sign of a -0.0 target; spelled out rather than
        // std::max so that stays true.
        const double dust = ((0.0 > target) ? 0.0 : target) * 1e-9;

        const int nv = static_cast<int>(order_books.size());
        // Scratch reused across calls, so the walk does no heap traffic after
        // the first decision. decide() runs under the gateway's asyncio lock
        // on one thread; thread_local keeps that safe if it ever does not.
        // See WalkScratch above for why it is one interleaved block and not
        // five parallel vectors.
        WalkScratch walk;  // uninitialised by design; the loop below fills [0, nv)
        WalkScratch::Venue *venue_state = walk.venues;
        WalkScratch::Slot *slot = walk.slots;
        static thread_local std::vector<WalkScratch::Venue> venue_overflow;
        static thread_local std::vector<WalkScratch::Slot> slot_overflow;
        if (static_cast<std::size_t>(nv) > WalkScratch::kInline) {
            venue_overflow.resize(static_cast<std::size_t>(nv));
            slot_overflow.resize(static_cast<std::size_t>(nv));
            venue_state = venue_overflow.data();
            slot = slot_overflow.data();
        }
        for (int vi = 0; vi < nv; ++vi) {
            venue_state[static_cast<std::size_t>(vi)].cursor = 0;
            venue_state[static_cast<std::size_t>(vi)].slot = -1;
        }
        std::size_t slot_count = 0;

        double remaining = target;
        // Python builds the whole merged ladder and sorts it:
        //     merged.extend((p, q, name) for p, q in levels)   # venue by venue
        //     merged.sort(key=lambda x: x[0], reverse=(side == "SELL"))
        // list.sort is stable, and stays stable under reverse=True, so equal
        // prices keep the order the venues were extended in. Each venue's run is
        // ALREADY sorted (sorted_asks ascending / sorted_bids descending), and a
        // stable sort of pre-sorted runs is exactly the k-way merge that breaks
        // ties toward the earlier run. Merging lazily therefore produces the
        // identical sequence while touching only the levels the walk reaches,
        // instead of sorting the fifty per venue it never gets to.
        for (;;) {
            if (remaining <= dust) break;
            int best = -1;
            double best_price = 0.0;
            for (int vi = 0; vi < nv; ++vi) {
                const auto &levels =
                    side_is_buy ? order_books[vi]->asks : order_books[vi]->bids;
                const std::size_t at = venue_state[static_cast<std::size_t>(vi)].cursor;
                if (at >= levels.size()) continue;
                const double p = levels[at].first;
                // Strictly better only: an equal price leaves `best` on the
                // earlier venue, which is the tie-break Python's stable sort
                // gives and the one the VWAP's last ULP depends on.
                if (best < 0 || (side_is_buy ? (p < best_price) : (p > best_price))) {
                    best = vi;
                    best_price = p;
                }
            }
            if (best < 0) break;  // every ladder exhausted
            const auto &levels =
                side_is_buy ? order_books[best]->asks : order_books[best]->bids;
            WalkScratch::Venue &taken = venue_state[static_cast<std::size_t>(best)];
            const auto &level = levels[taken.cursor];
            ++taken.cursor;
            const double price = level.first;
            const double level_notional = price * level.second;
            // Python's min(a, b) returns b only when b < a.
            const double take = (remaining < level_notional) ? remaining : level_notional;
            if (take <= 0.0) continue;
            int si = taken.slot;
            if (si < 0) {
                // per_venue is a dict: a venue's slot is created on first touch
                // and the insertion order is what the two sum()s below fold in.
                si = static_cast<int>(slot_count);
                taken.slot = si;
                slot[slot_count++] = WalkScratch::Slot{best, 0.0, 0.0};
            }
            // `slot[0] += take` / `slot[1] += take / price` — explicit Python
            // `+=`, so a plain fold, NOT compensated.
            slot[static_cast<std::size_t>(si)].notional += take;
            slot[static_cast<std::size_t>(si)].qty += take / price;
            remaining -= take;
        }

        // total_notional / total_qty are `sum(...)` over per_venue.values(), so
        // both are Neumaier-compensated over first-touch order.
        Neumaier notional_acc;
        for (std::size_t i = 0; i < slot_count; ++i) notional_acc.add(slot[i].notional);
        Neumaier qty_acc;
        for (std::size_t i = 0; i < slot_count; ++i) qty_acc.add(slot[i].qty);
        const double total_notional = notional_acc.value();
        const double total_qty = qty_acc.value();

        // `if total_qty <= 0: return [], None, 0.0`, then in route_estimate
        // `if not legs or not vwap: return None`.
        if (total_qty <= 0.0) {
            r.route_none = true;
        } else {
            const double vwap = total_notional / total_qty;
            if (vwap == 0.0) {
                r.route_none = true;
            } else {
                // legs: sorted(per_venue.items(), key=lambda kv: -kv[1][0]) —
                // stable, so venues that took an identical notional keep
                // first-touch order.
                int *order = r.venue_order_slots(slot_count);
                for (std::size_t i = 0; i < slot_count; ++i) order[i] = static_cast<int>(i);
                std::stable_sort(order, order + slot_count, [&](int a, int b) {
                    return slot[static_cast<std::size_t>(a)].notional >
                           slot[static_cast<std::size_t>(b)].notional;
                });
                for (std::size_t i = 0; i < slot_count; ++i)
                    order[i] = slot[static_cast<std::size_t>(order[i])].venue;

                r.route_filled_notional = total_notional;
                // absorbs(filled, requested): filled >= requested -
                // requested * FILL_TOLERANCE, and True outright for a
                // non-positive request. The multiply-then-subtract is exactly
                // the shape an FMA would fuse into one rounding; the
                // FP_CONTRACT pragma above is what stops it.
                r.route_fillable =
                    (target <= 0.0) || (total_notional >= target - target * 1e-9);
                // `mid = self.consolidated_mid(symbol)`, which for a non-paper
                // order is the same depth-weighted fold `mark` came from above,
                // over the same books in the same order. `if mid:` — a missing
                // or zero mid yields slippage_bps None, and submit() then adds
                // no est_slippage check at all.
                if (mark && *mark != 0.0) {
                    r.route_has_slip = true;
                    r.route_slippage_bps = side_is_buy
                                               ? (vwap - *mark) / (*mark) * 1e4
                                               : (*mark - vwap) / (*mark) * 1e4;
                }
            }
        }
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

// --------------------------------------------------------------------------- //
// Measurement instruments. NOT part of any decision — nothing below is called
// from decide(), and decide() is unchanged by their presence.
//
// `elapsed_ns` is a whole number of clock TICKS, not a free-running nanosecond
// count. On Apple Silicon steady_clock advances on a 24 MHz timebase and the
// conversion to nanoseconds is an integer 125/3, so a k-tick interval is
// reported as floor((t0+k)*125/3) - floor(t0*125/3): 41 or 42 for one tick,
// 83 or 84 for two, exactly 125 for three. Reading a percentile off that
// hides the only thing it can actually resolve — WHICH TICK each call landed
// on — so `tools/bench_core_ticks.py` reads the tick histogram instead, and
// these two functions give it the constants it needs to do so honestly.
// --------------------------------------------------------------------------- //

/** Width of one steady_clock tick in ns.
 *
 *  Spins on the clock and counts its TRANSITIONS across a span, rather than
 *  taking one delta: the per-read integer truncation above makes any single
 *  one-tick delta 41 OR 42, and only a long run recovers the 125/3 = 41.666…
 *  the hardware actually runs at. The loop must sample faster than the clock
 *  ticks or it misses transitions and over-states the width, so it carries no
 *  arithmetic at all, and the minimum across `rounds` runs is returned —
 *  a scheduler preemption can only ever inflate one round, never deflate it.
 *
 *  Returns 0.0 if no transition was observed, which the caller must report as
 *  "unmeasured" rather than substituting a constant. */
static double clock_tick_ns(int transitions_per_round, int rounds) {
    if (transitions_per_round < 2) transitions_per_round = 2;
    if (rounds < 1) rounds = 1;
    double best = 0.0;
    for (int round = 0; round < rounds; ++round) {
        auto prev = std::chrono::steady_clock::now();
        // Align on a tick edge so the first interval is a whole tick.
        for (;;) {
            const auto cur = std::chrono::steady_clock::now();
            if (cur != prev) { prev = cur; break; }
        }
        const auto start = prev;
        int seen = 0;
        while (seen < transitions_per_round) {
            const auto cur = std::chrono::steady_clock::now();
            if (cur != prev) { ++seen; prev = cur; }
        }
        const double span = std::chrono::duration<double, std::nano>(prev - start).count();
        const double width = span / static_cast<double>(transitions_per_round);
        if (width > 0.0 && (best == 0.0 || width < best)) best = width;
    }
    return best;
}

/** decide()'s instrumentation with NOTHING between the two clock reads.
 *
 *  The same two `steady_clock::now()` calls and the same truncating
 *  `duration_cast`, so every figure decide() reports carries this as its floor.
 *  Reported beside the decision histogram so a tick attributed to the timer is
 *  never attributed to the arithmetic. */
static std::vector<long long> clock_floor_ns(int samples) {
    std::vector<long long> out;
    if (samples < 0) samples = 0;
    out.reserve(static_cast<std::size_t>(samples));
    for (int i = 0; i < samples; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        const auto t1 = std::chrono::steady_clock::now();
        out.push_back(std::chrono::duration_cast<std::chrono::nanoseconds>(t1 - t0).count());
    }
    return out;
}

/** Measure only the language boundary. The value is returned unchanged.
 *
 * This is deliberately not timed in C++: callers put their own clock around
 * it to measure Python -> pybind11 -> C++ -> pybind11 -> Python. It performs
 * no decision work and is advertised as a versioned measurement capability,
 * so a benchmark never subtracts a guessed binding cost from the hot kernel.
 */
static double roundtrip_probe(double value) noexcept { return value; }

#ifndef ALPHAENGINE_BUILD_ID
#define ALPHAENGINE_BUILD_ID "alphaengine-decision-core/abi-1/unattributed"
#endif

PYBIND11_MODULE(_decision_core, m) {
    m.doc() =
        "AlphaEngine native pre-trade decision core: book ladders + the numeric "
        "gates. See the file header for the exact Python/C++ boundary.";

    // The Python wrapper calls decide() positionally. These names are therefore
    // an ABI, even though pybind11 would otherwise leave them as documentation
    // only. Export the complete ordered contract so a stale or incompatible
    // binary is refused at process start instead of failing (and falling back)
    // on the first order. It also settles the old wrapper comment that called
    // this a 26-argument call: the executable boundary has 28. Increment
    // ABI_VERSION for an incompatible signature or arithmetic-contract change.
    // setup.py makes BUILD_ID source/flags/architecture/SOABI specific.
    m.attr("ABI_VERSION") = 1;
    m.attr("BUILD_ID") = ALPHAENGINE_BUILD_ID;
    m.attr("CAPABILITY_VERSION") = 1;
    m.attr("CAPABILITIES") = py::make_tuple(
        "bit_exact_ieee754_v1",
        "persistent_book_ladder_v1",
        "position_book_mirror_v1",
        "routed_slippage_v1",
        "steady_clock_telemetry_v1",
        "roundtrip_probe_v1");
    m.attr("DECIDE_ARGUMENTS") = py::make_tuple(
        "side_is_buy",
        "order_type_is_limit",
        "order_quantity",
        "order_notional",
        "limit_price",
        "is_paper",
        "paper_price",
        "order_books",
        "pos_quantities",
        "pos_avg_prices",
        "pos_realized",
        "pos_marks",
        "pos_is_order_symbol",
        "working_buys",
        "working_sells",
        "starting_equity",
        "carried_realized_pnl",
        "start_of_day_equity",
        "max_order_notional_usd",
        "max_symbol_notional_usd",
        "max_gross_exposure_usd",
        "max_price_deviation_bps",
        "max_daily_drawdown_pct",
        "reduce_only_threshold",
        "reduce_only_override",
        "route_enabled",
        "position_book",
        "order_symbol");
    m.attr("DECIDE_ARGUMENT_COUNT") = 28;
#if defined(__clang__)
    m.attr("COMPILER") = std::string("clang ") + __clang_version__;
#elif defined(__GNUC__)
    m.attr("COMPILER") = std::string("gcc ") + __VERSION__;
#elif defined(_MSC_VER)
    m.attr("COMPILER") = std::string("msvc ") + std::to_string(_MSC_VER);
#else
    m.attr("COMPILER") = "unknown";
#endif
    m.attr("PYBIND11_VERSION") =
        std::to_string(PYBIND11_VERSION_MAJOR) + "." +
        std::to_string(PYBIND11_VERSION_MINOR) + "." +
        std::to_string(PYBIND11_VERSION_PATCH);

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

    py::class_<PositionBook>(m, "PositionBook")
        .def(py::init<>())
        .def("clear", &PositionBook::clear, "Drop every holding.")
        .def("upsert", &PositionBook::upsert,
             py::arg("symbol"), py::arg("quantity"), py::arg("avg_price"), py::arg("realized"),
             "Insert or update one holding. Insertion order is preserved and is "
             "the order the folds run in, matching the Python dict it mirrors.")
        .def("set_books", &PositionBook::set_books,
             py::arg("symbol"), py::arg("books"),
             "The venue ladders this symbol's mark is consolidated from.")
        .def("set_paper_mark", &PositionBook::set_paper_mark,
             py::arg("symbol"), py::arg("mark"),
             "The paper mark used when no live mid is available (or it is zero).")
        .def("remove", &PositionBook::remove, py::arg("symbol"),
             "Forget a holding. A no-op when it was never held.")
        .def("__len__", &PositionBook::size);

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
        .def_readonly("budget_used", &CoreResult::budget_used)
        .def_readonly("route_ran", &CoreResult::route_ran)
        .def_readonly("route_none", &CoreResult::route_none)
        .def_readonly("route_fillable", &CoreResult::route_fillable)
        .def_readonly("route_filled_notional", &CoreResult::route_filled_notional)
        .def_readonly("route_has_slip", &CoreResult::route_has_slip)
        .def_readonly("route_slippage_bps", &CoreResult::route_slippage_bps)
        // Materialised as a Python list on attribute access, which is after
        // decide()'s clock has stopped — the same side of the timer the
        // vector's conversion always happened on.
        .def_property_readonly("route_venue_order", [](const CoreResult &r) {
            return std::vector<int>(r.venue_order_data(),
                                    r.venue_order_data() + r.venue_order_count);
        })
        .def("materialize_tuple", [](const CoreResult &r,
                                     std::optional<std::size_t> venue_count) {
            py::tuple venue_order(r.venue_order_count);
            const int *venues = r.venue_order_data();
            const bool has_route = r.venue_order_count != 0;
            if (venue_count && has_route != (r.route_ran && !r.route_none))
                throw std::invalid_argument("native route topology is inconsistent");
            for (std::size_t i = 0; i < r.venue_order_count; ++i) {
                if (venue_count &&
                    (venues[i] < 0 || static_cast<std::size_t>(venues[i]) >= *venue_count))
                    throw std::invalid_argument("native route venue index is out of range");
                for (std::size_t j = 0; venue_count && j < i; ++j)
                    if (venues[j] == venues[i])
                        throw std::invalid_argument("native route contains a duplicate venue");
                venue_order[i] = py::int_(venues[i]);
            }
            return py::make_tuple(
                r.elapsed_ns,
                r.mark,
                r.has_price,
                r.qty,
                r.notional,
                r.projected_sym,
                r.projected_gross,
                r.dev_bps,
                r.dd,
                r.reduce_only_active,
                r.reducing,
                r.budget_used,
                r.route_ran,
                r.route_none,
                r.route_fillable,
                r.route_filled_notional,
                r.route_has_slip,
                r.route_slippage_bps,
                std::move(venue_order));
        }, py::arg("venue_count") = py::none());

    m.def("clock_tick_ns", &clock_tick_ns, py::arg("transitions_per_round") = 4096,
          py::arg("rounds") = 16,
          "Width of one steady_clock tick in ns, from counted clock transitions; "
          "0.0 when none were observed. Measurement instrument, no decision "
          "uses it.");

    m.def("clock_floor_ns", &clock_floor_ns, py::arg("samples"),
          "decide()'s two clock reads with nothing between them: the floor "
          "every elapsed_ns carries. Measurement instrument.");

    m.def("roundtrip_probe", &roundtrip_probe, py::arg("value"),
          "Return one double unchanged. Measurement-only probe for the "
          "Python/pybind11/C++ round-trip; no decision calls it.");

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
          py::arg("route_enabled"),
          py::arg("position_book") = nullptr,
          py::arg("order_symbol") = std::string(),
          "Evaluate the book arithmetic, the numeric gates and the routed "
          "slippage walk, timing only the compute with steady_clock. "
          "``order_books`` are the caller's persistent BookLadder objects and "
          "are borrowed, not copied. Returns a CoreResult.");
}
