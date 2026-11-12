# NIFTY Options Bot on Angel One

*   **Author:** Shakil Dodhiya
*   **Status:** Proposed
*   **Date:** 2026-11-12

--------------------------------------------------------------------------------

## Overview

A second trading bot, separate from the live ETH bot, buys NIFTY index options
through Angel One's official API (SmartAPI). It runs intraday only:

*   It buys a call (CE) when its signal on the NIFTY index turns bullish.
*   It buys a put (PE) when the signal turns bearish.
*   It never sells options to open a position.
*   It never holds a position overnight.

Exits are set as a percentage of the option premium paid:

*   stop-loss at −30%;
*   stop moved to cost at +30%;
*   target at +60%;
*   between +30% and the target, a trailing stop that tightens every 5 minutes.

The bot runs on the same EC2 server as the ETH bot. It is a separate project
folder, process, database, port and set of keys, so a fault or a deploy in one
bot cannot stop or trade the other.

The work happens in stages. A research script runs first and must show that the
signal makes money after time decay and charges. Only then is the bot built.
Only after that does it trade, at 1 lot and on NIFTY alone. BANKNIFTY and the
expiry-day straddle come later, each behind its own evidence gate.

## The Problem

The owner has under ₹25,000 for Indian markets and wants an automated bot like
the ETH bot, but on NIFTY and BANKNIFTY. With this capital, index options are
the only NSE instrument with leverage. That is a constraint, not evidence that
money can be made.

Buying options is harder than trading the ETH perpetual, for five reasons.

1.  **Time decay.** A bought option loses value every hour it is held. The
    loss is fastest near expiry. The signal must make enough to cover it.
2.  **Costs.** These are high relative to a ₹25,000 account:
    *   brokerage of ₹20 per order;
    *   STT, exchange fees, stamp duty and GST;
    *   the bid–ask spread.
    Together they can be 1–2% of capital per trade.
3.  **Weaker stops.** NSE does not allow stop-market (SL-M) orders on index
    options. A stop-limit order can trigger and then not fill in a fast move.
    So the bot must watch prices itself and exit on its own. The order resting
    at the exchange is only a backup.
4.  **No exact backtest.** Angel One has no price history for expired option
    contracts. Option prices in research are modelled from NIFTY candles and
    India VIX, so research results are estimates, not replays.
5.  **New broker, no test exchange.** Angel One has no testnet. The first order
    uses real money, and you chose to go live without a paper period.

The proposed solution addresses each of these:

*   Research first, with a pass/fail gate that includes costs and time decay.
*   Exits based on the option premium.
*   The bot's own price watch as the main stop. A stop-limit order and Angel's
    3:15 PM intraday square-off are the backups.
*   Strict loss limits.
*   A recorder that saves real option quotes from day one, so the model can be
    checked against reality.

## Goals

*   **G1 (Research gate):** find out cheaply whether a NIFTY intraday
    option-buying signal on 5- or 15-minute index candles makes money after all
    costs, using these exit rules. Gate 1 passes only if all of these hold:
    *   at least 100 trades;
    *   profitable on data the strategy was not tuned on;
    *   still profitable with costs doubled;
    *   no single month makes up most of the profit;
    *   the worst fall from peak stays well inside the 50% halt.
    If Gate 1 fails, the project stops after research.
*   **G2 (Isolation):** the options bot cannot affect the live ETH bot. It has
    its own folder, database, port, PM2 app, cookie, keys and memory limit.
*   **G3 (Trading rules):**
    *   Buy NIFTY CE on a bullish signal and PE on a bearish signal.
    *   Hold at most one position.
    *   No new entries before 09:20 or after 14:45 IST.
    *   All positions closed by 15:12 IST.
*   **G4 (Exits, in premium %):**
    *   Stop at −30% of the entry premium.
    *   At +30% (1:1), move the stop to cost: entry price plus charges.
    *   Then trail the stop 25% of the entry premium below the current price.
    *   Every 5 minutes, raise the stop and tighten the gap if the price has
        moved our way. The stop never moves down.
    *   Target exit at +60%.
    *   The research may adjust these numbers within the same rule shape.
*   **G5 (Strike and expiry by a fixed rule):**
    *   Strike: ATM or one strike in the money, about 0.55 delta. Skip contracts
        with wide spreads or low open interest.
    *   Expiry: the nearest weekly with at least one trading day left. On expiry
        day the bot does not use the contract that expires that day.
*   **G6 (Risk):**
    *   Risk 10% of capital per trade, 1 lot maximum.
    *   Premium paid at most 40% of capital.
    *   One losing trade, net of charges, stops trading for the day. A small
        loss within a stated rupee band counts as break-even.
    *   A 50% fall from peak halts the bot until you resume it manually.
    *   A ₹5,000 total loss floor halts it permanently until you review.
*   **G7 (Real-data check):** record real NIFTY option quotes from the first
    day the bot runs. Compare live fills with the research model. If fills are
    much worse than modelled, stop new entries.
*   **G8 (Operation):**
    *   Angel One keys entered from the dashboard and stored encrypted.
    *   Automatic daily login with TOTP.
    *   A health check that knows market hours.
    *   Alerts for login failures, missed exits and halts.

## Non-Goals

*   **20% a week as a target or a sizing rule.** Compounded, that is about
    13,000× a year. It does not drive any setting.
*   **Selling options, short straddles or spreads.** Selling needs ₹1–2 lakh
    margin per lot and you chose buying only.
*   **Overnight or multi-day holding.**
*   **BANKNIFTY in the first live version.** It has only monthly expiries, one
    ATM lot can cost most of the capital, and it moves closely with NIFTY. It is
    added at stage L2.
*   **The expiry-day straddle in the first live version.** It is designed but
    off. It is enabled only after real recorded quotes from at least 20 expiries
    show a profit after doubled charges.
*   **Changing the live ETH bot.** Generic parts are copied into the new
    project, not shared. The ETH bot's code and server setup stay as they are.
*   **A strike or expiry optimiser.** On modelled prices it would fit the
    model's errors.
*   **Running research or backtests on the production server.**

## Open Questions

These need written answers from Angel One, NSE or SEBI before the build starts
(stage B). They do not block the research stage.

*   **Q1 (Static IP and algo rules):**
    *   Does Angel One accept an AWS Elastic IP for SmartAPI static-IP
        registration?
    *   Is an algo ID or order tag required, and how long can the tag be?
    *   What is the order-rate limit?
    *   Do data APIs also need the registered IP?
*   **Q2 (Order types):**
    *   Is STOPLOSS_LIMIT available for NFO index options?
    *   How does Angel's market-order price protection work?
    *   What are the price-band limits?
*   **Q3 (Session):**
    *   How long does a session token last?
    *   What are the login rate limit and lockout rules?
    *   At what exact time is the intraday (MIS) square-off, and what does it
        cost?
*   **Q4 (Contract facts):**
    *   Current NIFTY lot size (reported as 65; verify).
    *   Freeze quantity and strike step.
    *   Expiry weekday (reported as Tuesday; verify).
    *   Where to get the holiday calendar.
*   **Q5 (Charges):** current brokerage plan, STT rate on option sales, exchange
    transaction charge.
*   **Q6 (Break-even band):** the rupee band below which a loss counts as
    break-even. The proposal is charges plus 2 ticks × lot size; the research
    report will give the number.
*   **Q7 (Required headers):** does Angel validate `X-ClientPublicIP` and
    `X-MACAddress` against the registered static IP, or only the connection's
    real source IP?

## Critical User Journeys (CUJs)

All times are IST.

### CUJ 1: Normal winning trade

*   **Given:**
    *   The bot is live and logged in, and the session is ACTIVE.
    *   No position is open, and it is 11:00 on a Wednesday.
    *   The research-approved Hull signal is running on NIFTY 15-minute candles.
