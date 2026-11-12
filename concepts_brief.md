# NIFTY/BANKNIFTY Options Bot on Angel One

* **Author:** Shakil Dodhiya
* **Date:** 2026-11-11

## Overview

The proposal is a second bot process on the same EC2 instance as the live ETH-perpetual bot (t3.micro, Amazon Linux 2023, Elastic IP, Mumbai). It would buy NIFTY and BANKNIFTY index options through Angel One SmartAPI: a CE on a long signal on the index, a PE on a short signal. It trades intraday only, with under ₹25,000 of capital, and holds at most one open position across both indices. Two optional parts are an expiry-day long straddle and a dashboard for credentials, index selection and paper/live mode.

Six reviewers looked at the concept: design, codebase-details, zoom-out, comprehension, implementation-readiness and structural. All six agree on the main points:

1. **Edge comes first, not the bot.** Nobody has shown a profitable NIFTY/BANKNIFTY signal yet. Option-level backtests can only use modelled premiums (Black-Scholes plus India VIX). That model is weakest where it matters most: weekly expiries, expiry day, spreads and IV changes. Building the bot before research is the most expensive way to find out there is no edge.
2. **"Reuse the framework" is only half true.** The ETH code is one Delta ETHUSD perpetual bot, not a framework. These parts can be reused: auth, secrets pattern, store, halt, lock, mutex, scheduler class, telegram and dashboard shell. These parts must be rewritten for options: exchange interface, executor, reconciler, paper broker, sizing, DB schema, boot checks and health.
3. **The ETH bot's main safety rule does not carry over.** On ETH, the stop sits on the exchange and protects the position while the bot is down. NSE does not allow SL-M on index options. An SL-limit can be skipped in a fast move. So the bot's own price watch becomes the main stop, and it stops working whenever the process, the server or the Angel session is down.
4. **The risk numbers do not fit together.** With whole lots, under ₹25k and a 20% risk per trade, sizing usually gives either 0 lots or 1 lot that is over budget. 20% risk with one loss a day takes the account to the 50% halt in about 3–4 losing days.
5. **The 20%/week goal cannot be a success criterion.** The proposed replacement ("profitable after charges over ≥6 months, DD < 50%") also needs defining: on what data (backtest, paper or live), with what minimum trade count, and with an out-of-sample test.

**Recommendation:** proceed only as a staged project:

- **Research gate:** a script only, NIFTY first.
- **Build:** a separate project directory, copy-seeded from the generic ETH modules. The live ETH bot is left untouched.
- **Shadow recording and paper on live bid/ask.**
- **Live at 1 lot**, NIFTY only, straddle off.

Angel One / NSE / SEBI numbers below come from reviewers' domain knowledge and are marked **(verify)**. Check them against current Angel One, NSE and SEBI sources before the design draft.

## Analysis

The lens tags show which reviewers raised each finding. "design" = egm-design, "code" = egm-codebase-details, "zoom" = egm-zoom-out, "comp" = egm-comprehension, "impl" = egm-implementation-readiness, "struct" = egm-structural.

### Blockers

**B1. No proven edge; research must gate the build.** *(zoom, struct, design, impl)*
- Hull 55 / UT Bot was tuned on 24/7 crypto 1h candles. NSE has about 6 hourly bars a day. A 5m/15m signal must be researched from scratch, and the ETH parameters (ATR gates in $, 2×ATR stop) mean nothing on NIFTY.
- Angel One has no history for expired options. Option P&L must be modelled. Model limits:
  - India VIX is a 30-day NIFTY IV, not the IV of a weekly option on its last days.
  - There is no BANKNIFTY VIX.
  - Black-Scholes ignores skew, intraday IV crush, spread and gaps.
- Small-capital option buying works against four costs at once: theta, the volatility premium, the bid-ask spread and charges. SEBI's own studies found that about 9 in 10 retail F&O traders lost money (verify current figures).
- **Recommendation:** Phase 0 is a research script only. Reuse the existing `simulator.ts` / `stats.ts` / train-test pattern. It runs on Angel index candles with a pessimistic premium model. The model includes IV = VIX × factor per expiry bucket, a full spread per round trip, the itemised charges, and slippage.
- **Gate 1 (all of these must pass):**
  - ≥100 trades;
  - positive out-of-sample net expectancy;
  - still positive at 2× costs and with IV marked down at entry;
  - no single month carries the result;
  - max drawdown at the intended size well inside the halt line.
