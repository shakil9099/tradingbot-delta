# AlgoAlpha Zero Lag Liquidity + UT Bot (1, 10), ETHUSD 1h only (AlgoAlpha’s own 3m wick profile kept, as on TradingView)

Older: 2024-02-26 → 2025-11-13. Last 365 days: 2025-11-13 → 2026-11-13. 3m lower-timeframe data from Delta India. Per 1 ETH after fees (0.059%/side + 0.05$).
AlgoAlpha events in the last year: 238 breaks, 463 rejections. Latest breaks (compare with TradingView): 2026-11-06 11:30 IST Bearish break ▼; 2026-11-09 12:30 IST Bearish break ▼; 2026-11-10 21:30 IST Bearish break ▼; 2026-11-12 19:30 IST Bearish break ▼; 2026-11-12 20:30 IST Bearish break ▼; 2026-11-13 08:30 IST Bearish break ▼.

## UT Bot rules (exit on the opposite UT signal unless stated; no new entries Sat–Sun IST)

| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |
|---|---|---|---|---|---|---|---|---|---|---|
| UT 1/10 plain | 1234 | -1418 | 0.95 | 686 | 34% | **-1184** | 0.90 | 2018 | -2602 | 4243 |
| UT + AlgoAlpha trend agrees | 571 | 102 | 1.01 | 307 | 33% | **30** | 1.01 | 840 | 132 | 1796 |
| UT + AlgoAlpha break same way in last 5 bars | 15 | -119 | 0.65 | 7 | 57% | **109** | 2.51 | 50 | -10 | 190 |
| UT + AlgoAlpha break same way in last 24 bars | 215 | -80 | 0.99 | 151 | 34% | **696** | 1.28 | 374 | 616 | 1647 |
| UT + AlgoAlpha rejection same way in last 5 bars | 105 | 414 | 1.17 | 93 | 31% | **-753** | 0.53 | 1014 | -339 | 1409 |
| AlgoAlpha break entry, exit on opposite UT | 196 | 1283 | 1.29 | 151 | 27% | **-293** | 0.90 | 827 | 991 | 1131 |
| AlgoAlpha break entry, exit on opposite break | 113 | 1976 | 1.24 | 76 | 37% | **1114** | 1.34 | 1065 | 3090 | 1607 |
| AlgoAlpha break + UT 1/10 direction agrees, exit on opposite break | 111 | 1713 | 1.20 | 75 | 37% | **1094** | 1.34 | 1085 | 2807 | 1853 |

## With the live bot’s exit engine (2×ATR stop, BE 0.5R, 3×ATR trail after 1.5R)

| Rule | Older trades | Older net $ | Older PF | Last-yr trades | Last-yr win % | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ |
|---|---|---|---|---|---|---|---|---|---|---|
| LIVE Hull bot | 85 | 1599 | 2.30 | 90 | 57% | **518** | 1.44 | 310 | 2117 | 310 |
| Hull + AlgoAlpha trend agrees | 38 | 850 | 2.67 | 46 | 59% | **537** | 1.98 | 212 | 1388 | 212 |
| Hull + AlgoAlpha break same way in last 24 bars | 8 | 384 | 6.27 | 18 | 50% | **262** | 2.09 | 107 | 645 | 107 |
| Hull + no opposite AlgoAlpha break in last 5 bars | 85 | 1599 | 2.30 | 89 | 56% | **518** | 1.44 | 310 | 2117 | 310 |
| AlgoAlpha break entries + live-bot exits (2×ATR stop, BE, trail; opposite break reverses) | 22 | 640 | 3.42 | 44 | 55% | **-78** | 0.89 | 274 | 562 | 274 |
| UT 1/10 entries + live-bot exits | 156 | 1741 | 1.87 | 196 | 47% | **400** | 1.16 | 504 | 2141 | 504 |
| UT 1/10 + AlgoAlpha trend agrees, live-bot exits | 73 | 1001 | 2.12 | 85 | 51% | **488** | 1.46 | 174 | 1489 | 174 |

