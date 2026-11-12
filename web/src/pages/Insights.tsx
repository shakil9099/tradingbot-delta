import type { StrategyStats } from '@shared/types';
import { api, fmtNum, fmtUsd, pnlClass } from '../api';
import { usePolling } from '../usePolling';

function Row({ name, s }: { name: string; s: StrategyStats }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="num">{s.count}</td>
      <td className="num">{(s.winRate * 100).toFixed(0)}%</td>
      <td className={`num ${pnlClass(s.netPnl)}`}>{fmtUsd(s.netPnl)}</td>
      <td className="num">{fmtUsd(s.avgWin)}</td>
      <td className="num">{fmtUsd(s.avgLoss)}</td>
      <td className="num">{s.profitFactor === null ? '—' : fmtNum(s.profitFactor)}</td>
    </tr>
  );
}

export default function Insights() {
  const ins = usePolling(api.insights, 120000);
  const st = usePolling(api.stats, 120000);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p className="muted small">Rule-based checks over the live trade log (need at least 10 closed trades).</p>
        </div>
      </div>
      <section className="card">
        <h2>What can be improved</h2>
        <div className="insights">
          {ins.data && !ins.data.insights.length && <div className="empty small">No suggestions yet.</div>}
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
                  <th className="num">Trades</th>
                  <th className="num">Win rate</th>
                  <th className="num">Net</th>
                  <th className="num">Avg win</th>
                  <th className="num">Avg loss</th>
                  <th className="num">Profit factor</th>
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
