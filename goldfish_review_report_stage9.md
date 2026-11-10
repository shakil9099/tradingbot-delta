**Status: resolved** (Stage 9 round 1: 43 fixes applied)

# Goldfish Annotated Review Report: Stage 9, Round 1

**Target:** `docs/designs/eth_trading_bot.md`, Detailed Implementation Plan (line 878 to the end), checked against the Technical Plan

**Source:** `implementation_readiness_report.md`, 43 findings: 5 Blocker, 20 Major, 18 Nit.

**Reviewer status:** `egm-implementation-readiness` did **not run** (API errors). It must run in round 2.

**Counts:**

| Decision | Count |
| :--- | :--- |
| PROPOSE FIX | 43 |
| CONTEST | 0 |
| ESCALATE | 0 |
| DECLINE | 0 |

All the Nits are cheap to fix, so none were declined.

Most findings share one cause: the Stage 7 changes to the Technical Plan were never carried into the per-file plan. The fix is the same for all of them: update each file entry to match the Technical Plan.

## Blockers

### [1] codebase-details-1-1: Build output path does not match the start path

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * `tsconfig.json`: `rootDir: "src"`, `include: ["src"]`. `scripts/*` run with `tsx` and are not compiled. Output goes to `dist/index.js`.
  * `server.ts` resolves `web/dist` as `path.resolve(process.cwd(), 'web/dist')`.
  * `ecosystem.config.cjs` sets `cwd` to the repo root, so `.env` and `data/` resolve from there.

### [2] codebase-details-1-2: Migration 1 does not create `system_events` or `sim_trades`

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Migration 1 creates both tables, with the columns from Persistence.
  * New repo helpers:
    * `addTradeEvent`, `addSystemEvent`, `listSystemEvents(type?, limit)`;
    * `replaceSimTrades(rows)`, run as one transaction;
    * `listSimTrades(strategy?)`.

### [3] codebase-details-1-3: Exit classification has no data source

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Add `sl_order_id` and `tp_order_id` to `trades` (Technical Plan and migration).
  * **When they are written:** after entry step 6, and after every trail, reattach or replace.
  * **How a fill is classified** (field names marked "verify on first run"):

    | Fill | Exit reason |
    | :--- | :--- |
    | `order_id` matches `sl_order_id`, or any earlier SL id stored in `trade_events` `sl_move` rows | `sl_stage_<stage>` |
    | `order_id` matches `tp_order_id` | `tp` |
    | `fill_type`/`role` says liquidation, or the order is not ours and has `meta_data` with liquidation | `liquidation` |
    | anything else | `external` |

  * **Safety net:** if an `external` fill price is within $1 of the stored SL, it is classified as `sl_stage_<stage>`. A failed id match then cannot quietly switch the breaker off.
  * **New reconciler tests:**
    * a gapped SL fill;
    * an SL fill after the stop was replaced;
    * a liquidation;
    * the external-near-SL safety net.

### [4] codebase-details-1-4: The `ctl` CLI has no file and cannot share the mutex

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Add `scripts/ctl.ts` and an npm script `ctl`. It is a thin HTTP client: it calls `http://127.0.0.1:PORT/api/control/{pause|resume|close}` and `/api/status`.
  * **Auth:** it sends the header `X-Ctl-Token: <CTL_TOKEN from .env>`.
  * **Server rule:** `requireAuth` accepts a valid session, **or** a correct `X-Ctl-Token` on a request whose socket address is loopback and which carries no `X-Forwarded-For` header (that is, it did not come through Caddy). Token requests skip the CSRF check.
  * The commands run inside the bot process, so they use the same mutex.
  * Add `CTL_TOKEN` to `.env.example` and env validation (at least 32 characters).
  * Add a test for token-only-from-loopback.

### [5] codebase-details-1-5: The golden fixture contradicts the parity spec

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * File #48 becomes `tests/fixtures/eth_1h_golden.csv`: about 700 TradingView bars, columns `time,open,high,low,close,hull,ut_stop`.
  * The TS code is fed this OHLC.
  * E2E step 2 says "any ETHUSD perpetual chart on TradingView, 1h".

## Majors

### [6] codebase-details-1-6: Ratchet test uses a stage that does not exist

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Change "0→3" to "0→2".

