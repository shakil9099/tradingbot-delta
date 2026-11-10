# Goldfish Review Report: Intermediate Zoom Out (EGM Stage 8)

**Target:** `/Users/shakildodhiya/Desktop/tradingbot-eth/docs/designs/eth_trading_bot.md` (lines 1-1352, full file)
**Standard:** `/Users/shakildodhiya/.claude/egm/resources/document_standards/zoom-out-standard.md`
**Context given to the reviewer:** `egm_context_delta_api.md`, `concepts_brief.md`, `bot.pine`, `zoom_out_report.md` (Stage 5)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed (first attempt) |

**Severity count:** 0 Blocker, 5 Major, 11 Nit.

**Accepted scope (not findings):** the dashboard, the DRY_RUN paper broker, and going live without testnet.
**Escalated to the author, left open on purpose:** the drawdown halt, and a hard go-live gate for adaptive. Neither one blocks any finding below.

## Verdict

The core design is still sound. Most of the additions since the Critic stage are fixes, not new features: the CLOSING state, `sim_trades`, the margin-mode check, the parity rule, the exit classification table and the error table. Four things still need fixing:

- The `ctl` CLI cannot work the way the document describes it.
- Exit classification relies on bracket order ids that the design never saves.
- Nothing checks that a trail actually moved the stop.
- The Implementation Plan was not updated for the new additions.

---

## (a) Status of the Stage 5 findings

| # | Stage 5 finding | Status | Notes |
| --- | --- | --- | --- |
| 1 | No go/no-go check on the edge before the full build | Partly resolved | The backtest is now rollout step 1 (line 855). Validation is at lines 342-345, the risk row at line 815 and Goal 11 at lines 85-88. The duplicate walk-forward entry is gone. Verification E2E step 1 (line 1338) still runs the backtest only after everything else is built. The hard gate is escalated. Only build order is left (N1). |
| 2 | DRY_RUN paper broker | Closed (accepted scope) | No finding. |
| 3 | Executor depends on unchecked exchange behaviour | Partly resolved | The cancel-and-recreate branch exists (lines 104-106, 384, 818). Auto-cancel no longer matters, because the close step always runs `DELETE /v2/orders/all` (line 450). Still missing: a check after each trail, and a clear rule on whether the first trade must be 1 contract (M3). |
| 4 | CLOSING intent not saved | Resolved | Lines 252-265, 445, 464, 469, 508, 511. Leftovers: N4, N5, M5. |
| 5 | Breaker does not cap account loss | Open (escalated) | Lines 114, 500, 813. Not a finding. |
| 6 | Insight rule 3 needs data that is never stored | Resolved | Through `sim_trades` (lines 519, 566-570). The table could be simpler (part b). |
| 7 | Pine rebuilds the adaptive selector | Still open | Lines 629, 1281. See M4. |
| 8 | Size of the dashboard and insights | Closed (accepted scope) | Only `login_attempts` is left (part b). |
| 9 | Margin mode never stated | Resolved | Lines 110, 398, 641, 819. No fallback if the API cannot read the mode (N2). |
| 10 | Mutex blocks manual controls | Still unclear | Line 220 still does not say whether the mutex is taken before or after the 2-minute candle wait (line 225). State "fetch and wait for candles, then take the mutex". This matters more now that `ctl` also claims to use the mutex (M1). |
| 11 | Parity tolerance stated two ways | Resolved | Lines 69 and 307 agree. The fixture details still disagree (N8). |
| 12 | Implementation Plan too detailed | Still open | See N9. |
| 13 | State diagram does not match the text | Mostly resolved | HALTED is now a separate flag (lines 267-271). A smaller mix-up remains (N5). |

---

## Prioritized Findings (Blockers -> Major -> Nits)

No Blockers.

