// Shared candle fetcher for scripts (public Delta India endpoint, no auth).
import { DEFAULT_PARAMS } from '../../src/config/params.js';
import type { Candle } from '../../src/shared/types.js';

const BASE = process.env.DELTA_BASE_URL ?? 'https://api.india.delta.exchange';
export const HOUR = 3600;
const PAGE = 2000;

export function argPages(): number {
  const i = process.argv.indexOf('--pages');
  const v = i >= 0 ? Number(process.argv[i + 1]) : 4;
  if (!Number.isInteger(v) || v < 1 || v > 50) throw new Error('--pages must be an integer 1..50');
  return v;
}

async function fetchPage(start: number, end: number, resolution = "1h"): Promise<Candle[]> {
  const url = `${BASE}/v2/history/candles?resolution=${resolution}&symbol=${DEFAULT_PARAMS.SYMBOL}&start=${start}&end=${end}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'tradingbot-eth/1.0 (backtest)', Accept: 'application/json' } });
  if (!res.ok) throw new Error(`candles HTTP ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { success: boolean; result: Array<Record<string, number>> };
  if (!body.success || !Array.isArray(body.result)) throw new Error('unexpected candles response');
  return body.result.map((r) => ({
    time: Number(r.time),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));
}

export const RES_SEC: Record<string, number> = { "15m": 900, "1h": 3600 };

/** Closed candles, newest `pages` × 2,000 bars, at `resolution` (15m or 1h). */
export async function fetchHistory(pages: number, resolution = "1h"): Promise<Candle[]> {
  const S = RES_SEC[resolution];
  if (!S) throw new Error(`unsupported resolution ${resolution}`);
  const now = Math.floor(Date.now() / 1000);
  const top = Math.floor(now / S) * S; // open time of the current (unclosed) bar
  const byTime = new Map<number, Candle>();
  for (let i = 0; i < pages; i++) {
    const end = top - i * PAGE * S - 1;
    const start = top - (i + 1) * PAGE * S;
    const page = await fetchPage(start, end, resolution);
    for (const c of page) byTime.set(c.time, c);
    if (page.length === 0) break;
  }
  return [...byTime.values()].filter((c) => c.time + S <= now).sort((a, b) => a.time - b.time);
}

