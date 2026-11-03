import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as m001 from './migrations/001_initial.js';
import { DB_BACKUPS_KEPT } from '../../config/constants.js';

const MIGRATIONS = [m001];
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1).version;

export class SchemaTooNewError extends Error {
  constructor() {
    super('Database schema is newer than this application');
    this.name = 'SchemaTooNewError';
  }
}
export class ManagedDatabase {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbDir = path.join(dataDir, 'db');
    this.backupDir = path.join(dataDir, 'backups');
    this.file = path.join(this.dbDir, 'dtp2p.sqlite');
    this.raw = null;
  }
  async open() {
    fs.mkdirSync(this.dbDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    const db = new Database(this.file);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('secure_delete = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at_ms INTEGER NOT NULL)',
    );
    const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
    if (current > LATEST_SCHEMA_VERSION) {
      db.close();
      throw new SchemaTooNewError();
    }
    const pending = MIGRATIONS.filter((m) => m.version > current);
    if (pending.length > 0 && current > 0) await backup(db, this.backupDir);
    for (const migration of pending) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations(version, applied_at_ms) VALUES (?, ?)').run(
          migration.version,
          Date.now(),
        );
      })();
    }
    this.raw = db;
    return this;
  }
  prepare(sql) {
    return this.raw.prepare(sql);
  }
  exec(sql) {
    return this.raw.exec(sql);
  }
  transaction(fn) {
    return this.raw.transaction(fn);
  }
  close() {
    if (this.raw) this.raw.close();
    this.raw = null;
  }
  async eraseAndReopen() {
    this.close();
    wipeDatabaseFiles(this.dataDir);
    return this.open();
  }
}
export function wipeDatabaseFiles(dataDir) {
  const dbDir = path.join(dataDir, 'db');
  for (const suffix of ['', '-wal', '-shm']) {
    const file = path.join(dbDir, `dtp2p.sqlite${suffix}`);
    try {
      if (fs.existsSync(file)) {
        fs.writeFileSync(file, Buffer.alloc(fs.statSync(file).size));
        fs.rmSync(file);
      }
    } catch {
      /* crypto-erase of the keys is the real guarantee */
    }
  }
  fs.rmSync(path.join(dataDir, 'backups'), { recursive: true, force: true });
}
export async function openDatabase({ dataDir }) {
  return new ManagedDatabase(dataDir).open();
}

async function backup(db, backupDir) {
  const name = `pre-migration-${Date.now()}.sqlite`;
  await db.backup(path.join(backupDir, name));
  const files = fs.readdirSync(backupDir).filter((f) => f.startsWith('pre-migration-')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - DB_BACKUPS_KEPT))) {
    fs.rmSync(path.join(backupDir, old));
  }
}
