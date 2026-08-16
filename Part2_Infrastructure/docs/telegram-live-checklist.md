# Telegram live checklist

The automated suite dispatches all 114 commands on every push and asserts their
replies. What it cannot do is prove the bot is reachable from *your* Telegram
account, that BotFather is showing the right menu, or that a photo actually
renders on a phone. That is what this is for: fifteen minutes of tapping,
grouped so you can stop at any heading and still have learned something.

Nothing here changes trading state until section 6, which is clearly marked.

---

## 0. Before you start

| Check | How | Expected |
|---|---|---|
| The deploy landed | GitHub → Actions → "Deploy gateway to OCI" | green on the commit you expect |
| The bot is running | `curl -s https://<gateway>/telegram/health` | `enabled: true`, and a `mode` of `webhook` or `polling` |
| The contract is honest | same response | `read_only: false`, `text_only: false`, `controls.gated: true` |

`read_only: false` is correct and deliberate. The bot has five commands that
change state; they are gated, and section 6 exercises that gate.

**Webhook vs polling.** Webhook mode requires `PUBLIC_URL` to be https and
`TELEGRAM_WEBHOOK_SECRET` to be at least 32 characters — the bot refuses to
start in webhook mode otherwise, rather than silently falling back. Polling
needs neither. Either is fine for this checklist.

**The command menu.** The bot re-registers its BotFather menu on every startup,
so after a deploy, typing `/` in the chat should list the current commands
including `/equity`, `/backtest`, `/rag`, `/ops`, `/timeline` and `/working`.
If it shows an older set, the client has cached it — reopen the chat.

---

## 1. Reachability (2 minutes)

| Command | Expect |
|---|---|
| `/start` | the companion card, and **no** subscription created |
| `/whoami` | your numeric user ID, and whether you are authorised |
| `/commands` | the full catalogue, grouped by category |
| `/help portfolio` | that category's commands with exact syntax |
| `/about` | the boundary, the five controls named, and the **Web parity** map |

If `/whoami` says you are not authorised, there are two ways to fix it. Add your
numeric ID to `TELEGRAM_ALLOWED_USER_IDS` and restart; or, with
`TELEGRAM_LINK_SECRET` set on both the gateway and the web deployment, open the
workspace and tap **Connect** in the header — the deep link carries a single-use
code that binds this chat to the desk pass you are already holding. Either way,
everything below needs it. The binding grants reads only: section 6 still refuses
you unless your ID is in `TELEGRAM_CONTROL_USER_IDS`.

---

## 1.5 Tap the buttons (2 minutes)

Every card carries an inline keyboard, and every button is a shortcut for a typed
command — never a capability of its own. This section is the one thing the
automated suite cannot check: that a tap actually edits the card in place.

| Tap | Expect |
|---|---|
| `/menu` | the eight desk tabs plus Digest / Status / Help, each a button |
| A tab button (e.g. **Risk**) | the tab's card, replacing the menu **in place** — not a new message below it |
| A tab footer button (e.g. **Feeds** on `/data`) | that command's card, edited into the same message |
| A switcher row — the interval on `/montecarlo`, the method on `/allocation`, the symbols on `/beta` | the card redraws for the new choice, with the active option bulleted (`•`) |
| A control's would-be button | there is none: `/remediation` lists the five controls with **no buttons**, because a control is typed and confirmed, never tapped |
| A stale button after a redeploy | a toast — "This button is from an older build. Send the command instead." — never a wrong command |

The in-place edit is the whole point of the keyboard: a tab you tapped becomes
the card you asked for, so the chat does not fill with a stack of cards. If a tap
sends a **new** message instead of editing the tapped one, note it — that is the
`ReplyTarget` path not firing.

---

## 2. The book (3 minutes)

| Command | Expect |
|---|---|
| `/portfolio` | equity, exposure, risk budget — plus an album of allocation and P&L charts |
| `/equity` | day / month / inception rows and a two-image album: the curve and its drawdown |
| `/pnl`, `/exposure`, `/concentration` | aligned columns with a flag and one interpretive line each |
| `/positions` | held positions, or a clear statement that the book is flat |

**On an empty deployment** these should say so plainly — "no snapshots
persisted yet", "the book is flat". An empty record must never be dressed as a
flat book, and a flat book must never read as an error.

---

## 3. Risk, with pictures (3 minutes)

| Command | Expect |
|---|---|
| `/var` | VaR/CVaR, the budget flag, and — with enough history — a histogram of replayed daily P&L with VaR and CVaR marked |
| `/correlation` | the text matrix **and** a heatmap |
| `/riskcontrib` | share-of-risk bars, hedges negative |
| `/stress` | scenario losses as bars, worst first |
| `/varbacktest` | exceptions against expected, with the Kupiec zone |
| `/headroom`, `/limits` | binding constraint and what is left of it |

**With a flat book or thin history, every one of these must say NOT
MEASURABLE** rather than printing zeros. If you see a confident 0.00 where
there is no sample, that is the bug this whole pass exists to prevent — tell me.

The `/var` histogram appears only when the empirical replay ran. With only the
parametric figure there is deliberately no chart: a normal curve would be
illustrating the assumption, not the book.

---

## 4. Execution and research (3 minutes)

| Command | Expect |
|---|---|
| `/orders` | recent decisions, accepted and rejected |
| `/working` | resting orders, or "none resting" — plus the note that cancel/replace stay in the web blotter |
| `/timeline <id from /orders>` | that order's transitions; an unknown id says **not found**, not rejected |
| `/slippage`, `/fees` | realised cost with its distribution |
| `/quote BTCUSDT ETHUSDT` | both symbols in one card |
| `/trend BTCUSDT 1h 50` | return, per-bar σ, and the move stated in σ of its own noise |
| `/range`, `/volume` | median beside mean, latest bar's percentile |
| `/rag momentum drawdown` | three matches, or an honest *unavailable* / *embedding failed* |
| `/backtest BTCUSDT 1h ma_cross` | a job id — then either a pushed result (if subscribed) or `/job <id>` |
| `/backtests` | recent runs with Sharpe bars coloured by verdict |

