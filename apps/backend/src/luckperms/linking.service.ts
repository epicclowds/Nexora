import { createHash, randomInt } from 'node:crypto';
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { type AuditActor, AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { AccountManager, ActorType } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { resolveRole } from './luckperms';
import { LuckPermsService } from './luckperms.service';

/** Unambiguous alphabet (no 0/O, 1/I/L): 31 symbols, 8 characters ≈ 39.6 bits per code. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_MS = 5 * 60_000;
const MAX_CODES_PER_WINDOW = 3;
const CODE_WINDOW_SECONDS = 600;
const MAX_FAILED_ATTEMPTS = 10;
const FAILED_WINDOW_SECONDS = 3600;

export function hashCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

/** "abcd 1234", "ABCD-1234" → "ABCD1234". */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateCode(): string {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += ALPHABET[randomInt(ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * Minecraft → dashboard account linking. /nexora link runs in an
 * authenticated game session on the proxy, which proves control of the
 * Minecraft UUID; the player then enters the short-lived, single-use code in
 * the dashboard. Only the SHA-256 hash of a code is stored.
 */
@Injectable()
export class LinkingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
    private readonly luckperms: LuckPermsService,
  ) {}

  /** Called by the proxy for /nexora link. */
  async createCode(input: { uuid: string; username: string; registerPermission: boolean }) {
    const settings = await this.luckperms.getSettings();
    if (settings.mode === 'DISABLED' || !settings.linking.enabled) throw new ForbiddenException({ code: 'LINKING_DISABLED', message: 'Account linking is disabled' });
    const uuid = input.uuid.toLowerCase();
    if (!(await this.eligible(uuid, input.registerPermission))) throw new ForbiddenException({ code: 'NOT_ELIGIBLE', message: 'This account is not eligible for dashboard access' });
    const key = `nexora:link:codes:${uuid}`;
    const count = await this.redis.client.incr(key).catch(() => 1);
    if (count === 1) await this.redis.client.expire(key, CODE_WINDOW_SECONDS).catch(() => undefined);
    if (count > MAX_CODES_PER_WINDOW) throw new HttpException({ code: 'TOO_MANY_CODES', message: 'Too many link codes – try again later' }, HttpStatus.TOO_MANY_REQUESTS);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      // Only the newest code of a player is valid.
      await tx.accountLinkToken.updateMany({ where: { minecraftUuid: uuid, consumedAt: null }, data: { consumedAt: new Date() } });
      await tx.accountLinkToken.create({ data: { minecraftUuid: uuid, minecraftUsername: input.username.slice(0, 16), tokenHash: hashCode(code), registerPermission: input.registerPermission, expiresAt } });
    });
    return { code, expiresAt: expiresAt.toISOString(), ttlSeconds: CODE_TTL_MS / 1000 };
  }

  /** Eligible: nexora.dashboard.register in-game, a mapped staff group, or already linked. */
  private async eligible(uuid: string, registerPermission: boolean): Promise<boolean> {
    if (registerPermission) return true;
    if (await this.prisma.linkedMinecraftAccount.findUnique({ where: { minecraftUuid: uuid } })) return true;
    return (await this.mappedRole(uuid)) !== null;
  }

  private async mappedRole(uuid: string): Promise<string | null> {
    const snapshot = await this.prisma.permissionSyncState.findUnique({ where: { minecraftUuid: uuid } });
    if (!snapshot) return null;
    const [mappings, roles] = await Promise.all([this.prisma.luckPermsGroupMapping.findMany(), this.prisma.dashboardRole.findMany({ select: { id: true, key: true, priority: true } })]);
    const resolution = resolveRole((snapshot.groups as string[]) ?? [], mappings, roles);
    return resolution.access ? resolution.roleId : null;
  }

  /** Consumes a code (single use). Failed attempts are rate-limited per client address. */
  private async consume(code: string, ip: string | null) {
    const failKey = `nexora:link:failed:${ip ?? 'unknown'}`;
    const failures = Number((await this.redis.client.get(failKey).catch(() => null)) ?? 0);
    if (failures >= MAX_FAILED_ATTEMPTS) throw new HttpException({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many invalid codes – try again later' }, HttpStatus.TOO_MANY_REQUESTS);
    const token = await this.prisma.accountLinkToken.findUnique({ where: { tokenHash: hashCode(code) } });
    const now = new Date();
    if (!token || token.consumedAt || token.expiresAt <= now) {
      await this.redis.client.multi().incr(failKey).expire(failKey, FAILED_WINDOW_SECONDS).exec().catch(() => undefined);
      throw new NotFoundException({ code: 'INVALID_LINK_CODE', message: 'The code is invalid, expired or already used' });
    }
    // Atomic: two parallel requests cannot both consume the code.
    const consumed = await this.prisma.accountLinkToken.updateMany({ where: { id: token.id, consumedAt: null }, data: { consumedAt: now } });
    if (consumed.count === 0) throw new NotFoundException({ code: 'INVALID_LINK_CODE', message: 'The code is invalid, expired or already used' });
    return token;
  }

  /** Links the Minecraft account of a code to the signed-in dashboard user. */
  async linkToUser(user: { id: string; username: string }, code: string, ip: string | null) {
    const settings = await this.luckperms.getSettings();
    if (settings.mode === 'DISABLED' || !settings.linking.enabled) throw new ForbiddenException({ code: 'LINKING_DISABLED', message: 'Account linking is disabled' });
    const token = await this.consume(code, ip);
    const other = await this.prisma.linkedMinecraftAccount.findUnique({ where: { minecraftUuid: token.minecraftUuid } });
    if (other && other.dashboardUserId !== user.id) throw new ConflictException({ code: 'ALREADY_LINKED', message: 'This Minecraft account is linked to another dashboard account' });
    const link = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.linkedMinecraftAccount.upsert({
        where: { dashboardUserId: user.id },
        create: { dashboardUserId: user.id, minecraftUuid: token.minecraftUuid, minecraftUsername: token.minecraftUsername, lastVerifiedAt: new Date() },
        update: { minecraftUuid: token.minecraftUuid, minecraftUsername: token.minecraftUsername, linkedAt: new Date(), lastVerifiedAt: new Date() },
      });
      await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: user.id, newStatus: 'LINKED', reason: `Linked to ${token.minecraftUsername} (${token.minecraftUuid})`, source: 'USER' } });
      await this.audit.record({ actor: { type: ActorType.USER, userId: user.id, name: user.username }, action: 'users.minecraft_linked', targetType: 'dashboard_user', targetId: user.id, metadata: { minecraftUuid: token.minecraftUuid, minecraftUsername: token.minecraftUsername }, ipAddress: ip }, tx);
      return saved;
    });
    await this.luckperms.requestResync(token.minecraftUuid);
    return link;
  }

  /**
   * Creates a LuckPerms-managed staff account from a link code. Needs
   * registration to be enabled and a group mapping that grants a role.
   */
  async register(input: { code: string; username: string; email: string; password: string }, ip: string | null) {
    const settings = await this.luckperms.getSettings();
    if (settings.mode === 'DISABLED' || !settings.linking.enabled || !settings.linking.allowRegistration) throw new ForbiddenException({ code: 'REGISTRATION_DISABLED', message: 'Staff registration is disabled' });
    const token = await this.consume(input.code, ip);
    if (await this.prisma.linkedMinecraftAccount.findUnique({ where: { minecraftUuid: token.minecraftUuid } })) {
      throw new ConflictException({ code: 'ALREADY_LINKED', message: 'This Minecraft account already has a dashboard account – sign in instead' });
    }
    const roleId = await this.mappedRole(token.minecraftUuid);
    if (!roleId) throw new ForbiddenException({ code: 'NOT_ELIGIBLE', message: 'Your LuckPerms groups do not grant dashboard access' });
    const taken = await this.prisma.dashboardUser.findFirst({ where: { OR: [{ username: input.username }, { email: input.email }] }, select: { username: true } });
    if (taken) throw new ConflictException({ code: taken.username === input.username ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN', message: 'Username or email already in use' });
    const passwordHash = await this.passwords.hash(input.password);
    const actor: AuditActor = { type: ActorType.SYSTEM, name: 'account linking' };
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dashboardUser.create({ data: { username: input.username, email: input.email, passwordHash, roleId, managedBy: AccountManager.LUCKPERMS }, select: { id: true, username: true } });
      await tx.linkedMinecraftAccount.create({ data: { dashboardUserId: created.id, minecraftUuid: token.minecraftUuid, minecraftUsername: token.minecraftUsername, lastVerifiedAt: new Date() } });
      await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: created.id, newStatus: 'ACTIVE', reason: `Registered through account linking as ${token.minecraftUsername}`, source: 'LINKING' } });
      await this.audit.record({ actor, action: 'users.registered_by_link', targetType: 'dashboard_user', targetId: created.id, metadata: { username: created.username, minecraftUuid: token.minecraftUuid, roleId }, ipAddress: ip }, tx);
      return created;
    });
    return { id: user.id, username: user.username };
  }

  /** Removes a link (administrators, or users for themselves). Managed accounts are disabled. */
  async unlink(userId: string, actor: AuditActor, ip: string | null) {
    const user = await this.prisma.dashboardUser.findUnique({ where: { id: userId }, include: { minecraftLink: true } });
    if (!user?.minecraftLink) throw new NotFoundException({ code: 'NOT_LINKED', message: 'No Minecraft account is linked' });
    const managed = user.managedBy === AccountManager.LUCKPERMS;
    await this.prisma.$transaction(async (tx) => {
      await tx.linkedMinecraftAccount.delete({ where: { dashboardUserId: userId } });
      if (managed) await tx.dashboardUser.update({ where: { id: userId }, data: { disabled: true, disabledByLuckPerms: false } });
      await tx.staffAccountStatusHistory.create({ data: { dashboardUserId: userId, previousStatus: 'LINKED', newStatus: managed ? 'DISABLED' : 'UNLINKED', reason: 'Minecraft account unlinked', source: 'ADMIN' } });
      await this.audit.record({ actor, action: 'users.minecraft_unlinked', targetType: 'dashboard_user', targetId: userId, metadata: { minecraftUuid: user.minecraftLink!.minecraftUuid }, ipAddress: ip }, tx);
    });
    if (managed) await this.auth.revokeAllSessions(userId);
  }
}
