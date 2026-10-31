import { Converter } from 'opencc-js/t2cn';

export const titleFields = ['titleZh', 'titleEn', 'originalTitle', 'doubanTitleZh'] as const;
let simplify: ReturnType<typeof Converter> | undefined;
const rawKey = (value: string) => value.normalize('NFKC').replace(/[\s/|｜]+/gu, '').toLocaleLowerCase();

/** Collapse adjacent, complete script-equivalent aliases; keep other titles intact. */
export function cleanTitle(value: string): string {
  let result = value;
  const collapsed = new Set<string>();
  while (true) {
    const tokens = [...result.matchAll(/[^\s/|｜]+/gu)];
    if (tokens.length < 2 || tokens.length > 40) return result;
    const keys = new Map<string, string>();
    const key = (text: string) => {
      if (!keys.has(text)) {
        simplify ??= Converter({ from: 't', to: 'cn' });
        keys.set(text, rawKey(simplify(text)));
      }
      return keys.get(text)!;
    };
    let best: { start: number; end: number; left: string; key: string } | null = null;
    for (let start = 0; start < tokens.length - 1; start++) {
      for (let middle = start + 1; middle < tokens.length; middle++) {
        const left = result.slice(tokens[start]!.index, tokens[middle - 1]!.index + tokens[middle - 1]![0].length);
        if ((left.match(/\p{Script=Han}/gu)?.length ?? 0) < 2) continue;
        for (let end = middle + 1; end <= tokens.length; end++) {
          const right = result.slice(tokens[middle]!.index, tokens[end - 1]!.index + tokens[end - 1]![0].length);
          if ((right.match(/\p{Script=Han}/gu)?.length ?? 0) < 2 || key(left) !== key(right)) continue;
          // Identical repeated words can be a real title. Require a script difference,
          // except when removing a third copy of an alias already confirmed above.
          if (rawKey(left) === rawKey(right) && !collapsed.has(key(left))) continue;
          if (!best || key(left).length > best.key.length) best = { start: tokens[start]!.index,
            end: tokens[end - 1]!.index + tokens[end - 1]![0].length, left, key: key(left) };
        }
      }
    }
    if (!best) return result;
    collapsed.add(best.key);
    result = (result.slice(0, best.start) + simplify!(best.left) + result.slice(best.end)).trim();
  }
}
