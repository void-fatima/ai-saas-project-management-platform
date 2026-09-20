import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerResponse } from 'node:http';
import type { Subscription } from 'rxjs';
import type { AuthContext } from '../auth/auth.types.js';
import type { Environment } from '../config/environment.validation.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { WorkspaceRepository } from '../workspaces/workspace.repository.js';
import { WorkspaceSignals, type ChangeSignal } from './workspace-signals.js';

interface Connection {
  userId: string;
  sessionId: string;
  response: ServerResponse;
  workspaces: Set<string>;
}

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly connections = new Set<Connection>();
  private readonly logger = new Logger(RealtimeService.name);
  private subscription?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private pending = new Map<string, ChangeSignal>();
  private delivery: Promise<void> = Promise.resolve();
  private scheduled = false;
  private stopping = false;
  private readonly absoluteMs: number;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(WorkspaceRepository) private readonly workspaces: WorkspaceRepository,
    @Inject(WorkspaceSignals) private readonly signals: WorkspaceSignals,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
  ) {
    this.absoluteMs = config.get('SESSION_ABSOLUTE_HOURS', { infer: true }) * 3_600_000;
  }
  onModuleInit() {
    this.subscription = this.signals.changes.subscribe((signal) => {
      if (!this.connections.size || this.stopping) return;
      this.pending.set(
        'workspaceId' in signal ? `w:${signal.workspaceId}` : `u:${signal.userId}`,
        signal,
      );
      if (this.pending.size > 1000) {
        this.failClosed();
        return;
      }
      this.schedule();
    });
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, 15_000);
    this.timer.unref();
  }
  private sessions(db: Prisma.TransactionClient, ids: string[]) {
    const now = new Date();
    return db.session.findMany({
      where: {
        id: { in: ids },
        revokedAt: null,
        expiresAt: { gt: now },
        createdAt: { gt: new Date(now.getTime() - this.absoluteMs) },
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { memberships: { select: { workspaceId: true } } } },
      },
    });
  }
  async connect(auth: AuthContext, response: ServerResponse) {
    if (
      this.connections.size >= 1000 ||
      [...this.connections].filter((c) => c.userId === auth.userId).length >= 5
    )
      throw new HttpException('Too many live connections. Close another tab and retry.', 429);
    const [session] = await this.sessions(this.db, [auth.sessionId]);
    if (!session || session.userId !== auth.userId)
      throw new UnauthorizedException('Authentication is required.');
    if (response.destroyed || this.stopping) return;
    // Recheck after the asynchronous query so concurrent handshakes cannot bypass the cap.
    if (
      this.connections.size >= 1000 ||
      [...this.connections].filter((c) => c.userId === auth.userId).length >= 5
    )
      throw new HttpException('Too many live connections. Close another tab and retry.', 429);
    const connection: Connection = {
      userId: auth.userId,
      sessionId: auth.sessionId,
      response,
      workspaces: new Set(session.user.memberships.map((m) => m.workspaceId)),
    };
    this.connections.add(connection);
    response.on('close', () => this.connections.delete(connection));
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write('retry: 3000\n\n');
    this.send(connection, 'ready', {});
  }
  private send(c: Connection, event: string, data: { workspaceId?: string }) {
    if (
      c.response.destroyed ||
      c.response.writableEnded ||
      !c.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    )
      this.close(c, true);
  }
  private close(c: Connection, force = false) {
    this.connections.delete(c);
    if (force) c.response.destroy();
    else c.response.end();
  }
  private failClosed() {
    this.logger.warn('Realtime delivery unavailable; clients must reconnect and refetch.');
    this.pending.clear();
    for (const c of this.connections) this.close(c);
  }
  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.delivery = this.delivery.then(async () => {
      try {
        while (this.pending.size && !this.stopping) {
          const batch = [...this.pending.values()];
          this.pending.clear();
          for (const signal of batch) await this.dispatch(signal);
        }
      } catch {
        this.failClosed();
      } finally {
        this.scheduled = false;
      }
    });
  }
  // Used by shutdown and integration tests as a deterministic post-commit delivery barrier.
  async flush() {
    await this.delivery;
  }

  private reconcile(
    connections: Connection[],
    sessions: Awaited<ReturnType<RealtimeService['sessions']>>,
    signal?: ChangeSignal,
  ) {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const c of connections) {
      if (!this.connections.has(c)) continue;
      const session = byId.get(c.sessionId);
      const now = Date.now();
      if (
        !session ||
        session.userId !== c.userId ||
        session.expiresAt.getTime() <= now ||
        session.createdAt.getTime() + this.absoluteMs <= now
      ) {
        this.send(c, 'session-ended', {});
        this.close(c);
        continue;
      }
      const memberships = new Set(session.user.memberships.map((m) => m.workspaceId));
      for (const id of c.workspaces)
        if (!memberships.has(id)) this.send(c, 'workspace-access-ended', { workspaceId: id });
      c.workspaces = memberships;
      if (!signal) this.send(c, 'heartbeat', {});
      else if ('workspaceId' in signal && memberships.has(signal.workspaceId))
        this.send(c, 'workspace-changed', signal);
      else if ('userId' in signal && signal.userId === c.userId)
        this.send(c, 'notifications-changed', {});
    }
  }
  private async dispatch(signal: ChangeSignal) {
    const connections = [...this.connections];
    if (!connections.length) return;
    const ids = [...new Set(connections.map((c) => c.sessionId))];
    if ('workspaceId' in signal) {
      try {
        // Serialize with membership changes. One batched session/membership lookup, never one per client.
        await this.workspaces.locked(signal.workspaceId, (scope) =>
          scope.bind(async (tx) => {
            this.reconcile(connections, await this.sessions(tx, ids), signal);
          }),
        );
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        // Deleted workspace: no protected hint, only access-ended for previously known memberships.
        this.reconcile(connections, await this.sessions(this.db, ids));
      }
    } else this.reconcile(connections, await this.sessions(this.db, ids), signal);
  }
  async heartbeat() {
    if (!this.connections.size || this.stopping) return;
    try {
      const connections = [...this.connections];
      this.reconcile(
        connections,
        await this.sessions(this.db, [...new Set(connections.map((c) => c.sessionId))]),
      );
    } catch {
      this.failClosed();
    }
  }
  async onModuleDestroy() {
    this.stopping = true;
    this.subscription?.unsubscribe();
    clearInterval(this.timer);
    for (const c of this.connections) this.close(c);
    await this.flush();
  }
}
