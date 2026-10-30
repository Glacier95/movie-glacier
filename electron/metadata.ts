import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { session, type Session } from 'electron';
import type { ConnectionChecks, MatchCandidate, MediaType, Person, Work } from '../src/shared.js';
import { titleQueries } from './media-titles.js';
import { tmdbScore, chooseTmdbCandidate } from './tmdb-match.js';
import { searchOmdbCandidate, lookupYear, omdbChineseTitle, omdbPeople, omdbYear,
  safeOmdbPoster, checkOmdbYear, type OmdbCandidate } from './omdb.js';
import { Store } from './store.js';

interface TmdbResult {
  id: number; title?: string; name?: string; original_title?: string; original_name?: string;
  release_date?: string; first_air_date?: string; poster_path?: string;
}

export function proxyRules(value: string): string {
  if (!value.trim()) return '';
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('代理地址应形如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080'); }
  const port = Number(url.port);
  if (!['http:', 'socks5:'].includes(url.protocol) || !url.hostname || !Number.isInteger(port) || port < 1 || port > 65535 ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('代理地址应形如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080，暂不支持账号密码');
  }
  return `${url.protocol}//${url.hostname}:${port}`;
}

async function configureProxy(network: Session, value: string): Promise<void> {
  const rules = proxyRules(value);
  await network.setProxy(rules ? { mode: 'fixed_servers', proxyRules: rules } : { mode: 'system' });
  await network.closeAllConnections();
}

async function request(network: Session, url: string, label: string, headers: Record<string, string> = {}): Promise<Response> {
  let response: Response;
  try { response = await network.fetch(url, { headers, signal: AbortSignal.timeout(15_000) }); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} 网络连接失败（${detail}）。请检查网络，或在设置中填写可用的 HTTP/SOCKS5 代理并测试连接`);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      let reason = '';
      try {
        const body = await response.json() as { Error?: string; status_message?: string };
        reason = String(body.Error ?? body.status_message ?? '').slice(0, 120);
      } catch { /* Some API errors have no JSON body. */ }
      throw new Error(`${label} 凭据被拒绝（HTTP ${response.status}）${reason ? `：${reason}` : ''}`);
    }
    throw new Error(`${label} 返回 HTTP ${response.status}`);
  }
  return response;
}

async function json(network: Session, url: string, label: string, headers: Record<string, string> = {}): Promise<any> {
  return (await request(network, url, label, headers)).json();
}

export function cacheImageDir(userData: string): string {
  const dir = path.join(userData, 'images');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cacheLocalImage(source: string, userData: string): string | null {
  try {
    const extension = path.extname(source).toLowerCase().replace('.jpeg', '.jpg');
    if (!['.jpg', '.png', '.webp'].includes(extension)) return null;
    const name = `${crypto.createHash('sha1').update(source).digest('hex')}${extension}`;
    const target = path.join(cacheImageDir(userData), name);
    if (!fs.existsSync(target)) fs.copyFileSync(source, target);
    return name;
  } catch { return null; }
}

async function cacheRemoteImage(imagePath: string | null | undefined, userData: string, network: Session): Promise<string | null> {
  if (!imagePath) return null;
  const name = `${crypto.createHash('sha1').update(imagePath).digest('hex')}.jpg`;
  const target = path.join(cacheImageDir(userData), name);
  if (fs.existsSync(target)) return name;
  const response = await request(network, `https://image.tmdb.org/t/p/w780${imagePath}`, 'TMDB 海报');
  fs.writeFileSync(`${target}.tmp`, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(`${target}.tmp`, target);
  return name;
}

async function cachePosterUrl(url: string | null, userData: string, network: Session): Promise<string | null> {
  if (!url) return null;
  const name = `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`;
  const target = path.join(cacheImageDir(userData), name);
  if (fs.existsSync(target)) return name;
  let response: Response;
  try { response = await request(network, url, 'OMDb 海报'); }
  catch (error) {
    if (!/网络连接失败|HTTP (429|50[0-9])/.test(String(error))) throw error;
    await new Promise(resolve => setTimeout(resolve, 350));
    response = await request(network, url, 'OMDb 海报');
  }
  if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error('OMDb 海报返回的不是图片');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 10_000_000) throw new Error('OMDb 海报过大');
  fs.writeFileSync(`${target}.tmp`, data);
  fs.renameSync(`${target}.tmp`, target);
  return name;
}

