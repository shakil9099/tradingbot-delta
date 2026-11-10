import type Database from 'better-sqlite3';

/** Additive-only migrations. Index = version − 1. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_order_id TEXT NOT NULL,
    status TEXT NOT NULL,
    side TEXT NOT NULL,
    size_contracts INTEGER NOT NULL,
    strategy TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 0,
    entry_reason TEXT NOT NULL DEFAULT '{}',
    entry_time INTEGER,
    entry_price REAL,
    sl_price REAL,
    tp_price REAL,
    stage INTEGER NOT NULL DEFAULT 0,
    sl_order_id TEXT,
    tp_order_id TEXT,
    close_reason TEXT,
    close_client_order_id TEXT,
    exit_time INTEGER,
    exit_price REAL,
    exit_reason TEXT,
    gross_pnl REAL,
    fees REAL,
    net_pnl REAL,
    config_hash TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS trades_status ON trades(status);
  CREATE INDEX IF NOT EXISTS trades_entry_time ON trades(entry_time);

  CREATE TABLE IF NOT EXISTS trade_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trade_id INTEGER NOT NULL REFERENCES trades(id),
    time INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS trade_events_trade ON trade_events(trade_id);

  CREATE TABLE IF NOT EXISTS system_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS system_events_type_time ON system_events(type, time);

  CREATE TABLE IF NOT EXISTS decisions (
    candle_time INTEGER NOT NULL,
    open REAL, high REAL, low REAL, close REAL, volume REAL,
    hull REAL, hull_prev2 REAL, ut_stop REAL, atr REAL,
    sig_hull TEXT, sig_ut TEXT, score_hull REAL, score_ut REAL,
    active TEXT, pending TEXT, action TEXT NOT NULL, note TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS decisions_candle ON decisions(candle_time);

  CREATE TABLE IF NOT EXISTS sim_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy TEXT NOT NULL,
    entry_time INTEGER NOT NULL,
    side TEXT NOT NULL,
    entry REAL NOT NULL,
    exit_time INTEGER NOT NULL,
    exit REAL NOT NULL,
    reason TEXT NOT NULL,
    gross_pnl REAL NOT NULL,
    fees REAL NOT NULL,
    net_pnl REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sim_trades_strategy_entry ON sim_trades(strategy, entry_time);
  `,
  // 2: Strategy v2 (design Amendment A.5) — initial stop distance per trade.
  // Trades still open from before the upgrade were opened with the $20 stop, so R = 20 for them.
  `ALTER TABLE trades ADD COLUMN risk_dist REAL;
   UPDATE trades SET risk_dist = 20 WHERE status IN ('OPENING', 'OPEN', 'CLOSING');`,
];

export function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM kv WHERE key = 'schema_version'").get() as { value: string } | undefined;
  let version = row ? Number(row.value) : 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO kv(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version + 1));
    })();
    version++;
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
