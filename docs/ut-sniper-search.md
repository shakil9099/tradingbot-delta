# UT Bot (1, 10) sniper-entry search, ETHUSD 1h

Train (rules chosen here): 2024-02-26 → 2025-11-13. Test (never used for choosing): 2025-11-13 → 2026-11-13.
Exit on the opposite UT signal; no new entries Sat–Sun IST. Fee 0.059%/side + 0.05$ slippage, per 1 ETH.
58 rules tried; 8 passed the train screen (≥80 trades, profitable in both train halves).

| Rule | Train trades | Train net $ | Train PF | Test trades | Test win % | Test net $ | Test PF | Test max DD $ | Test months positive |
|---|---|---|---|---|---|---|---|---|---|
| none · market entry | 1234 | -1418 | 0.95 | 685 | 34% | **-1129** | 0.90 | 2018 | 6/13 |
| ut4h + donchian10 · market entry | 112 | 510 | 1.19 | 39 | 41% | **425** | 1.71 | 187 | 6/12 |
| ut4h + donchian10 · break entry | 90 | 386 | 1.17 | 29 | 38% | **369** | 1.88 | 168 | 5/11 |
| hull · break entry | 311 | 836 | 1.11 | 175 | 31% | **-180** | 0.95 | 828 | 4/12 |
| ut4h + strongBar · break entry | 262 | 548 | 1.08 | 117 | 35% | **585** | 1.28 | 383 | 6/12 |
| atrExpand · break entry | 574 | 1151 | 1.08 | 337 | 35% | **-906** | 0.85 | 1398 | 5/13 |
| strongBar + atrExpand · break entry | 429 | 774 | 1.07 | 231 | 40% | **-159** | 0.96 | 767 | 5/13 |
| hull · market entry | 405 | 545 | 1.05 | 229 | 34% | **113** | 1.03 | 651 | 4/13 |
| hull + donchian10 · market entry | 104 | 76 | 1.03 | 45 | 40% | **-42** | 0.95 | 449 | 3/11 |