## AlgoAlpha break (exit on opposite break) with a loss-streak guard

| Safety stop | Guard | Older trades | Older net $ | Last-yr trades | Last-yr net $ | Last-yr PF | Last-yr max DD $ | Full net $ | Full max DD $ | Longest losing run | Profit ÷ DD |
|---|---|---|---|---|---|---|---|---|---|---|---|
| none | no guard | 113 | 1976 | 75 | **837** | 1.26 | 1065 | 2813 | 1607 | 9 | 1.8 |
| none | 2 losses → pause until a shadow trade wins | 75 | 115 | 46 | **693** | 1.32 | 465 | 808 | 2194 | 11 | 0.4 |
| none | 2 losses → skip the next trade | 92 | 1737 | 60 | **510** | 1.19 | 777 | 2247 | 1564 | 6 | 1.4 |
| none | 2 losses → pause 24 h | 96 | 1342 | 60 | **545** | 1.21 | 794 | 1887 | 1899 | 8 | 1.0 |
| none | 2 losses → pause 72 h | 91 | 595 | 54 | **711** | 1.27 | 896 | 1306 | 2643 | 14 | 0.5 |
| none | 3 losses → pause until a shadow trade wins | 93 | 418 | 58 | **1323** | 1.54 | 451 | 1742 | 1689 | 9 | 1.0 |
| 2× ATR | no guard | 150 | 722 | 96 | **861** | 1.29 | 705 | 1583 | 1699 | 13 | 0.9 |
| 2× ATR | 2 losses → pause until a shadow trade wins | 77 | 558 | 46 | **326** | 1.24 | 440 | 884 | 1406 | 15 | 0.6 |
| 2× ATR | 2 losses → skip the next trade | 117 | 460 | 72 | **40** | 1.02 | 682 | 500 | 1727 | 14 | 0.3 |
| 2× ATR | 2 losses → pause 24 h | 126 | 867 | 82 | **201** | 1.08 | 718 | 1069 | 1241 | 11 | 0.9 |
| 2× ATR | 2 losses → pause 72 h | 116 | 156 | 73 | **736** | 1.34 | 556 | 892 | 1540 | 15 | 0.6 |
| 2× ATR | 3 losses → pause until a shadow trade wins | 99 | 1225 | 61 | **1230** | 1.68 | 405 | 2455 | 777 | 9 | 3.2 |
| 3× ATR | no guard | 133 | 2776 | 90 | **681** | 1.21 | 778 | 3457 | 1260 | 11 | 2.7 |
| 3× ATR | 2 losses → pause until a shadow trade wins | 82 | 1826 | 46 | **602** | 1.37 | 510 | 2428 | 1445 | 11 | 1.7 |
| 3× ATR | 2 losses → skip the next trade | 106 | 1300 | 69 | **346** | 1.14 | 716 | 1645 | 1667 | 9 | 1.0 |
| 3× ATR | 2 losses → pause 24 h | 114 | 1410 | 73 | **518** | 1.20 | 712 | 1928 | 1700 | 10 | 1.1 |
| 3× ATR | 2 losses → pause 72 h | 108 | 1380 | 67 | **1019** | 1.43 | 757 | 2398 | 1722 | 11 | 1.4 |
| 3× ATR | 3 losses → pause until a shadow trade wins | 101 | 2903 | 60 | **940** | 1.44 | 592 | 3843 | 1120 | 7 | 3.4 |

## AlgoAlpha break + 3×ATR stop: trailing-stop variants (live exit engine)

