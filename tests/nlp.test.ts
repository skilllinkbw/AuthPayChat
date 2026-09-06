import { describe, it, expect } from 'vitest';
import { parsePaymentCommand, parseVoiceCommand, flagUnsupportedMethod, detectLanguage } from '@paychat/nlp';

const contacts = [
  { id: 'usr_motakase', label: 'Motakase M.', subtitle: '+267 71 000 001' },
  { id: 'usr_john', label: 'John S.', subtitle: '+267 72 000 002' },
  { id: 'usr_neo', label: 'Neo K.', subtitle: '+267 73 000 003' },
  { id: 'usr_thato', label: 'Thato B.', subtitle: '+267 74 000 004' },
];

/** Name resolver that mirrors server behaviour: exact-ish match on display name. */
function resolve(query: string) {
  const q = query.toLowerCase();
  return contacts.filter((c) => c.label.toLowerCase().startsWith(q.split(' ')[0]!));
}

describe('NLP — English payment commands', () => {
  it('parses "Pay P50 Motakase"', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(5000);
    expect(intent.currency).toBe('BWP');
    expect(intent.recipientQuery).toBe('usr_motakase');
    expect(intent.clarification).toBeUndefined();
  });

  it('parses "Pay P50.00 Motakase" with decimals', () => {
    const intent = parsePaymentCommand('Pay P50.00 Motakase', { resolveRecipient: resolve });
    expect(intent.amountMinor).toBe(5000);
  });

  it('parses "Pay P100 to John"', () => {
    const intent = parsePaymentCommand('Pay P100 to John', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(10000);
    expect(intent.recipientQuery).toBe('usr_john');
  });

  it('parses "Send P25 to Neo"', () => {
    const intent = parsePaymentCommand('Send P25 to Neo', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(2500);
    expect(intent.recipientQuery).toBe('usr_neo');
  });

  it('parses "Request P200 from Thato" as a REQUEST', () => {
    const intent = parsePaymentCommand('Request P200 from Thato', { resolveRecipient: resolve });
    expect(intent.action).toBe('REQUEST');
    expect(intent.amountMinor).toBe(20000);
    expect(intent.recipientQuery).toBe('usr_thato');
  });

  it('extracts a payment-method phrase without hard-coding any provider', () => {
    // The NLP package returns the phrase the user used; mapping it to a provider is the
    // registry's job (configuration), so no provider name lives in this package.
    const intent = parsePaymentCommand('Pay P50 Motakase using Orange Money', { resolveRecipient: resolve });
    expect(intent.paymentMethodQuery).toBe('orange money');
    expect(intent.amountMinor).toBe(5000);
  });

  it('parses number words: "Pay fifty pula to Motakase"', () => {
    const intent = parsePaymentCommand('Pay fifty pula to Motakase', { resolveRecipient: resolve });
    expect(intent.amountMinor).toBe(5000);
    expect(intent.currency).toBe('BWP');
  });

  it('parses thousands with separators: "Pay P1,250.50 Motakase"', () => {
    const intent = parsePaymentCommand('Pay P1,250.50 Motakase', { resolveRecipient: resolve });
    expect(intent.amountMinor).toBe(125050);
  });

  it('parses thebe: "Pay 50 thebe Motakase"', () => {
    const intent = parsePaymentCommand('Pay 50 thebe Motakase', { resolveRecipient: resolve });
    expect(intent.amountMinor).toBe(50);
  });
});

describe('NLP — Setswana payment commands', () => {
  it('parses "Duela Motakase P50"', () => {
    const intent = parsePaymentCommand('Duela Motakase P50', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(5000);
    expect(intent.recipientQuery).toBe('usr_motakase');
    expect(['tn', 'mixed']).toContain(intent.language);
  });

  it('parses "Ke batla go duela Motakase P50"', () => {
    const intent = parsePaymentCommand('Ke batla go duela Motakase P50', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(5000);
    expect(intent.recipientQuery).toBe('usr_motakase');
  });

  it('parses "Nthuse go duela Motakase P50"', () => {
    const intent = parsePaymentCommand('Nthuse go duela Motakase P50', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(5000);
  });

  it('parses "Duela Motakase P50 ka Orange Money"', () => {
    const intent = parsePaymentCommand('Duela Motakase P50 ka Orange Money', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(5000);
    expect(intent.paymentMethodQuery).toBe('orange money');
    expect(intent.recipientQuery).toBe('usr_motakase');
  });

  it('parses "Kopa Thato P200" as a request', () => {
    const intent = parsePaymentCommand('Kopa Thato P200', { resolveRecipient: resolve });
    expect(intent.action).toBe('REQUEST');
    expect(intent.amountMinor).toBe(20000);
  });

  it('parses Setswana number words: "Duela Motakase masome a matlhano pula"', () => {
    const intent = parsePaymentCommand('Duela Motakase masome a matlhano pula', { resolveRecipient: resolve });
    expect(intent.amountMinor).toBe(5000);
  });

  it('parses "Romela Neo P25"', () => {
    const intent = parsePaymentCommand('Romela Neo P25', { resolveRecipient: resolve });
    expect(intent.action).toBe('PAY');
    expect(intent.amountMinor).toBe(2500);
  });
});

describe('NLP — ambiguity is never guessed', () => {
  it('asks for the amount when it is missing', () => {
    const intent = parsePaymentCommand('Pay Motakase', { resolveRecipient: resolve });
    expect(intent.clarification?.field).toBe('amount');
    expect(intent.clarification?.prompt.en).toContain('How much');
  });

  it('asks for the recipient when it is missing', () => {
    const intent = parsePaymentCommand('Pay P50', { resolveRecipient: resolve });
    expect(intent.clarification?.field).toBe('recipient');
  });

  it('asks which contact when several match', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase', {
      resolveRecipient: () => [
        { id: 'usr_motakase_m', label: 'Motakase M.' },
        { id: 'usr_motakase_k', label: 'Motakase K.' },
      ],
    });
    expect(intent.clarification?.field).toBe('recipient_ambiguous');
    expect(intent.clarification?.candidates).toHaveLength(2);
  });

  it('does not silently accept an unknown contact', () => {
    const intent = parsePaymentCommand('Pay P50 Stranger', {
      resolveRecipient: () => [],
    });
    expect(intent.clarification?.field).toBe('recipient');
  });

  it('flags an unsupported payment method instead of falling back silently', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase using Bitcoin', { resolveRecipient: resolve });
    const checked = flagUnsupportedMethod(intent, ['orange_money', 'myzaka', 'bank']);
    expect(checked.clarification?.field).toBe('payment_method');
  });

  it('asks what the user means when there is no action and no recipient', () => {
    const intent = parsePaymentCommand('P50', { resolveRecipient: resolve });
    expect(intent.clarification?.field).toBe('action');
  });
});

describe('NLP — language detection and voice', () => {
  it('detects Setswana', () => {
    expect(detectLanguage('Duela Motakase P50')).toBe('tn');
  });

  it('detects English', () => {
    expect(detectLanguage('Pay P50 Motakase')).toBe('en');
  });

  it('routes voice transcripts through the same parser and records the source', () => {
    const spoken = parseVoiceCommand('duela motakase p50', { resolveRecipient: resolve });
    expect(spoken.action).toBe('PAY');
    expect(spoken.amountMinor).toBe(5000);
    expect(spoken.parseNotes).toContain('source: voice');
    expect(spoken.clarification).toBeUndefined();
  });

  it('never produces a negative or zero amount from junk input', () => {
    const intent = parsePaymentCommand('Pay P-5 Motakase', { resolveRecipient: resolve });
    expect(intent.amountMinor === undefined || intent.amountMinor > 0).toBe(true);
  });
});