### [7] codebase-details-1-7: The trail step is not verified

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** `executor.trail(close)` runs these steps:
  1.  Compute `nextStop` against the exchange's current SL. If the change is less than one tick, stop here.
  2.  Read the ticker. If the new SL is already breached, `close("trail_breached")`.
  3.  `PUT /v2/orders/bracket`, with up to 3 retries. If all fail, keep the old stop and alert.
  4.  Read the orders back with `GET /v2/orders?product_id=3136`.
  5.  If the SL is missing, or not at the new price within one tick, place a new stop-loss order (`POST /v2/orders/bracket` with the SL only), confirm it, then `cancelOrder(oldId)` if it still exists.
  6.  Store `sl_order_id`, `sl_price` and `stage`, and write an `sl_move` trade event.

  New tests: PUT fails 3 times; breach; read-back mismatch leading to a reattach.

### [8] codebase-details-1-8: Pine adaptive selector scope

* ***AI Suggestion:*** PROPOSE FIX (specify it, do not drop it)
* ***Justification:*** The author asked for the Pine script to pick the better of Hull and UT. `concepts_brief.md` says the Pine strategy "mirrors the logic". Dropping Adaptive would break that request, so it is specified instead.
* ***Proposed Edit:*** File #46 specifies the Pine adaptive mode.
  * **Virtual trades:** each strategy keeps a `var` virtual position: `side`, `entry`, `sl`, `stage` and `entryBar`.
  * **Each bar:**
    1.  Exit checks: the SL is checked first, against `low`/`high` (the same rule as the TS simulator).
    2.  The ratchet is updated on `close`.
    3.  Opposite signals exit and re-enter at the next open, tracked with a pending flag.
  * **Scores:** closed per-ETH net P&L is pushed into a `var array<float>` per strategy, capped at the last 10 values with `array.shift`. The score is `array.sum`.
  * **Selector:** rules 1–5 run on bar close, using the same `selN` and `selMargin`.
  * **Real orders:** only the active strategy's signals place real `strategy.entry` and `strategy.exit` orders.
  * **Accepted difference:** fill timing differs from the TS simulator because of TradingView's broker emulator.

### [9] codebase-details-1-9: `ExchangePort` is missing methods

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Add three methods:

  | Method | Endpoint |
  | :--- | :--- |
  | `getTicker(symbol) → {close, markPrice}` | `GET /v2/tickers/ETHUSD` |
  | `getMarginMode() → 'isolated' \| 'cross' \| 'unknown'` | see [10] |
  | `cancelOrder(id)` | `DELETE /v2/orders {id, product_id}` |

  `getOrderByClientId` becomes optional (see [14]).

### [10] codebase-details-1-10: The margin-mode check is missing and has no endpoint

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** No endpoint is confirmed, so the plan uses two sources:
  * **While a position is open:** `getMarginMode()` reads the `margin_mode` field that `GET /v2/positions/margined` returns (listed in the API context).
    * Right after every entry fills, a value other than `isolated` means: close the position and HALT.
  * **While flat:** the mode cannot be read without a position. The bot instead requires the env flag `ISOLATED_MARGIN_CONFIRMED=true`, which the author sets after setting isolated mode in the Delta app. Without it, the bot refuses to start live (`DRY_RUN=false`).
  * Add a boot step and the post-fill check to the entry sequence.
  * Tests: refuses to start live without the flag; cross margin after a fill leads to close and halt.

### [11] codebase-details-1-11: Dependencies are incomplete

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * **Root dev dependencies:**
    * `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`;
    * `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/cookie-session`, `@types/bcryptjs`, `supertest`, `@types/supertest`.
  * **Web dev dependencies:** `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`.
  * **Module format:** `"type": "module"`. Relative imports use `.js` extensions.

### [12] codebase-details-1-12: The `/health` rules have no owner

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** A `healthStatus()` function in `src/api/routes.ts` checks four sources:

  | Condition | Source |
  | :--- | :--- |
  | halted | `kv.halted` |
  | bracket not confirmed | `snapshot.bracketOk === false` while a position is open |
  | stale cycle | `now − kv.last_cycle_at > 65 min`, where `kv.last_cycle_at` is set at the end of every cycle, including skipped ones |
  | API failing | `deltaClient.consecutiveFailures ≥ 3` |

  One test per condition.