`/rag` distinguishes three states on purpose. "Index unavailable" is not the
same claim as "nothing similar recorded"; if an outage ever reads as the
latter, that is a defect worth reporting.

---

## 5. Operations (2 minutes)

| Command | Expect |
|---|---|
| `/ops` | one snapshot: platform, risk, queue, market data, audit — all read in the same instant |
| `/status`, `/reliability` | route latency and provider health |
| `/incidents` | recent incidents, or a clear all-clear |
| `/developer` | the four verify gates by name, and an API-surface chart from the committed OpenAPI snapshot |

`/developer` should name gates (`ruff check .`, `python -m pytest`,
`tools/export_openapi.py --check`, `tools/synthetic_probe.py`) — **not** a
hardcoded assertion count. If you see "342 assertions" the old card is back.

---

## 5.5 The data, reliability and developer desks (3 minutes)

These are the tab-section commands beyond the eight tab cards. The registry floor
(`tests/test_telegram_commands.py`) already dispatches every one of them on an
empty deployment and asserts it answers without error, so what is left for a
human is to confirm the *populated* card reads honestly — a chart where there is
data, a stated absence where there is not.

| Command | Expect |
|---|---|
| `/montecarlo [1\|5\|20]` | a bootstrapped cone and a terminal-P&L histogram with VaR/CVaR marked — or **NOT AVAILABLE** below 60 bars of book history |
| `/beta ETHUSDT BTCUSDT` | β, the hedge ratio, and a returns scatter with a fit line — or **NOT MEASURABLE** with too little shared history |
| `/allocation [ew\|iv\|erc\|mv]` | current-vs-target bars and the drift table, method row bulleted — or **NOT MEASURABLE** on a flat book |
| `/performance` | realised P&L and fees bars by strategy — or **NO FILLS** on an empty audit |
| `/trust` | a verdict — TRUSTED / DEGRADED / SYNTHETIC / UNAVAILABLE — and book-age bars, red when a venue is stale |
| `/dataquality`, `/payload BTCUSDT`, `/providers`, `/tasks` | feed transitions, per-venue provenance (a missing field is `—`, never `0`), provider status, and the web-only work-queue note |
| `/sli`, `/planes`, `/circuits` | service levels including the native core's **nanosecond** figure, the three dependency planes as a status grid, and the breakers as a headroom ladder |
| `/traces`, `/remediation`, `/webops` | origin-tagged audit+web events, the five typed controls (no buttons), and the raw web-ops ledger the workspace only summarises |
| `/readiness`, `/cicd`, `/apis [TAG]`, `/codebase` | the launch-readiness grid, the verify gates by name, the OpenAPI surface by tag, and the repo's line counts by area |
| `/compare BTCUSDT ETHUSDT 1h` | a normalised overlay indexed to 100, with an interval switcher |

The **NOT AVAILABLE / NOT MEASURABLE / NO FILLS** answers are the ones that
matter: on an empty or flat deployment every one of these must say what is
missing rather than draw a confident zero. That is the same house rule §3 checks
for the risk cards, extended to the new desks.

---

## 6. Controls — this section changes state

**Operator setup, which I have deliberately not done for you.** Control
commands need `TELEGRAM_CONTROL_USER_IDS` in `Part2_Infrastructure/.env` on the
OCI host. It is separate from the read allow-list and empty by default, so the
controls currently fail closed: reading the book does not imply being able to
stop the desk. Add your numeric user ID and restart the gateway.

Until you do, every command below should refuse with the allow-list card. That
refusal *is* a passing result — verify it first.

Then, with rights granted:

1. `/reduceonly on` → a card with a **4-digit code** and the stated impact.
2. `/reduceonly <code>` within 90 seconds → applied.
3. `/risk` → confirms reduce-only is on.
4. `/reduceonly off` → same dance, released.
5. `/halt` → code → `/halt <code>` → applied; `/status` shows the kill switch active.
6. `/resume` → code → applied.

Things worth confirming while you are here:

- A code is **single-use**. Replaying it must fail.
- A code is **bound to your user ID**. Forwarding the message to someone else
  does not let them fire it.
- A code is **bound to its action**. A `/halt` code must not confirm `/flatten`.
- Codes **die on restart**, by design — a deploy mid-confirmation means
  starting over, which is the safe direction.

`/flatten` submits real closing orders through the same seventeen pre-trade
gates as any other order. On a paper book that is safe to exercise; do it only
if you want to see the gate vector.

---

## 7. Degradation spot-checks (2 minutes)

These are the ones that matter most, because they are where a system usually
starts lying.

| Try | Expect |
|---|---|
| A symbol with no bars, e.g. `/trend ZZZZ` | an honest provider error, not an empty chart |
| `/var` on a flat book | NOT MEASURABLE, no histogram |
| `/equity` with no snapshots | "no snapshots persisted yet" — an empty record, not a flat book |
| Several chart commands in a row | all arrive; the transport paces sends and honours Telegram's own retry interval |
| `/rag` with the index down | "index unavailable", never "nothing similar" |

---

## If something is wrong

Note the command, what it said, and what you expected. The registry floor test
means a broken *handler* fails CI, so what tends to survive to production is
the subtler kind: a number that is right but unreadable, a caption that claims
more than the data supports, or a state described as the wrong kind of absence.
Those are exactly the ones worth telling me about.
