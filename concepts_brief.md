# ETH Perpetual Trading Bot (Delta Exchange India)

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-08

## Overview

A server-side bot, written in Node.js + Express + TypeScript, trades only the ETHUSD perpetual on Delta Exchange India (product 3136; 1 contract = 0.01 ETH; tick 0.05). It runs live under PM2 on a VPS.

The bot does not depend on TradingView:
- Every hour it fetches closed 1h candles from Delta.
- It computes two signal sources: Hull Suite (HMA 55) and UT Bot (ATR 6, key 2).
- It trades whichever source has done better over recent simulated trades.

Sizing and risk:
- **Size:** balance ÷ 141 ETH, in 0.01 ETH steps.
- **SL:** $20 price move from entry, placed as an exchange bracket order.
- **TP:** $100 price move from entry, also on the exchange.

Trailing, checked on each 1h candle close (the stop only ever tightens):
- profit ≥ $12: stop moves to entry + $2.5;
- profit ≥ $25: stop moves to entry + $15;
- after that: stop = close − $10 (mirrored for shorts).

An opposite signal closes the trade and opens the reverse one.

Two companion pieces:
- A new Pine strategy that mirrors the logic, for chart review and backtesting.
- A password-protected dashboard served by Express. It lists every trade with its reason, and shows rule-based "what can be improved" statistics.

## Analysis

Six reviewers (design, codebase details, zoom-out, comprehension, implementation readiness, structure) reviewed the concept. Their main conclusion: infrastructure cost is trivial, but trading risk and order safety are not specified well enough to build against.

### 1. Risk per trade is about 14–16% of the account

- Size = balance/141 ETH, so a $20 stop loses 20/141 ≈ 14.2% of the balance. With fees and GST it is about 16%.
- Five losses in a row leave about 45% of the account.
- A $20 move is about 0.9% of ETH's price, which sits inside normal hourly noise, so stop-outs will be frequent.
- **Recommendation:** keep the /141 rule as a config value. Add a daily-loss limit and a consecutive-loss limit that pause new entries.

### 2. The fixed /141 divisor makes leverage drift with price

- Effective leverage = price/141: 15.8x at $2,225, 20x at $2,820, 28x at $4,000.
- At a fixed 20x isolated margin, orders start failing above about $2,820.
- The exchange default leverage is 200x, so if setting leverage silently fails, liquidation would sit inside the stop.
- **Recommendation:**
  - Cap size by the margin actually available.
  - Assert leverage before every entry.
  - Log effective leverage.

### 3. The adaptive selector is not defined

The concept does not yet say:
- what "better" means;
- how many trades count as "recent";
- what happens before enough trades exist;
- what happens to an open trade when the choice switches.

With a small sample and a $20/$100 payoff, the choice will flip on noise. The rules belong in a "Strategy Selection Contract":
- **Metric:** net P&L after fees, over the last N simulated trades per strategy.
- **Hysteresis:** the other strategy must lead by a margin before the bot switches.
- **When:** switch only while flat or at the next signal.
- **History:** simulate on about 83 days of history at startup.
- **Simulator:** uses the exact live exit rules, and assumes the stop is hit first when one candle touches both SL and TP.
- **Zoom-out challenge:** ship a fixed `STRATEGY=hull|ut` first. Add the selector only if a backtest shows it beats both fixed choices.

### 4. No proven edge, and going live with no dry run

- The Pine backtest is the cheapest way to see whether either strategy makes money after fees. It should come before the server code.
- Without a testnet, the first run of the bracket-attach, edit and reversal code uses real money.
- **Recommendation:** a `DRY_RUN` flag (log orders without sending them) and a `MAX_CONTRACTS` cap for the first live days.

### 5. Order sequences can leave a position unprotected or doubled

The SL/TP can fire at the same moment the bot sends a close. An order without `reduce_only` would then open an unintended position. The safe reversal sequence is:

1. `reduce_only` market close.
2. Poll `GET /v2/positions` until flat; halt after about 10s.
3. Cancel leftover stop orders.
4. Re-read the balance and resize.
5. Market entry with the bracket SL/TP in the same request.
6. Read the actual fill price and move the bracket to exactly ±$20 / ±$100.
7. Verify the bracket exists.

Order IDs must be deterministic so a retry cannot double-fill.

### 6. Restart and reconciliation

The exchange is the source of truth. On boot, and every 30–60s, the bot:
- attaches a bracket to any position that has none;
- cancels stop orders that have no position;
- halts on any unexpected size or side.

Trades, intents and the halt flag go in a local SQLite file. The dashboard reads the same file.

### 7. Signal meaning and re-entry

- A "signal" is a direction flip on a closed candle: the UT `buy`/`sell` crossovers, or Hull `HULL > HULL[2]` changing.
- Same-direction signals are ignored while in a trade.
- After an SL or TP exit, the bot waits for the next flip.
- Startup does not enter on an old signal.

### 8. Pine and TypeScript must compute the same numbers

The ports must match Pine exactly:
- HMA half-length rounding (55/2);
- ATR seeding (RMA seeded with an SMA);
- the recursive UT trailing stop;
- warm-up bars.

A golden test compares the TS outputs against values exported from TradingView on the Delta ETHUSD feed. The existing Heikin-Ashi option is a no-op, so it is dropped.

### 9. Trailing edge cases

- "Profit" = candle close − actual fill price, per ETH, before fees.
- The ladder reduces to two rules:
  - close − entry ≥ 12: stop is at least entry + 2.5;
  - close − entry ≥ 25: stop = max(stop, close − 10). At exactly +25 this equals entry + 15.
