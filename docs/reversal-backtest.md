# Reversal strategy backtest

ETHUSD 1h, 2024-02-26 16:00 to 2026-11-18 19:00 UTC. "Last yr" = the final 365 days, "older" = before that.
Reversal = pine/reversal.pine (Medium: max(2×ATR14, 0.1% of close)), stop 2×ATR (10–40), no break-even, no trail, exit on TP, SL or the opposite signal (which reverses).
Hull = live today (break-even 1R, 3×ATR trail from 1.5R, no TP). Both: no weekend entries, MIN_ATR 15, SL_MAX 40, fees and one tick slippage each way.
When one bar touches both stop and TP the simulator counts the stop (cautious). Per-ETH columns are $ per 1 ETH. Account = live sizing from $195: end balance (worst fall).

| Strategy | Take-profit | Trades | Win % | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Account last yr | Account full |
|---|---|---|---|---|---|---|---|---|---|
| Hull (live) | none | 180 | 44% | 1878 | 457 | **2335** | 297 | $133 (55%) | $2311 (37%) |
| Reversal | none | 266 | 38% | 1550 | 541 | **2091** | 800 | $307 (71%) | $2238 (36%) |
| Reversal | 1R | 267 | 46% | -205 | -99 | **-304** | 859 | $94 (70%) | $154 (77%) |
| Reversal | 1.5R | 267 | 40% | -221 | 347 | **126** | 688 | $130 (70%) | $258 (73%) |
| Reversal | 2R | 267 | 38% | 133 | 198 | **331** | 844 | $134 (75%) | $293 (77%) |
| Reversal | 3R | 266 | 38% | 466 | 436 | **902** | 778 | $141 (75%) | $673 (65%) |
| Reversal | 4R | 266 | 38% | 931 | 628 | **1559** | 757 | $333 (70%) | $1670 (44%) |

## How reversal trades end

| Take-profit | TP | Stop | Opposite signal |
|---|---|---|---|
| none | 0% | 26% | 74% |
| 1R | 46% | 25% | 29% |
| 1.5R | 34% | 26% | 40% |
| 2R | 24% | 26% | 50% |
| 3R | 15% | 26% | 59% |
| 4R | 11% | 26% | 64% |

## Recent trades

### Hull (live): trades in the last 10 days (IST)

| Entry | Side | Entry $ | Exit | Exit $ | Why | Net $/ETH |
|---|---|---|---|---|---|---|
| 11-10 17:30 | short | 2093.45 | 11-11 16:30 | 2059.20 | reversal | 31.80 |
| 11-11 16:30 | long | 2059.20 | 11-12 10:30 | 2049.55 | reversal | -12.07 |
| 11-12 10:30 | short | 2049.55 | 11-13 16:30 | 1958.95 | sl_stage_2 | 88.23 |
| 11-16 16:30 | short | 1808.10 | 11-16 19:30 | 1847.95 | sl_stage_0 | -42.01 |
| 11-17 08:30 | short | 1813.70 | 11-17 09:30 | 1832.40 | reversal | -20.85 |
| 11-17 09:30 | long | 1832.40 | 11-17 15:30 | 1794.60 | sl_stage_0 | -39.94 |
| 11-17 16:30 | short | 1787.75 | 11-17 17:30 | 1823.00 | sl_stage_0 | -37.38 |
| 11-18 14:30 | long | 1811.10 | 11-18 19:30 | 1789.30 | reversal | -23.92 |

### Reversal, no TP: trades in the last 10 days (IST)

| Entry | Side | Entry $ | Exit | Exit $ | Why | Net $/ETH |
|---|---|---|---|---|---|---|
| 11-09 03:30 | long | 2127.10 | 11-09 04:30 | 2126.95 | reversal | -2.66 |
| 11-10 09:30 | short | 2113.85 | 11-10 20:30 | 2082.10 | reversal | 29.27 |
| 11-12 04:30 | short | 2055.45 | 11-13 05:30 | 2019.10 | reversal | 33.95 |
| 11-13 05:30 | long | 2019.10 | 11-13 07:30 | 1987.00 | sl_stage_0 | -34.46 |
| 11-17 18:30 | long | 1822.65 | 11-17 20:30 | 1785.60 | sl_stage_0 | -39.18 |

### Reversal, TP 2R: trades in the last 10 days (IST)

| Entry | Side | Entry $ | Exit | Exit $ | Why | Net $/ETH |
|---|---|---|---|---|---|---|
| 11-09 03:30 | long | 2127.10 | 11-09 04:30 | 2126.95 | reversal | -2.66 |
| 11-10 09:30 | short | 2113.85 | 11-10 18:30 | 2043.55 | tp | 67.85 |
| 11-12 04:30 | short | 2055.45 | 11-12 19:30 | 1984.30 | tp | 68.77 |
| 11-13 05:30 | long | 2019.10 | 11-13 07:30 | 1987.00 | sl_stage_0 | -34.46 |
| 11-17 18:30 | long | 1822.65 | 11-17 20:30 | 1785.60 | sl_stage_0 | -39.18 |
| 11-18 17:30 | short | 1800.10 | 11-18 21:30 | 1735.85 | tp | 62.16 |
