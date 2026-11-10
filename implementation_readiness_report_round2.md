# Goldfish Review Report: Stage 9 Implementation Readiness, Round 2

**Target:** `/Users/shakildodhiya/Desktop/tradingbot-eth/docs/designs/eth_trading_bot.md` (DetailedRange: lines 891-1756, checked against FeatureRange lines 1-889)

**Verdict: NOT READY.** There is 1 Blocker and 14 Majors. Most of them are local edits to a file entry plus one test.

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-implementation-readiness` | completed |
| `egm-codebase-details` | completed |
| `egm-style` | completed |

## Round-1 fix landing check

- `implementation-readiness` and `codebase-details` found all 43 round-1 fixes in the text.
- `style` found that 3 fixes landed only in part. The synthesizer checked these by grep and confirmed them:
  - **Fix [10] test:** there is no test for "refuses to start live without `ISOLATED_MARGIN_CONFIRMED`" (boot step 7, line 1032). This is merged into style-2-1 below.
  - **Fix [30] strategy-id case:** line 349 still says `active = HULL`. Lines 1077 and 1146 use `'hull'`. See style-2-3.
  - **Fixes [10]/[23] margin-mode wording:** lines 110 and 832 still say the check runs before entry. The design checks after the fill (lines 400 and 1240). See style-2-2.
- Two fixes landed but caused new problems at the same scope:
  - Fix 1-10 (post-fill margin check) caused codebase-details-2-1.
  - `HaltKind` caused implementation-readiness-2-2.

Severity counts after deduplication: **1 Blocker, 14 Major, 20 Nit.**

## Prioritized Findings (Blockers -> Major -> Nits)

### Blocker

#### codebase-details-2-1: The post-fill margin-mode check closes and halts almost every live entry
* **Reviewer Lens:** `codebase-details` (Blocker). `implementation-readiness` and `style` raised the same issue as Major.
* **Affected Scope:** lines 1195, 1239-1240. FeatureRange line 400. `egm_context_delta_api.md` line 25.
* **Discrepancy Description:**
  * `getMarginMode()` reads `GET /v2/positions/margined`. The API context says this endpoint may lag by about 10 s. When no position shows, the function returns `'unknown'`.
  * `enter` calls it as soon as the real-time `/v2/positions` shows the fill. At that point the margined list often does not show the position yet.
  * Line 1240 closes and halts (`fatal_error`) on any value other than `'isolated'`. A correctly isolated trade is therefore market-closed and the bot halts.
  * The same happens on every trade if the `margin_mode` field name is wrong. That field name is still on the "verify on first run" list (line 918).
* **Rationale & Recommendation:**
  * Poll `/v2/positions/margined` every 1 s for up to 15 s, until the position appears.
  * Close and halt only when the result is explicitly `'cross'`.
  * If the result is still `'unknown'` after the timeout, alert and keep the position. The reconciler re-checks on later ticks. Optionally, halt without closing after a set time, for example 5 minutes.
  * Use a dedicated `ExitReason` such as `margin_mode` instead of `close('manual')`, and pass `candleTime` (the current hour).
  * Add executor tests for "margined lags, then shows isolated: no close" and "field absent: no close".

### Major

#### implementation-readiness-2-1: No module finishes bot-initiated closes or updates the breaker for them
* **Reviewer Lens:** `implementation-readiness`
* **Affected Scope:** lines 445-455, 466, 489-492, 1237-1238, 1325, 1360.
* **Discrepancy Description:**
  * The close sequence ends at "read the fills". Nothing says who sets `CLOSED`, computes `gross_pnl`/`net_pnl`, or calls `breaker.nextCount`. Only the reconciler calls it.
  * In a reversal, `enter()` inserts a new `OPENING` row while the old row is still `CLOSING`. `openTrade()` returns a single row, so it is unclear which one it returns.
  * As a result, a profitable reversal may never reset `consecutive_sl`.
* **Rationale & Recommendation:**
  * Make `executor.close()` step 6 do the bookkeeping: set `CLOSED`, write `exit_*`, gross P&L (`size x 0.01 x dprice`), fees (sum of fill `commission`) and net P&L, then call `nextCount`, write `kv.consecutive_sl`, and call `halt` when the breaker trips.
  * Keep the reconciler's `CLOSING` row only for crash recovery.
  * Define `openTrade()` to return the newest non-terminal row.
  * Add a test that a profitable reversal resets the counter.

#### implementation-readiness-2-2: Three of the six `HaltKind` values have no action-table row, and no kv key stores the kind
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`, `style`
* **Affected Scope:** lines 1084, 1165, 1276, 1281, 1641, 521, 500. FeatureRange lines 240-243.
* **Discrepancy Description:**
  * The table maps only "breaker or manual" and "mismatch or unknown state". `fatal_error`, `crash_loop` and `liquidation` are not mapped, so the "halted rows by kind" test cannot be written.
  * `halt()` "stores the kind", but `kv` has no `halt_kind` key.
  * Line 500 bases the counter reset on "halt reason".
