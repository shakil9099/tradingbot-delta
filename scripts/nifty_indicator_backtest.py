import pandas as pd
import numpy as np
import pandas_ta as ta
import yfinance as yf

def backtest_indicator_strategy(ticker="^NSEI", start_date="2024-01-01", end_date="2024-12-31"):
    # 1. Fetch Historical Data (e.g., Nifty 50 Index on 5-minute or Daily timeframe)
    print(f"Fetching data for {ticker}...")
    df = yf.download(ticker, start=start_date, end=end_date, interval="1d")

    # Flatten MultiIndex columns if returned by yfinance
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df.dropna(inplace=True)

    # 2. Calculate Indicators
    # A. SuperTrend (10, 3)
    supertrend = df.ta.supertrend(length=10, multiplier=3)
    # Column names differ across pandas_ta versions (SUPERT_10_3.0 vs SUPERT_10_3), so match by prefix
    col = lambda frame, prefix: next(c for c in frame.columns if c.startswith(prefix))
    df['Supertrend'] = supertrend[col(supertrend, 'SUPERT_')]
    df['Supertrend_Dir'] = supertrend[col(supertrend, 'SUPERTd_')] # 1 for uptrend, -1 for downtrend

    # B. RSI (14)
    df['RSI'] = df.ta.rsi(length=14)

    # C. Bollinger Bands (20, 2 std)
    bb = df.ta.bbands(length=20, std=2)
    df['Upper_BB'] = bb[col(bb, 'BBU_')]

    # D. Pivot Point R1 (Standard Pivot Calculation based on previous day)
    # For daily data, we calculate pivot using previous day's High, Low, Close
    df['Prev_High'] = df['High'].shift(1)
    df['Prev_Low'] = df['Low'].shift(1)
    df['Prev_Close'] = df['Close'].shift(1)

    df['Pivot'] = (df['Prev_High'] + df['Prev_Low'] + df['Prev_Close']) / 3
    df['R1'] = (2 * df['Pivot']) - df['Prev_Low']

    # 3. Define Entry Rules (All 4 conditions must be True)
    # 1. Uptrend: Price > SuperTrend (or SuperTrend direction == 1)
    # 2. Momentum: RSI > 70
    # 3. Market Structure: Close > R1
    # 4. Volatility Strength: Close > Upper Bollinger Band

    df['Cond_Trend'] = df['Supertrend_Dir'] == 1
    df['Cond_RSI'] = df['RSI'] > 70
    df['Cond_R1'] = df['Close'] > df['R1']
    df['Cond_BB'] = df['Close'] > df['Upper_BB']

    df['Signal'] = (df['Cond_Trend'] & df['Cond_RSI'] & df['Cond_R1'] & df['Cond_BB']).astype(int)

    # 4. Simulation & Exit Logic (Exit when SuperTrend flips to downtrend / -1)
    positions = []
    in_trade = False
    entry_price = 0

    for i in range(len(df)):
        current_close = df['Close'].iloc[i]
        st_dir = df['Supertrend_Dir'].iloc[i]
        signal = df['Signal'].iloc[i]

        if not in_trade and signal == 1:
            in_trade = True
            entry_price = current_close
            positions.append(('BUY', df.index[i], entry_price))
        elif in_trade and st_dir == -1:
            # Exit trade when SuperTrend flips negative
            in_trade = False
            positions.append(('SELL', df.index[i], current_close))

    print(f"Total Trades Generated: {len([p for p in positions if p[0] == 'BUY'])}")
    return df, positions


def summarize(df, positions):
    """Pair BUY/SELL legs and print per-trade and total % returns (no costs)."""
    trades = []
    for j in range(0, len(positions), 2):
        buy = positions[j]
        if j + 1 < len(positions):
            sell, status = positions[j + 1], "closed"
        else:
            sell, status = ('MARK', df.index[-1], df['Close'].iloc[-1]), "open (marked at last close)"
        ret = (sell[2] / buy[2] - 1) * 100
        trades.append(ret)
        print(f"  {buy[1].date()} BUY {buy[2]:.2f} -> {sell[1].date()} {sell[2]:.2f}  {ret:+.2f}%  [{status}]")
    if trades:
        wins = sum(1 for r in trades if r > 0)
        compounded = (np.prod([1 + r / 100 for r in trades]) - 1) * 100
        print(f"Win rate: {wins}/{len(trades)}  Avg: {np.mean(trades):+.2f}%  Compounded: {compounded:+.2f}%")
    bh = (df['Close'].iloc[-1] / df['Close'].iloc[0] - 1) * 100
    print(f"Buy & hold over same period: {bh:+.2f}%")


# Run Backtest
if __name__ == "__main__":
    df_results, trade_log = backtest_indicator_strategy()
    summarize(df_results, trade_log)
