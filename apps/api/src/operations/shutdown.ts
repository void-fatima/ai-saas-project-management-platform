import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { OperationsLog, RuntimeState } from './operations.js';

export function createShutdown(
  app: Pick<INestApplication<Server>, 'getHttpServer' | 'close'>,
  runtime: RuntimeState,
  log: Pick<OperationsLog, 'write'>,
  timeoutMs: number,
  exit: (code: number) => void = (code) => process.exit(code),
  stopStreams: () => void = () => {},
): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => {
    if (closing) return closing;
    const server = app.getHttpServer();
    runtime.stopping = true;
    log.write('info', 'shutdown_started');
    const deadline = setTimeout(() => {
      log.write('error', 'shutdown_timeout');
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    closing = (async () => {
      try {
        stopStreams();
        // Drain ordinary requests before Nest disconnects the database. SSE is bounded
        // by the same deadline; close its streams first through the supplied hook.
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeIdleConnections();
        });
        await app.close();
        log.write('info', 'shutdown_complete');
        exit(0);
      } catch {
        log.write('error', 'shutdown_failed');
        exit(1);
      } finally {
        clearTimeout(deadline);
      }
    })();
    return closing;
  };
}