### [13] codebase-details-1-13: Login backoff is described as a rate limit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Rename it "login delay".
  * Rule: after `f` failures from one IP within 15 minutes, the next attempt before `last + min(60, 2^(f−1))` seconds gets an immediate **429 with `Retry-After`**.
  * There is no lockout. The counter resets 15 minutes after the last failure, or on a success.
  * The state lives in an in-memory `Map`, as Stage 8 suggested, so the `login_attempts` table is removed.
  * Tests: the boundaries, and no lockout.

### [14] codebase-details-1-14: The executor test relies on an unconfirmed lookup

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** The test checks the position-size re-read guard. `getOrderByClientId?` is an optional port method, used only if it exists.

### [15] codebase-details-1-15: The missed-flip rule has no data or tests

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * `computeAll` also returns `utUp` (`src > stop`).
  * A `NaN` direction never counts as disagreeing.
  * `cycle.ts` holds a pure `decide(state)` that implements the 8-row action table, including `missed_flip`.
  * Add `tests/cycle.test.ts`, covering:
    * every row of the action table;
    * a missed flip leading to REVERSE;
    * `CYCLE_MISSED`;
    * a duplicate candle being skipped.

### [16] codebase-details-1-16: Crash-recovery paths are untested

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** List the test cases explicitly:
  * CLOSING is written before the close order is sent;
  * a close that never reaches flat leads to HALT;
  * a leverage mismatch is set again once, then blocks entry;
  * the reconciler's CLOSING rows, with the exchange flat and with it open;
  * the `OPENING`-promotion row;
  * each exit-classification row.

### [17] codebase-details-1-17: The insights signature does not match its inputs

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** `computeInsights(trades, tradeEvents, systemEvents, simTrades, params)`.

### [18] codebase-details-1-18: The file list is incomplete and uses a glob

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Replace the `tests/*.test.ts` glob with each test file by path. Add these files:
  * `tests/fakes/fakeExchange.ts`
  * `tests/fixtures/hand_30.csv`
  * `tests/cycle.test.ts`
  * `web/src/usePolling.ts`
  * `scripts/ctl.ts`
  * `src/engine/halt.ts`
  * `src/engine/bootGuard.ts`
  * `src/store/backup.ts`

### [19] codebase-details-1-19: The `trust proxy` value differs

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Use `'loopback'` in `server.ts`.

### [20] codebase-details-1-20: The `SimTrade` type drifts from the contract

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** File #17 refers to the contract instead of restating it.
  * `SimTrade = {strategy, entryTime, side, entry, exitTime, exit, reason, grossPnl, fees, netPnl}`. `sim_trades` gains `gross_pnl` and `fees`.
  * Add a slippage test.

### [21] codebase-details-1-21: The `action` values are not a defined set

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** The `decisions.action` values are:
  * `ENTER`, `REVERSE`, `CLOSE`, `TRAIL`, `NONE`, `ERROR`.

  Errors also carry a `note`. `CYCLE_MISSED` writes no `decisions` row. It writes a `system_events` `cycle_missed` row and sets `kv.last_cycle_at`.

### [22] codebase-details-1-22: The backtest's "N" is undefined

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** The backtest takes `--pages <k>`, default 4, which is about 8,000 hours.
  * Its output includes, for each mode, the switch count, net P&L, win rate and maximum drawdown.

### [23] style-1-1: `halt()` and `resume()` have no module

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** A new `src/engine/halt.ts` holds `halt(reason, kind)` and `resume()`.
  * `kind` is one of `breaker`, `manual`, `mismatch`, `fatal_error`, `crash_loop` or `liquidation`.
  * `halt` sets `kv`, writes a `system_events` row and sends an alert.
  * `resume` resets `consecutive_sl` only after a breaker halt.

### [24] style-1-2: The crash-loop guard and the backup have no file

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * `src/engine/bootGuard.ts`: appends to `kv.boot_times` and trims entries older than 10 minutes. More than 5 entries means `halt('crash loop', 'crash_loop')`.
  * `src/store/backup.ts`: `backupNightly()` uses better-sqlite3's `db.backup()` to write `data/backups/bot-YYYYMMDD.db` and keeps 14 copies. The scheduler runs it at 00:30 UTC.

