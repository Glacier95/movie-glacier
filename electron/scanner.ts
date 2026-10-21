import fs from 'node:fs';
import path from 'node:path';
import { knownSeries } from './media-titles.js';
import type { MediaType } from '../src/shared.js';

const VIDEO_EXTENSIONS = new Set(['.mkv', '.mp4', '.m4v', '.avi', '.mov', '.wmv', '.ts', '.m2ts', '.mpg', '.mpeg', '.webm', '.rmvb']);
const SKIP_DIRS = new Set(['sample', 'samples', 'extras', 'featurettes', 'trailers', 'certificate']);
const releaseToken = /\b(480p|720p|1080p|2160p|4k|uhd|bluray|blu-ray|webrip|web-dl|hdtv|remux|proper|rerip|x26[45]|h\.?26[45]|avc|hevc|hdr|dovi|atmos|dts|aac|flac|truehd|criterion)\b/i;

export interface DiscoveredMedia {
  path: string;
  root: string;
  kind: 'file' | 'bdmv';
  size: number;
  mtimeMs: number;
}

export interface ParsedName {
  mediaType: MediaType;
  title: string;
  normalizedTitle: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}

function numeral(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (ones ? digits.indexOf(ones) : 0);
  }
  return digits.indexOf(value);
}

function parsePart(raw: string): ParsedName {
  raw = raw.normalize('NFKC');
  const pair = /(?:^|[. _\-\[\]])S(\d{1,2})[. _-]*E(\d{1,3})(?=$|[^\d])/i.exec(raw)
    ?? /(?:^|[. _-])(\d{1,2})x(\d{1,3})(?=$|[^\d])/i.exec(raw);
  const seasonMatch = /第\s*([零一二三四五六七八九十\d]+)\s*季|(?:^|[. _-])(?:S|Season[. _-]*)(\d{1,2})(?=$|[^\d])/i.exec(raw);
  const episodeMatch = /第\s*([零一二三四五六七八九十\d]+)\s*集|(?:^|[. _-])(?:EP?|Episode[. _-]*)(\d{1,3})(?=$|[^\d])/i.exec(raw);
  // A release year needs a delimiter and a title before it. Numeric titles stay intact.
  const yearMatch = [...raw.matchAll(/(?:^|[. _\-([【])((?:19|20)\d{2})(?=$|[. _\-)\]】])/g)]
    .filter(match => Number(match[1]) <= new Date().getFullYear() + 2 && raw.slice(0, match.index).replace(/[. _\-([【]/g, '').length > 0 &&
      !knownSeries(raw.slice(0, match.index + match[0].length))).at(-1);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const cutoff = Math.min(...[pair?.index, seasonMatch?.index, episodeMatch?.index, yearMatch?.index]
    .filter((value): value is number => value !== undefined), raw.length);
  let prefix = raw.slice(0, cutoff);
  const token = releaseToken.exec(prefix);
  if (token) prefix = prefix.slice(0, token.index);
  prefix = prefix.replace(/^[\[(【]\s*([^\])】]+)\s*[\])】]\s*[. _-]*/, '$1 ');
  prefix = prefix.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[-–: \[\]()【】]+$/, '');
  let title = prefix || raw.replace(/[._]+/g, ' ').trim();
  const series = knownSeries(title);
  if (series) title = /[\p{Script=Han}]/u.test(title) ? series.titleZh : series.titleEn;
  const season = pair ? Number(pair[1]) : seasonMatch ? numeral(seasonMatch[1] ?? seasonMatch[2] ?? '') : series?.season ?? null;
  const episode = pair ? Number(pair[2]) : episodeMatch ? numeral(episodeMatch[1] ?? episodeMatch[2] ?? '') : null;
  return { mediaType: pair || season !== null || episode !== null || series ? 'tv' : 'movie',
    title, normalizedTitle: mediaTitleKey(title), year, season: season ?? (episode !== null ? 1 : null), episode };
}

export function mediaTitleKey(title: string): string {
  return normalizeTitle(knownSeries(title)?.titleEn ?? title);
}

