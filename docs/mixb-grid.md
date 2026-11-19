# Mix B exit grid

ETHUSD 1h, 2024-02-26 to 2026-11-19; last 12 months from 2025-11-19. Mix B entries (Hull + reversal re-entry), live gate, fees and slippage. $ per 1 ETH. 720 settings tried.

A setting **passes** only if it beats current Mix B in both periods with a worst drop no bigger in either. "Neighbours passing" = of the settings one notch away on any knob, how many also pass (a lone pass is likely luck).

## Current Mix B

| Stop | Break-even | Trail | TP | Trades | Win % | Older $/ETH | Last 12 mo | Full | Worst drop older / 12 mo | Worst trade | Losing streak | Neighbours passing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2×ATR | 1R | 3×ATR from 1.5R | none | 224 | 43% | 1654 | 731 | **2385** | 342 / 287 | -83 | 6 | — |

## Passing settings (4)

| Stop | Break-even | Trail | TP | Trades | Win % | Older $/ETH | Last 12 mo | Full | Worst drop older / 12 mo | Worst trade | Losing streak | Neighbours passing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2×ATR | 1.5R | 3×ATR from 1R | none | 223 | 39% | 1707 | 790 | **2497** | 325 / 273 | -83 | 8 | 2/8 |
| 2×ATR | 1R | 3×ATR from 1R | none | 224 | 43% | 1710 | 786 | **2496** | 325 / 270 | -83 | 6 | 1/8 |
| 2×ATR | off | 3×ATR from 1R | none | 223 | 39% | 1705 | 790 | **2496** | 327 / 273 | -83 | 8 | 0/7 |
| 2×ATR | 2R | 3×ATR from 1R | none | 223 | 39% | 1705 | 790 | **2496** | 327 / 273 | -83 | 8 | 1/7 |

## Smallest worst drop (both periods profitable)

| Stop | Break-even | Trail | TP | Trades | Win % | Older $/ETH | Last 12 mo | Full | Worst drop older / 12 mo | Worst trade | Losing streak | Neighbours passing |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.5×ATR | 0.75R | 2×ATR from 1R | none | 41 | 49% | 114 | 55 | **169** | 65 / 152 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 2×ATR from 1R | 3R | 41 | 49% | 126 | 19 | **146** | 65 / 152 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 2×ATR from 1R | 5R | 41 | 49% | 114 | 55 | **169** | 65 / 152 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 3×ATR from 1R | none | 41 | 49% | 95 | 24 | **120** | 65 / 154 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 3×ATR from 1R | 3R | 41 | 49% | 136 | 91 | **227** | 65 / 154 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 3×ATR from 1R | 5R | 41 | 49% | 95 | 87 | **182** | 65 / 154 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 4×ATR from 1R | none | 41 | 49% | 101 | 272 | **372** | 65 / 155 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 4×ATR from 1R | 3R | 41 | 49% | 130 | 90 | **221** | 65 / 155 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 4×ATR from 1R | 5R | 41 | 49% | 101 | 137 | **238** | 65 / 155 | -44 | 3 | — |
| 2.5×ATR | 0.75R | 3×ATR from 1.5R | none | 41 | 49% | 94 | 18 | **113** | 65 / 155 | -44 | 3 | — |
