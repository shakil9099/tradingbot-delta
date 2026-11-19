import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { algoAlpha, groupByHour } from '../src/core/algoAlpha.js';
import { decideRevAA, type DecideRevAAInput } from '../src/core/decide.js';
import { computeAll } from '../src/core/signals.js';
import type { Candle } from '../src/shared/types.js';
import { makeEngine } from './fakes/setup.js';

const H = 1_699_999_200;

// ---------- decideRevAA (design §3 table) ----------
describe('decideRevAA', () => {
  const base: DecideRevAAInput = { halted: false, haltKind: null, position: null, revSignal: 'NONE', aaBreak: 0, entryBlock: null };
  const d = (o: Partial<DecideRevAAInput>) => decideRevAA({ ...base, ...o });
  const long = { side: 'buy' as const };

  it('flat + reversal signal → ENTER on its side', () => {
    expect(d({ revSignal: 'SHORT' })).toMatchObject({ action: 'ENTER', side: 'sell' });
  });
  it('flat + reversal signal but entry blocked → NONE with the reason', () => {
    const r = d({ revSignal: 'LONG', entryBlock: 'daily loss stop: x' });
    expect(r.action).toBe('NONE');
    expect(r.reason).toContain('daily loss stop');
  });
  it('flat + halted → NONE', () => expect(d({ revSignal: 'LONG', halted: true, haltKind: 'manual' }).action).toBe('NONE'));
  it('flat, no signal → NONE (an AlgoAlpha break alone never enters)', () => expect(d({ aaBreak: 1 }).action).toBe('NONE'));

  it('long + opposite AlgoAlpha break → CLOSE', () => expect(d({ position: long, aaBreak: -1 }).action).toBe('CLOSE'));
  it('long + same-side AlgoAlpha break → TRAIL', () => expect(d({ position: long, aaBreak: 1 }).action).toBe('TRAIL'));
  it('long + opposite break + opposite reversal signal → REVERSE to short', () => {
    expect(d({ position: long, aaBreak: -1, revSignal: 'SHORT' })).toMatchObject({ action: 'REVERSE', side: 'sell' });
  });
  it('reverse blocked by the gate / daily stop → CLOSE only', () => {
    const r = d({ position: long, aaBreak: -1, revSignal: 'SHORT', entryBlock: 'weekend' });
    expect(r.action).toBe('CLOSE');
    expect(r.reason).toContain('reverse blocked: weekend');
  });
  it('opposite reversal signal alone is ignored → TRAIL', () => {
    const r = d({ position: long, revSignal: 'SHORT' });
    expect(r.action).toBe('TRAIL');
    expect(r.reason).toContain('opposite reversal signal ignored');
  });
  it('AlgoAlpha unavailable in a trade → TRAIL, noted', () => {
    const r = d({ position: long, aaBreak: null, entryBlock: 'AlgoAlpha unavailable' });
    expect(r.action).toBe('TRAIL');
    expect(r.reason).toContain('aa_break exit not checked');
  });
  it('protecting halt: opposite break closes, never reverses', () => {
    expect(d({ position: long, halted: true, haltKind: 'manual', aaBreak: -1, revSignal: 'SHORT' }).action).toBe('CLOSE');
    expect(d({ position: long, halted: true, haltKind: 'breaker' }).action).toBe('TRAIL');
  });
  it('mismatch / fatal halt → NONE (author decides)', () => {
    expect(d({ position: long, halted: true, haltKind: 'mismatch', aaBreak: -1 }).action).toBe('NONE');
  });
});