- If Gate 1 fails, the project stops there. That is a cheap and valid outcome.

**B2. Stops are not guaranteed: SL-M is banned and the bot is the primary stop.** *(design, code, impl, zoom, struct)*
- The ETH design rejected bot-managed stops (eth_trading_bot.md, Alternative J) because the exchange-side bracket survives a crash. `ExchangePort.placeBracket/editBracket` (src/exchange/types.ts), `ensureBracket` in src/engine/reconciler.ts and the "position without stop" 503 in src/api/routes.ts all rely on that rule.
- On index options the only resting order is SL-limit. It can trigger and then not fill on a gap, or be rejected outside the price band. Market orders may also be converted to protected limits (verify Angel/NSE price protection).
- **Recommendation:** a four-layer exit, each layer named in the design:
  1. A bot price watch on SmartAPI WebSocket ticks, with REST polling as a fallback. Reconcile every 2–10 s while a position is open.
  2. A resting SL-limit backstop with a configured trigger-to-limit buffer, rounded to the 0.05 tick.
  3. If triggered but unfilled after X s, *modify the same order* to a marketable limit (bid − n ticks, inside the band). Re-price every Y s up to Z times, then halt and page.
  4. INTRADAY (MIS) product, so Angel's auto square-off is the last resort if the bot dies.
- The design must define X, Y, Z, k and n, and the behaviour when the WebSocket data is stale.

**B3. Exit races can sell more than is held.** *(design, impl)*
- NSE has no reduce-only flag. If the resting SL-limit fills while the bot sends its own exit (stop watch, 15:15 forced exit, opposite signal), the second SELL becomes a naked short order.
- **Recommendation:**
  - Allow one exit order per position at a time, using the existing outbox CLOSING state.
  - Never cancel-then-place. Modify the resting order instead.
  - Read the net quantity for the token before every SELL, and sell at most that.
  - Enforce in the broker port: BUY to open only; SELL only up to the held quantity.
  - Halt and page on any negative net quantity.

**B4. Sizing and risk rules contradict each other.** *(comp, struct, zoom, code, design)*
- "Risk 20%" has three possible meanings for an option buyer: the full premium, a premium stop, or an index stop.
- `contractsFor` in src/core/sizing.ts assumes fractional contracts, leverage and a percentage fee. With lots it returns 0 or 1.
- Rough sizes (verify; lot sizes change, so read them from the instrument master):
  - A NIFTY weekly ATM lot is about ₹6–10k of premium.
  - A BANKNIFTY monthly ATM lot is about ₹15–24k, so it is often unaffordable.
- "1–2 lots" and "risk sizing" cannot both be the rule.
- **Recommendation:**
  - lots = floor(risk budget ÷ (lot size × (entry − premium stop + slippage) + charges)), clamped to [1, 2].
  - Skip and log `SIZE_TOO_SMALL` or `UNAFFORDABLE` when the result is below 1.
  - Add an independent cap: full premium outlay ≤ X% of capital (for example 40%), because a skipped stop can lose the whole premium.
  - Define "risk" in rupees.

**B5. The risk stack trips the 50% halt in about 3–4 losing days.** *(zoom, struct, design, comp)*
- 0.8³ ≈ 0.51. With typical option-buying win rates of 35–45%, three losing days in a row is likely within a month.
- The ETH throttle (`RISK_REDUCED` at 20% DD, in `riskFor`) is silently dropped.
- **Recommendation:**
  - Default risk to 5–10% while the strategy is unproven, or keep the throttle.
  - Define "peak" from the bot's own realised net P&L ledger, not Angel available funds. Funds are distorted by T+1 settlement, margin blocks and deposits.
  - Write one risk-rules table (rule, trigger, unit, effect, reset, interaction) with a worked 10-day losing example.

