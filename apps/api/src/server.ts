import Fastify, { type FastifyInstance } from 'fastify';
import { config } from './config.js';
import { initDb, nowIso } from './db/index.js';
import { AppError } from '@paychat/shared';
import { PaymentOrchestrator } from './payments/orchestrator.js';
import { listProviders, registry } from './providers/registry.js';
import { SandboxProvider } from './providers/sandbox.js';
import { getDb } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { paymentRoutes } from './routes/payments.js';
import { platformRoutes } from './routes/platform.js';
import { merchantRoutes } from './routes/merchant.js';
import { registerAuthContext } from './security/context.js';
import { storeChallenge, takeChallenge } from './security/challenges.js';
import { logEvent } from './security/audit.js';

declare module 'fastify' {
  interface FastifyInstance {
    storeChallenge(userId: string, challenge: string): Promise<void>;
    takeChallenge(userId: string): Promise<string | null>;
  }
}

export interface ServerOptions {
  databasePath?: string;
  logger?: boolean;
  /** Injected for tests so the sandbox rail can be controlled. */
  sandbox?: SandboxProvider;
}

export function createServer(options: ServerOptions = {}): FastifyInstance {
  initDb(options.databasePath ?? config.databasePath);

  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: 1_048_576,
    // Signed payment-link tokens and provider references travel in path params.
    routerOptions: { maxParamLength: 1024 },
  });

  // Raw body is preserved verbatim so webhook signatures can be verified over the exact bytes,
  // while routes still receive parsed JSON.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const text = (body as Buffer).toString('utf8');
    (request as unknown as { rawBody?: string }).rawBody = text;
    try {
      done(null, text.trim() ? JSON.parse(text) : {});
    } catch {
      const badRequest = new Error('Malformed JSON body') as Error & { statusCode: number };
      badRequest.statusCode = 400;
      done(badRequest, undefined);
    }
  });

  registerAuthContext(app);

  /**
   * Liveness and readiness. `/healthz` must never touch the database (a DB blip must not
   * take the process out of its container); `/readyz` checks what the service depends on and
   * reports each dependency honestly — it never returns "ready" for something it cannot reach.
   */
  app.get('/healthz', async () => ({ ok: true, service: 'paychat-api', env: config.env, time: nowIso() }));
  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, 'ok' | 'fail'> = {};
    try {
      getDb().prepare('SELECT 1').get();
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }
    try {
      registry.load();
      checks.providerRegistry = registry.allDefinitions().length > 0 ? 'ok' : 'fail';
    } catch {
      checks.providerRegistry = 'fail';
    }
    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.code(ready ? 200 : 503).send({ ok: ready, checks, time: nowIso() });
  });

  const providers = {
    get(providerId: string) {
      // No provider is named here: the injected sandbox instance (tests) wins, otherwise
      // resolution goes through the registry's configuration.
      if (options.sandbox && registry.get(providerId) instanceof SandboxProvider) return options.sandbox;
      return registry.get(providerId);
    },
  };

  const orchestrator = new PaymentOrchestrator(providers);

  app.decorate('storeChallenge', async (userId: string, challenge: string) => storeChallenge(userId, challenge));
  app.decorate('takeChallenge', async (userId: string) => takeChallenge(userId));

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(error.toBody());
    }
    if ((error as Error).name === 'ZodError' || 'issues' in (error as Record<string, unknown>)) {
      const zodError = error as unknown as { issues: Array<{ path: (string | number)[]; message: string }> };
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some details look incorrect. Please check and try again.',
          fields: zodError.issues?.map((i) => ({ field: i.path.join('.'), message: i.message })) ?? [],
        },
      });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    logEvent('error', 'unhandled_error', { path: request.url, status, message: (error as Error).message });
    if (status >= 500) {
      // Financial errors must be explicit and reassuring, never a bare 500.
      return reply.code(500).send({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'We could not complete that action. Nothing has been confirmed. Please check your history before trying again.',
        },
      });
    }
    return reply.code(status).send({ error: { code: 'REQUEST_ERROR', message: (error as Error).message } });
  });

  app.register(async (instance) => {
    await authRoutes(instance);
    await chatRoutes(instance);
    paymentRoutes(instance, orchestrator);
    await platformRoutes(instance, orchestrator);
    merchantRoutes(instance, orchestrator);
  });

  app.get('/', async (_request, reply) => reply.send({ name: 'PayChat API', tagline: 'Chat. Pay. Done.', environment: config.env }));

  // Background reconciliation: resolves payments the provider never confirmed.
  const interval = setInterval(() => {
    void orchestrator.reconcile().then((result) => {
      if (result.checked) logEvent('info', 'reconciliation.run', result);
    }).catch((error) => logEvent('error', 'reconciliation.failed', { error: String(error) }));
  }, Math.max(30, config.reconciliation.staleAfterSeconds) * 1000);
  interval.unref?.();

  app.addHook('onClose', () => clearInterval(interval));

  (app as unknown as { orchestrator: PaymentOrchestrator }).orchestrator = orchestrator;
  return app;
}

/** Seeds the provider rows so the registry reflects what this deployment can actually use. */
export function seedProviders(): void {
  // Re-merge every source (defaults + env + existing DB rows) FIRST, so seeding writes the
  // deployment's current configuration rather than whatever was cached in memory.
  registry.load();
  // Persist the merged configuration so the registry reflects what THIS deployment can use.
  // No provider is named here.
  for (const definition of registry.allDefinitions()) {
    const instance = registry.get(definition.id);
    const capabilities = instance.capabilities;
    const usable = Object.values(capabilities).some(Boolean);
    registry.persist({ ...definition, enabled: usable, capabilities });
  }
  registry.load(); // re-merge now that DB rows exist
  logEvent('info', 'providers.seeded', { count: listProviders('BW').length, time: nowIso() });
}