*   **When:** the 11:00 candle closes and the Hull signal turns bullish.
*   **Then:**
    1.  The bot picks the strike: the nearest-weekly NIFTY CE closest to 0.55
        delta that passes the spread and open-interest filters.
    2.  It checks sizing. One lot fits only if both hold:
        *   a −30% stop loses ≤ 10% of capital;
        *   the premium paid is ≤ 40% of capital.
    3.  It buys 1 lot with a limit order at the ask, tagged with a unique order
        tag.
    4.  When the order fills, it places a resting SL-limit order at
        entry × 0.70.
    5.  The price reaches entry × 1.30. The bot moves the stop to cost (entry
        plus charges per unit), then starts trailing. It modifies the resting
        order rather than placing a new one.
    6.  Every 5 minutes, if the price made a new high, the stop and gap
        tighten.
    7.  At entry × 1.60 the bot exits at the target. First it modifies the
        resting order, then it sells the held quantity.
    8.  The trade is recorded with its net P&L, charges and exit reason
        `target`.

### CUJ 2: Losing trade ends the day

*   **Given:** a CE position is open, and the stop is at entry × 0.70.
*   **When:** the premium falls through the stop.
*   **Then:**
    1.  The bot's price watch sees the stop crossed and exits. It modifies the
        resting order into a marketable limit order.
    2.  The trade closes with net P&L below the break-even band, so it counts
        as a loss.
    3.  The daily-stop halt (kind `daily_loss`) is set. No more entries today.
    4.  The halt clears by itself at the next trading day's pre-open.
    5.  If the same exit is within the band, it counts as break-even and
        trading continues.

### CUJ 3: Stop-limit skipped in a fast fall

*   **Given:** a position is open, and the premium gaps through both the
    trigger and the limit price of the resting SL-limit order.
*   **When:** the order triggers but does not fill.
*   **Then:**
    1.  After 3 seconds of price below the stop with the position still open,
        the bot modifies the same order to a limit at best bid − 2 ticks.
    2.  It repeats every 2 seconds, up to 5 times.
    3.  If the position is still open after that, it sets a fatal halt and
        sends a critical alert. Angel's intraday square-off is the last resort.
    4.  At no point does the bot place a second sell order beside the resting
        one.

### CUJ 4: Login fails in the morning

*   **Given:** the bot is flat, and it is 08:50 on a trading day.
*   **When:** the TOTP login fails, for example because the clock drifted or
    Angel is down.
*   **Then:**
    1.  The bot retries with increasing delays, staying under Angel's lockout
        limit.
    2.  It alerts `login_failed_flat`.
    3.  If it is still not logged in by 09:30, it takes no trades that day.
        /health reports this state, not "ok".

### CUJ 5: Session lost while a position is open

*   **Given:** a position is open, and the resting SL-limit order is at Angel.
*   **When:** API calls start returning auth errors (session expired or
    invalidated).
*   **Then:**
    1.  The bot re-logs in at once, up to 3 attempts.
    2.  It sends a critical alert `session_invalid_with_position`.
    3.  The resting SL-limit order and Angel's square-off still protect the
        position.
    4.  When the session returns, the reconciler reads the position and orders
        before doing anything else.

### CUJ 6: Forced exit at the end of the day

*   **Given:** a position is still open at 15:05.
*   **When:** the clock reaches 15:05.
*   **Then:**
    1.  The bot exits with a limit order at the bid.
    2.  It re-prices every 30 seconds until 15:12.
    3.  At 15:13, if the position is still open, it sends a critical alert, and
        Angel's square-off at about 15:15–15:25 closes it.
    4.  The exit reason is `time_exit`, or `broker_squareoff` if Angel closed
        it.

### CUJ 7: Owner's manual trade on the same account

*   **Given:** the owner buys a NIFTY option by hand in the Angel app.
*   **When:** the reconciler runs.
*   **Then:**
    1.  The order has no bot order tag, so the bot does not adopt it, modify it
        or cancel it.
    2.  It alerts "unknown NIFTY option position" and blocks new bot entries
        until that position is closed. Two positions would break the
        one-position and risk rules.

### CUJ 8: Large losses

*   **Given:** the account has lost money over several days.
*   **When:** either of these happens:
    *   equity, measured from the bot's own trade ledger, falls 50% below its
        peak;
    *   the total realised loss reaches ₹5,000.
*   **Then:** the bot sets a halt that only a manual Resume clears, and sends a
    critical alert.

### CUJ 9: Live fills worse than the research model

*   **Given:** the first live trades have run.
*   **When:** the average entry-plus-exit slippage over the last 5 trades is
    more than 2× what the research model assumed.
*   **Then:** the bot stops new entries (`model_drift` halt) and alerts. The
    owner reviews the recorded quotes before resuming.

## Technical Plan (Architecture)

### Stages

| Stage | What runs | Entry condition | Rollback |
| --- | --- | --- | --- |
| R (Research) | Scripts on the Mac only | Angel keys available (the candle API needs a login) | Gate 1 fails: stop the project |
| B (Build) | Bot in paper mode plus quote recorder on the server; you chose no required paper period | Gate 1 passed, Open Questions Q1–Q5 answered | — |
| L1 (Live) | NIFTY, 1 lot, straddle off; first 10 trades are the canary | B deployed, smoke test passed | Any CUJ 8 or CUJ 9 halt |
| L2 | Add BANKNIFTY (monthly) | 30 live NIFTY trades, net positive, no `model_drift` halt | Disable from dashboard |
| L3 | Straddle on NIFTY expiry day | ≥20 recorded expiries show a profit after doubled charges | Setting off |

### Layout and isolation from the ETH bot

The bot is a new project folder, `~/Desktop/tradingbot-nifty` on the Mac and
`~/tradingbot-nifty` on the server, with its own:

*   `package.json` and `.env`;
*   `DATA_DIR` and database `nifty.db`;
*   `SECRETS_KEY`, `SESSION_SECRET` and `CTL_TOKEN`;
*   port 3001;
*   cookie name `niftybot`;
*   PM2 app `nifty-bot`, with a 250 MB memory limit;
*   Caddy site `nifty.3.108.203.12.sslip.io`;
*   Telegram prefix `[nifty-bot]`.

At boot the bot writes `kv.bot_id = "nifty"` and refuses to start if the
database already holds another id. Deploy commands always name the app; never
`pm2 restart all`. The server is upgraded from t3.micro to t3.small before
stage B.

The following generic files are **copied** from the ETH bot, not shared. Each
copy gets the bot's names as parameters:

*   `src/engine/lock.ts`, `mutex.ts`, `halt.ts`, `bootGuard.ts`;
*   `src/store/db.ts`, the `migrate()` runner, `backup.ts`, the kv helpers;
*   `src/api/auth.ts`, `server.ts`;
*   `src/log.ts`;
*   `src/notify/telegram.ts`;
*   the AES-GCM pattern from `src/store/secrets.ts`;
*   the `Scheduler` class;
*   the Hull indicator from `src/core/indicators`;
*   the React shell.

All other code is new.

```text
                 ┌────────────────────── nifty-bot (PM2, port 3001) ───────────────────────┐
 Angel SmartAPI  │                                                                         │
  REST  ◄────────┤ angel/ (own REST+WS) ◄ broker port ┬── executor (orders, exit races)    │
  WebSocket ─────┤   rest, ws, tickParser, totp       ├── priceWatch (ticks → stop/target) │
  Instrument     │ instruments.ts (daily master)      ├── reconciler (tagged orders only)  │
  master JSON ───┤ session.ts (login state machine)   └── quoteRecorder (1-min snapshots)  │
                 │ calendar.ts (IST windows, expiries, holidays)                           │
                 │ cycle.ts (candle close → Hull → gates → strike/expiry → size → enter)   │
                 │ core/: premiumExit, strikeSelect, expirySelect, lotsFor, charges, risk  │
                 │ store/: nifty.db (trades, legs, decisions, daily_state, quotes, kv)     │
                 │ api/ + web/: dashboard (Overview, Trades, Decisions, Settings)          │
                 └─────────────────────────────────────────────────────────────────────────┘
 ETH bot (eth-bot, port 3000, own folder and DB) is not touched. Caddy routes the two sites separately.
```

