// One cycle per closed 1h candle ("What happens on each candle close").

import { algoAlpha, groupByHour } from '../core/algoAlpha.js';
import { decide, decideRevAA } from '../core/decide.js';
import { entryGate } from '../core/entryGate.js';
import { riskDistance } from '../core/exits.js';
import { atrPine } from '../core/indicators.js';
import { select } from '../core/selector.js';
import { computeAll, direction, signalsFor } from '../core/signals.js';
import { score, simulate, type SimOptions } from '../core/simulator.js';
import type { Executor } from '../exchange/executor.js';
import { alert, log } from '../log.js';
import type { Candle, DecisionRow, Side, StrategyId } from '../shared/types.js';
import { floorHour, type Ctx } from './context.js';
import { syncLtf, type LtfResult } from './ltf.js';
import type { Mutex } from './mutex.js';

const HOUR = 3600;

export interface CycleDeps {
  c: Ctx;
  exec: Executor;
  mutex: Mutex;
  /** Candle-readiness retry: every retryMs, up to maxWaitMs. */
  retryMs?: number;
  maxWaitMs?: number;
  /** True once a mode/key switch is committed and the process is about to restart: no trading actions. */
  isSuspended?: () => boolean;
}

export type CycleOutcome = { kind: 'missed' } | { kind: 'duplicate' } | { kind: 'suspended' } | { kind: 'done'; decision: DecisionRow } | { kind: 'error'; message: string };

/** Fetches the 2,000-bar window ending at the last closed candle. Runs OUTSIDE the mutex. */
export async function waitForCandle(d: CycleDeps): Promise<Candle[] | null> {
  const { c } = d;
  const retryMs = d.retryMs ?? 15_000;
  const maxWaitMs = d.maxWaitMs ?? 120_000;
  for (let waited = 0; ; waited += retryMs) {
    const now = c.now();
    const top = floorHour(now);
    const want = top - HOUR;
    try {
      // STRATEGY=revaa needs AA_WINDOW bars (AlgoAlpha levels persist); every other strategy keeps 2,000.
      const bars = c.params.STRATEGY === 'revaa' ? c.params.AA_WINDOW : 2000;
      const raw: Candle[] = [];
      // Same request as before for 2,000 bars: [top − 1999h, top − 1]; larger windows are split into ≤1,999-hour requests.
      for (let s = top - (bars - 1) * HOUR; s < top; s += 1999 * HOUR) raw.push(...(await c.port.getCandles(s, Math.min(s + 1999 * HOUR, top) - 1)));
      const closed = raw.filter((x) => x.time + HOUR <= now).sort((a, b) => a.time - b.time);
      const dedup = closed.filter((x, i) => i === 0 || x.time !== closed[i - 1].time);
      if (dedup.length && dedup[dedup.length - 1].time === want) {
        let gaps = 0;
        for (let i = 1; i < dedup.length; i++) if (dedup[i].time - dedup[i - 1].time !== HOUR) gaps++;
        if (gaps) log.warn({ gaps }, 'candle window has gaps (not filled)');
        return dedup;
      }
    } catch (e) {
      log.warn({ err: e }, 'candle fetch failed');
    }
    if (waited + retryMs > maxWaitMs) return null;
    await c.sleep(retryMs);
  }
}

