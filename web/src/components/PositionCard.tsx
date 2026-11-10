import { fmtNum, fmtUsd, pnlClass, type Status } from '../api';

const stageName = ['initial stop', 'break-even', 'trailing'];

export default function PositionCard({ s }: { s: Status }) {
  const p = s.position;
  return (
    <section className="card">
      <h2>Position</h2>
      {!p ? (
        <p className="muted">Flat. Balance {fmtUsd(s.balance)}.</p>
      ) : (
        <dl className="grid2">
          <dt>Side</dt>
          <dd className={p.side === 'buy' ? 'pos' : 'neg'}>{p.side === 'buy' ? 'LONG' : 'SHORT'}</dd>
          <dt>Size</dt>
          <dd>
            {p.sizeContracts} ct ({fmtNum(p.sizeContracts * 0.01, 2)} ETH)
          </dd>
          <dt>Entry</dt>
          <dd>{fmtNum(p.entryPrice)}</dd>
          <dt>Stop-loss</dt>
          <dd>
            {fmtNum(s.slPrice)} {s.stage !== null && <small className="muted">stage {s.stage} · {stageName[s.stage]}</small>}
          </dd>
          <dt>Take-profit</dt>
          <dd>{fmtNum(s.tpPrice)}</dd>
          <dt>Unrealized</dt>
          <dd className={pnlClass(s.unrealizedPnl)}>{fmtUsd(s.unrealizedPnl)}</dd>
          <dt>Balance</dt>
          <dd>{fmtUsd(s.balance)}</dd>
        </dl>
      )}
    </section>
  );
}