### Research (stage R)

A script, `research/phase0.ts`, runs on the Mac. Its report is saved as
`docs/research/phase0.md`.

*   **Data:** NIFTY spot and India VIX candles at 5 and 15 minutes, from
    Angel's historical candle API. It covers as many years as the API allows,
    fetched in chunks within its rate limit.
*   **Signal:** Hull on index closes, a small grid of lengths (for example 21,
    34, 55) on both candle sizes. Entries only 09:20–14:45. UT is not tested,
    as you asked.
*   **Premium model:** Black-Scholes. The option's implied volatility is India
    VIX × a factor per days-to-expiry bucket, with a pessimistic bias: entry IV
    marked up, exit IV marked down. Rules:
    *   strikes on the 50-point grid;
    *   fills at the modelled mid ± half a modelled spread;
    *   itemised charges.
*   **Exits:** the exact `premiumExit` function the bot uses, run on modelled
    premiums from 1-minute index candles if Angel provides enough history,
    otherwise 5-minute.
*   **Output:**
    *   trade count, win rate, net P&L and worst fall from peak;
    *   results by month;
    *   in-sample and out-of-sample split;
    *   a 2× cost run;
    *   the share of signals skipped because one lot was too expensive. At
        ₹25,000 with 10% risk, a −30% stop on one 65-unit lot allows an entry
        premium of about ₹125 at most.
*   **Gate 1** is decided from this report (see G1).

### Signal and trading cycle

The `Scheduler` runs on NIFTY candle closes, at the research-chosen interval,
5 seconds after each close, only inside market hours from `calendar.ts`. Each
cycle:

1.  **Skip checks.** Skip and log a reason when any of these holds:
    *   halted;
    *   session not ACTIVE;
    *   instrument master stale;
    *   outside 09:20–14:45;
    *   a position is open (the opposite signal only exits);
    *   the daily stop is set.
2.  **Signal.** Compute Hull on index candles. Warm-up history comes from
    previous sessions, so the first candles of the day have a value.
3.  **Contract.** On a new bullish or bearish signal, choose expiry, then
    strike, then size. Each step can skip with a logged reason:
    *   `NO_CONTRACT`;
    *   `SPREAD_TOO_WIDE`;
    *   `UNAFFORDABLE`;
    *   `SIZE_TOO_SMALL`.
4.  **Enter.** Place the entry with the executor.
5.  **Record** a decision row keyed by `(underlying, candle_time)`.

An opposite signal while a position is open exits the position. It does not
reverse. A new entry waits for the next candle, so two orders on the same token
never race.

### Expiry and strike rules

These are in `core/expirySelect.ts` and `core/strikeSelect.ts`. Both are pure
functions with table-driven tests.

*   **Expiry:**
    *   Use the nearest NIFTY weekly expiry from the master that has at least
        one full trading day left.
    *   From 13:00 on the trading day before expiry, and all of expiry day,
        use the next weekly.
    *   Expiry dates come from the master, never from date arithmetic, so
        holidays that move the expiry are handled.
    *   For BANKNIFTY at L2: the nearest monthly, rolling to the next month
        when 3 or fewer trading days are left.
*   **Strike:**
    *   Candidates are ATM, 1 strike in the money and 1 out of the money on the
        50-point grid.
    *   For each, compute delta from the option's mid-price IV.
    *   Choose the one closest to 0.55 that passes all filters:
        *   spread ≤ 2% of mid;
        *   open interest ≥ the configured minimum;
        *   premium × lot ≤ 40% of capital.
    *   If none passes, skip.
    *   The research compares only "ATM" against "about 0.55 delta" and freezes
        the winner.

### Exit rules (premium-based)

These are in `core/premiumExit.ts`, a pure function. It takes the position
state, the latest price and the time, and returns either "hold", "move stop to
X" or "exit with reason". `E` is the entry premium per unit. All prices are
rounded to the 0.05 tick.

| Stage | Starts when | Stop | Other exits |
| --- | --- | --- | --- |
| INITIAL | Fill | E × 0.70 | Target E × 1.60; opposite signal; 15:05 time exit |
| COST | Price ≥ E × 1.30 (1:1) | E + charges per unit (both sides, so a stop-out nets about zero) | same |
| TRAIL | Same moment as COST | max(current stop, high since entry − gap). The gap starts at E × 0.25. At each 5-minute check where the price set a new high, the gap shrinks by E × 0.025, down to E × 0.10. | same |

*   The stop never moves down.
*   **Every tick:** stop and target are checked on each WebSocket tick, or
    each REST poll if ticks are stale for more than 5 seconds.
*   **Every 5 minutes:** the trail and gap update runs, on IST wall-clock
    boundaries.
*   When the stop changes, the resting SL-limit order is **modified**:
    *   trigger at the new stop;
    *   limit at trigger − max(2 ticks, 3% of trigger).
*   The research may change 0.70, 1.30, 1.60, 0.25, 0.025 and 0.10. The stage
    order stays as it is.

### Executor and exit races

NSE has no "reduce only" flag. These rules stop the bot from ever selling more
than it holds:

1.  Only one exit action at a time per position. This uses the outbox states
    OPENING → OPEN → CLOSING → CLOSED.
2.  Every exit first modifies the resting SL-limit order. The bot never
    cancels it and then places a new one.
3.  Before any sell, the executor reads the net quantity for that token and
    sells at most that.
4.  The broker port allows only BUY to open and SELL up to the held quantity.
5.  A negative net quantity on any token causes a fatal halt and a critical
    alert.
6.  Every order carries a unique `ordertag`. After a timeout, the executor
    searches the order book by tag before retrying, so it never doubles an
    order.
7.  Client-side order limits: at most 2 orders per second and 40 per day.
    Reaching either halts the bot.

### Sizing, charges and risk

*   **`core/charges.ts`** is the itemised calculator. It is used by the
    research, the paper broker, live P&L and the daily-stop test. Its rates are
    settings in `.env`:
    *   brokerage ₹20 per order;
    *   STT on the sell premium;
    *   exchange fee, SEBI fee, stamp duty on buys, GST.
    After the first live trades, its result is checked against Angel's
    contract notes.
*   **`core/lotsFor.ts`:**
    *   one lot if (lot × E × 0.30 + round-trip charges) ≤ 10% of capital and
        lot × E ≤ 40% of capital;
    *   otherwise 0, logged as `UNAFFORDABLE`;
    *   never more than 1 lot while `MAX_LOTS=1`.
*   **Capital and peak** come from the bot's own ledger: the starting capital
    you enter, plus net realised P&L. Angel's available funds are not used,
    because T+1 settlement and margin blocks distort them.

| Rule | Trigger | Effect | Clears |
| --- | --- | --- | --- |
| Daily stop | One trade with net P&L < −(charges + 2 ticks × lot) | `daily_loss` halt; no entries | Automatically at next trading day 09:00 |
| Break-even | Net P&L inside that band | Counts as neither win nor loss | — |
| Drawdown | Ledger equity < 50% of ledger peak | `drawdown_50` halt | Manual Resume |
| Loss floor | Total realised loss ≥ ₹5,000 | `loss_floor` halt | Manual Resume after review |
| Model drift | Average slippage over last 5 trades > 2× model | `model_drift` halt | Manual Resume |
| Canary | First 10 live trades | Lots forced to 1 (same as `MAX_LOTS` now) | After 10 trades |

**Worked example:** 10% risk with one loss a day means the worst day loses
about 10% plus slippage. Four losing days in a row leave about 0.9⁴ ≈ 66% of
capital. The ₹5,000 floor (20% of ₹25,000) triggers first, after about 2–3
losing days.

