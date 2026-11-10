# tradingbot-eth

A bot that trades the ETHUSD perpetual on **Delta Exchange India** on 1h candles. It picks between two signals, **Hull Suite (55)** and **UT Bot (key 2, ATR 6)**, and manages each trade with Strategy v2:
- a volatility-based stop;
- a break-even move;
- an ATR trailing stop;
- risk-based sizing.

It runs on Node.js 22+, Express and TypeScript, managed by PM2, with a password-protected React dashboard.

> **Read this before going live.**
>
> **Strategy v2 risks 20% of the balance on every trade by default (`RISK_PER_TRADE=0.2`).**
>
> On the backtest it turned $141 into about $5,500 over Feb 2024 – Nov 2026, but the account fell **51%** from a peak along the way. In 20,000 simulated years:
> - 17% fall by half at some point;
> - 11% end the year below the starting balance.
>
> Most of the profit came from about 10 big trend trades, and live results are usually worse than a backtest. Run `DRY_RUN=true` first, and only trade money you can afford to lose. See [Research results](#research-results).

## What it does

Every hour, at HH:00:10 UTC:

1. It fetches the last 2,000 closed 1h candles and computes Hull, UT Bot and ATR(14).
2. It simulates both strategies over that window, using the same exits and entry filters as live trading. It scores each strategy by net P&L over its last 10 simulated trades.
   - It switches strategy only when the other one leads by **$20 or more**, and only while flat or on an opposite signal.
3. It acts on the **active** strategy:

   | Signal | Action |
   | :--- | :--- |
   | signal while flat | enter (if the entry filters allow) |
   | opposite signal while in a trade | close, then reverse if the entry filters allow; otherwise close only |
   | otherwise, in a trade | update the stop |

**Entry filters.** A new trade is skipped when any of these holds:
- the fill would fall on **Saturday or Sunday India time** (Fri 18:30 – Sun 18:30 UTC);
- **ATR(14) is below $15** (a quiet market);
- **2 × ATR is above $40**, so the stop would be too wide;
- the stop would be more than half the distance to liquidation.

**Each trade:**
- **Stop (R):** R = max($10, 2 × ATR(14)) at the signal candle. The stop goes at entry ∓ R as an exchange-side order, so it stays in place if the bot or server goes down.
- **Take-profit:** none.
- **Exit:** the stop, or the opposite signal.

**The stop moves on each candle close and never loosens:**

| Profit on close | Stop moves to |
| :--- | :--- |
| ≥ 0.5R | entry ± round-trip fees, so the trade can no longer lose (stage 1) |
| ≥ 1.5R | highest high since entry − 3 × ATR (lowest low + 3 × ATR for shorts), and it keeps following (stage 2) |

**Sizing.**
- **Formula:** contracts = balance × risk ÷ (R + round-trip fees + slippage) ÷ 0.01. A stop-loss hit therefore loses about `risk` of the balance.
- **Risk:** `RISK_PER_TRADE` (20%), dropping to `RISK_REDUCED` (5%) while the balance is more than `RISK_REDUCE_DD` (20%) below its peak.
- **Caps:** the size is capped by margin (balance × 20 × 0.9) and by `MAX_CONTRACTS`.
- **Peak:** the peak is tracked separately for paper and live trading. After a deposit or withdrawal, run `npm run ctl -- reset-peak`.

**Safety rules:**
- **Breaker:** three trades stopped at the initial stop with no winning trade between them halt new entries. You resume from the dashboard or with `npm run ctl -- resume`. In the backtest it would have fired twice in 3 years.
- **Reconciler:** runs every 60 s and treats the exchange as the source of truth. It:
  - re-attaches a missing stop;
  - adopts unknown positions, assuming a $40 stop;
  - settles exchange-side exits;
  - halts on anything it can't explain.
- **Failed re-attach:** if a stop can't be re-attached during a trail, the bot closes the trade and halts.

## Settings (`.env`)

| Key | Default | Meaning |
| :--- | :--- | :--- |
| `DRY_RUN` | false | `true` **locks** paper trading. `false` **allows** live trading, which still starts only when you press **Go live** in the dashboard (Settings). |
| `SECRETS_KEY` | — | 64 hex characters (`openssl rand -hex 32`). Encrypts the API keys you save in the dashboard. |
| `CREDENTIALS_SOURCE` | auto | `auto`: dashboard keys first, then `DELTA_API_KEY`/`SECRET` from `.env`. `env`: `.env` keys only (recovery). |
| `RISK_PER_TRADE` | 0.2 | share of the balance lost if the initial stop is hit (maximum 0.3) |
| `RISK_REDUCED` | 0.05 | risk used while the balance is more than `RISK_REDUCE_DD` below its peak |
| `RISK_REDUCE_DD` | 0.2 | drawdown from peak that switches to `RISK_REDUCED` |
| `MIN_ATR` | 15 | skip new entries while 1h ATR(14) is below this many $ (0 = off) |
| `SKIP_WEEKEND_ENTRIES` | true | no new entries on Saturday or Sunday India time. A weekend opposite signal only closes; open trades are still managed. |
| `ATR_GATE_MAX` | 0 (off) | optional: also skip new entries while ATR(14) is above this many $ |
| `STRATEGY` | adaptive | `adaptive`, `hull` or `ut` |
| `LEVERAGE` | 20 | set and checked before every entry |
| `MAX_CONTRACTS` | 100000 | order size cap; `100` = at most 1 ETH |
| `ISOLATED_MARGIN_CONFIRMED` | false | alternative to the Go-live checkbox: confirms you chose **isolated** margin for ETHUSD in the Delta app |
| `PAPER_BALANCE` | 141 | starting balance for `DRY_RUN` |

The exit rules are fixed in [`src/config/params.ts`](src/config/params.ts), following design Amendment A:
- stop: `SL_ATR_MULT` 2, `SL_MIN` $10, `SL_MAX` $40;
- break-even: `BE_TRIG_R` 0.5;
- trailing: `TRAIL_TRIG_R` 1.5, `TRAIL_ATR_MULT` 3;
- take-profit: `TP_R` 0 (none).

## Local setup

```bash
npm ci
cp .env.example .env            # then fill it in (see below)
npm run hash-password           # → DASHBOARD_PASSWORD_HASH
openssl rand -hex 32            # run twice → SESSION_SECRET and CTL_TOKEN
npm run build                   # server → dist/, dashboard → web/dist/
npm test                        # 193 tests
npm run smoke                   # DRY_RUN end-to-end: boot + one real candle cycle against Delta, then exit
```

To try the dashboard locally, set `DRY_RUN=true` and `COOKIE_SECURE=false` in `.env`, run `npm start`, and open http://127.0.0.1:3000.

## VPS setup (Ubuntu)

1. **Node and tools:** Node 22 LTS (`better-sqlite3` needs Node ≥ 22). Then:
   ```bash
   sudo apt install chrony
   npm i -g pm2
   pm2 install pm2-logrotate
   ```
2. **Firewall:** `ufw allow 22,443/tcp && ufw enable`.
3. **HTTPS:** Caddy, using [`Caddyfile.example`](Caddyfile.example). Express listens on 127.0.0.1 only.
4. **Delta API key:**
   - trade permission only, no withdrawals;
   - IP-whitelisted to the VPS's static IP;
   - in the Delta app, set **isolated** margin for ETHUSD, then set `ISOLATED_MARGIN_CONFIRMED=true`.
5. **Install and start:**
   ```bash
   npm ci && npm run build
   chmod 600 .env
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```
6. **Monitoring:** point an uptime monitor at `https://<your-domain>/health`. It returns 503 when the bot is halted, has a position without a stop, has missed a cycle, or Delta calls keep failing. Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) is optional.

