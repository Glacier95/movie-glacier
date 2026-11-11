import type { Work } from '../src/shared.js';
import { cleanTitle } from './title-cleanup.js';
import { movieAliasById } from './movie-aliases.js';

// Exact IMDb identities distinguish films even when their local Chinese names
// contain only the franchise name. Never infer a part from the release year.
const movieTitles: Record<string, string> = {
  tt0120737: '指环王1：护戒使者',
  tt0167261: '指环王2：双塔奇兵',
  tt0167260: '指环王3：王者无敌'
};

export function movieChineseTitle(work: Pick<Work, 'mediaType' | 'imdbId'>, title: string): string {
  const localized = work.mediaType === 'movie' ? movieAliasById(work.imdbId)?.titleZh : undefined;
  if (localized && (!/\p{Script=Han}/u.test(title) || /^(?:父亲|父親|鸟人|鳥人|千与千寻|千與千尋)$/.test(title.trim()))) return localized;
  const known = work.mediaType === 'movie' && work.imdbId ? movieTitles[work.imdbId] : undefined;
  // Keep complete localized translations and custom titles; expand only a bare
  // franchise name (optionally followed by a part number) or a missing translation.
  return known && (!/\p{Script=Han}/u.test(title) || /^(?:指[环環]王|魔戒)\s*(?:[123一二三]|I{1,3})?\s*[:：-]?$/i.test(title.trim()))
    ? known : cleanTitle(title);
}
