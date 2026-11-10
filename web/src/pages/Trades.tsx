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
    <section className="card">
      <h2>Trades ({data.total})</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Opened</th>
              <th>Side</th>
              <th>Strategy</th>
              <th>Entry</th>
              <th>Exit</th>
              <th>Reason</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {data.trades.map((t) => (
              <tr key={t.id} onClick={() => setOpen(t.id)} className="clickable">
                <td>{t.id}{t.dry_run ? ' 🧪' : ''}</td>
                <td>{fmtTime(t.entry_time)}</td>
                <td className={t.side === 'buy' ? 'pos' : 'neg'}>{t.side === 'buy' ? 'LONG' : 'SHORT'}</td>
                <td>{t.strategy}</td>
                <td>{fmtNum(t.entry_price)}</td>
                <td>{fmtNum(t.exit_price)}</td>
                <td>{t.exit_reason ?? t.status}</td>
                <td className={pnlClass(t.net_pnl)}>{fmtUsd(t.net_pnl)}</td>
              </tr>
            ))}
            {!data.trades.length && (
              <tr>
                <td colSpan={8} className="muted">No trades yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</button>
        <button disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>Older →</button>
      </div>
      {open !== null && <TradeDrawer id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
