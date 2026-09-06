/**
 * Natural-language payment intent extraction.
 *
 * HARD RULE: the output of this module is a PROPOSED intent only.
 * It is never authorisation. The backend re-validates amount, recipient,
 * account ownership and balance before anything moves.
 * If anything is ambiguous, we ask — we never guess a recipient for a financial transaction.
 */

import { detectLanguage, tokenize, type Language } from './language';
import { extractAmount } from './amounts';

export type IntentAction = 'PAY' | 'REQUEST' | 'UNKNOWN';

export type ClarificationField =
  | 'amount' | 'recipient' | 'payment_method' | 'payment_method_ambiguous' | 'recipient_ambiguous' | 'action';

export interface Clarification {
  field: ClarificationField;
  /** Bilingual prompts — the UI picks by user language, never guessing. */
  prompt: { en: string; tn: string };
  candidates?: Array<{ id: string; label: string; subtitle?: string }>;
}

export interface PaymentIntent {
  action: IntentAction;
  amountMinor?: number;
  currency: string;
  recipientQuery?: string;
  paymentMethodQuery?: string;
  language: Language;
  /** 0..1 — how confident the extractor is. Low confidence ALWAYS yields a clarification. */
  confidence: number;
  raw: string;
  /** When present the intent must NOT be executed: show the clarification instead. */
  clarification?: Clarification;
  parseNotes: string[];
}

const PAY_WORDS = ['pay', 'send', 'transfer', 'duela', 'romela', 'ntsha', 'tuelo', 'paye'];
const REQUEST_WORDS = ['request', 'ask', 'charge', 'kopa', 'batla', 'lopa', 'kopo'];

const STOP_WORDS = new Set([
  'pay', 'send', 'transfer', 'request', 'ask', 'charge',
  'duela', 'romela', 'ntsha', 'kopa', 'batla', 'lopa', 'tuelo', 'kopo',
  'to', 'from', 'for', 'please', 'the', 'a', 'an', 'of', 'my', 'me', 'i',
  'go', 'mo', 'ka', 'le', 'ke', 'batla', 'nthuse', 'tsweetswee', 'want', 'would', 'like',
  'using', 'with', 'via', 'through', 'now', 'some', 'money', 'madi', 'pula', 'thebe',
  'and', 'then', 'kindly', 'help', 'nthus', 'nthuse',
  // currency tokens must never survive as a recipient name
  'p', 'bwp', 'zar', 'usd', '$', 'rand', 'dollar', 'dollars',
]);

/**
 * Method extraction is DELIBERATELY provider-agnostic.
 *
 * This package has no list of providers, rails, banks or wallets — that list is data owned
 * by the deployment (registry configuration). Here we only extract the PHRASE the user used
 * to name a method ("ka <provider>", "using my wallet app"); the backend maps that
 * phrase onto the providers this deployment actually supports and, when it cannot, asks the
 * user instead of assuming.
 */
const METHOD_INTRO = /(?:using|with|via|through|on|from|ka|le)\s+([\p{L}\p{N}][\p{L}\p{N} .+-]{1,28})$/iu;
const METHOD_LEAD = /^(?:using|with|via|through|ka|le)\s+([\p{L}\p{N}][\p{L}\p{N} .+-]{1,28}?)\s+(?:pay|send|transfer|duela|romela|ntsha|ke|go|to|please)\b/iu;

function detectAction(tokens: string[]): IntentAction {
  let sawRequest = false;
  for (const t of tokens) {
    const clean = t.replace(/[^\p{L}]/gu, '');
    // "Ke batla go duela" — "batla" means "want", not "request", when a pay verb follows.
    if (PAY_WORDS.includes(clean)) return 'PAY';
    if (REQUEST_WORDS.includes(clean)) sawRequest = true;
  }
  return sawRequest ? 'REQUEST' : 'UNKNOWN';
}

function detectMethod(text: string, amountMatched: string | null): { phrase: string; matched: string } | null {
  let working = text.trim().replace(/\s+/g, ' ');
  if (amountMatched) working = working.replace(amountMatched, ' ').replace(/\s+/g, ' ').trim();
  const match = METHOD_LEAD.exec(working) ?? METHOD_INTRO.exec(working);
  if (!match?.[1]) return null;
  const named = match[1].trim().replace(/[.,;!?]+$/u, '').trim();
  if (named.length < 2 || named.length > 30) return null;
  // A method phrase never contains a currency or a bare number.
  if (/^\d+$/.test(named) || /^(?:p|bwp|zar|usd|rand|dollar|dollars|madi|pula|thebe)$/iu.test(named)) return null;
  return { phrase: named.toLowerCase(), matched: match[0] };
}

function stripMethod(text: string, matched: string | null): string {
  if (!matched) return text;
  const idx = text.toLowerCase().indexOf(matched);
  if (idx < 0) return text;
  return (text.slice(0, idx) + ' ' + text.slice(idx + matched.length)).replace(/\s+/g, ' ').trim();
}

function extractRecipient(text: string, amountMatched: string | null, methodMatched: string | null): string | undefined {
  let working = text;
  if (amountMatched) working = working.replace(amountMatched, ' ');
  working = stripMethod(working, methodMatched);
  const tokens = tokenize(working)
    .map((t) => t.replace(/^\p{P}+|\p{P}+$/gu, ''))
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t) && !/^\d/.test(t));
  if (!tokens.length) return undefined;
  // Recipient names are capitalised in natural typing; restore the original casing.
  const original = new Map(text.split(/\s+/).map((w) => [w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), w] as const));
  return tokens.map((t) => original.get(t) ?? t).join(' ').trim();
}

