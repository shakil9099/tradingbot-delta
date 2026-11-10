# Goldfish Review Report: Initial Zoom Out Review (Stage 5)

**Target:** `/Users/shakildodhiya/Desktop/tradingbot-eth/docs/designs/eth_trading_bot.md` (lines 1-1220)
**Standard:** `/Users/shakildodhiya/.claude/egm/resources/document_standards/zoom-out-standard.md`
**Context given to the reviewer:** `egm_context_delta_api.md`, `concepts_brief.md`, `bot.pine` (the reviewer read lines 910-1039 of `bot.pine`, the UT Bot and Hull sections the design ports)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

**Severity breakdown:** 0 Blocker, 8 Major, 5 Nit

## Overall Verdict

The goal and context are clear, and the core architecture is sound. That core has five parts: a pure core, one exchange port, brackets held on the exchange, a reconciler that treats the exchange as the truth, and SQLite. The repo holds only docs and `bot.pine`, so there is no existing code to reuse. A custom Delta client and custom indicator ports are justified, because exact parity with Pine rules out generic TA libraries.

The main problems are build order and scope creep around that core. The plan builds about 49 files (dashboard, insights, paper broker, adaptive Pine) before it answers the one question that decides whether any of it matters: does the strategy make money after fees? Two consistency gaps also weaken the restart-safety goal and the circuit breaker.

## Prioritized Findings (Blockers -> Major -> Nits)

### 1. No go/no-go check on the edge before the full system is built - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** "Risks the author has accepted" (lines 61-66), Goal 11 (line 89), Future Improvements (line 744), Verification Plan E2E step 1 (line 1207)
* **Discrepancy Description:** The design admits there is "no proven edge" and says the backtest "should be run before live trading begins". But the backtest is E2E step 1, which comes after the server, dashboard and Pine are all built, and it has no pass/fail rule. The concepts brief (section 4) put the backtest before the server code. Future Improvements also lists a walk-forward comparison in `scripts/backtest.ts`, but file #40 already creates that script. The comparison is therefore both in scope and out of scope.
* **Rationale & Recommendation:** Deliver in phases. Phase 1 is `core/*` (indicators, signals, ratchet, simulator, selector, sizing), `scripts/backtest.ts` and the golden fixture, with no exchange code and no UI. Write down a pass/fail rule: for example, net P&L after fees is positive over the available history, and adaptive at least matches the best fixed strategy. If adaptive loses, the default `STRATEGY` becomes the winning fixed strategy. Build the executor and reconciler only after that (Phase 2), then the dashboard and insights (Phase 3). Remove the duplicate Future Improvements entry. This keeps every risk the author has accepted and just runs the cheapest test that could kill the idea first.

### 2. The DRY_RUN paper broker costs a lot and does not reduce the risk it targets - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** "DRY_RUN" (lines 527-535), file #25 `paperBroker.ts` (lines 980-987), Open Questions (lines 105-106), E2E step 4 (lines 1210-1215)
* **Discrepancy Description:** The risk it targets is "the first run of the order code uses real money". The paper broker replaces exactly that order code, so it tests none of these: how bracket PUT behaves, auto-cancel when the position goes flat, `reduce_only`, or fills. It is still a complete second `ExchangePort`, with a virtual position and bracket, a trigger loop on each reconcile tick, state copied into `kv`, and a `trades.dry_run` column. The concepts brief defined DRY_RUN as "log orders without sending them". The context doc names a Delta India testnet host, and `env.ts` (line 878) already accepts it.
* **Rationale & Recommendation:** Shrink DRY_RUN to "log the intent, send nothing", a few lines inside the executor, and delete `paperBroker.ts`. If the author agrees, point `DELTA_BASE_URL` at the testnet for a single smoke run of entry, trail, reverse and close. That exercises the real code and answers the open questions with no new code. Otherwise `MAX_CONTRACTS=1` on the live account is the real safety net, and the paper broker adds nothing to it.

