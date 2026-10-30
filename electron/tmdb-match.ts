import type { MatchCandidate } from '../src/shared.js';
import { mediaTitleKey } from './scanner.js';
import { titleQueries } from './media-titles.js';

export function tmdbScore(title: string, year: number | null, candidate: MatchCandidate): number {
  const names = [candidate.title, candidate.originalTitle].map(mediaTitleKey).filter(Boolean);
  const exact = titleQueries(title).some(query => names.includes(mediaTitleKey(query)));
  if (!exact) return 0; // A shorter title plus a matching year must never be an automatic match.
  if (year !== null && candidate.year === null) return 0;
  return 1 + (year !== null && candidate.year !== null
    ? year === candidate.year ? .25 : Math.abs(year - candidate.year) <= 1 ? .08 : -.3 : 0);
}

export function chooseTmdbCandidate(title: string, year: number | null, results: MatchCandidate[]): MatchCandidate | null {
  const sorted = [...results].sort((a, b) => tmdbScore(title, year, b) - tmdbScore(title, year, a));
  const first = sorted[0];
  const second = sorted[1];
  return first && tmdbScore(title, year, first) >= 1 &&
    (!second || tmdbScore(title, year, first) - tmdbScore(title, year, second) >= .2) ? first : null;
}