// ---------- AlgoAlpha ----------
describe('algoAlpha', () => {
  const bar = (time: number, o: number, c: number, h = Math.max(o, c) + 1, l = Math.min(o, c) - 1): Candle => ({ time, open: o, high: h, low: l, close: c, volume: 100 });

  it('a big lower wick makes a bearish level at its 3m volume POC; one close below is not a break, two are', () => {
    const c: Candle[] = [];
    for (let i = 0; i < 30; i++) c.push(bar(i * 3600, 100, 100.5));
    c.push(bar(30 * 3600, 100, 101, 101.5, 90)); // lower wick 10 vs ~1 average
    c.push(bar(31 * 3600, 101, 91)); // first close below
    c.push(bar(32 * 3600, 91, 91)); // second close below → break
    const ltf = c.map(() => [] as Candle[]);
    ltf[30] = [
      { time: 30 * 3600, open: 92, high: 92.5, low: 91.8, close: 92, volume: 1000 },
      { time: 30 * 3600 + 180, open: 99, high: 99.5, low: 98.5, close: 99, volume: 10 },
    ];
    const r = algoAlpha(c, ltf);
    expect(r.brk[31]).toBe(0);
    expect(r.brk[32]).toBe(-1);
    expect(r.trend[32]).toBe(-1);
    expect(r.brk.filter((x) => x !== 0)).toHaveLength(1);
  });

  it('no 3m bars inside the wick bar → no level (POC undefined)', () => {
    const c: Candle[] = [];
    for (let i = 0; i < 30; i++) c.push(bar(i * 3600, 100, 100.5));
    c.push(bar(30 * 3600, 100, 101, 101.5, 90), bar(31 * 3600, 101, 91), bar(32 * 3600, 91, 91));
    expect(algoAlpha(c, c.map(() => [])).brk.every((x) => x === 0)).toBe(true);
  });

  it('groupByHour puts 3m bars in their hour and drops the rest', () => {
    const c = [bar(0, 1, 1), bar(3600, 1, 1)];
    const g = groupByHour(c, [bar(0, 1, 1), bar(3420, 1, 1), bar(3600, 1, 1), bar(7200, 1, 1)]);
    expect(g.map((x) => x.length)).toEqual([2, 1]);
  });

  // Golden: the latest breaks the research port listed for comparison with TradingView (docs/algoalpha-backtest.md).
  const cached = existsSync('data/eth_1h_cache.json') && existsSync('data/eth_3m_cache.json');
  it.skipIf(!cached)('matches the TradingView-checked breaks of 6–13 Nov 2026 (needs the local data cache)', () => {
    const h1 = (JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[]).filter((x) => x.high > x.low || x.volume > 0);
    const m3 = JSON.parse(readFileSync('data/eth_3m_cache.json', 'utf8')) as Candle[];
    const end = h1.findIndex((x) => x.time === Date.UTC(2026, 10, 13, 3) / 1000);
    const c = h1.slice(end - 3999, end + 1);
    const r = algoAlpha(c, groupByHour(c, m3));
    const want = ['2026-11-06T06', '2026-11-09T07', '2026-11-10T16', '2026-11-12T14', '2026-11-12T15', '2026-11-13T03'];
    const from = Date.UTC(2026, 10, 6, 6) / 1000;
    const got = c.map((b, i) => ({ t: new Date(b.time * 1000).toISOString().slice(0, 13), v: r.brk[i], time: b.time })).filter((x) => x.v !== 0 && x.time >= from);
    expect(got.map((x) => x.t)).toEqual(want);
    expect(got.every((x) => x.v === -1)).toBe(true);
  });
});

// ---------- revaa cycle ----------
/** `n` closed 1h bars ending at H − 3600 whose newest bar has a reversal signal, plus 20 3m bars per hour. */
function revSeries(n = 4000): { h1: Candle[]; m3: Candle[]; sig: string } {
  const total = n + 1200;
  const closes = Array.from({ length: total }, (_, i) => 2000 + 120 * Math.sin(i / 37) + 40 * Math.sin(i / 7));
  const raw = closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: 0, open: o, high: Math.max(o, c) + 4, low: Math.min(o, c) - 4, close: c, volume: 100 + (i % 5) };
  });
  const ind = computeAll(raw, DEFAULT_PARAMS);
  let end = -1;
  for (let t = total - 1; t >= n; t--) if (ind.sigRev[t] !== 'NONE') {
    end = t;
    break;
  }
  const h1 = raw.slice(end - n + 1, end + 1).map((c, i) => ({ ...c, time: H - 3600 * (n - i) }));
  const m3: Candle[] = [];
  for (const b of h1)
    for (let k = 0; k < 20; k++) {
      const px = b.open + ((b.close - b.open) * (k + 1)) / 20;
      m3.push({ time: b.time + k * 180, open: px, high: px + 0.5, low: px - 0.5, close: px, volume: 5 });
    }
  return { h1, m3, sig: ind.sigRev[end] };
}

