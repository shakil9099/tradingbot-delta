# Reversal Strategy for the ETH Bot

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-19
* **Status:** Approved 2026-11-19 (revised after a zoom-out review). Backtest: docs/reversal-backtest.md
* **Size:** Medium. It adds one signal module and an exit preset inside this one app. No new service and no database migration.

## Problem

The live bot trades Hull with no take-profit. The stop moves to break-even at +1R and trails 3×ATR behind price from +1.5R. On 2026-11-18/19 a trade was up about 55 points and did not close, because the trail sits too far behind price to lock that in. The author wants to trade the signals from `pine/reversal.pine` ("Reversal Detection v3.0 Clone") instead, and to bank gains like this with a fixed take-profit.

## Approach

### 1. Port the signal to `src/core/reversal.ts`

This is a line-for-line port of the Pine script's logic. It uses the script's own settings:

* Medium preset: 2.0×ATR(14), using Wilder's ATR (`atrPine`), as Pine does.
* Minimum move: 0.1% of the close.
* 1h candles.
* The 9/14/21 EMAs only colour the candles in Pine, so they are left out.

`threshold = max(ATR14 × 2.0, close × 0.001)`. When ATR is NaN (during warm-up), the threshold is NaN, which gives no signal. The code checks for NaN explicitly.

Each bar is processed in this order, as in Pine:

1. Update the leg extremes: `leg_high = max(leg_high, high)` and `leg_low = min(leg_low, low)`.
2. Branch on `trend_dir`:
   * **0:** move to +1 or −1 and set `last_pivot_price`. **No signal fires.**
   * **+1:** if `close < leg_high − threshold`, fire a **SELL**, set `trend_dir = −1`, and reset `leg_low = low`.
   * **−1:** if `close > leg_low + threshold`, fire a **BUY**, set `trend_dir = +1`, and reset `leg_high = high`.

The `*_idx` variables, the drawings, and the repeated `high > leg_high` updates inside the branches are dead code for signals. They are not ported. Signals are evaluated on closed bars only, so they do not repaint.

The state runs from the start of the bot's candle window on each cycle. Pine starts at bar 0 of the chart, so the start differs. The tests check that this does not move the signals; see the test plan.

### 2. Wire reversal in as a strategy

* `'reversal'` is added to `StrategyId` and to the `STRATEGY` setting in `.env`.
* `computeAll` returns `sigRev` and the reversal `trendDir`, with the same `WARMUP` mask as the other signals.
* `signalsFor()` and `direction()` become exhaustive `switch` statements. Today any id that isn't `hull` falls through to UT, so reversal would silently trade UT.
* With `STRATEGY=reversal`, the selector's existing override rule makes reversal active. Adaptive still chooses only between Hull and UT.
* Fix in `select()`: if the stored active strategy is neither `hull` nor `ut`, treat it as a cold start. Without this, switching from reversal back to `adaptive` would leave reversal active forever.

### 3. Exits: a preset, not new code

The exit settings and code already support what reversal needs:

* `initialStops` places a TP when `TP_R > 0`, and the executor already puts it on Delta.
* `nextStop` turns break-even and the trailing stop off when `BE_TRIG_R` and `TRAIL_ATR_MULT` are 0.

So the change is small. When `STRATEGY=reversal`, `buildParams` applies a reversal exit preset:

* `BE_TRIG_R = 0`
* `TRAIL_ATR_MULT = 0`
* `TP_R` = `.env` `TP_R`, with a default of **2** until the backtest is reviewed.

The stop is unchanged: R = `max(SL_MIN, 2×ATR)`, with the same 10/40 limits.

The executor, simulator and reconciler do not change. Setting `STRATEGY=hull` restores Hull's exits automatically. `TP_R` becomes overridable from `.env` (Zod: 0 to 10).

An opposite signal closes the trade and opens the reverse trade (REVERSE), as it does for Hull today.

### 4. Entry filters stay as they are live

