# 4h trend + 15m entry vs the live 1h bot

ETHUSD, 2024-03-21 to 2026-11-18. Per-ETH columns: $ per 1 ETH after fees and one tick of slippage each way. "Last yr" = final 365 days.
4h trend = EMA50 vs EMA200 of closed 4h candles. 15m entry = Hull(55) flip in the trend direction. Exits on 15m: stop max($10, 2×ATR14) (no entry if over $40),
cost-to-cost at +$15 or 1R, trail 3×ATR from 1.5R, no TP, and a close when the 4h trend flips. 15m rows skip the $15 ATR floor (an hourly number). No weekend entries.

| Setup | Trades | Win % | Fees $/ETH | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH |
|---|---|---|---|---|---|---|---|
| Live today: Hull 1h (+$15 cost-to-cost) | 180 | 57% | 513 | 1124 | 296 | **1420** | 310 |
| 4h EMA50/200 trend + 15m Hull entry | 1198 | 51% | 3822 | -21 | -1567 | **-1588** | 2174 |
| 15m Hull entry, no 4h filter | 2727 | 45% | 8627 | -696 | -3809 | **-4505** | 5347 |

## Account from $176

Risk = live risk sizing (20%, 5% after a 20% fall from peak). Fixed = 1 ETH every trade (margin permitting).

| Setup | Since 10 Nov (risk) | Since 10 Nov (1 ETH) | Last 90 days (risk) | Last 90 days (1 ETH) | Last year (risk) | Last year (1 ETH) |
|---|---|---|---|---|---|---|
| Live today: Hull 1h (+$15 cost-to-cost) | $174 (worst fall 33%) | $100 (worst fall 62%) | $420 (worst fall 39%) | $445 (worst fall 54%) | $101 (worst fall 53%) | $422 (worst fall 75%) |
| 4h EMA50/200 trend + 15m Hull entry | $166 (worst fall 28%) | $175 (worst fall 40%) | $81 (worst fall 65%) | $8 (worst fall 97%) | $3 (worst fall 99%) | $1 (worst fall 100%) |
| 15m Hull entry, no 4h filter | $90 (worst fall 54%) | $39 (worst fall 86%) | $13 (worst fall 93%) | $1 (worst fall 99%) | $2 (worst fall 99%) | $1 (worst fall 100%) |
