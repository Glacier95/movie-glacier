import type { Work } from '../src/shared.js';

export function shooterSubtitleUrl(work: Pick<Work, 'titleEn' | 'originalTitle' | 'titleZh'>): string {
  const title = (work.titleEn || work.originalTitle || work.titleZh).trim();
  if (!title) throw new Error('影片没有可用于搜索字幕的片名');
  const url = new URL('https://assrt.net/sub/');
  url.searchParams.set('searchword', title.toLowerCase());
  return url.toString();
}
