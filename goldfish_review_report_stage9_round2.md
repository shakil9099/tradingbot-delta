**Status: resolved** (Stage 9 round 2: all 35 findings fixed. The re-audit cap is reached, so no round 3 will run.)

# Goldfish Annotated Review Report: Stage 9, Round 2

**Target:** `docs/designs/eth_trading_bot.md`

**Source:** `implementation_readiness_report_round2.md` (1 Blocker, 14 Major, 20 Nit)

**Decision:** PROPOSE FIX for all 35 findings, applied after the author chose "Resolve with agent".

**Author-delegated choice:**
- `crash_loop` halts keep trailing and closing the open position, and block new entries.
- `mismatch` and `fatal_error` halts do nothing.
- `liquidation` halts happen only when the bot is already flat.

| Finding | Fix applied |
| :--- | :--- |
| codebase-details-2-1 (Blocker) | Poll `/positions/margined` for up to 15 s. Close and halt only on an explicit `cross`. If the mode is unknown, keep the position and alert; the reconciler re-checks and halts without closing after 5 minutes. Adds the `margin_mode` exit reason and `kv.margin_unknown_since`. New tests. |
| implementation-readiness-2-1 | Close step 6 does the bookkeeping: CLOSED, P&L, fees and the breaker. Test: a profitable reversal resets the counter. |
| implementation-readiness-2-2 | Every `HaltKind` maps to an action-table row. Adds `kv.halt_kind`. The resume rule uses `halt_kind`. One test per kind. |
| implementation-readiness-2-3 | The build order covers every file. Phase 1 compiles on its own. The backtest uses plain `fetch`. The `resume` test moves to phase 2. |
| implementation-readiness-2-4 | `simulateAdaptive` is specified step by step. |
| implementation-readiness-2-5 | A paper-broker method table: each method is marked virtual or passed through, with fill rules. Adds `PAPER_BALANCE`. Test file 70. |
| implementation-readiness-2-6 | Test files 69 (safety modules), 70 (paper broker) and 71 (boot), including the `ISOLATED_MARGIN_CONFIRMED` refusal. |
| codebase-details-2-2 | `trail` gets step 0, which reads the current SL from the exchange, plus explicit returns. The parameter is renamed `closePrice`. |
| codebase-details-2-3 | `tsconfig.scripts.json` becomes its own entry with `rootDir: "."`. `lint` uses it. The vitest claim is dropped. |
| codebase-details-2-4 | The fills `start_time` unit is provisionally microseconds, on the verify-on-first-run list. |
| style-2-1 | Safe boolean parsing with `z.enum`. Tested. |
| style-2-4 | Leverage is read back in the entry pre-checks. Tested. |
| style-2-5 | The server imports shared types by relative path; only Vite uses `@shared`. Adds `web/tsconfig` paths and `web/package-lock.json`. |
| style-2-6 | `lock.acquire()` creates `data/`. Tested. |
| style-2-7 | The safety-net row and its trade-off are added to the Technical Plan exit table. |
| Nits style-2-2, 2-3, 2-8 to 2-15; implementation-readiness-2-7, 2-8, 2-9; codebase-details-2-5 to 2-9 | All fixed as recommended. Covers the margin wording, `'hull'`, `Retry-After` showing the remaining time, `last_cycle_at` on all paths and at boot, stray orders cancelled before entry, file numbers, tolerances, the skew exit, the `simulate` signature, the callback wiring, sizing rows with price and leverage, the circular coverage claim, the net P&L measure, the Pine wait-for-flip and fees, the signature test vector, the `client_order_id` length on the verify list, golden signals derived from the indicator values, and the `candleTime` default. |
