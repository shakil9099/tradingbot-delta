# Break-even at $X profit (BE_TRIG_USD)

ETHUSD 1h, 2024-02-26 to 2026-11-19. Once a 1h candle closes at least $X per ETH in profit, the stop moves to entry ± fees (Hull keeps its 1R break-even and trail too). Live entry gate, fees and slippage included. $ per 1 ETH. "BE exits" = trades closed within ±$3.

| Strategy | BE at | Trades | Win % | BE exits | Avg win | Older $/ETH | Last 12 mo | Last 30 days | Full $/ETH | Worst drop older / last 12 mo |
|---|---|---|---|---|---|---|---|---|---|---|
| Hull (BE 1R + trail) | off | 181 | 45% | 15 | 68 | 1878 | 457 | -20 | **2335** | 224 / 297 |
| Hull (BE 1R + trail) | $10 | 181 | 64% | 76 | 29 | 875 | 361 | -26 | **1236** | 288 / 253 |
| Hull (BE 1R + trail) | $15 | 181 | 57% | 57 | 38 | 1124 | 297 | -52 | **1420** | 288 / 310 |
| Mix B (Hull + rev re-entry), deploying | off | 224 | 43% | 21 | 66 | 1654 | 731 | -10 | **2385** | 342 / 287 |
| Mix B (Hull + rev re-entry), deploying | $10 | 235 | 60% | 95 | 32 | 1088 | 403 | -36 | **1491** | 288 / 428 |
| Mix B (Hull + rev re-entry), deploying | $15 | 233 | 55% | 70 | 41 | 1389 | 488 | -53 | **1877** | 349 / 310 |
| Reversal, no TP | off | 267 | 38% | 12 | 65 | 1550 | 562 | 422 | **2113** | 386 / 800 |
| Reversal, no TP | $10 | 267 | 60% | 89 | 32 | 998 | 537 | 240 | **1535** | 485 / 643 |
| Reversal, no TP | $15 | 267 | 54% | 64 | 40 | 1337 | 611 | 451 | **1948** | 412 / 683 |
| Reversal, TP 2R (default) | off | 267 | 38% | 11 | 47 | 133 | 198 | 439 | **331** | 436 / 844 |
| Reversal, TP 2R (default) | $10 | 267 | 60% | 88 | 24 | -48 | 255 | 269 | **208** | 535 / 641 |
| Reversal, TP 2R (default) | $15 | 267 | 54% | 63 | 29 | 71 | 318 | 468 | **389** | 490 / 700 |
