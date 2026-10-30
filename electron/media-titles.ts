// Small, explicit aliases for numeric series titles; never strip arbitrary movie sequels.
export function knownSeries(title: string): { titleZh: string; titleEn: string; season: number | null } | null {
  const compact = title.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
  if (/^(?:请回答1988|reply1988|응답하라1988)$/.test(compact))
    return { titleZh: '请回答1988', titleEn: 'Reply 1988', season: null };
  const robots = /^(?:(?:爱死亡和机器人|爱死亡机器人|爱死机)(?:lovedeathandrobots|lovedeathrobots)?|lovedeathandrobots|lovedeathrobots)([1-9]\d?)?$/.exec(compact);
  return robots ? { titleZh: '爱，死亡和机器人', titleEn: 'Love, Death & Robots', season: Number(robots[1]) || null } : null;
}

export function titleQueries(title: string): string[] {
  // Keep &, punctuation and numbers in English titles (Love, Death & Robots / Reply 1988).
  // Release names may explicitly join alternative titles with AKA. Search each
  // complete alias instead of treating the entire release name as one title.
  return [...new Set(title.split(/\s+(?:aka|a\.k\.a\.)\s+/i).flatMap(alias => {
    const english = alias.match(/[A-Za-z][^\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]*/u)?.[0]
      ?.replace(/[\[\]【】()（）]+/g, ' ').trim();
    const chinese = alias.split(/[A-Za-z]/)[0]?.replace(/[\[\]【】()（）]+/g, ' ').trim();
    return [english, alias.trim(), chinese].filter((value): value is string => Boolean(value));
  }))];
}