### Angel One adapter

The bot has its own SmartAPI client. It does not use the official
`smartapi-javascript` SDK, which was last released in September 2024 and
depends on axios 0.20, test tools at runtime and an outside IP lookup. The SDK
source and Angel's API documentation serve only as references for endpoints,
headers and the WebSocket V2 binary format. Everything outside `src/angel/` uses
the broker port interface.

The client is built like the ETH bot's Delta client:

*   **`src/angel/rest.ts`:** typed calls using Node's `fetch`, with Angel's
    required headers:
    *   `X-PrivateKey` (API key);
    *   `X-ClientLocalIP` and `X-ClientPublicIP`, taken from `.env`
        `PUBLIC_IP` (the Elastic IP), with no outside lookup;
    *   `X-MACAddress`;
    *   `X-UserType`, `X-SourceID`;
    *   `Authorization: Bearer <jwt>`.

    Endpoints:
    *   login by password (client code, PIN, TOTP);
    *   token refresh and logout;
    *   profile and RMS funds;
    *   place, modify and cancel order;
    *   order book;
    *   trade book;
    *   positions;
    *   LTP and market-data quote;
    *   historical candles.

    Every call has a timeout and a token bucket per endpoint (the candle API is
    the tightest). Errors map to retryable, fatal or unknown, using Angel's
    error codes. Requests and responses are logged with secrets removed: PIN,
    TOTP secret, JWT, refresh and feed tokens, and the API key.
*   **`src/angel/ws.ts`:** a WebSocket V2 connection using the `ws` package.
    *   It sends the subscribe and unsubscribe messages and the heartbeat ping.
    *   It reconnects with backoff and re-subscribes.
    *   **`src/angel/tickParser.ts`** is a pure function that decodes the
        little-endian binary tick frames: LTP, quote and snap-quote modes,
        prices in paise. It is tested against frames recorded from the live
        feed in stage B and against the field layout in Angel's documentation.
        If parsing fails or a value is out of range, the frame is dropped and
        counted, and too many drops mark the feed stale. The price watch then
        falls back to REST polling (see Price watch).
*   **`src/angel/totp.ts`:** RFC 6238 TOTP (SHA-1, 6 digits, 30 seconds) using
    Node's `crypto`, tested against the RFC test vectors.

The only new runtime dependency is `ws` (the ETH bot does not use it; it is a small, widely used package with no dependencies of its own).

A **contract test script**, `scripts/angelContract.ts`, runs read-only calls
against the real account before go-live and after any API change:

*   login;
*   profile;
*   funds;
*   instrument master;
*   one quote;
*   one candle request;
*   30 seconds of ticks.

**`instruments.ts`:**

*   Downloads Angel's instrument master daily at 08:35.
*   Stream-parses it and keeps only NFO OPTIDX rows for NIFTY (and BANKNIFTY at
    L2), for the next 3 expiries.
*   Fails closed: no entries if the master is older than today or fails field
    checks.
*   Lot size, tick, strike encoding and expiry are always read from it, never
    hard-coded.

**`session.ts`** is a state machine: LOGGED_OUT → LOGGING_IN → ACTIVE →
EXPIRED/FAILED.

*   Login runs at 08:50 with a TOTP generated from the stored secret.
*   It refreshes before expiry.
*   Behaviour on failure is as in CUJ 4 and CUJ 5.
*   It checks clock sync (chrony) before login, since TOTP depends on an
    accurate clock.

### Price watch and quote recorder

*   **`priceWatch.ts`:**
    *   Subscribes over the WebSocket to the open position's token and the
        NIFTY index.
    *   Marks data stale after 5 seconds without a tick, then switches to REST
        polling every 2 seconds.
    *   Feeds `premiumExit`.
*   **`quoteRecorder.ts`:**
    *   Every minute from 09:15 to 15:30, saves LTP, bid, ask and open interest
        for ATM ±5 strikes of the current and next weekly NIFTY expiry.
    *   About 22 tokens × 375 minutes ≈ 8,000 rows a day, in the `quotes`
        table.
    *   This data checks the premium model (CUJ 9) and later the straddle (L3).

### Reconciler

The reconciler runs at boot, after login, every 10 seconds while a position is
open, and every 60 seconds otherwise.

*   It looks only at orders carrying the bot's tag and tokens the bot opened.
*   If a tagged position exists with no resting stop, it places one.
*   If the database says a position is open but Angel shows none, it records
    the exit from the fills, with reason `external` or `broker_squareoff`.
*   An untagged NIFTY or BANKNIFTY option position follows CUJ 7.
*   There is no account-wide cancel.

### Expiry-day straddle (designed, off until L3)

*   **When:** NIFTY expiry day only, with the date from the master. Entry
    window 09:30–10:30, only if no directional position is open.
*   **What:** buy 1 lot each of the ATM CE and PE, with limit orders at the ask
    and a 10-second timeout. If only one leg fills, close it at once with
    reason `leg_failed`.
*   **Exits, on the combined premium P:**
    *   stop at P × 0.75;
    *   target at P × 1.40;
    *   time exit at 14:30.
*   **Rules:**
    *   One trade group and one P&L for the daily stop.
    *   It blocks directional entries until it closes.
*   **Enabling:** the setting `STRADDLE_ENABLED` stays false, and the dashboard
    refuses to turn it on, until the recorded `quotes` cover at least 20
    expiries. Those 20 expiries are then replayed through these rules, and the
    result must be profitable after doubled charges.

### Data model

`nifty.db` starts its own schema at version 1, using the copied `migrate()`
runner.

*   `trades`: one row per trade group. Columns:
    *   kind (`directional` or `straddle`), underlying, state;
    *   entry and exit times;
    *   gross P&L, charges, net P&L;
    *   class (`win`, `loss` or `breakeven`);
    *   exit reason;
    *   entry details as JSON: spot, IV, delta, spread, master date and params
        hash.
*   `legs`: per leg. Columns:
    *   token, symbol, strike, expiry, CE or PE;
    *   lot size, lots;
    *   entry and exit price;
    *   order tags;
    *   stop stage and stop price.
*   `decisions`: one row per candle per underlying, unique on
    `(underlying, candle_time)`, with the skip reason.
*   `daily_state`: one row per IST date. Columns: trades, losses, halt kind,
    login result.
*   `quotes`: the recorder data.
*   `kv`: as in the ETH bot (bot id, credentials, mode, ledger capital, peak).

### Dashboard and settings

The dashboard is copied from the ETH bot's React shell and shows a fixed
**NIFTY BOT** banner, so it cannot be mistaken for the ETH bot. It has four
pages.

*   **Overview:**
    *   session state;
    *   open position with stop stage and stop price;
    *   today's trades and daily-stop status;
    *   ledger equity and peak;
    *   halts with Resume and Close buttons.
*   **Trades:** the trade list, with charges as a % of gross.
*   **Decisions:** the per-candle log with skip reasons.
*   **Settings:**
    *   Angel keys: API key, client code, PIN and TOTP secret. These are stored
        encrypted, never shown again, and only the last 4 characters are
        displayed.
    *   Starting capital for the ledger.
    *   Enabled indices: NIFTY now, BANKNIFTY at L2.
    *   Straddle toggle, locked until L3 conditions are met.
    *   Paper/Live switch, with the same confirmation flow as the ETH bot.

### Health and alerts

`/health` returns 200 when the bot is fine, and also when the market is closed
and the bot is idle. It returns 503 in any of these cases:

*   a halt is set, other than `daily_loss`;
*   a position is open and its price watch is stale;
*   the session is invalid while a position is open;
*   a cycle was missed during market hours;
*   the master is stale on a trading day.

Alerts go to the log and to Telegram if it is configured, for:

*   login results;
*   master refresh (rows and age);
*   order rejections, with Angel's reason text;
*   a stop that triggered but did not fill;
*   forced-exit results;
*   halts.

