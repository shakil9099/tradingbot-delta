# Live Hull bot: chop filters (MIN_ATR, Hull slope)

Older period (rules chosen here): 2024-02-26 → 2025-11-17. Last 365 days (judged only): 2025-11-17 → 2026-11-17.
Exits as live: stop 2×ATR clamp $10–$40, BE 1R, trail 3×ATR after 1.5R; weekend gate on. Per 1 ETH after fees.
42 rules tried; 0 beat the live bot on the older period (net and PF, both halves profitable, ≥ 40 trades).

## Live bot and rules chosen on the older period

| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |
|---|---|---|---|---|---|---|---|---|---|---|
| LIVE BOT (MIN_ATR 15, no slope) | 85 | 1878 | 2.16 | 92 | 46% | **558** | 1.38 | 297 | 2436 | 297 |

Rules that beat the live bot on net profit in BOTH periods: none.

## All rules

| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |
|---|---|---|---|---|---|---|---|---|---|---|
| LIVE BOT (MIN_ATR 15, no slope) | 85 | 1878 | 2.16 | 92 | 46% | **558** | 1.38 | 297 | 2436 | 297 |
| MIN_ATR 15 + slope ≥ 0.02×ATR | 45 | 834 | 1.88 | 62 | 48% | **332** | 1.31 | 233 | 1166 | 414 |
| MIN_ATR 15 + slope ≥ 0.03×ATR | 36 | 311 | 1.40 | 46 | 52% | **413** | 1.55 | 194 | 723 | 386 |
| MIN_ATR 15 + slope ≥ 0.05×ATR | 16 | 446 | 2.70 | 26 | 46% | **48** | 1.11 | 140 | 494 | 140 |
| MIN_ATR 15 + slope ≥ 0.075×ATR | 7 | 253 | 3.61 | 8 | 63% | **150** | 2.36 | 75 | 403 | 75 |
| MIN_ATR 15 + slope ≥ 0.1×ATR | 2 | -40 | 0.01 | 3 | 67% | **14** | 1.39 | 35 | -26 | 54 |
| MIN_ATR 15 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 16 | 74 | 1732 | 2.15 | 77 | 47% | **415** | 1.34 | 277 | 2147 | 277 |
| MIN_ATR 16 + slope ≥ 0.02×ATR | 39 | 766 | 1.87 | 54 | 46% | **55** | 1.06 | 306 | 821 | 444 |
| MIN_ATR 16 + slope ≥ 0.03×ATR | 33 | 342 | 1.46 | 41 | 51% | **301** | 1.45 | 177 | 642 | 377 |
| MIN_ATR 16 + slope ≥ 0.05×ATR | 14 | 456 | 2.81 | 24 | 46% | **43** | 1.11 | 155 | 499 | 155 |
| MIN_ATR 16 + slope ≥ 0.075×ATR | 6 | 253 | 3.61 | 8 | 63% | **150** | 2.36 | 75 | 403 | 75 |
| MIN_ATR 16 + slope ≥ 0.1×ATR | 1 | -40 | 0.00 | 3 | 67% | **14** | 1.39 | 35 | -26 | 54 |
| MIN_ATR 16 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 17 | 60 | 1408 | 2.10 | 55 | 45% | **164** | 1.18 | 206 | 1572 | 394 |
| MIN_ATR 17 + slope ≥ 0.02×ATR | 33 | 667 | 1.85 | 37 | 46% | **-22** | 0.97 | 212 | 644 | 413 |
| MIN_ATR 17 + slope ≥ 0.03×ATR | 28 | 207 | 1.30 | 25 | 52% | **198** | 1.50 | 140 | 405 | 361 |
| MIN_ATR 17 + slope ≥ 0.05×ATR | 11 | 504 | 3.55 | 16 | 56% | **139** | 1.69 | 79 | 643 | 79 |
| MIN_ATR 17 + slope ≥ 0.075×ATR | 5 | 274 | 4.57 | 5 | 80% | **164** | 5.16 | 39 | 437 | 40 |
| MIN_ATR 17 + slope ≥ 0.1×ATR | 1 | -40 | 0.00 | 2 | 100% | **49** | 99.00 | 0 | 9 | 40 |
| MIN_ATR 17 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 18 | 40 | 896 | 2.02 | 37 | 43% | **67** | 1.10 | 142 | 963 | 508 |
| MIN_ATR 18 + slope ≥ 0.02×ATR | 20 | 484 | 1.95 | 23 | 43% | **-135** | 0.72 | 219 | 349 | 424 |
| MIN_ATR 18 + slope ≥ 0.03×ATR | 17 | 55 | 1.12 | 17 | 53% | **36** | 1.12 | 132 | 91 | 368 |
| MIN_ATR 18 + slope ≥ 0.05×ATR | 6 | 311 | 3.56 | 10 | 50% | **-71** | 0.54 | 102 | 240 | 102 |
| MIN_ATR 18 + slope ≥ 0.075×ATR | 2 | 108 | 3.70 | 3 | 67% | **-18** | 0.53 | 39 | 89 | 58 |
| MIN_ATR 18 + slope ≥ 0.1×ATR | 1 | -40 | 0.00 | 1 | 100% | **21** | 99.00 | 0 | -19 | 40 |
| MIN_ATR 18 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.02×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.03×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.05×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.075×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.1×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 20 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.02×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.03×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.05×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.075×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.1×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |
| MIN_ATR 22 + slope ≥ 0.15×ATR | 0 | 0 | 99.00 | 0 | 0% | **0** | 99.00 | 0 | 0 | 0 |

## Recent live signals

- 2026-11-16T10:00:00Z (signal SHORT): slope 0.0133×ATR, ATR 19.92
- 2026-11-17T02:00:00Z (signal SHORT): slope 0.0058×ATR, ATR 18.46
- 2026-11-17T03:00:00Z (signal LONG): slope 0.0002×ATR, ATR 18.89