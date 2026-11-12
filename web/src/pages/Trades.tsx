import { useState } from 'react';
import { api, fmtNum, fmtTime, fmtUsd, pnlClass } from '../api';
import TradeDrawer from '../components/TradeDrawer';
import { usePolling } from '../usePolling';

const PAGE = 50;

export default function Trades() {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error } = usePolling(() => api.trades(PAGE, page * PAGE), 30000, [page]);
  if (!data) return <p className="muted">{error ?? 'Loading…'}</p>;
  return (
    <>
    <div className="page-head">
      <div>
        <h1>Trades</h1>
        <p className="muted small">{data.total} trades · click a row for the full story</p>
      </div>
    </div>
    <section className="card">
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Opened</th>
              <th>Side</th>
              <th>Strategy</th>
              <th className="num">Entry</th>
              <th className="num">Exit</th>
              <th>Reason</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {data.trades.map((t) => (
              <tr key={t.id} onClick={() => setOpen(t.id)} className="clickable">
                <td>{t.id}{t.dry_run ? ' 🧪' : ''}</td>
                <td>{fmtTime(t.entry_time)}</td>
                <td><span className={`chip ${t.side === 'buy' ? 'long' : 'short'}`}>{t.side === 'buy' ? 'LONG' : 'SHORT'}</span></td>
                <td>{t.strategy}</td>
                <td className="num">{fmtNum(t.entry_price)}</td>
                <td className="num">{fmtNum(t.exit_price)}</td>
                <td className="muted">{(t.exit_reason ?? t.status).replace(/_/g, ' ')}</td>
                <td className={`num ${pnlClass(t.net_pnl)}`}>
                  <strong>{fmtUsd(t.net_pnl)}</strong>
                </td>
              </tr>
            ))}
            {!data.trades.length && (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>No trades yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</button>
        <button disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>Older →</button>
        <span className="muted small">page {page + 1} of {Math.max(1, Math.ceil(data.total / PAGE))}</span>
      </div>
      {open !== null && <TradeDrawer id={open} onClose={() => setOpen(null)} />}
    </section>
    </>
  );
}
