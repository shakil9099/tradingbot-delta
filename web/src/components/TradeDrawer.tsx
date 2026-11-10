import { useEffect, useState } from 'react';
import type { TradeEvent, TradeRow } from '@shared/types';
import { api, fmtNum, fmtTime, fmtUsd, pnlClass } from '../api';

const exitText: Record<string, string> = {
  sl_stage_0: 'initial stop (2 × ATR) hit',
  sl_stage_1: 'break-even stop (entry + fees) hit',
  sl_stage_2: 'trailing stop hit',
  tp: 'take-profit reached',
  reversal: 'closed by an opposite signal',
  manual: 'closed manually',
  trail_breached: 'price passed the new stop before it was sent',
  margin_mode: 'closed: margin mode was cross',
  liquidation: 'liquidated',
  external: 'closed outside the bot',
};

export default function TradeDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const [d, setD] = useState<{ trade: TradeRow; events: TradeEvent[] } | null>(null);
  useEffect(() => {
    api.trade(id).then(setD).catch(() => setD(null));
  }, [id]);
  if (!d) return null;
  const t = d.trade;
  let reason: Record<string, unknown> = {};
  try {
    reason = JSON.parse(t.entry_reason);
  } catch {
    /* ignore */
  }
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <button className="link right" onClick={onClose}>
          Close ✕
        </button>
        <h2>
          Trade #{t.id} — {t.side === 'buy' ? 'LONG' : 'SHORT'} {t.size_contracts} ct
        </h2>
        <h3>Why it opened</h3>
        <p>
          {reason.adopted
            ? 'Adopted: a position found on the exchange that the bot had no record of.'
            : `${String(reason.strategy ?? t.strategy).toUpperCase()} — ${reason.signal === 'missed_flip' ? 'missed flip caught on the next candle' : 'signal flip'} on the ${fmtTime(Number(reason.candleTime))} candle.`}
        </p>
        {reason.scores ? <p className="muted">Scores at entry: hull {fmtNum((reason.scores as Record<string, number>).hull)}, ut {fmtNum((reason.scores as Record<string, number>).ut)}</p> : null}
        <dl className="grid2">
          <dt>Entry</dt>
          <dd>
            {fmtNum(t.entry_price)} at {fmtTime(t.entry_time)}
          </dd>
          <dt>Exit</dt>
          <dd>
            {fmtNum(t.exit_price)} at {fmtTime(t.exit_time)}
          </dd>
          <dt>Why it closed</dt>
          <dd>{t.exit_reason ? exitText[t.exit_reason] ?? t.exit_reason : t.status}</dd>
          <dt>Gross</dt>
          <dd className={pnlClass(t.gross_pnl)}>{fmtUsd(t.gross_pnl)}</dd>
          <dt>Fees</dt>
          <dd>{fmtUsd(t.fees)}</dd>
          <dt>Net</dt>
          <dd className={pnlClass(t.net_pnl)}>{fmtUsd(t.net_pnl)}</dd>
        </dl>
        <h3>Timeline</h3>
        <ul className="timeline">
          {d.events.map((e) => {
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(e.data);
            } catch {
              /* ignore */
            }
            return (
              <li key={e.id}>
                <small className="muted">{fmtTime(e.time)}</small>{' '}
                {e.type === 'sl_move'
                  ? `stop ${fmtNum(data.oldSl as number)} → ${fmtNum(data.newSl as number)} (stage ${data.stage})`
                  : e.type === 'bracket_attach'
                    ? `bracket SL ${fmtNum(data.sl as number)} / TP ${fmtNum(data.tp as number)}`
                    : `${e.type}: ${JSON.stringify(data)}`}
              </li>
            );
          })}
          {!d.events.length && <li className="muted">No events.</li>}
        </ul>
      </aside>
    </div>
  );
}
