import { createServer, seedProviders } from './server.js';
import { config } from './config.js';
import { logEvent } from './security/audit.js';
import { closeDb } from './db/index.js';

const app = createServer({ logger: config.env !== 'test' });
seedProviders();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logEvent('info', 'server.started', { port: config.port, env: config.env });
} catch (error) {
  logEvent('error', 'server.start_failed', { error: String(error) });
  closeDb();
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      closeDb();
      process.exit(0);
    });
  });
}