A separate uptime monitor watches `https://nifty.3.108.203.12.sslip.io/health`.

## Alternatives Considered

### Alternative A: Sell options (naked selling, short straddle or strangle)

*   **Pros:**
    *   Time decay earns money instead of costing it.
    *   The expiry-day short straddle is the classic way to collect that decay.
*   **Cons:**
    *   Margin is about ₹1–2 lakh per lot, 4–8× the capital.
    *   The loss on a large move has no limit.
*   **Reason for Rejection:** Rejected by author: buying only. The capital
    cannot carry the margin.

### Alternative B: Debit spreads (buy one strike, sell a further one)

*   **Pros:**
    *   Loses less to time decay than a single bought option.
    *   The maximum loss is known in advance.
*   **Cons:**
    *   Two legs mean double the brokerage and the risk that only one leg
        fills.
    *   The profit is capped.
*   **Reason for Rejection:** Rejected by author for v1: buying single options
    only. It could be revisited if research shows time decay is what makes the
    signal unprofitable.

### Alternative C: Overnight or multi-day holding on 1-hour candles

*   **Pros:**
    *   Closer to how the ETH bot trades.
    *   Fewer trades, so lower costs.
*   **Cons:**
    *   Overnight gaps jump past any stop.
    *   A bought option loses value overnight, including weekends.
*   **Reason for Rejection:** Rejected by author: intraday only.

### Alternative D: Fixed ₹100 premium-point stop and target

*   **Pros:**
    *   Simple.
    *   The same in every market condition.
*   **Cons:**
    *   On a typical ₹80–150 NIFTY option the stop is near the whole premium,
        so it rarely triggers.
    *   One loss is about ₹6,500 per lot, roughly 26% of capital.
    *   The target needs the premium to double within the day.
*   **Reason for Rejection:** Rejected by author in favour of percent-of-premium
    exits (−30% stop, +30% cost-to-cost, +60% target, then the trail). These
    scale with the option's price.

### Alternative E: Official SmartAPI JavaScript SDK, or a hybrid with the SDK for ticks

*   **Pros:**
    *   Less code to write.
    *   Angel's own login flow and field names.
*   **Cons:**
    *   Last released September 2024.
    *   Depends on axios 0.20 (2020) and has test tools as runtime
        dependencies.
    *   Calls an outside IP-lookup service at runtime.
    *   The hybrid still loads all of these into the live process.
*   **Reason for Rejection:** Rejected by author: own REST and WebSocket client
    for full control of the calls that move money, in the same style as the ETH
    bot's Delta client.

### Alternative F: Run inside the ETH bot's process, or share its code as a library

*   **Pros:**
    *   One dashboard and one deployment.
    *   No copied code.
*   **Cons:**
    *   A crash, deploy or memory problem in one bot stops the other.
    *   Turning the ETH bot into a shared framework means changing a live
        real-money bot for an unproven second one.
*   **Reason for Rejection:** Rejected by author: separate process. Generic
    modules are copied, not shared. Extracting a shared package can be
    reconsidered only if both bots run profitably for months.

### Alternative G: A separate server

*   **Pros:** full isolation, including memory and the static IP.
*   **Cons:**
    *   Extra cost.
    *   A second Elastic IP to register with Angel.
*   **Reason for Rejection:** Rejected by author: same EC2. The server is
    upgraded to t3.small, and the new bot has a 250 MB PM2 memory limit, to
    protect the ETH bot.

### Alternative H: Use the exchange stop-limit order as the only stop

*   **Pros:**
    *   It protects the position even if the bot is down, which is the ETH
        bot's rule.
*   **Cons:**
    *   NSE does not allow SL-M on index options.
    *   A stop-limit can trigger and then not fill in a fast move.
*   **Reason for Rejection:** The bot's own price watch is the main stop. The
    resting SL-limit order and Angel's intraday square-off are backups (CUJ 3).

### Alternative I: Always ATM, or cheaper out-of-the-money strikes

*   **Pros:**
    *   Simple.
    *   OTM options fit more trades into the ₹125 premium limit.
*   **Cons:** OTM options lose value fastest and mostly expire worthless.
*   **Reason for Rejection:** A strike near 0.55 delta, with spread and
    open-interest filters. Research compares only ATM against 0.55 delta and
    freezes the winner.

### Alternative J: Trade the contract that expires that day

*   **Pros:**
    *   The cheapest premiums.
    *   The biggest percentage moves.
*   **Cons:** time decay and price swings are extreme for a buyer, so most of
    these options end at zero.
*   **Reason for Rejection:** Directional trades roll to the next weekly from
    13:00 on the day before expiry. Only the straddle (L3) trades on expiry day.

### Alternative K: Build first, research later

*   **Pros:** the bot exists sooner.
*   **Cons:** if the signal has no edge after time decay and charges, all of the
    build work is lost and real money is lost proving it.
*   **Reason for Rejection:** Research Gate 1 comes before the build (stage R).

### Alternative L: Use UT, or adaptive Hull/UT, as the signal

*   **Pros:** UT scored higher than Hull on the ETH backtest.
*   **Cons:** neither was tested on NIFTY.
*   **Reason for Rejection:** Rejected by author: Hull only. Research tests only
    Hull lengths.

### Alternative M: A required paper period before live

*   **Pros:** catches API and order-handling mistakes without losing money.
*   **Cons:** delays live trading.
*   **Reason for Rejection:** Rejected by author: no required paper period.
    Paper mode still exists. These replace it as safeguards:
    *   the quote recorder;
    *   a 1-lot canary for the first 10 trades;
    *   the ₹5,000 loss floor;
    *   the model-drift halt;
    *   the contract test script.

### Alternative N: BANKNIFTY and the straddle in v1

*   **Pros:**
    *   More trades.
    *   Matches the original request.
*   **Cons:**
    *   One BANKNIFTY ATM lot can cost most of the capital.
    *   BANKNIFTY moves closely with NIFTY.
    *   The straddle cannot be checked on modelled prices.
*   **Reason for Rejection:** Rejected by author for v1. Added at stages L2 and
    L3, each with its own entry condition.

### Alternative O: 20% a week as the success measure

*   **Cons:**
    *   It compounds to about 13,000× a year.
    *   Sizing for it would empty the account.
*   **Reason for Rejection:** Rejected by author in favour of Research Gate 1
    (G1).

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security:**
    *   The Angel credentials (API key, client code, PIN, TOTP secret) are a
        full account login. They are stored AES-256-GCM encrypted, under a
        `SECRETS_KEY` separate from the ETH bot's, with the authenticated data
        tag `angel_credentials:v1`.
    *   They are never returned by the API or written to logs.
    *   The dashboard needs a session and a CSRF header, and asks for the
        password again for key changes, mode changes, Resume and Close, as the
        ETH bot does.
    *   The Caddy site for the dashboard is limited to your IPs if you give
        them; otherwise it stays password-only. That is accepted as a residual
        risk.
    *   The Angel account should hold only trading capital and no demat
        holdings. That is your action.
*   **Memory and CPU:**
    *   The PM2 memory limit is 250 MB.
    *   The instrument master is stream-parsed, so the full file is never held
        in memory.
    *   The `quotes` table grows about 8,000 rows a day, roughly 1 MB.
    *   `quotes` is never pruned, because the straddle gate and the model check
        need the full history. At about 1 MB a day that is about 250 MB a year,
        within the 20 GB disk. Nightly backups keep the latest 7 copies.
*   **Isolation:** no file, port, process name, cookie, database or key is
    shared with the ETH bot (G2). The deploy steps never restart `eth-bot`.
*   **Rollout:** stages R → B → L1 → L2 → L3, with the entry and rollback
    conditions in the Technical Plan.
*   **Rollback:** switch to paper from the dashboard, or `pm2 stop nifty-bot`.
    Angel's intraday square-off closes anything still open at about 15:15.
