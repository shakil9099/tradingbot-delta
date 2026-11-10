import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, migrate } from '../src/store/migrations.js';

describe('migrations', () => {
  it('upgrading a v1 database adds risk_dist; open pre-v2 trades get R = 20, closed ones stay null', () => {
    const db = new Database(':memory:');
    migrate(db);
    // Rewind to a v1 database (before Strategy v2).
    db.prepare("UPDATE kv SET value = '1' WHERE key = 'schema_version'").run();
    db.exec('ALTER TABLE trades DROP COLUMN risk_dist');
    const ins = db.prepare("INSERT INTO trades(client_order_id, status, side, size_contracts, strategy) VALUES(?, ?, 'buy', 100, 'hull')");
    ins.run('open', 'OPEN');
    ins.run('closing', 'CLOSING');
    ins.run('closed', 'CLOSED');
    migrate(db);
    const rows = db.prepare('SELECT client_order_id AS id, risk_dist FROM trades ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'closed', risk_dist: null },
      { id: 'closing', risk_dist: 20 },
      { id: 'open', risk_dist: 20 },
    ]);
    expect((db.prepare("SELECT value FROM kv WHERE key = 'schema_version'").get() as { value: string }).value).toBe(String(SCHEMA_VERSION));
  });

  it('is idempotent', () => {
    const db = new Database(':memory:');
    migrate(db);
    migrate(db);
    expect(SCHEMA_VERSION).toBe(2);
  });
});
