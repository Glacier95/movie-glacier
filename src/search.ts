import type { Work } from './shared';

export function matchesSearch(work: Pick<Work, 'titleZh' | 'doubanTitleZh' | 'titleEn' | 'originalTitle' | 'directors' | 'actors'>,
  query: string): boolean {
  const keyword = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!keyword) return true;
  return [work.titleZh, work.doubanTitleZh ?? '', work.titleEn, work.originalTitle,
    ...work.directors.flatMap(person => [person.name, person.originalName ?? '', ...(person.aliases ?? [])]),
    ...work.actors.flatMap(person => [person.name, person.originalName ?? '', ...(person.aliases ?? [])])]
    .some(value => value.normalize('NFKC').toLocaleLowerCase().includes(keyword));
}
