# Goldfish Review Report: Stage 7 Critic Review, Round 1

**Target:** `/Users/shakildodhiya/Desktop/tradingbot-eth/docs/designs/eth_trading_bot.md` (lines 1-748, FeatureRange, which ends before "## Detailed Implementation Plan")

**Standard:** `/Users/shakildodhiya/.claude/egm/resources/document_standards/feature-spec-standard.md` (used by egm-design and egm-structural; egm-style used its persona's own rules)

**GoldfishContext:**
- `egm_context_delta_api.md`
- `concepts_brief.md`
- `bot.pine`

## Reviewer Status

| Reviewer | Status | Raw findings |
| --- | --- | --- |
| `egm-design` | completed | 27 (13 Major, 14 Nit) |
| `egm-structural` | completed | 15 (5 Major, 10 Nit) |
| `egm-style` | completed | 23 (7 Major, 16 Nit) |

**After deduplication:** 0 Blocker, 22 Major, 33 Nit (55 findings).

When several reviewers raised the same issue, I kept one entry, gave it the id of the reviewer with the strongest version, used the highest severity any of them assigned, and listed the others under "Also raised by".

Checks the reviewers ran that found no problems:
- The arithmetic in CUJ 1 and CUJ 2 is correct.
- The risk figures (about 16% per stop, about 40% after three stops) are correct.
- The ATR, UT trailing stop and Hull ports match `bot.pine:922-952` and `bot.pine:1000-1028`.
- The fenced blocks and tables are well formed.
- The relative links at lines 735-737 resolve.

---

## Prioritized Findings (Blockers -> Major -> Nits)

No Blockers were reported.

## Major

### design-1-1: A missed reversal signal is never recovered - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 219, 221, 223, 230-232, 295-296
* **Discrepancy Description:** The bot looks only at signals on the newest closed bar. A missed cycle loses its signal. This happens on `CYCLE_MISSED`, an outage, or a restart around HH:00. Example: the bot is long and the active strategy's SHORT flip falls on a missed bar. The next flip is LONG, which line 295 ignores because the bot is already long. The bot then stays in a trade its strategy has left until the SL, TP or trail closes it, and the trade log records no reason.
* **Rationale & Recommendation:** On each cycle, compare the position's side with the strategy's current direction state, not only with flip events. If they disagree, reverse, or log `STALE_DIRECTION` and alert. Another option is to replay every unprocessed closed bar since `last_processed_candle`.

### design-1-2: Pine v6 margin defaults break the `eth_strategy.pine` backtest - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 539-542 (also 66, 89)
* **Discrepancy Description:** The header sets `initial_capital=141` and a fixed size of 1 ETH, about $2,225 notional. It does not set `margin_long` or `margin_short`, which default to 100% in Pine v6. The broker emulator will reject, shrink or margin-call these entries. That silently corrupts the backtest that line 66 relies on as the first check for an edge.
* **Rationale & Recommendation:** Set `margin_long=5` and `margin_short=5` to match 20x, or use a large `initial_capital`, since all results are read per ETH. Put this in the header spec.

### design-1-3: Pine parity assumes TradingView has the same Delta India candles - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 73, 286, 89
* **Discrepancy Description:** Delta India is a separate venue. Nothing shows that TradingView has a Delta India ETHUSD feed, and a "DELTA" symbol there may be Delta Global, whose prices differ. If so, Goal 4 cannot be met and the Pine backtest runs on different data.
* **Rationale & Recommendation:** Confirm which TradingView symbol maps to Delta India. Build the golden fixture from OHLC exported from that same chart, and feed that OHLC to the TypeScript code. Do not pair TradingView indicator values with Delta REST candles. If no India feed exists, state that Pine is only an approximate check.

### design-1-4: The selector has no validation gate, and its backtest is deferred - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 58, 74, 313-318, 548, 616-623, 744, 66
* **Discrepancy Description:** One simulated trade ranges from about -$22.6 to +$97. The standard deviation of a 10-trade sum is therefore far larger than the $20 hysteresis, so the margin does not stop switching on noise. `concepts_brief.md:66` said to add the selector only if a backtest shows it beats both fixed strategies. Alternative E rejects that without adding the gate. The adaptive-vs-fixed backtest (`scripts/backtest.ts`) is listed under Future Improvements (line 744). At go-live, the only backtest is Pine, which is approximate.
* **Rationale & Recommendation:** Bring the adaptive vs fixed-Hull vs fixed-UT backtest into scope as a go-live gate, and have it report switch frequency. Justify N=10 and $20 with that data, or add a minimum dwell time. Another option is to default `STRATEGY` to a fixed value until the report exists.

### design-1-5: Rejection reasons credit "the author" without a linked record or a concrete trade-off - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Also raised by:** `egm-structural` (Major), `egm-style` (Nit, about "Rejected in design" at 659, 668, 707)
* **Affected Scope:** Lines 586, 594, 606, 614, 623, 631, 637, 644, 652, 659, 668, 675, 681, 691, 699, 707
* **Discrepancy Description:** The Alternatives Rule requires a concrete technical or scope trade-off, and it forbids crediting a maintainer without a link. Thirteen of the sixteen rejections say "Rejected by author", and several give only a preference:
  - C, F, G, L, M and O say only "in favour of X".
  - D is a bare quote.
  - A restates the design.

  Alternative E's Pros contain the strongest objection to the chosen design (a 10-trade score is noisy), and the rejection does not answer it. A few rejections say "Rejected in design" without saying who decided.
* **Rationale & Recommendation:** Start each rationale with the deciding trade-off, then the attribution with a link to `concepts_brief.md` ("Alternatives Weighed" / "Resolved in iteration 2"). For E, state what evidence would reverse the decision, for example the line 744 backtest. Make the attribution wording consistent.

### design-1-6: No Risks & Mitigations section, and several failure modes are not covered - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Also raised by:** `egm-structural` (Major)
* **Affected Scope:** Lines 61-66, 97, 711-731
* **Discrepancy Description:** The standard requires stated failure modes, security implications and limits, each with a mitigation.
  - Accepted risks appear only as a bold paragraph inside "The Problem", mostly with no mitigation.
  - Other mitigations are scattered through the Technical Plan, NFR and Open Questions.
  - Line 97 says "recorded under Risks", but no such section exists.
  - These failure modes are missing entirely:
    - exchange outage at candle close;
    - stop slippage or gaps through the stop (the simulator ignores both);
    - whether the bracket SL is stop-market or stop-limit;
    - wicks on `last_traded_price` on a thin book;
    - ADL size reduction, which would trigger the line 421 HALT;
    - SQLite file loss;
    - VPS loss.
* **Rationale & Recommendation:** Add a `## Risks & Mitigations` H2 with a table: Risk / Impact / Likelihood / Mitigation / Residual. It should cover:
  - the per-stop loss;
  - no testnet;
  - the stage-1 stop netting below zero;
  - no proven edge;
  - the unprotected reversal window;
  - unconfirmed bracket-edit behaviour;
  - leverage drift and margin mode;
  - clock skew;
  - rate limits;
  - dashboard exposure;
  - the missing failure modes listed above.

  Make line 97 an anchor link to the new section.

### design-1-7: The brief's daily-loss limit was dropped without a record - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 423-436, 37, 63
* **Discrepancy Description:** `concepts_brief.md:40` recommended both a daily-loss limit and a consecutive-loss limit. Only the consecutive breaker is implemented. That breaker ignores losing reversals and `sl_stage_1` exits (line 429), so repeated losing reversals can drain the account without ever tripping it. No Alternative records the decision.
* **Rationale & Recommendation:** Add a daily or equity-drawdown halt, or add an Alternative that rejects it with a concrete reason and a link.

### design-1-8: Alerts are optional, but most mitigations depend on "alert" - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 524, 557, 143, 365, 376, 395, 402, 457
* **Discrepancy Description:** Many failures are handled by "halt and alert". Telegram is optional, and `/health` returns 200 while the bot is HALTED. With no Telegram configured, a halted bot, or a position whose bracket failed, looks healthy to the monitor.
* **Rationale & Recommendation:** Require an alert channel when `DRY_RUN=false`, and refuse to start without one. Alternatively, have `/health` return a distinct non-200 status or body flag when the bot is halted or has an unresolved alert.

### design-1-9: A crash during entry orphans the OPENING row and loses the trade's attribution - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 420, 417, 383-391, 82
* **Discrepancy Description:** Suppose the entry fills and the process crashes before the row is marked `OPEN`. On boot, line 420 creates a new `adopted` row. The original `OPENING` row, which holds the strategy, signal and `entry_reason`, is never resolved, because line 417 only fires when the exchange is flat. This is exactly the restart case Goals 8 and 9 target.
* **Rationale & Recommendation:** If an `OPENING` row matches the exchange position's side (and its `client_order_id` fill, where possible), promote that row to `OPEN`. Use `adopted` only when no outbox row matches.

### design-1-10: Login rate limiting behind Caddy either locks the author out or can be spoofed - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 451, 455, 459-461
* **Discrepancy Description:** Without a `trust proxy` setting, every request appears to come from 127.0.0.1. Five bad logins from anyone would then lock the author out of Close, Pause and Resume. Trusting `X-Forwarded-For` carelessly would let the limit be bypassed by spoofing the header.
* **Rationale & Recommendation:** Specify `app.set('trust proxy', 'loopback')`, with Caddy setting `X-Forwarded-For`. Prefer backoff over a hard lockout. Document an SSH or CLI recovery path for pausing and closing when the dashboard is unreachable.

### design-1-11: The no-double-fill guarantee rests on an unverified `client_order_id` lookup - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 377, 384, 393, 401
* **Discrepancy Description:** The supplied API facts show neither a lookup by `client_order_id` nor uniqueness enforcement. If either is missing, a retry after a timeout could double the position, about 30% of the account per stop. There is also an id clash: a manual close (`eth-<candleTime>-close`) can reuse the id of a reversal or `trail_breached` close on the same candle.
* **Rationale & Recommendation:** Add both behaviours to Open Questions. Make the position-size check the main guard before any entry retry. Make close ids unique per reason and per attempt, for example `eth-<candleTime>-close-<reason>-<n>`.

### design-1-12: Margin mode (isolated vs cross) is never specified or checked - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 360-366, 75
* **Discrepancy Description:** Only leverage is set and checked. The context assumes "20x isolated" (`egm_context_delta_api.md:33`). In cross margin, the liquidation distance differs, so the line 365 claim that liquidation lies outside the stop only holds for isolated margin.
* **Rationale & Recommendation:** Assert isolated margin at boot and before each entry, and refuse to trade otherwise. Add the margin-mode API to Open Questions.

### design-1-13: The candle request can exceed the 2,000-candle cap - Severity: Major
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 216-219
* **Discrepancy Description:** `start=now-2000h&end=now` covers 2,001 hour buckets, including the bar still open. If the API truncates by keeping the oldest 2,000, the newest closed bar is always missing. Every cycle would then retry and log `CYCLE_MISSED`, and the bot would never trade. The design also assumes, without checking, that the candle `time` field is the bar's open time.
* **Rationale & Recommendation:** Use `start = floorHour(now) - 1999*3600` and `end = floorHour(now)`. Add the meaning of `time` to Open Questions.

### structural-1-1: Additional Resources and Future Improvements are nested under NFR - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Also raised by:** `egm-style` (Nit)
* **Affected Scope:** Lines 711, 733, 740
* **Discrepancy Description:** Both are `###` headings under `## Non-Functional Requirements`, so they read as NFR subtopics. They are also NFR's only H3 children; NFR's own content uses bold labels.
* **Rationale & Recommendation:** Promote both headings to `##`. Optionally, turn the NFR bold labels (713, 719, 724) into H3s.

### structural-1-2: The position state diagram contradicts the text and has a disconnected edge - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Also raised by:** `egm-design` (Nit)
* **Affected Scope:** Lines 240-252
* **Discrepancy Description:**
  - The diagram draws HALTED as a state, but line 251 says it is not a position state and that an OPEN position keeps being trailed while halted.
  - The "manual close / trail-breached" edge (247) has no source node.
  - There is no edge for the reconciler mismatch HALT (421).
* **Rationale & Recommendation:** Draw HALTED as a separate flag: either two diagrams, or a table of states plus the flag. Connect the manual-close / trail-breached edge from OPEN to CLOSING.

### structural-1-3: Trailing stage names are inconsistent - Severity: Major
* **Reviewer Lens:** `egm-structural`
* **Also raised by:** `egm-style` (Major)
* **Affected Scope:** Lines 82, 128-129, 156, 339, 344, 351-354, 416, 427, 446
* **Discrepancy Description:** The same stages are labelled differently across the document:
  - The ratchet table uses "2–3 (trail)".
  - Line 344 says "stage 0 to stage 3".
  - The CUJs use "stage 2/3" and "stage 2".
  - The stage derivation defines only 0, 1 and "trail".
  - The exit reasons are `sl_stage_0`, `sl_stage_1` and `sl_trail`.
  - Elsewhere the text says "stage N".

  A reader cannot tell whether stage 2 and stage 3 are separate states.
* **Rationale & Recommendation:** Define one stage enum, for example 0 = initial, 1 = lock +2.5, 2 = trail. Use those names everywhere: Goals, CUJs, reconciler, the `exit_reason` enum and `trades.stage`.

### style-1-1: The restart-safety goal is absolute and contradicts Goal 2 - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 77, 71
* **Discrepancy Description:** Goal 8 says a crash "at any point never leaves an unmanaged or doubled position". But Goal 2 allows a position to sit unbracketed for up to 60 s until reconciliation finds it, and the reconciler has a HALT path for unknown states (421). Design-1-9 and design-1-11 describe further gaps.
* **Rationale & Recommendation:** State the real guarantee. For example: "never opens a second position; an unbracketed position is bracketed within 60 s of boot; any side or size mismatch halts the bot."

### style-1-2: The "few seconds" exposure window is unmeasurable and partly wrong - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 71 (see 387, 389, 402)
* **Discrepancy Description:** Entry attaches the bracket in the same request (387), so it is unclear that entry has any gap. A reversal can leave the position unprotected for the 10 s flat-poll plus the entry fill-poll.
* **Rationale & Recommendation:** State the bound in terms of the sequence timeouts (for example, "up to about 20 s during a reversal"). Drop "entry" if the bracket is atomic.

### style-1-3: The parity tolerance is stated two different ways - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Also raised by:** `egm-structural` (Nit), `egm-design` (Nit)
* **Affected Scope:** Lines 73, 286
* **Discrepancy Description:** Goal 4 says "within one tick (0.05)". The golden test says "within 1e-6 (to 0.05 at worst)". Egm-design adds that TradingView values come from the full chart history while the 500-bar fixture starts cold, so the bars before the warm-up cannot match.
* **Rationale & Recommendation:** State one pass criterion, or define the tiers explicitly, and use the same wording in both places. State that only bars after the 200-bar warm-up are compared.

### style-1-4: "Ports the Pine code exactly" conflicts with "these ports become the reference" - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 256 (see 262, 281-284)
* **Discrepancy Description:** The section first makes Pine the reference, then declares the TypeScript ports the reference. It also drops options and adds explicit rounding, so "exactly" is untrue.
* **Rationale & Recommendation:** For example: "The TS code ports the Hull and UT Bot logic from `bot.pine` with the changes below. The TS ports are the reference, and `eth_strategy.pine` matches them."

### style-1-5: Reference to an "error table" that does not exist - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Also raised by:** `egm-design` (Nit)
* **Affected Scope:** Line 376
* **Discrepancy Description:** No error table exists in the range. The list in parentheses ends with "unknown", so the set of fatal errors is open-ended.
* **Rationale & Recommendation:** Either add the table (code, HTTP status, retry or fatal, action) or list the errors in the text. Define what "unknown" covers.

### style-1-6: The rate-limit claim is speculative and undercounts calls - Severity: Major
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 109 (compare 720)
* **Discrepancy Description:** "Far below any likely limit" has no evidence, and the same sentence admits the limits are unknown. "About 10 calls per hour" leaves out the reconciler: about 3 calls every 60 s is about 180 per hour, so the total is about 190 per hour.
* **Rationale & Recommendation:** Give the full count and drop the claim. Name the decision that depends on it, for example the reconcile interval.

---

## Nits

### design-1-14: Simulator treatment of the entry bar is unclear, and slippage differs from Pine - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 304-308, 541
* **Discrepancy Description:** "Each later bar" does not say whether SL/TP is checked on the entry bar, where the live stop is already active. Pine uses `slippage=1`; the TypeScript simulator uses none.
* **Rationale & Recommendation:** Check SL/TP on the entry bar, and align the slippage settings.

### design-1-15: Resume after any halt resets the breaker counter - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 436, 471, 248
* **Discrepancy Description:** Suppose an API-error halt occurs while `consecutive_sl=2`. Resume clears the halt and also resets the count to 0, which silently weakens the breaker.
* **Rationale & Recommendation:** Reset `consecutive_sl` only when `halt_reason` is the breaker.

### design-1-16: Schema gaps - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 442-451 (compare 532, 322, 558)
* **Discrepancy Description:** The schema is missing three things:
  - `trades` has no `dry_run` column.
  - There is nowhere to store `strategy_switch` events that happen while flat.
  - `kv` has no boot counter for the crash-loop guard.
* **Rationale & Recommendation:** Add these fields, or add a `system_events` table.

### design-1-17: Insight rules mix units - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 488, 490
* **Discrepancy Description:** Rule 3 compares live P&L in account dollars with simulated P&L per ETH. Rule 5's "2× stop size" has no unit.
* **Rationale & Recommendation:** Normalise both rules to per-ETH figures.

### design-1-18: Ordering for a same-bar switch is undefined - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 319, 225-230
* **Discrepancy Description:** If the selector switches while flat and the new strategy flips on the same bar, it is unclear whether the bot enters or waits.
* **Rationale & Recommendation:** Define the ordering explicitly.

### design-1-19: A stale lockfile after a crash is not handled - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Line 563
* **Discrepancy Description:** If `data/bot.lock` survives a crash, PM2 restarts can be blocked, and the open position is then not trailed.
* **Rationale & Recommendation:** Check that the stored PID is alive, or use `flock`.

### design-1-20: `/health` flaps on one failed call - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Line 457
* **Discrepancy Description:** A single failed Delta call turns `/health` to 503.
* **Rationale & Recommendation:** Return 503 only after a threshold of consecutive failures.

### design-1-21: Goal 1's 2-minute target conflicts with the retry window - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 70, 219
* **Discrepancy Description:** Retries run until HH:02:10, before execution even starts.
* **Rationale & Recommendation:** Align the two numbers.

### design-1-22: Dashboard polling may drive Delta API calls - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 464, 480
* **Discrepancy Description:** If `/api/status` fetches live data from Delta, every open tab adds calls every 15 s.
* **Rationale & Recommendation:** Serve status from the reconciler's cache.

### design-1-23: Manual closes, partial fills and trailing after a HALT are under-specified - Severity: Nit
* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Lines 396, 416, 421
* **Discrepancy Description:** Three cases are under-specified:
  - Labelling a manual close by price matching is ambiguous.
  - A partial fill must update `size_contracts`, or the reconciler halts on a size mismatch.
  - It is unclear whether trailing continues after a mismatch HALT.
* **Rationale & Recommendation:** Specify all three cases.

### structural-1-4: Open Questions are stale or contradicted by decided content - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Also raised by:** `egm-design` (Nit)
* **Affected Scope:** Lines 107-108 (compare 261-262, 358), 103
* **Discrepancy Description:** The questions do not match the rest of the document:
  - The HMA half-length question (108) is already settled at 262.
  - The settlement-asset question (107) is listed as open, but line 358 states it as fact.
  - The section comes before the terms it uses are introduced.
* **Rationale & Recommendation:**
  - Close or reword question 108.
  - Mark line 358 as provisional and link it to question 107.
  - Consider moving Open Questions after the Technical Plan.

### structural-1-5: Alternatives subsections use different templates - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 575-707
* **Discrepancy Description:** "How it works" appears in only 6 of the 16 alternatives. Pros and Cons are sometimes inline and sometimes bulleted, even within one alternative.
* **Rationale & Recommendation:** Use one fixed template: How it works / Pros / Cons / Reason for Rejection / Decided by.

### structural-1-6: Bold-label colon placement is inconsistent - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 105-109 and 115-172 (compare 3-5, 70-89, 713-724)
* **Discrepancy Description:** Some labels use `**Label**:` and others use `**Label:**`.
* **Rationale & Recommendation:** Standardise on `**Label:**`.

### structural-1-7: Bold paragraphs are used as pseudo-headings - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 13, 20, 27, 33, 39, 55, 61, 302, 313, 315, 341, 381, 398
* **Discrepancy Description:** These blocks are missing from the outline and cannot be anchor-linked, yet other parts of the document refer to them by name.
* **Rationale & Recommendation:** Promote the referenced ones to H4: Entry sequence, Close sequence, Simulator, Selector rule. Move the accepted-risks block into the new Risks section (design-1-6).

### structural-1-8: Internal cross-references are plain text - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 72, 97, 225, 286, 623
* **Discrepancy Description:** None of these references is a link, and line 97's reference has no target at all.
* **Rationale & Recommendation:** Convert them to Markdown anchor links.

### structural-1-9: The Delta docs link is a bare URL - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Line 738
* **Discrepancy Description:** Lines 735-737 use the `[text](path): description` form; line 738 does not.
* **Rationale & Recommendation:** `[Delta Exchange API docs](https://docs.delta.exchange/): ...`.

### structural-1-10: The component map box has a misaligned right border - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 192, 195 (block 186-210)
* **Discrepancy Description:** Each of these two lines is one column wider than the rest of the box.
* **Rationale & Recommendation:** Trim one space from each line.

### structural-1-11: Exit-reason lists do not match - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Also raised by:** `egm-style` (Nit)
* **Affected Scope:** Lines 82, 420, 446
* **Discrepancy Description:** Goal 9 leaves out `trail_breached` and `adopted_close`. The text never says when `adopted_close` is used.
* **Rationale & Recommendation:** Have Goal 9 point to the line 446 enum, and define `adopted_close`.

### structural-1-12: CUJ 6 breaks the CUJ format - Severity: Nit
* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** Lines 168-172
* **Discrepancy Description:** CUJ 6 uses an inline "Then:" with bullets instead of a numbered list.
* **Rationale & Recommendation:** Use a numbered list, as in CUJs 1-5.

### style-1-7: The sizing phrase reads as "divide by 141 ETH" - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 35
* **Discrepancy Description:** "the account balance ÷ 141 ETH" is ambiguous.
* **Rationale & Recommendation:** "Position size in ETH is the USD balance ÷ 141, in 0.01 ETH steps."

### style-1-8: The problem statement presents unmeasured observations as fact - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 52
* **Discrepancy Description:** "throws away most trades" and "produces many false signals" have no data behind them.
* **Rationale & Recommendation:** Attribute both to the author's observation.

### style-1-9: Outcome claims go beyond the mechanism - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 58, 59
* **Discrepancy Description:** "does not flip on noise" and "The dashboard answers that" overstate what the hysteresis and the dashboard do.
* **Rationale & Recommendation:** "small score differences do not trigger a switch" and "records the data needed to answer that."

### style-1-10: "Off by default" does not match the parameter table - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 64, 518, 652
* **Discrepancy Description:** `MAX_CONTRACTS` defaults to 100000, which is not "off". "Soften" is vague.
* **Rationale & Recommendation:** State the real defaults, and say what each flag limits.

### style-1-11: Filler words - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 65, 100, 143, 180, 674
* **Discrepancy Description:** "truly", "deliberately", "rather than continuing", "fully", "very".
* **Rationale & Recommendation:** Remove these words.

### style-1-12: The backtest timing caveat is misplaced and contradicts Goal 11 - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 66, 89
* **Discrepancy Description:** Line 66 says "before live trading". Goal 11 says "before and during".
* **Rationale & Recommendation:** Move the caveat to Rollout (line 725) as an explicit gate (see design-1-4), and make Goal 11 agree with it.

### style-1-13: Unsupported API claim - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 220
* **Discrepancy Description:** "Delta has no gap-filling" does not appear in the API context file.
* **Rationale & Recommendation:** Cite a source, or reword as a design choice: "The bot does not fill gaps."

### style-1-14: Hard-to-read numbers in the CUJs - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 126, 129
* **Discrepancy Description:** "+13.6" and "+26.6" have no unit. In "max(2,241.40, 2,243.00)" the commas are both thousands separators and argument separators.
* **Rationale & Recommendation:** Write "+$13.60" and "max($2241.40, $2243.00)".

### style-1-15: The insight message text differs between CUJ 6 and the rule - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 172, 487
* **Discrepancy Description:** The same rule produces different sample messages in the two places.
* **Rationale & Recommendation:** Use one canonical message string in both.

### style-1-16: Alternative B's rejection contradicts its own Pros - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 590, 594
* **Discrepancy Description:** The Pros say each source can check the other, but the rejection says "no added safety". "Moving parts" is an idiom.
* **Rationale & Recommendation:** "Cross-checking does not justify a second signal path and a rule for resolving disagreements."

### style-1-17: Uneven standard of evidence - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 604
* **Discrepancy Description:** Alternative C is faulted for "no evidence", but the chosen N=10 and $20 margin have no evidence either.
* **Rationale & Recommendation:** "adds a threshold parameter that would need its own tuning."

### style-1-18: Rule 3 is cited for more than it covers - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 623 (compare 488, 744)
* **Discrepancy Description:** Rule 3 compares live results with simulated results per strategy. It does not compare adaptive selection with a fixed strategy, which is the point Alternative E raises.
* **Rationale & Recommendation:** Describe accurately what rule 3 shows, or point to the walk-forward backtest at line 744.

### style-1-19: Vague or subjective cons and pros - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Lines 643, 680, 695, 706
* **Discrepancy Description:** "Much smaller positions", "Harder to grow", "nuanced feedback", "slow it down".
* **Rationale & Recommendation:** Make each one concrete. For example, a 2% risk sizes about 7 times smaller than the current position.

### style-1-20: Awkward rollout bullet - Severity: Nit
* **Reviewer Lens:** `egm-style`
* **Affected Scope:** Line 726
* **Discrepancy Description:** "go live with `MAX_CONTRACTS=1` optional" is ungrammatical. The heading-level part of this finding is merged into structural-1-1.
* **Rationale & Recommendation:** "Optionally start with `MAX_CONTRACTS=1`."
