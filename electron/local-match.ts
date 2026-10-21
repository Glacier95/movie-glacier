import type { Work } from '../src/shared.js';
import { mediaTitleKey, parseName, type ParsedName } from './scanner.js';
import { knownSeries } from './media-titles.js';
import type { Store } from './store.js';

export function localWorkMatches(work: Work, parsed: ParsedName): boolean {
  if (work.mediaType !== parsed.mediaType || (parsed.mediaType === 'movie' && parsed.year && work.year && parsed.year !== work.year))
    return false;
  return [work.titleZh, work.titleEn, work.originalTitle].some(title => mediaTitleKey(title) === parsed.normalizedTitle) ||
    work.assets.some(asset => parseName(asset.path, asset.kind).normalizedTitle === parsed.normalizedTitle);
}

export function repairParsedWork(store: Store, workId: number): boolean {
  const work = store.work(workId);
  if (!work || work.matchState === 'manual' || store.hasManualFields(workId)) return false;
  const parsedAssets = work.assets.map(asset => ({ asset, parsed: parseName(asset.path, asset.kind) }));
  const first = parsedAssets[0]?.parsed;
  // Mixed titles need user review; never reclassify all assets on the strength of one file.
  if (!first || parsedAssets.some(({ parsed }) => parsed.mediaType !== first.mediaType || parsed.normalizedTitle !== first.normalizedTitle))
    return false;
  const titlesAgree = [work.titleZh, work.titleEn, work.originalTitle].some(title => mediaTitleKey(title) === first.normalizedTitle);
  const wrongSeries = first.mediaType === 'tv' && (work.mediaType !== 'tv' || (knownSeries(first.title) && !titlesAgree));
  const wrongPending = work.matchState === 'pending' && (!titlesAgree || work.mediaType !== first.mediaType);
  if (!wrongSeries && !wrongPending) return false;
  const years = parsedAssets.map(({ parsed }) => parsed.year).filter((year): year is number => year !== null);
  store.repairWorkFromName(workId, { ...first, year: years.length ? Math.min(...years) : null });
  for (const { asset, parsed } of parsedAssets) store.putAsset({ ...asset, season: parsed.season, episode: parsed.episode }, asset.lastSeen);
  store.queueTask('tmdb', workId);
  store.queueTask('douban', workId);
  return true;
}