### [25] style-1-3: The pure `select()` is said to write an event

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** `select()` implements rules 1–5 and returns `{active, pending, switched, reason}`. `cycle.ts` writes the `strategy_switch` event.

## Nits (all PROPOSE FIX)

### [26] codebase-details-1-23: Leverage boot step is incomplete

* ***Proposed Edit:*** Set leverage at boot if flat; otherwise on the first cycle or reconcile that sees flat. The executor sets `kv.leverage_ok`.

### [27] codebase-details-1-24: Boot steps leave out three items

* ***Proposed Edit:*** Add these boot steps:
  * write a `system_events` `boot` row;
  * run the candle-time sanity check;
  * log a warning if Telegram is not configured.

### [28] codebase-details-1-25: The 429 backoff has no hook

* ***Proposed Edit:*** The scheduler gets `backoff()` (double the reconcile interval, up to 5 minutes) and `reset()`. `deltaClient` calls them through a callback.

### [29] codebase-details-1-26: The status snapshot has no source

* ***Proposed Edit:*** The reconciler keeps `snapshot = {position, slPrice, tpPrice, slOrderId, tpOrderId, bracketOk, balance, lastPrice, unrealizedPnl, at}`.
  * Building it adds 2 calls per reconcile: balance and ticker.
  * The call budget rises to about 5 calls per minute, about 310 per hour. Update the Open Questions and NFR figures.

### [30] codebase-details-1-27: The shared types are incomplete

* ***Proposed Edit:*** Spell out every type:
  * `TradeStatus` (with CLOSING);
  * `Stage = 0|1|2`;
  * the `ExitReason` members;
  * `StrategyId = 'hull'|'ut'`, with `TradeStrategy = StrategyId|'unknown'` for adopted trades;
  * `SystemEvent`, `SimTrade`, `Action`.

  The selector text uses lowercase `hull`.

### [31] codebase-details-1-28: "Also adds `dry_run`"

* ***Proposed Edit:*** Delete "Also adds".

### [32] codebase-details-1-29: The `trades` header appears twice

* ***Proposed Edit:*** Delete one.

### [33] codebase-details-1-30: Endpoints not in the API context

* ***Proposed Edit:*** Mark `GET /v2/orders`, `GET /v2/fills`, the leverage GET and the margin-mode field "verify on first run".
  * The leverage body is `{leverage: "20"}`, a string.
  * The signed query string includes the leading `?`.

### [34] codebase-details-1-31: Ambiguous test expectations

* ***Proposed Edit:***
  * State the margin-cap test fully: balance $300, price $4,000, 20x. That gives floor(300·20·0.9/40) = 135, and min(212, 135) = 135.
  * Add breaker tests for `external` and `sl_stage_1`: the count stays unchanged.
  * Reword the ratchet test cases as specified.

### [35] style-1-4: "Records `schema_version`"

* ***Proposed Edit:*** "Sets `kv.schema_version = 1`".

### [36] style-1-5: Unverifiable "exactly"

* ***Proposed Edit:*** "Implements the parity spec; verified by the golden test".

### [37] style-1-6: "Stale lock" is undefined

* ***Proposed Edit:*** "A lock whose PID is not alive".

### [38] style-1-7: The `kv` key is not named

* ***Proposed Edit:*** Name it: `kv.paper_state`.

### [39] style-1-8: One value, three names

* ***Proposed Edit:*** `paramsHash()` fills `trades.config_hash`, and `/api/status` shows it as `paramsHash`.

### [40] style-1-9: "When below 1"

* ***Proposed Edit:*** "When the final size is below 1 contract".

### [41] style-1-10: "Readable on a phone" cannot be tested

* ***Proposed Edit:*** "No horizontal scroll at a 360 px viewport".

### [42] style-1-11: Wordy sentence

* ***Proposed Edit:*** "Intentionally unchanged."

### [43] style-1-12: Wording drift

* ***Proposed Edit:***
  * Reuse the Open Question titles.
  * Name the subsections that "Technical Plan" refers to.
  * Say "line coverage" at line 928.