* **Rationale & Recommendation:**
  * Add an explicit mapping. Suggested: `breaker` and `manual` go to TRAIL/CLOSE, and `mismatch`, `fatal_error`, `crash_loop` and `liquidation` go to NONE. The reviewers disagree on `crash_loop`, so the author must choose.
  * Add `kv.halt_kind` at line 521 and in file 30.
  * Reword line 500 to "only if `halt_kind` is `breaker`".
  * Add one `decide.test.ts` case per kind.

#### implementation-readiness-2-3: The build order leaves files out, and phase 1 does not compile on its own
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`, `style`
* **Affected Scope:** lines 1635, 1722-1727.
* **Discrepancy Description:**
  * No phase lists files 1-12 (package.json, tsconfig, vitest config, `params.ts`, env, log) or test 68.
  * Phase-1 test 61 exercises `resume()`, which lives in `src/engine/halt.ts`, a phase-2 file.
  * The plan does not say whether `backtest.ts` (phase 1) uses `deltaClient` (phase 2) or plain `fetch`.
* **Rationale & Recommendation:**
  * Phase 1: files 1-5, 10, 12, 13-23, 45, 52-62 and 68.
  * Phase 2: files 6-9, 11 and 24-44, plus tests 63-67.
  * Move the `resume()` case to a phase-2 test.
  * State that the backtest uses unauthenticated `fetch` on `/v2/history/candles`.

#### implementation-readiness-2-4: The adaptive backtest has no specified algorithm
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`
* **Affected Scope:** lines 1125-1137, 1143, 1454. FeatureRange lines 86 and 343-344. Goal 11.
* **Discrepancy Description:**
  * `simulate()` runs one strategy in batch. "Replays `select` bar by bar" leaves the rest to the implementer:
    * scoring as of bar t;
    * the position whose signal source can change;
    * rules 3 and 4, the ratchet and the missed-flip rule;
    * switch counting.
  * This output is the go-live gate.
* **Rationale & Recommendation:**
  * Specify `simulateAdaptive(candles, sigs, params) -> {trades, switches}`.
  * Per bar: score each strategy from its last 10 sim trades with `exitTime < t`; call `select` with the adaptive `isFlat`/`positionSide`; apply `decide`-equivalent rules with the same fee, slippage and exit mechanics.
  * Add a test for it in `simulator.test.ts`.

