**Status: resolved** (Stage 7 round 1: 41 fixes applied, 2 escalated left open, 12 declined)

# Goldfish Annotated Review Report

**Target:** `docs/designs/eth_trading_bot.md` (lines 1–748, the feature section)

**Source:** `critic_report.md`, Stage 7 round 1. It holds 55 findings: 22 Major and 33 Nit.

**Carried in from earlier stages:** six Majors from Stage 5 (`zoom_out_report.md`) and Stage 6 (`comprehension_report.md`). They are listed at the end, because the same edits close them.

**Decision counts:**

| Decision | Count |
| :--- | :--- |
| PROPOSE FIX | 41 |
| ESCALATE | 2 |
| CONTEST | 0 |
| DECLINE | 12 |

## Escalated (need the author's decision)

### [E1] [`egm-design`] design-1-7: Daily-loss / drawdown limit dropped. Severity: Major

* **Affected Scope:** [Lines 423-436](docs/designs/eth_trading_bot.md#L423-L436) (Circuit breaker)
* **Discrepancy Description:** The brief recommended both a daily-loss limit and a consecutive-loss limit. Only the 3-consecutive breaker is built.
  * That breaker ignores losing reversals and stage-1 stop exits.
  * So repeated losing reversals can drain the account without ever tripping it.
  * Stage 5 raised the same point (zoom-out M5).
* **Rationale:** The total loss has no limit.
* ***AI Suggestion:*** ESCALATE
* ***Justification:*** In chat the author defined the breaker as "3 consecutive $20 SL hits → stop", and said nothing about other losses. No file records whether a drawdown limit was rejected or simply never considered. Only the author can decide this.
* ***Proposed Edit (if the author wants it):***
  * Location: Circuit breaker section.
  * Change: add a second trigger. Halt when the balance falls **X%** below its highest recorded value. The author chooses X, for example 40%. If the author declines, add an Alternative recording the rejection instead.

### [E2] [`egm-design`] design-1-4: The adaptive selector has no validation gate. Severity: Major

* **Affected Scope:** [Lines 313-322](docs/designs/eth_trading_bot.md#L313-L322) and line 744
* **Discrepancy Description:**
  * A 10-trade score is noisy. One trade ranges from about −$22.6 to +$97, so a $20 switch margin does not prevent switching on noise.
  * The backtest comparing adaptive vs fixed strategies sits under Future Improvements.
  * There is no go-live gate.
* **Rationale:** No check shows that adaptive selection beats a single fixed strategy.
* ***AI Suggestion:*** ESCALATE (partly PROPOSE FIX)
* ***Justification:*** The author chose adaptive selection and "live directly". A hard go-live gate would override that decision, so it needs the author. The non-blocking part is a plain fix: `scripts/backtest.ts` is already in the implementation plan (file 40). Its report should show adaptive vs fixed Hull vs fixed UT, plus how often the strategy switches, and the Future Improvements entry should be removed.
* ***Proposed Edit:***
  * Location: Verification Plan step 1, Future Improvements, Strategy Selection Contract.
  * Change: the backtest prints all three results plus switch counts. Delete the Future Improvements entry. Add a sentence: "If adaptive trails the best fixed strategy, set `STRATEGY` to that one."
  * Option for the author: a hard gate where the bot refuses `STRATEGY=adaptive` live unless the last backtest shows adaptive ≥ the best fixed strategy.

## Prioritized Findings & AI Suggestions

### [1] [`egm-design`] design-1-1: A missed reversal is never recovered. Severity: Major

* **Affected Scope:** [Lines 219-232, 295-296](docs/designs/eth_trading_bot.md#L219-L232) (Per-close flow, Signal definition)
* **Discrepancy Description:** Only flips on the newest bar are acted on. If a cycle is missed on the very bar where the strategy flips, the bot stays in a trade that its strategy has abandoned.
* **Rationale:** Valid. Restarts and outages make this happen.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** This is a real gap. The fix is small: compare the position's side with the strategy's current direction, not only with flip events.
* ***Proposed Edit:***
  * Location: Signal definition.
  * Change: add a rule. "Each strategy also has a direction *state*:
    * Hull: up or down;
    * UT: `src > stop` or not.

    If a position is open and its side disagrees with the active strategy's state, and no flip on the newest bar explains the difference (a flip was missed), the bot reverses at this cycle with reason `missed_flip`. It does not open from flat on a state alone."

### [2] [`egm-design`] design-1-2: Pine v6 margin defaults break the backtest. Severity: Major

* **Affected Scope:** [Lines 539-542](docs/designs/eth_trading_bot.md#L539-L542)
* **Discrepancy Description:** The default 100% margin, with $141 of capital and a 1 ETH position, rejects or shrinks every entry.
* **Rationale:** Valid.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Without this, the Pine backtest results are wrong.
* ***Proposed Edit:*** Add `margin_long=5, margin_short=5` (that is, 20x) to the `strategy()` header spec, and set `initial_capital=10000`, because results are read per ETH.

### [3] [`egm-design`] design-1-3: TradingView may not carry Delta India candles. Severity: Major

* **Affected Scope:** [Lines 73, 286](docs/designs/eth_trading_bot.md#L73)
* **Discrepancy Description:** The parity check assumes TradingView has the same feed as Delta India.
* **Rationale:** Valid. The design never verifies this.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Building the golden fixture from TradingView's own OHLC removes the dependence on the feed.
* ***Proposed Edit:***
  * Golden test: export OHLC **and** indicator values from the same TradingView chart, and feed that OHLC to the TypeScript code.
  * Add an Open Question: "Which TradingView symbol is Delta India ETHUSD? If none exists, the Pine backtest runs on a different venue's prices, and its results are only approximate."

### [4] [`egm-design`+`egm-structural`+`egm-style`] design-1-5: Alternatives lack a concrete trade-off and a linked record. Severity: Major

* **Affected Scope:** [Lines 573-707](docs/designs/eth_trading_bot.md#L573-L707)
* **Discrepancy Description:** Thirteen rejections cite "the author" with no link, and several give only a preference.
* **Rationale:** Valid under the Alternatives Rule.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** The decisions are recorded in `concepts_brief.md` ("Alternatives Weighed", "Resolved in iteration 2"). They need to be linked, and each one needs its deciding trade-off.
* ***Proposed Edit:***
  * Rewrite each "Reason for Rejection" in this form: "[trade-off]. Decided by author; see [concepts brief](../../concepts_brief.md#alternatives-weighed)."
  * Write "Rejected in design" consistently as "Decided in design (no author input)".
  * For Alternative E, add: "Reversed if `npm run backtest` shows adaptive trails the best fixed strategy."

### [5] [`egm-design`+`egm-structural`] design-1-6: No Risks & Mitigations section. Severity: Major

* **Affected Scope:** [Lines 61-66, 97, 711](docs/designs/eth_trading_bot.md#L61-L66)
* **Discrepancy Description:** Risks are scattered across the document, and several failure modes are missing.
* **Rationale:** Valid. The standard requires this section.
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Add `## Risks & Mitigations` before the NFR section, as a table (Risk / Impact / Mitigation / Residual) with these rows:
  * the per-stop loss;
  * no testnet;
  * the stage-1 stop netting below zero;
  * no proven edge;
  * the reversal window (up to about 20 s);
  * bracket-edit behaviour;
  * leverage drift and margin mode;
  * clock skew;
  * rate limits;
  * dashboard exposure;
  * exchange outage at the candle close;
  * slippage or gaps through the stop (the stop is a stop-market order; the simulator assumes fills at the stop price);
  * last-price wicks;
  * auto-deleverage cutting the position size (the reconciler updates the size and alerts, rather than halting);
  * loss of the SQLite file (the exchange is still the source of truth; the trade history is lost; back it up nightly);
  * loss of the VPS (the brackets stay on the exchange).

  Shorten the risk paragraph in "The Problem" to a link to this section, and point line 97 at it.

### [6] [`egm-design`] design-1-8: Optional alerts, yet `/health` reports OK while halted. Severity: Major

* **Affected Scope:** [Line 457](docs/designs/eth_trading_bot.md#L457), line 557
* **Discrepancy Description:** With Telegram off, a halted bot looks healthy to the uptime monitor.
* **Rationale:** Valid.
* ***AI Suggestion:*** PROPOSE FIX
* ***Justification:*** Changing `/health` keeps Telegram optional, as the author chose, and the outside monitor still catches the halt.
* ***Proposed Edit:***
  * `/health` returns 503 with `{ok:false, reason}` when any of these is true:
    * the bot is halted;
    * the position has no bracket;
    * the last cycle is more than 65 minutes old;
    * 3 or more Delta calls in a row have failed.
  * At boot, log a warning when Telegram is not configured.
  * Define "alert" as "log at error level, plus a Telegram message if it is configured".

### [7] [`egm-design`] design-1-9: A crash during entry leaves the OPENING row orphaned. Severity: Major

* **Affected Scope:** [Lines 417-420](docs/designs/eth_trading_bot.md#L417-L420)
* **Discrepancy Description:** After a crash between the fill and marking the trade OPEN, the reconciler creates a second `adopted` row, and the original row is never resolved.
* **Rationale:** Valid. Stage 6 raised the same point (M6).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Reconciler row: "exchange open + DB `OPENING` with the same side" → promote that row to `OPEN`, keeping its strategy and reason.
  * Create an `adopted` row only when no matching row exists. Adopted trades have strategy `unknown` and stage derived from the SL, and they count toward the breaker like any other trade.
  * `adopted_close` is removed from the exit-reason list. Adopted trades use the normal reasons.

### [8] [`egm-design`] design-1-10: The login rate limit behind Caddy can lock the author out. Severity: Major

* **Affected Scope:** [Lines 459-461](docs/designs/eth_trading_bot.md#L459-L461)
* **Rationale:** Valid.
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Use `trust proxy = 'loopback'`, with Caddy setting `X-Forwarded-For`.
  * Replace the hard lockout with an increasing delay per IP: 1 s, then 2 s, 4 s, up to 60 s.
  * Add a recovery path: `npm run ctl -- pause|resume|close`, a CLI that runs on the VPS over SSH and uses the same executor (new file `scripts/ctl.ts`).

### [9] [`egm-design`] design-1-11: Retry safety depends on an unverified `client_order_id` lookup. Severity: Major

* **Affected Scope:** [Lines 377, 384, 401](docs/designs/eth_trading_bot.md#L377)
* **Rationale:** Valid. Stage 6 raised the same point (M8).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:**
  * The main guard is to re-read the position size before any retry. If the size is already non-zero, do not retry.
  * The `client_order_id` lookup is a second check only.
  * Ids become `eth-<candleTime>-<action>-<reason>-<attempt>`. A manual close uses the current hour's candle time.
  * Add to Open Questions: whether Delta enforces unique `client_order_id`s, and whether orders can be looked up by them.

### [10] [`egm-design`] design-1-12: Margin mode is never set or checked. Severity: Major

* **Affected Scope:** [Lines 360-366](docs/designs/eth_trading_bot.md#L360-L366)
* **Rationale:** Valid. Stage 5 raised the same point (nit).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Require isolated margin. Read the margin mode at boot and before each entry, and refuse to enter if it is cross.
  * Add an Open Question naming the margin-mode endpoint (the docs list "margin mode" under user preferences).

### [11] [`egm-design`] design-1-13: The candle request can exceed the 2,000 cap. Severity: Major

* **Affected Scope:** [Lines 216-219](docs/designs/eth_trading_bot.md#L216-L219)
* **Rationale:** Valid.
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Request `start = floorHour(now) − 1999·3600` and `end = floorHour(now) − 1`.
  * Add an Open Question to confirm that the candle `time` field is the bar's open time. A boot check compares the newest candle's time with `floorHour(now) − 3600`.

### [12] [`egm-structural`+`egm-style`] structural-1-1: Two sections are nested under NFR. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Promote "Additional Resources" and "Future Improvements" from H3 to H2.

### [13] [`egm-structural`+`egm-design`] structural-1-2: The state diagram contradicts the text. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Replace the diagram with two things:
  * a position-state diagram: FLAT → OPENING → OPEN → CLOSING → FLAT, with REVERSE as CLOSING → OPENING;
  * a separate note that HALTED is a flag. It blocks only new entries (ENTER, and the re-entry leg of REVERSE).

  The edge for a manual close or a breached trail runs from OPEN to CLOSING.

### [14] [`egm-structural`+`egm-style`] structural-1-3: Stage names are inconsistent. Severity: Major

* **Rationale:** Valid. Stage 6 raised the same point (M2).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Define one stage list:

  | Stage | Meaning |
  | :--- | :--- |
  | 0 | initial stop |
  | 1 | stop locked at +2.5 |
  | 2 | trailing stop |

  The exit reasons become `sl_stage_0`, `sl_stage_1` and `sl_stage_2`. Replace every use of "stage 3", "2/3", "2–3" and "stage N" in the Overview, Goals, CUJs, ratchet table, reconciler and schema.

### [15] [`egm-style`] style-1-1: Goal 8 is absolute. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Goal 8 becomes: "After a crash or restart, the bot never opens a second position, brackets any unprotected position within 60 s of boot, and halts on any side or size mismatch it cannot explain."

### [16] [`egm-style`] style-1-2: The "few seconds" exposure claim cannot be measured. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Goal 2 says: "except during a reversal, which can leave the position flat-and-reopening for up to about 20 s (10 s flat poll + 10 s fill poll). The new position carries its bracket from the moment it fills."

### [17] [`egm-style`+`egm-structural`+`egm-design`] style-1-3: The parity tolerance is stated two ways. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** One pass rule, used in both Goal 4 and the golden test: "On bars after the 200-bar warm-up, Hull and UT stop values match within 0.01, and signals fire on the same bars."

### [18] [`egm-style`] style-1-4: "Exactly" conflicts with "the reference". Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** "The TS code ports the Hull and UT Bot logic from `bot.pine` with the changes listed below. The TS ports are the reference, and `eth_strategy.pine` is written to match them."

### [19] [`egm-style`+`egm-design`] style-1-5: There is no error table. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Add a table with columns Kind / Examples / Handling:

  | Kind | Examples | Handling |
  | :--- | :--- | :--- |
  | Retryable | network error, timeout, HTTP 5xx, 429 | retried as above |
  | Fatal | 401/403, `SignatureExpired` after a re-sign, insufficient margin, invalid size or price, product not found | halt and alert |
  | Unknown | any other 4xx, or a response body that cannot be parsed | halt and alert |

### [20] [`egm-style`] style-1-6: The rate-limit claim is not supported. Severity: Major

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** "About 190 calls per hour: about 10 per cycle, plus about 3 per reconcile every 60 s. If Delta returns 429, the reconcile interval doubles, up to 5 minutes."

### [21] [`egm-design`] design-1-14: The simulator's handling of the entry bar is unclear. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** The simulator checks SL and TP on the entry bar too, and applies 1 tick of slippage per fill, the same as Pine.

### [22] [`egm-design`] design-1-15: Resume resets the breaker after any halt. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Reset `consecutive_sl` only when the halt reason was the breaker.

### [23] [`egm-design`] design-1-16: Schema gaps. Severity: Nit

* **Rationale:** Valid. Stage 6 raised the same point (M4).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Add a `system_events` table (`id`, `time`, `type`, `data` JSON) for strategy switches, halts and resumes, boots, and the crash-loop count.
  * Add `trades.dry_run`.
  * Add `kv` keys: `boot_times` and `paper_state`.

### [24] [`egm-design`] design-1-17: Insight rules mix units. Severity: Nit

* **Rationale:** Valid. Stage 6 raised the same point (M9).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * Rule 3 compares live P&L per ETH (net ÷ ETH size) with the simulated trades of the same strategy whose entry falls on the same candle. Simulated trades are stored in a `sim_trades` table, rebuilt each cycle.
  * Rule 5 uses per-ETH P&L below −$40.

### [25] [`egm-design`] design-1-18: Ordering for a switch on the same bar is not defined. Severity: Nit

* **Rationale:** Valid. Stage 6 raised the same point (M5).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Rule 3: "If the new active strategy flips on the same bar the switch happens, that flip counts and the bot enters." This makes rules 3 and 4 behave the same way.

### [26] [`egm-design`] design-1-19: A stale lockfile can block restarts. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Line 563: "If the lock exists but its PID is not alive, the lock is replaced."

### [27] [`egm-design`] design-1-20: `/health` flips to unhealthy after one failed call. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX (covered by [6]: unhealthy only after 3 failed calls in a row)

### [28] [`egm-design`] design-1-21: Goal 1's timing conflicts with the retry window. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Goal 1: "within 3 minutes of each close (UTC)".

### [29] [`egm-design`] design-1-22: Dashboard polling may trigger Delta calls. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** `/api/status` is served from the last reconcile snapshot and never calls Delta.

### [30] [`egm-design`] design-1-23: Three cases are not specified. Severity: Nit

* **Rationale:** Valid. Stage 6 raised the same point (M7).
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:***
  * **Exchange-side exits that match neither the stop nor the take-profit:**
    * a gap through the stop counts as `sl_stage_N`, decided by order id;
    * a liquidation becomes `liquidation`, and the bot halts;
    * a close made in the Delta app becomes `external`, which neither counts toward the breaker nor resets it.
  * **Partial fill:** update `size_contracts`.
  * **After a mismatch halt:** trailing stops, because the state is unknown. After a breaker or manual halt, trailing continues.

### [31] [`egm-structural`+`egm-design`] structural-1-4: Some Open Questions are stale. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Remove the HMA question, which is settled by explicit rounding. Mark the balance field at line 358 as provisional and link it to its question.

### [32] [`egm-structural`] structural-1-11: Exit-reason lists do not match. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX (covered by [7], [14] and [30]: Goal 9 points to the one exit-reason list)

### [33] [`egm-style`] style-1-7: The "÷ 141 ETH" wording is ambiguous. Severity: Nit

* **Rationale:** Valid. Stage 6 raised the same point.
* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** "Position size in ETH = USD balance ÷ 141, in 0.01 ETH steps. The 141 is the author's chosen dollars of balance per 1 ETH of position."

### [34] [`egm-style`] style-1-10: "Off by default" does not match the defaults. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** State the real defaults: `DRY_RUN=false`, and `MAX_CONTRACTS=100000`, which in practice means no cap.

### [35] [`egm-style`] style-1-12: The backtest caveat is in the wrong place. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX (covered by [E2] and [5])

### [36] [`egm-style`] style-1-13: Unsupported API claim. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** "The bot does not fill gaps."

### [37] [`egm-style`] style-1-14: Hard-to-read numbers in the CUJs. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Write "+$13.60" and "max($2241.40, $2243.00)".

### [38] [`egm-style`] style-1-15: The insight message differs between CUJ 6 and the rule. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** Use the rule's wording in CUJ 6.

### [39] [`egm-style`] style-1-16: Alternative B's rejection contradicts its own Pros. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX (folded into [4])

### [40] [`egm-style`] style-1-18: Rule 3 is cited for more than it covers. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX (folded into [4] and [E2]: Alternative E points to the backtest)

### [41] [`egm-style`] style-1-20: Awkward rollout bullet. Severity: Nit

* ***AI Suggestion:*** PROPOSE FIX
* ***Proposed Edit:*** "Optionally start with `MAX_CONTRACTS=1`."

### Declined (Nits, recorded, not fixed)

* structural-1-5: the alternatives use different templates.
* structural-1-6: bold-label colon placement.
* structural-1-7: bold text used as pseudo-headings. This is partly covered by [5].
* structural-1-8: cross-references are plain text instead of anchor links.
* structural-1-9: bare URL.
* structural-1-10: misaligned border in the box diagram.
* structural-1-12: CUJ 6 list format.
* style-1-8: the problem statement presents observations as fact. They are the author's observations, already framed as "the author has noticed".
* style-1-9: outcome wording.
* style-1-11: filler words.
* style-1-17: uneven standard of evidence. Folded into [4] wording where touched.
* style-1-19: vague pros and cons. Folded into [4] where touched.

## Carried from Stages 5–6 (fixed by the same batch)

* **Stage 5 M4: no CLOSING status.** Add `CLOSING` to `trades.status`. It is written, with the close reason and `client_order_id`, **before** the close order is sent, so the reconciler labels a crash mid-close with the right reason, and the breaker is not affected.
* **Stage 6 M1: the halted rows in the action table.** Split them:
  * halted + flat: `NONE`;
  * halted + in position, with no opposite signal: `TRAIL`;
  * halted + in position, with an opposite signal: `CLOSE` only.
* **Stage 6 M3: no source for the last price.** Use `GET /v2/tickers/ETHUSD` (field `close` / mark), which was checked live during brainstorming. Add `getTicker()` to `ExchangePort`.
* **Stage 6 M10: leverage is never set again.** Leverage is set the first time the bot is flat after boot, not only at boot.
* **Stage 5 M2 (DRY_RUN paper broker) and M8 (dashboard deferred).** Not changed. They conflict with the author's choices (`DRY_RUN` stays as the author approved it, and the dashboard was requested), so they stay as accepted scope.
* **Stage 5 M3: unchecked bracket-edit behaviour.** Covered by the Open Questions and Verification Plan step 4. Add an explicit branch: "If the PUT turns out to cancel and recreate the stop, the bot instead places the new stop first and then cancels the old one."
