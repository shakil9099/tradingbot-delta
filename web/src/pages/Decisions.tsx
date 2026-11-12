import { api, fmtNum, fmtTime } from '../api';
import { usePolling } from '../usePolling';

export default function Decisions() {
  const { data, error } = usePolling(() => api.decisions(200), 60000);
  const ev = usePolling(() => api.events(30), 60000);
  if (!data) return <p className="muted">{error ?? 'Loading…'}</p>;
  const sig = (v: string) => (v === 'NONE' ? <span className="muted">·</span> : <span className={`chip ${v === 'LONG' ? 'long' : 'short'}`}>{v}</span>);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Decisions</h1>
          <p className="muted small">One row per closed 1-hour candle: what each strategy said and what the bot did.</p>
        </div>
      </div>
      <section className="card">
        <h2>Per-candle decisions</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Candle</th>
                <th className="num">Close</th>
                <th className="num">Hull</th>
                <th className="num">UT stop</th>
                <th className="num">ATR</th>
                <th>Hull sig</th>
                <th>UT sig</th>
                <th>Active</th>
                <th>Action</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.map((d) => (
                <tr key={d.candle_time} className={d.action !== 'NONE' ? 'signal' : ''}>
                  <td>{fmtTime(d.candle_time)}</td>
                  <td className="num">{fmtNum(d.close)}</td>
                  <td className="num">{fmtNum(d.hull)}</td>
                  <td className="num">{fmtNum(d.ut_stop)}</td>
                  <td className="num">{fmtNum(d.atr)}</td>
                  <td>{sig(d.sig_hull)}</td>
                  <td>{sig(d.sig_ut)}</td>
                  <td>{d.active}</td>
                  <td>{d.action === 'NONE' ? <span className="muted">none</span> : <span className="chip accent">{d.action}</span>}</td>
                  <td className="small muted">{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <h2>System events</h2>
        <ul className="timeline">
          {(ev.data?.events ?? []).map((e) => (
            <li key={e.id}>
              <small className="muted">{fmtTime(e.time)}</small>
              <span>
                <strong>{e.type.replace(/_/g, ' ')}</strong> <span className="small muted">{e.data === '{}' ? '' : e.data}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
