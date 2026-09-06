/**
 * Money primitives.
 * Rule: every monetary amount in PayChat is an INTEGER in the currency's minor unit.
 * BWP minor unit = thebe (100 thebe = 1 pula). Never use floats for money.
 */

export type CurrencyCode = 'BWP' | 'ZAR' | 'USD' | (string & {});

export interface Money {
  /** Integer amount in minor units (thebe, cents, ...). */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

/** Minor-unit exponents by currency (ISO 4217). */
const MINOR_UNITS: Record<string, number> = {
  BWP: 2, ZAR: 2, USD: 2, EUR: 2, GBP: 2, KES: 2, GHS: 2, NGN: 2, ZMW: 2, NAD: 2, TZS: 2, UGX: 0, JPY: 0,
};

export function minorUnits(currency: string): number {
  return MINOR_UNITS[currency.toUpperCase()] ?? 2;
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isInteger(minor)) throw new Error(`money: amount must be an integer (got ${minor})`);
  if (!Number.isSafeInteger(minor)) throw new Error('money: amount outside safe integer range');
  return { minor, currency: currency.toUpperCase() as CurrencyCode };
}

/** Parse a decimal string ("50", "50.5", "1,250.00") into minor units. */
export function fromDecimal(value: string | number, currency: CurrencyCode): Money {
  const exp = minorUnits(currency);
  const raw = typeof value === 'number' ? value.toFixed(exp) : String(value).trim().replace(/[,\s_]/g, '');
  if (!/^-?\d*(\.\d+)?$/.test(raw) || raw === '' || raw === '.' || raw === '-') {
    throw new Error(`money: cannot parse "${value}"`);
  }
  const negative = raw.startsWith('-');
  const [intPart = '0', fracPart = ''] = raw.replace('-', '').split('.');
  const frac = (fracPart + '0'.repeat(exp)).slice(0, exp);
  const roundedExtra = fracPart.length > exp && Number(fracPart[exp]) >= 5 ? 1 : 0;
  const minor = (Number(intPart) * 10 ** exp + Number(frac) + roundedExtra) * (negative ? -1 : 0 + (negative ? 0 : 1));
  return money(minor, currency);
}

/** Format for display. Symbol is supplied by the UI layer (i18n); we never guess the user's locale here. */
export function toDecimal(m: Money): string {
  const exp = minorUnits(m.currency);
  const sign = m.minor < 0 ? '-' : '';
  const abs = Math.abs(m.minor).toString().padStart(exp + 1, '0');
  const int = abs.slice(0, abs.length - exp);
  const frac = exp === 0 ? '' : '.' + abs.slice(abs.length - exp);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${frac}`;
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`currency mismatch: ${a.currency} vs ${b.currency} — never aggregate across currencies`);
  }
}

export function isPositive(m: Money): boolean {
  return m.minor > 0;
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.minor - b.minor;
}

/** Aggregates only when every entry shares one currency; otherwise returns null (never a false total). */
export function sumSameCurrency(values: Money[]): Money | null {
  if (values.length === 0) return null;
  const currency = values[0]!.currency;
  if (values.some((v) => v.currency !== currency)) return null;
  return money(values.reduce((acc, v) => acc + v.minor, 0), currency);
}
