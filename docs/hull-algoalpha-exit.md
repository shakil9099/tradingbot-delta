
## Hull entries with AlgoAlpha exits

| Version | Trades older / last yr | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Win % | Avg hours in trade |
|---|---|---|---|---|---|---|---|
| Plain Hull (live exits, BE 0.5R) | 85 / 90 | 1599 | 518 | **2117** | 310 | 58% | 15 |
| Plain Hull, BE 1R (recommended) | 85 / 90 | 1878 | 621 | **2499** | 297 | 46% | 18 |
| 1. Live exits + exit on opposite AlgoAlpha break (BE 0.5R) | 85 / 90 | 1642 | 518 | **2160** | 310 | 58% | 15 |
| 1. Same with BE 1R | 85 / 90 | 1921 | 653 | **2573** | 297 | 46% | 18 |
| 2. Stop + BE 1R, no trailing; exit on opposite AlgoAlpha break | 85 / 89 | 2374 | 644 | **3017** | 301 | 45% | 21 |
| 2b. Stop only (no BE, no trail); exit on opposite AlgoAlpha break or Hull flip | 85 / 89 | 2553 | 644 | **3197** | 316 | 41% | 21 |
| 3. Stop only; exit ONLY on opposite AlgoAlpha break (Hull flips ignored in trade) | 56 / 55 | 1364 | -346 | **1018** | 723 | 24% | 54 |

## Control and account results

| Version | Per-ETH older | Per-ETH last yr | Per-ETH full | Max DD $/ETH | Account last yr (today sizing) | Account full (today sizing) | Account last yr (10%) | Account full (10%) |
|---|---|---|---|---|---|---|---|---|
| Live today (BE 0.5R, trailing) | 1599 | 518 | **2117** | 310 | $138 (53%) | $2181 (29%) | $411 (58%) | $5868 (59%) |
| BE 1R, trailing | 1878 | 621 | **2499** | 297 | $164 (55%) | $2475 (37%) | $506 (57%) | $9640 (57%) |
| CONTROL: stop + BE 1R, no trailing, exit on Hull flip only | 2287 | 558 | **2845** | 301 | $135 (56%) | $2793 (37%) | $350 (58%) | $9686 (58%) |
| CONTROL: stop only, no BE/trail, exit on Hull flip only | 2463 | 543 | **3006** | 316 | $179 (51%) | $2993 (38%) | $338 (59%) | $13175 (59%) |
| 2. stop + BE 1R, no trailing, exit on Hull flip OR opposite AlgoAlpha break | 2374 | 644 | **3017** | 301 | $188 (55%) | $2966 (37%) | $432 (58%) | $14526 (58%) |
| 2b. stop only, exit on Hull flip OR opposite AlgoAlpha break | 2553 | 644 | **3197** | 316 | $197 (55%) | $3185 (38%) | $435 (59%) | $22916 (54%) |