# EGM Stage 6: Comprehension Test

Target: `docs/designs/eth_trading_bot.md`. Feature section: lines 1–748. Detailed implementation: lines 749–1220.

The reviewer read the persona, the full design, `egm_context_delta_api.md`, `concepts_brief.md` and all 1,407 lines of `bot.pine`. No document standard applies to this stage.

## What this proposes

A single Node/TypeScript process, run under PM2 on a VPS, trades only the ETHUSD perpetual (product 3136) on Delta Exchange India with real money.

**Each hour, after the 1h candle closes, it:**

1. fetches about 2,000 candles;
2. recomputes Hull (HMA 55) and UT Bot (ATR 6, key 2) from scratch;
3. simulates each strategy separately at a size of 1 ETH;
4. scores each strategy by its net P&L over its last 10 simulated trades;
5. trades the signal of the "active" strategy.

The bot switches strategy only when the other one leads by $20 or more, and only while flat or on that strategy's opposite signal.

**Every position:**

* carries a $20 stop-loss and a $100 take-profit, held on the exchange as a bracket;
* has its stop moved toward profit on each close:
  * at +$12 profit, the stop moves to entry ± 2.5;
  * from +$25 profit, it moves to max(entry + 15, close − 10).

**Sizing and safety:**

* Size is floor(balance × 100 / 141) contracts.
* Size is capped by the margin available at a verified 20x leverage.
* A breaker stops new entries after three initial-stop losses with no profitable trade between them.
* A reconciler runs at boot and every 60 seconds. It treats the exchange as the source of truth, and repairs or adopts positions.

**Companion pieces:**

* A password-protected React dashboard shows trades, decisions, strategy scores and rule-based insights.
* A new `eth_strategy.pine` repeats the logic on TradingView for an approximate backtest. The TypeScript simulator is the reference backtest.

## How the existing system works, per this document

Today there is only `bot.pine`, a TradingView indicator of about 1,400 lines.

**What it does:**

* It draws SMC, FVG, order-block, session and three-bar-reversal tools, plus UT Bot (lines 919–995) and Hull Suite (lines 997–1032).
* It only plots and fires alerts. The alerts use `alert.freq_once_per_bar`, so they can fire before a bar has closed.

**How it is used:** the author trades the signals by hand, moves stops manually, and chooses between Hull and UT by feel. No trade log exists.

**Claims checked against the file.** The design's statements about `bot.pine` are accurate:

* The Heikin-Ashi option requests plain `close` (line 925), so it has no effect.
* The UT stop calculation, which reuses its own previous value, is at lines 927–935.
* The file uses `max_bars_back=500` and `request.security_lower_tf`.

`bot.pine` stays unchanged.

The reviewer could paraphrase every section, so there are no Blockers. The findings below are places where the parts do not connect, or where a new reader cannot tell what happens.

---

## Major

### M1. The action table contradicts the text about the halted state

Lines 228–233 vs 251–252.

* The table's last row reads "Halted | any signal | `NONE`".
* The text says otherwise:
  * line 251: an open position is still trailed while halted;
  * line 252: while halted, an opposite signal still closes the position and only skips the re-entry.
* **Effect:** someone building `decide()` from the table would stop trailing, and stop closing on reversal, while halted.
* **Fix:** split the halted rows into "flat" and "in position". Give the in-position row `TRAIL` and a close-only action.

### M2. Stage names do not match each other, and "stage 3" and "stage N" are never defined

Lines 29–31, 82, 129, 156, 339, 344, 351–354, 416, 446, 1026.

* The Overview describes three steps.
* The ratchet table merges the last two into one row, "2–3 (trail)".
* Stage derivation produces only 0, 1 and "trail".
* Other places use different names:
  * CUJ 2 says "stage 2/3";
  * line 344 says a candle can jump "from stage 0 to stage 3";
  * CUJ 5 says "stop at stage 2".
* Exit reasons appear as `sl_stage_N` (lines 416, 1026) and as "trailed stop at stage N" (Goal 9). The schema list, however, has `sl_stage_0 / sl_stage_1 / sl_trail`.
* **Effect:** a reader cannot tell how many stages exist, what the `stage` column stores, or what the reconciler writes when a trailed stop fires.

### M3. The source of the "last price" is never named

Lines 348, 360, 387, 531, 986, and 963–966.

* These all use the "last" or "ticker" price:
  * the margin cap;
  * the starting bracket prices;
  * the `trail_breached` check;
  * paper fills in `DRY_RUN`.
* No endpoint is named for that price. The API context file has none, and the `ExchangePort` interface has no ticker method.
* **Effect:** whoever builds it would have to invent this piece.

### M4. Several events that are not trades have nowhere to be stored

* **`strategy_switch` events** (line 322, needed for Goal 5) are not in the `trade_events.type` list (line 448). `trade_events` also needs a `trade_id`, which a switch made while flat does not have.
* **Other records with no defined home:**
  * the "last switch reason" on the strategy card (line 1124);
  * breaker history, "number of halts and the dates" (line 493);
  * the crash-loop boot counter, "counted in `kv`" (line 558);
  * the paper broker's state, "mirrored in `kv`" (line 985).
* None of these appear in the `kv` key list (line 450) or in any table.

### M5. On the switching bar, it is unclear what happens to a signal from the new strategy

Lines 226–230 and 319–320.

* Rule 3: when flat, the pending strategy becomes active, then "the bot waits for the new active strategy's next flip".
* Rule 4: when in a position, a signal from the pending strategy switches strategy and reverses the position at once.
* **The unclear case:** the bot is flat and the pending strategy flips on this very bar.
  * Rule 3 suggests no entry.
  * The state table suggests `ENTER`, because step 7 runs after the selector.