### M1. The `ctl` CLI cannot share the in-process mutex, and the plan does not include it - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 538, line 498, file #27 (lines 1126-1129), package.json scripts (lines 909-916), Deployment lockfile (line 647)
* **Discrepancy Description**:
  * `npm run ctl -- pause|resume|close|status` is said to use "the same executor and mutex".
  * That mutex is a promise-based lock inside the main process, so a separate CLI process cannot see it.
  * As a result, `ctl close` could race the hourly cycle or the reconciler. That is the double-order risk the mutex exists to prevent.
  * The lockfile only stops a second full instance, so it does not help here.
  * There is no file entry and no npm script for `ctl` in the Implementation Plan.
* **Rationale & Recommendation**: Cut `ctl`. Document `ssh -L 3000:127.0.0.1:3000` plus the normal dashboard instead. This needs no new code and covers a broken Caddy, TLS or DNS setup. If the process itself is down, there is no mutex to share anyway, and the Delta app is the fallback. If a CLI is still wanted, make it a thin HTTP client that calls the existing control routes on loopback. Either way, add it to the plan or remove it from lines 498 and 538.

### M2. Exit classification matches fills by order id, but bracket order ids are never stored - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** exit classification table (lines 474-481), Persistence `trades` (lines 506-513), file #31 (lines 1154-1158)
* **Discrepancy Description**:
  * The breaker needs `sl_stage_0` to be recognised by "fill from the bracket stop-loss order, matched by order id".
  * The `trades` table stores `sl_price` and `tp_price` but no SL or TP order ids.
  * If the trail replaces the stop instead of editing it (line 384), the SL order id changes on every move.
  * If matching fails, the exit falls into `external`, which "neither counts nor resets". The breaker would then be switched off with no warning.
* **Rationale & Recommendation**: Store `sl_order_id` and `tp_order_id` on the trade. Write them when the bracket is confirmed (entry step 6) and after every trail or reattach. Another option is to state that classification reads the fill's parent order from order history. Add a reconciler test for an SL fill that is gapped far from the stop price.

### M3. The trail is never verified, and whether the first trade must be 1 contract is unclear - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Open Questions (lines 104-106), Trailing ratchet (lines 380-384), Rollout step 3 (line 857), E2E step 4 (line 1341)
* **Discrepancy Description**:
  * Line 105 says the PUT behaviour is verified "with a 1-contract live trade", but the rollout and E2E steps make `MAX_CONTRACTS=1` optional.
  * The entry confirms its bracket (line 436), but the trail step does not. If the PUT cancels the old stop and the new one fails, nothing notices for up to 60 s.
  * The fallback "place the new stop-loss first" does not say what kind of order the new stop is. It also does not say whether cancelling the bracket stop removes the take-profit too.
* **Rationale & Recommendation**: After every trail PUT, re-read the orders and confirm the SL is at the new price. If it is missing, call `POST /v2/orders/bracket` right away, in the same step. This makes the trail safe whichever way the exchange behaves, and the cancel-and-recreate branch only gets built if this check shows it is needed. Also, either make the first trade at `MAX_CONTRACTS=1` mandatory, or reword line 105 to match the optional rollout.

### M4. The Pine strategy still rebuilds the adaptive selector (Stage 5 finding 7) - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** Pine strategy (lines 627-632), file #46 (line 1281), parameter registry `selN` / `selMargin` / `mode` (lines 594, 598)
* **Discrepancy Description**: Line 632 calls Pine an approximate check and the TS simulator the reference. Even so, Pine is still asked to rebuild adaptive selection from `var` arrays of virtual trades. That is a second copy of the hardest logic, in a weaker language, and it is expected to disagree with the reference. Goal 11 already sends the adaptive versus fixed decision to `npm run backtest`.
* **Rationale & Recommendation**: Limit `eth_strategy.pine` to the parity code, the signals, and fixed Hull-only and UT-only modes with the bracket and ratchet. Drop Adaptive mode and its inputs. If the author wants adaptive in Pine anyway, record that as accepted scope.