export class Metadata {
  private readonly network = session.fromPartition('persist:metadata');
  private tmdbFailure: { until: number; message: string } | null = null;
  constructor(private store: Store, private userData: string) {}

  async setProxy(value: string): Promise<void> { this.tmdbFailure = null; await configureProxy(this.network, value); }

  async testSources(patch: { proxyUrl?: string; tmdbKey?: string; omdbKey?: string } = {}): Promise<ConnectionChecks> {
    const network = session.fromPartition('metadata-connection-check');
    await configureProxy(network, patch.proxyUrl ?? this.store.getSetting('proxyUrl'));
    const tmdbKey = patch.tmdbKey?.trim() || this.store.getSecret('tmdb');
    const omdbKey = patch.omdbKey?.trim() || this.store.getSecret('omdb');
    const tmdb = (async () => {
      if (!tmdbKey) return { ok: false, message: '尚未填写 TMDB 读取令牌' };
      try {
        await json(network, 'https://api.themoviedb.org/3/configuration', 'TMDB', { Authorization: `Bearer ${tmdbKey}` });
        return { ok: true, message: '连接成功，读取令牌有效' };
      } catch (error) { return { ok: false, message: String(error).replace(/^Error: /, '') }; }
    })();
    const omdb = (async () => {
      if (!omdbKey) return { ok: false, message: '尚未填写 OMDb API Key' };
      try {
        const url = new URL('https://www.omdbapi.com/');
        url.searchParams.set('apikey', omdbKey);
        url.searchParams.set('i', 'tt0069293');
        const data = await json(network, url.toString(), 'OMDb');
        if (data.Response === 'False') throw new Error(`OMDb：${data.Error ?? '凭据无效'}`);
        return { ok: true, message: '连接成功，API Key 有效' };
      } catch (error) { return { ok: false, message: String(error).replace(/^Error: /, '') }; }
    })();
    return { tmdb: await tmdb, omdb: await omdb };
  }

  async checkTmdb(): Promise<void> {
    if (this.tmdbFailure && Date.now() < this.tmdbFailure.until) throw new Error(this.tmdbFailure.message);
    try { await this.tmdb('configuration'); this.tmdbFailure = null; }
    catch (error) {
      const message = String(error).replace(/^Error: /, '');
      if (/网络连接失败|timeout|超时|net::ERR_/.test(message)) this.tmdbFailure = { until: Date.now() + 15 * 60_000, message };
      throw error;
    }
  }

  async checkOmdb(): Promise<void> {
    const data = await this.omdb({ i: 'tt0069293' });
    if (data.Response === 'False') throw new Error(`OMDb：${data.Error ?? '凭据无效'}`);
  }

  private async omdb(params: Record<string, string>): Promise<any> {
    const key = this.store.getSecret('omdb');
    if (!key) throw new Error('请先在设置中填写 OMDb API Key');
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', key);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return json(this.network, url.toString(), 'OMDb');
  }

  private async omdbCandidate(work: Work): Promise<OmdbCandidate | null> {
    return searchOmdbCandidate(work, params => this.omdb(params));
  }

  async hydrateOmdb(workId: number, applyManualEdits = true): Promise<string[]> {
    const work = this.store.work(workId);
    if (!work) throw new Error('影片已不在资料库中');
    const candidate = work.imdbId ? null : await this.omdbCandidate(work);
    const imdbId = work.imdbId ?? candidate?.imdbID;
    if (!imdbId) throw new Error('OMDb 未能可靠匹配片名和年份，已保留原条目供编辑确认');
    const data = await this.omdb({ i: imdbId, plot: 'full' });
    if (data.Response === 'False') throw new Error(`OMDb：${data.Error ?? '无结果'}`);
    if (data.Type !== (work.mediaType === 'movie' ? 'movie' : 'series')) throw new Error('OMDb 条目类型与本地资源不符');
    const expectedYear = lookupYear(work);
    const matchedYear = omdbYear(data.Year);
    const warnings = checkOmdbYear(work, matchedYear);
    const poster = await cachePosterUrl(safeOmdbPoster(data.Poster), this.userData, this.network).catch(error => {
      warnings.push(`海报未下载：${String(error).replace(/^Error: /, '')}`);
      return work.poster;
    });
    const title = String(data.Title ?? '').trim();
    if (!title) throw new Error('OMDb 条目缺少片名');
    const writers = omdbPeople(data.Writer);
    const rating = Number(data.imdbRating);
    this.store.setWorkFields(workId, {
      imdbId, titleZh: omdbChineseTitle(work, title), titleEn: title, originalTitle: title,
      year: expectedYear ?? matchedYear,
      overview: data.Plot && data.Plot !== 'N/A' ? data.Plot : work.overview,
      runtime: Number(/^\d+/.exec(String(data.Runtime ?? ''))?.[0]) || work.runtime,
      poster: poster ?? work.poster, backdrop: work.backdrop,
      genres: data.Genre && data.Genre !== 'N/A' ? String(data.Genre).split(',').map((item: string) => item.trim()) : work.genres,
      countries: data.Country && data.Country !== 'N/A' ? String(data.Country).split(',').map((item: string) => item.trim()) : work.countries,
      directors: omdbPeople(data.Director), writers,
      creators: work.mediaType === 'tv' ? writers : work.creators,
      actors: omdbPeople(data.Actors), updatedAt: Date.now(),
      matchState: work.matchState === 'manual' ? 'manual' : 'matched'
    });
    if (Number.isFinite(rating) && rating >= 0)
      this.store.setRating(workId, 'imdb', null, rating, Number(String(data.imdbVotes ?? '').replace(/,/g, '')) || null, imdbId);
    this.store.applyDoubanTitle(workId);
    if (applyManualEdits) this.store.applyManualFields(workId);
    return warnings;
  }

