import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

export interface SessionToken {
  hash: string;
  raw: string;
}

@Injectable()
export class SessionTokenService {
  issue(): SessionToken {
    const raw = randomBytes(32).toString('base64url');
    return { hash: this.hash(raw), raw };
  }

  hash(raw: string): string {
    return createHash('sha256').update(raw, 'utf8').digest('hex');
  }
}
