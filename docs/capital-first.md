# Capital-first exit rule: backtest

ETHUSD 1h, 2024-02-26 to 2026-11-18. The design is in design_draft.md (approved 2026-11-19).

**Rule tested:** the initial stop is R = max($10, 2×ATR), with the trade skipped when R > $40. The stop does not move until an hourly close is at least +1R. From then on it is the tighter of break-even plus fees and the highest high since entry minus k×ATR (mirrored for shorts). The opposite signal also exits. No take-profit.

**Control:** Hull with the exits live today: break-even at 1R, then a 3×ATR trail from 1.5R.

**All variants:** no weekend entries, MIN_ATR 15, fees of 0.059% per side and one tick of slippage each way. The account starts at $107 and risks 5% per trade (fees included), with live caps: 20x margin and at most 100 contracts (1 ETH). Each segment's account starts fresh at $107. "Breaker trips" counts how often three initial stops in a row would have fired the breaker, assuming an immediate resume.

**Segments, by entry time:** CHOOSE 2024-02-26 to 2025-07-08, CHECK 2025-07-08 to 2026-01-24, HOLDOUT 2026-01-24 to 2026-11-18.

## CHOOSE (first 50%)

| Variant | Trades | Win % | Net $/ETH | Max DD $/ETH | Sum R | Avg R | Account from $107 | Worst fall | Breaker trips |
|---|---|---|---|---|---|---|---|---|---|
| Hull, live exits (control) | 83 | 45% | 1657 | 224 | 47.9 | 0.58 | $551 | 24% | 4 |
| Hull, live exits + $15 break-even (local) | 83 | 60% | 903 | 288 | 27.5 | 0.33 | $281 | 29% | 2 |
| Hull, +1R then 1×ATR trail | 83 | 45% | 513 | 344 | 16.0 | 0.19 | $184 | 35% | 4 |
| Hull, +1R then 1.5×ATR trail | 83 | 45% | 492 | 262 | 14.8 | 0.18 | $170 | 27% | 4 |
| Hull, +1R then 2×ATR trail | 83 | 45% | 814 | 285 | 23.9 | 0.29 | $236 | 31% | 4 |
| Reversal, +1R then 1×ATR trail | 113 | 37% | -21 | 569 | -0.3 | -0.00 | $88 | 55% | 2 |
| Reversal, +1R then 1.5×ATR trail | 113 | 37% | 373 | 441 | 11.2 | 0.10 | $133 | 43% | 2 |
| Reversal, +1R then 2×ATR trail | 113 | 37% | 1255 | 381 | 36.2 | 0.32 | $326 | 38% | 2 |

## CHECK (next 20%)

| Variant | Trades | Win % | Net $/ETH | Max DD $/ETH | Sum R | Avg R | Account from $107 | Worst fall | Breaker trips |
|---|---|---|---|---|---|---|---|---|---|
| Hull, live exits (control) | 8 | 25% | 53 | 185 | 1.1 | 0.14 | $105 | 21% | 1 |
| Hull, live exits + $15 break-even (local) | 8 | 50% | 82 | 139 | 2.0 | 0.25 | $109 | 16% | 0 |
| Hull, +1R then 1×ATR trail | 8 | 25% | -90 | 185 | -2.7 | -0.34 | $94 | 21% | 1 |
| Hull, +1R then 1.5×ATR trail | 8 | 25% | -59 | 185 | -1.9 | -0.24 | $95 | 21% | 1 |
| Hull, +1R then 2×ATR trail | 8 | 25% | 72 | 185 | 1.6 | 0.20 | $108 | 21% | 1 |
| Reversal, +1R then 1×ATR trail | 18 | 44% | 274 | 164 | 6.8 | 0.38 | $139 | 20% | 1 |
| Reversal, +1R then 1.5×ATR trail | 18 | 44% | 427 | 140 | 11.0 | 0.61 | $162 | 19% | 1 |
| Reversal, +1R then 2×ATR trail | 18 | 44% | 611 | 161 | 15.9 | 0.88 | $196 | 20% | 1 |

## Shortlist: variants that beat the control on both end balance and worst fall, in CHOOSE and in CHECK

**None.** No variant beat the control on both measures in both segments.

## HOLDOUT (last 30%, the control and the shortlist only)

| Variant | Trades | Win % | Net $/ETH | Max DD $/ETH | Sum R | Avg R | Account from $107 | Worst fall | Breaker trips |
|---|---|---|---|---|---|---|---|---|---|
| Hull, live exits (control) | 89 | 46% | 625 | 297 | 18.3 | 0.21 | $200 | 33% | 4 |

**Acceptance** means beating the control on HOLDOUT on both end balance and worst fall, with at least 30 trades. Nothing passed.

## Full period (for reference only; not used to choose)

| Variant | Trades | Win % | Net $/ETH | Max DD $/ETH | Sum R | Avg R | Account from $107 | Worst fall | Breaker trips |
|---|---|---|---|---|---|---|---|---|---|
| Hull, live exits (control) | 180 | 44% | 2335 | 297 | 67.3 | 0.37 | $1098 | 25% | 9 |
| Hull, live exits + $15 break-even (local) | 180 | 57% | 1420 | 310 | 41.8 | 0.23 | $435 | 35% | 5 |
| Hull, +1R then 1×ATR trail | 181 | 45% | 1165 | 344 | 34.3 | 0.19 | $354 | 35% | 9 |
| Hull, +1R then 1.5×ATR trail | 181 | 45% | 1125 | 274 | 32.9 | 0.18 | $323 | 31% | 9 |
| Hull, +1R then 2×ATR trail | 181 | 45% | 1559 | 285 | 45.3 | 0.25 | $496 | 31% | 9 |
| Reversal, +1R then 1×ATR trail | 267 | 40% | 628 | 678 | 16.3 | 0.06 | $144 | 62% | 6 |
| Reversal, +1R then 1.5×ATR trail | 267 | 40% | 997 | 794 | 27.2 | 0.10 | $213 | 68% | 6 |
| Reversal, +1R then 2×ATR trail | 267 | 40% | 2157 | 842 | 59.4 | 0.22 | $699 | 68% | 6 |

## How trades end (full period)

| Variant | Initial stop | Break-even stop | Trail stop | Opposite signal |
|---|---|---|---|---|
| Hull, live exits (control) | 38% | 7% | 27% | 28% |
| Hull, live exits + $15 break-even (local) | 29% | 31% | 20% | 20% |
| Hull, +1R then 1×ATR trail | 38% | 1% | 42% | 20% |
| Hull, +1R then 1.5×ATR trail | 38% | 0% | 43% | 19% |
| Hull, +1R then 2×ATR trail | 38% | 0% | 43% | 20% |
| Reversal, +1R then 1×ATR trail | 26% | 0% | 33% | 40% |
| Reversal, +1R then 1.5×ATR trail | 26% | 0% | 34% | 40% |
| Reversal, +1R then 2×ATR trail | 26% | 0% | 34% | 40% |
