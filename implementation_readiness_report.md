# Goldfish Review Report: Stage 9 (Implementation Readiness Test), Round 1

**Target:** `/Users/shakildodhiya/Desktop/tradingbot-eth/docs/designs/eth_trading_bot.md`
**DetailedRange:** lines 878-1352 (`## Detailed Implementation Plan` to end of file)
**FeatureRange:** lines 1-877. The Technical Plan (lines 180-657) was revised in Stage 7.

## Reviewer Status

| Reviewer | Status | Notes |
| --- | --- | --- |
| `egm-implementation-readiness` | **not run** | The first spawn was blocked by a transient permission-check failure before the reviewer started. The reviewer then failed twice with an API error (server_error), including the one allowed retry. No findings. This is not a zero-findings result. |
| `egm-codebase-details` | completed | Raw count: 3 Blocker, 15 Major, 13 Nit. Files read: target, API context, concepts brief, zoom-out report, bot.pine lines 910-1039. |
| `egm-style` | completed | Raw count: 4 Blocker, 14 Major, 14 Nit. Files read: target only. It did not open the GoldfishContext files and said its findings do not depend on them. |

**Overall verdict:** NOT READY. Both reviewers that ran returned FAIL / NOT READY. Most Stage 7 revisions did not reach the Detailed Implementation Plan, and none of the five Stage 8 findings is addressed.

**After deduplication:** 5 Blocker, 20 Major, 18 Nit (43 findings).

**How findings were merged:**
- When both reviewers raised the same issue, the finding keeps the id of the reviewer who described it more fully and lists the other as "also raised by".
- When the two reviewers rated the same issue differently, the synthesizer picked a severity and recorded both ratings.
- Style M6 (product-check name) was dropped. The reviewer itself said no change was needed beyond the ticker gap, which is covered in codebase-details-1-9.

## Stage 8 Carry-over Check

| # | Stage 8 finding | Status | Finding id |
| --- | --- | --- | --- |
| 1 | ctl CLI cannot share the in-process mutex | Not addressed | codebase-details-1-4 |
| 2 | `trades` lacks `sl_order_id` / `tp_order_id` | Not addressed | codebase-details-1-3 |
| 3 | No read-back after the trail PUT | Not addressed | codebase-details-1-7 |
| 4 | Pine adaptive selector scope | Not addressed | codebase-details-1-8 |
| 5 | tsconfig `rootDir "."` writes `dist/src/index.js`, but PM2 runs `dist/index.js` | Not addressed | codebase-details-1-1 |

## Stage 7 Revision Coverage (from the caller's list)

| Stage 7 element | Reflected in DetailedRange? | Finding id |
| --- | --- | --- |
| `system_events` table | No | codebase-details-1-2 |
| `sim_trades` table | No | codebase-details-1-2 |
| CLOSING status | Not tested; missing from the type list | codebase-details-1-16, codebase-details-1-27 |
| ctl CLI | No | codebase-details-1-4 |
| Tickers endpoint | No port method | codebase-details-1-9 |
| Margin-mode check | No | codebase-details-1-10 |
| Stage enum 0/1/2 | Contradicted (test says 0→3) | codebase-details-1-6 |
| Exit classification | No data source | codebase-details-1-3 |
| Missed-flip rule | No | codebase-details-1-15 |
| `/health` rules | Only one of four conditions | codebase-details-1-12 |
| Login backoff | Contradicted (described as a "rate limit") | codebase-details-1-13 |

---

## Prioritized Findings

### Blockers

#### codebase-details-1-1: Build output path does not match the start path - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 911, 923, 948 (also 646 in the FeatureRange)
* **Discrepancy Description:**
  - The tsconfig sets `rootDir: "."` and includes both `src` and `scripts`, so `tsc` writes `dist/src/index.js`.
  - The `start` script, the PM2 config and the Deployment section all run `dist/index.js`, so the process will not start.
  - Also unstated:
    - how `src/api/server.ts` finds `web/dist` (line 1199);
    - the PM2 `cwd`, which decides where `.env` and `data/` are resolved.
