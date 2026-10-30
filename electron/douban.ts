import { BrowserWindow, session } from 'electron';
import type { Work } from '../src/shared.js';
import { chooseDoubanSuggestion, doubanChineseTitle, doubanSearchQueries, doubanLocalizedSeriesAliases, doubanSeasonSubjectMatches, ratingFromSearchLinks, type DoubanSearchLink, type DoubanSuggestion, type DoubanSubject } from './douban-match.js';
import { lookupDoubanIdByImdb } from './douban-crosswalk.js';
import { titleQueries } from './media-titles.js';

export class Douban {
  private browser: BrowserWindow | null = null;
  private blocked = false;
  private blockReason: 'rate' | 'network' | 'challenge' | null = null;
  private retryAfter = 0;
  private lastRequestAt = 0;
  private readonly suggestions = new Map<string, DoubanSuggestion[]>();
  private readonly partition = 'persist:douban';
  async findIdByImdb(imdbId: string): Promise<string | null> {
    const network = session.fromPartition('persist:metadata');
    return lookupDoubanIdByImdb(imdbId, (url, options) => network.fetch(url, options));
  }
  isBlocked(): boolean {
    if (this.retryAfter && Date.now() >= this.retryAfter) { this.retryAfter = 0; this.blocked = false; this.blockReason = null; }
    return this.blocked;
  }
  blockedMessage(): string {
    if (this.blockReason === 'rate') return '豆瓣访问太频繁；已暂停豆瓣抓取，请稍后点击“重试失败任务”';
    if (this.blockReason === 'network') return '豆瓣暂时无法连接；请稍后点击“重试失败任务”';
    return '豆瓣需要登录或验证；完成后可重试失败任务';
  }

  private getWindow(visible = false): BrowserWindow {
    if (!this.browser || this.browser.isDestroyed()) {
      this.browser = new BrowserWindow({
        width: 1060, height: 760, show: visible, title: '豆瓣登录与验证',
        webPreferences: { partition: this.partition, nodeIntegration: false, contextIsolation: true, sandbox: true }
      });
      this.browser.on('closed', () => { this.browser = null; });
      this.browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    }
    if (visible) { this.browser.show(); this.browser.focus(); }
    return this.browser;
  }

  async login(): Promise<void> {
    const window = this.getWindow(true);
    this.blocked = false;
    this.blockReason = null;
    this.retryAfter = 0;
    await window.loadURL('https://accounts.douban.com/passport/login').catch(() => undefined);
  }

  async logout(): Promise<void> {
    await session.fromPartition(this.partition).clearStorageData();
    this.blocked = false;
    this.blockReason = null;
    this.retryAfter = 0;
    if (this.browser && !this.browser.isDestroyed()) this.browser.close();
  }

