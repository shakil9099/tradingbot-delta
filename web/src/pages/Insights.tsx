import type { StrategyStats } from '@shared/types';
import { api, fmtNum, fmtUsd, pnlClass } from '../api';
import { usePolling } from '../usePolling';

function Row({ name, s }: { name: string; s: StrategyStats }) {
  return (
    <tr>
      <td>{name}</td>
      <td>{s.count}</td>
      <td>{(s.winRate * 100).toFixed(0)}%</td>
      <td className={pnlClass(s.netPnl)}>{fmtUsd(s.netPnl)}</td>
      <td>{fmtUsd(s.avgWin)}</td>
      <td>{fmtUsd(s.avgLoss)}</td>
      <td>{s.profitFactor === null ? '—' : fmtNum(s.profitFactor)}</td>
    </tr>
  );
}

export default function Insights() {
  const ins = usePolling(api.insights, 120000);
  const st = usePolling(api.stats, 120000);
  return (
    <>
      <section className="card">
        <h2>What can be improved</h2>
        <p className="muted small">Rule-based checks over the live trade log (need ≥10 closed trades).</p>
        <div className="insights">
          {(ins.data?.insights ?? []).map((i) => (
            <div key={i.id} className={`insight ${i.severity}`}>
              <small className="muted">{i.id.replace(/_/g, ' ')}</small>
              <p>{i.message}</p>
            </div>
          ))}
        </div>
      </section>
      {st.data && (
        <section className="card">
          <h2>By strategy</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Trades</th>
                  <th>Win rate</th>
                  <th>Net</th>
                  <th>Avg win</th>
                  <th>Avg loss</th>
                  <th>Profit factor</th>
                </tr>
              </thead>
              <tbody>
                <Row name="All" s={st.data.total} />
                <Row name="Hull" s={st.data.byStrategy.hull} />
                <Row name="UT Bot" s={st.data.byStrategy.ut} />
                {st.data.byStrategy.unknown.count > 0 && <Row name="Adopted" s={st.data.byStrategy.unknown} />}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Fees paid {fmtUsd(st.data.feesPaid)} · max drawdown {fmtUsd(st.data.maxDrawdown)}
          </p>
        </section>
      )}
    </>
  );
}