If `npm ci` reports that `better-sqlite3` was built without its native module, run `npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3`.

## Operating

**Dashboard pages:**
- **Overview:** position, active strategy and scores, current risk per trade and peak, the entry filters, equity curve, and the Close / Pause / Resume controls. Each control needs a second click to confirm.
- **Trades:** every trade. Click one to see why it opened (including R, risk and size), every stop move, why it closed, and fees.
- **Decisions:** one row per candle, showing what each strategy said and what the bot did, including which filter blocked an entry.
- **Insights:** rule-based "what can be improved" notes, such as fee drag, break-even stop-outs, live vs simulated, losing hours and initial-stop rate.

**Settings page:**
- **Delta API keys:** saved encrypted after a live test with Delta. Only the last 4 characters of the key are ever shown.
- **Trading mode:** Go live / Back to paper. Each needs your password and no open position, and the bot restarts itself under PM2.
- **Mode badge:** the header shows **PAPER** or **LIVE** on every page.

**Over SSH:** `npm run ctl -- status | pause | resume | close | reset-peak`. It goes through the running bot, so it never races the hourly cycle.

**Logs:** `pm2 logs eth-bot`. These are JSON lines, with one `cycle` line per candle.

**Rollout checklist:**
1. Run `npm run backtest` and `npm run livesim`.
2. Run `npm run smoke`.
3. Run with `DRY_RUN=true` for 1–2 weeks, and compare the dashboard's trades with `npm run backtest` for the same period.
4. **Testnet check.** Strategy v2 sends stop-only bracket orders, which have not yet been verified against Delta. On the testnet (`DELTA_BASE_URL=https://cdn-ind.testnet.deltaex.org`) with `MAX_CONTRACTS=1`, confirm that Delta accepts each of these without a take-profit:
   - the entry order with only `bracket_stop_loss_price`;
   - `PUT /v2/orders/bracket` with only the stop;
   - `POST /v2/orders/bracket` with only `stop_loss_order`.
