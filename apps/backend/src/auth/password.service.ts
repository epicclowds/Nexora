import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

export const MIN_PASSWORD_LENGTH = 12;

/** Argon2id hashing with OWASP-recommended parameters. */
@Injectable()
export class PasswordService {
  private static readonly options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
  // Pre-computed hash used to keep timing uniform when a user does not exist.
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, PasswordService.options);
  }

  async verify(hash: string | null, password: string): Promise<boolean> {
    if (!hash) {
      this.dummyHash ??= this.hash('timing-equalisation-placeholder');
      await argon2.verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    return argon2.verify(hash, password).catch(() => false);
  }
}