### 3. The executor design rests on exchange behaviour nobody has checked - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Open Questions (lines 105-107), Trailing ratchet (lines 343-349), Entry/Close sequences (lines 381-406), E2E step 4 (line 1215)
* **Discrepancy Description:** The whole trailing model assumes `PUT /v2/orders/bracket` edits the stop in place, and the close and reversal sequences assume a particular auto-cancel behaviour. If PUT actually cancels the stop and creates a new one, every hourly trail leaves a gap with no stop. The rule for a failed PUT ("leave the old stop in place", line 349) would then be unsafe, because the old stop may already be gone. The design plans to learn this on the first real-money trade, after the executor is written.
* **Rationale & Recommendation:** Answer both questions before writing the executor, using the testnet or a manual 1-contract trade through the Delta UI or curl. Write the design branch for each possible answer now. For example, if PUT creates a new stop, check after every trail that the new stop exists, and attach a fresh bracket if it does not.

### 4. Close and reversal intent is not saved, so a restart can mislabel exits and corrupt the breaker - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Position state machine (lines 238-252), Persistence `trades.status` (line 443), Reconciler table row "flat / any / OPEN" (line 416), file #26 (line 993), Goal 8 (line 77)
* **Discrepancy Description:** The state machine has a CLOSING state, and file #26 promises "an outbox row written before every order". But `trades.status` only allows OPENING, OPEN, CLOSED and FAILED. Suppose the process crashes after a reversal, manual close or `trail_breached` close is sent, but before the DB is updated. On restart the reconciler sees a flat position with an OPEN trade and treats it as an exchange SL/TP exit. It labels the trade `sl_stage_N` and updates the breaker on that basis. A crash between the close leg and the entry leg of a reversal is also not covered.
* **Rationale & Recommendation:** Add a `CLOSING` status with a `close_reason` and the close `client_order_id`, and write it before the close order is sent. The reconciler should classify a flat position with a CLOSING trade from that stored intent, or by matching the `eth-<t>-close` client id, not by guessing from prices. Add the matching row to the reconciler table and its tests.

### 5. The circuit breaker does not cap account loss - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Circuit breaker (lines 423-436), Risks (line 63), Goal 7
* **Discrepancy Description:** Each stop costs about 14-16% of the account. The only automatic halt counts back-to-back `sl_stage_0` exits, and only a profitable trade resets the count. Losses from reversals, `trail_breached` closes and partial exits never count. So a mix of 2 initial stops and losing reversals can repeat with no limit, and losses can go well past the "about 40%" the Risks section presents as the worst case. The concepts brief recommended a daily-loss limit, and the design dropped it without saying why.
* **Rationale & Recommendation:** Add one equity-based rule next to the 3-stop rule: halt if the balance falls below a configured share of its peak, or below a fixed floor. It is one number checked on every exit, and it covers every way of losing money. Keep the 3-stop rule because the author asked for it. If the daily-loss limit was dropped on purpose, record that among the alternatives considered.

### 6. Insight rule 3 needs data the design never stores - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Insight rules #3 (lines 487-488), Persistence (lines 438-451), file #22 `computeInsights(trades, events, simScores, params)` (line 958), Alternative E (line 623)
* **Discrepancy Description:** The rule "live vs simulated per strategy, more than $20 per trade" needs each simulated trade matched to its live trade. Persistence stores only per-candle scores in `decisions`. The simulator reruns every hour over a 2000-bar window that moves forward, so earlier simulated trades are never saved and the rule cannot be computed as written. Alternative E's rejection relies on this rule as the safeguard for the selector.
* **Rationale & Recommendation:** Either save simulated trades in a `sim_trades` table keyed by strategy and entry time and upserted each cycle, or reduce the rule to something stored data can answer. One option is to compare live entry and exit prices with the next candle's open after each decision. If the rule stays as the selector's safeguard, it has to be computable.

### 7. The Pine strategy repeats the TS selector, and the design says the result is only approximate - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** "Pine strategy" (lines 537-549), file #46 (lines 1144-1154), Goal 11
* **Discrepancy Description:** The design names the TS simulator "the reference backtest" (line 548) and says the Pine broker emulator "can differ from the SL-first rule". Pine is still asked to rebuild the adaptive selector from `var` arrays of virtual trades for each strategy, plus the full ratchet. That is a second, harder implementation in a weaker language, and it is expected to disagree with the reference. The only things Pine alone provides are checking on the chart and the golden-fixture export.
* **Rationale & Recommendation:** Limit `eth_strategy.pine` to the Hull and UT parity code, signal markers, and one fixed mode (Hull only or UT only) with the bracket and ratchet so the author can check it on the chart. Drop Adaptive mode from Pine and do the adaptive comparison in `scripts/backtest.ts`.

