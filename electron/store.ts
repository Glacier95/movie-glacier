import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { ParsedName } from './scanner.js';
import type { MediaAsset, MediaType, Person, ScrapeLog, Work } from '../src/shared.js';
import { validateImdbTop250, type ImdbChartEntry } from './imdb-chart.js';

type SqlValue = string | number | null;
type Row = Record<string, unknown>;
type SecretStorage = { isEncryptionAvailable(): boolean; encryptString(value: string): Buffer; decryptString(value: Buffer): string };

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS works (
  id INTEGER PRIMARY KEY, mediaType TEXT NOT NULL, tmdbId INTEGER, imdbId TEXT, doubanId TEXT,
  titleZh TEXT NOT NULL DEFAULT '', titleEn TEXT NOT NULL DEFAULT '', originalTitle TEXT NOT NULL DEFAULT '',
  doubanTitleZh TEXT NOT NULL DEFAULT '', doubanOverviewZh TEXT NOT NULL DEFAULT '', doubanTags TEXT NOT NULL DEFAULT '[]',
  year INTEGER, overview TEXT NOT NULL DEFAULT '', runtime INTEGER, poster TEXT, backdrop TEXT,
  genres TEXT NOT NULL DEFAULT '[]', countries TEXT NOT NULL DEFAULT '[]', directors TEXT NOT NULL DEFAULT '[]',
  creators TEXT NOT NULL DEFAULT '[]', writers TEXT NOT NULL DEFAULT '[]', actors TEXT NOT NULL DEFAULT '[]',
  ratingDouban REAL, ratingSeason INTEGER, ratingImdb REAL, doubanVotes INTEGER, topRank INTEGER, imdbTopRank INTEGER,
  addedAt INTEGER NOT NULL, updatedAt INTEGER, matchState TEXT NOT NULL DEFAULT 'pending',
  favorite INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_works_tmdb ON works(mediaType,tmdbId);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY, workId INTEGER NOT NULL REFERENCES works(id), root TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, season INTEGER, episode INTEGER,
  size INTEGER NOT NULL, mtimeMs REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1, lastSeen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_work ON assets(workId);
CREATE INDEX IF NOT EXISTS idx_assets_root ON assets(root);
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY, workId INTEGER NOT NULL REFERENCES works(id), source TEXT NOT NULL,
  season INTEGER, score REAL NOT NULL, votes INTEGER, sourceId TEXT, fetchedAt INTEGER NOT NULL,
  UNIQUE(workId,source,season)
);
CREATE TABLE IF NOT EXISTS top250 (rank INTEGER PRIMARY KEY, doubanId TEXT NOT NULL UNIQUE, fetchedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS imdb_top250 (rank INTEGER PRIMARY KEY, imdbId TEXT NOT NULL UNIQUE, fetchedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, type TEXT NOT NULL, workId INTEGER, status TEXT NOT NULL,
  error TEXT, updatedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_history (id INTEGER PRIMARY KEY, taskId INTEGER NOT NULL, workId INTEGER,
  source TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', updatedAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS work_edits (workId INTEGER PRIMARY KEY REFERENCES works(id), fields TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person_aliases (id TEXT PRIMARY KEY, name TEXT NOT NULL, originalName TEXT, aliases TEXT NOT NULL DEFAULT '[]');
`;

export class Store {
  private constructor(private db: Database, private file: string, private secrets: SecretStorage) {}

  static async open(file: string, wasmPath: string, secrets: SecretStorage): Promise<Store> {
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: () => wasmPath });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    db.run(schema);
    const columns = db.exec('PRAGMA table_info(works)')[0]?.values.map(row => String(row[1])) ?? [];
    if (!columns.includes('ratingSeason')) db.run('ALTER TABLE works ADD COLUMN ratingSeason INTEGER');
    if (!columns.includes('imdbTopRank')) db.run('ALTER TABLE works ADD COLUMN imdbTopRank INTEGER');
    if (!columns.includes('favorite')) db.run('ALTER TABLE works ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('doubanTitleZh')) db.run("ALTER TABLE works ADD COLUMN doubanTitleZh TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('doubanOverviewZh')) db.run("ALTER TABLE works ADD COLUMN doubanOverviewZh TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('doubanTags')) db.run("ALTER TABLE works ADD COLUMN doubanTags TEXT NOT NULL DEFAULT '[]'");
    if (!(db.exec('SELECT COUNT(*) FROM task_history')[0]?.values[0]?.[0] as number)) {
      db.run(`INSERT INTO task_history(taskId,workId,source,title,status,message,updatedAt)
        SELECT tasks.id,tasks.workId,tasks.type,COALESCE(NULLIF(works.titleZh,''),NULLIF(works.titleEn,''),works.originalTitle,'未知影片'),
          tasks.status,COALESCE(tasks.error,''),tasks.updatedAt FROM tasks LEFT JOIN works ON works.id=tasks.workId
        WHERE tasks.status IN ('done','failed','skipped')`);
    }
    const personColumns = db.exec('PRAGMA table_info(person_aliases)')[0]?.values.map(row => String(row[1])) ?? [];
    if (!personColumns.includes('aliases')) db.run("ALTER TABLE person_aliases ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'");
    const store = new Store(db, file, secrets);
    store.save();
    if (!store.getSetting('doubanDetailsV1')) {
      store.retryFailed();
      for (const work of store.listWorks()) {
        if (work.mediaType !== 'movie') continue;
        store.queueTask('douban', work.id);
        if (/[\u3400-\u9fff]/.test(work.overview) || work.genres.some(genre => /[\u3400-\u9fff]/.test(genre)))
          store.queueTask('tmdb', work.id);
      }
      store.setSetting('doubanDetailsV1', '1');
    }
    return store;
  }

  save(): void {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, Buffer.from(this.db.export()));
    fs.renameSync(temp, this.file);
  }

  run(sql: string, values: SqlValue[] = []): void { this.db.run(sql, values); this.save(); }
  all<T extends Row>(sql: string, values: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(values);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally { statement.free(); }
  }
  one<T extends Row>(sql: string, values: SqlValue[] = []): T | null { return this.all<T>(sql, values)[0] ?? null; }
  private lastId(): number { return Number(this.one<{ id: number }>('SELECT last_insert_rowid() AS id')?.id ?? 0); }

  getSetting(key: string): string { return String(this.one<{ value: string }>('SELECT value FROM settings WHERE key=?', [key])?.value ?? ''); }
  setSetting(key: string, value: string): void {
    this.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
  }
  getSecret(key: string): string {
    const raw = this.getSetting(`secret:${key}`);
    if (!raw || !this.secrets.isEncryptionAvailable()) return '';
    try { return this.secrets.decryptString(Buffer.from(raw, 'base64')); } catch { return ''; }
  }
  setSecret(key: string, value: string): void {
    if (!this.secrets.isEncryptionAvailable()) throw new Error('系统无法安全保存访问凭据');
    this.setSetting(`secret:${key}`, this.secrets.encryptString(value).toString('base64'));
  }
  roots(): string[] { try { return JSON.parse(this.getSetting('roots') || '[]') as string[]; } catch { return []; } }
  setRoots(roots: string[]): void { this.setSetting('roots', JSON.stringify(roots)); }
  top250UpdatedAt(): number | null { return Number(this.one<{ date: number }>('SELECT MAX(fetchedAt) AS date FROM top250')?.date) || null; }
  imdbTop250UpdatedAt(): number | null { return Number(this.one<{ date: number }>('SELECT MAX(fetchedAt) AS date FROM imdb_top250')?.date) || null; }

  listWorks(): Work[] {
    const rows = this.all<Row>('SELECT * FROM works WHERE matchState != ? ORDER BY addedAt DESC', ['ignored']);
    const assets = this.all<Row>('SELECT * FROM assets WHERE active=1 ORDER BY path');
    const byWork = new Map<number, MediaAsset[]>();
    for (const row of assets) {
      const asset = { ...row, active: Boolean(row.active), available: fs.existsSync(String(row.path)) } as unknown as MediaAsset;
      byWork.set(asset.workId, [...(byWork.get(asset.workId) ?? []), asset]);
    }
    return rows.map(row => ({
      ...row,
      genres: JSON.parse(String(row.genres)), doubanTags: JSON.parse(String(row.doubanTags)), countries: JSON.parse(String(row.countries)),
      directors: JSON.parse(String(row.directors)) as Person[], creators: JSON.parse(String(row.creators)) as Person[],
      writers: JSON.parse(String(row.writers)) as Person[], actors: JSON.parse(String(row.actors)) as Person[],
      favorite: Boolean(row.favorite),
      assets: byWork.get(Number(row.id)) ?? []
    } as Work)).filter(work => work.assets.length > 0);
  }
  work(id: number): Work | null { return this.listWorks().find(work => work.id === id) ?? null; }
  findAsset(filePath: string): MediaAsset | null {
    const row = this.one<Row>('SELECT * FROM assets WHERE path=?', [filePath]);
    return row ? { ...row, active: Boolean(row.active), available: fs.existsSync(String(row.path)) } as unknown as MediaAsset : null;
  }
  asset(id: number): MediaAsset | null {
    const row = this.one<Row>('SELECT * FROM assets WHERE id=?', [id]);
    return row ? { ...row, active: Boolean(row.active), available: fs.existsSync(String(row.path)) } as unknown as MediaAsset : null;
  }
  findWorkByTmdb(type: MediaType, tmdbId: number): number | null {
    return Number(this.one<{ id: number }>('SELECT id FROM works WHERE mediaType=? AND tmdbId=?', [type, tmdbId])?.id) || null;
  }
  findWorkByImdb(type: MediaType, imdbId: string): number | null {
    return Number(this.one<{ id: number }>('SELECT id FROM works WHERE mediaType=? AND imdbId=? AND matchState!=?',
      [type, imdbId, 'ignored'])?.id) || null;
  }
  findPendingWork(type: MediaType, normalizedTitle: string, year: number | null): number | null {
    return Number(this.one<{ id: number }>(
      'SELECT id FROM works WHERE mediaType=? AND lower(originalTitle)=? AND (year=? OR (year IS NULL AND ? IS NULL)) AND matchState IN (?,?)',
      [type, normalizedTitle.toLowerCase(), year, year, 'pending', 'manual'])?.id) || null;
  }
  createWork(type: MediaType, title: string, year: number | null): number {
    this.db.run('INSERT INTO works(mediaType,titleZh,titleEn,originalTitle,year,addedAt) VALUES(?,?,?,?,?,?)',
      [type, title, title, title, year, Date.now()]);
    const id = this.lastId();
    this.save();
    return id;
  }
  putAsset(input: Omit<MediaAsset, 'id' | 'active' | 'available' | 'lastSeen'>, seen: number): { added: boolean } {
    const old = this.findAsset(input.path);
    if (old) {
      this.run('UPDATE assets SET workId=?,root=?,kind=?,season=?,episode=?,size=?,mtimeMs=?,active=1,lastSeen=? WHERE id=?',
        [input.workId, input.root, input.kind, input.season, input.episode, input.size, input.mtimeMs, seen, old.id]);
      return { added: false };
    }
    this.run('INSERT INTO assets(workId,root,path,kind,season,episode,size,mtimeMs,active,lastSeen) VALUES(?,?,?,?,?,?,?,?,1,?)',
      [input.workId, input.root, input.path, input.kind, input.season, input.episode, input.size, input.mtimeMs, seen]);
    return { added: true };
  }
  markRootMissing(root: string, seen: number): void {
    this.run('UPDATE assets SET active=0 WHERE root=? AND lastSeen!=?', [root, seen]);
  }
  deactivateRoot(root: string): void { this.run('UPDATE assets SET active=0 WHERE root=?', [root]); }
  moveAssets(fromWork: number, toWork: number): void {
    this.run('UPDATE works SET favorite=1 WHERE id=? AND EXISTS (SELECT 1 FROM works WHERE id=? AND favorite=1)', [toWork, fromWork]);
    this.run('UPDATE assets SET workId=? WHERE workId=?', [toWork, fromWork]);
    this.run('UPDATE works SET matchState=? WHERE id=?', ['ignored', fromWork]);
  }
  mergeSeries(fromId: number, toId: number): void {
    const from = this.work(fromId), to = this.work(toId);
    if (!from || !to || fromId === toId || from.mediaType !== 'tv' || to.mediaType !== 'tv' ||
      from.matchState === 'manual' || to.matchState === 'manual' || this.hasManualFields(fromId) || this.hasManualFields(toId))
      throw new Error('剧集合并条件不符');
    const fields = ['tmdbId', 'imdbId', 'doubanId', 'year', 'overview', 'poster', 'backdrop', 'doubanTitleZh', 'doubanOverviewZh', 'ratingImdb', 'doubanVotes'] as const;
    this.db.run('BEGIN');
    try {
      for (const key of fields) if (!to[key] && from[key]) this.db.run(`UPDATE works SET ${key}=? WHERE id=?`, [from[key]!, toId]);
      for (const key of ['genres', 'countries', 'directors', 'creators', 'writers', 'actors', 'doubanTags'] as const)
        if (!to[key].length && from[key].length) this.db.run(`UPDATE works SET ${key}=? WHERE id=?`, [JSON.stringify(from[key]), toId]);
      this.db.run('UPDATE works SET favorite=? WHERE id=?', [Number(to.favorite || from.favorite), toId]);
      this.db.run(`INSERT INTO ratings(workId,source,season,score,votes,sourceId,fetchedAt)
        SELECT ?,r.source,r.season,r.score,r.votes,r.sourceId,r.fetchedAt FROM ratings r WHERE r.workId=?
        AND NOT EXISTS(SELECT 1 FROM ratings kept WHERE kept.workId=? AND kept.source=r.source AND kept.season IS r.season)`, [toId, fromId, toId]);
      this.db.run(`UPDATE works SET ratingDouban=(SELECT score FROM ratings WHERE workId=? AND source='douban'
        ORDER BY season IS NOT NULL,season DESC LIMIT 1),ratingSeason=(SELECT season FROM ratings WHERE workId=? AND source='douban'
        ORDER BY season IS NOT NULL,season DESC LIMIT 1) WHERE id=? AND EXISTS(SELECT 1 FROM ratings WHERE workId=? AND source='douban')`, [toId, toId, toId, toId]);
      this.db.run('UPDATE assets SET workId=? WHERE workId=?', [toId, fromId]);
      this.db.run("UPDATE tasks SET status='skipped',error='已归并到同一剧集' WHERE workId=? AND status IN ('pending','running','failed')", [fromId]);
      this.db.run("UPDATE works SET matchState='ignored' WHERE id=?", [fromId]);
      this.db.run('COMMIT');
    } catch (error) { this.db.run('ROLLBACK'); throw error; }
    this.save();
  }
  hasManualFields(id: number): boolean {
    return Boolean(this.one('SELECT workId FROM work_edits WHERE workId=?', [id]));
  }
  repairWorkFromName(id: number, parsed: ParsedName): void {
    // Replace only machine-derived metadata. Keep the work ID, favorite and asset IDs.
    this.db.run('BEGIN');
    try {
      this.db.run(`UPDATE works SET mediaType=?,titleZh=?,titleEn=?,originalTitle=?,year=?,
        tmdbId=NULL,imdbId=NULL,doubanId=NULL,doubanTitleZh='',doubanOverviewZh='',doubanTags='[]',
        overview='',runtime=NULL,poster=NULL,backdrop=NULL,genres='[]',countries='[]',directors='[]',creators='[]',writers='[]',actors='[]',
        ratingDouban=NULL,ratingSeason=NULL,ratingImdb=NULL,doubanVotes=NULL,topRank=NULL,imdbTopRank=NULL,updatedAt=NULL,matchState='pending'
        WHERE id=?`, [parsed.mediaType, parsed.title, parsed.title, parsed.title, parsed.year, id]);
      this.db.run('DELETE FROM ratings WHERE workId=?', [id]);
      this.db.run("UPDATE tasks SET status='skipped',error='本地识别已修正，等待重新抓取' WHERE workId=? AND status IN ('pending','running','failed')", [id]);
      this.db.run('COMMIT');
      this.save();
    } catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
  setFavorite(id: number, favorite: boolean): void {
    if (!this.one('SELECT id FROM works WHERE id=? AND matchState!=?', [id, 'ignored'])) throw new Error('影片不存在');
    this.run('UPDATE works SET favorite=? WHERE id=?', [favorite ? 1 : 0, id]);
  }
  ignoredWorks(): { id: number; title: string; path: string }[] {
    return this.all<{ id: number; title: string; path: string }>(`SELECT works.id,works.titleZh AS title,COALESCE(MIN(assets.path),'') AS path
      FROM works LEFT JOIN assets ON assets.workId=works.id WHERE works.matchState='ignored'
      GROUP BY works.id HAVING COUNT(assets.id)>0 ORDER BY works.addedAt DESC`);
  }
  ignoreWork(id: number): void {
    this.setWorkFields(id, { matchState: 'ignored' });
    this.run('UPDATE tasks SET status=? WHERE workId=? AND status IN (?,?)', ['done', id, 'pending', 'running']);
  }
  restoreWork(id: number): void { this.setWorkFields(id, { matchState: 'pending' }); }
  setWorkFields(id: number, fields: Partial<Work>): void {
    const allowed = new Set(['tmdbId','imdbId','doubanId','doubanTitleZh','doubanOverviewZh','doubanTags','titleZh','titleEn','originalTitle','year','overview','runtime','poster','backdrop','genres','countries','directors','creators','writers','actors','ratingDouban','ratingSeason','ratingImdb','doubanVotes','topRank','updatedAt','matchState']);
    const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
    if (!entries.length) return;
    const values = entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value as SqlValue);
    this.run(`UPDATE works SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`, [...values, id]);
    if (entries.some(([key]) => key === 'imdbId')) this.syncImdbTopRank(id);
  }
  setManualFields(id: number, fields: Partial<Pick<Work, 'titleZh' | 'titleEn' | 'year' | 'overview' | 'imdbId' | 'doubanId'>>): void {
    const previous = this.one<{ fields: string }>('SELECT fields FROM work_edits WHERE workId=?', [id]);
    const merged = { ...(previous ? JSON.parse(previous.fields) : {}), ...fields };
    this.run('INSERT INTO work_edits(workId,fields) VALUES(?,?) ON CONFLICT(workId) DO UPDATE SET fields=excluded.fields',
      [id, JSON.stringify(merged)]);
    this.setWorkFields(id, fields);
  }
  clearManualFields(id: number): void { this.run('DELETE FROM work_edits WHERE workId=?', [id]); }
  clearRatings(id: number): void {
    this.run('DELETE FROM ratings WHERE workId=?', [id]);
    this.setWorkFields(id, { ratingDouban: null, ratingSeason: null, ratingImdb: null, doubanVotes: null, topRank: null });
  }
  clearDoubanRating(id: number): void {
    this.run('DELETE FROM ratings WHERE workId=? AND source=?', [id, 'douban']);
    this.setWorkFields(id, { ratingDouban: null, ratingSeason: null, doubanVotes: null, topRank: null });
  }
  clearDoubanFields(id: number): void {
    this.setWorkFields(id, { doubanId: null, doubanTitleZh: '', doubanOverviewZh: '', doubanTags: [] });
  }
  applyDoubanTitle(id: number): void {
    const row = this.one<{ doubanTitleZh: string }>('SELECT doubanTitleZh FROM works WHERE id=?', [id]);
    if (row?.doubanTitleZh) this.setWorkFields(id, { titleZh: row.doubanTitleZh });
  }
  applyManualFields(id: number): void {
    const row = this.one<{ fields: string }>('SELECT fields FROM work_edits WHERE workId=?', [id]);
    if (row) this.setWorkFields(id, JSON.parse(row.fields));
  }
  personAlias(id: string): Person | null {
    const row = this.one<{ id: string; name: string; originalName: string | null; aliases: string }>('SELECT * FROM person_aliases WHERE id=?', [id]);
    return row ? { id, name: row.name, ...(row.originalName ? { originalName: row.originalName } : {}), aliases: JSON.parse(row.aliases) } : null;
  }
  setPersonAlias(person: Person): void {
    this.run('INSERT INTO person_aliases(id,name,originalName,aliases) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,originalName=excluded.originalName,aliases=excluded.aliases',
      [person.id, person.name, person.originalName ?? null, JSON.stringify(person.aliases ?? [])]);
  }
  setRating(workId: number, source: string, season: number | null, score: number, votes: number | null, sourceId: string | null): void {
    this.run('DELETE FROM ratings WHERE workId=? AND source=? AND ((season=? ) OR (season IS NULL AND ? IS NULL))', [workId, source, season, season]);
    this.run('INSERT INTO ratings(workId,source,season,score,votes,sourceId,fetchedAt) VALUES(?,?,?,?,?,?,?)',
      [workId, source, season, score, votes, sourceId, Date.now()]);
    if (source === 'douban') {
      const display = this.one<{ score: number; votes: number | null; season: number | null }>(
        'SELECT score,votes,season FROM ratings WHERE workId=? AND source=? ORDER BY CASE WHEN season IS NULL THEN 0 ELSE 1 END, season DESC LIMIT 1',
        [workId, source]);
      if (display) this.setWorkFields(workId, { ratingDouban: display.score, ratingSeason: display.season, doubanVotes: display.votes });
    }
    if (source === 'imdb') this.setWorkFields(workId, { ratingImdb: score });
  }
  replaceTop250(entries: { rank: number; doubanId: string }[]): void {
    if (entries.length !== 250 || new Set(entries.map(item => item.doubanId)).size !== 250) throw new Error('Top250 列表不完整');
    const now = Date.now();
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM top250');
      for (const item of entries) this.db.run('INSERT INTO top250(rank,doubanId,fetchedAt) VALUES(?,?,?)', [item.rank, item.doubanId, now]);
      this.db.run('UPDATE works SET topRank=NULL');
      this.db.run('UPDATE works SET topRank=(SELECT rank FROM top250 WHERE doubanId=works.doubanId) WHERE doubanId IS NOT NULL');
      this.db.run('COMMIT');
      this.save();
    } catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
  syncTopRank(id: number): void {
    this.run('UPDATE works SET topRank=(SELECT rank FROM top250 WHERE doubanId=works.doubanId) WHERE id=?', [id]);
  }
  replaceImdbTop250(entries: ImdbChartEntry[]): void {
    validateImdbTop250(entries);
    const now = Date.now();
    this.db.run('BEGIN');
    try {
      this.db.run('DELETE FROM imdb_top250');
      for (const item of entries) this.db.run('INSERT INTO imdb_top250(rank,imdbId,fetchedAt) VALUES(?,?,?)', [item.rank, item.imdbId, now]);
      this.db.run("UPDATE works SET imdbTopRank=CASE WHEN mediaType='movie' THEN (SELECT rank FROM imdb_top250 WHERE imdbId=works.imdbId) END");
      this.db.run('COMMIT');
      this.save();
    } catch (error) { this.db.run('ROLLBACK'); throw error; }
  }
  syncImdbTopRank(id: number): void {
    this.run("UPDATE works SET imdbTopRank=CASE WHEN mediaType='movie' THEN (SELECT rank FROM imdb_top250 WHERE imdbId=works.imdbId) END WHERE id=?", [id]);
  }
  queueTask(type: string, workId: number): void {
    if (this.one('SELECT id FROM tasks WHERE type=? AND workId=? AND status IN (?,?)', [type, workId, 'pending', 'running'])) return;
    this.run('INSERT INTO tasks(type,workId,status,updatedAt) VALUES(?,?,?,?)', [type, workId, 'pending', Date.now()]);
  }
  pendingTasks(): { id: number; type: string; workId: number }[] {
    return this.all<{ id: number; type: string; workId: number }>('SELECT id,type,workId FROM tasks WHERE status IN (?,?) ORDER BY id', ['pending', 'running']);
  }
  hasFailedTasks(type: string): boolean { return Boolean(this.one('SELECT id FROM tasks WHERE type=? AND status=?', [type, 'failed'])); }
  listScrapeLogs(): ScrapeLog[] {
    return this.all<Row>(`WITH entries AS (
        SELECT id,workId,source,status,message,updatedAt FROM task_history
        UNION ALL
        SELECT -id,workId,type,status,COALESCE(error,''),updatedAt FROM tasks WHERE status IN ('pending','running')
      ), latest AS (
        SELECT entries.*,ROW_NUMBER() OVER (PARTITION BY workId ORDER BY updatedAt DESC,id DESC) AS position
        FROM entries WHERE workId IS NOT NULL
      )
      SELECT latest.id,latest.workId,
        COALESCE(NULLIF(works.titleZh,''),NULLIF(works.titleEn,''),works.originalTitle,'未知影片') AS title,
        latest.source,latest.status,latest.message,latest.updatedAt
      FROM latest JOIN works ON works.id=latest.workId
      WHERE latest.position=1 AND works.matchState!='ignored' ORDER BY latest.updatedAt DESC,latest.id DESC LIMIT 600`)
      .map(row => ({ ...row, source: row.source === 'imdb' ? 'omdb' : row.source }) as unknown as ScrapeLog);
  }
  recordSourceRefresh(workId: number, source: ScrapeLog['source'], error?: string, note = ''): void {
    this.run(`INSERT INTO task_history(taskId,workId,source,title,status,message,updatedAt)
      SELECT 0,id,?,COALESCE(NULLIF(titleZh,''),NULLIF(titleEn,''),originalTitle,'未知影片'),?,?,?
      FROM works WHERE id=?`, [source, error ? 'failed' : 'done', error ?? note, Date.now(), workId]);
  }
  taskRunning(id: number): void { this.run('UPDATE tasks SET status=?,error=NULL,updatedAt=? WHERE id=?', ['running', Date.now(), id]); }
  private recordTask(id: number, source?: string): void {
    this.run(`INSERT INTO task_history(taskId,workId,source,title,status,message,updatedAt)
      SELECT tasks.id,tasks.workId,COALESCE(?,tasks.type),COALESCE(NULLIF(works.titleZh,''),NULLIF(works.titleEn,''),works.originalTitle,'未知影片'),
        tasks.status,COALESCE(tasks.error,''),tasks.updatedAt FROM tasks LEFT JOIN works ON works.id=tasks.workId WHERE tasks.id=?`, [source ?? null, id]);
  }
  taskDone(id: number, error?: string, note = '', source?: string): void {
    this.run('UPDATE tasks SET status=?,error=?,updatedAt=? WHERE id=?', [error ? 'failed' : 'done', (error ?? note) || null, Date.now(), id]);
    this.recordTask(id, source);
  }
  taskSkipped(id: number, reason: string): void {
    this.run('UPDATE tasks SET status=?,error=?,updatedAt=? WHERE id=?', ['skipped', reason, Date.now(), id]);
    this.recordTask(id);
  }
  retryFailed(): void {
    // Retire an old failed attempt once the same provider has succeeded later.
    this.run(`UPDATE tasks SET status='skipped' WHERE status='failed' AND EXISTS(
      SELECT 1 FROM task_history h WHERE h.workId=tasks.workId AND h.status='done' AND h.updatedAt>=tasks.updatedAt
      AND (h.source=tasks.type OR (tasks.type IN ('tmdb','imdb') AND h.source='omdb'))) `);
    const failed = this.listScrapeLogs().filter(log => log.status === 'failed');
    this.run(`UPDATE tasks SET status='pending',error=NULL,updatedAt=? WHERE status='failed' AND EXISTS(
      SELECT 1 FROM works WHERE works.id=tasks.workId AND works.matchState!='ignored')`, [Date.now()]);
    // Manual source refreshes have history entries but may have no queued task.
    for (const log of failed) this.queueTask(log.source === 'douban' ? 'douban' : 'tmdb', log.workId);
  }
  close(): void { this.save(); this.db.close(); }
}
