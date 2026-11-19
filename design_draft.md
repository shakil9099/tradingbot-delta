# Reversal entry → AlgoAlpha exit (live), Hull to paper

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-20
* **Status:** Draft (revised after a zoom-out review)

## Problem

The live Hull bot lost 6 of its last 7 trades (−$104), and the author no longer trusts it. In the backtest, one combination beat Hull over the full period: enter on a reversal signal, exit on the opposite AlgoAlpha break.

| Per 1 ETH, Feb 2024 to 19 Nov 2026 | Full | Last 12 months | Worst drop (older / 12 months) | Longest losing streak |
|---|---|---|---|---|
| Hull, live (Mix B) | +2,457 | +747 | 325 / 270 | 6 |
| Reversal → AlgoAlpha | **+4,405** | +712 | **203** / 357 | **4** |

Source: `scripts/tmp/aaRev.ts`. It uses the live bot's fills, fees, entry filters and stop rules.

**What the author asked for:**
- Run the new strategy **live** at **1 ETH fixed**.
- Move Hull to **paper**, also at 1 ETH, for comparison.
- Add a daily loss stop.

## Approach

### 1. AlgoAlpha in core

The port in `scripts/algoAlpha.ts` (lines 75–152) moves into `src/core/algoAlpha.ts` as `aaBreaks(candles1h, ltf3m: Candle[][]) → (1 | −1 | 0)[]`.

- The script then imports it, so there is one copy of the logic.
- That port matched TradingView on 9 of 9 breaks.
- Golden fixture: the break times listed in `docs/algoalpha-backtest.md` (for example 2026-11-06 11:30 IST bearish, …, 2026-11-13 08:30 IST bearish), checked against a small saved candle slice.

### 2. Data

AlgoAlpha needs 3-minute candles, and its levels persist for a long time. A rolling-window check (`scripts/tmp/aaWindow.ts`) compared each window size against full history over the last 120 days:

| Window | Breaks matching full history |
|---|---|
| 2,000 1h bars | 2,877 of 2,880 |
| 3,000 1h bars | 2,880 of 2,880 |

AlgoAlpha therefore uses **4,000 1h bars**.

- **Only under `STRATEGY=revaa`:** the cycle fetches 4,000 1h bars (two requests). Every other strategy keeps its 2,000-bar window, so Hull on paper is bit-identical to today.
- **`getCandles(start, end, resolution = '1h')`:** the optional third argument is added to the port interface, the Delta client, the paper broker and the test fake.
- **New table `candles_3m`.** This is an additive migration; nothing existing changes.
  - It is filled incrementally at each cycle and pruned to the last 4,200 hours (about 84k rows).
  - On boot, it backfills about 4,000 hours, about 40 requests of 2,000 bars, in sequence, retrying with backoff on rate limits.
  - **No entries until the backfill is complete.**
- **One fail-closed rule** applies at every cycle. AlgoAlpha is "unavailable" when:
  - the 3-minute fetch fails;
  - the newest stored 3-minute bar does not reach the end of the last closed 1h bar; or
  - there is a gap in the last 4,000 hours.

  **When unavailable:**
  - There are no entries, and the note gives the reason.
  - An open trade keeps its Delta stop and its trailing.
  - An alert is sent: "AlgoAlpha unavailable: aa_break exit not checked".

  **Accepted:** while AlgoAlpha is unavailable, the stop and trail are the only exits for an open trade.

### 3. Strategy `STRATEGY=revaa` and the cycle fork

`StrategyId` gains `'revaa'`. In `runCycle`, when `STRATEGY=revaa`:

- **Skipped:** the selector, its Hull and UT sims, and `replaceSimTrades`.
- **Set:** `active_strategy` = `revaa`; the scores are logged as 0.
- **Unchanged:** the existing hull, ut and adaptive path.
- **Dashboard:** it already shows the strategy as text. `revaa` is added to the web strategy labels.
- **Decisions:** no new columns. The note gets `| aa UP/DOWN | rev LONG/SHORT`.

**New pure function `decideRevAA`, in `src/core/decide.ts` next to `decide`.** These are the backtest rules:

| State | Event | Action |
|---|---|---|
| Flat | Reversal signal, entry allowed | ENTER |
| Flat | Reversal signal, entry blocked (gate, daily stop, AlgoAlpha unavailable, halt) | NONE, with the reason |
| In a trade | Opposite AlgoAlpha break **and** opposite reversal signal, entry allowed | REVERSE |
| In a trade | Opposite AlgoAlpha break (reversal signal absent, or entry blocked) | CLOSE, exit reason `aa_break` |
| In a trade | Opposite reversal signal alone | TRAIL (ignored) |
| In a trade | Nothing | TRAIL |
| Halted (manual or breaker) | In a trade | Same as above, but never ENTER or REVERSE (close only) |
| Halted (mismatch or fatal) | — | NONE, as today |

