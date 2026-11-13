# Live Hull bot + entry filters

Older period (filters chosen here): 2024-02-26 → 2025-11-13. Last 365 days (judged only): 2025-11-13 → 2026-11-13.
Exits unchanged (stop 2×ATR clamp $10–$40, BE 0.5R, trail 3×ATR after 1.5R); weekend + MIN_ATR gate as live. Per 1 ETH after fees.
67 rules tried; 1 beat the live bot on the older period (PF, both halves profitable, ≥ 40 trades).

| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Last-yr months + | Full net $ | Full max DD $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| LIVE BOT (no extra filter) | 85 | 1599 | 2.30 | 90 | 57% | **518** | 1.44 | 310 | 8/11 | 2117 | 310 |
| adx20 | 40 | 1557 | 3.99 | 52 | 52% | **195** | 1.24 | 278 | 6/9 | 1752 | 278 |

Rules that beat the live bot on net profit in BOTH periods: none.

Top 5 by last-year net (shown for transparency; picking from this list would be fitting to the test year):

| ut1h | 80 | 1403 | 2.18 | 84 | 58% | **613** | 1.56 | 273 | 8/11 | 2016 | 282 |
| ut1h + chop618 | 78 | 898 | 1.76 | 73 | 59% | **465** | 1.47 | 248 | 8/11 | 1363 | 282 |
| chop618 | 82 | 980 | 1.80 | 79 | 57% | **369** | 1.34 | 284 | 8/11 | 1349 | 288 |
| ut1h + adx20 | 36 | 1420 | 3.96 | 49 | 55% | **287** | 1.40 | 241 | 6/9 | 1707 | 241 |
| adx20 + volume | 9 | 211 | 2.07 | 15 | 60% | **216** | 2.22 | 89 | 4/6 | 428 | 127 |