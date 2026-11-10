import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Database, SqlJsStatic } from 'sql.js';

export function writeSnapshot(file: string, bytes: Uint8Array, temp = file + '.tmp'): void {
  fs.writeFileSync(temp, bytes, { flush: true });
  fs.renameSync(temp, file);
}

function validatedDatabase(SQL: SqlJsStatic, bytes: Buffer): Database | null {
  if (bytes.length < 100 || bytes.toString('ascii', 0, 16) !== 'SQLite format 3\0') return null;
  let db: Database | undefined;
  try {
    db = new SQL.Database(bytes);
    const tables = db.exec("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('works','assets','settings')");
    const check = db.exec('PRAGMA quick_check(1)');
    if (tables[0]?.values[0]?.[0] === 3 && check[0]?.values[0]?.[0] === 'ok') return db;
  } catch (error) {
    if (!/malformed|not a database|corrupt/i.test(String(error))) {
      db?.close();
      throw error;
    }
  }
  db?.close();
  return null;
}

export function openDatabaseFile(SQL: SqlJsStatic, file: string): { db: Database; recoveredFrom: string | null } {
  let primary: Buffer | null = null;
  try { primary = fs.readFileSync(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const db = primary && validatedDatabase(SQL, primary);
  if (db) return { db, recoveredFrom: null };
  const candidates = [file + '.tmp', file + '.bak', file + '.bak.tmp']
    .filter(candidate => fs.existsSync(candidate))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const candidate of candidates) {
    const bytes = fs.readFileSync(candidate);
    const restored = validatedDatabase(SQL, bytes);
    if (!restored) continue;
    try {
      if (primary) fs.writeFileSync(file + '.corrupt-' + randomUUID(), primary, { flag: 'wx', flush: true });
      // Use a different staging name because .tmp can be the only healthy copy.
      writeSnapshot(file, bytes, file + '.restore.tmp');
      return { db: restored, recoveredFrom: path.basename(candidate) };
    } catch (error) {
      restored.close();
      throw error;
    }
  }
  if (!primary && !candidates.length) return { db: new SQL.Database(), recoveredFrom: null };
  throw new Error('影视库数据库无法读取，未找到可用的本地备份。请先复制整个数据目录，再检查旧备份或系统文件历史记录。\n' +
    'The library database could not be read and no usable local backup was found. Copy the data folder before restoring a backup.\n\n' + file);
}
