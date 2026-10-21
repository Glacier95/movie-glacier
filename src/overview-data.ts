import type { Person, Work } from './shared';

export interface Bucket { name: string; value: number; ids: number[] }
export type RatingStep = 0.1 | 0.5 | 1;
type RatingField = 'ratingImdb' | 'ratingDouban';
export interface RatingSummary {
  count: number; missing: number; mean: number | null; median: number | null;
  highCount: number; highShare: number; coverage: number;
}
export interface Relationship extends Bucket { source: string; target: string }

// Every unordered pair is counted once per title, including bilingual aliases.
export function relationships(buckets: Bucket[]): Relationship[] {
  const pairs: Relationship[] = [];
  for (let i = 0; i < buckets.length; i++) {
    const ids = new Set(buckets[i].ids);
    for (let j = i + 1; j < buckets.length; j++) {
      const shared = [...new Set(buckets[j].ids)].filter(id => ids.has(id));
      if (shared.length) pairs.push({ source: buckets[i].name, target: buckets[j].name,
        name: `${buckets[i].name} × ${buckets[j].name}`, value: shared.length, ids: shared });
    }
  }
  return pairs;
}
const genreAliases: Record<string, string> = { '科幻': 'Science Fiction', 'Sci-Fi': 'Science Fiction', '剧情': 'Drama', '喜剧': 'Comedy', '动作': 'Action', '爱情': 'Romance', '惊悚': 'Thriller', '恐怖': 'Horror', '犯罪': 'Crime', '冒险': 'Adventure', '动画': 'Animation', '纪录片': 'Documentary', '悬疑': 'Mystery', '奇幻': 'Fantasy', '战争': 'War', '家庭': 'Family', '历史': 'History', '音乐': 'Music', '西部': 'Western' };
const countryGroups = [
  ['United States', 'United States of America', 'USA', 'US', '美国'], ['United Kingdom', 'UK', 'GB', '英国'],
  ['China', 'CN', '中国', '中国大陆'], ['Hong Kong', 'HK', '中国香港', '香港'], ['Taiwan', 'TW', '中国台湾', '台湾'],
  ['Japan', 'JP', '日本'], ['South Korea', 'Korea, Republic of', 'KR', '韩国'], ['France', 'FR', '法国'],
  ['Germany', 'DE', '德国'], ['Italy', 'IT', '意大利'], ['Canada', 'CA', '加拿大'], ['Australia', 'AU', '澳大利亚'],
  ['India', 'IN', '印度'], ['Spain', 'ES', '西班牙'], ['Russia', 'RU', '俄罗斯'], ['Sweden', 'SE', '瑞典']
];
const countries = new Map(countryGroups.flatMap(([canonical, ...aliases]) => [canonical, ...aliases].map(name => [name.toLowerCase(), canonical])));
const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const valid = (value: string) => value && !['n/a', 'unknown', '未知'].includes(value.toLowerCase());