**Exits:** the live Hull set. A 2×ATR stop (between $10 and $40), break-even at 1R on the close, a 3×ATR trail from 1R, no take-profit, `BE_TRIG_USD=0`. The entry gate is the live one: no weekend entries, ATR ≥ 15, stop ≤ $40.

### 4. Daily loss stop

New setting: `DAY_LOSS_STOP=0.10` (0 = off). Nothing is stored.

- `todayNet` = the sum of `net_pnl` of trades **closed** today (IST), from the trades table, with fees included.
- Entries are blocked when `todayNet ≤ −DAY_LOSS_STOP × (balance − todayNet)`. That is the day-start balance, rebuilt from the current balance, so the rule survives restarts.
- **It only blocks ENTER and the open leg of REVERSE.** It never blocks a close, an `aa_break` exit, a stop or the trail.
- **Why not the breaker?** The breaker counts *consecutive* initial-stop exits across days (it is off on the server, `BREAKER_N=0`). The daily stop is a separate limit per calendar day.
- **At 1 ETH and about $90:** one full stop (about −$37) ends the day.

### 5. Size

`FIXED_CONTRACTS=100` (1 ETH) is the author's choice. Warning recorded: about −$36 per loss, about 40% of today's $90.

### 6. Hull paper

A second PM2 app, `eth-hull-paper`, runs the same build with:
- `DATA_DIR=data-hull`, `PORT=3002`, `DRY_RUN=true`
- `STRATEGY=hull`, `REV_REENTRY=true`, `BE_TRIG_USD=0`, `FIXED_CONTRACTS=100`
- `PAPER_BALANCE=200`, so 1 ETH is not shrunk by the margin cap. The comparison is per ETH, not per dollar of balance.
- `max_memory_restart=200M`

**Other points:**
- No keys. Paper mode uses only public endpoints; this is checked by starting it locally with no keys.
- Its cycle starts 20 s after the hour, so it doesn't hit Delta at the same moment as the live bot.
- No Caddy route; read it with `npm run ctl` or the logs.

## Key decisions

1. 3-minute data is stored and pruned, not refetched every hour (that would hit rate limits).
2. The 4,000-bar window comes from measurement, and applies only to `revaa`.
3. **One fail-closed rule:** AlgoAlpha unavailable → no entries plus an alert; the stop and trail still protect an open trade.
4. Opposite reversal signals are ignored while in a trade. This is what made the combination work (Reversal → Reversal earns +2,106 vs +4,405).
5. The daily stop is derived, never stored, and only ever blocks entries.

## Alternatives rejected

- **AlgoAlpha on 1h only, without 3-minute data:** it no longer matches TradingView.
- **TradingView webhooks:** a new external dependency.
- **Both strategies in one process:** Delta keeps one net position per contract.
- **Cost-to-cost at +0.5R and a +5% daily stop:** tested; the last 12 months went $90 → $100 with a 53% fall (`scripts/tmp/aaSafe.ts`).

## Risks

- **The live 3-minute path is new.** Covered by the fail-closed rule, the alert, and the first breaks being checked against TradingView.
- **AlgoAlpha breaks are rare** (about 1 every 2–3 days); trades average about 21 hours.
- **The last 12 months are only even with Hull** (+712 vs +747) with a deeper drop.

## Test plan

1. `aaBreaks`:
   - unit cases: a level is born on a big wick; it breaks after two closes; one close is not enough; the POC bins are right;
   - the golden TradingView break times.
2. `decideRevAA`: every row of the table in §3, including reverse when gate-blocked → close, and halted → close only.
3. Daily stop: blocks entry at −10%; never blocks a close; resets the next IST day; correct after a restart mid-day.
4. 3-minute store: incremental fetch; de-duplication; pruning; gap or stale data or failed fetch → unavailable, no entry, alert, trade still trailed; backfill before any entry.
5. Hull path unchanged: the existing cycle tests pass as they are; the window stays 2,000 bars.
6. **One-time acceptance (not CI):** a core-based backtest reproduces 174 trades and +4,405 per ETH.
7. Full suite, lint, and `npm run smoke` with the server settings.

## Deploy

1. Deploy while flat (the bot is flat now). Back up `dist`, `.env` and `bot.db`.
2. **First run in paper on the server:** `STRATEGY=revaa` with `DRY_RUN=true` until the backfill completes and one cycle logs `aa …`. Then set `DRY_RUN=false`, `DAY_LOSS_STOP=0.10`, keep `FIXED_CONTRACTS=100`, and press Go live.
3. Start `eth-hull-paper`.
4. **Rollback:** `STRATEGY=hull`, then restart. The `candles_3m` table, `DAY_LOSS_STOP` and `revaa` are ignored by the Hull path.