* **Rationale & Recommendation:**
  - Either set `rootDir: "src"`, include only `src`, and keep `scripts/*` on `tsx` (as lines 915-916 already do), or change every start path to `dist/src/index.js`.
  - State how `web/dist` is resolved: from `process.cwd()` or from `import.meta.url`.
  - Set `cwd` in `ecosystem.config.cjs`.

#### codebase-details-1-2: Migration 1 does not create `system_events` or `sim_trades` - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` B1)
* **Affected Scope:** line 1173 (Migration 1); lines 1179-1185 (repo helpers). FeatureRange: lines 230, 354, 495, 515-519, 566-575.
* **Discrepancy Description:**
  - Several features depend on `system_events`:
    - strategy-switch, halt, resume, boot, `cycle_missed` and `reconcile_mismatch` rows;
    - the "last switch reason" shown in `/api/status`;
    - insight rule 8.
  - Insight rule 3 depends on `sim_trades`.
  - Neither table is created, and `repo.ts` has no helpers for them.
  - `addEvent` does not say which events table it writes to.
* **Rationale & Recommendation:**
  - Add both tables to Migration 1, using the columns from lines 515 and 519.
  - Add these repo helpers: `addTradeEvent`, `addSystemEvent`, `listSystemEvents(type?)`, `replaceSimTrades(rows)` (in one transaction) and `listSimTrades(strategy)`.

#### codebase-details-1-3: Exit classification has no data source; the breaker can be silently disabled - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (Stage 8 item 2)
* **Affected Scope:** lines 1154-1158, 1173. FeatureRange: lines 436, 474-481, 506-513.
* **Discrepancy Description:**
  - The reconciler classifies exits by matching fills to the SL and TP order ids, but `trades` stores neither id.
  - No fill field is named for detecting a liquidation, and the API context does not document the `GET /v2/fills` response.
  - An unmatched `sl_stage_0` exit falls through to `external`. That exit does not count toward the 3-stop breaker (Goal 7), so the breaker is silently switched off.
* **Rationale & Recommendation:**
  - Add `sl_order_id` and `tp_order_id` to `trades`. Write them at entry step 6 and after every trail, reattach or replace.
  - Name the fill fields used for classification and for liquidation detection.
  - Add reconciler tests for:
    - an SL fill that gapped far from the stop price;
    - an SL fill after the stop order was replaced;
    - a liquidation fill.

#### codebase-details-1-4: ctl CLI has no file or script, and cannot share the in-process mutex - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` B2). Codebase-details rated it Major and style rated it Blocker. Kept as Blocker because the FeatureRange names ctl as the recovery path four times.
* **Affected Scope:** lines 909-916, 1126-1129, 1218-1229. FeatureRange: lines 498, 538, 788, 858.
* **Discrepancy Description:**
  - The FeatureRange promises `npm run ctl -- pause|resume|close|status` using "the same executor and mutex".
  - The plan has no `scripts/ctl.ts` and no `ctl` npm script.
  - The mutex in file #27 is an in-process promise mutex, so a separate CLI process cannot take it (Stage 8 item 1).
* **Rationale & Recommendation:** Pick one:
  - Add `scripts/ctl.ts` as a thin HTTP client that calls `/api/control/*` on loopback, add a `ctl` npm script, and state how it handles auth and CSRF (line 551).
  - Or remove ctl from lines 498, 538, 788 and 858 and document `ssh -L 3000:127.0.0.1:3000` instead.