export function parseName(sourcePath: string, kind: 'file' | 'bdmv'): ParsedName {
  const raw = kind === 'bdmv' ? path.basename(sourcePath) : path.parse(sourcePath).name;
  const parsed = parsePart(raw);
  if (kind === 'bdmv') return parsed;
  // Episode-only filenames inherit the series title and season from nearby folders.
  const generic = /^(?:第\s*[零一二三四五六七八九十\d]+\s*集|(?:S\d{1,2})?[. _-]*(?:E|EP|Episode)[. _-]*\d{1,3}|\d{1,3})(?:$|[. _-])/i.test(raw);
  const explicitSeason = /(?:^|[. _-])(?:S|Season[. _-]*)\d{1,2}|第\s*[零一二三四五六七八九十\d]+\s*季|(?:^|[. _-])\d{1,2}x\d+/i.test(raw);
  let folder = path.dirname(sourcePath);
  let folderSeason: number | null = null;
  for (let depth = 0; depth < 3 && path.dirname(folder) !== folder; depth++, folder = path.dirname(folder)) {
    const parent = parsePart(path.basename(folder));
    if (parent.mediaType !== 'tv') continue;
    folderSeason ??= parent.season;
    if (/^(?:S\d{1,2}|Season[. _-]*\d{1,2}|第[零一二三四五六七八九十\d]+季)$/i.test(path.basename(folder))) continue;
    if (generic || parent.normalizedTitle === parsed.normalizedTitle) {
      const number = /^(\d{1,3})(?=$|[. _-])/.exec(raw);
      const title = generic ? parent.title : parsed.title;
      return { ...parsed, mediaType: 'tv', title, normalizedTitle: mediaTitleKey(title),
        year: parsed.year ?? parent.year, season: explicitSeason || (parsed.season !== null && parsed.season > 1) ? parsed.season : folderSeason ?? parsed.season ?? 1,
        episode: parsed.episode ?? (number ? Number(number[1]) : null) };
    }
  }
  return parsed;
}

export function normalizeTitle(title: string): string {
  return title.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

async function folderFootprint(folder: string): Promise<{ size: number; mtimeMs: number }> {
  const stack = [folder];
  let size = 0;
  let mtimeMs = 0;
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(entryPath);
      else if (entry.isFile()) {
        const stat = await fs.promises.stat(entryPath);
        size += stat.size;
        mtimeMs = Math.max(mtimeMs, stat.mtimeMs);
      }
    }
  }
  return { size, mtimeMs };
}

export async function* discover(root: string): AsyncGenerator<DiscoveredMedia> {
  const stack = [root];
  while (stack.length) {
    const folder = stack.pop()!;
    const entries = await fs.promises.readdir(folder, { withFileTypes: true });
    const bdmv = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === 'bdmv');
    if (bdmv) {
      const index = path.join(folder, bdmv.name, 'index.bdmv');
      if (fs.existsSync(index)) {
        const { size, mtimeMs } = await folderFootprint(folder);
        yield { path: folder, root, kind: 'bdmv', size, mtimeMs };
        continue;
      }
    }
    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase()) && entry.name.toLowerCase() !== 'bdmv') stack.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      if (/(?:^|[. _-])(sample|trailer|preview)(?:$|[. _-])/i.test(entry.name)) continue;
      const stat = await fs.promises.stat(entryPath);
      yield { path: entryPath, root, kind: 'file', size: stat.size, mtimeMs: stat.mtimeMs };
    }
  }
}

export function findNfoId(sourcePath: string, kind: 'file' | 'bdmv'): string | null {
  const dir = kind === 'bdmv' ? sourcePath : path.dirname(sourcePath);
  const parsed = parseName(sourcePath, kind);
  const candidates = parsed.mediaType === 'tv'
    ? [path.join(dir, 'tvshow.nfo'), path.join(path.dirname(dir), 'tvshow.nfo')]
    : [kind === 'file' ? sourcePath.slice(0, -path.extname(sourcePath).length) + '.nfo' : path.join(dir, 'movie.nfo')];
  if (kind === 'file' && parsed.mediaType === 'movie') {
    try {
      if (fs.readdirSync(dir).filter(name => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())).length === 1)
        candidates.push(path.join(dir, 'movie.nfo'));
    } catch { /* The source may be offline. */ }
  }
  if (kind === 'bdmv') candidates.push(path.join(dir, path.basename(dir) + '.nfo'));
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8').slice(0, 100_000);
      if (/<episodedetails\b/i.test(text)) continue; // Episode IMDb IDs are not series IDs.
      const match = /\btt\d{7,10}\b/.exec(text);
      if (match) return match[0];
    } catch { /* A missing sidecar is normal. */ }
  }
  return null;
}

export function localPoster(sourcePath: string, kind: 'file' | 'bdmv'): string | null {
  const dir = kind === 'bdmv' ? sourcePath : path.dirname(sourcePath);
  try {
    const images = fs.readdirSync(dir).filter(name => /\.(jpe?g|png|webp)$/i.test(name));
    const favored = images.find(name => /^(cover|poster|folder)\./i.test(name))
      ?? images.find(name => /(?:poster|电影海报)/i.test(name));
    return favored ? path.join(dir, favored) : null;
  } catch { return null; }
}