**B6. Angel credentials give full account access.** *(design, impl, code, zoom)*
- A Delta key is trade-only, IP-whitelisted and cannot withdraw.
- Client code + PIN/MPIN + TOTP seed is a full login: holdings, pledges, all segments, possibly payout (verify).
- `SECRETS_KEY` lives in `.env` on the same box as the ciphertext. The dashboard is password-only and public on port 443.
- **Recommendation:**
  - Use a separate `SECRETS_KEY` and DB.
  - Restrict the dashboard by IP in Caddy or the security group, or add a second factor.
  - Never return or log the TOTP seed. Extend `src/log.ts` redaction to `pin`, `mpin`, `totp*`, `clientcode`, `jwtToken`, `refreshToken`, `feedToken`, `Authorization` and `X-PrivateKey`.
  - Use an Angel account that holds only trading capital and no demat holdings.
  - Record the accepted residual risk.
  - Zoom-out suggests a manual daily TOTP entry from the dashboard for v1 (fail-safe: no login means no trade), with automation only after the live gate.

**B7. Session and login lifecycle is undefined.** *(design, impl, struct)*
- A failed 09:00 login, JWT expiry or an Angel outage mid-session can leave a long option with no exit path.
- The ETH answer (halt on 401/403) is wrong when a position is open.
- **Recommendation:** a `BrokerSession` state machine (LOGGED_OUT / LOGGING_IN / ACTIVE / EXPIRED / FAILED), kept separate from position state:
  - log in at about 08:45–08:50 IST, retrying with backoff while respecting the lockout policy (verify);
  - refresh with `generateTokens`; on an auth error, re-login N times and page at once if a position is open;
  - no new entries if not ACTIVE by about 09:30;
  - chrony/NTP check, because TOTP depends on an accurate clock;
  - /health states `session_invalid_with_position` (page) and `login_failed_flat` (alert).

**B8. The second process is not separated from the live ETH bot.** *(code, design, impl, struct, zoom)*
- Hard-coded defaults and collision points:
  - `PORT` 3000 (src/config/env.ts);
  - lock `DATA_DIR/bot.lock` (src/engine/lock.ts) and DB `bot.db` (src/boot.ts);
  - cookie `ethbot` (src/api/server.ts);
  - Telegram prefix `[eth-bot]` (src/notify/telegram.ts);
  - PM2 name `eth-bot` with `TZ=UTC`;
  - Delta wiring in params.ts, env.ts, boot.ts and index.ts;
  - credential KV key and AAD `delta_credentials:v1` (src/store/secrets.ts).
- One rsync/build/`pm2 restart` cycle from a shared checkout would deploy both bots.
- **Recommendation:** a sibling directory (for example `~/tradingbot-nifty`) with its own:
  - package.json, dist and .env;
  - `DATA_DIR`, `SECRETS_KEY`, `SESSION_SECRET` and `CTL_TOKEN`;
  - port (for example 3001), cookie name, Caddy subdomain, PM2 app name and backup directory;
  - Telegram prefix and pino `base: {bot}`.
- Add a `kv.bot_id` check at boot.
- Deploy rule: never `pm2 restart all`.
- Show a clear bot identity banner on every dashboard page, so a Close or Go live click cannot hit the wrong bot.

**B9. The reconciler would take over the owner's manual trades.** *(code, impl)*
- src/engine/reconciler.ts calls `cancelAll` when flat and adopts any unknown position with an assumed stop.
- On a personal Angel account this would cancel or adopt manual orders and holdings.
- **Recommendation:** scope reconcile to orders carrying the bot's `ordertag` and the tokens the bot opened. Unknown NIFTY/BANKNIFTY option positions trigger an alert or halt. They are never adopted, and there is no account-wide cancel.

**B10. The straddle cannot be validated on modelled data, and its rules are undefined.** *(design, comp, struct, zoom, impl)*
- An expiry-day long straddle buys peak gamma at an IV that usually overprices realised movement. Its expected value is structurally negative unless real data shows otherwise. That is exactly what a VIX-based Black-Scholes model gets wrong.
- Undefined points:
  - which index's expiry day counts;
  - holiday shifts;
  - whether 2 legs count as "one position";
  - precedence against directional signals;
  - entry window, combined stop and target;
  - whether a straddle loss triggers the daily stop;
  - how a one-leg fill is handled.
