// Capital-first exit rule (design_draft.md, approved 2026-11-19): no stop move until +1R, then break-even and a tight
// ATR trail (k = 1.0 / 1.5 / 2.0), on Hull and reversal entries, against live Hull exits. All variants use 5% risk
// from $107 with live caps. Time split 50/20/30 (CHOOSE / CHECK / HOLDOUT); HOLDOUT is shown for the shortlist only.
// npx tsx scripts/capitalFirst.ts [--offline]
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, withStrategyPreset, type Params } from '../src/config/params.js';
import { nextCount, shouldHalt } from '../src/core/breaker.js';
import { entryGate } from '../src/core/entryGate.js';
import { computeAll } from '../src/core/signals.js';
import { simulate } from '../src/core/simulator.js';
import { contractsFor } from '../src/core/sizing.js';
import type { Candle, SimTrade } from '../src/shared/types.js';
import { fetchHistory } from './lib/candles.js';

const cached = JSON.parse(readFileSync('data/eth_1h_cache.json', 'utf8')) as Candle[];
const byTime = new Map(cached.map((x) => [x.time, x]));
if (!process.argv.includes('--offline')) for (const x of await fetchHistory(2)) byTime.set(x.time, x);
const c = [...byTime.values()].sort((a, b) => a.time - b.time).filter((x) => x.high > x.low || x.volume > 0);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

const START = 107;
const RISK = 0.05;
const MIN_HOLDOUT_TRADES = 30;

// Live as deployed: Hull, BE 1R, 3×ATR trail from 1.5R, no $ break-even, 1 ETH cap. Sizing set to a flat 5%.
const live: Params = {
  ...DEFAULT_PARAMS, STRATEGY: 'hull', MIN_ATR: 15, SKIP_WEEKEND_ENTRIES: true, MAX_CONTRACTS: 100,
  BE_TRIG_USD: 0, RISK_PER_TRADE: RISK, RISK_REDUCED: RISK, FIXED_CONTRACTS: 0,
};
const rule = (base: Params, k: number): Params => ({ ...base, BE_TRIG_R: 1, BE_TRIG_USD: 0, TRAIL_TRIG_R: 1, TRAIL_ATR_MULT: k, TP_R: 0 });

interface Variant { name: string; strategy: 'hull' | 'reversal'; p: Params; control?: boolean }
const variants: Variant[] = [
  { name: 'Hull, live exits (control)', strategy: 'hull', p: live, control: true },
  // Local build (2026-11-19, not deployed): also break-even when an hourly close is +$15 per ETH.
  { name: 'Hull, live exits + $15 break-even (local)', strategy: 'hull', p: { ...live, BE_TRIG_USD: 15 } },
  ...[1, 1.5, 2].map((k) => ({ name: `Hull, +1R then ${k}×ATR trail`, strategy: 'hull' as const, p: rule(live, k) })),
  ...[1, 1.5, 2].map((k) => ({
    name: `Reversal, +1R then ${k}×ATR trail`, strategy: 'reversal' as const,
    p: rule(withStrategyPreset({ ...live, STRATEGY: 'reversal' }, 0), k),
  })),
];

function run(v: Variant): SimTrade[] {
  const g = entryGate(c, v.p);
  const ind = computeAll(c, v.p);
  const sig = v.strategy === 'hull' ? ind.sigHull : ind.sigRev;
  return simulate(v.strategy, c, sig, v.p, { allowEntryAt: (i) => g(i) === null }).filter((t) => t.entryTime >= c[300].time);
}

// Segments by entry time over the bars after warm-up.
const t0 = c[300].time, tEnd = c[c.length - 1].time + 1;
const cut = (f: number) => t0 + (tEnd - t0) * f;
const SEG = { CHOOSE: [t0, cut(0.5)], CHECK: [cut(0.5), cut(0.7)], HOLDOUT: [cut(0.7), tEnd], FULL: [t0, tEnd] } as const;
type SegName = keyof typeof SEG;

interface Stats {
  n: number; win: number; perEth: number; ddEth: number; sumR: number; avgR: number;
  end: number; ddPct: number; skipped: number; trips: number;
}
function stats(all: SimTrade[], p: Params, seg: SegName): Stats {
  const [a, b] = SEG[seg];
  const xs = all.filter((t) => t.entryTime >= a && t.entryTime < b);
  let e = 0, pk = 0, ddEth = 0, w = 0, sumR = 0;
  let bal = START, peak = START, ddPct = 0, skipped = 0, cnt = 0, trips = 0;
  for (const t of xs) {
    e += t.netPnl; pk = Math.max(pk, e); ddEth = Math.max(ddEth, pk - e);
    if (t.netPnl > 0) w++;
    sumR += t.netPnl / t.riskDist!;
    const s = contractsFor({
      balanceUsd: bal, price: t.entry, riskDist: t.riskDist!, risk: RISK, leverage: p.LEVERAGE, maxContracts: p.MAX_CONTRACTS,
      feeRate: p.FEE_RATE, tick: p.TICK, slippageTicks: p.SLIPPAGE_TICKS, contractValue: p.CONTRACT_VALUE,
    });
    if (s.contracts === 0) { skipped++; continue; }
    bal += s.contracts * p.CONTRACT_VALUE * t.netPnl;
    peak = Math.max(peak, bal);
    ddPct = Math.max(ddPct, (peak - bal) / peak);
    cnt = nextCount(cnt, t.reason as never, t.netPnl);
    if (shouldHalt(cnt, p.BREAKER_N)) (trips++, (cnt = 0));
  }
  return { n: xs.length, win: xs.length ? w / xs.length : 0, perEth: e, ddEth, sumR, avgR: xs.length ? sumR / xs.length : 0, end: bal, ddPct, skipped, trips };
}

