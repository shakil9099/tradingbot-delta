# Hull with Reversal Re-entry (Mix B)

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-19
* **Status:** Draft (revised after a zoom-out review)
* **Size:** Medium. One new entry rule in the live decision path, behind a `.env` switch, inside this one app. No new service and no migration.

## Problem

Today, after a stop-out, live Hull stays flat until the next Hull flip, which can be many hours later. The reversal script (`pine/reversal.pine`) often fires good signals in the same direction during that wait.

The backtest (`docs/hull-reversal-mix.md`, `scripts/hullRevMix.ts`) tested "Mix B": Hull as live, plus a re-entry on a reversal signal that agrees with Hull's direction.

| Per 1 ETH | Older (Feb 2024 to Nov 2025) | Last 12 months | Full period | Worst drop, older / last 12 months |
|---|---|---|---|---|
| Hull (live) | +1,878 | +457 | +2,335 | 224 / 297 |
| Mix B | +1,654 | **+731** | **+2,385** | 342 / 287 |

B did **not** pass the strict test: in the older period it made less and dropped deeper. The author chose to run it anyway.

## Approach

### 1. The rule, computed once (`src/core/signals.ts`)

* **New field:** `computeAll` gains `sigHullEntry: Signal[]`. For each bar it holds:
  * the Hull flip (`sigHull[t]`), when there is one, so Hull wins a same-bar tie;
  * otherwise, `sigRev[t]`, but only if its side equals Hull's direction at `t` (`hullUp[t]`, with the same validity check as `direction('hull')`);
  * otherwise `NONE`.
* **Off by default:** when `p.REV_REENTRY` is false, `sigHullEntry` is just `sigHull`.
* **One source for everyone:** `signalsFor('hull')` returns `sigHullEntry`, and both the live cycle and the simulator (`simulateAdaptive`) already get Hull's signals through `signalsFor`. In `src/engine/cycle.ts`, `simHull` changes from `ind.sigHull` to `signalsFor('hull', ind)`. `select()` keeps the plain `ind.sigHull`: its signals only time adaptive switches, and the server runs `STRATEGY=hull`.
* **The backtest uses the same field:** `scripts/hullRevMix.ts` B reads `sigHullEntry` with `REV_REENTRY: true`, and its own copy of the rule is deleted. The bot and the backtest therefore can't drift apart.

### 2. Setting

* **Wiring:** `REV_REENTRY` uses the `bool('false')` helper in `src/config/env.ts`. It is added to `Params`, `DEFAULT_PARAMS` (false), `ParamOverrides`, `paramsFromEnv` and `.env.example`.
* **Default:** with `false`, the bot behaves exactly as today.
* **Unchanged:**
  * `decide()`;
  * the entry gate: no weekend entries, ATR at least 15, a stop of at most $40, the liquidation guard;
  * halts;
  * sizing;
  * Hull's exits: break-even at 1R, then a 3×ATR trail from 1.5R, no take-profit.
* **What a reversal signal does:**

  | Bot state | Result |
  |---|---|
  | Flat | Enters |
  | Already in a trade on the same side | Nothing (trail as usual) |
  | Halted | Does not enter |

* **An opposite reversal signal is never emitted,** so only Hull flips reverse a trade.

### 3. Logging

When `sigHull[t]` is `NONE` and `sigHullEntry[t]` is not, the entry came from a reversal signal:

* the decisions note gets `| rev re-entry <sig> dir <revDir>`;
* the entry reason's `signal` is `'rev_reentry'` instead of `'signal'`, so `trades.entry_reason` shows which rule opened the trade.

### 4. Live settings and risk

* **Server `.env`:**
  * `REV_REENTRY=true`;
  * `FIXED_CONTRACTS=100` (1 ETH, the author's choice);
  * **`BE_TRIG_USD=0`**: break-even at 1R only, as the author chose. The code default stays at 15, so this line is required;
  * `STRATEGY=hull` (unchanged).
* **Risk at fixed 1 ETH,** in the backtest from $107. The margin cap is about 98 contracts at $107. A single stop costs $10 to $40 plus about $2.40 in fees, so up to about 39% of $107.

  | Period | Hull | B |
  |---|---|---|
  | Full period | $2,296 (worst fall 47%) | $2,371 (47%) |
  | **Last 12 months** | **$7 (96% fall)** | **$694, after an 84% fall** |

* **Deploy:** only while flat. The build also ships the other local changes: `FIXED_CONTRACTS`, the `BE_TRIG_USD` setting and the unused reversal module.
* **Rollback:** set `REV_REENTRY=false` and run `pm2 restart`.

## Key decisions

* **A switch inside `computeAll` and `signalsFor`, not a new strategy id.** It touches no selector, `StrategyId` or dashboard code. Rollback is one line.
* **Only agreeing reversal signals count.** This is Mix B. Mix C, which also exited early on opposite reversal signals, did much worse.

## Alternatives rejected

* **Shadow (logging-only) first:** safer, but the author chose to go live now.
* **Mix A** (Hull only when reversal agrees): it had smaller drops but made less money, and it also failed the test.

## Test plan

* **`computeAll` tests:**
  * an agreeing reversal signal passes;
  * an opposing one gives `NONE`;
  * a same-bar Hull flip that disagrees with the reversal signal: Hull wins;
  * `REV_REENTRY=false` gives `sigHullEntry` equal to `sigHull`.
* **Cycle tests:**
  * flat, with an agreeing reversal signal, gives ENTER, `signal: 'rev_reentry'` and the note;
  * long, with a reversal LONG, gives TRAIL.
* **Params tests:** `REV_REENTRY` parses from `.env` and defaults to false.
* **Parity:** `scripts/hullRevMix.ts` B still gives +2,385 per ETH with the shared field.
* **Checks:** `npm test`, lint, build and `npm run smoke` all clean.
