import ConfirmButton from '../components/ConfirmButton';
import { usePolling } from '../usePolling';
import { Unauthorized } from '../api';

// NIFTY / BANKNIFTY options bot (separate process on 127.0.0.1:3001, reached through Caddy at /api/nifty/*).

type ExitView =
  | { mode: 'candle'; stage: 'INITIAL' | 'COST'; stop: number; emergency: number; costTrigger: number; gate: number; pending: string | null }
  | { mode: 'tight'; stage: string; stop: number; target: number }
  | { mode: 'legacy'; stop: number; target: number; optStop?: number | null; optCostAt?: number | null; optCostDone?: boolean; optTarget?: number | null; haMin?: number | null; pending?: string | null };
interface Pos {
  symbol: string;
  side: 1 | -1;
  qty: number;
  entryPrice: number;
  spotIn: number;
  stopLevel: number;
  targetLevel: number;
  slTrigger: number;
  ltp: number | null;
  unrealised: number | null;
  exiting: { reason: string } | null;
  exitView?: ExitView;
}
interface DryRun {
  tag: string;
  symbol: string;
  entryPrice: number;
  closedPrice: number;
  closedNet: number;
  ltp: number | null;
  ifHeldNow: number | null;
}
interface Idx {
  name: 'NIFTY' | 'BANKNIFTY';
  enabled: boolean;
  lots: number;
  lotSize: number | null;
  lossFloor: number;
  spot: number | null;
  paused: boolean;
  halted: string | null;
  doneToday: boolean;
  tradesToday?: number;
  netToday: number;
  netSinceResume: number;
  lastSignal: string | null;
  entering: { symbol: string } | null;
  position: Pos | null;
  dryRuns?: DryRun[];
}
interface WhatIf {
  exitTime: number;
  exitPrice: number;
  reason: string;
  net: number;
  diff: number;
}
interface Trade {
  index: string;
  day: string;
  symbol: string;
  side: 1 | -1;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  exitTime: number;
  reason: string;
  charges: number;
  net: number;
  whatIf?: WhatIf | null;
}
interface St {
  live: boolean;
  killed: boolean;
  lastTickAt: number;
  lastError: string | null;
  indices: Idx[];
  strategy: { rangeMin: number; trendFilter: boolean; stopK: number; rr: number; itm: number; entryWindow: string; timeExit: string; exitMode?: 'legacy' | 'tight' | 'candle'; exitPreset?: string | null; maxTradesPerDay?: number; optStopPct?: number; optCostAtPct?: number; optTpPct?: number; haExitMinPct?: number };
  trades: Trade[];
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Accept: 'application/json' } : { Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new Unauthorized();
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
  return j as T;
}
const control = (action: string, index?: string) => call('/api/nifty/control', { action, index });
const inr = (x: number | null | undefined) => (x == null ? '—' : `${x < 0 ? '−' : ''}₹${Math.abs(Math.round(x)).toLocaleString('en-IN')}`);
const cls = (x: number) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');

function exitRules(s: St['strategy']): string {
  if (s.exitMode === 'candle') return 'exits: 8% stop on a 5-min option close · cost at +10% · profit on a red Heikin Ashi candle ≥ +5% · 15% emergency · index stop';
  if (s.exitMode === 'tight') return `exits: ${s.exitPreset ?? 'tight'} (₹ cap → cost → trail)`;
  const pc = (x?: number) => `${Math.round((x ?? 0) * 100)}%`;
  const extra = [
    s.optStopPct ? `option stop −${pc(s.optStopPct)}${s.optCostAtPct ? ` (to cost at +${pc(s.optCostAtPct)})` : ''}` : '',
    s.optTpPct ? `take profit +${pc(s.optTpPct)}` : '',
    s.haExitMinPct ? `red Heikin Ashi 5-min candle ≥ +${pc(s.haExitMinPct)}` : '',
  ].filter(Boolean);
  return `stop ${s.stopK}× range · target ${s.rr}R${extra.length ? ` · ${extra.join(' · ')}` : ''}`;
}

