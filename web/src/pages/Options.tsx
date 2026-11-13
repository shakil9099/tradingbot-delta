import ConfirmButton from '../components/ConfirmButton';
import { usePolling } from '../usePolling';
import { Unauthorized } from '../api';

// NIFTY / BANKNIFTY options bot (separate process on 127.0.0.1:3001, reached through Caddy at /api/nifty/*).

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
  netToday: number;
  netSinceResume: number;
  lastSignal: string | null;
  entering: { symbol: string } | null;
  position: Pos | null;
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
}
interface St {
  live: boolean;
  killed: boolean;
  lastTickAt: number;
  lastError: string | null;
  indices: Idx[];
  strategy: { rangeMin: number; trendFilter: boolean; stopK: number; rr: number; itm: number; entryWindow: string; timeExit: string };
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
const inr = (x: number | null | undefined) => (x == null ? '—' : `₹${Math.round(x).toLocaleString('en-IN')}`);
const cls = (x: number) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');

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
        <div className="kpi">
          <div className="label">Strategy</div>
          <div className="sub small">
            {s.strategy.rangeMin}-min opening-range breakout{s.strategy.trendFilter ? ' + 15m trend' : ''} · ITM{s.strategy.itm} · stop {s.strategy.stopK}× range · target {s.strategy.rr}R · entries {s.strategy.entryWindow} · exit {s.strategy.timeExit}
          </div>
        </div>
      </div>

      <div className="grid2">
        {s.indices.map((i) => (
          <div className="card" key={i.name}>
            <div className="card-head">
              <h2>
                {i.name} <span className="muted small">{i.spot ?? '—'}</span>
              </h2>
              <span className={`pill ${i.halted ? 'neg' : i.paused ? '' : 'pos'}`}>{!i.enabled ? 'disabled' : i.halted ? 'HALTED' : i.paused ? 'paused' : i.position ? 'in trade' : i.doneToday ? 'done for today' : 'waiting for breakout'}</span>
            </div>
            {i.halted && <p className="neg small">{i.halted}</p>}
            <p className="small muted">
              {i.lots} lot × {i.lotSize ?? '?'} · today {inr(i.netToday)} · since resume {inr(i.netSinceResume)} (halts at −{inr(i.lossFloor)})
              {i.lastSignal && <> · last signal {i.lastSignal}</>}
            </p>
            {i.entering && <p className="small">Entry order working: {i.entering.symbol}</p>}
            {i.position ? (
              <table>
                <tbody>
                  <tr>
                    <td>Option</td>
                    <td>
                      <strong>{i.position.symbol}</strong> × {i.position.qty}
                    </td>
                  </tr>
                  <tr>
                    <td>Entry → now</td>
                    <td>
                      {i.position.entryPrice} → {i.position.ltp ?? '—'} <span className={cls(i.position.unrealised ?? 0)}>{inr(i.position.unrealised)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td>Index stop / target</td>
                    <td>
                      {i.position.stopLevel} / {i.position.targetLevel} (entered at {i.position.spotIn})
                    </td>
                  </tr>
                  <tr>
                    <td>Exchange safety stop</td>
                    <td>{i.position.slTrigger}</td>
                  </tr>
                  {i.position.exiting && (
                    <tr>
                      <td>Exiting</td>
                      <td>{i.position.exiting.reason}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : null}
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
          <table>
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
              </tr>
            </thead>
            <tbody>
              {s.trades.map((t) => (
                <tr key={`${t.symbol}${t.exitTime}`}>
                  <td>{t.day}</td>
                  <td>{t.index}</td>
                  <td>{t.symbol}</td>
                  <td>{t.qty}</td>
                  <td>
                    {t.entryPrice} → {t.exitPrice}
                  </td>
                  <td>{t.reason}</td>
                  <td>{inr(t.charges)}</td>
                  <td className={cls(t.net)}>{inr(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