| Break-even | Trail starts at | Trail distance | Older net $ | Older DD $ | Last-yr net $ | Last-yr DD $ | Full net $ | Full DD $ | Profit ÷ DD | Beats "no trail" in both periods? |
|---|---|---|---|---|---|---|---|---|---|---|
| off | off | — | 2777 | 1259 | **682** | 777 | 3459 | 1259 | 2.7 | — |
| off | 1R profit | 2× ATR | 3458 | 707 | **-927** | 1077 | 2531 | 1452 | 1.7 | no |
| off | 1R profit | 3× ATR | 3135 | 768 | **118** | 707 | 3253 | 768 | 4.2 | no |
| off | 1R profit | 4× ATR | 2612 | 702 | **658** | 661 | 3269 | 702 | 4.7 | no |
| off | 1.5R profit | 2× ATR | 3015 | 1267 | **252** | 722 | 3267 | 1267 | 2.6 | no |
| off | 1.5R profit | 3× ATR | 2668 | 974 | **258** | 738 | 2925 | 974 | 3.0 | no |
| off | 1.5R profit | 4× ATR | 2042 | 917 | **656** | 768 | 2698 | 917 | 2.9 | no |
| off | 2R profit | 2× ATR | 2840 | 1036 | **139** | 626 | 2978 | 1036 | 2.9 | no |
| off | 2R profit | 3× ATR | 2699 | 885 | **-100** | 685 | 2599 | 885 | 2.9 | no |
| off | 2R profit | 4× ATR | 2259 | 884 | **158** | 681 | 2417 | 884 | 2.7 | no |
| off | 3R profit | 2× ATR | 2834 | 964 | **-725** | 940 | 2109 | 1444 | 1.5 | no |
| off | 3R profit | 3× ATR | 3188 | 1006 | **-351** | 838 | 2836 | 1006 | 2.8 | no |
| off | 3R profit | 4× ATR | 3206 | 1086 | **258** | 751 | 3465 | 1086 | 3.2 | no |
| 1R | 1R profit | 2× ATR | 3458 | 707 | **-927** | 1077 | 2531 | 1452 | 1.7 | no |
| 1R | 1R profit | 3× ATR | 3141 | 768 | **118** | 707 | 3259 | 768 | 4.2 | no |
| 1R | 1R profit | 4× ATR | 2707 | 702 | **490** | 661 | 3197 | 702 | 4.6 | no |
| 1R | 1.5R profit | 2× ATR | 3178 | 1030 | **202** | 749 | 3380 | 1030 | 3.3 | no |
| 1R | 1.5R profit | 3× ATR | 2860 | 870 | **59** | 834 | 2919 | 870 | 3.4 | no |
| 1R | 1.5R profit | 4× ATR | 2254 | 814 | **469** | 687 | 2724 | 814 | 3.3 | no |
| 1R | 2R profit | 2× ATR | 2698 | 800 | **-151** | 577 | 2547 | 800 | 3.2 | no |
| 1R | 2R profit | 3× ATR | 2318 | 781 | **-80** | 724 | 2238 | 781 | 2.9 | no |
| 1R | 2R profit | 4× ATR | 1967 | 770 | **217** | 652 | 2184 | 770 | 2.8 | no |
| 1R | 3R profit | 2× ATR | 2571 | 740 | **-924** | 1094 | 1647 | 1539 | 1.1 | no |
| 1R | 3R profit | 3× ATR | 3079 | 734 | **-464** | 1063 | 2614 | 1063 | 2.5 | no |
| 1R | 3R profit | 4× ATR | 3230 | 783 | **169** | 820 | 3399 | 820 | 4.1 | no |
| 1R | off | — | 2510 | 1137 | **700** | 777 | 3211 | 1137 | 2.8 | no |
| 0.5R | off | — | 1874 | 765 | **618** | 877 | 2491 | 877 | 2.8 | no |

## Compounding at a fixed risk per trade (3×ATR stop, opposite-break exit)

223 trades; average result 0.28 × risk; win rate 34%.

| Risk per trade | Actual history Feb 2024→now: end balance (start = 1.00) | Worst fall from peak | 1-year simulations: chance of falling below 50% of start | …below 20% of start | Median balance after 1 year |
|---|---|---|---|---|---|
| 20% | 0.18 | 99% | 81% | 58% | 0.66 |
| 10% | 5.95 | 75% | 44% | 12% | 2.35 |
| 5% | 5.99 | 46% | 12% | 0% | 2.19 |
| 2% | 2.72 | 22% | 0% | 0% | 1.53 |