#### codebase-details-1-5: Golden fixture contradicts the parity spec - Severity: Blocker
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` B4). Codebase-details rated it Major and style rated it Blocker. Kept as Blocker because the parity test is the main correctness check.
* **Affected Scope:** line 1295 (file #48), line 1339 (E2E step 2). FeatureRange: lines 112, 305-306.
* **Discrepancy Description:**
  - File #48 says "about 500 Delta ETHUSD 1h candles".
  - The spec says about 700 bars of TradingView OHLC exported from one chart. The point is that the test then does not depend on TradingView carrying the Delta feed.
  - After the 200-bar warm-up, 500 bars leaves only 300 bars to compare.
  - The E2E step says to use "the Delta ETHUSD perp" on TradingView, which line 112 says may not exist.
  - The fixture's column list is incomplete.
* **Rationale & Recommendation:**
  - Use about 700 TradingView bars with columns `time, open, high, low, close, hull, ut_stop`.
  - Use the same column names in both sections.
  - Change line 1339 to "any ETHUSD perp chart".

### Majors

#### codebase-details-1-6: Ratchet test uses a non-existent stage 3 - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` B3). Style rated it Blocker. Rated Major here because it is a one-word fix in a test description.
* **Affected Scope:** line 1306. FeatureRange: lines 373, 378.
* **Discrepancy Description:** The test says "stage jumps 0→3", but the only stages are 0, 1 and 2.
* **Rationale & Recommendation:** Change it to "0→2".

#### codebase-details-1-7: Trail PUT is not verified, and the retry, breach and fallback steps are missing - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (Stage 8 item 3)
* **Affected Scope:** line 1122 (executor `trail`); tests at lines 1321-1326; line 1343. FeatureRange: lines 380-384.
* **Discrepancy Description:**
  - The plan has no read-back after the PUT.
  - It omits the 3-retry-then-alert policy, the `trail_breached` market close and the cancel-and-recreate fallback.
  - No test covers any of these.
* **Rationale & Recommendation:**
  - Spell out the `trail` steps:
    1. Compute `newSL`.
    2. Check for a breach against the ticker price.
    3. Send the PUT.
    4. Read orders back with `GET /v2/orders?product_id=3136`.
    5. If the stop is missing or at the wrong price, reattach it with `POST /v2/orders/bracket`.
    6. Store the new `sl_order_id` and write an `sl_move` event.
  - Add tests for:
    - a PUT that fails 3 times, after which the old stop is kept;
    - a breach that leads to a close;
    - a read-back mismatch that leads to a reattach.