function ExitLevels({ p }: { p: Pos }) {
  const v = p.exitView;
  if (v?.mode === 'candle')
    return (
      <>
        <dt>Option stop</dt>
        <dd>
          {v.stop} {v.stage === 'COST' ? '(at cost)' : '(on a 5-min close)'}
          {v.pending && <span className="neg"> · exiting: {v.pending}</span>}
        </dd>
        <dt>Emergency</dt>
        <dd>{v.emergency} (any price)</dd>
        <dt>To cost at</dt>
        <dd>{v.stage === 'COST' ? 'done' : v.costTrigger}</dd>
        <dt>Profit level</dt>
        <dd>{v.gate} (red Heikin Ashi candle)</dd>
        <dt>Index stop</dt>
        <dd>
          {p.stopLevel} (entered at {p.spotIn})
        </dd>
      </>
    );
  return (
    <>
      <dt>Index stop / target</dt>
      <dd>
        {p.stopLevel} / {p.targetLevel} (entered at {p.spotIn})
      </dd>
      {v?.mode === 'legacy' && v.optStop != null && (
        <>
          <dt>Option stop</dt>
          <dd>
            {v.optStop} {v.optCostDone ? '(at cost)' : v.optCostAt != null ? `(to cost at ${v.optCostAt})` : ''}
          </dd>
        </>
      )}
      {v?.mode === 'legacy' && v.optTarget != null && (
        <>
          <dt>Take profit</dt>
          <dd>{v.optTarget}</dd>
        </>
      )}
      {v?.mode === 'legacy' && v.haMin != null && (
        <>
          <dt>Red HA exit</dt>
          <dd>
            5-min close ≥ {v.haMin}
            {v.pending && <span className="neg"> · exiting: {v.pending}</span>}
          </dd>
        </>
      )}
    </>
  );
}

