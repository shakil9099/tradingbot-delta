// 3-minute candles for AlgoAlpha (STRATEGY=revaa, design_draft.md §2). Stored in candles_3m, fetched incrementally,
// pruned. "Unavailable" (fetch failed, newest bar stale, or an hour without bars in the window) = no entries, alert,
// open trades keep their stop and trail.

import type { Candle } from '../shared/types.js';
import { log } from '../log.js';
import type { Ctx } from './context.js';

const M3 = 180;
const HOUR = 3600;
/** Delta returns at most 2,000 candles per request. */
const PAGE = 2000;

export type LtfResult = { ok: true; m3: Candle[] } | { ok: false; reason: string };

/**
 * Brings candles_3m up to `top` (the open time of the current, unclosed hour) and returns the 3m bars of the window
 * [top − windowHours, top). Runs outside the mutex (network only, plus idempotent upserts).
 */
export async function syncLtf(c: Ctx, top: number, windowHours: number, pauseMs = 300): Promise<LtfResult> {
  const { repo, port } = c;
  const from0 = top - windowHours * HOUR;
  const last = repo.lastCandle3mTime();
  let from = last !== null && last >= from0 ? last + M3 : from0;
  let pages = 0;
  try {
    while (from < top) {
      const end = Math.min(from + PAGE * M3 - 1, top - 1);
      const rows = (await port.getCandles(from, end, '3m')).filter((x) => x.time >= from && x.time < top && x.time + M3 <= c.now());
      repo.upsertCandles3m(rows);
      from = end + 1;
      if (++pages > 1 && from < top) await c.sleep(pauseMs); // a boot backfill is ~40 pages: stay well under the rate limit
    }
  } catch (e) {
    return { ok: false, reason: `3m candle fetch failed: ${(e as Error).message}` };
  }
  if (pages > 5) log.info({ pages }, '3m candles backfilled');
  repo.pruneCandles3m(top - (windowHours + 200) * HOUR);

  const m3 = repo.listCandles3m(from0, top);
  const newest = m3.at(-1)?.time ?? null;
  if (newest !== top - M3) return { ok: false, reason: `3m candles stale (newest ${newest ?? 'none'}, want ${top - M3})` };
  const hours = new Set(m3.map((x) => Math.floor(x.time / HOUR) * HOUR));
  for (let h = from0; h < top; h += HOUR) {
    if (!hours.has(h)) return { ok: false, reason: `3m candles missing for the hour starting ${new Date(h * 1000).toISOString().slice(0, 16)}Z` };
  }
  return { ok: true, m3 };
}
