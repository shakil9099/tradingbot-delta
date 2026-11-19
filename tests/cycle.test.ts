import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/config/params.js';
import { computeAll } from '../src/core/signals.js';
import { ExchangeError } from '../src/exchange/types.js';
import type { Candle } from '../src/shared/types.js';
import { makeEngine } from './fakes/setup.js';

const H = 1_699_999_200;

/** 2,000 closed 1h bars ending at H − 3600, cut so the newest bar carries a Hull signal. */
function seriesWithHullSignalAtEnd(endTime = H): Candle[] {
  const n = 2600;
  const closes = Array.from({ length: n }, (_, i) => 2000 + 80 * Math.sin(i / 31) + 30 * Math.sin(i / 9));
  const raw = closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: 0, open: o, high: Math.max(o, c) + 3, low: Math.min(o, c) - 3, close: c, volume: 1 };
  });
  const ind = computeAll(raw, DEFAULT_PARAMS);
  let end = -1;
  for (let t = n - 1; t >= 2000; t--) if (ind.sigHull[t] !== 'NONE') {
    end = t;
    break;
  }
  const win = raw.slice(end - 1999, end + 1);
  return win.map((c, i) => ({ ...c, time: endTime - 3600 * (2000 - i) }));
}

describe('runCycle', () => {
  it('CYCLE_MISSED writes a system event and no decision row; the mutex is not held while waiting', async () => {
    const { fx, repo, engine, c } = makeEngine();
    fx.candles = seriesWithHullSignalAtEnd().slice(0, -1); // newest closed candle missing
    const heldDuringWait: boolean[] = [];
    c.sleep = async () => void heldDuringWait.push(engine.mutex.isHeld);
    const r = await engine.cycle({ retryMs: 15_000, maxWaitMs: 30_000 });
    expect(r.kind).toBe('missed');
    expect(repo.listSystemEvents('cycle_missed')).toHaveLength(1);
    expect(repo.listDecisions()).toHaveLength(0);
    expect(repo.kvNum('last_cycle_at')).toBeGreaterThan(0);
    expect(heldDuringWait.length).toBeGreaterThan(0);
    expect(heldDuringWait.every((h) => !h)).toBe(true);
  });

  it('flat + Hull signal on the newest bar → ENTER, decision row written', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    const r = await engine.cycle();
    expect(r.kind).toBe('done');
    if (r.kind !== 'done') return;
    expect(r.decision.action).toBe('ENTER');
    expect(repo.openTrade()!.status).toBe('OPEN');
    expect(repo.listDecisions()).toHaveLength(1);
    expect(repo.kvNum('last_processed_candle')).toBe(H - 3600);
    expect(repo.listSimTrades().length).toBeGreaterThan(0);
  });

  it('a duplicate candle is skipped', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = seriesWithHullSignalAtEnd();
    await engine.cycle();
    const r = await engine.cycle();
    expect(r.kind).toBe('duplicate');
    expect(repo.listTrades()).toHaveLength(1);
  });

  it('a suspended engine (mode switch committed) does not act, even after waiting for its candle', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = seriesWithHullSignalAtEnd();
    engine.suspend();
    expect((await engine.cycle()).kind).toBe('suspended');
    expect(repo.listTrades()).toHaveLength(0);
    expect(repo.listDecisions()).toHaveLength(0);
  });

  it('low volatility (ATR below MIN_ATR, default 15) turns ENTER into NONE', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull' });
    fx.candles = seriesWithHullSignalAtEnd();
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('NONE');
    expect(r.kind === 'done' && r.decision.note).toContain('low volatility');
    expect(repo.listTrades()).toHaveLength(0);
  });

  it('the entry gets R = max(SL_MIN, 2 × ATR(14)) of the signal bar, stored on the trade', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    await engine.cycle();
    const t = repo.openTrade()!;
    const er = JSON.parse(t.entry_reason);
    expect(t.risk_dist).toBeCloseTo(Math.max(10, 2 * er.atr), 1);
    expect(t.sl_price).toBeCloseTo(t.side === 'buy' ? t.entry_price! - t.risk_dist! : t.entry_price! + t.risk_dist!, 0);
  });

  it('the decision row logs ATR(ATR_LEN), the same ATR the entry gate and stop use (not UT ATR)', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0 });
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    await engine.cycle();
    const er = JSON.parse(repo.openTrade()!.entry_reason);
    expect(repo.listDecisions().at(-1)!.atr).toBeCloseTo(er.atr, 2);
  });

  it('the ATR volatility gate turns ENTER into NONE', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0, ATR_GATE_MAX: 0.01 });
    fx.candles = seriesWithHullSignalAtEnd();
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('NONE');
    expect(r.kind === 'done' && r.decision.note).toContain('volatility gate');
    expect(repo.listTrades()).toHaveLength(0);
  });

  it('on Saturday IST, ENTER becomes NONE; with SKIP_WEEKEND_ENTRIES=false it enters', async () => {
    const SAT = Date.parse('2023-11-18T06:00:00Z') / 1000; // Sat 11:30 IST
    for (const skip of [true, false]) {
      const { fx, repo, engine, setClock } = makeEngine({ STRATEGY: 'hull', MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: skip });
      setClock(SAT + 10);
      fx.candles = seriesWithHullSignalAtEnd(SAT);
      const r = await engine.cycle();
      if (skip) {
        expect(r.kind === 'done' && r.decision.action).toBe('NONE');
        expect(r.kind === 'done' && r.decision.note).toContain('weekend');
        expect(repo.listTrades()).toHaveLength(0);
      } else {
        expect(repo.listTrades()).toHaveLength(1);
      }
    }
  });

  it('a strategy switch writes a strategy_switch event (override ut)', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'ut' });
    fx.candles = seriesWithHullSignalAtEnd();
    await engine.cycle();
    expect(repo.listSystemEvents('strategy_switch')).toHaveLength(1);
    expect(repo.kvGet('active_strategy')).toBe('ut');
  });

  it('an exception writes an ERROR decision row', async () => {
    const { fx, repo, engine } = makeEngine();
    fx.candles = seriesWithHullSignalAtEnd();
    fx.fail('getPosition', new ExchangeError('boom', 'fatal'));
    const r = await engine.cycle();
    expect(r.kind).toBe('error');
    expect(repo.listDecisions()[0]).toMatchObject({ action: 'ERROR' });
  });
});

