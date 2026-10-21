// Wikidata links the same film's IMDb ID (P345) and Douban film ID (P4529).
// This is an exact-ID fallback when Douban's title suggestion omits a film.
export function doubanIdFromWikidata(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('results' in value)) return null;
  const bindings = (value as { results?: { bindings?: unknown } }).results?.bindings;
  if (!Array.isArray(bindings)) return null;
  const ids = [...new Set(bindings.map(row => row?.douban?.value).filter((id): id is string =>
    typeof id === 'string' && /^\d{4,12}$/.test(id)))];
  return ids.length === 1 ? ids[0] ?? null : null;
}

export async function lookupDoubanIdByImdb(imdbId: string,
  request: (url: string, options: RequestInit) => Promise<Response>): Promise<string | null> {
  if (!/^tt\d{7,10}$/.test(imdbId)) return null;
  const url = new URL('https://query.wikidata.org/sparql');
  url.searchParams.set('query', `SELECT ?douban WHERE { ?item wdt:P345 "${imdbId}"; wdt:P4529 ?douban. } LIMIT 10`);
  url.searchParams.set('format', 'json');
  const response = await request(url.toString(), { signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'MovieGlacier/0.4.0' } });
  if (!response.ok) throw new Error(`影片编号对照服务返回 HTTP ${response.status}`);
  return doubanIdFromWikidata(await response.json());
}
