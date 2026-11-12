import { fmtNum, fmtUsd, pnlClass, type Status } from '../api';

const STAGES = ['Initial stop', 'Break-even', 'Trailing'];

export default function PositionCard({ s }: { s: Status }) {
  const p = s.position;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Position</h2>
        {p && <span className={`chip ${p.side === 'buy' ? 'long' : 'short'}`}>{p.side === 'buy' ? 'LONG' : 'SHORT'}</span>}
      </div>
      {!p ? (
        <div className="empty">
          <strong>No open position</strong>
          <span className="small">Waiting for the next signal. Balance {fmtUsd(s.balance)}.</span>
        </div>
      ) : (
        <>
          <div className="position-head">
            <span className={`big ${pnlClass(s.unrealizedPnl)}`}>{fmtUsd(s.unrealizedPnl)}</span>
            <span className="muted small">unrealized</span>
          </div>
          {s.stage !== null && (
            <div className="stepper" aria-label={`Stop stage: ${STAGES[s.stage]}`}>
              {STAGES.map((name, i) => (
                <span key={name} className={`step ${i < (s.stage ?? 0) ? 'done' : i === s.stage ? 'now' : ''}`}>
                  {name}
                </span>
              ))}
            </div>
          )}
          <dl className="grid2">
            <dt>Size</dt>
            <dd>
              {p.sizeContracts} ct ({fmtNum(p.sizeContracts * 0.01, 2)} ETH)
            </dd>
            <dt>Entry</dt>
            <dd>{fmtNum(p.entryPrice)}</dd>
            <dt>Stop-loss</dt>
            <dd>{fmtNum(s.slPrice)}</dd>
            <dt>Take-profit</dt>
            <dd>{s.tpPrice === null ? <span className="muted">none (trailing stop)</span> : fmtNum(s.tpPrice)}</dd>
            <dt>Balance</dt>
            <dd>{fmtUsd(s.balance)}</dd>
          </dl>
        </>
      )}
    </section>
  );
}