/** The two newest reversal signals (opposite sides) of a synthetic series, as 2,000-bar windows ending on each. */
function seriesWithReversalSignals(): { first: Candle[]; second: Candle[]; firstSide: 'buy' | 'sell' } {
  const n = 2600;
  const closes = Array.from({ length: n }, (_, i) => 2000 + 80 * Math.sin(i / 31) + 30 * Math.sin(i / 9));
  const raw = closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: H - 3600 * (n - i), open: o, high: Math.max(o, c) + 3, low: Math.min(o, c) - 3, close: c, volume: 1 };
  });
  const sig = computeAll(raw, DEFAULT_PARAMS).sigRev;
  const at: number[] = [];
  for (let t = n - 1; t >= 2000 && at.length < 2; t--) if (sig[t] !== 'NONE') at.unshift(t);
  const [a, b] = at;
  return { first: raw.slice(a - 1999, a + 1), second: raw.slice(b - 1999, b + 1), firstSide: sig[a] === 'LONG' ? 'buy' : 'sell' };
}

describe('STRATEGY=reversal', () => {
  it('enters on a reversal signal with an exchange stop and a 2R take-profit; logs the signal in the note', async () => {
    const { fx, repo, engine, setClock } = makeEngine({ STRATEGY: 'reversal', MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: false });
    const s = seriesWithReversalSignals();
    fx.candles = s.first;
    fx.price = s.first.at(-1)!.close;
    setClock(s.first.at(-1)!.time + 3600 + 10);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision).toMatchObject({ action: 'ENTER', active: 'reversal' });
    expect(r.kind === 'done' && r.decision.note).toMatch(/rev (LONG|SHORT) dir/);
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ side: s.firstSide, strategy: 'reversal' });
    const R = t.risk_dist!;
    const tp = t.side === 'buy' ? t.entry_price! + 2 * R : t.entry_price! - 2 * R;
    expect(fx.tp()?.stopPrice).toBeCloseTo(tp, 0);
    expect(fx.sl()?.stopPrice).toBeCloseTo(t.side === 'buy' ? t.entry_price! - R : t.entry_price! + R, 0);
  });

  it('the opposite reversal signal reverses the position', async () => {
    const { fx, repo, engine, setClock } = makeEngine({ STRATEGY: 'reversal', MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: false });
    const s = seriesWithReversalSignals();
    fx.candles = s.first;
    fx.price = s.first.at(-1)!.close;
    setClock(s.first.at(-1)!.time + 3600 + 10);
    await engine.cycle();
    fx.candles = s.second;
    fx.price = s.second.at(-1)!.close;
    setClock(s.second.at(-1)!.time + 3600 + 10);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('REVERSE');
    expect(repo.openTrade()!.side).toBe(s.firstSide === 'buy' ? 'sell' : 'buy');
  });

  it('a blocked opposite signal only closes', async () => {
    const { fx, repo, engine, setClock, c } = makeEngine({ STRATEGY: 'reversal', MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: false });
    const s = seriesWithReversalSignals();
    fx.candles = s.first;
    fx.price = s.first.at(-1)!.close;
    setClock(s.first.at(-1)!.time + 3600 + 10);
    await engine.cycle();
    c.params = { ...c.params, ATR_GATE_MAX: 0.01 };
    fx.candles = s.second;
    fx.price = s.second.at(-1)!.close;
    setClock(s.second.at(-1)!.time + 3600 + 10);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('CLOSE');
    expect(repo.openTrade()).toBeFalsy();
  });
});