- **Recommendation:**
  - Default OFF. Hard rule: never enabled on modelled data alone. It needs ≥20 expiries of recorded real quotes or bought historical data (vendors such as TrueData or GDFL; verify), showing net-positive results after doubled charges.
  - When enabled: NIFTY expiry day only (taken from the master). A fixed entry window. Both legs as limit orders with a short timeout; if one leg fails, close the filled leg at once.
  - The straddle is one trade group, one position, one P&L for the daily stop. An open directional trade blocks the straddle, and the reverse.

### Majors

**M1. t3.micro contradicts the repo's own deploy guide.** *(code, design, impl, zoom, struct)* docs/DEPLOY_EC2.md specifies t3.small and Ubuntu, and warns that 1 GB can run out of memory during `npm ci` and the build. Two Node processes at up to 300M each, plus Caddy, plus parsing Angel's large `OpenAPIScripMaster.json`, risk the out-of-memory killer taking down the **live ETH bot**. Burstable CPU credits are also a risk. Recommendation:
- Upgrade to t3.small, or build off-box and ship `dist/`.
- Stream-parse the master, keeping only NFO OPTIDX NIFTY/BANKNIFTY near expiries.
- Set `max_memory_restart` to about 200M plus `max_restarts`/`min_uptime` for the new app.
- Never run research on the server.
- Write an Amazon Linux 2023 deploy variant (dnf, ec2-user).

**M2. SEBI 2025 retail-algo rules and Angel's policy are unverified preconditions.** *(impl, zoom, design)* Several questions must be answered in writing by Angel One **before any build**:
- static-IP registration in the SmartAPI app;
- whether AWS IPs are accepted;
- the order-rate threshold (reported as about 10 orders/s; verify);
- whether an algo ID or tag is mandatory;
- `ordertag` length;
- whether the data APIs also require the registered IP.

Enforce a client-side limit of ≤2 orders/s and a daily order cap (for example 40) as a runaway kill switch. The Elastic IP is a shared single point of failure for both bots, so add a runbook for changing it.

**M3. Instrument facts are broker data, not params.** *(impl, struct, code)* Lot size, tick, strike encoding (×100), expiry dates and freeze quantity all come from the daily instrument master (about 08:30 IST). Fail closed if the master is stale. Validate the fields. Snapshot them on each trade. Lot sizes are reported at NIFTY 65 and BANKNIFTY 30 after late-2025 changes (verify). Take index spot tokens from the master (verify 99926000 / 99926009).

**M4. Calendar, scheduler and health assume 24/7 hourly trading.** *(code, impl, design)*
- `nextCycleAt` fires at HH:00:10 UTC (src/engine/scheduler.ts).
- /health returns 503 after 65 min without a cycle, which would mean false alarms every night.
- Recommendation:
  - A session-aware scheduler in explicit IST (fixed +05:30; the process stays on UTC).
  - NSE holiday table editable from the dashboard.
  - Expiry dates from the master, never from date arithmetic; a Tuesday holiday moves expiry to the previous trading day.
  - /health reports "market closed, idle" as healthy.
  - Reuse the `Scheduler` class; replace only its timing functions.

**M5. Paper fill model overstates results.** *(code, impl, design, comp, zoom)* src/exchange/paperBroker.ts fills at the last price ± 1 tick and stops always fill. Recommendation:
- Buys fill at the ask, sells at the bid, plus slippage.
- Reject fills when the spread is too wide.
- Model SL-limit non-fills.
- Apply the itemised charges.
- Force paper square-off at 15:15.
- Paper and live share the same exit logic; only the broker adapter differs.

Paper still needs a live Angel session and the registered IP.

