import { Injectable } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';

const argonOptions = {
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
  type: argon2id,
} as const;

@Injectable()
export class PasswordService {
  private readonly dummyHash = hash('not-a-real-user-password-42', argonOptions);

  hash(password: string): Promise<string> {
    return hash(password, argonOptions);
  }

  async verifyOrDummy(passwordHash: string | undefined, password: string): Promise<boolean> {
    const selectedHash = passwordHash ?? (await this.dummyHash);
    const matches = await verify(selectedHash, password);
    return passwordHash === undefined ? false : matches;
  }
}
