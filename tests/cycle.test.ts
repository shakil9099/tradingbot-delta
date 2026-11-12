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