  private tmdbHeaders(): Record<string, string> {
    const key = this.store.getSecret('tmdb');
    if (!key) throw new Error('请先在设置中填写 TMDB 凭据');
    return { Authorization: `Bearer ${key}` };
  }
  private async tmdb(resource: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(`https://api.themoviedb.org/3/${resource}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return json(this.network, url.toString(), 'TMDB', this.tmdbHeaders());
  }

  async search(type: MediaType, title: string, year: number | null): Promise<MatchCandidate[]> {
    const queries = titleQueries(title);
    const results = new Map<number, MatchCandidate>();
    for (const query of queries) {
      const data = await this.tmdb(`search/${type}`, { query, language: 'zh-CN' });
      for (const item of (data.results ?? []).slice(0, 12) as TmdbResult[]) {
        results.set(item.id, {
          id: item.id, title: item.title ?? item.name ?? '', originalTitle: item.original_title ?? item.original_name ?? '',
          year: Number((item.release_date ?? item.first_air_date ?? '').slice(0, 4)) || null,
          posterPath: item.poster_path ?? null
        });
      }
      if (chooseTmdbCandidate(title, year, [...results.values()])) break;
    }
    return [...results.values()].sort((a, b) => this.score(title, year, b) - this.score(title, year, a));
  }

  private score(title: string, year: number | null, candidate: MatchCandidate): number {
    return tmdbScore(title, year, candidate);
  }

  chooseExact(title: string, year: number | null, results: MatchCandidate[]): MatchCandidate | null {
    return chooseTmdbCandidate(title, year, results);
  }

  async findByImdb(type: MediaType, imdbId: string): Promise<number | null> {
    const data = await this.tmdb(`find/${imdbId}`, { external_source: 'imdb_id' });
    return Number((type === 'movie' ? data.movie_results : data.tv_results)?.[0]?.id) || null;
  }

  private async people(crew: any[], jobs: Set<string>): Promise<Person[]> {
    const unique = new Map<string, Person>();
    for (const member of crew.filter(item => jobs.has(item.job) || (item.jobs ?? []).some((job: any) => jobs.has(job.job)))) {
      const id = String(member.id ?? member.name);
      if (!unique.has(id)) unique.set(id, { id, name: member.name ?? '' });
    }
    return [...unique.values()];
  }

  private async enrichPeople(people: Person[]): Promise<Person[]> {
    const output: Person[] = [];
    for (let start = 0; start < people.length; start += 4) {
      const batch = people.slice(start, start + 4);
      output.push(...await Promise.all(batch.map(async person => {
        const cached = this.store.personAlias(person.id);
        if (cached) return cached;
        if (/[\u3400-\u9fff]/.test(person.name) && person.originalName && /[A-Za-z]/.test(person.originalName)) {
          this.store.setPersonAlias(person);
          return person;
        }
        try {
          const data = await this.tmdb(`person/${person.id}`);
          const aliases: string[] = data.also_known_as ?? [];
          const chinese = [data.name, person.name, ...aliases].find(name => /[\u3400-\u9fff]/.test(name));
          const english = [person.originalName, person.name, data.name, ...aliases]
            .find(name => name && /[A-Za-z]/.test(name) && !/[\u3400-\u9fff]/.test(name));
          const primary = chinese ?? person.name;
          const alternate = english && english !== primary ? english : undefined;
          const searchableAliases = [...new Set([person.name, person.originalName, data.name, ...aliases]
            .filter((name): name is string => typeof name === 'string' && Boolean(name.trim())))]
            .filter(name => name !== primary && name !== alternate).slice(0, 50);
          const enriched: Person = { id: person.id, name: primary, ...(alternate ? { originalName: alternate } : {}),
            ...(searchableAliases.length ? { aliases: searchableAliases } : {}) };
          this.store.setPersonAlias(enriched);
          return enriched;
        } catch { return person; }
      })));
    }
    return output;
  }

  async hydrate(workId: number, tmdbId: number, applyManualEdits = true): Promise<string[]> {
    const work = this.store.work(workId);
    if (!work) throw new Error('影片已不在资料库中');
    const resource = work.mediaType === 'movie' ? 'movie' : 'tv';
    const [zh, en, credits, external] = await Promise.all([
      this.tmdb(`${resource}/${tmdbId}`, { language: 'zh-CN' }),
      this.tmdb(`${resource}/${tmdbId}`, { language: 'en-US' }),
      this.tmdb(`${resource}/${tmdbId}/${resource === 'movie' ? 'credits' : 'aggregate_credits'}`),
      this.tmdb(`${resource}/${tmdbId}/external_ids`)
    ]);
    const directors = await this.enrichPeople(await this.people(credits.crew ?? [], new Set(['Director'])));
    const writers = await this.people(credits.crew ?? [], new Set(['Writer', 'Screenplay', 'Story']));
    const actors = await this.enrichPeople((credits.cast ?? []).slice(0, 24).map((actor: any) => ({
      id: String(actor.id), name: actor.name, ...(actor.original_name && actor.original_name !== actor.name ? { originalName: actor.original_name } : {})
    })));
    const creators: Person[] = (zh.created_by ?? []).map((creator: any) => ({ id: String(creator.id), name: creator.name }));
    const warnings: string[] = [];
    const poster = await cacheRemoteImage(zh.poster_path ?? en.poster_path, this.userData, this.network).catch(error => {
      warnings.push(`海报未下载：${String(error).replace(/^Error: /, '')}`);
      return work.poster;
    });
    const backdrop = await cacheRemoteImage(zh.backdrop_path ?? en.backdrop_path, this.userData, this.network).catch(error => {
      warnings.push(`横幅未下载：${String(error).replace(/^Error: /, '')}`);
      return work.backdrop;
    });
    this.store.setWorkFields(workId, {
      tmdbId, imdbId: external.imdb_id ?? work.imdbId,
      titleZh: zh.title ?? zh.name ?? work.titleZh,
      titleEn: en.title ?? en.name ?? work.titleEn,
      originalTitle: en.original_title ?? en.original_name ?? work.originalTitle,
      year: Number((zh.release_date ?? zh.first_air_date ?? '').slice(0, 4)) || work.year,
      overview: en.overview || work.overview,
      runtime: zh.runtime ?? zh.episode_run_time?.[0] ?? null,
      poster, backdrop,
      genres: (en.genres ?? zh.genres ?? []).map((genre: any) => genre.name),
      countries: (zh.production_countries ?? zh.origin_country ?? []).map((country: any) => typeof country === 'string' ? country : country.name),
      directors, writers, creators, actors,
      updatedAt: Date.now(), matchState: work.matchState === 'manual' ? 'manual' : 'matched'
    });
    this.store.applyDoubanTitle(workId);
    if (applyManualEdits) this.store.applyManualFields(workId);
    return warnings;
  }

  async refreshImdb(workId: number): Promise<boolean> {
    const work = this.store.work(workId);
    const key = this.store.getSecret('omdb');
    if (!work?.imdbId) return false;
    if (!key) throw new Error('请先在设置中填写 OMDb API Key');
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', key);
    url.searchParams.set('i', work.imdbId);
    const data = await json(this.network, url.toString(), 'OMDb');
    const score = Number(data.imdbRating);
    if (data.Response === 'False') throw new Error(`OMDb：${data.Error ?? '无结果'}`);
    if (!Number.isFinite(score)) return false;
    this.store.setRating(workId, 'imdb', null, score, Number(String(data.imdbVotes ?? '').replace(/,/g, '')) || null, work.imdbId);
    return true;
  }
}
