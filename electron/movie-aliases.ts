// Explicit release-name aliases. Year gates keep remakes and unrelated films apart;
// do not use fuzzy prefix matching for automatic movie identities.
export interface MovieAlias {
  title: string;
  year: number;
  aliases: string[];
  imdbId?: string;
  titleZh?: string;
  releaseYears?: number[];
}

const movies: MovieAlias[] = [
  { title: 'A Confucian Confusion', year: 1994, aliases: ['独立时代', '獨立時代'] },
  { title: 'Apocalypse Now', year: 1979, aliases: ['Apocalypse Now Redux', '现代启示录'] },
  { title: 'E.T. the Extra-Terrestrial', year: 1982, aliases: ['E T The Extra Terrestrial', 'ET The Extra Terrestrial'] },
  { title: 'From Up on Poppy Hill', year: 2011, aliases: ['From Kokuriko Hill', 'Kokuriko zaka kara', '虞美人盛开的山坡'] },
  { title: 'Spirited Away', year: 2001, releaseYears: [2011], aliases: ['千与千寻', '千與千尋'], imdbId: 'tt0245429', titleZh: '千与千寻' },
  { title: 'Se7en', year: 1995, aliases: ['Seven', '七宗罪'] },
  { title: 'Thelma & Louise', year: 1991, aliases: ['Thelma and Louise', '末路狂花'] },
  { title: '8½', year: 1963, aliases: ['Eight and a Half', '8 1/2', '八部半'] },
  { title: 'The Godfather: Part II', year: 1974, aliases: ['The Godfather Part II', 'The Godfather Part 2', '教父2'] },
  { title: 'The Wave', year: 2008, aliases: ['Die Welle', '浪潮'], imdbId: 'tt1063669', titleZh: '浪潮' },
  { title: 'The Father', year: 2020, aliases: ['困在时间里的父亲'], imdbId: 'tt10272386', titleZh: '困在时间里的父亲' },
  { title: 'Birdman or (The Unexpected Virtue of Ignorance)', year: 2014, aliases: ['Birdman', '鸟人'], imdbId: 'tt2562232', titleZh: '鸟人' }
];

const key = (value: string) => value.normalize('NFKC').toLowerCase().replace(/&/g, ' and ')
  .replace(/[\p{P}\p{S}\s]+/gu, '');

export function movieAlias(title: string, year: number | null): MovieAlias | null {
  // Bilingual filenames can supply both the Chinese and the English title.
  const english = title.match(/[A-Za-z][^\p{Script=Han}]*/u)?.[0]?.trim();
  const titles = [title, ...(english ? [english] : [])].map(key);
  return movies.find(movie => (year === null ? !movie.imdbId : year === movie.year || movie.releaseYears?.includes(year)) &&
    [movie.title, ...movie.aliases].some(alias => titles.includes(key(alias)))) ?? null;
}

export function movieAliasById(imdbId: string | null): MovieAlias | null {
  return movies.find(movie => movie.imdbId && movie.imdbId === imdbId) ?? null;
}