export interface ParseOptions {
  defaultCurrency?: string;
  /** Supplied by the backend: resolves a name to contacts so ambiguity can be detected, never guessed. */
  resolveRecipient?: (query: string) => Array<{ id: string; label: string; subtitle?: string }>;
  /** Minimum confidence before we ask the user to confirm/clarify. */
  minConfidence?: number;
}

const PROMPTS: Record<ClarificationField, { en: string; tn: string }> = {
  amount: {
    en: 'How much would you like to send?',
    tn: 'O batla go romela bokae?',
  },
  recipient: {
    en: 'Who should receive this payment?',
    tn: 'Madi a a ya go mang?',
  },
  payment_method: {
    en: 'That payment method is not available on your account. Please choose one you have connected.',
    tn: 'Mokgwa o o duelang ga o yo mo akhaontong ya gago. Tsweetswee tlhopha o o o golagantseng.',
  },
  recipient_ambiguous: {
    en: 'I found more than one contact with that name. Which one do you want to pay?',
    tn: 'Ke bone batho ba le bantsi ba ba nang le leina leo. O batla go duela ofe?',
  },
  payment_method_ambiguous: {
    en: 'More than one of your accounts can send that way. Which one should I use?',
    tn: 'Go na le diakhaonto tse di fetang bongwe tse di ka duelang ka mokgwa oo. Ke dirise efe?',
  },
  action: {
    en: 'Do you want to send money or request money?',
    tn: 'A o batla go romela madi kgotsa go kopa madi?',
  },
};

/** Extracts a proposed payment intent. Never throws on user input. */
export function parsePaymentCommand(text: string, options: ParseOptions = {}): PaymentIntent {
  const raw = text.trim();
  const notes: string[] = [];
  const language = detectLanguage(raw);
  const tokens = tokenize(raw);
  const action = detectAction(tokens);
  const amount = extractAmount(raw, options.defaultCurrency ?? 'BWP');
  const method = detectMethod(raw, amount?.matchedText ?? null);

  let confidence = 0.4;
  if (action !== 'UNKNOWN') confidence += 0.25;
  if (amount) confidence += 0.25;

  const recipientQuery = extractRecipient(raw, amount?.matchedText ?? null, method?.matched ?? null);
  if (recipientQuery) confidence += 0.1;
  if (method) confidence += 0.05;
  confidence = Math.min(1, Number(confidence.toFixed(2)));

  const intent: PaymentIntent = {
    action,
    amountMinor: amount?.minor,
    currency: amount?.currency ?? options.defaultCurrency ?? 'BWP',
    recipientQuery,
    paymentMethodQuery: method?.phrase,
    language,
    confidence,
    raw,
    parseNotes: notes,
  };

  if (action === 'UNKNOWN' && amount) {
    // "P50 Motakase" with no verb — treat as a pay request only if a recipient is present.
    if (recipientQuery) {
      intent.action = 'PAY';
      notes.push('action inferred as PAY from amount+recipient');
    } else {
      intent.clarification = { field: 'action', prompt: PROMPTS.action };
      return intent;
    }
  }

  if (intent.amountMinor === undefined) {
    intent.clarification = { field: 'amount', prompt: PROMPTS.amount };
    return intent;
  }

  if (!recipientQuery) {
    intent.clarification = { field: 'recipient', prompt: PROMPTS.recipient };
    return intent;
  }

  if (options.resolveRecipient) {
    const candidates = options.resolveRecipient(recipientQuery);
    if (candidates.length === 0) {
      intent.clarification = { field: 'recipient', prompt: PROMPTS.recipient };
      return intent;
    }
    if (candidates.length > 1) {
      intent.clarification = {
        field: 'recipient_ambiguous',
        prompt: PROMPTS.recipient_ambiguous,
        candidates,
      };
      return intent;
    }
    intent.recipientQuery = candidates[0]!.id;
  }

  if (!amount?.explicitCurrency) notes.push(`currency defaulted to ${intent.currency}`);

  return intent;
}

/** An unsupported method phrase was recognised but is not connectable for this user. */
/**
 * Marks an intent as needing clarification when the named method cannot be resolved to an
 * available provider, or when it resolves to more than one. Providers are supplied by the
 * caller (from the registry) — this package holds no provider list of its own.
 */
export function flagUnsupportedMethod(
  intent: PaymentIntent,
  availableMethods: string[],
  resolveMethod?: (phrase: string) => Array<{ id: string; displayName: string }>,
): PaymentIntent {
  if (!intent.paymentMethodQuery) return intent;
  const available = availableMethods.map((m) => m.toLowerCase());
  const matches = resolveMethod ? resolveMethod(intent.paymentMethodQuery) : [];
  if (matches.length === 1) {
    const only = matches[0]!;
    if (!available.includes(only.id.toLowerCase()) && !available.includes(only.displayName.toLowerCase())) {
      return { ...intent, clarification: { field: 'payment_method', prompt: PROMPTS.payment_method } };
    }
    return intent;
  }
  if (matches.length > 1) {
    return {
      ...intent,
      clarification: {
        field: 'payment_method_ambiguous',
        prompt: PROMPTS.payment_method_ambiguous ?? PROMPTS.payment_method,
        candidates: matches.map((m) => ({ id: m.id, label: m.displayName })),
      },
    };
  }
  // Nothing recognised: never guess a rail, always ask.
  return { ...intent, clarification: { field: 'payment_method', prompt: PROMPTS.payment_method } };
}

/** Voice input is converted to text first, then routed through exactly the same parser. */
export function parseVoiceCommand(transcript: string, options: ParseOptions = {}): PaymentIntent {
  const cleaned = transcript.trim().replace(/\s+/g, ' ');
  const intent = parsePaymentCommand(cleaned, options);
  intent.parseNotes.push('source: voice');
  return intent;
}
