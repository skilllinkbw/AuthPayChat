/**
 * Amount + currency extraction (English and Setswana).
 * Always returns MINOR units (thebe for BWP). Never floats.
 */

export interface ParsedAmount {
  minor: number;
  currency: string;
  /** True when the currency was explicitly stated rather than defaulted. */
  explicitCurrency: boolean;
  matchedText: string;
}

const MINOR_UNITS: Record<string, number> = {
  BWP: 2, ZAR: 2, USD: 2, EUR: 2, GBP: 2, KES: 2, GHS: 2, NGN: 2, ZMW: 2, NAD: 2,
};

const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000 };

/** Setswana numerals (Botswana). Covers the everyday range used in payment speech. */
const TN_NUMERALS: Record<string, number> = {
  bongwe: 1, bobedi: 2, boraro: 3, bonnè: 4, bone: 4, botlhano: 5, thataro: 6, supa: 7,
  robedi: 8, borobabongwe: 9, some: 10, lesome: 10,
  'masome a mabedi': 20, 'masome a mararo': 30, 'masome a mane': 40, 'masome a matlhano': 50,
  'masome a marataro': 60, 'masome a supa': 70, 'masome a robedi': 80, 'masome a robongwe': 90,
  lekgolo: 100, 'makgolo a mabedi': 200, 'makgolo a mararo': 300, 'makgolo a mane': 400,
  'makgolo a matlhano': 500, sekete: 1000, 'dikete tse pedi': 2000,
};

// NOTE: no /g flag — RegExp#test with /g is stateful and would alternate results.
const CURRENCY_WORDS: Array<{ re: RegExp; code: string }> = [
  { re: /\bp(?!\w)|\bpula\b|\bbwp\b|\bthebe\b/i, code: 'BWP' },
  { re: /\br\b|\brand\b|\brands\b|\bzar\b/i, code: 'ZAR' },
  { re: /\$|\busd\b|\bdollars?\b/i, code: 'USD' },
];

function minorUnits(code: string): number {
  return MINOR_UNITS[code] ?? 2;
}

function toMinor(value: number, code: string): number {
  return Math.round(value * 10 ** minorUnits(code));
}

/** Parses "1,250.50" / "1250" / "50.5". */
function numeric(text: string, code: string): number | null {
  const cleaned = text.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return toMinor(Number(cleaned), code);
}

/** Parses English number words: "fifty", "twenty five", "one hundred and fifty", "two thousand". */
function englishWords(tokens: string[]): { value: number | null; used: number } {
  let total = 0;
  let current = 0;
  let used = 0;
  let saw = false;
  for (const token of tokens) {
    if (token in ONES || token in TENS) {
      current += ONES[token] ?? TENS[token] ?? 0;
      used++;
      saw = true;
    } else if (token in SCALES) {
      const scale = SCALES[token]!;
      current = (current === 0 ? 1 : current) * scale;
      total += current;
      current = 0;
      used++;
      saw = true;
    } else if (saw && (token === 'and' || token === 'le')) {
      used++;
    } else if (saw) {
      break;
    } else {
      return { value: null, used: 0 };
    }
  }
  if (!saw) return { value: null, used: 0 };
  return { value: total + current, used };
}

/** Parses Setswana number words, including multi-word forms like "masome a matlhano". */
function setswanaWords(tokens: string[]): { value: number | null; used: number } {
  let total = 0;
  let used = 0;
  let saw = false;
  let i = 0;
  while (i < tokens.length) {
    const three = tokens.slice(i, i + 3).join(' ');
    const two = tokens.slice(i, i + 2).join(' ');
    if (TN_NUMERALS[three] !== undefined) {
      total += TN_NUMERALS[three]!;
      i += 3;
      used += 3;
      saw = true;
      continue;
    }
    if (TN_NUMERALS[two] !== undefined) {
      total += TN_NUMERALS[two]!;
      i += 2;
      used += 2;
      saw = true;
      continue;
    }
    if (TN_NUMERALS[tokens[i]!] !== undefined) {
      total += TN_NUMERALS[tokens[i]!]!;
      i += 1;
      used += 1;
      saw = true;
      continue;
    }
    if (saw && (tokens[i] === 'le' || tokens[i] === 'mo')) {
      i += 1;
      used += 1;
      continue;
    }
    break;
  }
  return saw ? { value: total, used } : { value: null, used: 0 };
}

/** Extracts the first amount it can find, together with its currency. */
export function extractAmount(text: string, defaultCurrency = 'BWP'): ParsedAmount | null {
  const tokens = tokenizeForAmounts(text);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;

    // 1) Symbol-prefixed or plain numerals: P50, P 50, P50.00, 1,250.00, 50
    const numericMatch = /^([A-Za-z$]{0,3})\s*(\d[\d,]*(?:\.\d{1,2})?)$/.exec(token);
    if (numericMatch) {
      const [, prefix = '', digits] = numericMatch;
      let currency = defaultCurrency;
      let explicit = false;
      for (const { re, code } of CURRENCY_WORDS) {
        if (prefix && re.test(prefix)) {
          currency = code;
          explicit = true;
          break;
        }
      }
      // "P50" where P is the pula symbol
      if (/^p$/i.test(prefix) || /^\$/.test(prefix)) {
        currency = /^\$/.test(prefix) ? 'USD' : currency;
        explicit = true;
      }
      const next = (tokens[i + 1] ?? '').toLowerCase();
      const isThebe = next === 'thebe';
      const value = numeric(digits!, currency);
      if (value !== null) {
        return {
          // "50 thebe" is already in minor units, so it must not be multiplied by 100.
          minor: isThebe ? Number(digits!.replace(/,/g, '')) : value,
          currency,
          explicitCurrency: explicit || isThebe,
          matchedText: isThebe ? `${token} ${tokens[i + 1]}` : token,
        };
      }
    }

    // 2) Number words (English then Setswana)
    const en = englishWords(tokens.slice(i));
    const tn = setswanaWords(tokens.slice(i));
    const best = (en.value ?? 0) >= (tn.value ?? 0) ? en : tn;
    if (best.value !== null && best.used > 0) {
      const window = tokens.slice(i, i + best.used + 2);
      let currency = defaultCurrency;
      let explicit = false;
      for (const { re, code } of CURRENCY_WORDS) {
        if (window.some((w) => re.test(w) && !/^(p)$/i.test(w))) {
          currency = code;
          explicit = true;
          break;
        }
      }
      // "50 thebe" — thebe is a minor unit, not a major one
      const isThebe = window.some((w) => /^thebe$/i.test(w));
      const minor = isThebe ? Math.round(best.value) : toMinor(best.value, currency);
      return {
        minor,
        currency,
        explicitCurrency: explicit || isThebe,
        matchedText: tokens.slice(i, i + best.used).join(' '),
      };
    }
  }
  return null;
}

function tokenizeForAmounts(text: string): string[] {
  return text
    .replace(/\bp\s*(?=\d)/gi, (m) => m.trim().toUpperCase() + ' ') // keep "P50" -> "P 50"
    .replace(/[^\p{L}\p{N}\s.,$]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function formatMinor(minor: number, currency: string): string {
  const exp = minorUnits(currency);
  const abs = Math.abs(minor).toString().padStart(exp + 1, '0');
  const int = abs.slice(0, abs.length - exp);
  const frac = exp === 0 ? '' : '.' + abs.slice(abs.length - exp);
  return `${minor < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac}`;
}
