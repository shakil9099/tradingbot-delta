import { api, fmtNum, fmtTime, fmtUsd, pnlClass } from '../api';
import ConfirmButton from '../components/ConfirmButton';
import EquityChart from '../components/EquityChart';
import HaltBanner from '../components/HaltBanner';
import PositionCard from '../components/PositionCard';
import { usePolling } from '../usePolling';

/** "in 23 min" / "in 1 h 5 min" from a unix time. */
function until(t: number | null): string {
  if (!t) return '';
  const m = Math.max(0, Math.round((t * 1000 - Date.now()) / 60000));
  return m >= 60 ? `in ${Math.floor(m / 60)} h ${m % 60} min` : `in ${m} min`;
}

export default function Overview() {
  const st = usePolling(api.status, 15000);
  const stats = usePolling(api.stats, 60000);
  const s = st.data;
  if (!s) return <p className="muted">{st.error ?? 'Loading…'}</p>;
  const t = stats.data?.total;
  const fixed = s.strategyMode !== 'adaptive';
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted small">Updated {fmtTime(s.snapshotAt)}</p>
        </div>
      </div>
      <HaltBanner s={s} />

      <div className="kpis">
        <div className="kpi">
          <div className="label">Balance</div>
          <div className="value">{fmtUsd(s.balance)}</div>
          <div className="sub">{s.risk.peak !== null ? `Peak ${fmtUsd(s.risk.peak)}` : ' '}</div>
        </div>
        <div className="kpi">
          <div className="label">Open position</div>
          <div className={`value ${pnlClass(s.unrealizedPnl)}`}>{s.position ? fmtUsd(s.unrealizedPnl) : 'Flat'}</div>
          <div className="sub">{s.position ? `${s.position.side === 'buy' ? 'Long' : 'Short'} from ${fmtNum(s.position.entryPrice)}` : 'No trade open'}</div>
        </div>
        <div className="kpi">
          <div className="label">Net P&amp;L (after fees)</div>
          <div className={`value ${pnlClass(t?.netPnl)}`}>{t ? fmtUsd(t.netPnl) : '—'}</div>
          <div className="sub">{t ? `${t.count} trades · ${(t.winRate * 100).toFixed(0)}% won` : ' '}</div>
        </div>
        <div className="kpi">
          <div className="label">Next candle check</div>
          <div className="value">{s.nextCycleAt ? until(s.nextCycleAt) : '—'}</div>
          <div className="sub">{fmtTime(s.nextCycleAt)}</div>
        </div>
      </div>

      <div className="row">
        <PositionCard s={s} />
        <section className="card">
          <div className="card-head">
            <h2>Strategy</h2>
            <span className="chip accent">{s.active.toUpperCase()}{fixed ? ' only' : ''}</span>
          </div>
          <dl className="grid2">
            <dt>Mode</dt>
            <dd>
              {fixed ? `${s.strategyMode} (fixed)` : 'adaptive'}
              {s.dryRun && <span className="pill">DRY RUN</span>}
            </dd>
            {!fixed && (
              <>
                <dt>Active</dt>
                <dd>
                  <strong>{s.active.toUpperCase()}</strong>
                  {s.pending && <small className="muted"> (pending {s.pending.toUpperCase()})</small>}
                </dd>
                <dt>Scores (last 10 sim)</dt>
                <dd>
                  hull <span className={pnlClass(s.scores.hull)}>{fmtNum(s.scores.hull)}</span> · ut <span className={pnlClass(s.scores.ut)}>{fmtNum(s.scores.ut)}</span>
                </dd>
                <dt>Last switch</dt>
                <dd>{s.lastSwitchReason ?? '—'}</dd>
              </>
            )}
            <dt>Risk per trade</dt>
            <dd>
              {s.risk.current === null ? '—' : `${(s.risk.current * 100).toFixed(0)}%`}
              {s.risk.drawdown !== null && s.risk.drawdown > s.risk.reduceBelowPeak ? (
                <span className="muted"> (reduced: {(s.risk.drawdown * 100).toFixed(0)}% below peak)</span>
              ) : null}
            </dd>
            <dt>Low-volatility skip</dt>
            <dd>{s.minAtr > 0 ? `no entries when ATR(14) < $${s.minAtr}` : 'off'}</dd>
            <dt>High-volatility gate</dt>
            <dd>{s.atrGateMax > 0 ? `no entries when ATR(14) > $${s.atrGateMax}` : 'off'}</dd>
            <dt>Weekend entries</dt>
            <dd>{s.skipWeekendEntries ? 'off on Sat/Sun IST (open trades still managed)' : 'allowed'}</dd>
            <dt>Stop-losses in a row</dt>
            <dd>{s.consecutiveSl} / 3</dd>
          </dl>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Equity (net, after fees)</h2>
          {stats.data && (
            <span className="small muted">
              fees {fmtUsd(stats.data.feesPaid)} · max drawdown {fmtUsd(stats.data.maxDrawdown)}
            </span>
          )}
        </div>
        <EquityChart points={stats.data?.equity ?? []} />
      </section>

      <section className="card">
        <h2>Controls</h2>
        <div className="controls">
          {s.halted ? (
            <ConfirmButton label="Resume" onConfirm={async () => { await api.resume(); await st.reload(); }} />
          ) : (
            <ConfirmButton label="Pause" onConfirm={async () => { await api.pause(); await st.reload(); }} />
          )}
          <ConfirmButton label="Close position" danger onConfirm={async () => { await api.close(); await st.reload(); }} />
        </div>
        <p className="muted small">
          Each button needs a second click within 5 seconds. Pause stops new entries; an open position keeps its exchange stop and is still trailed. Close does not pause.
        </p>
      </section>
    </>
  );
}