*   **Time:** all trading-time logic uses IST (UTC+05:30, no daylight saving)
    from an injectable clock. The process itself stays on UTC, as the ETH bot
    does.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

The new project lives in `~/Desktop/tradingbot-nifty/`. All paths below are
relative to that folder unless they start with `tradingbot-eth/`. The ETH bot's
folder is not changed, except that this design document is copied out of it
when finalised.

Work is ordered by stage. Stage R files are built and run first. Stage B work
starts only after Gate 1 passes.

### Stage R: Research

#### 1. `package.json`, `tsconfig.json`, `tsconfig.scripts.json`, `vitest.config.ts`, `.gitignore` (Create)

*   **Type / Scope:** project configuration.
*   **Proposed Changes:**
    *   The same toolchain and pinned versions as the ETH bot: TypeScript 5.7,
        tsx, vitest 2.1, better-sqlite3 13, express 4.22, pino 9, zod 4,
        bcryptjs, cookie-session, dotenv.
    *   One new dependency, `ws`, pinned to an exact version.
    *   Scripts: `build`, `start`, `dev`, `test`, `lint`, `ctl`,
        `hash-password`, `smoke`, `research`, `angel-contract`, `audit`
        (`npm audit --audit-level=high --omit=dev`).
    *   `.gitignore` covers `.env`, `data/`, `dist/`, `node_modules/` and
        `research/cache/`.
    *   `git init` the folder, so changes are tracked from the start. The ETH
        folder is not a git repository.

#### 2. `src/angel/rest.ts` (Create)

*   **Type / Scope:** HTTP client for SmartAPI.
*   **Proposed Changes:**
    *   `class AngelRest`, constructed with `{ apiKey, clientCode, publicIp,
        localIp, mac, fetchImpl, now, timeoutMs }`.
    *   Methods:
        *   `login(pin, totp)` → `{ jwt, refresh, feedToken }`;
        *   `refresh(refreshToken)`;
        *   `logout()`;
        *   `profile()`;
        *   `funds()`;
        *   `placeOrder(o)`;
        *   `modifyOrder(o)`;
        *   `cancelOrder(id, variety)`;
        *   `orderBook()`;
        *   `tradeBook()`;
        *   `positions()`;
        *   `quote(mode, tokensByExchange)`;
        *   `candles(exchange, token, interval, from, to)`.
    *   Every method returns typed results checked with zod schemas, and
        throws `AngelError { kind: 'retryable' | 'fatal' | 'unknown', code,
        httpStatus, message }`.
    *   One token bucket per endpoint, with limits from `params.ts`.
    *   Logging goes through `redact()` from `log.ts`.
    *   Exact endpoint paths, headers and error codes are copied from Angel's
        current SmartAPI documentation at build time. The contract test
        (file 22) checks them.

#### 3. `src/angel/totp.ts` (Create)

*   **Type / Scope:** pure function.
*   **Proposed Changes:**
    *   `totp(base32Secret, unixSeconds): string`, per RFC 6238: HMAC-SHA1, a
        30-second step, 6 digits.
    *   It uses Node's `crypto` and has its own base32 decoder.

#### 4. `src/research/premiumModel.ts` (Create)

*   **Type / Scope:** pure functions shared by research and the bot.
*   **Proposed Changes:**
    *   `bsPrice({ spot, strike, years, iv, rate, type })` and `bsDelta(...)`.
    *   `impliedVol(price, …)` by bisection.
    *   `modelIv(vix, daysToExpiry, bias)`, where bias is `entry`
        (+X vol points) or `exit` (−X).
    *   `modelSpread(premium)`.
    *   The factors per days-to-expiry bucket are constants. They are
        documented in the research report, and later checked against recorded
        quotes.

#### 5. `src/core/charges.ts` (Create)

*   **Type / Scope:** pure function.
*   **Proposed Changes:**
    *   `charges({ buyValue, sellValue, orders }, rates): { brokerage, stt,
        exchange, sebi, stamp, gst, total }`.
    *   Rates come from `params.ts`, and `.env` can override them.

#### 6. `src/core/premiumExit.ts` (Create)

*   **Type / Scope:** pure function. Used by research, paper and live.
*   **Proposed Changes:**
    *   State:
        *   `{ stage: 'INITIAL' | 'COST' | 'TRAIL', entry, stop, high, gap,
            lastTrailCheck }`.
    *   `onTick(state, price, now, p)` returns one of:
        *   `{ kind: 'hold' }`;
        *   `{ kind: 'exit', reason: 'stop' | 'target' }`;
        *   `{ kind: 'stage', state }`. At ≥ E × 1.30, the state moves to COST
            and TRAIL together, with stop = max(E + chargesPerUnit,
            high − gap).
    *   `onTrailCheck(state, now, p)` runs at 5-minute IST boundaries. It
        returns a new state with:
        *   the gap tightened by E × 0.025, down to a minimum of E × 0.10, if
            the price set a new high since the last check;
        *   stop = max(stop, high − gap).
    *   All prices are rounded to the tick: down for stops, up for targets.
    *   Parameters: `SL_PCT`, `COST_TRIGGER_PCT`, `TARGET_PCT`,
        `TRAIL_GAP_START_PCT`, `TRAIL_GAP_STEP_PCT`, `TRAIL_GAP_MIN_PCT`.

#### 7. `src/core/hull.ts` (Create, copied)

*   **Type / Scope:** pure function.
*   **Proposed Changes:**
    *   Copy the Hull moving average and Hull signal functions from
        `tradingbot-eth/src/core/indicators.ts` and `signals.ts`, Hull only.
    *   Leave out UT and the selector.

#### 8. `src/core/expirySelect.ts` and `src/core/strikeSelect.ts` (Create)

*   **Type / Scope:** pure functions.
*   **Proposed Changes:**
    *   `expiryFor(underlying, nowIst, expiries[], calendar)`, following the
        expiry rules in the Technical Plan.
    *   `strikeFor({ spot, side, candidates: Quote[], lotSize, capital, p })`,
        which returns `{ token, strike, delta, reason }` or
        `{ skip: 'SPREAD_TOO_WIDE' | 'LOW_OI' | 'UNAFFORDABLE' |
        'NO_CONTRACT' }`.
    *   Research uses modelled quotes in the same shape.

#### 9. `src/core/lotsFor.ts` and `src/core/risk.ts` (Create)

*   **Type / Scope:** pure functions.
*   **Proposed Changes:**
    *   `lotsFor({ entry, lotSize, capital, roundTripCharges, p })` returns
        0 or 1, as in the Technical Plan.
    *   `classify(netPnl, band)` returns `win`, `loss` or `breakeven`.
    *   `riskState(ledger)` returns `{ equity, peak, drawdownPct,
        totalLoss }`.
    *   `haltFor(riskState, today)` returns the halt kind to set, if any.

#### 10. `src/research/phase0.ts` and `src/research/data.ts` (Create)

*   **Type / Scope:** research script, run on the Mac only.
*   **Proposed Changes:**
    *   **`data.ts`:**
        *   logs in with keys from `.env`;
        *   fetches NIFTY spot and India VIX candles at 1, 5 and 15 minutes,
            in chunks within the API's per-request day limits;
        *   caches them as CSV under `research/cache/`.
    *   **`phase0.ts`:**
        *   runs a grid of Hull lengths 21/34/55 × intervals 5m/15m ×
            strike rule (ATM / 0.55 delta);
        *   splits the data 70% in-sample, 30% out-of-sample, by date;
        *   simulates entries with the real gates, prices with
            `premiumModel`, exits with `premiumExit`, costs with `charges`;
        *   also runs every combination with costs doubled;
        *   writes `docs/research/phase0.md` with the Gate 1 table, results
            by month, the skip counts by reason, and a pass/fail verdict.

#### 11. `docs/research/phase0.md` (Create, generated)