function tally(works: Work[], values: (work: Work) => string[]): Bucket[] {
  const buckets = new Map<string, Set<number>>();
  for (const work of works) for (const name of new Set(values(work).map(clean).filter(valid))) {
    if (!buckets.has(name)) buckets.set(name, new Set());
    buckets.get(name)!.add(work.id);
  }
  return [...buckets].map(([name, ids]) => ({ name, value: ids.size, ids: [...ids] }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function people(works: Work[], field: 'directors' | 'actors', english: boolean): Bucket[] {
  // Link source IDs and bilingual aliases; count a person only once per work.
  const parents = new Map<string, string>();
  const find = (key: string): string => { const parent = parents.get(key); if (!parent) { parents.set(key, key); return key; } if (parent === key) return key; const root = find(parent); parents.set(key, root); return root; };
  const keys = (p: Person) => [...(p.id ? [`id:${p.id}`] : []), ...[p.originalName, p.name, ...(p.aliases ?? [])].filter((s): s is string => Boolean(s && valid(clean(s)))).map(s => `name:${clean(s).toLowerCase()}`)];
  for (const work of works) for (const person of work[field]) { const tokens = keys(person); for (const token of tokens.slice(1)) parents.set(find(token), find(tokens[0])); }
  const buckets = new Map<string, { names: Set<string>; ids: Set<number> }>();
  for (const work of works) for (const person of work[field]) {
    const tokens = keys(person); if (!tokens.length) continue;
    const key = find(tokens[0]);
    if (!buckets.has(key)) buckets.set(key, { names: new Set(), ids: new Set() });
    const bucket = buckets.get(key)!; bucket.ids.add(work.id);
    for (const name of [person.name, person.originalName, ...(person.aliases ?? [])]) if (name && valid(clean(name))) bucket.names.add(clean(name));
  }
  return [...buckets.values()].map(({ names, ids }) => ({ name: [...names].find(s => english ? !/[\u3400-\u9fff]/.test(s) : /[\u3400-\u9fff]/.test(s)) ?? (english ? 'Name unavailable' : [...names][0] ?? '未知'), value: ids.size, ids: [...ids] }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 10);
}

function validRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10;
}

export function ratingDistribution(works: Work[], field: RatingField, step: RatingStep = 1): Bucket[] {
  const scale = 1 / step;
  const format = (value: number) => step === 1 ? String(value) : value.toFixed(1);
  const bins: Bucket[] = Array.from({ length: 10 * scale }, (_, i) => ({
    name: `${format(i / scale)}–${format((i + 1) / scale)}`, value: 0, ids: []
  }));
  for (const work of new Map(works.map(work => [work.id, work])).values()) {
    const rating = work[field];
    // Missing scores are never represented as zero. The final bin includes 10.
    if (!validRating(rating)) continue;
    // Scale to integers so exact decimal boundaries (e.g. 8.1) are stable.
    const bucket = bins[Math.min(bins.length - 1, Math.floor(Number((rating * scale).toFixed(8))))];
    bucket.ids.push(work.id); bucket.value++;
  }
  return bins;
}

export function ratingSummary(input: Work[], field: RatingField): RatingSummary {
  const works = [...new Map(input.map(work => [work.id, work])).values()];
  const scores = works.map(work => work[field]).filter(validRating).sort((a, b) => a - b);
  const count = scores.length;
  const highCount = scores.filter(score => score >= 8).length;
  return { count, missing: works.length - count,
    mean: count ? scores.reduce((total, score) => total + score, 0) / count : null,
    median: count ? (scores[Math.floor((count - 1) / 2)] + scores[Math.floor(count / 2)]) / 2 : null,
    highCount, highShare: count ? highCount / count : 0, coverage: works.length ? count / works.length : 0 };
}

export function pairedRatings(input: Work[]): { count: number; difference: number | null } {
  const works = [...new Map(input.map(work => [work.id, work])).values()];
  const differences = works.flatMap(work => validRating(work.ratingDouban) && validRating(work.ratingImdb)
    ? [work.ratingDouban - work.ratingImdb] : []);
  return { count: differences.length, difference: differences.length
    ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null };
}

export function summarizeLibrary(input: Work[], english = false, ratingStep: RatingStep = 0.5) {
  const works = [...new Map(input.map(work => [work.id, work])).values()];
  return {
    total: works.length, movies: works.filter(w => w.mediaType === 'movie').length,
    series: works.filter(w => w.mediaType === 'tv').length, favorites: works.filter(w => w.favorite).length,
    top250: works.filter(w => w.topRank !== null && w.topRank > 0).length,
    genres: tally(works, w => (w.genres.length ? w.genres : w.doubanTags).map(s => genreAliases[clean(s)] ?? clean(s))),
    years: tally(works, w => [w.year && Number.isInteger(w.year) && w.year > 0 ? String(w.year) : english ? 'Unknown year' : '未知年份'])
      .sort((a, b) => (Number(a.name) || Infinity) - (Number(b.name) || Infinity)),
    ratings: { imdb: ratingDistribution(works, 'ratingImdb', ratingStep), douban: ratingDistribution(works, 'ratingDouban', ratingStep) },
    ratingSummary: { imdb: ratingSummary(works, 'ratingImdb'), douban: ratingSummary(works, 'ratingDouban'), paired: pairedRatings(works) },
    countries: tally(works, w => w.countries.map(s => countries.get(clean(s).toLowerCase()) ?? clean(s))),
    directors: people(works, 'directors', english), actors: people(works, 'actors', english),
    missing: { genres: works.filter(w => !w.genres.some(valid) && !w.doubanTags.some(valid)).length,
      countries: works.filter(w => !w.countries.some(valid)).length }
  };
}