#### codebase-details-1-8: Pine adaptive selector scope still unclear - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (Stage 8 item 4)
* **Affected Scope:** line 1281 (file #46); line 594 (registry). FeatureRange: line 629.
* **Discrepancy Description:** File #46 still lists "the selector, with `mode`", and line 629 still asks for an Adaptive mode built from `var` arrays. Neither line drops Adaptive or records it as accepted scope.
* **Rationale & Recommendation:** Pick one:
  - Limit Pine to `mode` = Hull only / UT only, and remove `selN` and `selMargin` from the registry's Pine column.
  - Or fully specify the Adaptive `var` array structure.

#### codebase-details-1-9: `ExchangePort` lacks ticker, margin-mode and single-order cancel methods - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M5)
* **Affected Scope:** lines 1092-1095, 1115. FeatureRange: lines 384, 394, 398.
* **Discrepancy Description:**
  - The plan uses `GET /v2/tickers/ETHUSD` for the margin cap, the initial bracket prices, `trail_breached` and paper fills, but the port has no ticker method.
  - The port cannot read the margin mode.
  - The "place new stop, then cancel old" fallback needs a single-order cancel, and `cancelAll` would also remove the TP.
* **Rationale & Recommendation:** Add `getTicker(symbol) → {close, mark_price}`, `getMarginMode()` and `cancelOrder(id)`, each with its endpoint.

#### codebase-details-1-10: Margin-mode check is missing from boot and entry, and its endpoint is undecided - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M4)
* **Affected Scope:** lines 979-990, 984-988, 1122. FeatureRange: lines 110, 398, 819.
* **Discrepancy Description:**
  - Line 398 requires the isolated-margin check at boot and before every entry. The boot steps and the entry sequence omit it.
  - The endpoint is still an open question (line 110), which breaks the Zero-Decision Rule.
* **Rationale & Recommendation:**
  - Add a boot step and an entry pre-check.
  - Name the endpoint, or add an `ISOLATED_MARGIN_CONFIRMED=true` env flag as the fallback.
  - Add a test that the bot refuses to enter on cross margin.

#### codebase-details-1-11: package.json dependencies are incomplete and the module type is unstated - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 884-899, 912-917, 923
* **Discrepancy Description:**
  - These dependencies are missing:
    - `tsx` and `typescript`;
    - the `@types/*` packages for `node`, `express`, `better-sqlite3`, `cookie-session` and `bcryptjs`;
    - the web dev dependencies: `vite`, `@vitejs/plugin-react` and the React types.
  - The package `"type"` is unstated. With `module: NodeNext`, it decides ESM or CJS output and whether imports need `.js` extensions.
* **Rationale & Recommendation:** List every dev dependency. State `"type": "module"` and that relative imports carry `.js` extensions.

#### codebase-details-1-12: `/health` 503 rules are not implemented - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` N6)
* **Affected Scope:** lines 1099-1107, 1199, 1214, 1329. FeatureRange: lines 527-531.
* **Discrepancy Description:**
  - There are four 503 conditions, and no file owns them.
  - `deltaClient` keeps no consecutive-failure counter, and nothing tracks a bracket that has not been confirmed.
  - "Last cycle" is undefined.
  - The tests cover only the vague "stale" case.
* **Rationale & Recommendation:**
  - Map each condition to a source:
    - `kv.halted`;
    - a `bracketOk` flag in the reconciler snapshot;
    - `kv.last_processed_candle`, older than 65 minutes;
    - `deltaClient.consecutiveFailures` of 3 or more.
  - Add a test for each condition.

#### codebase-details-1-13: Login backoff is described as a "rate limit" - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M2)
* **Affected Scope:** lines 1206, 1329. FeatureRange: lines 521, 537, 828, 840.
* **Discrepancy Description:**
  - The spec is a growing per-IP delay: 1, 2, 4 s and so on up to 60 s, reset after 15 minutes, with no hard lockout.
  - The plan says "failure rate limit" and tests a "login rate limit", which suggests rejection or lockout.
* **Rationale & Recommendation:**
  - Use the term "login delay".
  - State the formula: `min(60, 2^(failures-1))` seconds over a 15-minute window.
  - State whether the server holds the request open or returns 429 with `Retry-After` (Stage 8 recommended 429).
  - Test the boundaries and that no lockout happens.

#### codebase-details-1-14: Executor test relies on an unconfirmed `client_order_id` lookup - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 1095, 1323. FeatureRange: lines 109, 420.
* **Discrepancy Description:**
  - The main retry guard is re-reading the position size.
  - The test instead checks a lookup by `client_order_id`, which is still an open question, so `getOrderByClientId` may not exist.
* **Rationale & Recommendation:** Test the position-size re-read guard. Make `getOrderByClientId` optional or remove it.

#### codebase-details-1-15: Missed-flip rule has no direction state, cycle module or tests - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M8)
* **Affected Scope:** lines 1040, 1147, 1299-1329. FeatureRange: lines 232-243, 317-319.
* **Discrepancy Description:**
  - `computeAll` returns `hullUp` but no UT direction state, which the missed-flip rule needs.
  - NaN directions are not handled.
  - The plan has no `tests/cycle.test.ts` covering the 8-row action table.
  - The plan never mentions `missed_flip`.
* **Rationale & Recommendation:**
  - Return `utUp` (`src > stop`) from `computeAll`.
  - State that a NaN direction never counts as disagreeing.
  - Name the `missed_flip` handling in `cycle.ts`.
  - Add `tests/cycle.test.ts` covering:
    - every action-table row, including the halted rows;
    - a missed flip leading to REVERSE with `missed_flip`;
    - CYCLE_MISSED;
    - a duplicate candle being skipped.

#### codebase-details-1-16: Stage 7 crash-recovery paths are untested - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 1321-1327
* **Discrepancy Description:** No test covers:
  - CLOSING being written before the close is sent;
  - a close that does not reach flat leading to HALT;
  - a leverage mismatch that is re-set once and then blocks entry.

  The reconciler test only says "every row" of the decision table.
* **Rationale & Recommendation:** List these cases explicitly. Include the CLOSING row with the exchange flat and with it open, and each exit-classification row.

#### codebase-details-1-17: Insights signature does not match the rules' inputs - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M13)
* **Affected Scope:** line 1087. FeatureRange: lines 566-575.
* **Discrepancy Description:**
  - Rule 3 needs `sim_trades` rows, not `simScores`.
  - Rule 8 needs halt rows from `system_events`.
  - The parameter name `events` could mean either events table.
* **Rationale & Recommendation:** Use `computeInsights(trades, tradeEvents, systemEvents, simTrades, params)`.

#### codebase-details-1-18: File list is incomplete and uses a glob - Severity: Major
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 903-1329 (in particular lines 1097, 1245, 1296, 1299)
* **Discrepancy Description:**
  - These files are missing from the list:
    - the fake `ExchangePort` used by the tests;
    - the 30-bar hand-computed fixture;
    - `tests/cycle.test.ts`;
    - the 15 s polling hook;
    - the ctl script.
  - `tests/*.test.ts` is a glob. The standard allows globs only for generated output.
* **Rationale & Recommendation:** List each test file by path. Add `tests/fakes/fakeExchange.ts`, `tests/fixtures/hand_30.csv` and `web/src/usePolling.ts`.

#### codebase-details-1-19: `trust proxy` value differs from the Technical Plan - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` M1). Codebase-details rated it Nit and style rated it Major. Kept as Major because the value controls whether the client IP used for the login delay can be spoofed.
* **Affected Scope:** line 1198. FeatureRange: line 536.
* **Discrepancy Description:** The plan uses `1`. The Technical Plan uses `'loopback'` and justifies it: the IP "cannot be spoofed from outside".
* **Rationale & Recommendation:** Use `'loopback'` in both places.

#### codebase-details-1-20: Simulator summary and `SimTrade` type drift from the contract - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (N7) and `egm-style` (M10). Merged and rated Major.
* **Affected Scope:** lines 1055-1056, 1311. FeatureRange: lines 304, 321, 337, 519.
* **Discrepancy Description:**
  - The inline list of simulator rules reads as complete but omits:
    - the 1-tick slippage (`SLIPPAGE_TICKS`);
    - the warm-up and wait-for-flip rules.
  - `SimTrade` has `grossPnl` and `fees` but no `strategy`. The `sim_trades` table has the reverse.
* **Rationale & Recommendation:**
  - Either keep only the reference to the contract, or make the list complete.
  - Align `SimTrade` with `sim_trades`.
  - Add slippage to `simulator.test.ts`.

#### codebase-details-1-21: Decision `action` values are not a defined set - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (N6) and `egm-style` (M11). Merged and rated Major.
* **Affected Scope:** line 1147. FeatureRange: lines 234-243, 515.
* **Discrepancy Description:**
  - `'ERROR'` is not in the action table.
  - It is undefined what `decisions` row, if any, a missed or skipped cycle writes.
  - CYCLE_MISSED is not tied to the `system_events` `cycle_missed` type.
* **Rationale & Recommendation:**
  - List the full `action` enum, or record errors in `note`.
  - State that CYCLE_MISSED writes a `system_events` row.

#### codebase-details-1-22: Backtest "N" is undefined and the switch count is missing - Severity: Major
* **Reviewer Lens:** `egm-codebase-details` (N13) and `egm-style` (M12). Merged and rated Major.
* **Affected Scope:** lines 1227-1229. FeatureRange: line 86 (Goal 11).
* **Discrepancy Description:**
  - "N×2000 candles" never defines N, and the name collides with `SEL_N` and `BREAKER_N`.
  - The output omits the strategy-switch count that Goal 11 requires.
* **Rationale & Recommendation:**
  - Use a named CLI argument, for example `--pages <k>` with a stated default.
  - Add the switch count to the output.

#### style-1-1: `halt()` / `resume()` have no owning module - Severity: Major
* **Reviewer Lens:** `egm-style` (M3, merged with M14)
* **Affected Scope:** lines 983, 1123-1124, 1157, 1160. FeatureRange: lines 494-498.
* **Discrepancy Description:**
  - The executor, the reconciler, the crash-loop guard and the pause route all call `halt`, but no file defines it.
  - A halt must:
    - set `kv.halted` and `kv.halt_reason`;
    - write a `system_events` row;
    - send an alert.
  - The `consecutive_sl` reset on resume is not placed in any module.
* **Rationale & Recommendation:**
  - Put both functions in one module, for example `src/engine/halt.ts`.
  - State that they write `system_events` and handle the `consecutive_sl` reset.
  - Change the executor's event-writes line to "`trade_events`, and `system_events` for halts".

#### style-1-2: Crash-loop guard and nightly backup have no owning file - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 983. FeatureRange: lines 520, 642, 648, 826.
* **Discrepancy Description:**
  - The `kv.boot_times` crash-loop guard has no module.
  - The nightly SQLite `.backup` to `data/backups/` (keep 14) has no file entry, although the risk table relies on it.
* **Rationale & Recommendation:** Add files for both, for example `src/engine/bootGuard.ts` and `src/store/backup.ts`. Schedule the backup from the scheduler.

#### style-1-3: Pure `select()` is said to carry out rule 6, which has a side effect - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** lines 1062-1063. FeatureRange: lines 325, 354.
* **Discrepancy Description:** `select()` is described as pure, but rule 6 writes a `system_events` row.
* **Rationale & Recommendation:** Say that `select()` implements rules 1-5 and returns `{switched, reason}`, and that `cycle.ts` writes the `strategy_switch` event.

### Nits

#### codebase-details-1-23: Leverage boot step is incomplete - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** line 986. FeatureRange: line 400.
* **Discrepancy Description:** "Set leverage if flat" leaves out the case "otherwise, the first time the position is flat after boot". It also does not say who sets `kv.leverage_ok` or when.
* **Rationale & Recommendation:** Add both.

#### codebase-details-1-24: Boot steps omit Technical Plan items - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 979-990. FeatureRange: lines 111, 422, 515.
* **Discrepancy Description:** The boot steps leave out the `boot` row in `system_events`, the sanity check on the newest candle's time and the "Telegram not configured" warning.
* **Rationale & Recommendation:** Add them to the boot list.

#### codebase-details-1-25: 429 backoff and the dynamic reconcile interval have no hook - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 1104, 1142. FeatureRange: line 415.
* **Discrepancy Description:** The scheduler uses a fixed 60 s interval. Nothing implements doubling on a 429, up to 5 minutes.
* **Rationale & Recommendation:** Give the scheduler `backoff()` and `reset()` methods that `deltaClient` calls.

#### codebase-details-1-26: `/api/status` snapshot has no source - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** lines 1151-1160. FeatureRange: lines 113, 543.
* **Discrepancy Description:**
  - `reconcile()` produces no snapshot.
  - The live SL/TP, balance and unrealized P&L need extra reads on every reconcile, which affects the API call budget.
* **Rationale & Recommendation:** Name the snapshot object and its fields.

#### codebase-details-1-27: Shared types are incomplete - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details` (N8; merged with `egm-style` N10)
* **Affected Scope:** lines 1018-1025. FeatureRange: lines 349, 508-515.
* **Discrepancy Description:**
  - These types are missing:
    - the members of the `ExitReason` union;
    - `TradeStatus` (including CLOSING);
    - `Stage` (0 | 1 | 2);
    - `SystemEvent` and `SimTrade`.
  - `StrategyId` is lowercase, but the selector text uses `HULL`.
  - `StrategyId` excludes the `unknown` value used for adopted trades.
* **Rationale & Recommendation:** Enumerate every type with values copied from lines 508-515. State which type covers adopted trades.

#### codebase-details-1-28: "Also adds `dry_run INTEGER`" - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details` (also raised by `egm-style` N1)
* **Affected Scope:** line 1173
* **Discrepancy Description:** `dry_run` is already listed as a `trades` column at line 508.
* **Rationale & Recommendation:** Delete "Also adds".

#### codebase-details-1-29: Duplicated `trades` header - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details` (style also noticed it but gave no severity)
* **Affected Scope:** lines 506-507 (FeatureRange)
* **Discrepancy Description:** The `**trades:**` bullet appears twice.
* **Rationale & Recommendation:** Delete one of them.

#### codebase-details-1-30: Endpoints and request details are not in the API context - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** file #24 (around lines 1099-1107)
* **Discrepancy Description:**
  - These endpoints are not in the API context:
    - `GET /v2/orders`;
    - `GET /v2/fills`;
    - the leverage GET;
    - the margin-mode endpoint.
  - The leverage body type is unstated. The context gives it as a string, `"20"`.
  - The format of the signed query string is unstated. The context says it includes the `?`.
* **Rationale & Recommendation:**
  - Mark these endpoints "verify on first run".
  - State the body type and the query format.

#### codebase-details-1-31: Test expectations are ambiguous - Severity: Nit
* **Reviewer Lens:** `egm-codebase-details` (N12; merged with `egm-style` N4, N5)
* **Affected Scope:** lines 1307, 1310, 1316, 1319
* **Discrepancy Description:**
  - "Margin cap at $4,000" does not say whether $4,000 is the price or the balance, and gives no expected value.
  - The breaker tests omit `external` and `sl_stage_1`, both of which should leave the counter unchanged.
  - "exactly +12 and +25" and "no-change, no-PUT" are unclear.
* **Rationale & Recommendation:**
  - State the margin-cap inputs and the expected value. For example, a $300 balance at a $4,000 price and 20x gives 135.
  - Add the two missing breaker cases.
  - Reword:
    - "exactly +12 and +25" as "p exactly equal to the triggers (12, 25)";
    - "no-change, no-PUT" as "no PUT when the new SL differs by less than one tick".

#### style-1-4: "Records `schema_version`" - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1174. FeatureRange: lines 504, 520.
* **Discrepancy Description:** The value is stored as `kv.schema_version`.
* **Rationale & Recommendation:** Write "Sets `kv.schema_version = 1`".

#### style-1-5: Unverifiable claim "All follow the parity spec exactly" - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1032
* **Discrepancy Description:** This is a completeness claim. The golden test is what verifies parity.
* **Rationale & Recommendation:** Write "Implements the Indicator parity specification; verified by the golden test (file #48)".

#### style-1-6: "Stale lock" is undefined - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1134. FeatureRange: line 647.
* **Discrepancy Description:** The plan does not define a stale lock.
* **Rationale & Recommendation:** Write "a lock whose PID is not alive".

#### style-1-7: "Mirrored in `kv`" names no key - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1114. FeatureRange: line 520.
* **Discrepancy Description:** The key is `kv.paper_state`, but the plan does not name it.
* **Rationale & Recommendation:** Name the key.

#### style-1-8: `paramsHash()` vs `config_hash` - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1000. FeatureRange: lines 513, 542.
* **Discrepancy Description:** The same value is called `paramsHash()`, `config_hash` and "params hash".
* **Rationale & Recommendation:** Pick one term, or state that `paramsHash()` fills `trades.config_hash`.

#### style-1-9: "When below 1" - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1069
* **Discrepancy Description:** The quantity being compared to 1 is not named.
* **Rationale & Recommendation:** Write "when the final size is below 1 contract".

#### style-1-10: "Readable on a phone" is not measurable - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1273
* **Discrepancy Description:** The criterion cannot be tested.
* **Rationale & Recommendation:** State a minimum viewport width, for example 360 px with no horizontal scroll on Overview.

#### style-1-11: Wordy sentence - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** line 1290
* **Discrepancy Description:** "Listed so it is clear it was left as it is on purpose" is wordy.
* **Rationale & Recommendation:** Write "Intentionally unchanged."

#### style-1-12: Wording drift in three places - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** lines 928, 1106, 1122, 1154, 1214, 1336, 1346
* **Discrepancy Description:**
  - "auto-cancel" (line 1346) does not match the Open Question title "Bracket after flat or flip" (line 107).
  - The generic references to "Technical Plan" do not point to a subsection.
  - The 85% coverage target names no metric at line 928, but line 1336 says "line coverage".
* **Rationale & Recommendation:**
  - Reuse the Open Question's title.
  - Link the specific subsections.
  - Say "line coverage" at line 928.
  - Point to the test bullets at lines 1321-1327 explicitly.