*   **Type / Scope:** research report.
*   **Proposed Changes:**
    *   Produced by file 10.
    *   You review it. Stage B starts only if it says PASS and you approve.

### Stage B: Build (only after Gate 1 passes)

#### 12. `src/config/env.ts` and `src/config/params.ts` (Create)

*   **Type / Scope:** configuration.
*   **Proposed Changes:**
    *   **`env.ts`** reads `.env` with zod: `PORT=3001`, `HOST`,
        `DATA_DIR`, `DASHBOARD_USER`, `DASHBOARD_PASSWORD_HASH`,
        `SESSION_SECRET`, `CTL_TOKEN`, `SECRETS_KEY`, `COOKIE_SECURE`,
        `DRY_RUN`, `PUBLIC_IP`, `MAX_LOTS=1`, `STARTING_CAPITAL`,
        `TELEGRAM_*` and the charge rates.
    *   **`params.ts`** holds the frozen strategy values from the research
        report, exported with a params hash:
        *   Hull length and interval;
        *   strike rule;
        *   the exit percentages;
        *   the time windows;
        *   `RISK_PER_TRADE=0.10`, `MAX_OUTLAY_PCT=0.40`;
        *   the break-even band ticks;
        *   `LOSS_FLOOR=5000`, `DD_HALT=0.50`;
        *   the slippage-drift factor and canary count.

#### 13. Copied generic modules (Create, copied)

*   **Type / Scope:** infrastructure.
*   **Proposed Changes:** each copy is adjusted as noted.
    *   `src/engine/lock.ts`, `mutex.ts`, `halt.ts`: add the halt kinds
        `daily_loss` (clears automatically), `drawdown_50`, `loss_floor`,
        `model_drift`, `fatal_error`, `unknown_position`.
    *   `src/engine/bootGuard.ts`: add the `kv.bot_id` check.
    *   `src/store/db.ts`, `backup.ts`: backup directory
        `data/backups-nifty`.
    *   `src/log.ts`: redaction paths for `pin`, `totp*`, `clientCode`,
        `jwt*`, `refresh*`, `feedToken`, `authorization`, `x-privatekey`;
        pino `base: { bot: 'nifty' }`.
    *   `src/notify/telegram.ts`: prefix `[nifty-bot]`.
    *   `src/api/auth.ts`, `server.ts`: cookie name `niftybot`; the ETH
        `trustProxy` option kept.
    *   `src/store/secrets.ts`: authenticated data tag
        `angel_credentials:v1`, with four fields.
    *   `src/engine/scheduler.ts`: keep the `Scheduler` class, and replace
        `nextCycleAt` with a version that asks the calendar.

#### 14. `src/store/migrations.ts` and `src/store/repo.ts` (Create)

*   **Type / Scope:** database schema version 1 and its queries.
*   **Proposed Changes:**
    *   The tables `trades`, `legs`, `decisions`, `daily_state`, `quotes`,
        `kv`, `system_events`, as described under Data model.
    *   Repository methods:
        *   `openTradeGroup`, `addLeg`, `updateLegStop`, `closeTradeGroup`;
        *   `addDecision`;
        *   `dailyState(date)`;
        *   `addQuotes(batch)`;
        *   `ledger()`;
        *   the kv helpers.

#### 15. `src/engine/calendar.ts` (Create)

*   **Type / Scope:** pure functions plus a holiday table.
*   **Proposed Changes:**
    *   `isTradingDay(dateIst)` uses a holiday list stored in kv and editable
        from Settings. It starts with the NSE holiday list for the current
        year, entered by you from NSE's circular.
    *   `windowAt(nowIst)` returns one of:
        *   `preopen`;
        *   `no_entry_open` (09:15–09:20);
        *   `entries` (09:20–14:45);
        *   `manage_only` (14:45–15:05);
        *   `forced_exit` (15:05–15:12);
        *   `alert` (15:13);
        *   `closed`.
    *   `nextCandleClose(nowIst, interval)`.
    *   `trailBoundary(nowIst)` for the 5-minute steps.

#### 16. `src/angel/instruments.ts` (Create)

*   **Type / Scope:** I/O and parsing.
*   **Proposed Changes:**
    *   Downloads the instrument master at 08:35 IST.
    *   Stream-parses the JSON array and keeps rows where all of these hold:
        *   `exch_seg = NFO`;
        *   `instrumenttype = OPTIDX`;
        *   name in the enabled set;
        *   expiry among the next 3.
    *   Validates fields with zod and stores the rows in memory and in kv,
        with the date.
    *   `stale()` is true when the master date is not today's trading date.

#### 17. `src/angel/ws.ts` and `src/angel/tickParser.ts` (Create)

*   **Type / Scope:** WebSocket V2 feed.
*   **Proposed Changes:**
    *   `class AngelFeed`:
        *   `connect(jwt, feedToken)`, `subscribe(mode, tokens)`,
            `unsubscribe`;
        *   heartbeat ping;
        *   reconnect with backoff, re-subscribing;
        *   emits `tick` events;
        *   `lastTickAt(token)`.
    *   `parseTick(buf: Buffer): Tick | null` decodes frames in LTP, quote
        and snap-quote modes. Prices are in paise, divided by 100.

#### 18. `src/angel/session.ts` (Create)

*   **Type / Scope:** state machine.
*   **Proposed Changes:**
    *   States: `LOGGED_OUT`, `LOGGING_IN`, `ACTIVE`, `EXPIRED`, `FAILED`.
    *   `ensureActive()`.
    *   Scheduled login at 08:50, after a chrony offset check (refused if the
        offset is above 2 seconds).
    *   Retry backoff: 30 s, 60 s, 120 s, 240 s, at most 5 attempts per day.
    *   Refresh before expiry.
    *   `onAuthError()` follows CUJ 4 and CUJ 5.
    *   Emits state changes for alerts and /health.

#### 18a. `src/angel/broker.ts` (Create)

*   **Type / Scope:** the broker port and its live implementation.
*   **Proposed Changes:**
    *   **Interface `BrokerPort`:**
        *   `buy(token, qty, limit, tag)`;
        *   `sellUpTo(token, qty, limit, tag)`, which reads the net quantity
            first;
        *   `placeStopLimit(token, qty, trigger, limit, tag)`;
        *   `modifyOrder(id, fields)`;
        *   `orderByTag(tag)`;
        *   `netQty(token)`;
        *   `positions()`;
        *   `quotes(tokens)`;
        *   `funds()`.
    *   **`LiveBroker`** implements it with `AngelRest`, product `INTRADAY`,
        exchange `NFO`.
    *   Client-side limits: at most 2 orders per second and 40 per day.

#### 19. `src/angel/paperBroker.ts` (Create)

*   **Type / Scope:** the same port, for paper mode.
*   **Proposed Changes:**
    *   Buys fill at the live ask and sells at the live bid, plus slippage
        ticks.
    *   Fills are refused if the spread is above the filter.
    *   An SL-limit order fills only if a later tick trades at or better than
        its limit.
    *   Positions are squared off at 15:15.
    *   Charges come from `charges.ts`.

#### 20. `src/engine/executor.ts`, `priceWatch.ts`, `reconciler.ts`, `quoteRecorder.ts`, `cycle.ts`, `engine.ts`, `boot.ts`, `src/index.ts` (Create)

