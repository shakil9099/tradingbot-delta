# UT sniper: what happens after a stop-loss is hit

All sniper trades 2024-02-26 → 2026-11-13 (151 trades; last 365 days = 39). Stop = k × ATR(14) at the signal bar, from the entry price.
"After the stop" = from the stop bar until the original opposite-signal exit.

| Stop | Trades that hit it | …then price back to entry | …then reached +1R | …then reached +2R | …would have ended in profit (held to opposite signal) | Net $/ETH without stop | Net $/ETH with stop | Max DD without → with |
|---|---|---|---|---|---|---|---|---|
| 1× ATR | 70 of 151 | 18 (26%) | 14 (20%) | 8 (11%) | 8 (11%) | 935 | 415 | 398 → 504 |
| 1.5× ATR | 34 of 151 | 5 (15%) | 2 (6%) | 2 (6%) | 2 (6%) | 935 | 661 | 398 → 492 |
| 2× ATR | 11 of 151 | 0 (0%) | 0 (0%) | 0 (0%) | 0 (0%) | 935 | 849 | 398 → 428 |
| 3× ATR | 0 of 151 | 0 (0%) | 0 (0%) | 0 (0%) | 0 (0%) | 935 | 935 | 398 → 398 |

Without a stop: 60 winners, 91 losers. Winners' worst dip against them before working (in ATR): median 0.57, 75% ≤ 0.88, 90% ≤ 1.24, max 1.93.

## Cost-to-cost stop

| Initial stop | Move to cost after | Trades | Win % | Closed at cost | Net $/ETH all (Feb 2024→) | Net last 365 days | Max DD $ |
|---|---|---|---|---|---|---|---|
| none | never (current rule) | 151 | 40% | 0 | 935 | 425 | 398 |
| none | 0.5× ATR profit | 151 | 52% | 65 | 260 | 166 | 492 |
| none | 1× ATR profit | 151 | 54% | 45 | 464 | 413 | 442 |
| none | 1.5× ATR profit | 151 | 48% | 22 | 666 | 483 | 396 |
| none | 2× ATR profit | 151 | 42% | 12 | 693 | 430 | 443 |
| none | 3× ATR profit | 151 | 40% | 2 | 936 | 425 | 398 |
| 2× ATR | never (current rule) | 151 | 40% | 0 | 849 | 413 | 428 |
| 2× ATR | 0.5× ATR profit | 151 | 52% | 65 | 164 | 150 | 511 |
| 2× ATR | 1× ATR profit | 151 | 54% | 45 | 387 | 400 | 471 |
| 2× ATR | 1.5× ATR profit | 151 | 48% | 22 | 589 | 470 | 425 |
| 2× ATR | 2× ATR profit | 151 | 42% | 12 | 616 | 417 | 473 |
| 2× ATR | 3× ATR profit | 151 | 40% | 2 | 849 | 412 | 428 |