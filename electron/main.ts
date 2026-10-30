import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } from 'electron';
import { backgroundBlurDefault, posterWallDefaults, posterWallControls, appearanceDefaults, appearanceControls, type AppearanceSettings, type PosterWallSettings } from '../src/shared.js';
import type { ConnectionChecks, JobState, MatchCandidate, MetadataSource, PublicSettings, Work, WorkEdit } from '../src/shared.js';
import { discover, findNfoId, localPoster, parseName, type DiscoveredMedia } from './scanner.js';
import { localWorkMatches, repairParsedWork, reconcileSeries } from './local-match.js';
import { lookupYear } from './omdb.js';
import { knownSeries } from './media-titles.js';
import { doubanSeriesTitle } from './douban-match.js';
import { cacheImageDir, cacheLocalImage, Metadata } from './metadata.js';
import { Store } from './store.js';
import { Douban } from './douban.js';
import { fetchImdbTop250, openImdbVerification } from './imdb.js';
import { shooterSubtitleUrl } from './shooter.js';
import { applicationDataDirectory, prepareDataDirectory } from './data-directory.js';
import { playerCommand } from './player.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
let store: Store;
let metadata: Metadata;
let douban: Douban;
let mainWindow: BrowserWindow | null = null;
let job: JobState = freshJob();
let discoveredPlayer: string | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: 'library', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'filmapp', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function freshJob(kind: JobState['kind'] = null): JobState {
  return { running: kind !== null, kind, phase: '', done: 0, total: 0, addedWorks: 0,
    addedAssets: 0, addedEpisodes: 0, failures: 0, message: '' };
}
function notify(channel: string, payload?: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function progress(patch: Partial<JobState>): void {
  job = { ...job, ...patch };
  notify('job', job);
}
function changed(): void { notify('changed'); }
function networkFailure(error: unknown): boolean {
  return /网络连接失败|fetch failed|net::ERR_|超时|timeout|HTTP (429|50[0-9])|请求额度已用尽|Request limit reached/i.test(String(error));
}

function discoverPlayer(): string {
  if (process.platform === 'darwin') {
    return [app.getPath('home') + '/Applications', '/Applications']
      .flatMap(folder => ['IINA.app', 'VLC.app'].map(name => path.join(folder, name)))
      .find(candidate => fs.existsSync(candidate)) ?? '';
  }
  if (process.platform !== 'win32') return '';
  const paths = [
    'C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe',
    'C:\\Program Files\\PotPlayer\\PotPlayerMini64.exe',
    'C:\\Program Files (x86)\\DAUM\\PotPlayer\\PotPlayerMini.exe'
  ];
  for (const scope of ['HKCU', 'HKLM']) {
    for (const executable of ['PotPlayerMini64.exe', 'PotPlayerMini.exe']) {
      try {
        const output = execFileSync('reg.exe', ['query', `${scope}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`, '/ve'],
          { encoding: 'utf8', timeout: 3000 });
        const value = /REG_SZ\s+(.+)$/m.exec(output)?.[1]?.trim().replace(/^"|"$/g, '');
        if (value && fs.existsSync(value)) return value;
      } catch { /* Probe another standard location. */ }
    }
  }
  return paths.find(candidate => fs.existsSync(candidate)) ?? '';
}

function settings(): PublicSettings {
  const savedBlur = store.getSetting('backgroundBlur');
  const backgroundBlur = savedBlur === '' ? backgroundBlurDefault : Number(savedBlur);
  const wallSettings = { ...posterWallDefaults, ...appearanceDefaults };
  for (const { key, min, max } of [...posterWallControls, ...appearanceControls]) {
    const saved = store.getSetting(key);
    const value = saved === '' ? wallSettings[key] : Number(saved);
    wallSettings[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : wallSettings[key];
  }
  return {
    ...wallSettings,
    language: store.getSetting('language') === 'en' ? 'en' : 'zh',
    roots: store.roots(), playerPath: store.getSetting('playerPath') || (discoveredPlayer ??= discoverPlayer()),
    proxyUrl: store.getSetting('proxyUrl'),
    backgroundBlur: Number.isFinite(backgroundBlur) ? Math.max(0, Math.min(50, Math.round(backgroundBlur))) : backgroundBlurDefault,
    hasTmdbKey: Boolean(store.getSecret('tmdb')), hasOmdbKey: Boolean(store.getSecret('omdb')),
    doubanStatus: store.getSetting('doubanStatus') || '未登录或未验证',
    top250UpdatedAt: store.top250UpdatedAt(),
    imdbTop250UpdatedAt: store.imdbTop250UpdatedAt(),
    needsSetup: process.env.FILM_LIBRARY_SMOKE !== '1' &&
      (!store.roots().length || (!store.getSecret('tmdb') && !store.getSecret('omdb')))
  };
}

async function processMedia(media: DiscoveredMedia, seen: number, repair = false): Promise<void> {
  const old = store.findAsset(media.path);
  const parsed = parseName(media.path, media.kind);
  const repaired = Boolean(repair && old && repairParsedWork(store, old.workId));
  let workId = old?.workId;
  if (repaired && workId) {
    const work = store.work(workId);
    const existing = work && store.listWorks().find(item => item.id !== workId && localWorkMatches(item, parsed) && !store.hasManualFields(item.id) && item.matchState !== 'manual');
    if (existing) { store.moveAssets(workId, existing.id); workId = existing.id; store.queueTask('tmdb', workId); store.queueTask('douban', workId); }
  }
  let addedWork = false;
  if (!workId) {
    const candidate = store.listWorks().find(work => localWorkMatches(work, parsed));
    workId = candidate?.id ?? store.findPendingWork(parsed.mediaType, parsed.normalizedTitle, parsed.year) ?? undefined;
    if (!workId) {
      workId = store.createWork(parsed.mediaType, parsed.title, parsed.year);
      addedWork = true;
      job.addedWorks++;
    }
  }
  const result = store.putAsset({ workId, root: media.root, path: media.path, kind: media.kind,
    season: parsed.season, episode: parsed.episode, size: media.size, mtimeMs: media.mtimeMs }, seen);
  if (result.added) {
    job.addedAssets++;
    if (parsed.episode !== null) job.addedEpisodes++;
  }
  if (addedWork || (repaired && workId === old?.workId)) {
    const poster = localPoster(media.path, media.kind);
    if (poster) store.setWorkFields(workId, { poster: cacheLocalImage(poster, app.getPath('userData')) });
    const imdbId = findNfoId(media.path, media.kind);
    if (imdbId) store.setWorkFields(workId, { imdbId });
    store.queueTask('tmdb', workId);
    // Chinese metadata is independent of TMDB/OMDb availability. Queue it
    // separately so a failed English metadata request cannot suppress Douban.
    if (parsed.mediaType === 'movie') store.queueTask('douban', workId);
  }
}

async function refreshDoubanWork(work: Work): Promise<string> {
  const seasons = [...new Set(work.assets.map(asset => asset.season).filter((value): value is number => value !== null && value > 0))].sort((a, b) => a - b);
  if (work.mediaType === 'tv' && seasons.length) return refreshDoubanSeasons(work, seasons);
  let doubanId = work.doubanId;
  let crosswalkError = '';
  if (!doubanId && work.mediaType === 'movie' && work.imdbId) {
    try { doubanId = await douban.findIdByImdb(work.imdbId); }
    catch (error) { crosswalkError = String(error).replace(/^Error: /, ''); }
    if (doubanId) store.setWorkFields(work.id, { doubanId });
  }
  const lookupWork = doubanId ? { ...work, doubanId } : work;
  const subject = doubanId ? await douban.readKnownSubject(lookupWork) : await douban.findSubject(lookupWork);
  if (subject && doubanId && !work.doubanId && work.imdbId && subject.imdbId && subject.imdbId !== work.imdbId) {
    store.clearDoubanFields(work.id);
    throw new Error('编号对照得到的豆瓣条目与本片 IMDb ID 不一致，已取消关联');
  }
  if (subject) {
    const titleZh = (subject.titleZh ?? '').trim();
    const discoveredImdbId = work.mediaType === 'movie' && !work.imdbId && /^tt\d{7,10}$/.test(subject.imdbId ?? '')
      ? subject.imdbId : null;
    store.setWorkFields(work.id, {
      doubanId: subject.id,
      ...(discoveredImdbId ? { imdbId: discoveredImdbId } : {}),
      ...(titleZh && /[\u3400-\u9fff]/.test(titleZh) ? { doubanTitleZh: titleZh, titleZh } : {}),
      ...(subject.overviewZh?.trim() ? { doubanOverviewZh: subject.overviewZh.trim() } : {}),
      ...(subject.tagsZh?.length ? { doubanTags: subject.tagsZh } : {})
    });
    store.applyManualFields(work.id);
    // A Chinese title can find the correct entry even when OMDb does not know
    // the release's English alias. Use the verified entry's IMDb ID to retry.
    if (discoveredImdbId && store.work(work.id)?.imdbId && !work.tmdbId) store.queueTask('tmdb', work.id);
    if (subject.rating !== null) store.setRating(work.id, 'douban', null, subject.rating, subject.votes, subject.id);
    store.syncTopRank(work.id);
    if (work.mediaType === 'movie' && !store.work(work.id)?.doubanOverviewZh)
      throw new Error(`已保存豆瓣片名与标签（条目 ${subject.id}），但中文简介暂不可用；请稍后重试豆瓣抓取`);
    return `豆瓣${subject.rating !== null ? ` ${subject.rating.toFixed(1)} 分` : '暂无评分'}；条目 ${subject.id}；中文资料已更新`;
  }
  if (work.mediaType !== 'tv') throw new Error(doubanId
    ? `已定位豆瓣条目 ${doubanId}，但暂时无法读取详情；请稍后重试或完成豆瓣验证`
    : `豆瓣没有找到可靠匹配的条目${crosswalkError ? `；IMDb 编号对照失败：${crosswalkError}` : ''}`);
  throw new Error('豆瓣没有找到可靠匹配的剧集或分季条目');
}

async function refreshDoubanSeasons(work: Work, seasons: number[]): Promise<string> {
  let found = 0;
  const notes: string[] = [];
  const canonical = [work.titleZh, work.titleEn, work.originalTitle].map(knownSeries).find(Boolean);
  for (const season of seasons) {
    let seasonSubject = await douban.findSubject(store.work(work.id)!, season);
    let wholeSeries = false;
    if (!seasonSubject && season === 1) {
      seasonSubject = await douban.findSubject(work);
      wholeSeries = Boolean(seasonSubject);
    }
    if (!seasonSubject) { notes.push(`第 ${season} 季暂未匹配`); continue; }
    const current = store.work(work.id)!;
    const titleZh = canonical?.titleZh || doubanSeriesTitle(seasonSubject.titleZh ?? '');
    const imdbId = !current.imdbId && season === 1 && /^tt\d{7,10}$/.test(seasonSubject.imdbId ?? '') ? seasonSubject.imdbId : null;
    store.setWorkFields(work.id, {
      ...(titleZh && /\p{Script=Han}/u.test(titleZh) ? { doubanTitleZh: titleZh, titleZh } : {}),
      ...(wholeSeries && !current.doubanId ? { doubanId: seasonSubject.id } : {}),
      ...((!current.doubanOverviewZh || season === 1) && seasonSubject.overviewZh ? { doubanOverviewZh: seasonSubject.overviewZh } : {}),
      ...(!current.doubanTags.length && seasonSubject.tagsZh?.length ? { doubanTags: seasonSubject.tagsZh } : {}),
      ...(imdbId ? { imdbId } : {})
    });
    store.applyManualFields(work.id);
    if (imdbId && store.work(work.id)?.imdbId && !work.tmdbId) store.queueTask('tmdb', work.id);
    if (seasonSubject.rating !== null) {
      store.setRating(work.id, 'douban', wholeSeries ? null : season, seasonSubject.rating, seasonSubject.votes, seasonSubject.id);
      notes.push(`第 ${season} 季 ${seasonSubject.rating.toFixed(1)} 分`);
    }
    found++;
  }
  if (!found) throw new Error('豆瓣没有找到可靠匹配的剧集或分季条目');
  return notes.join('；');
}

async function runTasks(initialSource: 'tmdb' | 'omdb' | null): Promise<void> {
  let metadataSource = initialSource;
  const attempted = new Set<number>();
  const failures = new Map<string, number>();
  const unavailable = new Set<string>();
  while (true) {
    const task = store.pendingTasks().find(item => !attempted.has(item.id));
    if (!task) break;
    attempted.add(task.id);
    // Keep English metadata pending when its providers are unavailable, but
    // continue to independent Douban tasks in the same scan.
    if (task.type === 'tmdb' && !metadataSource) continue;
    if (task.type === 'tmdb' && unavailable.has(metadataSource!)) continue;
    if (task.type === 'imdb' && unavailable.has('omdb')) continue;
    if (task.type === 'douban' && process.env.FILM_LIBRARY_SMOKE === '1') continue;
    if (task.type === 'douban' && (unavailable.has('douban') || douban.isBlocked())) {
      progress({ message: douban.blockedMessage() || '豆瓣暂不可用，其他资料源继续抓取' });
      continue;
    }
    job.total++;
    const work = store.work(task.workId);
    if (!work) { store.taskDone(task.id); job.done++; continue; }
    store.taskRunning(task.id);
    changed();
    progress({ phase: `正在获取《${work.titleZh || work.titleEn}》资料`, done: job.done });
    let note = '';
    let skipped = false;
    let logSource: 'tmdb' | 'omdb' | undefined;
    try {
      if (task.type === 'tmdb') {
        if (!metadataSource) throw new Error('未配置可用的资料源');
        let targetId = work.id;
        if (metadataSource === 'tmdb') {
          try {
            let tmdbId = work.tmdbId;
            if (!tmdbId && work.imdbId) tmdbId = await metadata.findByImdb(work.mediaType, work.imdbId);
            if (!tmdbId) {
              const candidates = await metadata.search(work.mediaType, work.titleZh || work.titleEn, lookupYear(work));
              tmdbId = metadata.chooseExact(work.titleZh || work.titleEn, lookupYear(work), candidates)?.id ?? null;
            }
            if (!tmdbId) throw new Error('TMDB 未能可靠匹配');
            const existing = store.findWorkByTmdb(work.mediaType, tmdbId);
            if (existing && existing !== work.id) {
              store.moveAssets(work.id, existing);
              targetId = existing;
            } else note = (await metadata.hydrate(work.id, tmdbId)).join('；');
            logSource = 'tmdb';
          } catch (error) {
            if (!store.getSecret('omdb') || unavailable.has('omdb')) throw error;
            if (networkFailure(error)) metadataSource = 'omdb';
            logSource = 'omdb';
            note = `TMDB 不可用，改用 OMDb；${(await metadata.hydrateOmdb(work.id)).join('；')}`;
          }
        } else {
          logSource = 'omdb';
          note = (await metadata.hydrateOmdb(work.id)).join('；');
        }
        if (logSource === 'omdb') {
          const imdbId = store.work(work.id)?.imdbId;
          const existing = imdbId ? store.findWorkByImdb(work.mediaType, imdbId) : null;
          if (existing && existing !== work.id) { store.moveAssets(work.id, existing); targetId = existing; }
        }
        store.queueTask('douban', targetId);
        if (logSource === 'tmdb') store.queueTask('imdb', targetId);
      } else if (task.type === 'imdb') {
        if (!work.imdbId) { store.taskSkipped(task.id, '未找到 IMDb 条目 ID，等待 TMDB 提供'); skipped = true; }
        else if (!store.getSecret('omdb')) { store.taskSkipped(task.id, '尚未配置 OMDb API Key'); skipped = true; }
        else if (!(await metadata.refreshImdb(work.id))) { store.taskSkipped(task.id, 'OMDb 暂无 IMDb 评分'); skipped = true; }
      } else if (task.type === 'douban') {
        note = await refreshDoubanWork(work);
      }
      if (!skipped) {
        store.taskDone(task.id, undefined, note, logSource);
        const key = `${work.id}:${task.type}`;
        job.failures -= failures.get(key) ?? 0;
        failures.delete(key);
      }
    } catch (error) {
      store.taskDone(task.id, String(error), '', logSource ?? (task.type === 'tmdb' ? metadataSource ?? 'tmdb' : undefined));
      job.failures++;
      const key = `${work.id}:${task.type}`;
      failures.set(key, (failures.get(key) ?? 0) + 1);
      if (networkFailure(error)) {
        unavailable.add(logSource ?? (task.type === 'imdb' ? 'omdb' : task.type));
        progress({ message: String(error).replace(/^Error: /, '') });
      }
      if (task.type === 'douban' && douban.isBlocked()) {
        unavailable.add('douban');
        progress({ message: String(error).replace(/^Error: /, '') });
      }
    }
    job.done++;
    progress({ done: job.done });
    changed();
  }
}

async function refreshTop250(force: boolean): Promise<void> {
  if (process.env.FILM_LIBRARY_SMOKE === '1') return;
  if (!force && store.top250UpdatedAt() && Date.now() - store.top250UpdatedAt()! < 7 * 24 * 3600_000) return;
  if (douban.isBlocked()) return;
  progress({ phase: '正在更新豆瓣 Top250 榜单' });
  try { store.replaceTop250(await douban.top250()); changed(); }
  catch (error) { job.failures++; progress({ message: `Top250 未更新：${String(error)}` }); }
}

async function refreshImdbTop250(force: boolean): Promise<void> {
  if (process.env.FILM_LIBRARY_SMOKE === '1') return;
  const updatedAt = store.imdbTop250UpdatedAt();
  if (!force && !store.getSetting('imdbTop250Failed') && updatedAt && Date.now() - updatedAt < 7 * 24 * 3600_000) return;
  progress({ phase: '正在更新 IMDb Top 250 榜单' });
  try {
    store.replaceImdbTop250(await fetchImdbTop250());
    store.setSetting('imdbTop250Failed', '');
    changed();
  } catch (error) {
    store.setSetting('imdbTop250Failed', '1');
    job.failures++;
    progress({ message: `IMDb Top 250 未更新：${String(error)}` });
  }
}

async function runJob(kind: 'scan' | 'refresh', forceScan = false): Promise<JobState> {
  if (job.running) return job;
  job = freshJob(kind);
  progress({ phase: kind === 'scan' ? '正在检查影视目录' : '正在刷新影片资料' });
  try {
    reconcileSeries(store);
    // Earlier partial successes were marked done. Retry only genuinely missing regular seasons.
    for (const work of store.listWorks()) {
      if (work.mediaType !== 'tv') continue;
      const seasons = [...new Set(work.assets.map(asset => asset.season).filter((value): value is number => value !== null && value > 0))];
      const wholeSeries = seasons.length === 1 && work.ratingSeason === null && work.ratingDouban !== null;
      if (!wholeSeries && seasons.some(season => !work.seasonRatings.some(rating => rating.source === 'douban' && rating.season === season)))
        store.queueTask('douban', work.id);
    }
    if (kind === 'scan') {
      for (const root of store.roots()) {
        const seen = Date.now();
        try {
          if (!(await fs.promises.stat(root)).isDirectory()) throw new Error('不是目录');
          for await (const media of discover(root)) {
            const existing = store.findAsset(media.path);
            if (Date.now() - media.mtimeMs < 30_000) {
              if (existing) store.putAsset({ workId: existing.workId, root, path: media.path, kind: media.kind,
                season: existing.season, episode: existing.episode, size: existing.size, mtimeMs: existing.mtimeMs }, seen);
              progress({ message: '有资源仍在写入；请稍后再次点击“更新库”' });
              continue;
            }
            if (existing && !forceScan && existing.size === media.size && existing.mtimeMs === media.mtimeMs) {
              store.putAsset({ workId: existing.workId, root, path: media.path, kind: media.kind,
                season: existing.season, episode: existing.episode, size: media.size, mtimeMs: media.mtimeMs }, seen);
            } else await processMedia(media, seen, forceScan);
            job.done++;
            if (job.done % 5 === 0) progress({ done: job.done });
          }
          store.markRootMissing(root, seen);
          changed();
        } catch (error) {
          job.failures++;
          progress({ message: `无法完整扫描 ${root}：${String(error)}。原有条目已保留。` });
        }
      }
    } else {
      for (const work of store.listWorks()) {
        store.queueTask('tmdb', work.id);
        store.queueTask('douban', work.id);
      }
    }
    store.retryFailed();
    const needsMetadata = store.pendingTasks().some(task => task.type === 'tmdb');
    let metadataSource: 'tmdb' | 'omdb' | null = null;
    if (needsMetadata) {
      let tmdbError = '';
      if (store.getSecret('tmdb')) {
        try { await metadata.checkTmdb(); metadataSource = 'tmdb'; }
        catch (error) { tmdbError = String(error).replace(/^Error: /, ''); }
      }
      if (!metadataSource && store.getSecret('omdb')) {
        try {
          await metadata.checkOmdb();
          metadataSource = 'omdb';
          progress({ message: tmdbError ? 'TMDB 暂不可达，已自动改用 OMDb 抓取资料' : '正在使用 OMDb 抓取资料' });
        } catch (error) { tmdbError = `TMDB：${tmdbError || '未配置'}；OMDb：${String(error).replace(/^Error: /, '')}`; }
      }
      if (!metadataSource) {
        const message = tmdbError || '请在设置中配置 TMDB 或 OMDb 凭据';
        const first = store.pendingTasks().find(task => task.type === 'tmdb');
        if (first) store.taskDone(first.id, message);
        job.failures++;
        progress({ message: `英文资料源暂不可用：${message}；豆瓣中文资料继续抓取` });
        changed();
      }
    }
    await runTasks(metadataSource);
    await refreshTop250(kind === 'refresh');
    await refreshImdbTop250(kind === 'refresh');
  } finally {
    progress({ running: false, phase: '已完成', message: job.message || '更新完成' });
    changed();
  }
  return job;
}

async function refreshWorkMetadata(workId: number, source: MetadataSource): Promise<JobState> {
  if (job.running) throw new Error('正在更新资料库，请等待当前任务结束');
  if (!['omdb', 'tmdb', 'douban'].includes(source)) throw new Error('未知资料源');
  const work = store.work(workId);
  if (!work || work.matchState === 'ignored') throw new Error('影片不存在');
  const label = { omdb: 'OMDb', tmdb: 'TMDB', douban: '豆瓣' }[source];
  job = freshJob('refresh');
  progress({ phase: `正在从 ${label} 重新抓取《${work.titleEn || work.titleZh}》`, total: 1 });
  try {
    let note = '';
    if (source === 'omdb') {
      note = (await metadata.hydrateOmdb(workId)).join('；');
    } else if (source === 'tmdb') {
      let tmdbId = work.tmdbId;
      if (!tmdbId && work.imdbId) tmdbId = await metadata.findByImdb(work.mediaType, work.imdbId);
      if (!tmdbId) {
        const title = work.titleEn || work.titleZh || work.originalTitle;
        tmdbId = metadata.chooseExact(title, lookupYear(work), await metadata.search(work.mediaType, title, lookupYear(work)))?.id ?? null;
      }
      if (!tmdbId) throw new Error('TMDB 未能可靠匹配该影片；可在详情页编辑资料来源');
      const existing = store.findWorkByTmdb(work.mediaType, tmdbId);
      if (existing && existing !== workId) throw new Error('该 TMDB 条目已关联另一部影片；请在详情页确认匹配');
      note = (await metadata.hydrate(workId, tmdbId)).join('；');
    } else {
      if (douban.isBlocked()) throw new Error(douban.blockedMessage());
      note = await refreshDoubanWork(work);
    }
    store.recordSourceRefresh(workId, source, undefined, note);
    progress({ done: 1, message: `${label} 已更新《${store.work(workId)?.titleEn || work.titleZh}》` });
    changed();
  } catch (error) {
    const message = String(error).replace(/^Error: /, '');
    store.recordSourceRefresh(workId, source, message);
    progress({ done: 1, failures: 1, message: `${label} 抓取失败：${message}` });
    changed();
    throw error;
  } finally {
    progress({ running: false, phase: '已完成' });
  }
  return job;
}

function registerIpc(): void {
  ipcMain.handle('listWorks', () => store.listWorks());
  ipcMain.handle('getSettings', () => settings());
  ipcMain.handle('getJob', () => job);
  ipcMain.handle('listScrapeLogs', () => store.listScrapeLogs());
  ipcMain.handle('testSources', (_event, patch?: { proxyUrl?: string; tmdbKey?: string; omdbKey?: string }): Promise<ConnectionChecks> => metadata.testSources(patch));
  ipcMain.handle('setFavorite', (_event, workId: number, favorite: boolean) => {
    store.setFavorite(workId, favorite);
    changed();
  });
  ipcMain.handle('setSettings', async (_event, patch: Partial<PosterWallSettings & AppearanceSettings> & { language?: 'zh' | 'en'; roots?: string[]; playerPath?: string; proxyUrl?: string; backgroundBlur?: number; tmdbKey?: string; omdbKey?: string }) => {
    for (const { key, min, max } of [...posterWallControls, ...appearanceControls]) {
      const value = patch[key];
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
        throw new Error(`Overview 海报墙参数 ${key} 应为 ${min} 到 ${max} 之间的整数`);
    }
    if (patch.language !== undefined && patch.language !== 'zh' && patch.language !== 'en') throw new Error('Invalid interface language');
    if (patch.backgroundBlur !== undefined && (!Number.isInteger(patch.backgroundBlur) || patch.backgroundBlur < 0 || patch.backgroundBlur > 50))
      throw new Error('背景模糊程度应在 0 到 50 之间');
    if (patch.proxyUrl !== undefined) await metadata.setProxy(patch.proxyUrl);
    if (patch.roots) {
      const unique = new Map<string, string>();
      for (const root of patch.roots) {
        if (typeof root !== 'string' || !root.trim()) continue;
        const resolved = path.resolve(root.trim());
        unique.set(process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved, resolved);
      }
      const roots: string[] = [];
      for (const candidate of [...unique.values()].sort((a, b) => a.length - b.length)) {
        if (!roots.some(parent => {
          const relative = path.relative(parent, candidate);
          return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
        })) roots.push(candidate);
      }
      for (const old of store.roots().filter(root => !roots.includes(root))) store.deactivateRoot(old);
      store.setRoots(roots);
    }
    if (patch.playerPath !== undefined) store.setSetting('playerPath', patch.playerPath);
    if (patch.proxyUrl !== undefined) store.setSetting('proxyUrl', patch.proxyUrl.trim());
    for (const { key } of [...posterWallControls, ...appearanceControls]) if (patch[key] !== undefined) store.setSetting(key, String(patch[key]));
    if (patch.backgroundBlur !== undefined) store.setSetting('backgroundBlur', String(patch.backgroundBlur));
    if (patch.language !== undefined) store.setSetting('language', patch.language);
    if (patch.tmdbKey) store.setSecret('tmdb', patch.tmdbKey);
    if (patch.omdbKey) store.setSecret('omdb', patch.omdbKey);
    changed();
    return settings();
  });
  ipcMain.handle('chooseFolders', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('choosePlayer', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      ...(process.platform === 'darwin' ? { defaultPath: '/Applications', filters: [{ name: 'Applications', extensions: ['app'] }] }
        : process.platform === 'win32' ? { filters: [{ name: 'Applications', extensions: ['exe'] }] } : {}),
      properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('updateLibrary', () => runJob('scan'));
  ipcMain.handle('rescanLibrary', () => runJob('scan', true));
  ipcMain.handle('refreshMetadata', () => runJob('refresh'));
  ipcMain.handle('refreshWorkMetadata', (_event, workId: number, source: MetadataSource) => refreshWorkMetadata(workId, source));
  ipcMain.handle('openWorkLocation', (_event, workId: number) => {
    const work = store.work(workId);
    if (!work || work.matchState === 'ignored') throw new Error('影片不存在');
    const asset = work.assets.find(item => item.active && item.available);
    if (!asset) throw new Error('资源当前离线，无法在资源管理器中定位');
    shell.showItemInFolder(asset.path);
  });
  ipcMain.handle('openShooterSubtitles', async (_event, workId: number) => {
    const work = store.work(workId);
    if (!work || work.matchState === 'ignored') throw new Error('影片不存在');
    await shell.openExternal(shooterSubtitleUrl(work));
  });
  ipcMain.handle('retryFailed', () => runJob('scan'));
  ipcMain.handle('searchMatch', (_event, workId: number, query: string): Promise<MatchCandidate[]> => {
    const work = store.work(workId);
    return work ? metadata.search(work.mediaType, query, work.year) : Promise.resolve([]);
  });
  ipcMain.handle('setMatch', async (_event, workId: number, tmdbId: number) => {
    const work = store.work(workId);
    if (!work) throw new Error('影片不存在');
    const existing = store.findWorkByTmdb(work.mediaType, tmdbId);
    if (existing && existing !== workId) store.moveAssets(workId, existing);
    else { store.setWorkFields(workId, { matchState: 'manual' }); await metadata.hydrate(workId, tmdbId); }
    store.queueTask('douban', existing ?? workId);
    store.queueTask('imdb', existing ?? workId);
    changed();
  });
  ipcMain.handle('saveWorkEdit', async (_event, workId: number, input: WorkEdit): Promise<number> => {
    const work = store.work(workId);
    if (!work) throw new Error('影片不存在');
    const titleZh = String(input.titleZh ?? '').trim().slice(0, 300);
    const titleEn = String(input.titleEn ?? '').trim().slice(0, 300);
    const overview = String(input.overview ?? '').trim().slice(0, 10_000);
    if (!titleZh && !titleEn) throw new Error('请至少保留一个片名');
    const year = input.year === null ? null : Number(input.year);
    if (year !== null && (!Number.isInteger(year) || year < 1888 || year > new Date().getFullYear() + 2)) throw new Error('年份不正确');
    const tmdbId = input.tmdbId === null ? null : Number(input.tmdbId);
    if (tmdbId !== null && (!Number.isSafeInteger(tmdbId) || tmdbId <= 0)) throw new Error('TMDB ID 不正确');
    const imdbId = String(input.imdbId ?? '').trim() || null;
    const doubanId = String(input.doubanId ?? '').trim() || null;
    if (imdbId && !/^tt\d{7,10}$/.test(imdbId)) throw new Error('IMDb ID 应形如 tt1234567');
    if (doubanId && !/^\d{4,12}$/.test(doubanId)) throw new Error('豆瓣 ID 应为条目网址中的数字');
    let targetId = workId;
    if (tmdbId && tmdbId !== work.tmdbId) {
      const existing = store.findWorkByTmdb(work.mediaType, tmdbId);
      if (existing && existing !== workId) { store.moveAssets(workId, existing); targetId = existing; }
      else {
        await metadata.hydrate(workId, tmdbId, false);
        store.clearManualFields(workId);
        store.clearRatings(workId);
        store.clearDoubanFields(workId);
      }
    } else if (tmdbId === null && work.tmdbId !== null) store.setWorkFields(workId, { tmdbId: null });
    if (doubanId !== work.doubanId) { store.clearDoubanFields(targetId); store.clearDoubanRating(targetId); }
    const edits: Partial<Pick<Work, 'titleZh' | 'titleEn' | 'year' | 'overview' | 'imdbId' | 'doubanId'>> = {};
    if (titleZh !== work.titleZh) edits.titleZh = titleZh;
    if (titleEn !== work.titleEn) edits.titleEn = titleEn;
    if (year !== work.year) edits.year = year;
    if (overview !== work.overview) edits.overview = overview;
    if (imdbId !== work.imdbId) edits.imdbId = imdbId;
    if (doubanId !== work.doubanId) edits.doubanId = doubanId;
    if (Object.keys(edits).length) store.setManualFields(targetId, edits);
    store.setWorkFields(targetId, { matchState: 'manual' });
    store.syncTopRank(targetId);
    if (store.work(targetId)?.imdbId) store.queueTask('imdb', targetId);
    store.queueTask('douban', targetId);
    changed();
    if (!job.running) void runJob('scan').catch(error => progress({ running: false, message: String(error) }));
    return targetId;
  });
  ipcMain.handle('ignoreWork', (_event, workId: number) => { store.ignoreWork(workId); changed(); });
  ipcMain.handle('listIgnored', () => store.ignoredWorks());
  ipcMain.handle('restoreWork', (_event, workId: number) => {
    store.restoreWork(workId);
    if (!store.work(workId)?.tmdbId) store.queueTask('tmdb', workId);
    changed();
  });
  ipcMain.handle('openHelp', (_event, source: 'tmdb' | 'omdb' | 'douban') => {
    const links = { tmdb: 'https://www.themoviedb.org/settings/api', omdb: 'https://www.omdbapi.com/apikey.aspx',
      douban: 'https://movie.douban.com/' };
    if (!(source in links)) throw new Error('未知的帮助来源');
    return shell.openExternal(links[source]);
  });
  ipcMain.handle('toggleFullscreen', () => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    return mainWindow.isFullScreen();
  });
  ipcMain.handle('isFullscreen', () => mainWindow?.isFullScreen() ?? false);
  ipcMain.handle('doubanLogin', async () => { await douban.login(); store.setSetting('doubanStatus', '会话窗口已打开'); changed(); });
  ipcMain.handle('doubanLogout', async () => { await douban.logout(); store.setSetting('doubanStatus', '已退出'); changed(); });
  ipcMain.handle('imdbVerify', () => openImdbVerification());
  ipcMain.handle('play', async (_event, assetId: number) => {
    const asset = store.asset(assetId);
    if (!asset?.active || !asset.available) throw new Error('媒体文件不存在或硬盘未连接');
    const player = settings().playerPath;
    const target = asset.kind === 'bdmv'
      ? path.join(asset.path, fs.readdirSync(asset.path).find(name => name.toLowerCase() === 'bdmv') ?? 'BDMV') : asset.path;
    const command = playerCommand(process.platform, player, target);
    if (!command) {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
      return;
    }
    if (!player || !fs.existsSync(player)) throw new Error('请先在设置中选择可用的播放器');
    const child = spawn(command.executable, command.args, { detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
    child.unref();
  });
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1380, height: 900, minWidth: 720, minHeight: 540, backgroundColor: '#080b12',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 14 } } : {}),
    title: 'Movie Glacier', show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(moduleDir, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: false }
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('enter-full-screen', () => notify('fullscreen', true));
  mainWindow.on('leave-full-screen', () => notify('fullscreen', false));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { event.preventDefault(); mainWindow?.setFullScreen(!mainWindow.isFullScreen()); }
    if (input.type === 'keyDown' && input.key === 'Escape' && mainWindow?.isFullScreen()) {
      event.preventDefault(); mainWindow.setFullScreen(false);
    }
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl);
  else await mainWindow.loadURL('filmapp://app/index.html');
  mainWindow.on('closed', () => {
    mainWindow = null;
    // Windows exits with its library window, even if a scraper is hidden.
    // macOS keeps its menu and Dock icon alive until the user chooses Quit.
    if (process.platform !== 'darwin') app.quit();
  });
}

if (process.env.FILM_LIBRARY_SMOKE === '1') app.disableHardwareAcceleration();
const testing = process.env.FILM_LIBRARY_SMOKE === '1' || process.env.FILM_LIBRARY_TEST_ONBOARDING === '1';
const dataDirectory = testing && process.env.FILM_LIBRARY_DATA_DIR && path.isAbsolute(process.env.FILM_LIBRARY_DATA_DIR)
  ? process.env.FILM_LIBRARY_DATA_DIR
  : applicationDataDirectory(process.platform, app.isPackaged, app.getAppPath(), app.getPath('exe'), app.getPath('appData'));
try {
  prepareDataDirectory(dataDirectory, testing || !app.isPackaged ? [] : [
    app.getPath('userData'), path.join(app.getPath('appData'), 'movie-glacier'), path.join(app.getPath('appData'), '私人影视库'),
    ...(process.platform === 'darwin' ? [path.join(path.dirname(app.getPath('exe')), 'user-data')] : [])
  ]);
  app.setPath('userData', dataDirectory);
  app.setPath('sessionData', dataDirectory);
  app.setAppLogsPath(path.join(dataDirectory, 'logs'));
  app.setPath('crashDumps', path.join(dataDirectory, 'Crashpad'));
} catch (error) {
  dialog.showErrorBox('Movie Glacier', `无法准备或迁移用户数据，请先关闭旧版软件，并确认数据目录可写。\nClose any older Movie Glacier instance and make sure the data folder is writable, then try again.\n\n${dataDirectory}\n${String(error)}`);
  app.exit(1);
}

app.whenReady().then(async () => {
  const menuAction = (action: string) => async () => {
    if (!mainWindow) await createWindow();
    mainWindow?.show(); mainWindow?.focus(); notify('menuAction', action);
  };
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: 'Movie Glacier', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: menuAction('settings') },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }
    ] },
    { role: 'fileMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Search Library', accelerator: 'CmdOrCtrl+f', click: menuAction('search') },
      { label: 'Back to Library', accelerator: 'CmdOrCtrl+[', click: menuAction('back') },
      { type: 'separator' },
      { label: 'Movies', accelerator: 'CmdOrCtrl+1', click: menuAction('movie') },
      { label: 'Series', accelerator: 'CmdOrCtrl+2', click: menuAction('tv') },
      { label: 'Overview', accelerator: 'CmdOrCtrl+3', click: menuAction('overview') },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ] }, { role: 'windowMenu' }
  ]) : null);
  const userData = app.getPath('userData');
  const imageDir = cacheImageDir(userData);
  const distDir = path.resolve(moduleDir, '../../dist');
  const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
  protocol.handle('filmapp', async request => {
    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(distDir, pathname);
    if (url.hostname !== 'app' || !file.startsWith(`${distDir}${path.sep}`) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return new Response(await fs.promises.readFile(file), { headers: { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' } });
  });
  protocol.handle('library', request => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (url.hostname !== 'image' || !/^[a-f0-9]{40}\.(jpg|png|webp)$/.test(name)) return new Response('Not found', { status: 404 });
    const file = path.join(imageDir, name);
    return fs.existsSync(file) ? new Response(fs.readFileSync(file), { headers: { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream' } }) : new Response('Not found', { status: 404 });
  });
  const wasm = app.isPackaged ? path.join(process.resourcesPath, 'sql-wasm.wasm') : path.join(moduleDir, '../sql-wasm.wasm');
  store = await Store.open(path.join(userData, 'library.sqlite'), wasm, safeStorage);
  metadata = new Metadata(store, userData);
  await metadata.setProxy(store.getSetting('proxyUrl'));
  douban = new Douban();
  registerIpc();
  await createWindow();
}).catch(error => { console.error('影视库启动失败', error); dialog.showErrorBox('影视库启动失败', String(error)); });

app.on('activate', () => { if (!mainWindow && store) void createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => store?.close());
