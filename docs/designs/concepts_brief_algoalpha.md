# AlgoAlpha Break Strategy for the ETH Bot

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-14

(The previous brief in this file, for the NIFTY options bot, is kept at `docs/designs/concepts_brief_nifty_options.md`.)

## Overview

The ETH bot trades the ETHUSD perpetual on Delta Exchange India with real money. Today it runs one strategy, Hull, picked by a setting in `.env` that is read once at start-up. This change adds a second tradable strategy, "AlgoAlpha break", and a dashboard control to choose between Hull and AlgoAlpha.

AlgoAlpha break is a copy of the TradingView indicator "Zero Lag Liquidity [AlgoAlpha]" on 1-hour candles:

- When a 1-hour candle has an unusually large wick on high volume, the indicator marks a price level. The level is the price where most trading happened inside that wick, measured from the 3-minute candles inside the hour.
- When price closes beyond a level for two candles in a row, that is a "break".
- The strategy buys on a bullish break and sells on a bearish break. It exits on the opposite break (and reverses if entries are allowed) or on a stop-loss 3 × ATR(14) away, placed on Delta. There is no break-even move and no trailing stop.

The copy has been checked against the author's TradingView chart. All nine breaks between 29 Oct and 13 Nov 2026 appear at the same hour (IST), and there are no extra breaks on either side.

**Backtest, per 1 ETH, fixed size, after fees and slippage, Feb 2024 to Nov 2026:**

| | AlgoAlpha break (3×ATR stop) | Hull (live today) |
|---|---|---|
| Net profit | +$3459 | +$2117 |
| …of which last 12 months | +$682 | +$518 |
| Largest fall from peak | $1259 | $310 |
| Win rate | 34% | 58% |

The two columns use different exits (Hull has its own 2×ATR stop, break-even and trailing stop), so the comparison is per strategy as each would run, not exit for exit.

## Analysis

Six independent reviewers read the proposal and the code. They agree it is not ready to build until the points below are decided. Most severe first.

### 1. 20% risk per trade, compounded, loses most of the account

The backtest above traded a fixed 1 ETH. With the bot's sizing, every trade risks a fixed share of the current balance, so losses compound. A simulation of the actual trade sequence (223 trades) and 20,000 random one-year samples gives:

| Risk per trade | Real sequence Feb 2024 → now (start = 1.00) | Worst fall from peak | Chance of falling below 50% of start within a year | …below 20% | Typical balance after a year |
|---|---|---|---|---|---|
| 20% | 0.18 | 99% | 81% | 58% | 0.66 |
| 10% | 5.95 | 75% | 44% | 12% | 2.35 |
| 5% | 5.99 | 46% | 12% | 0% | 2.19 |
| 2% | 2.72 | 22% | 0% | 0% | 1.53 |

The strategy wins 34% of trades, and losing runs of 9 to 11 in a row happened in the backtest. At 20%, eleven losses in a row leave 0.8¹¹ ≈ 9% of the balance. The average trade earns only 0.28 × the amount risked, so the winners never rebuild what the losing runs take. 5% risk ends with the most money (5.99× start), with a 46% worst fall. 10% ends at the same place with a 75% fall.

The fixed-1-ETH figures also flatter the result:
- Live stop orders fill worse than the stop price on fast moves.
- Funding costs are not included.
- The 3×ATR / no-trailing exit was chosen after trying many variants on the same data.

### 2. The bot's existing safety rules would change or block the strategy

These rules apply to every strategy today. With them, the live bot would not trade what was tested:

- **$40 stop cap (SL_MAX).** A 3×ATR stop is wider than $40 whenever ATR is above about $13, which is most of the time, so most entries would be refused.
- **Liquidation check.** It assumes the set leverage and refuses wide stops.
- **Minimum ATR ($15).** Entries are blocked in quiet markets; the tested version had no minimum.
- **Loss-streak halt (breaker).** The bot halts after 3 stop-loss exits in a row and needs a manual resume. With no break-even or trailing stop, every losing stop-out counts, so this would halt the bot regularly.
- **Risk throttle.** Risk drops from 20% to 5% once the balance is 20% below its peak. With 20% risk this switches on after a single loss.
- **Same exits for every trade.** Break-even and trailing are applied to every open trade, which would give AlgoAlpha trades exits that were not tested.

Each strategy needs its own set of exits, entry checks and sizing, chosen when the trade opens and stored with the trade, so a later switch cannot change them.

### 3. Leverage, auto top-up and position size need exact rules

- **Leverage per trade.** Delta allows a leverage change only while flat, and the bot currently refuses any entry if Delta's leverage differs from the one setting. Setting "the lowest leverage that fits" per trade means changing leverage before each entry and restoring it for Hull.
- **Reversals.** A reversal becomes close → set leverage → check → open. If the bot stops between those steps, it is flat and the signal is gone.
- **Leverage doesn't change fees.** Delta's fees are charged on the position size, not on leverage. Low leverage only reduces how much margin is locked.
- **Auto top-up is unbuilt.** The bot has no auto top-up support yet. The Delta API call to switch it on and read it back must be tested on the real account before building. Top-up can also let a loss go past the planned stop amount if the stop fills badly.
- **A ceiling is still needed.** Without a minimum ATR, a very small ATR gives a very tight stop and a very large position (for example ATR $5 → stop $15 → about 30× the balance). The size should have a ceiling, for example position value ≤ 10× balance, even with no fixed ETH limit.
- **Order size errors.** Delta's maximum order size isn't read by the bot today. A rejected order is currently treated as a fatal error and halts the whole bot.
- **Which balance.** Delta's "available balance" excludes margin in use and open profit or loss. The sizing and the 50% alert should use equity (wallet plus open profit or loss).

