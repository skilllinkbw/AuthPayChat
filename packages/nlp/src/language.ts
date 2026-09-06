/**
 * Lightweight language detection for English / Setswana / mixed.
 * Deliberately dependency-free so it runs unchanged in the browser and on the server.
 * It only needs to be good enough to route the command; the intent grammar below is
 * largely language-agnostic once the keyword sets are known.
 */

export type Language = 'en' | 'tn' | 'mixed' | 'unknown';

const SETSWANA_MARKERS = [
  'duela', 'duel', 'romela', 'ntsha', 'kopa', 'batla', 'lopa', 'ka', 'go', 'mo', 'ke',
  'pula', 'thebe', 'madi', 'nthuse', 'tsweetswee', 'masome', 'lekgolo', 'sekete', 'some',
  'botshelo', 'tuelo', 'romela', 'amogela', 'rometsa',
];

const ENGLISH_MARKERS = [
  'pay', 'send', 'transfer', 'request', 'please', 'using', 'with', 'to', 'from', 'for',
  'pula', 'rand', 'dollar', 'fifty', 'hundred', 'thousand', 'balance', 'top', 'up',
];

function countHits(tokens: string[], markers: string[]): number {
  const set = new Set(markers);
  return tokens.filter((t) => set.has(t)).length;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.,$]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function detectLanguage(text: string): Language {
  const tokens = tokenize(text);
  const tn = countHits(tokens, SETSWANA_MARKERS.filter((m) => m.length > 2));
  const en = countHits(tokens, ENGLISH_MARKERS);
  if (tn > 0 && en > 0) return 'mixed';
  if (tn > 0) return 'tn';
  if (en > 0) return 'en';
  // Fall back: Setswana uses many open syllables and character sequences English does not.
  if (/\b(tsh|kg|tlh|ph|ng|ny)\w+/.test(text.toLowerCase())) return 'tn';
  return tokens.length ? 'unknown' : 'unknown';
}