### M5. The Implementation Plan was not updated for the new additions - Severity: Major
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** files #26, #31, #33 (line 1173), #34 (lines 1179-1185), tests #49 (lines 1299-1329)
* **Discrepancy Description**:
  * Migration 1 does not create `system_events` or `sim_trades`, and `repo.ts` has no helpers for either table.
  * There is no `ctl` file.
  * No tests cover the missed-flip rule, CLOSING crash recovery, exit classification or the action table, and there is no `cycle.test.ts`.
  * `executor.test.ts` (line 1323) tests a "timeout with lookup by `client_order_id`". Line 420 makes the position-size re-read the main guard instead.
  * `ratchet.test.ts` (line 1306) tests "stage jumps 0→3", but line 373 defines only stages 0-2.
* **Rationale & Recommendation**: Do one pass to bring files #31, #33, #34 and #49 in line with the Technical Plan. Add `cycle.test.ts` covering every row of the action table, including the missed flip. Change the executor test to the position-size re-read guard, and the ratchet test to 0→2.

### N1. Build order - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 852-859, 1337-1347
* **Discrepancy Description**: The backtest needs only `core/*` and `scripts/backtest.ts`, but the build order puts it after everything else.
* **Rationale & Recommendation**: Add one sentence: "implement core and backtest first, review, then the exchange layer and UI." It costs nothing, keeps all accepted scope, and lets the author stop early if there is no edge. This applies whichever way the go-live gate is decided.

### N2. Margin mode has no fallback - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 110, 398
* **Discrepancy Description**: The bot refuses to enter unless the mode reads as isolated. If no API endpoint exposes the mode, the bot can never trade. That fails safe, but it would block go-live.
* **Rationale & Recommendation**: Add a config flag the author sets to confirm isolated mode at setup. Use the boot check only if an endpoint exists.

### N3. The missed-flip rule makes the "opposite signal" check redundant - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 232, 317-319, 321
* **Discrepancy Description**: While a position is open, the direction can only change through a flip. So "opposite signal" and "direction disagrees with the position" are the same condition. Some side effects are not stated:
  * Adopted positions get reversed at the next cycle if the active strategy disagrees.
  * Changing `STRATEGY` at restart can reverse a position at once.
  * A late entry into an existing trend conflicts with line 321.
* **Rationale & Recommendation**: Define REVERSE once, as "the active strategy's direction is not the position side". Use the entry-reason label to tell `signal` from `missed_flip`. State that a `NaN` direction never counts as disagreeing. Write down the side effects above as intended behaviour.

### N4. Crash between the two legs of a reversal - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 453, 464
* **Discrepancy Description**: An exchange that is flat, plus a CLOSING row, is recorded as `reversal`, and the re-entry leg is lost until the next flip. That is safe, but the document does not say so.
* **Rationale & Recommendation**: Add one line stating this outcome.

### N5. The state diagram mixes position states with trade-row statuses - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 250-265
* **Discrepancy Description**: FLAT is not a `trades.status`, and CLOSED and FAILED are not drawn. CLOSING→OPENING suggests one row changes side, when a reversal really closes row A and inserts row B.
* **Rationale & Recommendation**: Label the diagram as position states, and list the row statuses separately.

### N6. Error halts are not mapped in the action table - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** lines 241-243, 416-417
* **Discrepancy Description**: Fatal and unknown API errors, the crash-loop guard and the product-check halts do not fit the "breaker or manual" row or the "mismatch or unknown state" row.
* **Rationale & Recommendation**: Say which row they use. The intent appears to be "unknown", meaning no trailing.

### N7. `trust proxy` is set two ways - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 536 vs file #36 (line 1198)
* **Discrepancy Description**: Line 536 sets `'loopback'`, and file #36 sets `1`.
* **Rationale & Recommendation**: Use `'loopback'` in both places.

