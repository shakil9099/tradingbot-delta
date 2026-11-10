import { api, fmtNum, fmtTime } from '../api';
import { usePolling } from '../usePolling';

export default function Decisions() {
  const { data, error } = usePolling(() => api.decisions(200), 60000);
  const ev = usePolling(() => api.events(30), 60000);
  if (!data) return <p className="muted">{error ?? 'Loading…'}</p>;
  return (
    <>
      <section className="card">
        <h2>Per-candle decisions</h2>
        <p className="muted small">One row per closed 1h candle: what each strategy said and what the bot did.</p>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Candle</th>
                <th>Close</th>
                <th>Hull</th>
                <th>UT stop</th>
                <th>ATR</th>
                <th>Hull sig</th>
                <th>UT sig</th>
                <th>Active</th>
                <th>Action</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.map((d) => (
                <tr key={d.candle_time}>
                  <td>{fmtTime(d.candle_time)}</td>
                  <td>{fmtNum(d.close)}</td>
                  <td>{fmtNum(d.hull)}</td>
                  <td>{fmtNum(d.ut_stop)}</td>
                  <td>{fmtNum(d.atr)}</td>
                  <td>{d.sig_hull === 'NONE' ? '' : d.sig_hull}</td>
                  <td>{d.sig_ut === 'NONE' ? '' : d.sig_ut}</td>
                  <td>{d.active}</td>
                  <td>
                    <strong>{d.action}</strong>
                  </td>
                  <td className="small">{d.note}</td>
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
              <small className="muted">{fmtTime(e.time)}</small> <strong>{e.type}</strong> <span className="small">{e.data}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