export async function runCycle(d: CycleDeps): Promise<CycleOutcome> {
  const { c, exec, mutex } = d;
  const candles = await waitForCandle(d);
  if (!candles) {
    c.repo.addSystemEvent('cycle_missed', { at: c.now() });
    c.repo.kvSet('last_cycle_at', c.now());
    alert('CYCLE_MISSED: the closed candle did not appear within 2 minutes');
    return { kind: 'missed' };
  }

  // STRATEGY=revaa: 3-minute candles for AlgoAlpha, outside the mutex. A stale newest bar is retried (it may publish late).
  let ltf: LtfResult | null = null;
  if (c.params.STRATEGY === 'revaa') {
    const top = candles[candles.length - 1].time + HOUR;
    for (let k = 0; ; k++) {
      ltf = await syncLtf(c, top, c.params.AA_WINDOW);
      if (ltf.ok || k >= 3 || !ltf.reason.startsWith('3m candles stale')) break;
      await c.sleep(d.retryMs ?? 15_000);
    }
  }

  return mutex.runExclusive(async (): Promise<CycleOutcome> => {
    // A cycle that waited for its candle outside the mutex must not act after a switch was committed (B.9 #3).
    if (d.isSuspended?.()) return { kind: 'suspended' };
    const { repo, params: p, port, halt } = c;
    const t = candles.length - 1;
    const bar = candles[t];
    try {
      if (repo.kvNum('last_processed_candle', 0) === bar.time) {
        repo.kvSet('last_cycle_at', c.now());
        return { kind: 'duplicate' };
      }

      const ind = computeAll(candles, p);
      const atr = atrPine(candles, p.ATR_LEN);
      const gate = entryGate(candles, p, atr);
      if (p.STRATEGY === 'revaa') return { kind: 'done', decision: await revaaStep(c, exec, candles, ind, atr, gate, ltf!) };
      const opts: SimOptions = { allowEntryAt: (i) => gate(i) === null, atr };
      const simHull = simulate('hull', candles, signalsFor('hull', ind), p, opts);
      const simUt = simulate('ut', candles, ind.sigUt, p, opts);
      repo.replaceSimTrades([...simHull, ...simUt]);
      const sc = { hull: score(simHull, p.SEL_N), ut: score(simUt, p.SEL_N) };

      const pos = await port.getPosition();
      const active0 = (repo.kvGet('active_strategy') as StrategyId | null) ?? 'hull';
      const pending0 = (repo.kvGet('pending_switch') as StrategyId | null) || null;
      const sel = select(
        {
          scores: { hull: sc.hull.score, ut: sc.ut.score },
          counts: { hull: sc.hull.count, ut: sc.ut.count },
          active: active0,
          pending: pending0,
          isFlat: !pos,
          positionSide: pos?.side ?? null,
          signals: { hull: ind.sigHull[t], ut: ind.sigUt[t] },
          override: p.STRATEGY === 'adaptive' ? null : p.STRATEGY,
        },
        p,
      );
      repo.kvSet('active_strategy', sel.active);
      repo.kvSet('pending_switch', sel.pending ?? '');
      if (sel.switched) {
        repo.addSystemEvent('strategy_switch', { from: active0, to: sel.active, reason: sel.reason, scores: { hull: sc.hull.score, ut: sc.ut.score } });
        alert(`strategy switch ${active0} → ${sel.active}: ${sel.reason}`);
      }

      const hs = halt.state();
      const activeSig = signalsFor(sel.active, ind)[t];
      let dec = decide({ halted: hs.halted, haltKind: hs.kind, position: pos ? { side: pos.side } : null, activeSignal: activeSig, activeDirection: direction(sel.active, ind, t) });
      let note = dec.reason;
      // Entry filters (weekend IST, low ATR, stop wider than SL_MAX, optional high-ATR gate): no new entries;
      // a reversal only closes.
      const blocked = gate(t);
      if (blocked) {
        if (dec.action === 'ENTER') {
          note = blocked;
          dec = { action: 'NONE', reason: note };
        } else if (dec.action === 'REVERSE') {
          note = `${dec.reason}; ${blocked}, so close only`;
          dec = { action: 'CLOSE', reason: note };
        }
      }

      // Mix B: Hull's signal on this bar came from a reversal signal (no Hull flip).
      const revReentry = sel.active === 'hull' && ind.sigHull[t] === 'NONE' && activeSig !== 'NONE';
      const reason = { strategy: sel.active, signal: revReentry ? 'rev_reentry' : dec.reason, candleTime: bar.time, scores: { hull: sc.hull.score, ut: sc.ut.score } };
      // Not blocked ⇒ riskDistance is non-null (the gate checks it).
      const R = riskDistance(atr[t], p);
      if (dec.action === 'ENTER' && R !== null) await exec.enter(dec.side as Side, bar.time, { ...reason, riskDist: +R.toFixed(2), atr: +atr[t].toFixed(2) }, R);
      else if (dec.action === 'REVERSE' && R !== null) await exec.reverse(dec.side as Side, bar.time, { ...reason, riskDist: +R.toFixed(2), atr: +atr[t].toFixed(2) }, R);
      else if (dec.action === 'CLOSE') await exec.close('reversal', bar.time);
      else if (dec.action === 'TRAIL') await exec.trail({ close: bar.close, atr: atr[t], candles });

      const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(4) : null);
      const decision: DecisionRow = {
        candle_time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        hull: n(ind.hull[t]),
        hull_prev2: n(ind.hull[t - 2]),
        ut_stop: n(ind.utStop[t]),
        // ATR(ATR_LEN), the one the entry gate and stop use. ind.atr is UT's ATR(UT_ATR) and must not be logged here.
        atr: n(atr[t]),
        sig_hull: ind.sigHull[t],
        sig_ut: ind.sigUt[t],
        score_hull: +sc.hull.score.toFixed(2),
        score_ut: +sc.ut.score.toFixed(2),
        active: sel.active,
        pending: sel.pending,
        action: dec.action,
        note:
          (hs.halted ? `halted (${hs.kind}): ${note}` : note) +
          // The decisions table has no reversal columns; its signal, zigzag state and threshold go in the note.
          (sel.active === 'reversal' ? ` | rev ${ind.sigRev[t]} dir ${ind.revDir[t]} th ${n(ind.revThreshold[t]) ?? 'na'}` : '') +
          (revReentry ? ` | rev re-entry ${ind.sigRev[t]} dir ${ind.revDir[t]}` : ''),
      };
      repo.insertDecision(decision);
      repo.kvSet('last_processed_candle', bar.time);
      repo.kvSet('last_cycle_at', c.now());
      log.info({ cycle: decision }, 'cycle');
      return { kind: 'done', decision };
    } catch (e) {
      const message = (e as Error).message;
      repo.insertDecision({
        candle_time: bar.time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        hull: null,
        hull_prev2: null,
        ut_stop: null,
        atr: null,
        sig_hull: 'NONE',
        sig_ut: 'NONE',
        score_hull: 0,
        score_ut: 0,
        active: (repo.kvGet('active_strategy') as StrategyId | null) ?? 'hull',
        pending: null,
        action: 'ERROR',
        note: message.slice(0, 500),
      });
      repo.kvSet('last_cycle_at', c.now());
      alert(`cycle error: ${message}`);
      return { kind: 'error', message };
    }
  });
}