### N8. Golden fixture details disagree - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 305 vs file #48 (line 1295)
* **Discrepancy Description**: Line 305 describes about 700 bars of TradingView OHLC. File #48 describes about 500 Delta ETHUSD candles.
* **Rationale & Recommendation**: Make the file entry match line 305. Using TradingView's own OHLC is what keeps the test independent of the data feed.

### N9. Too much low-level detail in the Implementation Plan (Stage 5 finding 12) - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** files #1-#8, #12, #36, #39 (lines 1198, 1221), #45, line 901
* **Discrepancy Description**: The plan specifies tsconfig flags, `.gitignore` entries, bcrypt cost 12, a 10 kb body limit, CSS colours and `roundTick`.
* **Rationale & Recommendation**: Merge setup files #1-#8 and #45 into one "project setup" entry. Keep the parity formulas, `client_order_id` formats and order request shapes, because they affect behaviour.

### N10. A partial close or auto-deleverage records no P&L - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 471
* **Discrepancy Description**: The size is updated, but P&L and fees for the closed part are not recorded. Stats and the breaker's `netPnl` will be wrong for that trade.
* **Rationale & Recommendation**: Read the fills for the closed part, or note the gap.

### N11. 429 handling - Severity: Nit
* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** line 415
* **Discrepancy Description**: Three retries within about 3.5 s are unlikely to clear a rate limit. Doubling the reconcile interval is the part that actually helps.
* **Rationale & Recommendation**: Do not retry a 429 inside the same call, except for order-safety reads.

---

## (b) Are the post-Critic additions worth their cost?

| Addition | Verdict | Reason |
| --- | --- | --- |
| Risks & Mitigations (lines 808-829) | Keep | It puts the risk notes in one table, with accepted items clearly marked. For leverage drift and clock skew (lines 819-820), "Residual: none" claims too much. "Low" is more honest. |
| CLOSING state | Keep | It is the minimal fix for Stage 5 finding 4. Leftovers are N4 and N5. |
| Missed-flip direction-state rule | Keep, and simplify | See N3. |
| `system_events` | Keep | Halts, resumes and switches happen outside the hourly cycle, so `decisions` cannot hold them. It is cheap, but it is missing from the plan (M5). |
| `sim_trades` | Could be simplified (Nit) | It is rebuilt every hour from data in memory, so it is really a cache. An in-memory snapshot of the last cycle's `SimTrade[]` would be enough, and the next cycle rebuilds it after a restart. Its columns also differ from the `SimTrade` type (no `grossPnl` or `fees`). |
| Exit classification table (lines 474-481) | Keep | The breaker depends on it. It needs stored order ids (M2). |
| Error table (lines 413-417) | Keep | It is short and decides real behaviour. Map its halts into the action table (N6). |
| `ctl` CLI | Cut, or make it a loopback HTTP client | See M1. |
| `/health` semantics (lines 527-533) | Keep | With Telegram optional, it is the only alert path. Nit: "last cycle more than 65 minutes old" should mean the last successfully processed candle. Otherwise a cycle that logged `CYCLE_MISSED` still counts as fresh. |
| Login backoff (lines 521, 537) | Simplify (Nit) | It does not need a SQLite table: an in-memory per-IP map is enough for one user. Holding a request open for up to 60 s keeps connections open, so an attacker could tie up the server with them. Return 429 with `Retry-After` instead. Pick one name, "delay" or "rate limit". Drop `login_attempts` and its repo helpers. |

---

## (c) Altitude

- **Too detailed:** the Implementation Plan setup files (N9). The Technical Plan is mostly at the right level.
- **Too vague where it matters:**
  - SL and TP order-id tracking (M2).
  - The trail fallback's order type, and what happens to the take-profit (M3).
  - How `ctl` reaches the mutex (M1).
  - Where the mutex is taken relative to the candle wait (Stage 5 finding 10).
  - Which category error halts fall into (N6).
  - The margin-mode fallback (N2).