**M6. Charges are understated.** *(zoom, impl, comp)* ₹50–70 per round trip covers statutory charges and brokerage only. Add the spread (often 0.5–1+ point × lot per side on weeklies), slippage and the SL non-fill tail. All-in cost can be 1–2% of capital per trade. Build an itemised calculator, shared by the simulator, live P&L and the daily-stop test, with configurable rates:
- ₹20/order brokerage;
- STT on sell premium (0.1%, verify);
- NSE transaction charge (about 0.035%, verify);
- SEBI fee;
- stamp duty 0.003% on buys;
- 18% GST.

Reconcile the calculator against contract notes. Show "charges as % of gross" on each trade.

**M7. "Break-even is not a loss" contradicts "stop after one net loss".** *(comp, design, struct, zoom)* With about ₹50–70 of charges plus the spread, an exit at the entry price is almost always a small net loss. Define:
- **loss:** net < −T, where T = charges + k ticks × lot, a stated rupee band;
- **break-even:** within the band;
- **win:** otherwise.

Store the class on the trade and unit-test it. Scope: one loss ends the IST trading day across both indices and the straddle. The daily stop is a `daily_loss` halt kind that clears automatically at the next pre-open. The 50% halt is a `drawdown_50` kind that needs a manual resume.

**M8. Exits: index or premium?** *(comp, design)* Signals, ATR, R, break-even and the trail are undefined for options. Recommendation: signals and the structural stop on the index; a hard premium stop at X% below entry; whichever hits first. P&L is always in premium rupees. Add a time-based exit if the move does not come within N bars (theta). Rename the "break-even" stage for this bot (for example "cost-cover stop") to avoid confusing it with the ETH meaning.

**M9. Two indices and the dashboard index setting conflict.** *(comp, struct, design, impl, zoom)*
- "Both watched, first signal traded" contradicts "index chosen from dashboard".
- Both indices close on the same candle grid, so ties are certain.
- NIFTY and BANKNIFTY are highly correlated, so watching both adds little diversification and doubles the multiple-testing.
- Recommendation: the dashboard control is an enabled set {NIFTY, BANKNIFTY}, changeable only when flat, under the mutex. Use a deterministic tie-break (NIFTY first). Log the winner and the reason.
- Zoom-out recommends NIFTY only for v1.

**M10. Going live without paper removes the only real-data check.** *(zoom, struct, impl, comp, design)* The ETH bot justified skipping testnet with 2.76 years of real candles that its simulator replays exactly. Here the simulator replays *modelled* premiums, so that justification is absent. Angel has no testnet, so the first order is real money. Recommendation, if the owner keeps "no required paper":
- a shadow quote recorder from day one;
- a live canary of 1 lot for the first N trades;
- a hard rupee loss floor (for example ₹5,000) that halts permanently;
- a live-vs-model insight rule that halts entries if fills deviate by more than X% from the model;
- the owner's waiver written into the design.

**M11. Shadow quote recorder is a required data asset.** *(struct, design, impl)* Record per minute: LTP, bid/ask, OI and implied IV for ATM ±5 strikes of the current and next expiry. This is the only way to validate the premium model, the straddle and the "≥6 months" criterion on real data. Run it regardless of the paper/live choice.

**M12. DB schema is perpetual-shaped.** *(code, impl)*
- `trades.size_contracts` has a single side and no token, strike or expiry.
- `decisions` is UNIQUE on `candle_time`, which collides when two indices fire on the same candle.
- Recommendation: a new schema starting at v1. A `trades` table (one row per trade group) plus `legs`. `decisions` keyed by (underlying, candle_time). A `daily_state` table. Reuse the `migrate()` runner pattern. Do not extend the ETH migrations.

**M13. 15:15 forced exit versus broker auto square-off.** *(impl, comp, struct)* Angel squares off MIS positions around 15:15–15:25 for NFO, with a charge of about ₹50 + GST (verify). Proposed timetable (all IST, configurable):

| Time | Action |
| --- | --- |
| 14:45 | Last new entry |
| 15:05 | Forced exit starts |
| until 15:12 | Escalate |
| 15:13 | Critical alert |

Add `broker_squareoff` and `time_exit` exit reasons. Test the timetable against an injectable clock.