export default function Options() {
  const { data: s, error, reload } = usePolling(() => call<St>('/api/nifty/status'), 5000);
  if (!s) return <div className="card">{error ? `Options bot unreachable: ${error}` : 'Loading…'}</div>;
  const stale = Date.now() / 1000 - s.lastTickAt > 30;
  const act = (a: string, i?: string) => async () => {
    await control(a, i);
    await reload();
  };
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const todayNet = s.trades.filter((t) => t.day === today).reduce((a, t) => a + t.net, 0);
  const allNet = s.trades.reduce((a, t) => a + t.net, 0);
  const maxPerDay = s.strategy.maxTradesPerDay ?? 1;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Options · NIFTY &amp; BANKNIFTY</h1>
          <p className="muted small">
            <span className={`mode-badge ${s.live ? 'live' : 'paper'}`}>{s.live ? 'LIVE' : 'PAPER'}</span> Angel One · last update {Math.round(Date.now() / 1000 - s.lastTickAt)}s ago
            {stale && <strong className="neg"> · bot not responding</strong>}
            {s.lastError && <span className="neg"> · {s.lastError}</span>}
          </p>
        </div>
        <div className="controls">
          {s.killed ? <ConfirmButton label="Clear kill switch" onConfirm={act('unkill')} /> : <ConfirmButton label="KILL: close all & stop" danger onConfirm={act('kill')} />}
        </div>
      </div>

      {s.killed && <div className="card neg">Kill switch is ON: open trades are being closed and no new entries are taken.</div>}

      <div className="kpis">
        <div className="kpi">
          <div className="label">Today</div>
          <div className={`value ${cls(todayNet)}`}>{inr(todayNet)}</div>
        </div>
        <div className="kpi">
          <div className="label">All time ({s.trades.length} trades)</div>
          <div className={`value ${cls(allNet)}`}>{inr(allNet)}</div>
        </div>
        <div className="kpi">
          <div className="label">Win rate</div>
          <div className="value">{s.trades.length ? `${Math.round((s.trades.filter((t) => t.net > 0).length / s.trades.length) * 100)}%` : '—'}</div>
        </div>
        <div className="kpi kpi-wide">
          <div className="label">Strategy</div>
          <div className="sub small">
            {s.strategy.rangeMin}-min opening-range breakout{s.strategy.trendFilter ? ' + 15m trend' : ''} · ITM{s.strategy.itm} · {exitRules(s.strategy)} · entries {s.strategy.entryWindow}
            {maxPerDay > 1 ? ` (up to ${maxPerDay} a day)` : ''} · exit {s.strategy.timeExit}
          </div>
        </div>
      </div>

      <div className="row">
        {s.indices.map((i) => (
          <div className="card" key={i.name}>
            <div className="card-head">
              <h2>
                {i.name} <span className="muted small">{i.spot ?? '—'}</span>
              </h2>
              <span className={`pill ${i.halted ? 'neg' : i.paused ? '' : 'pos'}`}>
                {!i.enabled ? 'disabled' : i.halted ? 'HALTED' : i.paused ? 'paused' : i.position ? 'in trade' : (maxPerDay > 1 ? (i.tradesToday ?? 0) >= maxPerDay : i.doneToday) ? 'done for today' : 'waiting for breakout'}
              </span>
            </div>
            {i.halted && <p className="neg small">{i.halted}</p>}
            <p className="small muted">
              {i.lots} lot × {i.lotSize ?? '?'} · today {inr(i.netToday)} · since resume {inr(i.netSinceResume)} (halts at −{inr(i.lossFloor)})
              {maxPerDay > 1 && <> · trades today {i.tradesToday ?? 0}/{maxPerDay}</>}
              {i.lastSignal && <> · last signal {i.lastSignal}</>}
            </p>
            {i.entering && <p className="small">Entry order working: {i.entering.symbol}</p>}
            {i.position && (
              <dl className="grid2 kv">
                <dt>Option</dt>
                <dd>
                  <strong>{i.position.symbol}</strong> × {i.position.qty}
                </dd>
                <dt>Entry → now</dt>
                <dd>
                  {i.position.entryPrice} → {i.position.ltp ?? '—'} <span className={cls(i.position.unrealised ?? 0)}>{inr(i.position.unrealised)}</span>
                </dd>
                <ExitLevels p={i.position} />
                <dt>Exchange backup</dt>
                <dd>{i.position.slTrigger}</dd>
                {i.position.exiting && (
                  <>
                    <dt>Exiting</dt>
                    <dd>{i.position.exiting.reason}</dd>
                  </>
                )}
              </dl>
            )}
            {(i.dryRuns ?? []).map((d) => (
              <div className="dry-run small" key={d.tag}>
                <strong>Dry run</strong> (closed by hand, the bot's own exit rules, no orders): {d.symbol} closed at {d.closedPrice} ({inr(d.closedNet)}) · now {d.ltp ?? '—'}
                {d.ifHeldNow != null && (
                  <>
                    {' '}
                    · if still held <span className={cls(d.ifHeldNow)}>{inr(d.ifHeldNow)}</span>
                  </>
                )}
              </div>
            ))}
            <div className="controls">
              {i.position && !i.position.exiting && <ConfirmButton label="Exit now" danger onConfirm={act('exit', i.name)} />}
              {i.halted || i.paused ? <ConfirmButton label="Resume" onConfirm={act('resume', i.name)} /> : <ConfirmButton label="Pause entries" onConfirm={act('pause', i.name)} />}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Trades</h2>
        </div>
        {s.trades.length === 0 ? (
          <p className="muted small">No trades yet.</p>
        ) : (
          <div className="scroll">
            <table className="stack">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Index</th>
                  <th>Option</th>
                  <th>Qty</th>
                  <th>Entry → exit</th>
                  <th>Reason</th>
                  <th>Charges</th>
                  <th>Net</th>
                  <th>Bot would exit</th>
                  <th>If held</th>
                </tr>
              </thead>
              <tbody>
                {s.trades.map((t) => (
                  <tr key={`${t.symbol}${t.exitTime}`}>
                    <td data-label="Day">{t.day}</td>
                    <td data-label="Index">{t.index}</td>
                    <td data-label="Option">{t.symbol}</td>
                    <td data-label="Qty">{t.qty}</td>
                    <td data-label="Entry → exit">
                      {t.entryPrice} → {t.exitPrice}
                    </td>
                    <td data-label="Reason">{t.reason}</td>
                    <td data-label="Charges">{inr(t.charges)}</td>
                    <td data-label="Net" className={cls(t.net)}>
                      {inr(t.net)}
                    </td>
                    <td data-label="Bot would exit">
                      {t.whatIf ? (
                        <>
                          {new Date((t.whatIf.exitTime + 19800) * 1000).toISOString().slice(11, 16)} at {t.whatIf.exitPrice} ({t.whatIf.reason})
                        </>
                      ) : (
                        <span className="muted">{/manual|outside/.test(t.reason) ? (t.day === today ? 'still watching…' : 'not tracked') : '—'}</span>
                      )}
                    </td>
                    <td data-label="If held">
                      {t.whatIf ? (
                        <>
                          {inr(t.whatIf.net)}{' '}
                          <span className={cls(t.whatIf.diff)}>
                            ({t.whatIf.diff >= 0 ? `${inr(t.whatIf.diff)} more` : `${inr(-t.whatIf.diff)} less`})
                          </span>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