5. **First live trade** with `MAX_CONTRACTS=1`. Confirm on Delta that:
   - the stop sits at entry ∓ R and there is no take-profit;
   - the stop moves to break-even and then trails;
   - a manual close flattens the position and cancels the stop;
   - the liquidation price is far beyond the stop.
6. Remove the `MAX_CONTRACTS` cap so the bot sizes by `RISK_PER_TRADE`.

## Backtests and research

| Command | What it does |
| :--- | :--- |
| `npm run backtest -- --pages 13` | the built strategy (live code), adaptive vs Hull vs UT, per 1 ETH after fees and slippage |
| `npm run livesim` | the built strategy with live sizing, the risk throttle, the margin cap and the breaker: real history from $141, plus a 12-month Monte Carlo |
| `npm run research5 -- --pages 13 [--refresh]` | the exit search: ATR stop × break-even × trailing × TP × minimum ATR. It first checks that the bot's simulator matches this research simulator trade for trade. |
| `npm run research5b` | robustness: neighbouring settings, quarters, 3× slippage, profit concentration |
| `npm run trail20` / `npm run throttle` / `npm run riskmc` | trailing variants at 20% risk, risk throttles, and time to double by risk level |
| `npm run patterns` | ETH 1h pattern study: momentum, breakouts, mean reversion, hour of day, volatility regimes |

Outputs are saved in `data/`, and candles are cached in `data/eth_1h_cache.json` (`--refresh` refetches them). Research rounds 1–4, on the original $20 ladder, are archived in `scripts/archive/`. Their outputs stay in `data/research*-2026-11-09.txt`.

### Research results

Data: Delta ETHUSD 1h, Feb 2024 – Nov 2026, after fees with GST and 1 tick of slippage. Variants were chosen on the first 70% of the data and checked on the last 30%.

| Variant | Per 1 ETH | Notes |
| :--- | :--- | :--- |
| Original $20 ladder, weekends blocked | −$560/yr training, +$238/yr test | about 52% of trades hit the $20 stop, and fees ate the rest |
| **Strategy v2 (built)** | **+$3,350 over 2.76 years**, profit factor 2.67, 62% winners, max drawdown $235 | about 58 trades a year; Hull alone made +$1,957 and UT alone +$2,414 |

**Account results with live sizing** (`npm run livesim`, 20% risk dropping to 5% when more than 20% below the peak):
- **Real history:** $141 → $5,502. The biggest fall from a peak was **51%**, and the breaker would have fired twice.
- **12-month Monte Carlo:**
  - 82% double, typically in about 2.3 months;
  - **17% fall by half at some point**;
  - **11% end below $141**;
  - the worst 2% end near $88.

**Caveats:**
- **Concentration:** about 10 trend trades made most of the profit. Missing one or two big trends can turn a year negative.
- **Fragile setting:** with a stop of 2.25 × ATR instead of 2 ×, the result nearly vanishes.
- **Optimistic sampling:** the Monte Carlo resamples the same historical trades. It understates how losses cluster, and it has no live-execution problems.

## TradingView

[`eth_strategy.pine`](eth_strategy.pine) is **out of date**: it still shows the original $20 ladder. The bot does not depend on it, so use it only to view the Hull and UT signals. [`bot.pine`](bot.pine) is unchanged.

**Golden test (indicator parity):**
1. Add `eth_strategy.pine` to any ETHUSD perpetual 1h chart.
2. Export about 700 bars with the `Hull` and `UT stop` plots.
3. Save them as `tests/fixtures/eth_1h_golden.csv` with columns `time,open,high,low,close,hull,ut_stop`.

`npm test` then checks the TypeScript indicators against TradingView's to within 0.01.

## Design

The full design is in [docs/designs/eth_trading_bot.md](docs/designs/eth_trading_bot.md). It was reviewed in 5 stages, and the review reports are in the repo root. Strategy v2 is "Amendment A" at the end of the design, and its review findings are in A.9.

**First-run verification.** These exchange fields are logged raw on first use so you can confirm them:
- the bracket-edit behaviour, including stop-only;
- the `margin_mode` field;
- the fills `start_time` unit;
- the length limit on `client_order_id`.
