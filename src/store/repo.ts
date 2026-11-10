import type {
  DecisionRow,
  SimTrade,
  SystemEvent,
  SystemEventType,
  TradeEvent,
  TradeEventType,
  TradeRow,
} from '../shared/types.js';
import type { DB } from './db.js';

export const nowSec = () => Math.floor(Date.now() / 1000);

/** Typed queries over the bot database. */
export class Repo {
  constructor(readonly db: DB) {}

  // ---------- kv ----------
  kvGet(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string | null } | undefined;
    return r?.value ?? null;
  }
  kvSet(key: string, value: string | number | null): void {
    this.db
      .prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value === null ? null : String(value));
  }
  kvNum(key: string, def = 0): number {
    const v = this.kvGet(key);
    return v === null || v === '' ? def : Number(v);
  }
  kvJson<T>(key: string, def: T): T {
    const v = this.kvGet(key);
    if (v === null) return def;
    try {
      return JSON.parse(v) as T;
    } catch {
      return def;
    }
  }

  // ---------- trades ----------
  insertTrade(t: Partial<TradeRow> & Pick<TradeRow, 'client_order_id' | 'status' | 'side' | 'size_contracts' | 'strategy'>): number {
    const cols = Object.keys(t);
    const info = this.db
      .prepare(`INSERT INTO trades (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      .run(t as Record<string, unknown>);
    return Number(info.lastInsertRowid);
  }
  updateTrade(id: number, patch: Partial<TradeRow>): void {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    this.db.prepare(`UPDATE trades SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id`).run({ ...patch, __id: id } as Record<string, unknown>);
  }
  getTrade(id: number): TradeRow | null {
    return (this.db.prepare('SELECT * FROM trades WHERE id = ?').get(id) as TradeRow | undefined) ?? null;
  }
  /** Newest non-terminal trade (OPENING, OPEN or CLOSING). */
  openTrade(): TradeRow | null {
    return (
      (this.db.prepare("SELECT * FROM trades WHERE status IN ('OPENING','OPEN','CLOSING') ORDER BY id DESC LIMIT 1").get() as TradeRow | undefined) ?? null
    );
  }
  listTrades(limit = 50, offset = 0): TradeRow[] {
    return this.db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset) as TradeRow[];
  }
  allTrades(): TradeRow[] {
    return this.db.prepare('SELECT * FROM trades ORDER BY id ASC').all() as TradeRow[];
  }
  countTrades(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM trades').get() as { n: number }).n;
  }

  // ---------- events ----------
  addTradeEvent(tradeId: number, type: TradeEventType, data: Record<string, unknown> = {}, time = nowSec()): void {
    this.db.prepare('INSERT INTO trade_events(trade_id, time, type, data) VALUES(?,?,?,?)').run(tradeId, time, type, JSON.stringify(data));
  }
  listTradeEvents(tradeId?: number): TradeEvent[] {
    return tradeId === undefined
      ? (this.db.prepare('SELECT * FROM trade_events ORDER BY id ASC').all() as TradeEvent[])
      : (this.db.prepare('SELECT * FROM trade_events WHERE trade_id = ? ORDER BY id ASC').all(tradeId) as TradeEvent[]);
  }
  addSystemEvent(type: SystemEventType, data: Record<string, unknown> = {}, time = nowSec()): void {
    this.db.prepare('INSERT INTO system_events(time, type, data) VALUES(?,?,?)').run(time, type, JSON.stringify(data));
  }
  listSystemEvents(type?: SystemEventType, limit = 200): SystemEvent[] {
    return type
      ? (this.db.prepare('SELECT * FROM system_events WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, limit) as SystemEvent[])
      : (this.db.prepare('SELECT * FROM system_events ORDER BY id DESC LIMIT ?').all(limit) as SystemEvent[]);
  }

  // ---------- decisions ----------
  insertDecision(d: DecisionRow): void {
    const cols = Object.keys(d);
    this.db
      .prepare(`INSERT OR REPLACE INTO decisions (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`)
      .run(d as unknown as Record<string, unknown>);
  }
  listDecisions(limit = 100): DecisionRow[] {
    return this.db.prepare('SELECT * FROM decisions ORDER BY candle_time DESC LIMIT ?').all(limit) as DecisionRow[];
  }

  // ---------- simulated trades ----------
  replaceSimTrades(rows: readonly SimTrade[]): void {
    const ins = this.db.prepare(
      'INSERT INTO sim_trades(strategy, entry_time, side, entry, exit_time, exit, reason, gross_pnl, fees, net_pnl) VALUES(?,?,?,?,?,?,?,?,?,?)',
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM sim_trades').run();
      for (const r of rows) ins.run(r.strategy, r.entryTime, r.side, r.entry, r.exitTime, r.exit, r.reason, r.grossPnl, r.fees, r.netPnl);
    })();
  }
  listSimTrades(strategy?: string): SimTrade[] {
    const rows = (
      strategy
        ? this.db.prepare('SELECT * FROM sim_trades WHERE strategy = ? ORDER BY entry_time').all(strategy)
        : this.db.prepare('SELECT * FROM sim_trades ORDER BY entry_time').all()
    ) as Array<Record<string, number | string>>;
    return rows.map((r) => ({
      strategy: r.strategy as SimTrade['strategy'],
      entryTime: Number(r.entry_time),
      side: r.side as SimTrade['side'],
      entry: Number(r.entry),
      exitTime: Number(r.exit_time),
      exit: Number(r.exit),
      reason: r.reason as SimTrade['reason'],
      grossPnl: Number(r.gross_pnl),
      fees: Number(r.fees),
      netPnl: Number(r.net_pnl),
    }));
  }
}