* No weekend entries (IST).
* `MIN_ATR` 15.
* No entry when the stop would be wider than `SL_MAX` $40. A blocked reverse only closes the trade.
* After a TP or SL exit, the bot waits for the next signal.

### 5. Backtest before going live

`scripts/reversal.ts` reuses the account and stats helpers from `scripts/hullTp.ts`. It runs on `data/eth_1h_cache.json` and writes `docs/reversal-backtest.md`.

* **Rows:** reversal with TP of none, 1R, 1.5R, 2R, 3R and 4R, plus live Hull for comparison. All use the same filters, fees and account sizing.
* **Columns:** win %, per-ETH net (older / last year / full), largest drop from peak, and account result.
* **Same-bar rule:** when one bar touches both the SL and the TP, the simulator counts the SL. This is the cautious choice.
* The author picks `TP_R` from this table. **Going live is a separate step, after that review.**

### 6. Logging

* `decisions.active` records `reversal`.
* The reversal signal and threshold go into the decision `note`, so the `decisions` table does not change.
* The cycle still simulates Hull and UT for their scores. That is harmless, and reversal needs no simulation in the live cycle.

## Key decisions

* **Deploy and switch only while flat.** All of `STRATEGY`, `TP_R` and the exit preset are global.
  * An open Hull trade would pick up reversal's exits.
  * Reversal's direction check would reverse a Hull position that faces the other way, as a `missed_flip`.
  * The reconciler expects a TP leg only when the trade was opened with one.
* **The first leg can set a direction with no signal.** `decide()` will then reverse any opposite position as a `missed_flip`. This includes a manual dashboard entry made against reversal's current trend. That is intended stop-and-reverse behaviour.
* **The TP size comes from the backtest, not a guess.**

## Alternatives rejected

* **A per-strategy `exitParamsFor()` that reads `trades.strategy`.** It would let a Hull trade keep Hull exits across a switch. That needs changes in the executor, simulator and reconciler, and the "deploy flat" rule already covers the case.
* **Opposite signal and stop only, with no TP.** It gives back about 2×ATR from every peak, the same problem as today.
* **Reversal signals with Hull's break-even and trail.** It keeps today's problem of a winning trade not being banked.
* **Removing Hull completely.** Switching back would need a code revert and a deploy.
* **The EMA trend filter.** Not in the Pine signal logic. The bot's trades would not match the chart labels.
* **A strategy switch on the dashboard.** Not asked for. `.env` plus a pm2 restart already works.

## Test plan

* **`tests/reversal.test.ts`:**
  * The first leg (0 → ±1) fires no signal.
  * A SELL fires only on the bar that closes more than the threshold below `leg_high`, and a BUY mirrors it.
  * The threshold uses whichever is larger: the ATR term or the 0.1% term.
  * NaN ATR gives no signal.
  * **Window-start stability:** on the cached ETH 1h data, the signals in the last 500 bars are identical when the window start is shifted by 1, 24 and 200 bars.
* **Parity with TradingView:**
  * Export the BUY/SELL bars from `pine/reversal.pine` over a full 2,000-bar ETHUSD 1h chart.
  * Every signal must land on the same bar (an IST hour), with no extras on either side.
* **`tests/signals.test.ts`:** `signalsFor('reversal')` returns `sigRev`, and `direction('reversal')` returns the trend direction, not UT's.
* **`tests/selector.test.ts`:**
  * `override: 'reversal'` makes reversal active.
  * With `active = 'reversal'` and no override, the result is a cold start on Hull.
* **`tests/params.test.ts`:** `STRATEGY=reversal` gives BE 0, trail 0 and TP 2 (or the `.env` `TP_R`). `STRATEGY=hull` keeps the Hull defaults.
* **`tests/cycle.test.ts`:**
  * With `STRATEGY=reversal`, `active` is `reversal`.
  * An entry places an SL and TP bracket.
  * An opposite signal gives REVERSE.
  * A blocked signal gives CLOSE only.
* **Before deploy:** all tests pass and `tsc` is clean locally. Then deploy per the EC2 runbook (sync, tsc, pm2 restart, no tests on the server) while flat.
