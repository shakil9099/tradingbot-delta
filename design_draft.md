# ETH Perpetual Trading Bot (Delta Exchange India)

*   **Author:** Shakil Dodhiya
*   **Status:** Draft
*   **Date:** 2026-11-08

--------------------------------------------------------------------------------

## Overview

A single-process Node.js + Express + TypeScript service runs on a VPS under PM2. It trades only the ETHUSD perpetual (product 3136) on Delta Exchange India with real money.

**Each hour, when a 1h candle closes, the service:**

1. fetches the closed candles from Delta;
2. computes two signal sources, Hull Suite and UT Bot;
3. scores each source by how a simulated version of it has done recently;
4. acts on the signal of the better-scoring source.

**Every trade has:**

*   a stop-loss $20 below the entry price (above it for shorts);
*   a take-profit $100 beyond the entry price.

Both orders sit on the exchange, so they work even if the bot is down.

**On each candle close, the stop moves only toward profit:**

*   at +$12 profit, it moves to entry ± $2.5;
*   at +$25 profit, it moves to entry ± $15, and from then on follows $10 behind the close.

The three stop states are called stage 0 (initial), stage 1 (locked at +$2.5) and stage 2 (trailing).

**Sizing and reversal:**

*   Position size in ETH = USD balance ÷ 141, in 0.01 ETH steps. The 141 is the author's chosen number of dollars of balance per 1 ETH of position.
*   An opposite signal closes the trade and opens the reverse one.
*   After three initial $20 stop-losses with no profitable trade between them, the bot stops opening trades until the author resumes it.

**Two companion pieces:**

*   A password-protected dashboard, served by the same process. It shows:
    *   the open position;
    *   every trade, with why it was opened and why it was closed;
    *   each strategy's score;
    *   rule-based notes on what could be improved.
*   A new Pine Script strategy, `eth_strategy.pine`. It reproduces the same signals and exits on TradingView for visual checking and backtesting.

## The Problem

Today the author has `bot.pine`, a 1,400-line TradingView indicator. It combines many tools: Smart Money Concepts (SMC), fair value gaps (FVG), order blocks, three-bar reversals, UT Bot and Hull Suite. Its limits:

*   It only draws signals and fires alerts. It does not trade, manage stops or track results.
*   The author has noticed that sometimes Hull Suite works better and sometimes UT Bot does. Requiring both to agree throws away most trades. Taking either one produces many false signals.

**Problems this design solves:**

1.  **Manual execution.** Trading the signals by hand means missed candle closes and stops moved late or not at all. The trailing plan needs action on every hourly close, around the clock.
2.  **No way to choose between Hull and UT Bot.** The choice is gut feel today. This design scores both on the same recent price history, with the same exit rules and fees, and trades the leader. A switch needs a lead of at least $20, so small score differences do not trigger one.
3.  **No record of why trades won or lost.** Without a trade log tied to the reason for each entry and exit, the author cannot tell whether losses come from the strategy, the stop distance, fees or reversals. The dashboard records the data needed to answer that.

