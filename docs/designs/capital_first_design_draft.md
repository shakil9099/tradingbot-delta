# Capital-First Strategy for the ETH Bot

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-19
* **Status:** Draft (revised after a zoom-out review)
* **Size:** Medium. A research script, then a config preset in this app. No new service and no migration.

## Problem

The author wants a new ETH strategy where protecting capital comes first. Their requirements:

* Market: the ETHUSD perpetual on Delta.
* Risk 5% of the balance per trade (about $5 per stop on $107), instead of the fixed 1 ETH, which loses about $34 per stop.
* No stop movement until the trade is +1R in profit. From then on, trail tightly.
* The live Hull bot keeps trading during the research. It is replaced only by something that does better on unseen data.

The request is mainly an **exit and sizing rule**, so the research tests that rule. It does not search for new entries again: 15 entry families have already lost to Hull. Earlier tests also found that tight exits (take-profits from 1R to 5R) cut Hull's big trend winners. So the backtest has to decide whether a tight trail helps.

## Approach

### Phase 1: research only (`scripts/capitalFirst.ts`, report in `docs/capital-first.md`)

**Setup.** About 24,000 1h bars (Feb 2024 to Nov 2026) run on the live core simulator (`src/core/simulator.ts`), so the fills, fees (0.059%) and one tick of slippage match live. The script reuses `loadRes` from `scripts/fresh.ts`.

**Entries.** Hull (the live signal) and reversal (`src/core/reversal.ts`), both already in the repo. Other entry families are tried only if both fail.

**Exits.** All of them use the existing `nextStop` in `src/core/exits.ts`, so there is no new trail code. Every variant shares these rules:

* Initial stop: R = max($10, 2×ATR), skipping the trade when R > $40 (as live).
* Below +1R on an hourly close, the stop does not move.
* The opposite signal also exits.

| Variant | Settings |
|---|---|
| **Control (live today)** | `BE_TRIG_R=1`, trail from 1.5R at 3×ATR, `BE_TRIG_USD=15` |
| **Author's rule** | `BE_TRIG_R=1`, `TRAIL_TRIG_R=1`, `BE_TRIG_USD=0`, `TRAIL_ATR_MULT` k = 1.0, 1.5 or 2.0 |

In the author's rule, the stop at +1R becomes the tighter of break-even plus fees and the highest high since entry minus k×ATR (mirrored for shorts).

**Sizing.** Every variant, the control included, uses 5% risk from a $107 start, so the comparison isolates the exit rule.

* Contracts = floor(0.05 × balance / R ÷ 0.01 ETH per contract), capped by margin and MAX_CONTRACTS. Example: R = $10 gives floor(5.35 / 10 / 0.01) = 53 contracts. Rounding down keeps the real risk at or below 5%.
* Trades sized at 0 contracts are skipped and counted in the report.
* The existing 3-stop breaker stays on. No new drawdown halt.

**Overfitting guard.** The data is split by time into three parts (the `fresh.ts` method):

* CHOOSE: the first 50%;
* CHECK: the next 20%;
* HOLDOUT: the last 30%, reported once for the shortlist.

The report gives these figures per segment:

* net $ per ETH;
* R-multiples;
* win rate;
* maximum drawdown at 5% risk;
* trade count.

**Acceptance.** A variant passes only if, on HOLDOUT, it beats the control on both net profit and maximum drawdown, with at least 30 trades. If nothing passes, the report says so plainly and recommends keeping Hull's exits with 5% sizing.

### Phase 2: build, only after the author picks from the report

* A `.env` preset: the chosen `TRAIL_TRIG_R`, `TRAIL_ATR_MULT`, `BE_TRIG_USD`, `RISK_PER_TRADE=0.05` and `FIXED_CONTRACTS=0`. These are config changes only, since `RISK_PER_TRADE` already accepts 0.05.
* `STRATEGY=reversal` only if reversal wins.
* Deploy only while flat, with the author's go-ahead.

## Key decisions

* **Test the exit rule, not new entries.** The rule is what the author asked for. New entries have already been searched.
* **Tight trail from +1R, as asked.** It is checked against the live wide trail rather than assumed better.
* **Equal 5% sizing on both sides** of the comparison.
* **Close-based trailing.** It matches the live engine and can be backtested on 1h bars.

## Alternatives rejected

* **New entry families:** they lost to Hull (docs/hull-filters.md, the 2026-11-09 fresh research).
* **A fixed take-profit:** it hurt both Hull and reversal (docs/hull-tp.md, docs/reversal-backtest.md).
* **Swing or step-lock trails:** they need new code. Add them only if the ATR trail looks promising.
* **Delta's native intrabar trailing stop:** it can't be backtested faithfully on 1h bars.
* **A new drawdown halt:** the author didn't ask for one. The breaker already exists.

## Test plan

* The script reproduces Hull's known backtest (+$2,335 per ETH full period, max drop $297) before testing variants.
* Phase 2 is config-only: `npm test`, lint and build are clean, `npm run smoke` passes, and a unit test checks that the preset values load from `.env`.