describe('runCycle, STRATEGY=revaa', () => {
  const S = revSeries();
  const setup = (over: Record<string, unknown> = {}) => {
    const e = makeEngine({ STRATEGY: 'revaa', MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: false, ...over });
    e.fx.candles = S.h1;
    e.fx.candles3m = S.m3;
    e.fx.price = S.h1.at(-1)!.close;
    return e;
  };

  it('flat + reversal signal → ENTER as strategy revaa; backfills 4,000 h of 3m bars; note has aa and rev', async () => {
    const { fx, repo, engine } = setup();
    const r = await engine.cycle();
    expect(r.kind).toBe('done');
    if (r.kind !== 'done') return;
    expect(r.decision.action).toBe('ENTER');
    expect(r.decision.active).toBe('revaa');
    expect(r.decision.note).toMatch(/\| aa (UP|DOWN|none) \| rev (LONG|SHORT)/);
    const t = repo.openTrade()!;
    expect(t.strategy).toBe('revaa');
    expect(t.side).toBe(S.sig === 'LONG' ? 'buy' : 'sell');
    expect(repo.listCandles3m(H - 4000 * 3600, H)).toHaveLength(80_000);
    expect(fx.candleCalls.filter((x) => x.startsWith('1h'))).toHaveLength(3); // 4,000 bars in ≤1,999-hour requests
  });

  it('the next hour fetches only the new 3m bars', async () => {
    const { fx, engine, advance } = setup();
    await engine.cycle();
    const before = fx.candleCalls.filter((x) => x.startsWith('3m')).length;
    fx.candles = [...S.h1, { ...S.h1.at(-1)!, time: H }];
    fx.candles3m = [...S.m3, ...Array.from({ length: 20 }, (_, k) => ({ ...S.m3.at(-1)!, time: H + k * 180 }))];
    advance(3600);
    await engine.cycle();
    const calls = fx.candleCalls.filter((x) => x.startsWith('3m')).slice(before);
    expect(calls).toEqual([`3m ${H} ${H + 3599}`]);
  });

  it('an hour with no 3m bars → AlgoAlpha unavailable: no entry, reason in the note', async () => {
    const { fx, repo, engine } = setup();
    const gap = H - 100 * 3600;
    fx.candles3m = S.m3.filter((x) => x.time < gap || x.time >= gap + 3600);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('NONE');
    expect(r.kind === 'done' && r.decision.note).toContain('3m candles missing');
    expect(repo.openTrade()).toBeNull();
  });

  it('newest 3m bar not published → retried, then unavailable; no entry', async () => {
    const { fx, repo, engine } = setup();
    fx.candles3m = S.m3.slice(0, -1);
    const r = await engine.cycle({ retryMs: 1 });
    expect(r.kind === 'done' && r.decision.note).toContain('3m candles stale');
    expect(repo.openTrade()).toBeNull();
  });

  it('3m fetch failure → unavailable, no entry', async () => {
    const { fx, repo, engine } = setup();
    fx.fail('getCandles3m');
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.note).toContain('3m candle fetch failed');
    expect(repo.openTrade()).toBeNull();
  });

  it('daily loss stop: a realised −10% today blocks the entry; derived, so it holds after a restart', async () => {
    const { repo, engine, c } = setup({ DAY_LOSS_STOP: 0.1 });
    // Balance 300 now; −40 closed today → day start 340; −40 ≤ −34.
    repo.insertTrade({ client_order_id: 'x', status: 'CLOSED', side: 'buy', size_contracts: 100, strategy: 'revaa', exit_time: c.now() - 600, net_pnl: -40, dry_run: 0 });
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('NONE');
    expect(r.kind === 'done' && r.decision.note).toContain('daily loss stop');
  });

  it('daily loss stop: yesterday’s loss and a small loss today do not block', async () => {
    const { repo, engine, c } = setup({ DAY_LOSS_STOP: 0.1 });
    repo.insertTrade({ client_order_id: 'y', status: 'CLOSED', side: 'buy', size_contracts: 100, strategy: 'revaa', exit_time: c.now() - 2 * 86400, net_pnl: -200, dry_run: 0 });
    repo.insertTrade({ client_order_id: 'z', status: 'CLOSED', side: 'buy', size_contracts: 100, strategy: 'revaa', exit_time: c.now() - 600, net_pnl: -10, dry_run: 0 });
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('ENTER');
  });

  it('old 3m rows beyond the window are pruned', async () => {
    const { repo, engine } = setup();
    repo.upsertCandles3m([{ time: H - 5000 * 3600, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
    await engine.cycle();
    expect(repo.listCandles3m(0, H - 4200 * 3600)).toHaveLength(0);
  });
});

describe('Hull path unchanged', () => {
  it('STRATEGY=hull still fetches one 2,000-bar window [top − 1999 h, top − 1] and no 3m candles', async () => {
    const { fx, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = revSeries(2000).h1;
    await engine.cycle();
    expect(fx.candleCalls).toEqual([`1h ${H - 1999 * 3600} ${H - 1}`]);
  });
});