**M14. Order idempotency without client order IDs.** *(impl)* Put a unique `ordertag` on every order. After a timeout, search the order book for that tag before retrying. Keep the OPENING/CLOSING outbox states.

**M15. WebSocket and rate limits.** *(impl, design)*
- SmartWebSocketV2 sends binary frames and needs a heartbeat (verify the specifics).
- Track staleness per token. Data older than 5 s blocks entries and switches exits to REST polling.
- Use a token bucket per endpoint. The candle API is tight, at about 3/s (verify).
- Map Angel error codes to retryable / fatal / unknown.

**M16. Observability.** *(code, design)*
- Alerts and events for: login result, session expiry, master refresh (rows, age), RMS rejection text, SL-limit triggered but unfilled, forced-exit result, halts and rate-limit backoff.
- Page (not just alert) on: a position open with a stale watch, a failed exit, a session invalid with a position open, and a negative quantity.
- Add `session`, `masterAge` and `openLegs` to /health.
- Give each bot its own uptime monitor.

### Nits

- N1 *(comp)*: replace "~15:15" and "after 09:15" with exact times. 09:15 is the open, so "after 09:15" adds nothing; use about 09:20–09:30 to skip the noisy first candle.
- N2 *(comp, impl)*: say "buy PE on a bearish index signal", not "PE short".
- N3 *(comp)*: add a one-line glossary: CE/PE, ATM/ITM/OTM, lot, MIS/NRML, TOTP, SL-L/SL-M, freeze quantity, 0DTE.
- N4 *(design, impl)*: warm-up. Hull 55 on 5m needs about 4.5 hours of one session, so warm-up must carry across sessions. Decide how overnight gaps are treated.
- N5 *(comp, impl)*: the Decisions log records skip reasons: daily stop, outside window, tie lost, size too small, unaffordable, spread too wide, master stale.
- N6 *(impl)*: record spot, IV, delta, spread and master date in each trade's `entry_reason`, for later research.
- N7 *(struct)*: keep strategy parameters in a research report plus the params registry, referenced by version and hash. Don't repeat the ETH pattern of strategy amendments bolted onto the architecture document.
- N8 *(code)*: the backup at 00:30 UTC (06:00 IST) is fine, but use a separate backup directory. Parameterise the `ctl` CLI's port and token.
- N9 *(zoom)*: say why a second, harder bot beats further validating the ETH bot. The real driver is a capital constraint: options are the only leveraged NSE instrument under ₹25k. That is not evidence of an opportunity.

### Recommendations on strike, expiry, windows and straddle

**Strike selection** *(design, impl, zoom, comp)*
- Start with a fixed rule; do not build an optimiser. An optimiser on a synthetic backtest fits model artefacts.
- Default: target delta about 0.55 (ATM to 1 strike ITM). Compute delta with Black-Scholes from the option's mid-price IV.
- ITM costs more but loses less theta per point of index move and follows the index more closely. OTM is cheap but mostly expires worthless.
- Candidate set: ATM, ITM1, OTM1, on the 50-point (NIFTY) or 100-point (BANKNIFTY) grid, with the strike checked against the master.
- Filters:
  - spread ≤ about 1–2% of premium;
  - minimum OI and volume;
  - premium × lot ≤ the capital cap.
  If a filter fails, move one strike toward ATM or skip.
- Research compares at most ATM vs ITM1, then freezes the choice. Write the rule as a pure function with table-driven tests.

**Expiry selection**

| Index | Rule |
| --- | --- |
| NIFTY directional | Nearest weekly with ≥1 trading day left. From Monday afternoon and all of expiry day (Tuesday; holiday → previous day, taken from the master), roll to the next weekly. Expiry-day theta and gamma are extreme for a buyer, and this keeps expiry-day behaviour isolated to the straddle. |
| BANKNIFTY directional | Nearest monthly; roll to next month when days-to-expiry ≤ D (configurable). Often unaffordable at 1 lot, so expect `UNAFFORDABLE` skips. |
| Straddle | NIFTY weekly expiry day only. |

**Entry time windows**

