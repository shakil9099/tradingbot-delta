# Hull + reversal entry mixes

ETHUSD 1h, 2024-02-26 to 2026-11-18. "Last 12 mo" = from 2025-11-18; "older" = before that.

Every mix uses Hull's live exits: break-even at 1R, then a 3×ATR trail from 1.5R, and no take-profit. Every mix also uses the live entry filters: no weekend entries, ATR at least 15, and a stop of at most $40. Fees and one tick of slippage are included on each side.

Profit and worst drop are $ per 1 ETH traded. The account column starts at $107 and risks 5% per trade, showing the end balance and its worst fall.

A mix **passes** only if it beats plain Hull in both periods, with a worst drop no bigger in either.

The two "fixed 1 ETH" columns start at $107 and trade 100 contracts each time, capped by margin (about 98 contracts at $107). One starts in Feb 2024, the other 12 months ago.

| Mix | Trades | Win % | Older $/ETH | Last 12 mo $/ETH | Full $/ETH | Worst drop older / last 12 mo | Account from $107, 5% risk (worst fall) | Fixed 1 ETH from $107, full (worst fall) | Fixed 1 ETH from $107, last 12 mo (worst fall) | Passes |
|---|---|---|---|---|---|---|---|---|---|---|
| Hull only (live) | 180 | 44% | 1878 | 457 | **2335** | 224 / 297 | $1098 (25%) | $2296 (47%) | $7 (96%) | control |
| A. Hull confirmed by reversal | 166 | 43% | 1712 | 471 | **2184** | 185 / 285 | $880 (30%) | $2083 (47%) | $12 (95%) | no |
| B. Hull + re-entry on reversal | 223 | 43% | 1654 | 731 | **2385** | 342 / 287 | $1030 (35%) | $2371 (47%) | $694 (84%) | no |
| C. Hull + re-entry + early exit | 245 | 36% | 979 | 313 | **1292** | 442 / 429 | $326 (45%) | $1290 (58%) | $2 (99%) | no |
| D. Reversal in Hull's direction | 91 | 43% | 728 | 503 | **1231** | 239 / 149 | $373 (26%) | $1260 (48%) | $516 (41%) | no |
| E. Either signal | 329 | 37% | 1472 | 454 | **1926** | 373 / 758 | $486 (66%) | $1968 (43%) | $26 (98%) | no |

## What each mix does

* **Hull only (live):** Enter and reverse on Hull flips.
* **A. Hull confirmed by reversal:** Hull flips, but enter only when reversal's direction agrees; otherwise the flip only closes.
* **B. Hull + re-entry on reversal:** Hull flips as live; after a stop-out, a reversal signal in Hull's direction re-enters.
* **C. Hull + re-entry + early exit:** As B, and a reversal signal against the open trade closes it (no new trade until a Hull flip or an agreeing reversal signal).
* **D. Reversal in Hull's direction:** Enter only on reversal signals that agree with Hull's direction; an opposite reversal signal closes.
* **E. Either signal:** Enter and reverse on any Hull flip or any reversal signal (Hull wins a same-bar tie).