/** A 2,000-bar window whose newest bar has a Mix B re-entry signal (a reversal signal, no Hull flip). */
function seriesWithRevReentryAtEnd(): { win: Candle[]; side: 'buy' | 'sell' } {
  const n = 2600;
  const closes = Array.from({ length: n }, (_, i) => 2000 + 80 * Math.sin(i / 31) + 30 * Math.sin(i / 9));
  const raw = closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { time: H - 3600 * (n - i), open: o, high: Math.max(o, c) + 3, low: Math.min(o, c) - 3, close: c, volume: 1 };
  });
  const ind = computeAll(raw, { ...DEFAULT_PARAMS, REV_REENTRY: true });
  let end = -1;
  for (let t = n - 1; t >= 2000; t--) if (ind.sigHull[t] === 'NONE' && ind.sigHullEntry[t] !== 'NONE') {
    end = t;
    break;
  }
  return { win: raw.slice(end - 1999, end + 1), side: ind.sigHullEntry[end] === 'LONG' ? 'buy' : 'sell' };
}

describe('Mix B: STRATEGY=hull with REV_REENTRY', () => {
  const opts = { STRATEGY: 'hull' as const, MIN_ATR: 0, SKIP_WEEKEND_ENTRIES: false };
  const atEnd = (fx: { candles: Candle[]; price: number }, setClock: (t: number) => void, win: Candle[]) => {
    fx.candles = win;
    fx.price = win.at(-1)!.close;
    setClock(win.at(-1)!.time + 3600 + 10);
  };

  it('flat: an agreeing reversal signal enters as Hull, tagged rev_reentry, with Hull exits (no TP)', async () => {
    const { fx, repo, engine, setClock } = makeEngine({ ...opts, REV_REENTRY: true });
    const s = seriesWithRevReentryAtEnd();
    atEnd(fx, setClock, s.win);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision).toMatchObject({ action: 'ENTER', active: 'hull', sig_hull: 'NONE' });
    expect(r.kind === 'done' && r.decision.note).toMatch(/rev re-entry (LONG|SHORT) dir/);
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ side: s.side, strategy: 'hull' });
    expect(JSON.parse(t.entry_reason!)).toMatchObject({ signal: 'rev_reentry' });
    expect(fx.tp()).toBeFalsy();
    expect(fx.sl()).toBeTruthy();
  });

  it('REV_REENTRY off: the same bar is not an entry (plain Hull)', async () => {
    const { fx, repo, engine, setClock } = makeEngine(opts);
    atEnd(fx, setClock, seriesWithRevReentryAtEnd().win);
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('NONE');
    expect(repo.openTrade()).toBeFalsy();
  });

  it('already in a trade on the same side: the signal does nothing new (trail)', async () => {
    const { fx, repo, engine, setClock } = makeEngine({ ...opts, REV_REENTRY: true });
    const s = seriesWithRevReentryAtEnd();
    atEnd(fx, setClock, s.win);
    await engine.manualEnter(s.side);
    const id = repo.openTrade()!.id;
    const r = await engine.cycle();
    expect(r.kind === 'done' && r.decision.action).toBe('TRAIL');
    expect(repo.openTrade()!.id).toBe(id);
  });
});

describe('manualEnter', () => {
  it('opens a sized short with an exchange stop, bypassing (and recording) the low-volatility filter', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull' }); // MIN_ATR 15 blocks a signal entry on this series
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    const r = await engine.manualEnter('sell');
    expect(r.result).toBe('opened');
    expect(r.note).toContain('low volatility');
    const t = repo.openTrade()!;
    expect(t).toMatchObject({ status: 'OPEN', side: 'sell' });
    expect(t.sl_price!).toBeGreaterThan(fx.price);
    expect(JSON.parse(t.entry_reason!)).toMatchObject({ signal: 'manual entry', manual: true });
    expect(repo.listSystemEvents('manual_enter')).toHaveLength(1);
  });

  it('respects MAX_CONTRACTS', async () => {
    const { fx, repo, engine } = makeEngine({ STRATEGY: 'hull', MAX_CONTRACTS: 3 });
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    expect((await engine.manualEnter('buy')).result).toBe('opened');
    expect(repo.openTrade()!.size_contracts).toBeLessThanOrEqual(3);
  });

  it('is refused when a position is open or the bot is halted', async () => {
    const { fx, repo, engine, halt } = makeEngine({ STRATEGY: 'hull' });
    fx.candles = seriesWithHullSignalAtEnd();
    fx.price = fx.candles.at(-1)!.close;
    await engine.manualEnter('buy');
    const again = await engine.manualEnter('sell');
    expect(again.result).toBe('refused');
    expect(again.note).toContain('already open');
    expect(repo.listTrades()).toHaveLength(1);

    const b = makeEngine({ STRATEGY: 'hull' });
    b.fx.candles = seriesWithHullSignalAtEnd();
    b.halt.halt('test', 'manual');
    const h = await b.engine.manualEnter('sell');
    expect(h.result).toBe('refused');
    expect(b.repo.listTrades()).toHaveLength(0);
    void halt;
  });
});