| Window | Rule |
| --- | --- |
| 09:15–09:20/09:30 | No entries: opening noise, wide spreads. First entry after the first 5m/15m candle closes. |
| until 14:45 | Entries allowed. |
| after 14:45 | No new entries. |
| 15:05 | Forced exit starts, escalates to 15:12, alert at 15:13; broker MIS square-off is the backstop. |
| Expiry day | Directional entries roll to next weekly (see above). |

**Expiry-day straddle**
- Off by default. Never enabled on modelled data alone; enable only after ≥20 expiries of recorded real quotes (or bought history) show net-positive results after doubled charges.
- Mechanics when enabled:
  - NIFTY ATM CE + PE, as one trade group;
  - fixed entry window;
  - limit orders on both legs with a short timeout; unwind if only one leg fills;
  - combined stop, target and time exit;
  - mutual block with directional trades;
  - counts toward the one-loss daily stop.

## Goals vs. Non-Goals

**Goals**
- G1: Find out cheaply whether a NIFTY intraday option-buying signal has a net-positive edge after all costs (Research Gate 1). The project may stop here.
- G2: If it passes, run a separate, isolated options bot that never puts the live ETH bot at risk: separate directory, DB, port, PM2 app, secrets and memory budget.
- G3: Buy CE or PE on index signals only, intraday only, at most one trade group open, with a bot-managed layered exit and the MIS square-off backstop.
- G4: Size in whole lots with a rupee risk cap and a premium-outlay cap. Enforce a one-net-loss daily stop and a 50% drawdown halt from a ledger-based peak.
- G5: Pick strike and expiry by a fixed, documented, testable rule (delta about 0.55, no 0DTE for directional trades).
- G6: Record real option quotes from day one to validate the premium model.
- G7: Success = profitable after all charges over ≥6 months, with ≥100 trades, out-of-sample, with drawdown < 50%, confirmed by paper or live fills within the model's cost band. *(Pending owner confirmation of these gates.)*

**Non-Goals**
- ≥20% per week as a target or a sizing driver. It compounds to about 13,000× a year; at most it is an aspiration.
- Option selling, short straddles or spreads.
- Overnight or positional holding.
- Refactoring the live ETH bot into a shared multi-asset framework (for now).
- A strike/expiry optimiser.
- Enabling the straddle on modelled data.
- BANKNIFTY and the straddle in v1 (proposed; see Key Decisions).
- Running research or backtests on the production server.

## Alternatives Weighed

| Alternative | Decision | Reason |
| --- | --- | --- |
| Option selling (naked) | Rejected by owner | Margin about ₹1–2 lakh per lot exceeds the ₹25k capital; unlimited loss. |
| Short straddle / strangle on expiry | Rejected | Same margin problem as selling; owner wants buying only. |
| Option spreads (debit spreads) | Rejected for v1 | Owner chose buying only; two legs add legging risk and charges. Could cut theta cost later. |
| Overnight / positional holding | Rejected by owner | Gap risk on a long option; intraday only. |
| Same process as the ETH bot | Rejected by owner | Shared fate with live money; one crash or deploy hits both. |
| Separate server | Rejected by owner | Cost. Reviewers note the instance must still be at least t3.small, or build off-box (see M1). |
| Extract a shared package / refactor ETH bot now | Rejected (reviewers) | Regression risk to a live real-money bot for an unproven second user. Copy generic modules now; extract later only if both bots survive. |
| Stretch `ExchangePort` to options | Rejected (reviewers) | Single-instrument, bracket and leverage shape; options need token-keyed, multi-leg, SL-limit orders and a daily session. |
| Resting SL-limit as the only stop | Rejected (reviewers) | Can be skipped on gaps; the bot watch is primary, SL-limit and MIS square-off are backstops. |
| Fractional risk sizing via `contractsFor` | Rejected (reviewers) | Whole lots at under ₹25k produce 0 or 1; replaced by `lotsFor` with outlay cap. |
| Fixed "always ATM" or OTM strikes | Rejected | OTM decays fastest and mostly expires worthless; delta-target about 0.55 with filters is preferred. |
| Directional trades on the expiring NIFTY weekly on expiry day | Rejected | Extreme theta and gamma for a buyer; roll to next weekly. |
| BANKNIFTY in v1 | Deferred (zoom, recommended) | Monthly only; 1 ATM lot often costs most of the capital; correlated with NIFTY. |
| Straddle enabled by default | Rejected | Structurally negative expected value unless real data shows otherwise; the model cannot validate it. |
| Go live with no paper and no shadow data | Rejected (reviewers) | Owner may waive paper, but the shadow recorder plus 1-lot canary plus rupee floor are required (M10, M11). |
| Automated TOTP login from day one | Open | Convenient, but stores a full-account login factor on the server; manual daily login is the fail-safe v1 option (B6). |
| 20%/week as the success measure | Rejected | Unrealistic; would drive over-risking (G7). |

