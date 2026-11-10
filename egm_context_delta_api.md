# Context for Goldfish reviewers: Delta Exchange India API facts + feature hypothesis

## Feature hypothesis (confirmed by user)
A Node.js + Express + TypeScript bot trades only the ETHUSD perpetual on Delta Exchange India, LIVE (no testnet stage).
- Signals: bot computes Hull Suite (HMA 55; trend = HULL > HULL[2]) and UT Bot (ATR trailing stop, key 2, ATR 6) itself on 1h candles fetched from Delta. It does not use TradingView webhooks.
- Strategy choice: adaptive. Both strategies are simulated in the background; the bot trades whichever performed better over the recent N simulated trades.
- Directions: long and short. An opposite signal closes the current trade and opens the reverse trade.
- Size: balance_usd / 141 = ETH quantity, in 0.01 ETH steps (1 contract = 0.01 ETH, so contracts = floor(balance/141*100)).
- Risk per trade: SL is a $20 price move from entry; TP is a $100 price move. Both live on the exchange.
- Trailing, evaluated on each 1h candle close (ratchet only, never loosen):
  - profit >= $12 -> SL = entry + $2.5 (long) / entry - $2.5 (short)
  - profit >= $25 -> SL = entry + $15
  - after that, every candle close: SL = max(SL, close - 10) (long) / min(SL, close + 10) (short)
- The existing Pine script (bot.pine, a large SMC indicator with UT Bot + Hull sections) gets rewritten into a strategy matching this logic for backtesting/visual.
- Deployment: PM2 on a VPS. Express exposes /health, /status, manual close.

## Delta Exchange India facts (from docs.delta.exchange, fetched 2026-11-08)
- Prod REST: https://api.india.delta.exchange ; testnet: https://cdn-ind.testnet.deltaex.org
- Auth headers: api-key, signature (hex HMAC-SHA256 of method + timestamp + path + querystring(with ?) + body), timestamp (unix seconds), User-Agent required. Signature valid only 5 seconds.
- ETHUSD: product_id 3136, contract_value 0.01 ETH, tick_size 0.05, taker fee 0.05%, maker 0.02%, default leverage 200. Price ~ $2225 now. Fees on India also carry 18% GST.
- POST /v2/orders: product_id, size (contracts), side buy/sell, order_type market_order/limit_order, reduce_only, client_order_id, stop_order_type, stop_price, bracket_stop_loss_price, bracket_take_profit_price, bracket_stop_trigger_method (mark_price/last_traded_price/spot_price).
- PUT /v2/orders/bracket: edit bracket_stop_loss_price / bracket_take_profit_price for a product's position bracket.
- POST /v2/orders/bracket: attach SL+TP to an existing position (no size; closes whole position).
- DELETE /v2/orders, DELETE /v2/orders/all (product_id, cancel_stop_orders...).
- GET /v2/positions?product_id=3136 (real-time): size, entry_price. /v2/positions/margined may lag ~10s.
- GET /v2/wallet/balances: per-asset available_balance, balance.
- POST /v2/products/3136/orders/leverage body {leverage:"20"}.
- GET /v2/history/candles?resolution=1h&symbol=ETHUSD&start&end (unix seconds, max 2000 candles, no auth). Fields: time, open, high, low, close, volume.
- WebSocket exists with public candlesticks channel and private orders/positions channels (URL/format not confirmed in fetched excerpt).
- Rate-limit quota endpoint exists; numeric limits not documented in excerpt.

## Implied numbers
- 1 ETH notional ~ $2225 on $141 margin -> ~15.8x effective leverage; plan to set 20x isolated. Liquidation at 20x ~ 4.5% (~$100) away, beyond the $20 SL.
- Round-trip taker fees per ETH ~ $2.2 (+GST ~ $2.6). CTC at +$2.5 nets ~ $0.
