export interface ImdbChartEntry { rank: number; imdbId: string }

export function validateImdbTop250(entries: ImdbChartEntry[]): void {
  if (entries.length !== 250 || new Set(entries.map(item => item.imdbId)).size !== 250 ||
    new Set(entries.map(item => item.rank)).size !== 250 || entries.some(item =>
      !/^tt\d{7,10}$/.test(item.imdbId) || !Number.isInteger(item.rank) || item.rank < 1 || item.rank > 250))
    throw new Error('IMDb Top 250 榜单不完整或排名异常');
}

/** Read only the chart's structured data, never recommendation/title links. */
export function parseImdbTop250(html: string): ImdbChartEntry[] {
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = script[1] ?? '';
    if (!/\bid\s*=\s*["']__NEXT_DATA__["']|\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) continue;
    try {
      const data = JSON.parse(script[2] ?? '');
      const edges = data.props?.pageProps?.pageData?.chartTitles?.edges;
      const entries: ImdbChartEntry[] = Array.isArray(edges)
        ? edges.map((edge, index) => ({ rank: edge.currentRank ?? edge.node?.currentRank ?? index + 1, imdbId: edge.node?.id ?? '' }))
        : (Array.isArray(data) ? data : [data]).flatMap(list => list['@type'] === 'ItemList' && Array.isArray(list.itemListElement)
          ? list.itemListElement.map((entry: any, index: number) => ({
            rank: entry.position ?? index + 1,
            imdbId: /^(?:https:\/\/(?:www\.)?imdb\.com)?\/title\/(tt\d{7,10})(?:[/?#]|$)/.exec(entry.item?.url ?? entry.url ?? '')?.[1] ?? ''
          })) : []);
      validateImdbTop250(entries);
      return entries.sort((a, b) => a.rank - b.rank);
    } catch { /* Another structured-data script may contain the full chart. */ }
  }
  throw new Error('IMDb Top 250 榜单不完整或排名异常');
}
