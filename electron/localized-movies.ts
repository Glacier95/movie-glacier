import { Converter } from 'opencc-js/t2cn';
import { cleanTitle } from './title-cleanup.js';

let simplify: ReturnType<typeof Converter> | undefined;
export function preferredMovieTitle(current: string, verified: string): string {
  if (!verified) return current;
  simplify ??= Converter({ from: 't', to: 'cn' });
  const key = (value: string) => simplify!(value).normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '').toLowerCase();
  const existing = key(current), incoming = key(verified);
  // A complete localized title must not shrink back to a franchise abbreviation.
  if (/\p{Script=Han}/u.test(current) && /[:：()（）]/.test(current) && !incoming.startsWith(existing)) return current;
  return incoming && existing.startsWith(incoming) && existing.length > incoming.length ? current : verified;
}

export function chineseMovieTitleFromWikidata(value: unknown, currentTitle = ''): string | null {
  const bindings = (value as { results?: { bindings?: unknown } } | null)?.results?.bindings;
  if (!Array.isArray(bindings) || !bindings.length) return null;
  const items = new Set(bindings.map(row => row?.item?.value));
  if (items.size !== 1 || !/^https?:\/\/www\.wikidata\.org\/entity\/Q[1-9]\d*$/.test(String([...items][0]))) return null;
  const valid = (label: any) => label && typeof label.value === 'string' && /^zh(?:-|$)/.test(label['xml:lang'] ?? '') &&
    /\p{Script=Han}/u.test(label.value) && label.value.length <= 200;
  const labels = [...new Set(bindings.filter(row => valid(row?.itemLabel)).map(row => row.itemLabel.value))];
  if (labels.length !== 1) return null;
  simplify ??= Converter({ from: 't', to: 'cn' });
  const key = (title: string) => simplify!(title).normalize('NFKC').replace(/[\p{P}\p{S}\s]+/gu, '').toLowerCase();
  const current = key(currentTitle);
  const candidates = bindings.flatMap(row => [row.itemLabel, row.mainlandTitle]).filter(valid).map(label => ({
    title: simplify!(cleanTitle(label.value.trim())), language: label['xml:lang']
  }));
  const rank = (language: string) => language === 'zh-cn' ? 0 : language === 'zh-hans' ? 1 : 2;
  candidates.sort((a, b) => rank(a.language) - rank(b.language) ||
    Number(Boolean(current && key(b.title).startsWith(current))) - Number(Boolean(current && key(a.title).startsWith(current))) ||
    b.title.length - a.title.length || a.title.localeCompare(b.title, 'zh-CN'));
  const selected = candidates[0]?.title;
  const parts = new Set(bindings.map(row => row?.part?.value).filter((part): part is string => typeof part === 'string' && /^[1-9]\d{0,2}$/.test(part)));
  const series = new Set(bindings.map(row => row?.series?.value).filter((id): id is string =>
    typeof id === 'string' && /^https?:\/\/www\.wikidata\.org\/entity\/Q[1-9]\d*$/.test(id)));
  // If the source only has another region's translation, preserve the library's
  // existing franchise name and distinguish its part by the verified series ordinal.
  // Full local subtitles and numbered titles continue to use their sourced name.
  if (selected && current && !key(selected).startsWith(current) && /^[\p{Script=Han}·\s]{2,20}$/u.test(currentTitle) &&
    parts.size === 1 && series.size === 1) {
    const part = [...parts][0]!;
    return currentTitle.trim() + (part === '1' ? '' : part);
  }
  return selected ?? null;
}

export async function lookupChineseMovieTitle(imdbId: string,
  request: (url: string, options: RequestInit) => Promise<Response>, currentTitle = ''): Promise<string | null> {
  if (!/^tt\d{7,10}$/.test(imdbId)) return null;
  const url = new URL('https://query.wikidata.org/sparql');
  url.searchParams.set('query', `SELECT ?item ?itemLabel ?mainlandTitle ?series ?part WHERE {
    ?item wdt:P345 "${imdbId}".
    OPTIONAL { ?item p:P179 ?membership. ?membership ps:P179 ?series; pq:P1545 ?part. }
    OPTIONAL { ?item skos:altLabel ?mainlandTitle. FILTER(LANG(?mainlandTitle) IN ("zh-cn", "zh-hans")) }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "zh-cn,zh-hans,zh,zh-tw,zh-hant". }
  } LIMIT 50`);
  url.searchParams.set('format', 'json');
  const response = await request(url.toString(), { signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'MovieGlacier (https://github.com/Glacier95/movie-glacier)' } });
  if (!response.ok) throw new Error(`Wikidata 返回 HTTP ${response.status}`);
  return chineseMovieTitleFromWikidata(await response.json(), currentTitle);
}