#### implementation-readiness-2-5: The paper broker does not specify fills or which order methods are virtual
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`
* **Affected Scope:** lines 617-625, 1224-1232, 1323-1325, 1738.
* **Discrepancy Description:**
  * The plan does not say whether `getFills`, `getOpenOrders`, `editBracket`, `placeBracket`, `cancelOrder`, `getLeverage`/`setLeverage` and `getPosition` are virtual or passed through to Delta.
  * If they pass through, paper SL hits are classified `external`, and "breaker runs unchanged" fails in the DRY_RUN step of the end-to-end plan.
* **Rationale & Recommendation:**
  * List every `ExchangePort` method as either virtual or passed through.
  * Virtual fills should use the virtual SL/TP `order_id`, a price at the trigger plus or minus 1 tick, and commission at `FEE_RATE`.
  * Add `tests/paperBroker.test.ts`.

#### implementation-readiness-2-6: Safety modules and the boot sequence have no tests
* **Reviewer Lens:** `implementation-readiness`, `codebase-details`, `style` (style found the partial landing of round-1 fix [10])
* **Affected Scope:** files 22, 26, 28-32, 38. Boot step 7 at line 1032.
* **Discrepancy Description:**
  * No tests cover `lock.ts` (second-instance guard, Goal 8), `bootGuard.ts`, `halt.ts`, `scheduler.ts`, `stats.ts`, `paperBroker.ts`, `backup.ts`, or the boot sequence, including the round-1 test "refuses live without `ISOLATED_MARGIN_CONFIRMED`".
  * Coverage is enforced only on `src/core/**`, so nothing flags this gap.
* **Rationale & Recommendation:** Add named test files with explicit cases:
  * `lock.test.ts`: a live PID is refused; a dead PID is replaced.
  * `bootGuard.test.ts`: more than 5 boots in 10 minutes halts; old entries are trimmed.
  * `scheduler.test.ts`: arming at HH:00:10; backoff up to 300 s; reset.
  * `stats.test.ts`: profit factor; drawdown.
  * `backup.test.ts`: keeps 14 files; never throws.
  * `boot.test.ts`: the `ISOLATED_MARGIN_CONFIRMED` refusal.

#### codebase-details-2-2: `trail()` does not say where the current SL comes from, and some steps do not say to return
* **Reviewer Lens:** `codebase-details`, `style`, `implementation-readiness`
* **Affected Scope:** lines 1237, 1243-1249. FeatureRange lines 380 and 383.
* **Discrepancy Description:**
  * Step 1 compares against "the exchange's current SL", but the first order read is step 4. Line 380 forbids a cached value, and the snapshot can be up to 60 s old.
  * Steps 2 and 3 do not say to return. If step 3 falls through, steps 4-5 place an extra stop order on a live position.
* **Rationale & Recommendation:**
  * Add step 0: `getOpenOrders()`, taking the SL's `stop_price` and id.
  * Add "then return" after step 2 and after step 3.
  * Rename the parameter to `closePrice`, because `close` is also the name of the `close()` operation that step 2 calls.

#### codebase-details-2-3: `tsconfig.scripts.json` conflicts with `rootDir`, and the `lint` script contradicts the Verification Plan
* **Reviewer Lens:** `codebase-details` (Major). `implementation-readiness` and `style` raised it as a Nit.
* **Affected Scope:** lines 946, 956-957, 1733.
* **Discrepancy Description:**
  * The base config sets `rootDir: src`, so including `scripts/` and `tests/` likely triggers TS6059. The reviewer could not confirm this with a tool run.
  * The `lint` script is `tsc --noEmit`, which uses the base config and never checks `scripts/` or `tests/`. The Verification Plan uses `-p tsconfig.scripts.json`.
  * "Vitest uses it" is inaccurate, because vitest does not type-check.
* **Rationale & Recommendation:**
  * Override `"rootDir": "."` in `tsconfig.scripts.json`.
  * Set `lint` to `tsc --noEmit -p tsconfig.scripts.json`.
  * Drop the vitest claim.
  * List `tsconfig.scripts.json` as its own Create entry.

#### codebase-details-2-4: The `getFills` `start_time` unit is unstated
* **Reviewer Lens:** `codebase-details` (Major). `implementation-readiness` raised it as a Nit.
* **Affected Scope:** lines 916, 1204. FeatureRange line 453.
* **Discrepancy Description:**
  * Every other time value in the plan is unix seconds.
  * The reviewer recalls that Delta fills and order history may use microseconds. This is not covered by the supplied API context.
  * With the wrong unit, the bot gets no fills or all fills, and exit classification and the breaker fail silently.
* **Rationale & Recommendation:** Name the unit (provisionally microseconds) and add it to the "verify on first run" list.

#### style-2-1: Env booleans can be parsed unsafely
* **Reviewer Lens:** `style`
* **Affected Scope:** line 1057.
* **Discrepancy Description:** "`ISOLATED_MARGIN_CONFIRMED` is a boolean" leaves the parsing open. The usual zod idiom, `z.coerce.boolean()`, turns the string `"false"` into `true`, which silently enables a safety flag. `DRY_RUN` has the same problem.
* **Rationale & Recommendation:** Use `z.enum(['true','false']).transform(v => v === 'true')`. Add a test that `"false"` parses as false.

#### style-2-4: The leverage read-back before every entry was dropped
* **Reviewer Lens:** `style`
* **Affected Scope:** lines 1036, 1250, 1326. FeatureRange line 403.
* **Discrepancy Description:** The FeatureRange reads leverage back before every entry. The Detailed Plan calls `ensureLeverage()` only when `kv.leverage_ok = 0`, so a later leverage change in the Delta app goes unnoticed.
* **Rationale & Recommendation:** Add "`getLeverage()` must equal `LEVERAGE`" to `enter`'s pre-checks. On a mismatch, set `kv.leverage_ok = 0` and refuse the entry. Test it.

#### style-2-5: The `@shared` alias breaks the compiled server at runtime
* **Reviewer Lens:** `style` (Major). `implementation-readiness` and `codebase-details` raised related Nits.
* **Affected Scope:** lines 956, 1070, 1472.
* **Discrepancy Description:**
  * `tsc` with NodeNext does not rewrite path aliases, so `dist/` would import a module that does not exist.
  * `web/tsconfig.json` also needs a `paths` entry for `@shared`.
  * `npm --prefix web ci` needs a committed `web/package-lock.json`.
* **Rationale & Recommendation:**
  * The server imports `./shared/types.js` relatively. Only the Vite web build uses `@shared`.
  * Add `paths: {"@shared/*": ["../src/shared/*"]}` to `web/tsconfig.json`.
  * List `web/package-lock.json` as a file.

#### style-2-6: The boot order fails on a fresh install
* **Reviewer Lens:** `style`
* **Affected Scope:** lines 1027-1028, 1266, 1336.
* **Discrepancy Description:** `lock.acquire()` (boot step 2) writes `data/bot.lock`, but `data/` is created only by `db.ts` in step 3.
* **Rationale & Recommendation:** Make `acquire()` create `data/` with mode 700, or create the directory before step 2.

#### style-2-7: The external-near-SL safety net is not in the FeatureRange classification table
* **Reviewer Lens:** `style`
* **Affected Scope:** line 1324 vs lines 476-483.
* **Discrepancy Description:**
  * The Technical Plan still says "any other fill -> `external`". The Detailed Plan treats a fill within $1 of the SL as a stop.
  * The two sections now disagree on breaker behaviour. Under the Detailed Plan, a manual close made near the SL counts as a stop.
* **Rationale & Recommendation:** Add the safety-net row to the table at line 476 and state that trade-off.

### Nits

| ID | Lines | Description | Recommendation |
| --- | --- | --- | --- |
| style-2-2 | 110, 832 | Round-1 fixes [10]/[23] landed only in part. These lines still say the margin check runs before entry, and the residual risk at line 832 is "none". | Say the check runs after the fill. Change the residual to "position may briefly exist on cross margin". |
| style-2-3 | 349 | Round-1 fix [30] landed only in part. Line 349 still says `active = HULL`. | Change it to `'hull'`. |
| implementation-readiness-2-7 | 1404 | `Retry-After` gives the full delay, not the time remaining. "While a delay is in effect" is undefined. | The delay is in effect while `now < last + delay`. Set `Retry-After = ceil(last + min(60, 2^(f-1)) - now)`. |
| implementation-readiness-2-8 | 1310-1318, 1418 | `/health` is undefined when `kv.last_cycle_at` is null (first boot) or old. It is also unclear whether skip and ERROR paths set it, although the round-1 fix said "including skipped ones". | Set it at boot, define the null case, and set it on all paths. |
| implementation-readiness-2-9 | 430, 1238 | The entry pre-check requires "no stray orders" but does not say what happens if some exist. | State the action: cancel them, or refuse the entry. |
| style-2-8 | 1097 | "Verified by the golden test (file 52)": file 52 is the fixture; the test is file 55. | Fix the file number. |
| style-2-9 | 1035 | "Allowing for the current minute" is vague. | State the exact tolerance. |
| style-2-10 | 1220 | A 2 s skew is allowed, but the action beyond it is not stated. | Add "otherwise exit", as line 425 says. |
| style-2-11 | 1125 vs 327 | The `simulate` signature differs between the two sections. | Use one signature in both. |
| style-2-12 | 1219 vs 1301 | The `onRateLimited()`/`onOk()` callbacks are not tied to the scheduler's `backoff()`/`reset()`. | Say which calls which. |
| style-2-13 | 1619-1622 | The sizing rows have no price or leverage, so the margin cap cannot be computed. | Fill them in, for example $2,225 at 20x. |
| style-2-14 | 1734 | "Every case in files 64-65 has a test" is circular, because those files are the tests. | Drop it. |
| style-2-15 | 1736 | "Adaptive trails the best fixed strategy" does not name the measure. | Say "on net P&L after fees" (Goal 11). |
| codebase-details-2-5 | 637-642, 1522 | The Pine adaptive mode omits the "wait for the next flip after an SL or TP exit" rule and the fee/slippage treatment. "Virtual-trade arrays" does not match the `var` scalars and `var array<float>` scores. | Add the rule and the fee/slippage treatment, and use the same terms in both places. |
| codebase-details-2-6 | 1212, 1697 | The signing timestamp format, the exact body string, and the "known vector" are unspecified. | Embed a test vector, or state that the test is derived from the formula. |
| codebase-details-2-7 | 431, 448 | The `client_order_id` is about 37 characters, and Delta's length limit is unknown. | Add it to the "verify on first run" list. |
| codebase-details-2-8 | 1539, 1566 | The golden CSV has no signal columns. | State that Pine signals are derived from the exported `hull`/`ut_stop` values. |
| codebase-details-2-9 | 1240, 1245 | `close()` is called without `candleTime`. | State that it defaults to the current hour. This is covered under codebase-details-2-1 for the margin case. |
| style-2-16 | 1724-1727 | Test 68 and files 1-12 are missing from the build order. | Covered by implementation-readiness-2-3. Listed here for traceability. |
| style-2-17 | 957 | The "vitest uses it" wording. | Covered by codebase-details-2-3. Listed here for traceability. |

## Verdict

**NOT READY.**
* All three reviewers agree on this verdict.
* The Zero-Decision Rule fails, because the plan still leaves these design decisions to the implementer:
  * the post-fill margin check behaviour (Blocker);
  * the close bookkeeping and breaker ownership;
  * the halt-kind mapping;
  * the adaptive backtest algorithm;
  * the paper-broker semantics;
  * the build order;
  * the missing safety-module tests.
* Fix these first: codebase-details-2-1, then implementation-readiness-2-1, then implementation-readiness-2-2.