* The design does not explain why rules 3 and 4 treat this case differently.

### M6. Adopted positions and `adopted_close` are not specified fully

Lines 420 and 446.

* **Existing row:** for the case "open | any | none or `OPENING`", the reconciler should "create a `trades` row with reason `adopted`". When an `OPENING` row already exists, it is unclear whether that row is promoted or a second row is created.
* **Missing details:** no strategy, stage or breaker handling is given for an adopted trade.
* **Undefined reason:** `adopted_close` is in the list of exit reasons but is never defined.

### M7. Some exchange-side exits have no defined reason

Lines 416 and 1026–1027.

* An exit is classified only by matching the order id, or by a fill within 1 tick of the stored stop or take-profit.
* **These cases match neither:**
  * a price gap through the stop, which fills more than 1 tick away;
  * liquidation, or the exchange's auto-deleverage;
  * a manual close in the Delta app.
* The design does not say whether these count toward the breaker.

### M8. Client order IDs for manual closes and retries are undefined

Lines 384, 398, 401 and 993.

* The close ID is `eth-<candleTime>-close`.
* The Technical Plan defines `close(reason)` with no candle time. The Detailed Plan adds a `candleTime` argument.
* **Manual close:** for a close sent from the dashboard at an arbitrary time, the design does not say which candle time is used.
* **Repeated ID:** two closes in one hour (a manual close, then `trail_breached`) would reuse the same ID.
* **Unstated dependency:** the design never says whether Delta rejects or ignores a repeated `client_order_id`, yet the safe-retry logic at line 377 depends on it.

### M9. Insight rule 3 mixes units and does not say how trades are paired

Lines 488 and 958.

* Simulated trades are measured per 1 ETH. Live trades are measured at the actual position size.
* The rule flags when live trails simulated "by more than $20 per trade". It does not say whether live P&L is first converted to per-ETH, or how live and simulated trades are matched up.
* `computeInsights` takes `simScores`, not the simulated trades themselves.
* Rule 5's "−2× the stop size" has the same unit problem.

### M10. Leverage is set only at boot, and only while flat

Lines 362–365.

* **The failing case:** the bot boots while a position is open (as in CUJ 5, or after a deploy), and the exchange leverage is not 20.
* **Effect:** after that position closes, every entry check fails the leverage read-back, and nothing ever sets leverage again. The bot refuses all entries.
* **Fix:** say whether leverage is set again the first time the bot is flat, or whether this lockout is intended.

## Nit

**Wording**

* **Lines 35, 63, 510:** "balance ÷ 141 ETH" reads as division by "141 ETH". The design never says what 141 is: the author's chosen number of dollars of balance per 1 ETH of position.
* **Lines 37, 76 vs 425–429:** "in a row" and "consecutive" really mean "with no profitable trade in between". Losing reversals and trailed exits neither count nor reset the counter. The Overview and Goal 7 should say so.
* **Lines 557, 1061:** "alert" is used throughout, but Telegram is optional. When Telegram is off, an alert is presumably just a log line. The design should say so.
* **Line 1185:** "margin cap at $4,000" does not say whether $4,000 is the ETH price or the balance. The math says it is the price.
* **Line 65:** "cost to cost" is trading jargon, explained only indirectly as the +$2.5 step.

**Contradictions inside the design**

* **Lines 241–248:** the state diagram draws `HALTED` as a position state, but line 251 says it is not one. The arrows into `CLOSING` and `HALTED` are also hard to read.
* **Line 286 vs line 73:** the golden test says "within 1e-6 (to 0.05 at worst)", which does not say which threshold is the pass/fail rule. Goal 4 says one tick.
* **Line 143 vs lines 392–396 and 406:** CUJ 3 says "If any step fails, the bot halts". The Technical Plan instead retries the entry, looks up the order by `client_order_id`, and re-attaches the bracket before halting.
* **Signature mismatches between the two plans:**
  * `select(scoreHull, …, signals)` (line 315) vs `select(input)` with `positionSide` and `override` (line 935);
  * `next(...)` (line 425) vs `nextCount(...)` (line 945);
  * `close(reason)` (line 398) vs `close(reason, candleTime)` (line 993).
* **Line 478 vs 1111 and 1126:** the Technical Plan lists a Controls page. The Detailed Plan's router has no `/controls` route, and the controls sit on the Overview page.
* **Line 794 vs 562, 783 and 819:** with `rootDir "."` and both `src` and `scripts` included, tsc writes `dist/src/index.js`. PM2 and `npm start` run `dist/index.js`, so the two do not match as written.

**Missing behaviour**

* **Lines 285 and 222:** the candle window moves forward every hour, and the UT stop starts from `nz(...,0)` at the window's first bar. The design does not explain why 200 warm-up bars are enough for the values to settle and match TradingView's full-history values.
* **Lines 302–311 vs 296:** the simulator rules do not say whether, after a stop-loss or take-profit exit, it waits for the next flip the way live trading does.
* **Line 219:** after `CYCLE_MISSED`, the design does not say what happens to that candle's signal and trailing update. Presumably both are lost.
* **Line 419:** the "missing bracket" case does not cover only one of the stop or the take-profit being missing.

**Summary:** no Blockers, 10 Major, 15 Nits. The Majors most likely to cause wrong code are M1 (halted actions), M2 (stage naming), M3 (missing price source) and M4 (where non-trade events are stored).