*   **Type / Scope:** trading engine.
*   **Proposed Changes:**
    *   **`executor.ts`:**
        *   `enter(signal, contract)`, `exit(reason)`, `moveStop(newStop)`;
        *   outbox states and the exit-race rules 1–7 from the Technical
            Plan;
        *   the stop-not-filled escalation from CUJ 3.
    *   **`priceWatch.ts`:**
        *   subscribes to the position token and the index;
        *   falls back to REST polling every 2 s after 5 s without ticks;
        *   calls `premiumExit.onTick` on every price and `onTrailCheck` on
            5-minute boundaries, under the engine mutex.
    *   **`reconciler.ts`:** tagged orders only, CUJ 7 handling, runs at
        10-second and 60-second intervals.
    *   **`quoteRecorder.ts`:** a 1-minute snapshot through `quotes()`, about
        22 tokens per call within the quote API limit.
    *   **`cycle.ts`:** the cycle steps 1–5 from the Technical Plan.
    *   **`engine.ts`:** holds the context, the mutex and `suspend()`.
    *   **`boot.ts`:** loads env, lock, database, migrations and bot id;
        decrypts the credentials; logs in; loads the master; reconciles; then
        starts the scheduler, price watch, recorder and backup.
    *   **`index.ts`:** starts the server on `HOST:PORT` and handles graceful
        shutdown.

#### 21. `src/api/routes.ts`, `src/api/settings.ts` (Create)

*   **Type / Scope:** HTTP API.
*   **Proposed Changes:**
    *   **Routes:**
        *   `/health`, following the Technical Plan rules;
        *   `/api/status`, `/api/trades`, `/api/decisions?underlying=`;
        *   `/api/ctl/{pause,resume,close}`, with the ctl token or a session;
            Resume and Close ask for the password again.
    *   **Settings:**
        *   `GET` returns the status, with credentials shown as their last 4
            characters only;
        *   `POST /credentials` takes 4 fields. It runs a read-only check
            first: login, profile, funds. It is accepted only while flat;
        *   `POST /mode` (paper/live), with the ETH bot's confirmation flow;
        *   `POST /capital`, only while flat;
        *   `POST /underlyings`: NIFTY only until L2;
        *   `POST /holidays`;
        *   `POST /straddle`, which refuses until L3 conditions hold.

#### 22. `scripts/ctl.ts`, `scripts/hash-password.ts`, `scripts/smoke.ts`, `scripts/angelContract.ts` (Create)

*   **Type / Scope:** command-line tools.
*   **Proposed Changes:**
    *   `ctl.ts` and `hash-password.ts` are copied, with the port and token
        taken from `.env`.
    *   `smoke.ts` boots in paper mode, logs in, loads the master, records one
        quote snapshot, runs one cycle and checks /health.
    *   `angelContract.ts` makes read-only calls only:
        *   login;
        *   profile;
        *   funds;
        *   master;
        *   one quote;
        *   one candle request;
        *   30 seconds of ticks, saved as fixtures for the parser tests.

#### 23. `web/` (Create, copied shell)

*   **Type / Scope:** React dashboard.
*   **Proposed Changes:**
    *   Copy `App.tsx`, `main.tsx`, `api.ts`, `usePolling.ts`, `styles.css`,
        `ConfirmButton`, `HaltBanner` and `Login`. Add the fixed **NIFTY BOT**
        banner.
    *   New pages: Overview, Trades, Decisions, Settings (with 4 key fields,
        capital, underlyings, holidays and the straddle toggle).
    *   The ETH pages Insights and EquityChart are not copied.

#### 24. `ecosystem.config.cjs`, `Caddyfile.example`, `.env.example`, `README.md`, `docs/DEPLOY.md` (Create)

*   **Type / Scope:** deployment and documentation.
*   **Proposed Changes:**
    *   **PM2:** app `nifty-bot`, `max_memory_restart: '250M'`,
        `TZ: 'UTC'`.
    *   **Caddy:** a site block for `nifty.3.108.203.12.sslip.io` that
        reverse-proxies to 127.0.0.1:3001, added beside the existing ETH
        block.
    *   **`DEPLOY.md`** (Amazon Linux 2023, ec2-user):
        *   resize to t3.small;
        *   rsync to `~/tradingbot-nifty`;
        *   `npm ci`, then build;
        *   `.env` with fresh secrets;
        *   register the Elastic IP in SmartAPI;
        *   run the contract test;
        *   run the smoke test;
        *   `pm2 start ecosystem.config.cjs --only nifty-bot`.
    *   **README:** the daily timetable, halt kinds and how to clear each, and
        the ctl commands.

#### 25. `tradingbot-eth/docs/designs/nifty_options_bot.md` (Create) and `tradingbot-nifty/docs/designs/nifty_options_bot.md` (Create)

*   **Type / Scope:** the final design document.
*   **Proposed Changes:**
    *   Saved in both projects when finalised.
    *   The ETH project gets no other change.

### Tests (Create, in `tests/`)

*   **`totp.test.ts`:** the RFC 6238 SHA-1 test vectors.
*   **`premiumExit.test.ts`:**
    *   a table of tick sequences: stop hit; cost trigger; trail tightening
        each 5 minutes; gap floor; never moving down; target; tick rounding;
    *   the CUJ 1 and CUJ 2 paths.
*   **`charges.test.ts`:** worked examples, later matched to a real contract
    note.
*   **`expirySelect.test.ts`:**
    *   normal week;
    *   rolling from 13:00 on the day before expiry;
    *   expiry day;
    *   a Tuesday holiday moving expiry to Monday;
    *   BANKNIFTY monthly roll.
*   **`strikeSelect.test.ts`:** delta choice, each filter, all-fail skip.
*   **`lotsFor.test.ts`, `risk.test.ts`:**
    *   the ₹125 affordability edge;
    *   break-even band classification;
    *   the daily stop, drawdown, loss-floor and model-drift triggers.
*   **`calendar.test.ts`:** every window boundary, a holiday, and the weekend.
*   **`tickParser.test.ts`:** recorded frames from file 22, truncated or
    corrupt frames, values in paise.
*   **`rest.test.ts`:**
    *   headers;
    *   error mapping;
    *   timeouts;
    *   rate limiting;
    *   redaction (no secret appears in any log line).
*   **`session.test.ts`:**
    *   CUJ 4 retries and the 09:30 cutoff;
    *   CUJ 5 with a position open;
    *   the clock-offset refusal.
*   **`executor.test.ts`** with a fake broker:
    *   never sells more than the net quantity;
    *   modify instead of cancel-and-place;
    *   lookup by order tag after a timeout;
    *   CUJ 3 escalation;
    *   the order-rate and daily caps.
*   **`reconciler.test.ts`:**
    *   CUJ 7: untagged positions are never touched;
    *   a missing stop is placed;
    *   an external exit is recorded;
    *   a broker square-off is recorded.
*   **`cycle.test.ts`:**
    *   each skip reason;
    *   an opposite signal exits without reversing;
    *   one position at most.
*   **`api.test.ts`, `settings.test.ts`:**
    *   auth and CSRF;
    *   credentials never returned;
    *   changes refused unless flat;
    *   the straddle lock.
*   **`boot.test.ts`:** the bot id mismatch refusal, a stale master blocking
    entries, and the boot order.

### Verification Plan

*   **Build:** `npm run build` (tsc plus the web build), on the Mac. The
    server builds only after resizing to t3.small.
*   **Unit tests:** `npm test`, all passing. Core pure modules (premiumExit,
    charges, expirySelect, strikeSelect, lotsFor, risk, calendar, totp,
    tickParser) need 95%+ branch coverage, via `npm run coverage`.
*   **Static analysis:** `npm run lint` (tsc on scripts) and `npm run audit`
    with no high-severity findings.
*   **Research gate:** `npm run research` produces `docs/research/phase0.md`
    with PASS, and you approve it.
*   **Contract test:** `npm run angel-contract` passes against the real
    account, from the server's registered IP.
*   **Smoke test:** `npm run smoke` passes on the server in paper mode.
*   **Isolation check after deploy:**
    *   `pm2 ls` shows `eth-bot` with an uptime that did not restart;
    *   `curl 127.0.0.1:3000/health` (ETH) is still 200;
    *   `curl 127.0.0.1:3001/health` is 200.
*   **Live L1 check:** after the first live trade, compare the bot's charges
    and fill prices against Angel's contract note and order book. Charges must
    match within ₹1.

--------------------------------------------------------------------------------

*Drafted with EGM*