### 8. The dashboard and insights are large for a single-user v1 and block the first trade - Severity: Major
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** API and dashboard (lines 453-480), Insight rules (lines 482-493), files #36-#45, Alternative M (lines 677-681)
* **Discrepancy Description:** Before the first trade, v1 includes all of these:
  * a React and Vite single-page app with a router, 5 pages and 5 components
  * recharts and a shared-types path alias
  * a stats engine (profit factor, drawdown, equity curve)
  * 8 insight rules with tuned thresholds
  * a SQLite `login_attempts` table

  Alternative M rejects simpler pages as "harder to grow", but the design lists multiple users as a non-goal, so that growth may never happen. The insight thresholds (30%, 40%, 50%, 5%, -2x stop) are guesses made before any data exists, and every rule needs at least 10 trades before it says anything.
* **Rationale & Recommendation:** Keep the app if the author wants it, but move it to Phase 3 (see finding 1). For the first live phase, the `decisions` and `trades` tables, `/api/status` and Telegram alerts are enough. Add insight rules once about 10 real trades exist and it is clear which questions matter. Rate-limit logins in memory or leave it to Caddy, rather than adding a table.

### 9. The margin mode is never stated - Severity: Nit (could be Major depending on the account default)
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Sizing and leverage (lines 356-366)
* **Discrepancy Description:** The context doc and the brief assume "20x isolated". The design sets and checks leverage but never says whether margin is isolated or cross, and never checks it. Under cross margin the liquidation reasoning changes, including the claim that liquidation sits outside the $20 stop, and the whole wallet is at risk.
* **Rationale & Recommendation:** State which margin mode the bot needs. Check it at startup with the product check, and refuse to trade if it does not match.

### 10. The mutex is held long enough to block manual controls - Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** "What happens on each candle close" step 1 (line 219), file #27 (line 1000), `POST /api/control/close`
* **Discrepancy Description:** The cycle holds the mutex while it retries for the candle to be ready, for up to 2 minutes. The manual close route and the reconciler wait on the same mutex, so an emergency close from the phone can stall for 2 minutes.
* **Rationale & Recommendation:** Wait for candles before taking the mutex, and hold it only while deciding and executing.

### 11. The parity tolerance is stated two ways - Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Goal 4 (line 73), Golden test (line 286)
* **Discrepancy Description:** The goal allows one tick (0.05). The golden test asks for 1e-6 "(to 0.05 at worst)". It is unclear which one fails the build.
* **Rationale & Recommendation:** Pick one pass/fail threshold, add a requirement that signals land on the same bars, and use the same wording in both places.

### 12. The Detailed Implementation Plan has too much low-level detail - Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Files #1-#8, #12, #36, #39, #45 (lines 776-845, 880-883, 1063-1069, 1087-1090, 1139-1142)
* **Discrepancy Description:** Some entries are coding choices that do not affect the design: `.gitignore` entries, tsconfig flags, bcrypt cost 12, a 10kb JSON body limit, CSS colours and npm script names. They make a long document longer and hide the parts that matter, the executor and the reconciler.
* **Rationale & Recommendation:** Merge the setup files (package.json, tsconfig, vitest, .gitignore, ecosystem, Caddyfile, README, styles) into one "project setup" entry. Keep detail only where the bot's behaviour depends on it.

### 13. The state machine diagram does not match the text - Severity: Nit
* **Reviewer Lens:** `zoom-out`
* **Affected Scope:** Position state machine diagram (lines 240-249)
* **Discrepancy Description:** Some arrows conflict with the note that HALTED is not a position state (line 251): CLOSING into HALTED, "manual close / trail-breached" into CLOSING, and Resume from HALTED back to FLAT. A new reader cannot tell which transitions are real.
* **Rationale & Recommendation:** Redraw the diagram with position states only (FLAT, OPENING, OPEN, CLOSING), and describe HALTED separately as a flag that only blocks new entries.