### 4. "Retry until the 3-minute candles arrive" can freeze the bot

The bot runs one cycle per hour and waits for each cycle to finish before starting the next. An endless wait would stop every later cycle, including exits and Hull. A break is a one-candle event: if it is acted on late, the entry fills at a stale price; if it is missed, it is gone.

The retry needs:
- a time limit, such as 15 minutes, with alerts at the start and at the time limit;
- a rule for what counts as complete (for example 20 of 20 three-minute candles, or 18 of 20);
- for an entry: skip it after the time limit and record why;
- for an exit: decide what happens if the opposite break can't be confirmed. The stop on Delta still protects the trade either way.

### 5. Levels must be remembered across restarts

The indicator keeps every unbroken level (up to 500) since the start of the data. The live bot only looks back about 83 days, so after a restart it would forget older levels and produce different breaks from TradingView.

The bot needs one of two fixes:
- store the levels in its database;
- or store the 3-minute candles and rebuild the levels from a fixed starting date.

A test must prove that live and backtest produce the same breaks.

### 6. The open stop-update bug matters more here

After each fill the bot tries to move the exchange stop to the price computed from the actual fill, and that call fails ("id is required"). The stop stays where it was computed from the price before the order. With 20% sizing, the real loss at the stop can then differ from the plan. Fix it before AlgoAlpha goes live, and check the stop distance after every entry.

### 7. The dashboard switch needs its own path

- Today the strategy can't be changed without a restart, and the existing settings path stops the bot until restart.
- The switch should be stored as a pending choice, survive restarts, and apply when the bot is flat. It applies after a manual close or a stop-out.
- The dashboard shows "active: Hull, pending: AlgoAlpha (applies after the trade closes)", with a cancel button.
- After a switch is applied, the new strategy waits for its own next signal; it does not jump in on the current state.
- Several reports and statistics only know "hull" and "ut" and would silently drop AlgoAlpha trades.

### 8. The 50% alert needs a deposit figure

The bot does not know how much has been deposited. The author enters the deposited total on the dashboard and updates it on deposits or withdrawals. The alert fires once when equity crosses below 50% of it, and again when it recovers.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  * AlgoAlpha break as a selectable strategy, identical to the backtested rule: enter on a break, exit on the opposite break or a 3×ATR stop on Delta, no break-even, no trailing stop, no weekend entries.
  * Dashboard choice between Hull and AlgoAlpha, applied only when no trade is open.
  * Each trade keeps the exits, checks and sizing of the strategy that opened it.
  * Risk-based sizing (option A), a position ceiling, lowest leverage that fits, Delta auto top-up on and checked.
  * A time-limited retry for 3-minute data, and stored indicator levels.
  * A Telegram alert when equity falls below 50% of the deposited total.
  * The stop-update bug fixed.
* **Out-of-Scope Non-Goals:**
  * Automatic pausing on losses (the author pauses manually).
  * Trailing stop or break-even for AlgoAlpha.
  * AlgoAlpha inside the "adaptive" mode that switches strategies on its own.
  * AlgoAlpha's rejection signals.
  * NIFTY/BANKNIFTY (index candles have no volume; needs a separate decision on data source).

## Alternatives Weighed

* **UT Bot (1, 10), exit on opposite signal:** lost $1129 per ETH over the last year. Rejected.
* **UT sniper (4h UT + 10-bar breakout):** profitable (+$935 since Feb 2024) but behind Hull. Rejected by author in favour of AlgoAlpha.
* **UT + AlgoAlpha combinations:** near break-even or inconsistent between periods. Rejected.
* **Trailing stop / break-even on AlgoAlpha:** 27 variants; none beat the plain version on profit in both periods. Rejected by author (keep what was tested).
* **Pause after 2 losing trades:** cut profit and often raised the drawdown. Rejected.
* **100× leverage without top-up:** liquidation about 0.5% away, long before the stop. Replaced by lowest leverage plus auto top-up.
* **Option B sizing (fixed size, limit entry nearer the stop):** skips wide-stop trades, which include the big winners. Rejected by author.
* **Paper period before real orders:** declined by author. Partly offset by the TradingView check passing.

## Key Decisions & Staging for Next Steps

Decided by the author:
- AlgoAlpha break with 3×ATR stop, exit on opposite break, no trailing, no break-even.
- Hull stays; switching from the dashboard applies after the current trade closes, including a manual close.
- Sizing option A: the loss at the stop is a fixed share of the balance.
- Lowest leverage that fits, with Delta auto top-up on.
- Retry for missing 3-minute data.
- Manual pause when the balance is below 50% of the deposited total.
- Real orders straight away.

Open, needed before the design draft:
1. Risk per trade, given section 1 (20% loses most of the account in the simulation; 5% ends highest with a 46% worst fall).
2. For AlgoAlpha: keep or switch off the loss-streak halt and the 20%→5% risk throttle.
3. The position ceiling (for example position value ≤ 10× balance).
4. The 3-minute data time limit and what counts as complete.
5. Confirm: entering the deposited total on the dashboard is how the 50% line is set.
