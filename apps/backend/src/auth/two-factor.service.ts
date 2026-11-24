import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomCode, randomToken, sha256Hex } from '../common/crypto';
import { AppConfig } from '../config/app-config';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { PasswordService } from './password.service';
import { base32Encode, generateTotpSecret, otpauthUri, SecretBox, verifyTotp } from './totp';

export const RECOVERY_CODE_COUNT = 10;
const SETUP_TTL_SECONDS = 10 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * Optional TOTP two-factor authentication for dashboard accounts.
 *
 * Enrolment: setup (secret kept in Redis for 10 minutes) → enable with password
 * and a valid code → recovery codes shown once. Login: the password step
 * returns a short-lived challenge instead of a session; the session is only
 * issued after a valid TOTP or recovery code.
 */
@Injectable()
export class TwoFactorService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly settings: SettingsService,
    config: AppConfig,
  ) {
    this.box = new SecretBox(config.env.JWT_SECRET);
  }

  async status(userId: string) {
    const user = await this.prisma.dashboardUser.findUniqueOrThrow({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorRecoveryCodes: true } });
    return { enabled: user.twoFactorEnabled, recoveryCodesRemaining: user.twoFactorEnabled ? recoveryHashes(user.twoFactorRecoveryCodes).length : 0 };
  }

  /** Starts enrolment: returns the secret for the authenticator app (not yet active). */
  async beginSetup(userId: string, password: string) {
    const user = await this.verifiedUser(userId, password);
    if (user.twoFactorEnabled) throw new ConflictException({ code: 'TWO_FACTOR_ALREADY_ENABLED', message: 'Two-factor authentication is already enabled' });
    const secret = generateTotpSecret();
    await this.redis.client.set(setupKey(userId), this.box.seal(secret), 'EX', SETUP_TTL_SECONDS);
    const issuer = (await this.settings.getNetwork()).name || 'Network Manager';
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(issuer, user.username, secret), expiresInSeconds: SETUP_TTL_SECONDS };
  }

  /** Activates 2FA with the first valid code; returns the recovery codes (shown once). */
  async enable(userId: string, code: string): Promise<string[]> {
    const pending = await this.redis.client.get(setupKey(userId));
    if (!pending) throw new BadRequestException({ code: 'TWO_FACTOR_SETUP_EXPIRED', message: 'Start the setup again' });
    const secret = this.box.open(pending);
    const step = verifyTotp(secret, code.trim(), null);
    if (step === null) throw new BadRequestException({ code: 'INVALID_TWO_FACTOR_CODE', message: 'The code is invalid' });
    const codes = newRecoveryCodes();
    const updated = await this.prisma.dashboardUser.updateMany({
      where: { id: userId, twoFactorEnabled: false },
      data: { twoFactorEnabled: true, twoFactorSecret: this.box.seal(secret), twoFactorLastStep: step, twoFactorRecoveryCodes: codes.map(hashCode) },
    });
    if (updated.count !== 1) throw new ConflictException({ code: 'TWO_FACTOR_ALREADY_ENABLED', message: 'Two-factor authentication is already enabled' });
    await this.redis.client.del(setupKey(userId));
    return codes;
  }

  /** Requires password and a current code (or recovery code). */
  async disable(userId: string, password: string, code: string): Promise<void> {
    await this.verifiedUser(userId, password);
    if (!(await this.verifyCode(userId, code))) throw new BadRequestException({ code: 'INVALID_TWO_FACTOR_CODE', message: 'The code is invalid' });
    await this.clear(userId);
  }

  async regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<string[]> {
    await this.verifiedUser(userId, password);
    if (!(await this.verifyCode(userId, code))) throw new BadRequestException({ code: 'INVALID_TWO_FACTOR_CODE', message: 'The code is invalid' });
    const codes = newRecoveryCodes();
    await this.prisma.dashboardUser.update({ where: { id: userId }, data: { twoFactorRecoveryCodes: codes.map(hashCode) } });
    return codes;
  }

  /** Administrative reset (lost device). */
  async clear(userId: string): Promise<void> {
    await this.prisma.dashboardUser.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastStep: null, twoFactorRecoveryCodes: Prisma.DbNull },
    });
  }

  /**
   * Verifies a TOTP code (replay-protected) or consumes a recovery code.
   * Returns the method used, or null.
   */
  async verifyCode(userId: string, input: string): Promise<'totp' | 'recovery' | null> {
    const code = input.trim().replace(/\s/g, '');
    const user = await this.prisma.dashboardUser.findUniqueOrThrow({ where: { id: userId } });
    if (!user.twoFactorEnabled || !user.twoFactorSecret) return null;

    if (/^\d{6}$/.test(code)) {
      let secret: Buffer;
      try {
        secret = this.box.open(user.twoFactorSecret);
      } catch {
        return null; // sealed with a different JWT_SECRET: an administrator must reset 2FA
      }
      const step = verifyTotp(secret, code, user.twoFactorLastStep);
      if (step === null) return null;
      // Conditional update: a concurrent request with the same code cannot also succeed.
      const accepted = await this.prisma.dashboardUser.updateMany({
        where: { id: userId, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
        data: { twoFactorLastStep: step },
      });
      return accepted.count === 1 ? 'totp' : null;
    }

    const hash = hashCode(code);
    const hashes = recoveryHashes(user.twoFactorRecoveryCodes);
    if (!hashes.includes(hash)) return null;
    const remaining = hashes.filter((h) => h !== hash);
    // Optimistic check on the stored list so a recovery code works exactly once.
    const updated = await this.prisma.$executeRaw`
      UPDATE dashboard_users SET two_factor_recovery_codes = ${JSON.stringify(remaining)}
      WHERE id = ${userId} AND JSON_CONTAINS(two_factor_recovery_codes, ${JSON.stringify(hash)})`;
    return updated === 1 ? 'recovery' : null;
  }

  // ── Login challenges ─────────────────────────────────────────

  async createChallenge(userId: string): Promise<string> {
    const challenge = randomToken(32);
    await this.redis.client.set(challengeKey(challenge), JSON.stringify({ userId }), 'EX', CHALLENGE_TTL_SECONDS);
    return challenge;
  }

  /** Returns the user id when the challenge is valid; counts attempts. */
  async resolveChallenge(challenge: string): Promise<{ userId: string; attempt: () => Promise<boolean>; consume: () => Promise<void> } | null> {
    const key = challengeKey(challenge);
    const raw = await this.redis.client.get(key);
    if (!raw) return null;
    const { userId } = JSON.parse(raw) as { userId: string };
    return {
      userId,
      /** Records a failed attempt; false when the challenge is used up. */
      attempt: async () => {
        const attempts = await this.redis.client.hincrby(`${key}:attempts`, 'n', 1);
        await this.redis.client.expire(`${key}:attempts`, CHALLENGE_TTL_SECONDS);
        if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
          await this.redis.client.del(key, `${key}:attempts`);
          return false;
        }
        return true;
      },
      consume: async () => {
        await this.redis.client.del(key, `${key}:attempts`);
      },
    };
  }

  private async verifiedUser(userId: string, password: string) {
    const user = await this.prisma.dashboardUser.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new BadRequestException({ code: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    }
    return user;
  }
}

const setupKey = (userId: string) => `mnm:2fa-setup:${userId}`;
const challengeKey = (challenge: string) => `mnm:2fa-challenge:${sha256Hex(challenge)}`;
/** Recovery codes are compared case-insensitively without separators. */
const hashCode = (code: string) => sha256Hex(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
const newRecoveryCodes = () => Array.from({ length: RECOVERY_CODE_COUNT }, () => randomCode(2, 5));

function recoveryHashes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

