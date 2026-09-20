import { Global, Injectable, Module } from '@nestjs/common';
import { Subject } from 'rxjs';

export type ChangeSignal = { workspaceId: string } | { userId: string };

// In-process, post-commit invalidation only. Durable state is always in PostgreSQL.
@Injectable()
export class WorkspaceSignals {
  readonly changes = new Subject<ChangeSignal>();
  publish(signal: ChangeSignal): void {
    this.changes.next(signal);
  }
}

@Global()
@Module({ providers: [WorkspaceSignals], exports: [WorkspaceSignals] })
export class WorkspaceSignalsModule {}
