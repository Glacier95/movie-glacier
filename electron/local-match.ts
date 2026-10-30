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

export function repairParsedWork(store: Store, workId: number, snapshot?: Work): boolean {
  const work = snapshot ?? store.work(workId);
  if (!work || work.matchState === 'manual' || store.hasManualFields(workId)) return false;
  const parsedAssets = work.assets.map(asset => ({ asset, parsed: parseName(asset.path, asset.kind) }));
  const first = parsedAssets[0]?.parsed;
  // Mixed titles need user review; never reclassify all assets on the strength of one file.
  if (!first || parsedAssets.some(({ parsed }) => parsed.mediaType !== first.mediaType || parsed.normalizedTitle !== first.normalizedTitle))
    return false;
  const titlesAgree = [work.titleZh, work.titleEn, work.originalTitle].some(title => mediaTitleKey(title) === first.normalizedTitle);
  const wrongSeries = first.mediaType === 'tv' && (work.mediaType !== 'tv' || (knownSeries(first.title) && !titlesAgree));
  const wrongPending = work.matchState === 'pending' && (!titlesAgree || work.mediaType !== first.mediaType);
  const wrongEpisodes = first.mediaType === 'tv' && parsedAssets.some(({ asset, parsed }) =>
    asset.season !== parsed.season || asset.episode !== parsed.episode);
  if (!wrongSeries && !wrongPending && !wrongEpisodes) return false;
  const years = parsedAssets.map(({ parsed }) => parsed.year).filter((year): year is number => year !== null);
  if (wrongSeries || wrongPending) store.repairWorkFromName(workId, { ...first, year: years.length ? Math.min(...years) : null });
  for (const { asset, parsed } of parsedAssets) store.putAsset({ ...asset, season: parsed.season, episode: parsed.episode }, asset.lastSeen);
  store.queueTask('tmdb', workId);
  store.queueTask('douban', workId);
  return true;
}

/** Repair legacy season records even when no media files have changed. */
export function reconcileSeries(store: Store): void {
  for (const work of store.listWorks()) {
    if (work.assets.some(asset => parseName(asset.path, asset.kind).mediaType === 'tv'))
      repairParsedWork(store, work.id, work);
  }
  const groups = new Map<string, Work[]>();
  for (const work of store.listWorks()) {
    if (work.mediaType !== 'tv' || work.matchState === 'manual' || store.hasManualFields(work.id)) continue;
    const parsed = work.assets.map(asset => parseName(asset.path, asset.kind));
    const first = parsed[0];
    // Limit name-based merging to recognized series with consistent filenames.
    if (!first || !knownSeries(first.title) || parsed.some(item => item.mediaType !== 'tv' || item.normalizedTitle !== first.normalizedTitle)) continue;
    groups.set(first.normalizedTitle, [...(groups.get(first.normalizedTitle) ?? []), work]);
  }
  const quality = (work: Work) => Number(Boolean(work.tmdbId)) * 8 + Number(Boolean(work.imdbId)) * 8 +
    Number(work.matchState === 'matched') * 4 + Number(Boolean(work.overview)) + Number(Boolean(work.poster)) + Number(Boolean(work.year));
  for (const works of groups.values()) {
    works.sort((a, b) => quality(b) - quality(a) || a.id - b.id);
    const target = works[0];
    if (!target) continue;
    for (const work of works.slice(1)) {
      const current = store.work(target.id)!;
      if ((current.imdbId && work.imdbId && current.imdbId !== work.imdbId) ||
        (current.tmdbId && work.tmdbId && current.tmdbId !== work.tmdbId)) continue;
      store.mergeSeries(work.id, target.id);
      store.queueTask('tmdb', target.id);
      store.queueTask('douban', target.id);
    }
  }
}