const results = variants.map((v) => {
  const tr = run(v);
  const s = Object.fromEntries((Object.keys(SEG) as SegName[]).map((k) => [k, stats(tr, v.p, k)])) as Record<SegName, Stats>;
  return { v, tr, s };
});
const control = results.find((r) => r.v.control)!;
// Shortlist: beats the control on BOTH end balance and max drawdown % in CHOOSE and in CHECK.
const beats = (s: Stats, cs: Stats) => s.end > cs.end && s.ddPct < cs.ddPct;
const shortlist = results.filter((r) => !r.v.control && beats(r.s.CHOOSE, control.s.CHOOSE) && beats(r.s.CHECK, control.s.CHECK));

const head = '| Variant | Trades | Win % | Net $/ETH | Max DD $/ETH | Sum R | Avg R | Account from $107 | Worst fall | Breaker trips |';
const sep = '|---|---|---|---|---|---|---|---|---|---|';
const row = (name: string, s: Stats) =>
  `| ${name} | ${s.n}${s.skipped ? ` (${s.skipped} too small)` : ''} | ${Math.round(s.win * 100)}% | ${s.perEth.toFixed(0)} | ${s.ddEth.toFixed(0)} | ${s.sumR.toFixed(1)} | ${s.avgR.toFixed(2)} | $${s.end.toFixed(0)} | ${(s.ddPct * 100).toFixed(0)}% | ${s.trips} |`;
const segLine = (k: SegName) => `${iso(SEG[k][0])} to ${iso(SEG[k][1] - 1)}`;

const out = [
  '# Capital-first exit rule: backtest',
  '',
  `ETHUSD 1h, ${segLine('FULL')}. The design is in design_draft.md (approved 2026-11-19).`,
  '',
  '**Rule tested:** the initial stop is R = max($10, 2×ATR), with the trade skipped when R > $40. The stop does not move until an hourly close is at least +1R. From then on it is the tighter of break-even plus fees and the highest high since entry minus k×ATR (mirrored for shorts). The opposite signal also exits. No take-profit.',
  '',
  '**Control:** Hull with the exits live today: break-even at 1R, then a 3×ATR trail from 1.5R.',
  '',
  `**All variants:** no weekend entries, MIN_ATR 15, fees of 0.059% per side and one tick of slippage each way. The account starts at $${START} and risks ${RISK * 100}% per trade (fees included), with live caps: 20x margin and at most 100 contracts (1 ETH). Each segment's account starts fresh at $${START}. "Breaker trips" counts how often three initial stops in a row would have fired the breaker, assuming an immediate resume.`,
  '',
  `**Segments, by entry time:** CHOOSE ${segLine('CHOOSE')}, CHECK ${segLine('CHECK')}, HOLDOUT ${segLine('HOLDOUT')}.`,
  '',
  '## CHOOSE (first 50%)', '', head, sep, ...results.map((r) => row(r.v.name, r.s.CHOOSE)),
  '', '## CHECK (next 20%)', '', head, sep, ...results.map((r) => row(r.v.name, r.s.CHECK)),
  '',
  `## Shortlist: variants that beat the control on both end balance and worst fall, in CHOOSE and in CHECK`,
  '',
  shortlist.length ? shortlist.map((r) => `* ${r.v.name}`).join('\n') : '**None.** No variant beat the control on both measures in both segments.',
  '', '## HOLDOUT (last 30%, the control and the shortlist only)', '', head, sep,
  ...[control, ...shortlist].map((r) => row(r.v.name, r.s.HOLDOUT)),
  '',
];
const passed = shortlist.filter((r) => beats(r.s.HOLDOUT, control.s.HOLDOUT) && r.s.HOLDOUT.n >= MIN_HOLDOUT_TRADES);
out.push(
  `**Acceptance** means beating the control on HOLDOUT on both end balance and worst fall, with at least ${MIN_HOLDOUT_TRADES} trades. ` +
    (passed.length ? `Passed: ${passed.map((r) => r.v.name).join('; ')}.` : 'Nothing passed.'),
  '', '## Full period (for reference only; not used to choose)', '', head, sep, ...results.map((r) => row(r.v.name, r.s.FULL)),
  '', '## How trades end (full period)', '', '| Variant | Initial stop | Break-even stop | Trail stop | Opposite signal |', '|---|---|---|---|---|',
  ...results.map((r) => {
    const k = (f: (x: string) => boolean) => `${Math.round((r.tr.filter((t) => f(t.reason)).length / r.tr.length) * 100)}%`;
    return `| ${r.v.name} | ${k((x) => x === 'sl_stage_0')} | ${k((x) => x === 'sl_stage_1')} | ${k((x) => x === 'sl_stage_2')} | ${k((x) => x === 'reversal')} |`;
  }),
);

writeFileSync('docs/capital-first.md', out.join('\n') + '\n');
console.log(out.join('\n'));
