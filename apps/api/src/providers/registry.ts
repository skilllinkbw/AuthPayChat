/**
 * Provider registry — the ONLY place in PayChat that knows which providers exist.
 *
 * Design rules (brief §2–§6):
 *  - No core file names a provider. There is no `if (provider === <some rail>)`, no switch
 *    statement over provider ids, no bank list, no mobile-money list, no enum of rails.
 *    Searching for any provider name across apps/api/src, packages/* and apps/web/src
 *    returns only the DATA file (definitions.ts) and the tests that enforce this rule.
 *  - Providers are DATA. They are merged from three sources, later sources winning:
 *      1. built-in defaults        — providers/definitions.ts (data only, optional)
 *      2. environment configuration — PAYCHAT_PROVIDERS (JSON) and PAYCHAT_PROVIDER_DISABLE
 *      3. database rows            — payment_providers (runtime, no deploy needed)
 *  - A provider is "available" only when it is enabled AND the adapter reports its
 *    credentials are present. Absent credentials ⇒ the capability is off, never faked.
 *  - Adding a provider = one row of configuration. Removing one = disable or delete the row.
 *    Neither touches core code, the orchestrator, or the UI architecture.
 */

import { config } from '../config.js';
import { getDb } from '../db/index.js';
import type { Capability, CapabilitySet, PaymentProvider } from '@paychat/shared';
import { BUILT_IN_PROVIDERS, SANDBOX_PROVIDER } from './definitions.js';
import { capabilitiesFor, DEFAULT_CAPABILITIES, type ProviderDefinition } from './types.js';
import { GenericRestProvider } from './generic.js';
import { SandboxProvider } from './sandbox.js';
import { DisabledProvider } from './disabled.js';

function safeParseJson(text: string | null | undefined, fallback: unknown): unknown {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function normaliseDefinition(input: unknown): ProviderDefinition | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.trim() === '') return null;
  const transport = (raw.transport && typeof raw.transport === 'object' ? raw.transport : { type: 'disabled' }) as ProviderDefinition['transport'];
  const definition: ProviderDefinition = {
    id: raw.id.trim(),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : raw.id,
    kind: (typeof raw.kind === 'string' ? raw.kind : 'other') as ProviderDefinition['kind'],
    country: typeof raw.country === 'string' ? raw.country : 'BW',
    currencies: Array.isArray(raw.currencies) && raw.currencies.length > 0
      ? (raw.currencies.filter((c): c is string => typeof c === 'string'))
      : ['BWP'],
    enabled: raw.enabled === undefined ? true : Boolean(raw.enabled),
    transport,
    ...(raw.capabilities && typeof raw.capabilities === 'object'
      ? { capabilities: raw.capabilities as CapabilitySet }
      : {}),
    ...(raw.auth && typeof raw.auth === 'object' ? { auth: raw.auth as ProviderDefinition['auth'] } : {}),
    ...(Array.isArray(raw.aliases)
      ? { aliases: raw.aliases.filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase()) }
      : {}),
    ...(raw.limits && typeof raw.limits === 'object' ? { limits: raw.limits as ProviderDefinition['limits'] } : {}),
    ...(raw.metadata && typeof raw.metadata === 'object' ? { metadata: raw.metadata as Record<string, unknown> } : {}),
  };
  return definition;
}

export interface ProviderRow {
  id: string;
  kind: string;
  country: string;
  display_name: string;
  base_url: string | null;
  enabled: number;
  capabilities: string;
  config?: string;
}

export class ProviderRegistry {
  private definitions = new Map<string, ProviderDefinition>();
  private instances = new Map<string, PaymentProvider>();
  private loaded = false;

