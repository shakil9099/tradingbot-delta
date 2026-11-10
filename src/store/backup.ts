import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.js';
import type { DB } from './db.js';

/** Nightly copy of the DB to <dataDir>/backups/bot-YYYYMMDD.db, keeping the newest 14. Never throws. */
export async function backupNightly(db: DB, dataDir: string, keep = 14, now = new Date()): Promise<string | null> {
  try {
    const dir = join(dataDir, 'backups');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const name = `bot-${now.toISOString().slice(0, 10).replace(/-/g, '')}.db`;
    const file = join(dir, name);
    await db.backup(file);
    const files = readdirSync(dir)
      .filter((f) => /^bot-\d{8}\.db$/.test(f))
      .sort();
    for (const old of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, old));
    log.info({ file }, 'backup written');
    return file;
  } catch (err) {
    log.error({ err }, 'backup failed');
    return null;
  }
}