- Stops round to the 0.05 tick toward safety.
- If the new stop has already been crossed when the bot sends it, the bot closes at market.
- Fee reality: +$2.5 minus about $2.6 in round-trip fees is about −$0.1, so "cost to cost" is slightly negative.

### 10. Dashboard and Express security

- The manual close goes through the same executor as automatic trades.
- Login: username and password from `.env`, with a session cookie, behind HTTPS.
- API key: trade-only, no withdrawal permission, IP-whitelisted to the VPS.
- The VPS clock must be NTP-synced, because signatures expire after 5 seconds.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * ETHUSD perpetual on Delta India, live, long and short, with reversal on an opposite signal.
  * Hull and UT Bot computed in TypeScript from Delta 1h candles, matching Pine.
  * A selector that picks a strategy by recent simulated performance, with fixed-strategy override.
  * Sizing at balance/141 ETH in 0.01 ETH steps, capped by available margin.
  * Exchange-side $20 SL / $100 TP, with 1h-close ratchet trailing.
  * Reconciliation on boot and on a timer; SQLite trade log; Telegram alerts (optional).
  * Express dashboard with password login, showing:
    * the open position;
    * the trade history, with the entry reason (strategy, signal, candle) and exit reason (SL / trailed SL stage / TP / reversal / manual);
    * per-strategy stats;
    * rule-based improvement hints, such as win rate per strategy, fee drag, stops hit right after the CTC move, losing reversals, and losses by hour.
  * Manual close and pause from the dashboard.
  * A new standalone `eth_strategy.pine`, with `bot.pine` left as it is.
  * PM2 config for a single instance.
* **Out-of-Scope Non-Goals:**
  * Other symbols or exchanges.
  * TradingView webhooks.
  * WebSocket feeds (REST polling is enough at 1h).
  * AI-written trade reviews.
  * Testnet stage (declined by the author; recorded as a risk).
  * Multi-user dashboard.

## Alternatives Weighed

* **TradingView webhook signals:** rejected by author. They need a paid plan and an external dependency, and the bot would have to recompute the indicators anyway to trail on candle closes.
* **Webhook plus internal signals:** rejected by author. It adds more moving parts for no added safety.
* **Market-regime filter (ADX/Choppiness) to choose Hull vs UT:** rejected by author in favour of adaptive selection by recent results.
* **Taking either signal (OR):** rejected by author, because it produces the most false signals.
* **Requiring both signals (AND):** rejected by author ("no need to combine both conditions").
* **Ignoring opposite signals while in a trade:** rejected by author, who wants reversal.
* **Whole-ETH sizing:** rejected by author in favour of 0.01 ETH steps.
* **Testnet first:** rejected by author, who wants to go live directly.
* **Localhost plus SSH tunnel, or a read-only public dashboard:** rejected by author in favour of a password login.
* **Claude-API trade review:** rejected by author in favour of rule-based stats.
* **Trailing from the best price since entry:** rejected by author in favour of candle close − $10.
* **Editing `bot.pine` in place:** reviewer recommendation. That file is a 1,400-line SMC indicator that repaints its alerts, so a new strategy file is cleaner.

## Key Decisions & Staging for Next Steps

**Decided:**
* Signals are computed in Node from Delta candles on closed 1h bars.
* SL/TP levels are ETH price moves.
* Trailing uses candle close − $10 and never loosens.
* Strategy choice is adaptive by recent results.
* Long and short, with reversal on an opposite signal.
* Fractional sizing at 0.01 ETH.
* Live directly.
* PM2 on a VPS.
* Dashboard with rule-based improvement stats and a password login.

**Resolved in iteration 2:**
1. **Sizing and circuit breaker (author):**
   * Keep balance/141 sizing, capped by available margin.
   * After **3 consecutive full $20 stop-loss hits**, the bot halts trading. A full hit means the initial stop fired before any trailing moved it.
   * While halted, the server keeps running so the dashboard can show why. No new trades are opened until the author presses Resume, or sets `HALTED=false` and restarts.
   * A trade closed in profit resets the counter. A reversal or trailed-stop exit neither counts toward it nor resets it.
2. **Adaptive selector (decided by Claude, at the author's request):**
   * Score = net P&L after fees over each strategy's last **10** simulated trades, using the exact live exit rules.
   * The bot switches only when the other strategy leads by at least **$20** (one stop's worth).
   * Switches happen only while flat, or when the next signal arrives.
   * At startup it simulates the last 2000 hourly candles (about 83 days) to fill history.
   * Before either strategy has 10 trades, it uses Hull.
   * `STRATEGY=adaptive|hull|ut` overrides the choice; the default is `adaptive`.
   * The dashboard shows both scores and the reason for each switch.
3. **Stop trigger (Claude):** `last_traded_price`, which matches the candles that the signals, simulator and Pine use.
4. **+$2.5 step (Claude):** kept as specified. It is a config value, and the dashboard shows that it nets about −$0.10 after fees.
5. **Safety flags (Claude):** both flags exist and are off by default, so the bot goes live as the author wants.
   * `DRY_RUN=true` runs on live prices but only logs the orders it would have placed.
   * `MAX_CONTRACTS` limits size.

**To verify during the draft:**
* whether `PUT /v2/orders/bracket` edits in place;
* whether brackets cancel automatically when the position goes flat or flips;
* the HMA half-length under Pine v6;
* the settlement asset and balance field on Delta India.