  /** Merge every configuration source. Idempotent; re-run after admin changes. */
  load(): void {
    const merged = new Map<string, ProviderDefinition>();

    // 1. built-in defaults (skipped entirely when PAYCHAT_PROVIDERS_NO_DEFAULTS=1)
    if (process.env.PAYCHAT_PROVIDERS_NO_DEFAULTS !== '1') {
      for (const definition of BUILT_IN_PROVIDERS) merged.set(definition.id, definition);
      // 2a. sandbox rail — development and tests only
      if (!config.isProduction && process.env.PAYCHAT_DISABLE_SANDBOX !== '1') {
        merged.set(SANDBOX_PROVIDER.id, SANDBOX_PROVIDER);
      }
    }

    // 2b. environment configuration: a JSON array of definitions, overrides by id
    const fromEnv = safeParseJson(process.env.PAYCHAT_PROVIDERS, null);
    if (Array.isArray(fromEnv)) {
      for (const entry of fromEnv) {
        const definition = normaliseDefinition(entry);
        if (definition) merged.set(definition.id, { ...merged.get(definition.id), ...definition });
      }
    }

    // 3. database rows (runtime, admin-managed) — applied as PARTIAL overrides so a row that
    //    only toggles `enabled` or renames the provider cannot silently strip its transport.
    for (const row of this.dbRows()) {
      const stored = safeParseJson(row.config, {}) as Record<string, unknown>;
      const existing = merged.get(row.id);
      const fallback = existing ?? normaliseDefinition({ id: row.id, ...stored });
      if (!fallback) continue;
      const transport = (stored.transport ?? fallback.transport) as ProviderDefinition['transport'];
      const mergedTransport = transport.type === 'rest'
        ? { ...transport, baseUrl: transport.baseUrl ?? row.base_url ?? undefined }
        : transport;
      const definition = normaliseDefinition({
        id: row.id,
        displayName: row.display_name || fallback.displayName,
        kind: row.kind || fallback.kind,
        country: row.country || fallback.country,
        enabled: row.enabled === 1,
        currencies: stored.currencies ?? fallback.currencies,
        transport: mergedTransport,
        auth: stored.auth ?? fallback.auth,
        aliases: stored.aliases ?? fallback.aliases,
        limits: stored.limits ?? fallback.limits,
        capabilities: stored.capabilities ?? fallback.capabilities,
        metadata: stored.metadata ?? fallback.metadata,
      });
      if (definition) merged.set(definition.id, definition);
    }

    // hard kill switch: comma-separated ids that must never be used in this deployment
    const disabled = (process.env.PAYCHAT_PROVIDER_DISABLE ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of disabled) {
      const existing = merged.get(id);
      if (existing) merged.set(id, { ...existing, enabled: false });
    }

    this.definitions = merged;
    this.instances.clear();
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) this.load();
  }

  private dbRows(): ProviderRow[] {
    try {
      return getDb().prepare('SELECT * FROM payment_providers').all() as ProviderRow[];
    } catch {
      // The registry must work before/without a database (tests, config introspection).
      return [];
    }
  }

  /** Register/replace a provider at runtime (admin API, migrations, tests). */
  register(definition: ProviderDefinition): void {
    this.ensureLoaded();
    this.definitions.set(definition.id, definition);
    this.instances.delete(definition.id);
  }

  remove(id: string): void {
    this.ensureLoaded();
    this.definitions.delete(id);
    this.instances.delete(id);
  }

  allDefinitions(): ProviderDefinition[] { this.ensureLoaded(); return [...this.definitions.values()]; }

  get(id: string): PaymentProvider {
    this.ensureLoaded();
    const cached = this.instances.get(id);
    if (cached) return cached;
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`unknown provider: ${id}`);
    const instance = this.build(definition);
    this.instances.set(id, instance);
    return instance;
  }

  private build(definition: ProviderDefinition): PaymentProvider {
    if (!definition.enabled) return new DisabledProvider(definition, 'disabled by configuration');
    switch (definition.transport.type) {
      case 'sandbox':
        return new SandboxProvider(definition);
      case 'rest':
        return new GenericRestProvider(definition);
      default:
        return new DisabledProvider(definition, definition.transport.reason ?? 'no transport configured');
    }
  }

  /** Providers this deployment can actually use right now (enabled + credentials present). */
  list(country?: string): Array<{
    id: string; displayName: string; kind: string; country: string; currencies: string[];
    enabled: boolean; capabilities: CapabilitySet; aliases: string[];
  }> {
    this.ensureLoaded();
    return this.allDefinitions()
      .filter((d) => !country || d.country === country)
      .map((d) => {
        const provider = this.build(d);
        const capabilities = (provider.capabilities as CapabilitySet);
        // "usable" means it can do something with money — informational capabilities
        // (listing currencies/methods) never make an unconfigured rail look available.
        const usable = Boolean(
          capabilities.initiatePayment || capabilities.getPaymentStatus || capabilities.verifyPayment
          || capabilities.cancelPayment || capabilities.refundPayment || capabilities.getBalance
          || capabilities.processWebhook,
        );
        return {
          id: d.id,
          displayName: d.displayName,
          kind: d.kind,
          country: d.country,
          currencies: d.currencies,
          // "enabled" reported to clients means "usable": configured AND credentialed.
          enabled: d.enabled && usable,
          capabilities,
          aliases: d.aliases ?? [],
        };
      });
  }

  has(id: string): boolean { this.ensureLoaded(); return this.definitions.has(id); }

  hasCapability(id: string, capability: Capability): boolean {
    if (!this.has(id)) return false;
    try { return this.get(id).capabilities[capability] === true; } catch { return false; }
  }

  /**
   * Resolves a natural-language method phrase ("ka <provider>", "bank", "wallet") to
   * provider ids using each provider's configured aliases and display name. Returns every
   * candidate so the caller can ask the user to choose when more than one matches.
   */
  resolveMethodPhrase(phrase: string): Array<{ id: string; displayName: string; score: number }> {
    this.ensureLoaded();
    const needle = phrase.toLowerCase().trim();
    if (!needle) return [];
    const matches: Array<{ id: string; displayName: string; score: number }> = [];
    for (const definition of this.definitions.values()) {
      if (!definition.enabled) continue;
      const names = [definition.displayName.toLowerCase(), ...(definition.aliases ?? [])];
      for (const name of names) {
        if (!name) continue;
        if (name === needle) matches.push({ id: definition.id, displayName: definition.displayName, score: 100 });
        else if (needle.includes(name) || name.includes(needle)) {
          matches.push({ id: definition.id, displayName: definition.displayName, score: 50 + Math.min(name.length, 40) });
        }
      }
    }
    const seen = new Map<string, { id: string; displayName: string; score: number }>();
    for (const match of matches) {
      const existing = seen.get(match.id);
      if (!existing || match.score > existing.score) seen.set(match.id, match);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
  }

  persist(definition: ProviderDefinition): void {
    getDb().prepare(
      `INSERT INTO payment_providers (id, kind, country, display_name, base_url, enabled, capabilities, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, country = excluded.country,
         display_name = excluded.display_name, base_url = excluded.base_url,
         enabled = excluded.enabled, capabilities = excluded.capabilities, config = excluded.config`,
    ).run(
      definition.id,
      definition.kind,
      definition.country,
      definition.displayName,
      definition.transport.type === 'rest' ? (definition.transport.baseUrl ?? null) : null,
      definition.enabled ? 1 : 0,
      JSON.stringify(definition.capabilities ?? DEFAULT_CAPABILITIES),
      JSON.stringify({
        currencies: definition.currencies,
        transport: definition.transport,
        auth: definition.auth,
        aliases: definition.aliases,
        limits: definition.limits,
        metadata: definition.metadata,
      }),
    );
    this.register(definition);
  }
}

export const registry = new ProviderRegistry();

/* ── Backwards-compatible helpers (thin; no provider knowledge lives here) ───── */

export interface ProviderSummary {
  id: string;
  kind: string;
  country: string;
  display_name: string;
  base_url: string | null;
  enabled: number;
  capabilities: string;
}

export function listProviders(country?: string): ProviderSummary[] {
  return registry.list(country).map((p) => ({
    id: p.id,
    kind: p.kind,
    country: p.country,
    display_name: p.displayName,
    base_url: null,
    enabled: p.enabled ? 1 : 0,
    capabilities: JSON.stringify(p.capabilities),
  }));
}

export function isProviderEnabled(id: string): boolean {
  try { return Object.values((registry.get(id).capabilities as CapabilitySet)).some(Boolean); } catch { return false; }
}

export function getProvider(id: string): PaymentProvider | null {
  try { return registry.get(id); } catch { return null; }
}

export const PROVIDER_DEFINITIONS = () => registry.allDefinitions();

export { capabilitiesFor, DEFAULT_CAPABILITIES };
export type { ProviderDefinition };