The risks the author has accepted are listed in [Risks & Mitigations](#risks--mitigations): about 14–16% of the account lost per stop, no testnet, a +$2.5 "cost to cost" (breakeven) step that nets about −$0.10 after fees, and no proven edge yet.

## Goals

1.  **Hands-off trading.** The bot trades the ETHUSD perpetual long and short, with no manual steps after start-up, and acts within 3 minutes of each 1h candle close (UTC).
2.  **A stop on every open position.** Every open position has an exchange-side stop-loss and take-profit from the moment it fills. The one exception is a reversal: the bot is flat and re-opening for up to about 20 s (a 10 s flat poll plus a 10 s fill poll). Reconciliation finds any position without a bracket within 60 seconds and attaches one.
3.  **Exits match the spec.** Trailing behaves exactly as in the [ratchet table](#trailing-ratchet), for both long and short, and never loosens the stop.
4.  **The numbers match Pine.** On bars after the 200-bar warm-up, TypeScript Hull and UT stop values match `eth_strategy.pine` within 0.01 on the same OHLC, and both fire signals on the same bars.
5.  **The selector is predictable and explained.** The bot picks a strategy by net P&L after fees over each strategy's last 10 simulated trades. It switches only with a lead of $20 or more, and only while flat or at a signal. Every switch is logged with its reason.
6.  **Sizing follows the rule, capped by margin.** Size = floor(balance ÷ 141 × 100) contracts, further limited by the available margin at the set leverage. The bot refuses to trade below 1 contract, or if the leverage cannot be confirmed.
7.  **The circuit breaker works.** After 3 initial $20 stop-loss hits with no profitable trade between them, the bot opens no new trades until the author presses Resume. The dashboard stays up, and `/health` reports the halt.
8.  **Restarts are safe.** After a crash or restart, the bot never opens a second position. It brackets any unprotected position within 60 s of boot, and halts on any side or size mismatch it cannot explain.
9.  **Every trade is explained.** For each trade, the dashboard shows:
    *   entry time, price, side and size;
    *   the strategy and signal that opened it;
    *   every stop move;
    *   the exit reason (one of the values in [Persistence](#persistence-sqlite-databotdb)) and net P&L after fees.
10. **Improvement notes come from data.** The dashboard computes fixed, rule-based notes from the trade log, for example:
    *   win rate and net P&L per strategy;
    *   fee drag as a share of gross P&L;
    *   how often the stop fires right after moving to +$2.5;
    *   P&L of reversal exits;
    *   losses by hour of day.
11. **Backtests.**
    *   `npm run backtest` (the reference) reports net P&L after fees for adaptive, fixed Hull and fixed UT, plus how often the strategy switches.
    *   `eth_strategy.pine` gives an approximate check on TradingView.
    *   If adaptive trails the best fixed strategy, the author sets `STRATEGY` to that strategy.

## Non-Goals

*   **Other markets.** No other symbols, exchanges, or Delta Global (`api.delta.exchange`).
*   **TradingView in the live path.** No TradingView webhooks or alerts are used to trade.
*   **Faster data.** No WebSocket feeds and no timeframes other than 1h. REST polling is enough at one decision per hour.
*   **AI analysis.** No AI-written trade reviews. Improvement notes are rule-based.
*   **Testnet stage.** None (declined by the author; see [Risks & Mitigations](#risks--mitigations)).
*   **Multiple users.** No multi-user dashboard, roles or public sharing.
*   **Changes to `bot.pine`.** It stays as it is. Its SMC, FVG, order-block, session and 3-bar-reversal tools play no part in trading.
*   **Automatic tuning.** Parameters are never auto-optimized. All numbers are fixed config values that only the author changes.
*   **Other exit styles.** No ATR-based or volatility-scaled stops or targets in this version.

## Open Questions

*   **Bracket edit behaviour:** Does `PUT /v2/orders/bracket` edit the position's bracket stop in place, or does it cancel and re-create it?
    *   To verify with a 1-contract live trade (`MAX_CONTRACTS=1`).
    *   If it cancels and re-creates, `trail` instead places the new stop-loss first, then cancels the old one.
*   **Bracket after flat or flip:** Does Delta cancel a position bracket automatically when the position goes flat? Reconciliation cancels stray stop orders either way.
*   **Settlement asset and balance field:** Which wallet asset (USD vs USDT) holds the trading balance on Delta India, and should sizing use `available_balance` or `balance`? The provisional choice is `available_balance` of the settling asset, read after any close.
*   **`client_order_id`:** Does Delta enforce unique `client_order_id`s, and can an order be looked up by one? Retry safety does not depend on the answer: the position-size check is the main guard.
*   **Margin mode:** Which endpoint reads and sets isolated vs cross margin for product 3136? The docs list a margin-mode setting under user preferences. Until one is confirmed, the bot relies on `ISOLATED_MARGIN_CONFIRMED` while flat, and checks `margin_mode` **after each fill**.
*   **Candle `time` field:** Is `time` the bar's open time? A boot check compares the newest candle with `floorHour(now) − 3600`.
*   **TradingView feed:** Which TradingView symbol, if any, carries Delta India ETHUSD? If none does, the Pine backtest runs on another venue's prices and is only approximate. The parity test avoids the question by using TradingView's own OHLC.
*   **Rate limits:** What are the numeric REST limits? The bot makes about 310 calls per hour: about 10 per cycle, plus about 5 per reconcile every 60 s (position, open orders, fills when needed, balance, ticker). On a 429, the reconcile interval doubles, up to 5 minutes.
*   **Loss limit (escalated, not decided):** Should a drawdown halt be added? It would stop trading when the balance falls X% below its peak. The author has not answered. See [Risks & Mitigations](#risks--mitigations).

## Critical User Journeys (CUJs)

### CUJ 1: Signal opens a trade

*   **Given**: The bot is running live, flat, not halted. The selected strategy is Hull. The account has $300 available. ETH is $2,225.
*   **When**: The 13:00 UTC candle closes, and Hull's trend flips from down to up on that closed bar.
*   **Then**:
    1.  At about 14:00:10 the bot computes the size: floor(300 ÷ 141 × 100) = 212 contracts (2.12 ETH), within the margin cap.
    2.  It sends a market buy with the bracket stop-loss and take-profit attached.
    3.  It reads the fill price, say $2,226.40, and moves the bracket to exactly $2,206.40 (SL) and $2,326.40 (TP).
    4.  The trade appears on the dashboard with the reason "Hull flip up @ 13:00 candle".

### CUJ 2: Trailing on candle closes

*   **Given**: A long from CUJ 1 is open, with entry $2,226.40.
*   **When**: Later closes are $2,240.00 (+$13.60), then $2,253.00 (+$26.60), then $2,260.00.
*   **Then**:
    1.  The SL moves to $2,228.90 (stage 1).
    2.  Then max($2241.40, $2243.00) = $2,243.00 (stage 2).
    3.  Then $2,250.00.
    4.  If a later close is lower, say $2,255.00, the SL stays at $2,250.00.
    5.  Every move is logged and shown on the dashboard.

### CUJ 3: Opposite signal reverses the trade

*   **Given**: A long is open.
*   **When**: The selected strategy flips to down on a closed candle.
*   **Then**:
    1.  The bot sends a `reduce_only` market sell and confirms the position is flat.
    2.  It cancels any leftover stop orders and re-reads the balance.
    3.  It opens a short with a fresh $20/$100 bracket.
    4.  The long is recorded with exit reason "reversal".
    5.  If a step fails after the retries described in [Exchange integration](#exchange-integration), the bot halts and alerts.

### CUJ 4: Three stop-losses in a row halt the bot

*   **Given**: The last two closed trades both hit their initial $20 stop.
*   **When**: A third trade hits its initial $20 stop.
*   **Then**:
    1.  The bot sets HALTED.
    2.  The dashboard shows a red "Halted: 3 consecutive stop-losses" banner, and new signals are logged but not traded.
    3.  When the author presses Resume, the counter resets and trading continues from the next signal.
    4.  Meanwhile `/health` returns 503, so an outside uptime monitor sees the halt even without Telegram.

### CUJ 5: Restart with an open position

*   **Given**: A short is open with its stop at stage 2. PM2 restarts the process after a crash.
*   **When**: The bot boots.
*   **Then**:
    1.  It reads the position and open orders from Delta.
    2.  It matches them to the open trade in SQLite and keeps the tighter of the stored stop and the exchange stop.
    3.  It attaches a bracket if one is missing.
    4.  It continues managing the trade from the next candle close. It does not open a second position.

### CUJ 6: Reviewing performance

*   **Given**: The bot has closed 40 trades.
*   **When**: The author logs into the dashboard.
*   **Then**: The dashboard shows:
    1.  the trade table, with entry and exit reasons;
    2.  total and per-strategy net P&L;
    3.  the current selector scores;
    4.  improvement notes such as "31% of stage-1 trades were stopped within 2 candles; the +$2.5 stop nets about −$0.10 after fees; consider +$3.5 or a later trigger".

## Technical Plan (Architecture)

### Component map

The bot is one Node.js process with three layers:

*   **A pure core.** No input/output, so it is fully unit-testable.
*   **An exchange layer.** All Delta calls go through one client.
*   **An engine.** It schedules work and owns the trading state.

Express serves the JSON API and the built React dashboard from the same process. All state that must survive a restart lives in one SQLite file.

```text
                         ┌──────────────── Node process (PM2, 1 instance) ────────────────┐
                         │                                                                 │
 Delta India REST ◄──────┤ exchange/deltaClient  (HMAC sign, retry, skew check)            │
 api.india.delta.exchange│        ▲                                                        │
                         │        │                                                        │
                         │ exchange/executor  (entry / close / trail sequences, idempotent) │
                         │        ▲                                                        │
                         │        │ intents                                                │
                         │ engine/cycle  ◄── engine/scheduler (HH:00:10 UTC + retries)      │
                         │        │   ▲                                                    │
                         │        │   └── engine/reconciler (boot + every 60 s)            │
                         │        ▼                                                        │
                         │ core/indicators → core/signals → core/simulator → core/selector │
                         │ core/ratchet   core/sizing   core/breaker   core/insights       │
                         │        │                                                        │
                         │ store/db (SQLite, better-sqlite3, WAL)  data/bot.db              │
                         │        ▲                                                        │
                         │ api/ (Express: /health, /api/*, session auth)                   │
                         │        ▲                                                        │
                         │ static web/dist (React + Vite SPA)                              │
                         └────────┼────────────────────────────────────────────────────────┘
                                  │ HTTPS via Caddy reverse proxy (127.0.0.1:3000)
                               Browser (author)
```

### What happens on each candle close

The scheduler wakes at HH:00:10 UTC and runs one **cycle**. A cycle never overlaps another: a mutex guards it, and the reconciler waits on the same mutex.

1.  **Fetch candles.** Call `GET /v2/history/candles?symbol=ETHUSD&resolution=1h&start=<floorHour(now) − 1999·3600>&end=<floorHour(now) − 1>`. This window covers exactly 2,000 closed bars and never includes the open one.
    *   Sort by `time` ascending.
    *   Drop any candle with `time + 3600 > now` (still open).
    *   If the newest closed candle is not the one that just closed (`time == floorHour(now) - 3600`), retry every 15s for up to 2 minutes. If it still has not appeared, log `CYCLE_MISSED` and alert. That candle's signal and trail update are skipped. The next cycle catches a missed flip through the direction-state check in [Signal definition](#signal-definition).
    *   If any hour inside the window is missing, log it. The bot does not fill gaps: indicators are computed over the candles present.
2.  **Skip duplicates.** If this candle's `time` equals `kv.last_processed_candle`, stop. This makes the cycle safe to run twice.
3.  **Compute indicators** (Hull, UT Bot) over the whole window, from scratch every time. Nothing is updated incrementally, so a restart cannot cause drift.
4.  **Find each strategy's signal** on the newest closed bar: `LONG`, `SHORT` or `NONE`.
5.  **Simulate both strategies** over the window and score them (see [Strategy Selection Contract](#strategy-selection-contract)). Store the simulated trades in `sim_trades`, which is rebuilt each cycle.
6.  **Selector.** Update `active_strategy` and any `pending_switch`.
7.  **Decide the action.** "Opposite" means either an opposite signal from the active strategy on this bar, or a missed flip: the active strategy's direction state disagrees with the position.

    | Halted? | Position | Active strategy | Action |
    | :--- | :--- | :--- | :--- |
    | no | flat | signal on this bar | `ENTER` |
    | no | flat | no signal | `NONE` |
    | no | open | opposite | `REVERSE` |
    | no | open | not opposite | `TRAIL` (ratchet) |
    | yes | flat | any | `NONE` (still logged as "halted") |
    | yes (`breaker`, `manual` or `crash_loop`) | open | opposite | `CLOSE` only, with no re-entry |
    | yes (`breaker`, `manual` or `crash_loop`) | open | not opposite | `TRAIL` |
    | yes (`mismatch` or `fatal_error`) | open | any | `NONE`: the exchange bracket stays as it is, and the author decides |

    A `liquidation` halt always happens with the bot already flat, so it falls under the "yes, flat" row.

    `crash_loop` keeps protecting the position, because repeated restarts are a process problem, not an unknown exchange state. The kind is stored in `kv.halt_kind`.

8.  **Carry out the action** through the executor.
9.  **Write the decision row** to the `decisions` table: candle OHLC, indicator values, both signals, both scores, the active strategy and the action. Then set `kv.last_processed_candle`.

### Position state machine

The trade's position state is stored in `trades.status`:

```text
            ENTER                fill + bracket confirmed
  FLAT ─────────────► OPENING ─────────────────────────► OPEN
   ▲                     │ no fill / failed                │
   │                     ▼                                 │ REVERSE, manual close,
   │                   FLAT                                │ trail_breached
   │                                                       ▼
   │◄──────────── flat confirmed ◄──────────────────── CLOSING
   │                                                       │ REVERSE (not halted)
   │                                                       ▼
   │                                                OPENING (new side)
   │
   └──── exchange SL / TP / liquidation / external close (seen by reconciler) ◄── OPEN
```

`HALTED` is a separate flag (`kv.halted`), not a position state:

*   It blocks only new entries: `ENTER`, and the re-entry leg of `REVERSE`.
*   An open position keeps its exchange bracket. After a breaker or manual halt, the position is still trailed, and an opposite signal still closes it (see the action table).
*   Resume clears the flag.

### Indicator parity specification

The TypeScript code ports the Hull and UT Bot logic from `bot.pine`, with the changes listed below. Pine `na` maps to `NaN`, and any arithmetic involving `NaN` gives `NaN`. **The TS ports are the reference.** `eth_strategy.pine` is written to match them, with the same explicit rounding.

*   **WMA(src, n):** Σ src[t−i]·(n−i) / Σ (n−i), for i = 0..n−1. `NaN` until n values exist.
*   **Hull (HMA, length 55):**
    *   `HULL = WMA(2·WMA(close, 27) − WMA(close, 55), 7)`.
    *   The half-length is `floor(55/2) = 27`; the smoothing length is `round(sqrt(55)) = 7`.
    *   The new Pine file hard-codes `math.floor(len / 2)`, so both sides agree whatever v6 does with 27.5.
    *   `hullUp[t] = HULL[t] > HULL[t−2]`.
*   **ATR(6), as Pine's `ta.atr`:**
    *   `TR[0] = high − low`.
    *   `TR[t] = max(high−low, |high−close[t−1]|, |low−close[t−1]|)`.
    *   `ATR[5] = SMA(TR[0..5])`.
    *   After that, `ATR[t] = (ATR[t−1]·5 + TR[t]) / 6`.
*   **UT Bot trailing stop** (bot.pine:927-935), with `src = close`, `nLoss = 2·ATR` and `prev = nz(stop[t−1], 0)`:
    *   if `src > prev and src[t−1] > prev`: `max(prev, src − nLoss)`
    *   else if `src < prev and src[t−1] < prev`: `min(prev, src + nLoss)`
    *   else if `src > prev`: `src − nLoss`
    *   else: `src + nLoss`

    All comparisons are strict, as in Pine. If `nLoss` is `NaN`, the stop is `NaN`, and `nz` turns it into 0 on the next bar, as in Pine.
*   **UT signals:**
    *   `utBuy[t] = src[t] > stop[t] and src[t−1] <= stop[t−1]`.
    *   `utSell[t] = src[t] < stop[t] and src[t−1] >= stop[t−1]`.
    *   Both are false if any value is `NaN`.
    *   `ta.ema(src, 1)` is the identity, so it is dropped.
*   **Dropped from `bot.pine`:**
    *   the Heikin Ashi option, which is a no-op because it requests plain `close`;
    *   the Hull `useHtf` option, which repaints;
    *   the EHMA and THMA modes.
*   **Warm-up:** no signal is acted on, or simulated, in the first 200 bars of the window.
*   **Golden test:** a fixture CSV of about 700 ETHUSD 1h bars, exported from one TradingView chart running `eth_strategy.pine`. It holds OHLC, HULL and the UT stop.
    *   The TS code is fed **that same OHLC**, so the test does not depend on TradingView carrying Delta India's feed.
    *   **Pass rule:** on every bar after the 200-bar warm-up, Hull and UT stop values match within 0.01, and signals fire on the same bars. This is the same rule as Goal 4.
    *   The UT stop builds on its own previous value, so it only matches TradingView's full-history values once enough bars have passed. The 200 warm-up bars are excluded for that reason. If the test shows they are too few, `WARMUP` is raised.

### Signal definition

*   **Hull:**
    *   `LONG` on bar t if `hullUp[t] and not hullUp[t−1]`.
    *   `SHORT` if `not hullUp[t] and hullUp[t−1]`.
    *   A flat Hull (`HULL[t] == HULL[t−2]`) counts as "not up", exactly as in Pine's colour logic.
*   **UT Bot:** `LONG` on `utBuy`, `SHORT` on `utSell`.
*   **Direction state:** besides the flip events, each strategy has a current direction: Hull is up if `hullUp[t]`, and UT is up if `src[t] > stop[t]`.
    *   If a position is open and its side disagrees with the active strategy's direction state, a flip was missed (an outage, a restart or `CYCLE_MISSED`). The bot treats this as an opposite signal and reverses, with entry reason `missed_flip`.
    *   The direction state never opens a trade from flat.
*   **Same-direction signals** are ignored while in a position.
*   **After an SL or TP exit**, the bot waits for the active strategy's next flip. It never enters from flat on a trend that already exists, including at startup. The simulator follows the same rule.

### Strategy Selection Contract

`core/simulator` and `core/selector` are pure functions. The simulator is also the TypeScript backtester.

**Simulator** (`simulate(strategy, candles, signals, params) → SimTrade[]`). For each strategy on its own, as if it always traded 1 ETH:

*   **Entry:** at the **open of the bar after** the signal bar. Live, the bot enters about 10s after the close, which approximates the next open.
*   **Initial SL/TP:** entry ∓ 20 / ± 100.
*   **Every bar from the entry bar on:**
    1.  Check SL and TP against the bar's `low`/`high`. If both were touched, assume **the SL filled first**. Fill at the SL/TP price, or at the bar's open if the bar gapped through the level.
    2.  Then apply the ratchet using that bar's close.
*   **Opposite signal:** exit at the next bar's open, then re-enter the opposite way at the same price.
*   **Costs:**
    *   **Fees:** 0.059% of notional per side (0.05% taker plus 18% GST).
    *   **Slippage:** 1 tick (0.05) against the trade on every fill, the same as Pine.
*   **Not applied:** funding, and the circuit breaker.

**Score:** the sum of net P&L, per ETH, of the strategy's last **10** closed simulated trades.

**Validation:** the selector is not proven to beat a fixed strategy. One trade ranges from about −$22.6 to +$97, so a 10-trade score is noisy.
*   `npm run backtest` reports adaptive, fixed Hull and fixed UT side by side, with switch counts.
*   The author reviews that report before going live. If adaptive trails the best fixed strategy, the author sets `STRATEGY` to that strategy.
*   Whether this should be a hard go-live gate is escalated and not decided (see [Open Questions](#open-questions)).

**Selector rule**, run once per cycle. The function is `select(input)`, where `input = {scores, counts, active, pending, isFlat, positionSide, signals, override}`.

1.  If either strategy has fewer than 10 simulated trades, `active = 'hull'` (the cold-start default).
2.  `candidate` = the non-active strategy. If `score[candidate] ≥ score[active] + 20`, set `pending = candidate`. If it no longer leads by 20, clear `pending`.
3.  If `pending` is set and the bot is **flat**: `active = pending`, then clear `pending`. If the new active strategy has a signal on this same bar, that signal counts and the bot enters. Otherwise it waits for that strategy's next flip.
4.  If `pending` is set and **in a position**, and the pending strategy fires a signal opposite to the position on this bar: `active = pending`, then `REVERSE` into that signal.
5.  If `STRATEGY=hull` or `STRATEGY=ut` is set, the selector is bypassed. Scores are still computed and shown.
6.  Every change to `active` writes a `strategy_switch` row to `system_events`, giving both scores and the reason.

While in a position, signals from the non-active strategy are ignored, except in rule 4.

### Trailing ratchet

Profit is measured per ETH on the candle close, before fees:

*   long: `p = close − entry`;
*   short: `p = entry − close`.

`entry` is the actual average fill price.

| Stage | Trigger (on close) | Long SL candidate | Short SL candidate |
| :--- | :--- | :--- | :--- |
| 0 (initial) | at fill | entry − 20 | entry + 20 |
| 1 (locked) | p ≥ 12 | entry + 2.5 | entry − 2.5 |
| 2 (trailing) | p ≥ 25 | max(entry + 15, close − 10) | min(entry − 15, close + 10) |

There are exactly three stages: 0, 1 and 2. `trades.stage` stores them, and they appear in exit reasons as `sl_stage_0`, `sl_stage_1` and `sl_stage_2`.

**Rules:**

*   `newSL = max(currentSL, candidate)` for longs, and `min` for shorts. **The stop never loosens.**
*   A single candle can jump straight from stage 0 to stage 2.
*   Stop prices round to the 0.05 tick **toward profit**: longs round up, shorts round down. The never-loosen check runs again after rounding.
*   `currentSL` is the stop price read from the exchange in this cycle, not a cached value.
*   A `PUT` is sent only when `newSL` differs from it by at least one tick.
*   **Breached:** if the new long SL is at or above the last traded price (at or below, for shorts) when the bot sends it, the bot closes at market. The exit reason is `trail_breached`.
*   **PUT failure:** retry up to 3 times. If it still fails, alert, and leave the old stop in place. The old stop is looser, but it still protects the position.
*   **If the PUT is not an in-place edit** (an open question): place the new stop-loss order first, confirm it, then cancel the old one. The position is never without a stop.
*   **TP** stays fixed at entry ± 100.
*   **Stage** is derived from where the SL sits relative to entry, so it survives restarts:
    *   stage 0 if `SL < entry + 2.5`;
    *   stage 1 if `SL < entry + 15`;
    *   otherwise stage 2 (mirrored for shorts).

### Sizing and leverage

*   **Balance:** `available_balance` of the settling asset, from `GET /v2/wallet/balances`. This choice is provisional (see [Open Questions](#open-questions)). On a reversal it is read **after** the close is confirmed flat.
*   **Last price:** `GET /v2/tickers/ETHUSD` (field `close`; it also returns `mark_price`). This endpoint was checked against the live API on 2026-11-08. It is used for the margin cap, the starting bracket prices, the `trail_breached` check and `DRY_RUN` fills.
*   **Base size:** `floor(balance × 100 / 141)` contracts, computed in integer cents to avoid float errors.
*   **Margin cap:** `floor(balance × LEVERAGE × 0.9 / (lastPrice × 0.01))`. The 0.9 leaves room for fees.
*   **Final size:** `min(base, marginCap, MAX_CONTRACTS)`. If it is below 1, skip the entry and log `SIZE_TOO_SMALL`.
*   **Margin mode:** the bot requires **isolated**, because on cross margin liquidation could fall inside the stop. No endpoint for reading the mode while flat is confirmed, so the check has two parts:
    *   **Flat:** the env flag `ISOLATED_MARGIN_CONFIRMED=true` must be set by the author, after setting isolated mode in the Delta app. Without it, the bot refuses to start live (`DRY_RUN=false`).
    *   **After every fill:** the bot polls `GET /v2/positions/margined` every 1 s, for up to 15 s, until the position appears there. That endpoint can lag about 10 s.
        *   If `margin_mode` is explicitly `cross`: close the position with exit reason `margin_mode` and halt (`fatal_error`).
        *   If it is still unknown after 15 s, or the field is absent: alert and **keep** the position. The reconciler re-checks every tick. If it is still unknown after 5 minutes, halt (`fatal_error`) without closing.
*   **Leverage (`LEVERAGE`, default 20):**
    *   set with `POST /v2/products/3136/orders/leverage`, at boot if flat, otherwise the first time the bot is flat after boot;
    *   read back with `GET` before every entry;
    *   if it does not match, set it again once (only while flat). If it still does not match, refuse to enter and alert. The exchange default of 200x would put liquidation inside the $20 stop.
*   **Effective leverage** (`size × 0.01 × price / balance`) is logged on every entry.

### Exchange integration

*   **Client:**
    *   `deltaClient` signs `method + timestamp + path + query + body` with HMAC-SHA256 (hex), and sends the `api-key`, `signature`, `timestamp` and `User-Agent: tradingbot-eth/1.0` headers.
    *   The signature is regenerated on every attempt, because each one is valid for only 5s.
    *   Timeout: 10s.
*   **Retries and errors:**

    | Kind | Examples | Handling |
    | :--- | :--- | :--- |
    | Retryable | network error, timeout, HTTP 5xx, HTTP 429 | retry up to 3 times with backoff (0.5s, 1s, 2s). On 429, the reconcile interval also doubles, up to 5 minutes. |
    | Fatal | 401/403; `SignatureExpired` that persists after re-signing; insufficient margin; invalid size or price; product not found | **halt and alert** |
    | Unknown | any other 4xx, or a response body that cannot be parsed | **halt and alert** |

*   **Order retries:** POSTs that create orders are never retried blindly.
    *   **Main guard:** re-read the position size. If it is already non-zero (for an entry) or already zero (for a close), the earlier order went through, so do not retry.
    *   **Second check:** look up the `client_order_id`, if Delta supports that (see [Open Questions](#open-questions)).
*   **"Alert"** means: log at error level, plus a Telegram message if Telegram is configured. At boot, a warning is logged if Telegram is not configured.
*   **Clock:** at boot, the client compares the local clock with the `Date` header of a Delta response. If they differ by more than 2s, it refuses to start. The VPS runs chrony.
*   **Product check:** at boot, `GET /v2/products/ETHUSD` must return id 3136, `contract_value` 0.01 and `tick_size` 0.05. On any mismatch, the bot halts.

**Entry sequence** (`executor.enter(side, candleTime, reason)`):

1.  Run the pre-checks:
    *   the bot is not halted;
    *   the position is flat (`GET /v2/positions?product_id=3136`);
    *   there are no stray orders (if there are, cancel them with `cancelAll`, then re-check);
    *   `getLeverage()` equals `LEVERAGE` (if not, set `kv.leverage_ok = 0` and refuse the entry).
2.  Insert a `trades` row with status `OPENING` and `client_order_id = eth-<candleTime>-open-<side>-<attempt>`. This is the outbox.
3.  `POST /v2/orders`:
    *   `{product_id: 3136, size, side, order_type: "market_order", client_order_id}`;
    *   `bracket_stop_loss_price` and `bracket_take_profit_price` from the last price ∓ 20 / ± 100, rounded to the tick;
    *   `bracket_stop_trigger_method: "last_traded_price"`.
4.  Poll `GET /v2/positions` every 500ms, for up to 10s, until `size ≠ 0`. Read `entry_price` and the filled size.
5.  Recompute SL/TP from the actual entry and send `PUT /v2/orders/bracket`. Skip this if they are already equal to the tick.
6.  `GET /v2/orders?product_id=3136` and confirm that a stop-loss and a take-profit exist at the expected prices. Mark the trade `OPEN`.
7.  **Failures:**
    *   **No fill seen within 10s:** re-read the position. If it is still flat, mark the row `FAILED`. Retry once with `attempt + 1` only if the signal candle is still the newest closed candle.
    *   **Filled, but the bracket cannot be confirmed:** `POST /v2/orders/bracket`. Only a stop-loss or only a take-profit missing counts as missing too.
    *   **That still fails:** close at market `reduce_only`, then HALT.
    *   **Filled size smaller than requested:** keep the position, set `size_contracts` to the filled size, alert, and do not top it up.

**Close sequence** (`executor.close(reason, candleTime)`, used by reversal, manual close and `trail_breached`):

1.  Read the position size. Set the trade to `CLOSING`, storing `close_reason` and the close `client_order_id` **before** sending, so a crash mid-close is labelled correctly.
2.  `POST /v2/orders` market, opposite side, same size, `reduce_only: true`, `client_order_id = eth-<candleTime>-close-<reason>-<attempt>`.
    *   A manual close uses the current hour's candle time.
    *   `reduce_only` means a fill from the exchange stop at the same moment cannot flip the position.
3.  Poll until flat, for up to 10s. If it is not flat by then, HALT.
4.  `DELETE /v2/orders/all {product_id: 3136, cancel_stop_orders: true, cancel_reduce_only_orders: true}`.
5.  Read the fills for the trade (`GET /v2/fills`, filtered by product and time) to record the exit price and actual fees.
6.  Bookkeeping: set the trade to `CLOSED`, write the exit fields and P&L, and update the breaker. This step is done here, not by the reconciler, so a profitable reversal resets the counter right away.

**Reversal** = close, then (if not halted) re-read the balance, then `enter(newSide)`. If the close fails, the bot does not enter.

### Reconciler

The reconciler runs at boot and every 60s, behind the same mutex as the cycle. **The exchange is the source of truth.**

| Exchange position | Exchange stop orders | DB trade | Action |
| :--- | :--- | :--- | :--- |
| flat | none | none open | nothing |
| flat | some | none open | cancel them (strays) |
| flat | any | `OPEN` | the exchange closed the trade. Read the fills, then set the exit price, fees and reason (see the exit classification below). Update the breaker and cancel strays. |
| flat | any | `CLOSING` | the bot's own close completed. Record it with the stored `close_reason`, and cancel strays. |
| flat | any | `OPENING` | the entry never filled: mark it `FAILED` |
| open, matches DB | SL and TP present | `OPEN` | nothing |
| open, matches DB | SL or TP missing | `OPEN` | attach the missing leg(s): SL at `max(DB stop, entry−20)` (longs) / `min` (shorts), and TP at entry ± 100. Alert. |
| open | any | `OPENING`, same side | the crash came after the fill. Promote that row to `OPEN`, keeping its strategy and reason, and fill in the entry price and size from the exchange. Attach a bracket if missing. |
| open | any | `CLOSING` | the close did not complete. Retry the close once with `attempt + 1`. If that fails, HALT. |
| open | any | none (or `OPENING` on the other side) | adopt it: create a `trades` row with strategy `unknown`, entry reason `adopted`, and stage derived from the SL. Attach a bracket if missing, and alert. Adopted trades use the normal exit reasons and count toward the breaker. |
| open, same side, smaller size than DB | any | `OPEN` | an auto-deleverage or partial close. Update `size_contracts` and alert. |
| open, side differs or size is larger than DB | any | `OPEN` | HALT (mismatch) and alert. Never trade around an unknown state. |

**Exit classification**, when the exchange closed a trade:

| What happened | Exit reason | Breaker effect |
| :--- | :--- | :--- |
| fill from the bracket stop-loss order, matched by order id, including gap fills far from the stop price | `sl_stage_<stage>` | as the breaker rules below |
| fill from the take-profit order | `tp` | as the breaker rules below |
| liquidation fill | `liquidation` | HALT and alert |
| any other fill priced within $1 of the stored SL (safety net, in case order-id matching fails) | `sl_stage_<stage>` | as the breaker rules below |
| any other fill (for example, a close made in the Delta app) | `external` | none: neither counts nor resets |

The safety net has a trade-off. A manual close in the Delta app within $1 of the stop is counted as a stop, which is the safe direction for the breaker.

### Circuit breaker

`core/breaker` is a pure function: `nextCount(count, exitReason, netPnl)`.

*   If `exitReason == "sl_stage_0"` (the initial $20 stop): `count + 1`.
*   Else if `exitReason == "external"`: `count` (unchanged).
*   Else if `netPnl > 0`: `0`.
*   Otherwise: `count` (unchanged). This covers losing reversals and `sl_stage_1` exits.

When `count ≥ 3`:

*   set `kv.halted = 1` and `kv.halt_reason = "breaker: 3 consecutive stop-losses"`;
*   write a `halt` row to `system_events`;
*   send an alert.

Resume (`POST /api/control/resume`, or `npm run ctl -- resume`) sets `halted = 0`. It resets `consecutive_sl` to 0 **only if** `kv.halt_kind` is `breaker`.

The breaker does **not** limit total losses from losing reversals or stage-1 exits. A drawdown halt is escalated and not decided (see [Risks & Mitigations](#risks--mitigations)).

### Persistence (SQLite, `data/bot.db`)

The file uses WAL mode with `synchronous=FULL`. `kv.schema_version` starts at 1, and migrations are additive only.

*   **`trades`:**
    *   `id`, `client_order_id`, `status` (OPENING / OPEN / CLOSING / CLOSED / FAILED), `side`, `size_contracts`, `strategy` (hull / ut / unknown), `dry_run`;
    *   `entry_reason` (JSON: strategy, signal or `missed_flip` or `adopted`, candle time, scores), `entry_time`, `entry_price`;
    *   `sl_price`, `tp_price`, `stage` (0 / 1 / 2), `sl_order_id`, `tp_order_id`. The order ids are written at entry and after every trail, reattach or replace. Earlier SL ids stay in the `sl_move` trade events.
    *   `close_reason`, `close_client_order_id`, written when the trade enters CLOSING;
    *   `exit_time`, `exit_price`, `exit_reason` (sl_stage_0 / sl_stage_1 / sl_stage_2 / tp / reversal / manual / trail_breached / margin_mode / liquidation / external);
    *   `gross_pnl`, `fees`, `net_pnl`, `config_hash`.
*   **`trade_events`:** `id`, `trade_id`, `time`, `type` (sl_move / bracket_attach / partial_fill / size_change / error), `data` JSON.
*   **`system_events`:** `id`, `time`, `type` (strategy_switch / halt / resume / boot / cycle_missed / reconcile_mismatch), `data` JSON.
    *   This holds events that are not tied to a trade.
    *   The dashboard's "last switch reason" and breaker history read from it.
*   **`decisions`:** one row per processed candle. `candle_time`, OHLCV, `hull`, `hull_prev2`, `ut_stop`, `atr`, `sig_hull`, `sig_ut`, `score_hull`, `score_ut`, `active`, `pending`, `action` (ENTER / REVERSE / CLOSE / TRAIL / NONE / ERROR), `note`. A missed cycle writes no `decisions` row. It writes a `system_events` `cycle_missed` row instead.
*   **`sim_trades`:** `strategy`, `entry_time`, `side`, `entry`, `exit_time`, `exit`, `reason`, `gross_pnl`, `fees`, `net_pnl` (all per ETH). Rebuilt each cycle from the 2,000-candle window. Used by the scores and by insight rule 3.
*   **`kv`:** `halted`, `halt_reason`, `halt_kind`, `consecutive_sl`, `last_processed_candle`, `active_strategy`, `pending_switch`, `leverage_ok`, `last_cycle_at`, `boot_times` (a JSON list for the crash-loop guard), `margin_unknown_since`, `paper_state` (DRY_RUN), `schema_version`.

### API and dashboard

Express listens on `127.0.0.1:3000`, and Caddy serves it over HTTPS on the VPS's domain or IP.

*   **No auth:** `GET /health` returns 200 `{ok:true}`. It returns 503 `{ok:false, reason}` if any of these is true:
    *   the bot is halted;
    *   an open position lacks a confirmed bracket;
    *   the last cycle is more than 65 minutes old;
    *   3 or more Delta calls in a row have failed.

    It never reveals balances. An external uptime monitor pointed at it sees halts even without Telegram.
*   **Auth:**
    *   `POST /api/login {user, password}` checks against `DASHBOARD_USER` and `DASHBOARD_PASSWORD_HASH` (bcrypt), using a constant-time compare.
    *   Express sets `trust proxy = 'loopback'`, and Caddy sets `X-Forwarded-For`, so the client IP is real and cannot be spoofed from outside.
    *   **Login delay:**
        *   After `f` failures from one IP, the next attempt must wait `min(60, 2^(f−1))` seconds. An attempt that comes too early gets an immediate 429 with `Retry-After`.
        *   There is no lockout. The counter resets 15 minutes after the last failure, or on a success.
        *   The state is held in memory.
    *   **Recovery path:** `npm run ctl -- pause|resume|close|status` on the VPS (over SSH).
        *   It is a thin HTTP client for the same `/api/control/*` routes.
        *   It authenticates with the header `X-Ctl-Token` (`CTL_TOKEN` in `.env`). The server accepts that header only on a loopback request with no `X-Forwarded-For` header, which means it did not come through Caddy.
        *   The command runs inside the bot process, so it takes the same mutex as every other action.
    *   On success it sets an httpOnly, Secure, SameSite=Strict signed session cookie (`SESSION_SECRET`) that lasts 12h.
    *   `POST /api/logout`.
*   **Behind auth:**
    *   `GET /api/status`: position, live SL/TP, stage, unrealized P&L, balance, halted flag and reason, consecutive-SL count, active and pending strategy, both scores, last switch reason, DRY_RUN, params hash, next cycle time.
        *   It is served from the last reconcile snapshot and never calls Delta, so open dashboard tabs add no API calls.
    *   `GET /api/trades?limit&offset`, and `GET /api/trades/:id` (with `trade_events`).
    *   `GET /api/decisions?limit`: the per-candle log, showing why the bot did or did not act.
    *   `GET /api/stats`: total and per-strategy count, win rate, net P&L, average win and loss, profit factor, maximum drawdown, fees paid, and the equity curve points.
    *   `GET /api/insights`: the rule-based notes (below).
    *   `POST /api/control/close`: manual close through `executor.close("manual")`. It does not halt.
    *   `POST /api/control/pause`: halt with reason "manual pause".
    *   `POST /api/control/resume`: un-halt. The counter resets only after a breaker halt.
    *   All `POST` routes need a CSRF header (`X-Requested-With`), on top of SameSite.
*   **React SPA** (`web/`, built with Vite to `web/dist`, served statically). Pages:
    *   **Overview:** position card, halt banner, scores, equity chart, and the controls (close, pause and resume, each with a confirm step).
    *   **Trades:** table, with a drawer showing the entry reason, SL moves and exit reason.
    *   **Decisions:** the per-candle log.
    *   **Insights.**

    The SPA polls `/api/status` every 15s. Shared TS types live in `src/shared/types.ts` and are imported by both the server and `web/`.

### Insight rules (`core/insights`)

Each rule needs at least 10 closed trades, and returns `{id, severity, message, metric}`:

1.  **Fee drag:** fees ≥ 30% of gross profit. Message: "fees ate X% of gross profit".
2.  **Breakeven stop-outs:** of the trades that reached stage 1, the share closed at `sl_stage_1` within 2 candles of reaching it. Flagged if ≥ 40%. Message: "X% of stage-1 trades were stopped within 2 candles; the +$2.5 stop nets about −$0.10 after fees; consider +$3.5 or a later trigger".
3.  **Live vs simulated:**
    *   For each live trade, find the `sim_trades` row of the same strategy whose entry is on the same candle.
    *   Compare per-ETH net P&L (live net ÷ ETH size).
    *   Flagged if live trails simulated by more than $5 per ETH per trade on average, which points to slippage or timing differences.
    *   This rule does not test adaptive against a fixed strategy. The backtest does that.
4.  **Reversal cost:** the average net P&L of `reversal` exits. Flagged if negative.
5.  **Losing hours:** UTC hours of day whose total per-ETH net P&L over the sample is below −$40, that is, two full stops.
6.  **Take-profit reach:** the share of trades reaching TP. Flagged if under 5%: "$100 TP is rarely reached; most profit comes from the trail".
7.  **Initial-stop rate:** the share of trades exiting `sl_stage_0`. Flagged if over 50%: "$20 stop may be inside normal 1h noise".
8.  **Breaker history:** the number of breaker halts and their dates, taken from `system_events`.

### Parameter registry

All numbers live in `src/config/params.ts`, loaded once. A SHA-256 hash of the parameters is shown in `/api/status` and stored on each trade. Each `eth_strategy.pine` input has a comment naming the same key.

| Key | Value | Unit | Pine input |
| :--- | :--- | :--- | :--- |
| `PRODUCT_ID` / `SYMBOL` | 3136 / ETHUSD | — | chart symbol |
| `HULL_LEN` | 55 | bars | `hullLen` |
| `UT_KEY` | 2 | × ATR | `utKey` |
| `UT_ATR` | 6 | bars | `utAtr` |
| `SL_DIST` | 20 | $ price | `slDist` |
| `TP_DIST` | 100 | $ price | `tpDist` |
| `S1_TRIGGER` / `S1_LOCK` | 12 / 2.5 | $ price | `s1Trig` / `s1Lock` |
| `S2_TRIGGER` / `S2_LOCK` | 25 / 15 | $ price | `s2Trig` / `s2Lock` |
| `TRAIL_GAP` | 10 | $ price | `trailGap` |
| `USD_PER_ETH` | 141 | $ | — |
| `LEVERAGE` | 20 | × | — |
| `SEL_N` / `SEL_MARGIN` | 10 / 20 | trades / $ | `selN` / `selMargin` |
| `FEE_RATE` | 0.00059 | per side | `commission_value=0.059` |
| `BREAKER_N` | 3 | trades | — |
| `WARMUP` | 200 | bars | — |
| `STRATEGY` | adaptive | adaptive / hull / ut | `mode` |
| `DRY_RUN` | false (live orders) | — | — |
| `MAX_CONTRACTS` | 100000 (in practice, no cap) | contracts | — |
| `SLIPPAGE_TICKS` | 1 | ticks per fill (simulator) | `slippage=1` |
| `PAPER_BALANCE` | 141 | $ (DRY_RUN starting balance) | — |

Secrets and environment values come from `.env` (chmod 600, git-ignored), never from `params.ts`:

*   `DELTA_API_KEY`, `DELTA_API_SECRET`, `DELTA_BASE_URL`;
*   `DASHBOARD_USER`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `CTL_TOKEN`;
*   `ISOLATED_MARGIN_CONFIRMED`;
*   `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (optional);
*   `PORT`.

### DRY_RUN

`DRY_RUN=true` replaces the executor's order calls with a paper broker:

*   It fills at the last price, using the same bracket and ratchet logic, checked on each reconcile tick against the latest price.
*   It writes trades flagged `dry_run=1`.
*   Signals, the selector, the breaker and the dashboard all run unchanged.

Read-only calls (candles, balance, product) still go to Delta.

### Pine strategy (`eth_strategy.pine`, new file)

*   **Header:** `strategy()` with:
    *   `initial_capital=10000`, `default_qty_type=strategy.fixed`, `default_qty_value=1` (1 ETH, matching the per-ETH simulator; results are read per ETH);
    *   `margin_long=5`, `margin_short=5` (20x). Pine v6 defaults to 100% margin, which would reject or shrink entries;
    *   `commission_type=strategy.commission.percent`, `commission_value=0.059`, `slippage=1`;
    *   `process_orders_on_close=false` (fills at the next bar's open, matching the simulator), `calc_on_every_tick=false`.
*   **Content:**
    *   only the Hull and UT code from the parity spec;
    *   the signal rules and the selector, with `mode` = Adaptive / Hull only / UT only;
    *   **Adaptive mode:**
        *   Each strategy keeps a `var` virtual position: side, entry, SL, stage and entry bar.
        *   On each bar, the SL is checked before the TP, against low and high. Then the ratchet runs on the close. An opposite signal exits and re-enters at the next open, using a pending flag.
        *   Each closed trade's per-ETH net P&L goes into a `var array<float>` per strategy. The array keeps the last `selN` values (`array.shift`), and the score is `array.sum`.
        *   Selector rules 1–5 run on each bar close, with the same `selN` and `selMargin`.
        *   Only the active strategy's signals place real `strategy.entry` and `strategy.exit` orders.
    *   the ratchet, applied with `strategy.exit(stop=, limit=)` updated on each bar close;
    *   plots of the HULL band, the UT stop, the entry/SL/TP lines, and a small table with both scores and the active strategy.
*   **Parity:** TradingView's broker emulator orders intrabar fills by its own rules, which can differ from the SL-first rule. Pine is therefore an approximate check. The TS simulator is the reference backtest.
*   `bot.pine` is not changed.

### Observability

*   **Logs:**
    *   pino JSON to stdout, rotated by pm2-logrotate (10 MB × 14 files);
    *   one `cycle` line per candle, matching the `decisions` row;
    *   every exchange call logged with method, path, status, latency and `client_order_id`; secrets are never logged.
*   **Telegram alerts** (optional): entry, exit, SL move, halt, breaker trip, missing bracket repaired, reconcile mismatch, `CYCLE_MISSED`, auth or skew failure, leverage or margin-mode mismatch, process start. Without Telegram, `/health` plus an uptime monitor is the alert path.
*   **Crash-loop guard:** if more than 5 boots happen within 10 minutes (counted in `kv.boot_times`), boot in HALTED mode.

### Deployment

*   **PM2:** `ecosystem.config.cjs` runs `dist/index.js` in fork mode, with `instances: 1`, `max_memory_restart: 300M`, `exp_backoff_restart_delay`, and `TZ=UTC`.
*   **Lockfile:** `data/bot.lock` (with the PID) stops a second instance from starting. If the lock exists but its PID is not alive, for example after a crash, the lock is replaced, so PM2 restarts are not blocked.
*   **Backups:** a nightly copy of `data/bot.db`, using SQLite's `.backup`, to `data/backups/`, keeping 14 copies.
*   **VPS setup:**
    *   Node 20 LTS;
    *   chrony;
    *   Caddy for HTTPS;
    *   ufw allowing 22 and 443 only;
    *   a static IP whitelisted on the Delta API key;
    *   a trade-only API key with no withdrawal permission.
*   **Deploys:** while flat when possible. Otherwise the new process adopts the position through the reconciler.

## Alternatives Considered

Decisions credited to the author are recorded in [concepts_brief.md](../../concepts_brief.md#alternatives-weighed), under "Alternatives Weighed" and "Resolved in iteration 2". "Decided in design" means the author gave no input and the choice follows from a stated constraint.

### Alternative A: TradingView webhook signals

*   **How it works:** `bot.pine` fires alerts to an Express `/webhook` endpoint.
*   **Pros:**
    *   Uses the existing chart setup.
    *   No indicator port is needed.
*   **Cons:**
    *   Needs a paid TradingView plan.
    *   Adds an external service that can drop alerts.
    *   The alerts in `bot.pine` fire on unclosed bars (`alert.freq_once_per_bar`), so they repaint.
    *   The bot still needs Delta candles to trail on closes and to score strategies.
*   **Reason for Rejection:** The bot needs Delta candles anyway, so webhooks add a paid dependency and repainting alerts while removing no code. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative B: Webhook plus internal signals

*   **How it works:** TradingView alerts and the bot's own signals both feed the bot. A rule decides when they disagree.
*   **Pros:** Each source can check the other.
*   **Cons:**
    *   It needs a rule for resolving disagreements.
    *   It carries the failure modes of both paths.
*   **Reason for Rejection:** Cross-checking does not justify a second signal path plus a rule for resolving disagreements. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative C: Market-regime filter to choose Hull or UT Bot

*   **How it works:** measure trend strength with ADX or Choppiness. Use Hull in trends and UT Bot in ranges.
*   **Pros:**
    *   Needs no trade history.
    *   Easy to backtest in Pine.
*   **Cons:**
    *   Adds a threshold parameter that needs its own tuning.
    *   Regime indicators lag.
*   **Reason for Rejection:** The author preferred to choose by measured recent results over a new threshold that would need tuning. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)). The selector carries the same tuning risk (N=10, a $20 margin), which is why the backtest compares it with fixed strategies.

### Alternative D: Take either signal (OR) or require both (AND)

*   **How it works:** trade when either strategy signals (OR), or only when both agree (AND).
*   **Pros:** Simple; no selector needed.
*   **Cons:**
    *   OR takes every signal from both strategies, so the most false signals and reversals.
    *   AND fires only when both agree, so it enters late and rarely.
*   **Reason for Rejection:** Both options either multiply false signals or drop most trades. The author's stated goal is to use whichever strategy is working ("no need to combine both conditions"). Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative E: Ship one fixed strategy first and add adaptive selection later

*   **How it works:** start with only `STRATEGY=hull` or `STRATEGY=ut`, and add the selector after it is validated.
*   **Pros:**
    *   Less code.
    *   A 10-trade score is noisy, so the selector may not beat a fixed choice.
*   **Cons:** The author would have to pick by hand, which is the problem being solved.
*   **Reason for Rejection:** Kept as a fallback rather than the default. `STRATEGY=hull|ut` is one setting away. Decided by author ([brief](../../concepts_brief.md#key-decisions--staging-for-next-steps)). **Reversed if** `npm run backtest` shows adaptive trailing the best fixed strategy: the author then sets `STRATEGY` to that strategy.

### Alternative F: Ignore opposite signals while in a trade

*   **How it works:** only the SL, TP or trailed stop closes a trade.
*   **Pros:**
    *   No two-step reversal, so no window of up to about 20 s.
    *   Half the fees on signal changes.
*   **Cons:** The bot stays in a trade its own signal says is wrong, until the stop or target fires.
*   **Reason for Rejection:** The author accepts the reversal window and the extra fees in exchange for exiting as soon as the signal turns. Decided by author ([brief](../../concepts_brief.md#key-decisions--staging-for-next-steps)).

### Alternative G: Whole-ETH sizing

*   **How it works:** size = floor(balance ÷ 141) ETH.
*   **Pros:** Simpler numbers.
*   **Cons:**
    *   Up to $140 of the balance is unused.
    *   A balance under $141 cannot trade.
*   **Reason for Rejection:** Sizing in 0.01 ETH steps (one contract) uses the whole balance at no extra complexity. Decided by author ([brief](../../concepts_brief.md#key-decisions--staging-for-next-steps)).

### Alternative H: Risk-based sizing

*   **How it works:** `qty = equity × risk% / (SL + fees)`.
*   **Pros:** Caps the loss per stop at a chosen share of the account.
*   **Cons:** At 2% risk, positions are about 7 times smaller than under the author's rule.
*   **Reason for Rejection:** The author prefers the larger position and accepts about 14–16% of the account lost per stop. The margin cap and the breaker are the safety limits. Decided by author ([brief](../../concepts_brief.md#key-decisions--staging-for-next-steps)).

### Alternative I: Testnet before live

*   **How it works:** run the full bot on `cdn-ind.testnet.deltaex.org` first.
*   **Pros:** Tests the bracket, edit, reversal and reconcile code without real money.
*   **Cons:**
    *   Testnet fills and liquidity differ from live.
    *   It delays going live.
*   **Reason for Rejection:** The author chose to go live directly. `DRY_RUN` and `MAX_CONTRACTS=1` are provided as optional first steps. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative J: Bot-managed stop instead of an exchange bracket

*   **How it works:** the bot watches the price and sends a market close when the stop is hit.
*   **Pros:** Full control over the stop logic.
*   **Cons:** If the bot or the VPS is down, the position has no stop.
*   **Reason for Rejection:** An exchange-side bracket protects the position while the bot is offline. A bot-managed stop cannot. Decided in design.

### Alternative K: WebSocket feeds

*   **How it works:** subscribe to candle, order and position channels instead of polling.
*   **Pros:** Lower latency, and fills arrive as they happen.
*   **Cons:**
    *   Needs reconnect and resubscribe logic.
    *   The URL and auth format were not confirmed in the docs.
*   **Reason for Rejection:** At one decision per hour, a 60 s reconcile detects fills fast enough. WebSockets would add reconnect logic for an unconfirmed protocol. Decided in design.

### Alternative L: Trail from the best price since entry

*   **How it works:** SL = highest high − $10 (lowest low + $10 for shorts).
*   **Pros:** Locks in more profit.
*   **Cons:** A single wick pulls the stop to within $10 of the extreme, so normal pullbacks stop the trade out.
*   **Reason for Rejection:** Trailing from the close ignores wicks, so a pullback inside one bar does not end the trade. Decided by author ([brief](../../concepts_brief.md#key-decisions--staging-for-next-steps)).

### Alternative M: Dashboard as static HTML or server-rendered pages

*   **How it works:** one HTML page with plain JS, or EJS pages rendered by Express.
*   **Pros:** No frontend build step, and fewer dependencies.
*   **Cons:**
    *   No TS types shared with the server.
    *   Each new view means hand-written DOM code.
*   **Reason for Rejection:** The author accepted a Vite build step in exchange for typed components and shared types. Decided by author (chosen during drafting).

### Alternative N: Localhost with an SSH tunnel, or a public read-only dashboard

*   **How it works:** bind to 127.0.0.1 and open it through an SSH tunnel, or expose a view-only page with no login.
*   **Pros:**
    *   The tunnel exposes nothing.
    *   The view-only page needs no login.
*   **Cons:**
    *   The tunnel is awkward to use from a phone.
    *   The public page leaks trades and balance, and cannot offer controls.
*   **Reason for Rejection:** A password login over HTTPS works from a phone and allows controls. The SSH path remains as `npm run ctl` for recovery. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative O: Claude-API trade review

*   **How it works:** send the trade log to the Claude API for a written review.
*   **Pros:** Free-form feedback covering patterns the fixed rules do not check.
*   **Cons:**
    *   Costs money per call and needs an API key.
    *   The output differs from run to run.
*   **Reason for Rejection:** Fixed rules cost nothing and give the same answer every time, so changes are comparable over time. Decided by author ([brief](../../concepts_brief.md#alternatives-weighed)).

### Alternative P: Edit `bot.pine` in place

*   **How it works:** turn `bot.pine` into a `strategy()`.
*   **Pros:** One file.
*   **Cons:**
    *   `bot.pine` is a 1,400-line SMC indicator with repainting alerts, `request.security_lower_tf` and `max_bars_back=500`.
    *   Its drawing code would run inside every backtest.
*   **Reason for Rejection:** A new file holds only the trading logic, so the backtest does not run unrelated drawing code. `bot.pine` stays as the visual indicator. Decided in design.

## Risks & Mitigations

| Risk | Impact | Mitigation | Residual |
| :--- | :--- | :--- | :--- |
| Loss per stop at balance ÷ 141 sizing | about 14–16% of the account per full stop; three stops cost about 40% | margin cap; 3-stop breaker | accepted by the author |
| Losses that the breaker does not count (losing reversals, stage-1 exits) | the account can shrink without a halt | **escalated, not decided:** an optional drawdown halt (X% below the peak balance) | open until the author decides |
| No testnet stage | the order code first runs with real money | optional `DRY_RUN`; optional `MAX_CONTRACTS=1`; full executor tests against a fake exchange | accepted by the author |
| No proven edge | the strategy may lose after fees | `npm run backtest` (adaptive vs fixed); Pine check; insight rules | the author decides after the backtest |
| Stage-1 stop nets below zero | about −$0.10 per ETH at +$2.5 after fees | `S1_LOCK` is a config value; insight rule 2 flags it | accepted by the author |
| Reversal window | flat and re-opening for up to about 20 s | `reduce_only` close; position confirmed flat; the new entry carries its bracket | small |
| Bracket edit may cancel and re-create the stop | a moment with no stop during a trail | verify on the first trade; if so, place the new stop first, then cancel the old one | none, once verified |
| Leverage drift or wrong margin mode | liquidation inside the stop | leverage read back before every entry; `ISOLATED_MARGIN_CONFIRMED` while flat; `margin_mode` checked after each fill; margin cap | a position may briefly exist on cross margin before the post-fill check closes it |
| Clock skew | signatures rejected (5 s window) | chrony; skew check at boot | none |
| Rate limits unknown | 429 responses | about 310 calls per hour; backoff; reconcile interval doubles | low |
| Exchange outage at candle close | missed signal or trail | retry for 2 minutes; `CYCLE_MISSED` alert; missed-flip check next cycle; brackets stay on the exchange | one hour of trailing lost |
| Stop slippage or a gap through the stop | loss larger than $20 | the stop is a stop-market order on `last_traded_price`; the simulator fills gaps at the open and adds 1 tick | larger losses possible |
| Last-price wick on a thin book | stop hit by a brief spike | accepted in exchange for parity with the candles; mark price is the alternative trigger | accepted |
| Auto-deleverage cuts the position | size mismatch | the reconciler updates the size and alerts, without halting | none |
| SQLite file lost | trade history lost | the exchange is the source of truth, so trading continues; nightly backup | up to one day of history |
| VPS lost | no trailing | brackets stay on the exchange; redeploy, and the reconciler adopts the position | trailing stops until redeploy |
| Dashboard exposed | account control by an attacker | bcrypt password; Secure, SameSite cookie; login delay; HTTPS; CSRF header; trade-only API key | low |
| TradingView lacks Delta India candles | Pine results use different prices | parity test uses TradingView's own OHLC; the TS backtest is the reference | Pine is approximate |

## Non-Functional Requirements

### Security & Privacy

*   **API key:** trade-only, with no withdrawal permission, IP-whitelisted to the VPS.
*   **Secrets:** only in `.env` (chmod 600, git-ignored), and never logged.
*   **Dashboard:**
    *   bcrypt password hash;
    *   signed httpOnly, Secure, SameSite=Strict cookie;
    *   login delay;
    *   CSRF header on POSTs.
*   **Network:** HTTPS only, through Caddy. Express binds to 127.0.0.1, and ufw allows only ports 22 and 443.
*   **`/health`:** reveals only OK, or not OK with a reason code.

### Performance

*   **API calls:** about 310 REST calls per hour.
*   **Compute:** the 2,000-candle indicator and simulation pass takes under 50 ms.
*   **Memory:** under 150 MB.
*   **Storage:** SQLite grows by about 9,000 decision rows per year, plus `sim_trades`, which is rebuilt each cycle.

### Rollout & Rollback

*   **Rollout:**
    1.  Run `npm run backtest` and review it.
    2.  Optionally run `DRY_RUN=true`.
    3.  Optionally start live with `MAX_CONTRACTS=1`.
    4.  Use pause and resume from the dashboard or `npm run ctl`.
    5.  `STRATEGY=hull|ut` overrides the selector without a code change.
*   **Rollback:** `pm2 stop`. The exchange brackets keep protecting any open position, and the previous build adopts it through the reconciler.
*   **Migrations:** schema migrations are additive only.

## Additional Resources

*   [`egm_context_delta_api.md`](../../egm_context_delta_api.md): Delta India API facts used in this design.
*   [`concepts_brief.md`](../../concepts_brief.md): the brainstorm brief, including the decisions and the alternatives the author rejected.
*   [`bot.pine`](../../bot.pine): source of the UT Bot (lines 919–995) and Hull (lines 997–1032) logic.
*   [Delta Exchange API docs](https://docs.delta.exchange/): the REST reference for Delta Exchange India.

## Future Improvements

*   **Volatility-scaled exits:** ATR-scaled SL and TP, if the insight rules show the $20 stop sits inside normal noise.
*   **WebSocket feeds:** order and fill streams, for faster exit detection than the 60 s reconcile.
*   **Funding costs:** model funding payments in the simulator.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Stack

*   **Runtime:** Node 20 LTS.
*   **Language:** TypeScript 5 in strict mode.
*   **Modules:** `"type": "module"`, and every relative import ends in `.js`. The server imports shared types relatively (`./shared/types.js`). Only the Vite web build uses the `@shared` alias, because `tsc` does not rewrite path aliases.
*   **Build:** `tsc` compiles `src/` to `dist/`, so the entry point is `dist/index.js`. The `web/` SPA is built with Vite. Scripts in `scripts/` run with `tsx` and are not compiled.
*   **Server runtime dependencies:** `express`, `better-sqlite3`, `pino`, `zod`, `bcryptjs`, `cookie-session`, `dotenv`.
*   **Root dev dependencies:**
    *   `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`;
    *   `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/cookie-session`, `@types/bcryptjs`;
    *   `supertest`, `@types/supertest`.
*   **Web dependencies:** `react`, `react-dom`, `react-router-dom`, `recharts`.
*   **Web dev dependencies:** `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`.
*   **HTTP and scheduling:** HTTP uses the built-in `fetch`. Scheduling uses a computed `setTimeout`, with no cron library.

**Price and size math:**

*   `roundTick(p, dir)` rounds prices to the 0.05 tick. It works in integer ticks internally.
*   Balance-to-contracts math uses integer cents.

**Endpoints to verify on the first run.** These are absent from the API context:

*   `GET /v2/orders`;
*   `GET /v2/fills`: its fill fields (`order_id`, `fill_type`/`role`, `price`, `size`, `commission`), and the unit of `start_time` (provisionally microseconds; every other time value in this design is unix seconds);
*   the maximum length of `client_order_id` (ours are up to about 40 characters);
*   the leverage `GET`;
*   the `margin_mode` field.

The client logs the raw response the first time it calls each one.

**Request formats:**

*   Leverage body: `{leverage: "20"}`, with the value as a string.
*   Signed query strings include the leading `?`.

### Target Files to Create/Modify

#### Build, config and docs

##### 1. `package.json` (Create)

*   **Type / Scope:** Build configuration.
*   **Proposed Changes:**
    *   `"type": "module"`, and `"engines": {"node": ">=20"}`.
    *   The dependencies listed under Stack, with pinned versions.
    *   **Scripts:**

        | Script | Runs |
        | :--- | :--- |
        | `build` | `tsc && npm --prefix web ci && npm --prefix web run build` |
        | `start` | `node dist/index.js` |
        | `dev` | `tsx watch src/index.ts` |
        | `test` | `vitest run` |
        | `coverage` | `vitest run --coverage` |
        | `lint` | `tsc --noEmit -p tsconfig.scripts.json` |
        | `backtest` | `tsx scripts/backtest.ts` |
        | `ctl` | `tsx scripts/ctl.ts` |
        | `hash-password` | `tsx scripts/hash-password.ts` |

##### 2. `tsconfig.json` (Create)

*   **Type / Scope:** Build configuration.
*   **Proposed Changes:**
    *   **Main settings:** `strict`, `module`/`moduleResolution` `NodeNext`, `target` ES2022.
    *   **Paths:** `rootDir` `src`, `outDir` `dist`, `include` `["src"]`. This makes the output `dist/index.js`.

##### 2a. `tsconfig.scripts.json` (Create)

*   **Type / Scope:** Build configuration, for type-checking only.
*   **Proposed Changes:**
    *   Extends `tsconfig.json`, overriding `rootDir: "."` and setting `noEmit: true`.
    *   Includes `src`, `scripts` and `tests`.
    *   Used only by `npm run lint`, so scripts and tests are type-checked without being emitted. Vitest runs TypeScript without type-checking.

##### 3. `vitest.config.ts` (Create)

*   **Type / Scope:** Test configuration.
*   **Proposed Changes:**
    *   Node environment.
    *   Includes `tests/**/*.test.ts`.
    *   Coverage threshold of 85% **line coverage** on `src/core/**`.

##### 4. `.env.example` (Create)

*   **Type / Scope:** Config template.
*   **Proposed Changes:** Every key, each with a comment:

    | Group | Keys |
    | :--- | :--- |
    | Delta API | `DELTA_API_KEY`, `DELTA_API_SECRET`, `DELTA_BASE_URL=https://api.india.delta.exchange` |
    | Dashboard and ctl | `DASHBOARD_USER`, `DASHBOARD_PASSWORD_HASH`, `SESSION_SECRET`, `CTL_TOKEN` |
    | Safety | `ISOLATED_MARGIN_CONFIRMED=false` |
    | Telegram (optional) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
    | Runtime | `PORT=3000`, `DRY_RUN=false`, `PAPER_BALANCE=141`, `MAX_CONTRACTS=100000`, `STRATEGY=adaptive`, `LEVERAGE=20` |

##### 5. `.gitignore` (Create)

*   **Type / Scope:** Repository hygiene.
*   **Proposed Changes:** Ignores:
    *   `node_modules`, `dist`, `web/dist`, `web/node_modules`;
    *   `data/`, `.env`, `*.log`, `coverage/`.

##### 6. `ecosystem.config.cjs` (Create)

*   **Type / Scope:** PM2 deployment.
*   **Proposed Changes:**
    *   One app named `eth-bot`, with `script: 'dist/index.js'` and `cwd` set to the repo root, so `.env`, `data/` and `web/dist` resolve from there.
    *   `exec_mode: 'fork'`, `instances: 1`.
    *   `max_memory_restart: '300M'`, `exp_backoff_restart_delay: 2000`.
    *   `env: {NODE_ENV: 'production', TZ: 'UTC'}`.
    *   No secrets in this file.

##### 7. `Caddyfile.example` (Create)

*   **Type / Scope:** Deployment sample.
*   **Proposed Changes:** An HTTPS site block that reverse-proxies `<domain>` to `127.0.0.1:3000`. Caddy adds `X-Forwarded-For` by default.

##### 8. `README.md` (Create)

*   **Type / Scope:** Documentation.
*   **Proposed Changes:**
    *   **What the bot does:** a description, the parameter registry table, and the accepted risks.
    *   **Setup:**
        *   local setup;
        *   VPS setup: Node 20, chrony, ufw (22 and 443), Caddy, PM2 plus pm2-logrotate, `pm2 startup`;
        *   creating the Delta API key: trade-only, with an IP whitelist;
        *   setting isolated margin in the Delta app, then `ISOLATED_MARGIN_CONFIRMED=true`;
        *   `npm run hash-password`, and generating `SESSION_SECRET` and `CTL_TOKEN` with `openssl rand -hex 32`.
    *   **Operation:**
        *   `DRY_RUN`, `MAX_CONTRACTS`, `STRATEGY`;
        *   `npm run ctl`;
        *   pause and resume.
    *   **Backtests:** running the backtest, and exporting the golden fixture from TradingView.
    *   **Rollout checklist:** the Verification Plan steps.

#### Server entry and config

##### 9. `src/index.ts` (Create)

*   **Type / Scope:** Entry point.
*   **Proposed Changes:** Boot runs these steps in order:
    1.  Load env and params. Set `kv.last_cycle_at` to the boot time after step 3, so `/health` is not stale at first boot.
    2.  `lock.acquire()`, which creates `data/` (mode 700) if it is missing.
    3.  Open the DB and migrate.
    4.  `bootGuard.record()`, which halts on a crash loop.
    5.  Write a `system_events` `boot` row.
    6.  Log a warning if Telegram is not configured.
    7.  If `DRY_RUN=false` and `ISOLATED_MARGIN_CONFIRMED` is not true, exit with an error.
    8.  `deltaClient.checkClock()`. If the skew is more than 2 s, exit with an error.
    9.  Product check: id 3136, `contract_value` 0.01, `tick_size` 0.05. On mismatch, halt.
    10. Candle-time sanity check: if `now − floorHour(now)` is more than 5 minutes, the newest candle's `time` must equal `floorHour(now) − 3600`. Otherwise it may also equal `floorHour(now) − 7200`. On failure, warn and continue.
    11. Set leverage if flat. Otherwise `kv.leverage_ok = 0`, and the executor sets it on the first flat reconcile.
    12. `reconciler.reconcile()` once.
    13. `scheduler.start()`.
    14. `server.listen()`.
    15. Send a "started" alert.

    On SIGINT or SIGTERM: wait for the mutex, close the DB and release the lock. Open positions are left with their brackets.

##### 10. `src/config/params.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   A frozen `PARAMS` object holding every registry key, including `SLIPPAGE_TICKS`. `LEVERAGE`, `STRATEGY`, `DRY_RUN` and `MAX_CONTRACTS` can be overridden from env.
    *   `paramsHash()`: SHA-256 of the sorted JSON, first 12 hex characters. It fills `trades.config_hash` and the `paramsHash` field of `/api/status`.

##### 11. `src/config/env.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** A zod schema for every `.env` key.
    *   `DELTA_BASE_URL` must be one of the India production or testnet hosts.
    *   `SESSION_SECRET` and `CTL_TOKEN` must each be at least 32 characters.
    *   Booleans (`ISOLATED_MARGIN_CONFIRMED`, `DRY_RUN`) are parsed with `z.enum(['true','false']).transform(v => v === 'true')`. `z.coerce.boolean()` is not used, because it reads the string `"false"` as true.
    *   A failure names the missing or invalid key.

##### 12. `src/log.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   A pino logger that redacts `api-key`, `signature`, `password`, `*.secret` and `x-ctl-token`.
    *   `child(cycleId)`.
    *   `alert(level, text)`: logs at error level, then calls `notify`.

##### 13. `src/shared/types.ts` (Create)

*   **Type / Scope:** Shared types, imported by both the server and `web/` through `@shared`.
*   **Proposed Changes:**

    | Type | Values or shape |
    | :--- | :--- |
    | `Side` | `'buy' \| 'sell'` |
    | `Candle` | `{time, open, high, low, close, volume}` |
    | `StrategyId` | `'hull' \| 'ut'` |
    | `TradeStrategy` | `StrategyId \| 'unknown'` (adopted trades) |
    | `Signal` | `'LONG' \| 'SHORT' \| 'NONE'` |
    | `Stage` | `0 \| 1 \| 2` |
    | `TradeStatus` | `'OPENING' \| 'OPEN' \| 'CLOSING' \| 'CLOSED' \| 'FAILED'` |
    | `ExitReason` | `'sl_stage_0' \| 'sl_stage_1' \| 'sl_stage_2' \| 'tp' \| 'reversal' \| 'manual' \| 'trail_breached' \| 'margin_mode' \| 'liquidation' \| 'external'` |
    | `Action` | `'ENTER' \| 'REVERSE' \| 'CLOSE' \| 'TRAIL' \| 'NONE' \| 'ERROR'` |
    | `HaltKind` | `'breaker' \| 'manual' \| 'mismatch' \| 'fatal_error' \| 'crash_loop' \| 'liquidation'` |
    | `SystemEventType` | `'strategy_switch' \| 'halt' \| 'resume' \| 'boot' \| 'cycle_missed' \| 'reconcile_mismatch'` |
    | Row types | `TradeRow`, `TradeEvent`, `SystemEvent`, `DecisionRow`, `SimTrade` |
    | API types | `StatusResponse`, `StatsResponse`, `Insight` |

#### Pure core

##### 14. `src/core/indicators.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   Functions: `wma(src, n)`, `hma(close, len)`, `trueRange(c)`, `atrPine(c, n)`, `utTrailingStop(close, atr, key)`.
    *   Each returns an array aligned to its input, with `NaN` during warm-up.
    *   Implements the [Indicator parity specification](#indicator-parity-specification), verified by the golden test in file 55 (fixture file 52).

##### 15. `src/core/signals.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `hullSignals(hull)` and `utSignals(close, stop)`.
    *   `computeAll(candles, params)` returns `{hull, hullUp, atr, utStop, utUp, sigHull, sigUt}`.
        *   `utUp[t] = close[t] > utStop[t]`.
        *   Signals are forced to `NONE` before `WARMUP`.
    *   `direction(strategy, out, t)` returns `'up' | 'down' | null`. It returns `null` when any input is `NaN`, and `null` never counts as disagreeing with a position.

##### 16. `src/core/ratchet.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `initialBracket(side, entry, params)` returns `{sl, tp}`.
    *   `nextStop(side, entry, currentSl, close, params)` returns `{sl, stage, changed}`.
        *   `changed` is true only when the move is at least one tick.
        *   Implements the [Trailing ratchet](#trailing-ratchet) table, rounding toward profit, with the never-loosen check repeated after rounding.
    *   `stageOf(side, entry, sl, params)` returns a `Stage`.
    *   `isBreached(side, sl, lastPrice)`.
    *   `roundTick(p, 'up' | 'down', tick = 0.05)`.

##### 17. `src/core/simulator.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `simulate(strategy, candles, signals, params)` returns `SimTrade[]`. It implements the Simulator rules of the [Strategy Selection Contract](#strategy-selection-contract):
        *   entry at the next bar's open;
        *   SL and TP checked from the entry bar onward, SL first when both are hit;
        *   gap fills at the bar's open;
        *   1 tick of slippage per fill;
        *   ratchet updated on the close;
        *   reversal at the next open;
        *   after an SL or TP exit, wait for the next flip;
        *   fees of 0.059% per side;
        *   size of 1 ETH;
        *   no signals before `WARMUP`.
    *   `SimTrade = {strategy, entryTime, side, entry, exitTime, exit, reason, grossPnl, fees, netPnl}`.
    *   `score(trades, n)` returns `{score, count}`.
    *   **`simulateAdaptive(candles, sigsHull, sigsUt, params)`** returns `{trades, switches}`. It is used by the backtest. For each bar t at or after `WARMUP`:
        1.  For each strategy, take the last `SEL_N` trades from its own `simulate()` output with `exitTime < t`, and compute its score.
        2.  Call `select()` with the adaptive position's `isFlat` and `positionSide`. Count every `switched = true`.
        3.  Call `decide()` for the active strategy's signal and direction state. Apply the result to the adaptive position, using the same entry, exit, ratchet, fee and slippage rules as `simulate()`.

        The circuit breaker is not applied.

##### 18. `src/core/selector.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `select(input)` returns `{active, pending, switched, reason}`. It implements Selector rules 1–5.
    *   `input = {scores, counts, active, pending, isFlat, positionSide, signals, override}`.
    *   It has no side effects. `cycle.ts` writes the `strategy_switch` event (rule 6).
    *   Strategy ids are lowercase (`'hull'`), and the cold-start default is `'hull'`.

##### 19. `src/core/sizing.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `contractsFor({balanceUsd, price, leverage, usdPerEth, maxContracts})` returns `{contracts, base, marginCap, effectiveLeverage, reason?}`.
    *   It uses integer-cent math.
    *   When the final size is below 1 contract, it returns `contracts: 0` with `reason: 'SIZE_TOO_SMALL'`.

##### 20. `src/core/breaker.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:** `nextCount(count, exitReason, netPnl)` and `shouldHalt(count, n)`, following the [Circuit breaker](#circuit-breaker) rules, including the rule that `external` leaves the count unchanged.

##### 21. `src/core/decide.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `decide({halted, haltKind, position, activeSignal, activeDirection})` returns `{action, reason}`. It implements the 8-row action table in [What happens on each candle close](#what-happens-on-each-candle-close).
    *   If a position is open and `activeDirection` disagrees with its side (and is not `null`), the bot is treated as having an opposite signal, with reason `missed_flip`.

##### 22. `src/core/stats.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:** `computeStats(trades)` returns `StatsResponse`:
    *   totals and per-strategy figures: count, win rate, net P&L, average win and average loss, profit factor;
    *   fees paid and maximum drawdown;
    *   equity curve points.

##### 23. `src/core/insights.ts` (Create)

*   **Type / Scope:** Pure TypeScript module.
*   **Proposed Changes:**
    *   `computeInsights(trades, tradeEvents, systemEvents, simTrades, params)` returns `Insight[]`. It implements rules 1–8 of [Insight rules](#insight-rules-coreinsights), with the stated thresholds.
    *   With fewer than 10 closed trades, it returns one info item: "need ≥10 closed trades".

#### Exchange layer

##### 24. `src/exchange/types.ts` (Create)

*   **Type / Scope:** TypeScript interfaces.
*   **Proposed Changes:** `ExchangePort`, with typed requests and responses:

    | Method | Endpoint |
    | :--- | :--- |
    | `getCandles(start, end)` | `GET /v2/history/candles` |
    | `getTicker()` → `{close, markPrice}` | `GET /v2/tickers/ETHUSD` |
    | `getPosition()` → `{size, entryPrice} \| null` | `GET /v2/positions?product_id=3136` |
    | `getMarginMode()` → `'isolated' \| 'cross' \| 'unknown'` | `margin_mode` from `GET /v2/positions/margined?product_ids=3136`; `'unknown'` when flat |
    | `getOpenOrders()` | `GET /v2/orders?product_id=3136&states=open,pending` |
    | `getBalance()` | `GET /v2/wallet/balances` (the settling asset's `available_balance`) |
    | `getLeverage()` / `setLeverage(n)` | `GET` / `POST /v2/products/3136/orders/leverage` |
    | `placeOrder(req)` | `POST /v2/orders` |
    | `editBracket(req)` | `PUT /v2/orders/bracket` |
    | `placeBracket(req)` | `POST /v2/orders/bracket` |
    | `cancelOrder(id)` | `DELETE /v2/orders {id, product_id}` |
    | `cancelAll()` | `DELETE /v2/orders/all` |
    | `getFills(since)` | `GET /v2/fills?product_ids=3136&start_time=` |
    | `getProduct()` | `GET /v2/products/ETHUSD` |
    | `getOrderByClientId?(id)` | optional; used only if supported |

##### 25. `src/exchange/deltaClient.ts` (Create)

*   **Type / Scope:** TypeScript module that makes network calls.
*   **Proposed Changes:**
    *   **Signing:** `sign(method, path, query, body, ts)`.
    *   **`request()`:**
        *   re-signs on every attempt, with a 10 s timeout;
        *   follows the retry and error table in [Exchange integration](#exchange-integration);
        *   throws `RetryableError` or `FatalError`.
    *   **Failure tracking:**
        *   keeps `consecutiveFailures`, reset on any success;
        *   calls `onRateLimited()` on a 429 and `onOk()` after a success, both injected by the scheduler.
    *   **Clock:** `checkClock()` compares the `Date` header with the local clock, allowing a 2 s skew.
    *   **Logging:** logs each call without secrets. The first response from each "verify on first run" endpoint is logged raw.
    *   **Port:** implements `ExchangePort`.

##### 26. `src/exchange/paperBroker.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** The `ExchangePort` used when `DRY_RUN=true`. State lives in `kv.paper_state`.

    | Method | Behaviour |
    | :--- | :--- |
    | `getCandles`, `getTicker`, `getProduct` | passed through to `deltaClient` (public data) |
    | `getBalance` | virtual: starts at `PAPER_BALANCE` (default 141), updated by net P&L |
    | `getPosition`, `getOpenOrders`, `getFills` | virtual |
    | `placeOrder`, `editBracket`, `placeBracket`, `cancelOrder`, `cancelAll` | virtual. Order ids are `paper-<n>`. Market orders fill at `getTicker().close` ± 1 tick against the trade. |
    | `getLeverage` / `setLeverage` | virtual; always matches `LEVERAGE` |
    | `getMarginMode` | `'isolated'` |
    | `getOrderByClientId` | virtual |

    **On each reconcile tick,** a virtual SL or TP is triggered when the ticker crosses it.
    *   **Fill price:** the trigger price ± 1 tick against the trade.
    *   **Order id:** the virtual SL or TP order's own id, so exit classification and the breaker work unchanged.
    *   **Commission:** `FEE_RATE` × notional.

##### 27. `src/exchange/executor.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** Four operations: `enter(side, candleTime, reason)`, `close(reason, candleTime)`, `reverse(newSide, candleTime, reason)` and `trail(close)`.
    *   `enter`, `close` and `reverse` follow the Entry and Close sequences in [Exchange integration](#exchange-integration), with an outbox row written before every order. For a manual close, `candleTime` is the current hour.
    *   **After a fill**, `enter` also:
        *   stores `sl_order_id` and `tp_order_id`;
        *   polls `getMarginMode()` every 1 s, for up to 15 s, as described in [Sizing and leverage](#sizing-and-leverage):
            *   if it returns `'cross'`, it calls `close('margin_mode')` and `halt('margin mode cross', 'fatal_error')`;
            *   if it is still `'unknown'`, it sets `kv.margin_unknown_since` and alerts, and keeps the position.
    *   **Close bookkeeping:** step 6 of `close()` runs after the fills are read. It:
        1.  sets the trade to `CLOSED`, and writes `exit_time`, `exit_price` (the fill VWAP) and `exit_reason`;
        2.  computes `gross_pnl = size × 0.01 × Δprice` (signed by side), `fees` (the sum of fill `commission`, plus the entry fees) and `net_pnl`;
        3.  calls `breaker.nextCount`, writes `kv.consecutive_sl`, and calls `halt(…, 'breaker')` if the breaker trips.

        The reconciler's `CLOSING` row is used only for crash recovery.
    *   **`candleTime` default:** if no `candleTime` is passed (manual, margin and breach closes), it defaults to the current hour.
    *   **Pre-checks:** `enter` runs the pre-checks in the Entry sequence, including `getLeverage()` equalling `LEVERAGE`.
    *   **Retry guard:** before any retry, re-read the position size. For an entry, non-zero means it already went through. For a close, zero means it already went through.
    *   **`trail(closePrice)`:**
        0.  `getOpenOrders()`, and take the current SL's `stop_price` and id. Never use a cached value.
        1.  Compute `nextStop` against that SL. If `changed` is false, return.
        2.  If `isBreached` against `getTicker().close`, call `close('trail_breached')`, **then return**.
        3.  Send `editBracket`, retrying up to 3 times. If every attempt fails, keep the old stop, `alert`, **then return**.
        4.  `getOpenOrders()`.
        5.  If the SL is missing or more than one tick from the new price, `placeBracket` with only the SL. Confirm it, then `cancelOrder(oldSlId)` if the old order still exists.
        6.  Store `sl_order_id`, `sl_price` and `stage`, and write an `sl_move` trade event with the old and new id and price.
    *   **Leverage:** `ensureLeverage()` runs when flat. It sets the leverage, reads it back, and sets `kv.leverage_ok`.
    *   **Halts:** an unrecoverable failure calls `halt(reason, kind)` from `engine/halt.ts`.

#### Engine

##### 28. `src/engine/mutex.ts` (Create)

*   **Type / Scope:** TypeScript utility.
*   **Proposed Changes:** A promise mutex, `runExclusive(fn)`.
    *   **Users:** the cycle, the reconciler, and the API control routes (which `ctl` also reaches).
    *   **Timing:** the cycle takes the mutex only **after** the candle-readiness wait. A manual close is therefore never blocked behind the up-to-2-minute candle retry.

##### 29. `src/engine/lock.ts` (Create)

*   **Type / Scope:** TypeScript utility.
*   **Proposed Changes:**
    *   `acquire()` writes `data/bot.lock` containing the PID.
        *   If the file exists and that PID is alive, exit with an error.
        *   A lock whose PID is not alive is replaced.
    *   `release()` deletes the file.

##### 30. `src/engine/halt.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   `halt(reason, kind)`:
        *   sets `kv.halted = 1`, `kv.halt_reason` and `kv.halt_kind`;
        *   writes a `system_events` `halt` row;
        *   calls `alert`.
    *   `resume()`:
        *   sets `kv.halted = 0`;
        *   resets `consecutive_sl` to 0 only if `kv.halt_kind` is `breaker`;
        *   writes a `resume` row.
    *   `haltState()` returns `{halted, reason, kind}`.

##### 31. `src/engine/bootGuard.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** `record()`:
    1.  Appends the current time to `kv.boot_times`.
    2.  Drops entries older than 10 minutes.
    3.  If more than 5 entries remain, calls `halt('crash loop', 'crash_loop')`.

##### 32. `src/engine/scheduler.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   `start(cycleFn, reconcileFn)`:
        *   the cycle runs at the next HH:00:10 UTC, re-armed after each run;
        *   the reconcile runs on an interval that starts at 60 s;
        *   `backupNightly()` runs at 00:30 UTC.
    *   `backoff()` doubles the reconcile interval, up to 300 s. `reset()` returns it to 60 s. `index.ts` passes `scheduler.backoff` to `deltaClient` as `onRateLimited`, and `scheduler.reset` as `onOk`.
    *   `nextRunAt` is exposed.

##### 33. `src/engine/cycle.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** `runCycle()` does the following:
    1.  Waits for the candle (retries every 15 s, for up to 2 minutes). This step runs **outside** the mutex. On timeout, it writes a `system_events` `cycle_missed` row, sets `kv.last_cycle_at` and returns.
    2.  Takes the mutex.
    3.  Skips the candle if it has already been processed.
    4.  Calls `computeAll`, then `simulate` for both strategies, then `replaceSimTrades`.
    5.  Calls `select`. If the active strategy switched, writes a `strategy_switch` event.
    6.  Calls `decide`, then the executor action.
    7.  Writes the `decisions` row, then `last_processed_candle`.

    On an exception, it writes `action: 'ERROR'` with the message in `note`, and calls `alert`.

    `kv.last_cycle_at` is set at the end of **every** path: normal, skipped duplicate, `CYCLE_MISSED` and `ERROR`.

##### 34. `src/engine/reconciler.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   `reconcile()` implements the [Reconciler](#reconciler) decision table and the exit classification table.
        *   Classification order: the fill's `order_id` is matched against `sl_order_id`, any earlier SL id in the `sl_move` events, and `tp_order_id`. Next comes a liquidation flag on the fill. Then `external`.
        *   **Safety net:** an `external` fill priced within $1 of the stored SL is classified as `sl_stage_<stage>`.
    *   It takes fees from the fills, calls `breaker.nextCount`, and calls `halt` when the breaker trips.
    *   If the bot is flat and `kv.leverage_ok = 0`, it calls `executor.ensureLeverage()`.
    *   If `kv.margin_unknown_since` is set and a position is open, it re-checks `getMarginMode()`:
        *   `'isolated'`: clear `kv.margin_unknown_since`;
        *   `'cross'`: close and halt;
        *   still `'unknown'` after 5 minutes: `halt('margin mode unknown', 'fatal_error')` without closing.
    *   It builds `snapshot = {position, slPrice, tpPrice, slOrderId, tpOrderId, bracketOk, balance, lastPrice, unrealizedPnl, at}`, which uses 2 extra calls (balance and ticker).
    *   It exports `getSnapshot()`.

#### Storage

##### 35. `src/store/db.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:**
    *   Opens `data/bot.db`, creating `data/` with mode 700 if needed.
    *   Settings: WAL mode, `synchronous=FULL`.
    *   Exports `db`.

##### 36. `src/store/migrations.ts` (Create)

*   **Type / Scope:** Schema.
*   **Proposed Changes:**
    *   **Migration 1** creates `trades`, `trade_events`, `system_events`, `decisions`, `sim_trades` and `kv`, with the columns in [Persistence](#persistence-sqlite-databotdb). This includes `trades.sl_order_id`, `trades.tp_order_id`, `trades.close_reason`, `trades.close_client_order_id` and `trades.dry_run`.
    *   **Indexes:**
        *   `trades(status)`;
        *   `trades(entry_time)`;
        *   `decisions(candle_time)`, unique;
        *   `system_events(type, time)`;
        *   `sim_trades(strategy, entry_time)`.
    *   Sets `kv.schema_version = 1`.

##### 37. `src/store/repo.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** Typed helpers. Changes that touch more than one row run in transactions.
    *   **Key-value:** `kvGet`, `kvSet`.
    *   **Trades:**
        *   `insertTrade`, `updateTrade`;
        *   `openTrade()`, which returns the OPENING, OPEN or CLOSING row;
        *   `listTrades(limit, offset)`.
    *   **Events:**
        *   `addTradeEvent`, `listTradeEvents(tradeId)`;
        *   `addSystemEvent`, `listSystemEvents(type?, limit)`.
    *   **Decisions:** `insertDecision`, `listDecisions(limit)`.
    *   **Simulated trades:**
        *   `replaceSimTrades(rows)` deletes all rows and inserts the new ones in one transaction;
        *   `listSimTrades(strategy?)`.

##### 38. `src/store/backup.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** `backupNightly()`:
    *   uses `db.backup()` to write `data/backups/bot-YYYYMMDD.db`;
    *   keeps the newest 14 files;
    *   logs any failure, but never throws.

#### Notifications and API

##### 39. `src/notify/telegram.ts` (Create)

*   **Type / Scope:** TypeScript module.
*   **Proposed Changes:** `notify(text)`:
    *   does nothing when the token or chat id is unset;
    *   sends at most 1 message per second;
    *   logs any failure and never throws.

##### 40. `src/api/server.ts` (Create)

*   **Type / Scope:** Express app.
*   **Proposed Changes:**
    *   **Settings:** `app.set('trust proxy', 'loopback')`, a 10 kB JSON body limit, and cookie-session.
    *   **Routes:** mounts `/health` and `/api/*`.
    *   **Static files:** serves `path.resolve(process.cwd(), 'web/dist')`, with a fallback to `index.html` for SPA routes.
    *   **Listen address:** `127.0.0.1:PORT`.

##### 41. `src/api/auth.ts` (Create)

*   **Type / Scope:** Express middleware.
*   **Proposed Changes:**
    *   **`login`:**
        *   a bcrypt compare;
        *   a **login delay** held in an in-memory `Map<ip, {failures, last}>`;
        *   a delay is in effect while `now < last + min(60, 2^(failures−1))` seconds; during it, returns 429 with `Retry-After = ceil(last + delay − now)`;
        *   the counter resets 15 minutes after the last failure, or on a success;
        *   there is no lockout.
    *   **`requireAuth`:** passes with a valid session, **or** with `X-Ctl-Token == CTL_TOKEN` (constant-time compare) on a request whose `req.socket.remoteAddress` is loopback and which has no `X-Forwarded-For` header.
    *   **`requireCsrfHeader`:** checks `X-Requested-With` on POST requests. Requests authenticated by token are exempt.
    *   **`logout`.**

##### 42. `src/api/routes.ts` (Create)

*   **Type / Scope:** Express routes.
*   **Proposed Changes:**
    *   **`healthStatus()`:** `kv.last_cycle_at` is set at boot, so it is never null while running. Returns 503 with a `reason` when any of these is true:
        *   `kv.halted`;
        *   a position is open and `snapshot.bracketOk === false`;
        *   `now − kv.last_cycle_at` is more than 65 minutes;
        *   `deltaClient.consecutiveFailures` is 3 or more.

        Otherwise it returns 200.
    *   **`/api/status`:** built from `getSnapshot()` plus `kv`, `haltState()`, the last `strategy_switch` event and `paramsHash()`. It never calls Delta.
    *   **Data routes:** trades, decisions, stats (`computeStats`) and insights (`computeInsights`).
    *   **Control routes:** `close`, `pause` and `resume`.
        *   Each runs under the mutex.
        *   `close` returns 409 when the bot is flat.
        *   `pause` calls `halt('manual pause', 'manual')`.
        *   `resume` calls `resume()`.

#### Scripts

##### 43. `scripts/hash-password.ts` (Create)

*   **Type / Scope:** CLI.
*   **Proposed Changes:** Reads a password from stdin and prints its bcrypt hash (cost 12).

##### 44. `scripts/ctl.ts` (Create)

*   **Type / Scope:** CLI.
*   **Proposed Changes:**
    *   **Usage:** `npm run ctl -- <pause|resume|close|status>`.
    *   **Behaviour:**
        *   loads `.env`;
        *   calls `http://127.0.0.1:$PORT/api/control/<cmd>`, or `/api/status`, with the `X-Ctl-Token` header;
        *   prints the JSON reply.
    *   **Exit codes:** 0 on 2xx; 1 otherwise, printing the error.

##### 45. `scripts/backtest.ts` (Create)

*   **Type / Scope:** CLI.
*   **Proposed Changes:**
    *   **Usage:** `npm run backtest -- --pages <k>`. The default `k` is 4, which is about 8,000 hours.
    *   **Data:** fetches `k` pages of 2,000 closed 1h candles with plain unauthenticated `fetch` on `/v2/history/candles`. It does not import `deltaClient`, so it builds in phase 1.
    *   **Simulations:** runs `simulate` for Hull and for UT, then `simulateAdaptive`.
    *   **Output:** prints a table with these columns for each mode (adaptive, hull, ut):
        *   trades and win rate;
        *   net P&L per ETH and maximum drawdown;
        *   **switch count** (adaptive only).

        It also writes `data/backtest-<date>.csv`.

#### Web dashboard

##### 46. `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html` (Create)

*   **Type / Scope:** Frontend build configuration.
*   **Proposed Changes:**
    *   The web dependencies and dev dependencies listed under Stack.
    *   A committed `web/package-lock.json`, which `npm --prefix web ci` needs.
    *   `web/tsconfig.json` has `paths: {"@shared/*": ["../src/shared/*"]}`.
    *   Vite with React and TypeScript.
    *   Dev proxy: `/api` → `localhost:3000`.
    *   `build.outDir` is `dist`.
    *   Alias: `@shared` → `../src/shared`.

##### 47. `web/src/main.tsx`, `web/src/App.tsx`, `web/src/api.ts`, `web/src/usePolling.ts` (Create)

*   **Type / Scope:** React app shell.
*   **Proposed Changes:**
    *   **Routes:** `/login`, `/`, `/trades`, `/decisions`, `/insights`.
    *   **Auth guard:** any 401 redirects to `/login`.
    *   **`api.ts`:** typed fetch wrappers. POST requests send `X-Requested-With`.
    *   **`usePolling(fn, 15000)`:** pauses while the tab is hidden.

##### 48. `web/src/pages/Login.tsx`, `Overview.tsx`, `Trades.tsx`, `Decisions.tsx`, `Insights.tsx` (Create)

*   **Type / Scope:** React pages.
*   **Proposed Changes:**
    *   **Login:** the login form. On a 429 it shows the `Retry-After` countdown.
    *   **Overview:**
        *   halt banner, showing the reason and the Resume control;
        *   position card;
        *   strategy card: active and pending strategy, both scores, and the reason for the last switch;
        *   equity chart;
        *   controls: close, pause and resume.
    *   **Trades:** a paginated table, plus a drawer with the entry reason, the SL-move timeline, fees and the exit reason.
    *   **Decisions:** one row per candle.
    *   **Insights:** cards coloured by severity, plus a stats table per strategy.

##### 49. `web/src/components/PositionCard.tsx`, `EquityChart.tsx`, `TradeDrawer.tsx`, `HaltBanner.tsx`, `ConfirmButton.tsx` (Create)

*   **Type / Scope:** React components.
*   **Proposed Changes:**
    *   `EquityChart` uses recharts.
    *   `ConfirmButton` requires a second click within 5 s.

##### 50. `web/src/styles.css` (Create)

*   **Type / Scope:** Styles.
*   **Proposed Changes:**
    *   A dark theme in plain CSS.
    *   P&L is shown in green or red.
    *   No horizontal scroll at a 360 px viewport.

#### Pine

##### 51. `eth_strategy.pine` (Create)

*   **Type / Scope:** Pine Script v6 strategy.
*   **Proposed Changes:** Implements the [Pine strategy](#pine-strategy-eth_strategypine-new-file) section:
    *   the header settings, including `margin_long` and `margin_short`;
    *   the parity code;
    *   the signals;
    *   Adaptive, Hull and UT modes. Adaptive mode uses the `var` virtual positions and `var array<float>` scores described there, including waiting for the next flip after an SL or TP exit, and using the same fee and slippage as the simulator for virtual P&L;
    *   the ratchet via `strategy.exit`;
    *   a score table.

    Each input carries a comment naming its key in `params.ts`.

##### `bot.pine` (Unchanged)

*   Intentionally unchanged.

#### Tests

##### 52. `tests/fixtures/eth_1h_golden.csv` (Create, exported by the author)

*   **Type / Scope:** Test fixture.
*   **Proposed Changes:**
    *   About 700 bars from one TradingView ETHUSD perpetual 1h chart running `eth_strategy.pine`.
    *   Columns: `time,open,high,low,close,hull,ut_stop`. Expected signals are derived from the exported `hull` and `ut_stop` values, using the signal rules.
    *   The TS code is fed this OHLC.
    *   If the file is missing, the golden test is skipped with a visible notice.

##### 53. `tests/fixtures/hand_30.csv` (Create)

*   **Type / Scope:** Test fixture.
*   **Proposed Changes:**
    *   30 bars with hand-computed WMA, ATR (including the seed) and UT stop values.
    *   It covers each UT branch, including the equality cases.

##### 54. `tests/fakes/fakeExchange.ts` (Create)

*   **Type / Scope:** Test double.
*   **Proposed Changes:**
    *   An in-memory `ExchangePort`. A script of queued responses and failures controls what it returns.
    *   It records every call.

##### 55. `tests/indicators.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   WMA and HMA;
    *   the ATR seed;
    *   the UT branch equality cases;
    *   NaN propagation;
    *   the `hand_30` fixture;
    *   the golden test: bars after 200, values within 0.01, and identical signal bars.

##### 56. `tests/signals.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   flips;
    *   flat Hull counts as "not up";
    *   warm-up suppression;
    *   `utUp`;
    *   `direction` returns `null` on NaN.

##### 57. `tests/ratchet.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:** Covers the full truth table, long and short:
    *   a single-candle jump from stage 0 to stage 2;
    *   `p` exactly equal to the triggers (12 and 25);
    *   the stop never loosens;
    *   rounding goes toward profit;
    *   `changed` is false when the new SL differs by less than one tick;
    *   `isBreached`.

##### 58. `tests/simulator.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   SL first when both SL and TP are hit;
    *   SL and TP checked on the entry bar;
    *   gap fill at the open;
    *   1-tick slippage;
    *   reversal;
    *   waiting for the next flip after an SL or TP exit;
    *   fees.

##### 59. `tests/selector.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   cold start;
    *   the switch margin at 19.99 vs 20;
    *   a flat switch that enters when the new strategy signals on the same bar;
    *   a pending strategy's opposite signal while in a position, leading to REVERSE;
    *   the `override` input;
    *   no side effects.

##### 60. `tests/sizing.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**

    | Balance | Price | Leverage | Expected result |
    | :--- | :--- | :--- | :--- |
    | $141 | $2,225 | 20x | 100 contracts (margin cap 114, so not binding) |
    | $300 | $2,225 | 20x | 212 contracts (margin cap 242, so not binding) |
    | $300 | $4,000 | 20x | margin cap floor(300·20·0.9/40) = 135, so 135 contracts |
    | $1.40 | $2,225 | 20x | `SIZE_TOO_SMALL` |

    It also tests that `MAX_CONTRACTS` caps the size.

##### 61. `tests/breaker.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   three `sl_stage_0` exits trigger a halt;
    *   a profitable exit resets the count;
    *   a losing reversal leaves the count unchanged;
    *   `sl_stage_1` leaves the count unchanged;
    *   `external` leaves the count unchanged.

##### 62. `tests/decide.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   every row of the action table, with one case per `HaltKind`: `breaker`, `manual` and `crash_loop` trail or close; `mismatch` and `fatal_error` do nothing; `liquidation` while flat does nothing;
    *   a missed flip leading to REVERSE with reason `missed_flip`;
    *   a `null` direction never triggers a reversal.

##### 63. `tests/cycle.test.ts` (Create)

*   **Type / Scope:** Integration test, using the fake exchange and an in-memory DB.
*   **Proposed Changes:**
    *   `CYCLE_MISSED` writes a `system_events` row and no `decisions` row;
    *   a duplicate candle is skipped;
    *   a strategy switch writes a `strategy_switch` event;
    *   an exception writes `action: 'ERROR'`;
    *   the mutex is not held during the candle wait.

##### 64. `tests/executor.test.ts` (Create)

*   **Type / Scope:** Integration test, using the fake exchange.
*   **Proposed Changes:**
    *   **Entry:**
        *   a normal entry stores `sl_order_id` and `tp_order_id`;
        *   stray orders are cancelled before entry;
        *   a leverage read-back mismatch refuses the entry;
        *   the margined endpoint lags, then shows isolated: no close;
        *   the `margin_mode` field is absent: no close, an alert, and `kv.margin_unknown_since` set;
        *   a fill timeout, followed by the position-size guard, sends no duplicate order;
        *   a bracket that cannot be confirmed is reattached; if the reattach fails, the bot closes and halts;
        *   a partial fill updates `size_contracts`;
        *   explicit cross margin after a fill leads to a close (`margin_mode`) and a `fatal_error` halt.
    *   **Close:**
        *   CLOSING is written **before** the close order is sent;
        *   a close that never reaches flat leads to a halt;
        *   when a reversal's close fails, no new entry is made;
        *   close bookkeeping: P&L and fees are written, and a profitable reversal resets `consecutive_sl`.
    *   **Leverage:** a mismatch is set once, then blocks entry.
    *   **`trail`:**
        *   a PUT that fails 3 times keeps the old stop and sends an alert;
        *   a breach leads to `close('trail_breached')`;
        *   a read-back mismatch places a new SL, then cancels the old one.

##### 65. `tests/reconciler.test.ts` (Create)

*   **Type / Scope:** Integration test.
*   **Proposed Changes:**
    *   every row of the decision table, including:
        *   CLOSING, with the exchange flat and with it open;
        *   OPENING promotion;
        *   adoption;
        *   a smaller size after auto-deleverage;
        *   a mismatch leading to a halt;
    *   each exit-classification row, including:
        *   an SL fill that gapped through the stop;
        *   an SL fill on a replaced stop id;
        *   a liquidation;
        *   the external-near-SL safety net;
    *   a leverage re-set on the first flat reconcile;
    *   margin unknown for more than 5 minutes leads to a `fatal_error` halt without a close;
    *   the snapshot fields.

##### 66. `tests/deltaClient.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   the signature against a vector embedded in the test. Secret `"s"`, method `GET`, timestamp `"1700000000"`, path `/v2/orders`, query `?product_id=3136`, empty body. The expected hex is computed in the test with Node's `crypto` from the documented formula and pinned as a literal;
    *   classification of retryable, fatal and unknown errors;
    *   the `consecutiveFailures` count;
    *   the 429 callback.

##### 67. `tests/api.test.ts` (Create)

*   **Type / Scope:** Integration test, using supertest.
*   **Proposed Changes:**
    *   **Auth:**
        *   401 without a session;
        *   the login delay returns 429 with `Retry-After` at each boundary, and never locks out;
        *   the CSRF header is required on POST;
        *   the ctl token is accepted on loopback, rejected when `X-Forwarded-For` is present, and rejected when wrong.
    *   **Health:** one test for each `/health` 503 condition, plus the 200 case.
    *   **Control:** `close` returns 409 when flat.

##### 68. `tests/insights.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   each rule's threshold, with values on both sides;
    *   rule 3 matches trades on the same candle and compares per-ETH figures;
    *   below 10 trades, the result is the single "need ≥10" item.

##### 69. `tests/safety.test.ts` (Create)

*   **Type / Scope:** Unit and integration tests for the safety modules.
*   **Proposed Changes:**
    *   **`lock`:**
        *   a live PID is refused;
        *   a dead PID is replaced;
        *   `data/` is created on a fresh install.
    *   **`bootGuard`:** more than 5 boots in 10 minutes halts with `crash_loop`; older entries are trimmed.
    *   **`halt` / `resume`:**
        *   `kv.halted`, `kv.halt_reason`, `kv.halt_kind` and the `system_events` row are written;
        *   `resume()` resets `consecutive_sl` only for `breaker`.
    *   **`scheduler`:**
        *   it arms at HH:00:10 UTC;
        *   `backoff()` reaches a 300 s maximum, and `reset()` restores 60 s;
        *   the nightly backup is scheduled at 00:30.
    *   **`backup`:** keeps 14 files, and does not throw when the directory is unwritable.
    *   **`stats`:** profit factor, maximum drawdown and win rate on a fixed trade list.
    *   **`env`:** the string `"false"` parses as false for both booleans.

##### 70. `tests/paperBroker.test.ts` (Create)

*   **Type / Scope:** Unit test.
*   **Proposed Changes:**
    *   market fills use the ticker ± 1 tick;
    *   a virtual SL triggered on a reconcile tick produces a fill with the SL order id, which the reconciler classifies as `sl_stage_N`;
    *   commission equals `FEE_RATE` × notional;
    *   the balance updates by net P&L.

##### 71. `tests/boot.test.ts` (Create)

*   **Type / Scope:** Integration test of `src/index.ts`'s boot steps, using the fake exchange and an in-memory DB.
*   **Proposed Changes:**
    *   boot exits if `DRY_RUN=false` and `ISOLATED_MARGIN_CONFIRMED` is not true;
    *   boot exits on a clock skew of more than 2 s;
    *   a product mismatch halts;
    *   a `boot` system event is written;
    *   `kv.last_cycle_at` is set.

### Build order

1.  **Core first.** Build these, which compile and test with no exchange or engine code:
    *   files 1–5, 2a, 10 and 12;
    *   the core (13–23);
    *   `scripts/backtest.ts` (45);
    *   their tests: 52–62, 68, and the `stats` and `env` cases of 69.
    *   Run `npm run backtest` and review it with the author. The rules are in [Strategy Selection Contract](#strategy-selection-contract).
2.  **Trading path.** Files 6–9, 11 and 24–44, with tests 63–67, the rest of 69, 70 and 71.
3.  **Dashboard and Pine.** `web/` (46–50) and `eth_strategy.pine` (51).

### Verification Plan

*   **Build:** `npm run build` finishes with zero errors and produces `dist/index.js` and `web/dist/index.html`.
*   **Tests:** `npm test` passes.
*   **Static checks:** `npm run lint` (`tsc --noEmit -p tsconfig.scripts.json`) passes.
*   **Coverage:** `npm run coverage` reports 85% or more **line coverage** on `src/core/**`.
*   **E2E / Integration:**
    1.  Run `npm run backtest` and review the adaptive vs fixed results and the switch count. If adaptive trails the best fixed strategy on net P&L after fees, set `STRATEGY` to that strategy.
    2.  Paste `eth_strategy.pine` onto any TradingView ETHUSD perpetual 1h chart. Confirm it compiles. Export the golden CSV (file 52) and pass the golden test.
    3.  On the VPS, run with `DRY_RUN=true` for at least one candle cycle. Confirm:
        *   a `decisions` row is written;
        *   `/health` returns 200;
        *   the dashboard login works;
        *   `npm run ctl -- status` works.
    4.  Run the first live trade, optionally with `MAX_CONTRACTS=1`. Confirm:
        *   the bracket appears on Delta at entry ∓ 20 / ± 100;
        *   the margin mode reads as isolated;
        *   a trail PUT moves the exchange stop, and the read-back matches;
        *   a manual close flattens the position and cancels the stops;
        *   the raw responses from the "verify on first run" endpoints are logged.

        This answers the Open Questions "Bracket edit behaviour" and "Bracket after flat or flip".
    5.  Restart test: run `pm2 restart eth-bot` with a position open. The reconciler adopts or promotes the trade, and no duplicate orders are sent.

--------------------------------------------------------------------------------

*Drafted with EGM*