const IST = 19800;

/** Daily loss stop (design §4): today's realised net vs the day-start balance rebuilt from the current balance. */
async function dayLossBlock(c: Ctx): Promise<string | null> {
  const p = c.params;
  if (!(p.DAY_LOSS_STOP > 0)) return null;
  const now = c.now();
  const dayStart = Math.floor((now + IST) / 86400) * 86400 - IST;
  const today = c.repo.realisedNet(dayStart, now + 1, p.DRY_RUN);
  if (today >= 0) return null;
  const balance = await c.port.getBalance();
  const start = balance - today;
  if (today <= -p.DAY_LOSS_STOP * start) return `daily loss stop: today ${today.toFixed(2)} USD ≤ −${(p.DAY_LOSS_STOP * 100).toFixed(0)}% of day-start ${start.toFixed(2)}`;
  return null;
}

/** One revaa cycle under the mutex (design §3): reversal entries, AlgoAlpha-break exits, Hull's stop/BE/trail. */
async function revaaStep(
  c: Ctx,
  exec: Executor,
  candles: Candle[],
  ind: ReturnType<typeof computeAll>,
  atr: number[],
  gate: (t: number) => string | null,
  ltf: LtfResult,
): Promise<DecisionRow> {
  const { repo, params: p, port, halt } = c;
  const t = candles.length - 1;
  const bar = candles[t];
  repo.kvSet('active_strategy', 'revaa');
  repo.kvSet('pending_switch', '');

  const aaBreak: 1 | -1 | 0 | null = ltf.ok ? algoAlpha(candles, groupByHour(candles, ltf.m3)).brk[t] : null;
  const pos = await port.getPosition();
  if (!ltf.ok) alert(`AlgoAlpha unavailable: ${ltf.reason}${pos ? '; aa_break exit not checked, stop and trail still on' : '; no entries'}`);
  const entryBlock = gate(t) ?? (ltf.ok ? null : 'AlgoAlpha unavailable') ?? (await dayLossBlock(c));
  const hs = halt.state();
  const revSignal = ind.sigRev[t];
  const dec = decideRevAA({ halted: hs.halted, haltKind: hs.kind, position: pos ? { side: pos.side } : null, revSignal, aaBreak, entryBlock });

  const R = riskDistance(atr[t], p);
  const reason = { strategy: 'revaa' as const, signal: dec.reason, candleTime: bar.time, scores: { hull: 0, ut: 0 } };
  if (dec.action === 'ENTER' && R !== null) await exec.enter(dec.side as Side, bar.time, { ...reason, riskDist: +R.toFixed(2), atr: +atr[t].toFixed(2) }, R);
  else if (dec.action === 'REVERSE' && R !== null) await exec.reverse(dec.side as Side, bar.time, { ...reason, riskDist: +R.toFixed(2), atr: +atr[t].toFixed(2) }, R, 'aa_break');
  else if (dec.action === 'REVERSE' || dec.action === 'CLOSE') await exec.close('aa_break', bar.time);
  else if (dec.action === 'TRAIL') await exec.trail({ close: bar.close, atr: atr[t], candles });

  const n = (v: number) => (Number.isFinite(v) ? +v.toFixed(4) : null);
  const aaTxt = aaBreak === null ? 'unavailable' : aaBreak === 1 ? 'UP' : aaBreak === -1 ? 'DOWN' : 'none';
  const decision: DecisionRow = {
    candle_time: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    hull: n(ind.hull[t]),
    hull_prev2: n(ind.hull[t - 2]),
    ut_stop: n(ind.utStop[t]),
    atr: n(atr[t]),
    sig_hull: ind.sigHull[t],
    sig_ut: ind.sigUt[t],
    score_hull: 0,
    score_ut: 0,
    active: 'revaa',
    pending: null,
    action: dec.action,
    note: `${hs.halted ? `halted (${hs.kind}): ` : ''}${dec.reason} | aa ${aaTxt} | rev ${revSignal} dir ${ind.revDir[t]}${!ltf.ok ? ` | ${ltf.reason}` : ''}`,
  };
  repo.insertDecision(decision);
  repo.kvSet('last_processed_candle', bar.time);
  repo.kvSet('last_cycle_at', c.now());
  log.info({ cycle: decision }, 'cycle');
  return decision;
}