## Key Decisions & Staging for Next Steps

**Decisions the owner must confirm before the design draft**

1. **Staging:** Research gate (R) → Build with shadow recorder (B) → Live L1 (NIFTY, 1 lot, no straddle) → L2 (add BANKNIFTY) → L3 (straddle, only on real-data evidence). Each step has numeric entry and rollback conditions.
2. **v1 scope:** NIFTY only, or keep both indices with a NIFTY-first tie-break.
3. **Risk per trade:** keep 20%, or default to 5–10% plus the ETH throttle while unproven. Choose skip vs 1-lot-anyway when one lot exceeds the budget. Set the premium-outlay cap X%.
4. **Paper waiver:** confirm a written waiver, plus the required shadow recorder, 1-lot canary for N trades, and a hard rupee loss floor.
5. **Credentials:** automated TOTP (seed stored encrypted) or manual daily login. Dedicated Angel account with no holdings. Dashboard IP restriction or 2FA.
6. **Infrastructure:** upgrade to t3.small, or keep t3.micro with off-box builds, a stream-parsed master and per-app memory caps.
7. **Success criterion:** adopt the gate wording in G7 instead of 20%/week.

**Pre-coding verification checklist (written answers from Angel One / NSE / SEBI)**
- Static IP registration, AWS IP acceptance, algo ID / `ordertag` rules, order-rate threshold, whether data APIs need the registered IP.
- Order varieties for NFO index options (STOPLOSS_LIMIT), market-price protection, price bands.
- Session token lifetime, login rate limit and lockout, MIS square-off time and fee.
- Current lot sizes, freeze quantities, strike steps, expiry weekday rules, holiday calendar source.
- Current charge rates (brokerage plan, STT, exchange fee).

**Next steps**
1. Owner answers decisions 1–7.
2. Phase 0 research script (NIFTY, 5m/15m, pessimistic premium model, Gate 1) as a standalone report. design_draft.md cites it and does not contain it.
3. Write design_draft.md following the ETH design's section order. Add Technical Plan subsections for:
   - Research Results;
   - Session & Calendar;
   - Signal;
   - Strike & Expiry Rules;
   - Straddle Rules;
   - Multi-leg Position Model;
   - Sizing & Charges;
   - Risk Rules table;
   - Angel One Integration;
   - Reconciler & Exit Reasons;
   - Paper/Shadow/Live;
   - Coexistence with the ETH Bot;
   - Observability;
   - Deployment.
   Include critical user journeys for the conflict cases: same-candle tie, SL-limit unfilled on a gap, login failure, failed 15:15 exit, gross-positive/net-negative trade, fourth losing day, lot-size change, one-leg straddle fill.
4. Run egm-review on the draft. Implement only after approval.

**Generic ETH modules to copy (not share), per codebase review:** `src/engine/lock.ts`, `mutex.ts`, `halt.ts`, `bootGuard.ts`; `src/store/db.ts`, the `migrate()` runner, `backup.ts`, `repo.ts` kv helpers; `src/api/auth.ts`, `server.ts` (cookie name as a parameter); `src/log.ts` (more redaction paths); `src/notify/telegram.ts` (prefix as a parameter); the `secrets.ts` AES-GCM pattern; the `Scheduler` class; `riskFor`; and the React shell. Rewrite: exchange client, paper broker, executor, reconciler, exits, sizing, params/env, settings, boot sequence and the ETH-specific dashboard pages.
