import type { Work } from '../src/shared.js';
import { normalizeTitle, parseName } from './scanner.js';
import { knownSeries, titleQueries } from './media-titles.js';

export interface OmdbCandidate {
  Title: string;
  Year: string;
  imdbID: string;
  Type?: string;
}

export function omdbYear(value: string | undefined): number | null {
  return Number(/\b(?:19|20)\d{2}\b/.exec(value ?? '')?.[0]) || null;
}

export function lookupYear(work: Work): number | null {
  if (work.mediaType !== 'tv') return work.year;
  const years = work.assets.filter(asset => asset.season === null || asset.season <= 1)
    .map(asset => parseName(asset.path, asset.kind).year)
    .filter((value): value is number => value !== null);
  return years.length ? Math.min(...years) : work.assets.some(asset => asset.season !== null && asset.season > 1) ? null : work.year;
}

export function omdbQueries(work: Work): string[] {
  const output: string[] = [];
  // This 1983 film is commonly filed as “Nostalgia”, while IMDb/OMDb use “Nostalghia”.
  // Query the known title first so a different film named “Nostalgia” is not accepted.
  if (work.mediaType === 'movie' && work.year === 1983 &&
    [work.titleEn, work.originalTitle, work.titleZh].some(title => normalizeTitle(title) === 'nostalgia'))
    output.push('Nostalghia');
  for (const title of [work.titleEn, work.originalTitle, work.titleZh]) {
    const series = work.mediaType === 'tv' ? knownSeries(title) : null;
    for (const query of [...(series ? [series.titleEn] : []), ...titleQueries(title)]) {
      if (query && !output.some(item => normalizeTitle(item) === normalizeTitle(query))) output.push(query);
    }
  }
  return output.slice(0, 3);
}

function withoutArticle(title: string): string {
  return normalizeTitle(title).replace(/^(the|a|an) /, '');
}

export function chooseOmdbCandidate(title: string, year: number | null, candidates: OmdbCandidate[]): OmdbCandidate | null {
  const target = normalizeTitle(title);
  const scores = candidates.flatMap(candidate => {
    const candidateYear = omdbYear(candidate.Year);
    const difference = year !== null && candidateYear !== null ? Math.abs(year - candidateYear) : 0;
    if (year !== null && (candidateYear === null || difference > 1)) return [];
    const exact = normalizeTitle(candidate.Title) === target;
    const articleOnly = withoutArticle(candidate.Title) === withoutArticle(title);
    if (!exact && !articleOnly) return [];
    return [{ candidate, score: (exact ? 100 : 70) + (year === null ? 0 : 2 - difference) }];
  }).sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || (scores[1] && best.score === scores[1].score)) return null;
  return best.candidate;
}

export function omdbPeople(value: string | undefined): { id: string; name: string }[] {
  if (!value || value === 'N/A') return [];
  return [...new Set(value.split(',').map(item => item.trim()).filter(item => item && item !== 'N/A'))]
    .map(name => ({ id: `omdb:${normalizeTitle(name)}`, name }));
}

export function omdbChineseTitle(work: Work, englishTitle: string): string {
  const prefix = work.titleZh.split(/[A-Za-z]/)[0]?.replace(/[\[\]【】()（）]/g, '').trim();
  return prefix && /[\u3400-\u9fff]/.test(prefix) ? prefix : englishTitle;
}

export function safeOmdbPoster(value: string | undefined): string | null {
  if (!value || value === 'N/A') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['media-amazon.com', 'ssl-images-amazon.com', 'omdbapi.com']
      .some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.toString();
  } catch { return null; }
}

// An explicit IMDb identity is stronger evidence than a filename's release year.
export function checkOmdbYear(work: Work, matchedYear: number | null): string[] {
  const expected = lookupYear(work);
  if (expected === null || (matchedYear !== null && Math.abs(expected - matchedYear) <= 1)) return [];
  if (!work.imdbId) throw new Error('OMDb 条目年份与本地资源不符，已保留原条目供编辑确认');
  return [`已按 IMDb ID ${work.imdbId} 获取资料；本地年份 ${expected}，OMDb 年份 ${matchedYear ?? '未知'}，保留本地年份`];
}
