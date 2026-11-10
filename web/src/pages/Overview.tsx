import { api, fmtNum, fmtTime, fmtUsd, pnlClass } from '../api';
import ConfirmButton from '../components/ConfirmButton';
import EquityChart from '../components/EquityChart';
import HaltBanner from '../components/HaltBanner';
import PositionCard from '../components/PositionCard';
import { usePolling } from '../usePolling';

export default function Overview() {
  const st = usePolling(api.status, 15000);
  const stats = usePolling(api.stats, 60000);
  const s = st.data;
  if (!s) return <p className="muted">{st.error ?? 'Loading…'}</p>;
  return (
    <>
      <HaltBanner s={s} />
      <div className="row">
        <PositionCard s={s} />
        <section className="card">
          <h2>Strategy</h2>
          <dl className="grid2">
            <dt>Mode</dt>
            <dd>
              {s.strategyMode}
              {s.dryRun && <span className="pill">DRY RUN</span>}
            </dd>
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
            <dt>Volatility gate</dt>
            <dd>{s.atrGateMax > 0 ? `on — no entries when ATR(14) > $${s.atrGateMax}` : 'off'}</dd>
            <dt>Risk per trade</dt>
            <dd>
              {s.risk.current === null ? "—" : `${(s.risk.current * 100).toFixed(0)}%`}
              {s.risk.drawdown !== null && s.risk.drawdown > s.risk.reduceBelowPeak ? ` (reduced: ${(s.risk.drawdown * 100).toFixed(0)}% below peak \$${s.risk.peak?.toFixed(2)})` : s.risk.peak !== null ? ` (peak \$${s.risk.peak.toFixed(2)})` : ""}
            </dd>
            <dt>Low-volatility skip</dt>
            <dd>{s.minAtr > 0 ? `no entries when ATR(14) < \$${s.minAtr}` : "off"}</dd>
            <dt>Weekend entries</dt>
            <dd>{s.skipWeekendEntries ? 'off on Sat/Sun IST (open trades still managed)' : 'allowed'}</dd>
            <dt>Stop-losses in a row</dt>
            <dd>{s.consecutiveSl} / 3</dd>
            <dt>Next candle check</dt>
            <dd>{fmtTime(s.nextCycleAt)}</dd>
          </dl>
        </section>
      </div>
      <section className="card">
        <h2>Equity (net, after fees)</h2>
        {stats.data && (
          <p>
            {stats.data.total.count} trades · win rate {(stats.data.total.winRate * 100).toFixed(0)}% · net{' '}
            <span className={pnlClass(stats.data.total.netPnl)}>{fmtUsd(stats.data.total.netPnl)}</span> · fees {fmtUsd(stats.data.feesPaid)} · max drawdown {fmtUsd(stats.data.maxDrawdown)}
          </p>
        )}
        <EquityChart points={stats.data?.equity ?? []} />
      </section>
      <section className="card">
        <h2>Controls</h2>
        <div className="controls">
          <ConfirmButton label="Close position" danger onConfirm={async () => { await api.close(); await st.reload(); }} />
          {s.halted ? (
            <ConfirmButton label="Resume" onConfirm={async () => { await api.resume(); await st.reload(); }} />
          ) : (
            <ConfirmButton label="Pause" onConfirm={async () => { await api.pause(); await st.reload(); }} />
          )}
        </div>
        <p className="muted small">Pause stops new entries; an open position keeps its exchange stop and is still trailed. Close does not pause.</p>
      </section>
    </>
  );
}
