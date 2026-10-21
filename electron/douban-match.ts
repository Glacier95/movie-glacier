import type { Work } from '../src/shared.js';
import { normalizeTitle } from './scanner.js';

export interface DoubanSubject { id: string; title: string; year: number | null; rating: number | null; votes: number | null;
  imdbId?: string | null; titleZh?: string; overviewZh?: string; tagsZh?: string[]; }
export interface DoubanSearchLink { href: string; text: string; context: string; titleText?: string; meta?: string; }
export interface DoubanSuggestion { id: string; title: string; sub_title?: string; year?: string; episode?: string; type?: string; }

const chineseGenres = new Set(['剧情','喜剧','动作','爱情','科幻','动画','悬疑','惊悚','恐怖','犯罪','冒险','奇幻',
  '家庭','历史','战争','传记','音乐','歌舞','运动','西部','武侠','古装','情色','灾难','纪录片','短片','同性','儿童','黑色电影','真人秀']);

export function doubanChineseTitle(value: string): string {
  const title = value.replace(/[\u200e\u200f]/g, '').replace(/\s*\((?:19|20)\d{2}\).*/, '').trim();
  return title.match(/^[\p{Script=Han}·：:！？!？、，,。\s]+/u)?.[0]?.trim() || title;
}

export function doubanGenresFromMeta(meta: string): string[] {
  return [...new Set(meta.split('/').map(value => value.trim()).filter(value => chineseGenres.has(value)))];
}

export function ratingFromSearchLinks(id: string, links: DoubanSearchLink[]): DoubanSubject | null {
  for (const link of links) {
    if (/\/subject\/(\d+)/.exec(link.href)?.[1] !== id) continue;
    const ratingText = /(10\.0|[0-9]\.\d)\s*\(([\d,]+)\s*人评价\)/.exec(link.context);
    const rating = Number(ratingText?.[1]);
    const title = link.titleText?.trim() || link.text.trim() || (ratingText ? link.context.split(ratingText[0])[0]?.trim() : '') || '';
    const year = Number(/\(((?:19|20)\d{2})\)/.exec(`${title} ${link.context}`)?.[1]) || null;
    return { id, title, titleZh: doubanChineseTitle(title), year,
      rating: Number.isFinite(rating) && rating > 0 && rating <= 10 ? rating : null,
      votes: Number(ratingText?.[2]?.replace(/,/g, '')) || null, tagsZh: doubanGenresFromMeta(link.meta ?? '') };
  }
  return null;
}

function seasonNumber(title: string): number | null {
  const match = /第\s*([一二三四五六七八九十\d]+)\s*季|season\s*(\d+)/i.exec(title);
  if (!match) return null;
  const token = match[1] ?? match[2] ?? '';
  if (/^\d+$/.test(token)) return Number(token);
  const digits = '一二三四五六七八九';
  if (token === '十') return 10;
  if (token.startsWith('十')) return 10 + digits.indexOf(token[1] ?? '') + 1;
  if (token.endsWith('十')) return (digits.indexOf(token[0] ?? '') + 1) * 10;
  return digits.indexOf(token) + 1 || null;
}

export function chooseDoubanSuggestion(work: Pick<Work, 'mediaType' | 'titleZh' | 'titleEn' | 'originalTitle' | 'year'>,
  season: number | null, suggestions: DoubanSuggestion[]): DoubanSuggestion | null {
  const titles = [work.titleZh, work.titleEn, work.originalTitle].map(normalizeTitle).filter(Boolean);
  const candidates = suggestions.filter(item => /^\d{4,12}$/.test(item.id) &&
    (season !== null || !work.year || !Number(item.year) || Math.abs(work.year - Number(item.year)) <= 1) &&
    (season === null ? seasonNumber(item.title) === null && (work.mediaType !== 'movie' || !item.episode) : seasonNumber(item.title) === season));
  const titleMatches = candidates.filter(item => {
    const names = [item.title, item.sub_title ?? ''].map(normalizeTitle).filter(Boolean);
    if (season !== null) {
      const base = normalizeTitle(item.title.replace(/第\s*[一二三四五六七八九十\d]+\s*季|season\s*\d+/ig, ''));
      return titles.some(title => title === base || title === normalizeTitle(item.sub_title ?? '') ||
        (base.length >= 3 && title.includes(base)));
    }
    return names.some(name => titles.some(title => title === name));
  });
  if (titleMatches.length === 1) return titleMatches[0] ?? null;
  if (titleMatches.length > 1) return titleMatches.find(item => Number(item.year) === work.year) ?? null;
  // A localized suggestion may omit its English title (e.g. A City of Sadness).
  // Only accept such a result when the query returned one candidate of the right year.
  if (candidates.length === 1 && work.year && Number(candidates[0]?.year) === work.year) return candidates[0] ?? null;
  return null;
}

export function chooseDoubanSubject(work: Pick<Work, 'mediaType' | 'titleZh' | 'titleEn' | 'originalTitle' | 'year'>,
  season: number | null, preferredId: string | null, links: DoubanSearchLink[]): DoubanSubject | null {
  const numerals = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const titles = [work.titleZh, work.titleEn, work.originalTitle].map(normalizeTitle).filter(Boolean);
  const seen = new Set<string>();
  for (const link of links) {
    const id = /\/subject\/(\d+)/.exec(link.href)?.[1];
    if (!id || seen.has(id) || (preferredId && id !== preferredId)) continue;
    seen.add(id);
    const found = normalizeTitle(link.text.replace(/\s*\((?:19|20)\d{2}\).*/, ''));
    const ratingText = /(?:^|[^\d])(10\.0|[0-9]\.\d)\s*\(([\d,]+)\s*人评价\)/.exec(link.context.replace(/\s+/g, ''));
    if (!ratingText) continue;
    const rating = Number(ratingText[1]);
    if (rating <= 0 || rating > 10) continue;
    const votes = Number((ratingText[2] ?? '').replace(/,/g, '')) || null;
    const year = Number(/\(((?:19|20)\d{2})\)/.exec(link.text)?.[1]) || null;
    const titleMatch = titles.some(value => value === found ||
      ((value.length >= 3 || /[\u3400-\u9fff]{2}/.test(value)) && found.length >= 2 && (value.includes(found) || found.includes(value))));
    const seasonText = /第\s*([一二三四五六七八九十\d]+)\s*季|season\s*(\d+)/i.exec(link.text);
    const foundSeason = seasonText ? (Number(seasonText[1] ?? seasonText[2]) || numerals.indexOf(seasonText[1] ?? '')) : null;
    if (season !== null) {
      if (titleMatch && foundSeason === season) return { id, title: link.text, year, rating, votes };
    } else if (titleMatch && (work.mediaType === 'movie' ? foundSeason === null && !link.context.includes('[剧集]') : foundSeason === null)
      && (!work.year || !year || Math.abs(work.year - year) <= 1)) {
      return { id, title: link.text, year, rating, votes };
    }
  }
  return null;
}