  private async navigate(url: string, quietChallenge = false): Promise<BrowserWindow> {
    if (this.isBlocked()) throw new Error(this.blockedMessage());
    const wait = 3500 - (Date.now() - this.lastRequestAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequestAt = Date.now();
    const window = this.getWindow();
    try {
      const load = () => Promise.race([
        window.loadURL(url),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('豆瓣加载超时')), 25_000))
      ]);
      try { await load(); }
      catch (error) {
        if (!/\(-3\)|ERR_ABORTED/.test(String(error))) throw error;
        // Chromium can abort loadURL when a page redirects; inspect the final URL
        // before treating that as a network outage or issuing one new request.
        await new Promise(resolve => setTimeout(resolve, 1200));
        const current = window.webContents.getURL();
        const redirected = current.startsWith('https://sec.douban.com/') && new URL(current).searchParams.get('r') === url;
        if (current !== url && !redirected) {
          await new Promise(resolve => setTimeout(resolve, 2300));
          await load();
        }
      }
    } catch (error) {
      this.blocked = true;
      this.blockReason = 'network';
      this.retryAfter = Date.now() + 2 * 60_000;
      throw new Error(`豆瓣页面无法访问：${String(error)}`);
    }
    await this.checkAccess(window, quietChallenge);
    return window;
  }

  private async checkAccess(window: BrowserWindow, quietChallenge = false): Promise<void> {
    const state = await window.webContents.executeJavaScript(`({title:document.title,text:document.body?.innerText.slice(0,700)||'',url:location.href})`) as { title: string; text: string; url: string };
    if (/搜索访问太频繁|访问太频繁|too many requests|rate limit/i.test(`${state.title} ${state.text}`)) {
      this.blocked = true;
      this.blockReason = 'rate';
      this.retryAfter = Date.now() + 10 * 60_000;
      throw new Error(this.blockedMessage());
    }
    if (/验证码|异常请求|访问受限|登录豆瓣|captcha|verify|登录注册|please login|error code/i.test(`${state.title} ${state.text.slice(0, 200)}`) || !state.url.startsWith('https://movie.douban.com/')) {
      this.blocked = true;
      this.blockReason = 'challenge';
      if (!quietChallenge) window.show();
      throw new Error(quietChallenge ? '豆瓣要求登录或验证' : '豆瓣要求登录或验证，已打开窗口；完成后点击“重试失败任务”');
    }
  }

  private async waitFor(window: BrowserWindow, selector: string, timeout = 10_000): Promise<boolean> {
    return window.webContents.executeJavaScript(`new Promise(resolve => {
      const selector = ${JSON.stringify(selector)};
      if (document.querySelector(selector)) return resolve(true);
      const watcher = new MutationObserver(() => {
        if (document.querySelector(selector)) { watcher.disconnect(); resolve(true); }
      });
      watcher.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { watcher.disconnect(); resolve(false); }, ${timeout});
    })`) as Promise<boolean>;
  }

  async findSubject(work: Work, season: number | null = null, preferredId: string | null = null): Promise<DoubanSubject | null> {
    const queries = doubanSearchQueries(work, season);
    const queued = new Set(queries);
    let sawSuggestions = false;
    for (const query of queries) {
      let results = this.suggestions.get(query);
      if (!results) {
        const url = new URL('https://movie.douban.com/j/subject_suggest');
        url.searchParams.set('q', query);
        const window = await this.navigate(url.toString());
        const body = await window.webContents.executeJavaScript('document.body?.innerText || ""') as string;
        try {
          const parsed: unknown = JSON.parse(body);
          if (!Array.isArray(parsed)) throw new Error('结果不是列表');
          results = parsed.filter((item): item is DoubanSuggestion => item && typeof item === 'object' &&
            typeof item.id === 'string' && typeof item.title === 'string');
        } catch (error) { throw new Error(`豆瓣搜索建议返回异常：${String(error)}`); }
        // Empty responses can be temporary throttling. Keep them retryable.
        if (results.length) this.suggestions.set(query, results);
      }
      if (results.length) sawSuggestions = true;
      if (season !== null) for (const titleZh of doubanLocalizedSeriesAliases(work, results)) {
        for (const localizedQuery of doubanSearchQueries({ ...work, titleZh }, season)) {
          if (!queued.has(localizedQuery)) { queued.add(localizedQuery); queries.push(localizedQuery); }
        }
      }
      const match = preferredId ? results.find(item => item.id === preferredId) ?? null : chooseDoubanSuggestion(work, season, results);
      if (!match) continue;
      const subject = await this.readWithFallback(match.id, [query]);
      if (!subject) continue;
      // A season's Douban page may link an IMDb episode, while the library stores the series ID.
      // Verify the selected page's complete title and season instead of requiring those IDs to agree.
      if (season !== null && !doubanSeasonSubjectMatches(match, subject, season)) continue;
      if (season === null && work.imdbId && subject.imdbId && work.imdbId !== subject.imdbId) continue;
      if (work.year && subject.year && season === null && Math.abs(work.year - subject.year) > 1) continue;
      return { ...subject, titleZh: match.title.trim() || subject.titleZh };
    }
    if (!sawSuggestions) {
      // The endpoint also responds with HTTP 200 + [] when a browser session
      // is throttled. Probe a well-known title before declaring no match.
      const probe = new URL('https://movie.douban.com/j/subject_suggest');
      probe.searchParams.set('q', 'Fargo');
      const window = await this.navigate(probe.toString());
      const body = await window.webContents.executeJavaScript('document.body?.innerText || ""') as string;
      let healthy = false;
      try { const suggestions: unknown = JSON.parse(body); healthy = Array.isArray(suggestions) && suggestions.length > 0; }
      catch { /* A non-JSON probe is not a healthy suggestion response. */ }
      if (!healthy) {
        this.blocked = true;
        this.blockReason = 'rate';
        this.retryAfter = Date.now() + 10 * 60_000;
        throw new Error(this.blockedMessage());
      }
    }
    return null;
  }

  async readKnownSubject(work: Work): Promise<DoubanSubject | null> {
    if (!work.doubanId) return null;
    return this.readWithFallback(work.doubanId, [work.titleZh, work.titleEn, work.originalTitle].flatMap(titleQueries));
  }

  private async readWithFallback(id: string, queries: string[]): Promise<DoubanSubject | null> {
    let challenge: unknown = null;
    try {
      const subject = await this.readSubject(id, true);
      if (subject) return subject;
    } catch (error) {
      if (!String(error).includes('豆瓣要求登录或验证')) throw error;
      challenge = error;
    }
    // A subject page may require verification while public search still shows its rating.
    this.blocked = false;
    this.blockReason = null;
    for (const query of [...new Set(queries.map(value => value.trim()).filter(Boolean))]) {
      const subject = await this.readSearchRating(id, query);
      if (subject) {
        if (challenge && !subject.overviewZh) {
          try {
            const detail = await this.readSubject(id, true);
            if (detail) return { ...subject, ...detail,
              titleZh: detail.titleZh || subject.titleZh,
              tagsZh: detail.tagsZh?.length ? detail.tagsZh : subject.tagsZh };
          } catch (error) {
            if (!String(error).includes('豆瓣要求登录或验证')) throw error;
            this.blocked = false;
            this.blockReason = null;
          }
        }
        return subject;
      }
    }
    if (challenge) {
      this.blocked = true;
      this.blockReason = 'challenge';
      this.getWindow(true);
      throw challenge;
    }
    return null;
  }

  private async readSearchRating(id: string, title: string): Promise<DoubanSubject | null> {
    const search = new URL('https://movie.douban.com/subject_search');
    search.searchParams.set('search_text', title);
    search.searchParams.set('cat', '1002');
    for (let attempt = 0; attempt < 2; attempt++) {
      const window = await this.navigate(search.toString());
      if (!await this.waitFor(window, 'a[href*="movie.douban.com/subject/"]')) await this.checkAccess(window);
      const links = await window.webContents.executeJavaScript(`
        [...document.querySelectorAll('a[href*="movie.douban.com/subject/"]')]
          .map(a => ({href:a.href,text:a.textContent?.trim()||'',
            context:a.closest('.item-root,.item,li')?.textContent?.slice(0,500)||'',
            titleText:a.closest('.item-root')?.querySelector('.title-text')?.textContent?.trim()||'',
            meta:a.closest('.item-root')?.querySelector('.meta.abstract')?.textContent?.trim()||''}))
          .filter(x => /\\/subject\\/\\d+/.test(x.href)).slice(0,30)
      `) as DoubanSearchLink[];
      const subject = ratingFromSearchLinks(id, links);
      if (subject) return subject;
      if (links.some(link => /\/subject\/(\d+)/.exec(link.href)?.[1] === id)) return null;
    }
    return null;
  }

  async readSubject(id: string, quietChallenge = false): Promise<DoubanSubject | null> {
    const window = await this.navigate(`https://movie.douban.com/subject/${encodeURIComponent(id)}/`, quietChallenge);
    if (!await this.waitFor(window, 'strong[property="v:average"]')) await this.checkAccess(window);
    const result = await window.webContents.executeJavaScript(`(() => {
      const rating = document.querySelector('strong[property="v:average"]')?.textContent?.trim();
      const title = document.querySelector('#content h1')?.textContent?.trim() || '';
      const year = document.querySelector('#content h1 .year')?.textContent?.match(/\\d{4}/)?.[0];
      const votes = document.querySelector('[property="v:votes"]')?.textContent?.replace(/[^0-9]/g,'');
      const imdbId = /IMDb:\\s*(tt\\d+)/i.exec(document.querySelector('#info')?.textContent || '')?.[1];
      const titleZh = document.querySelector('#content h1 span')?.textContent?.trim() || '';
      const overviewZh = document.querySelector('[property="v:summary"]')?.innerText?.trim() || '';
      const tagsZh = [...document.querySelectorAll('[property="v:genre"]')].map(item => item.textContent?.trim() || '').filter(Boolean);
      return {rating,title,year,votes,imdbId,titleZh,overviewZh,tagsZh};
    })()`) as { rating?: string; title: string; year?: string; votes?: string; imdbId?: string;
      titleZh: string; overviewZh: string; tagsZh: string[] };
    const rating = Number(result.rating);
    if (!result.title && !result.titleZh && !result.overviewZh) return null;
    return { id, title: result.title.replace(/\s*\(\d{4}\).*/, '').trim(), year: Number(result.year) || null,
      rating: Number.isFinite(rating) && rating > 0 && rating <= 10 ? rating : null,
      votes: Number(result.votes) || null, imdbId: result.imdbId ?? null,
      titleZh: doubanChineseTitle(result.titleZh), overviewZh: result.overviewZh, tagsZh: result.tagsZh };
  }

  async top250(): Promise<{ rank: number; doubanId: string }[]> {
    const entries: { rank: number; doubanId: string }[] = [];
    for (let start = 0; start < 250; start += 25) {
      const window = await this.navigate(`https://movie.douban.com/top250?start=${start}`);
      const page = await window.webContents.executeJavaScript(`
        [...document.querySelectorAll('ol.grid_view > li .item')].map(item => ({
          rank:Number(item.querySelector('em')?.textContent),
          href:item.querySelector('.hd a')?.href || ''
        }))
      `) as { rank: number; href: string }[];
      if (page.length !== 25) throw new Error(`豆瓣 Top250 第 ${start / 25 + 1} 页不完整`);
      for (const item of page) {
        const id = /\/subject\/(\d+)/.exec(item.href)?.[1];
        if (!id || item.rank !== entries.length + 1) throw new Error('豆瓣 Top250 排名或条目异常');
        entries.push({ rank: item.rank, doubanId: id });
      }
    }
    if (new Set(entries.map(item => item.doubanId)).size !== 250) throw new Error('豆瓣 Top250 存在重复条目');
    return entries;
  }
}
