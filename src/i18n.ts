import { useSyncExternalStore } from 'react';
import { english } from './english';

export type Language = 'zh' | 'en';
let language: Language = 'zh';
const listeners = new Set<() => void>();
export function setLanguage(value: Language): void {
  if (value === language) return;
  language = value;
  document.documentElement.lang = value === 'en' ? 'en' : 'zh-CN';
  for (const notify of listeners) notify();
}
export function useLanguage(): Language {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => language);
}
export function isEnglish(): boolean { return language === 'en'; }
export function locale(): string { return isEnglish() ? 'en-US' : 'zh-CN'; }
export function t(key: string, ...values: (string | number | null | undefined)[]): string {
  const text = isEnglish() ? (english[key] ?? (english[key.trim()] !== undefined
    ? key.replace(key.trim(), english[key.trim()]) : key)) : key;
  return text.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ''));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const messages = Object.entries(english).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => ({
  pattern: new RegExp('^' + key.split(/\{\d+\}/).map(escape).join('(.*?)') + '$', 's'), value
}));
/** Translate persisted activity messages without altering stored diagnostics. */
export function message(text: string, depth = 0): string {
  if (!isEnglish() || !text || depth > 6) return text;
  if (english[text] !== undefined) return english[text];
  for (const { pattern, value } of messages) {
    const match = pattern.exec(text);
    if (match) return value.replace(/\{(\d+)\}/g, (_, index: string) => message(match[Number(index) + 1] ?? '', depth + 1));
  }
  // Electron wraps rejected IPC calls; translate the useful error inside that wrapper.
  const error = /^(.*?Error: )(.*)$/s.exec(text);
  if (error) return error[1] + message(error[2], depth + 1);
  return text;
}
