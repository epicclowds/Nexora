import { Injectable, Logger } from '@nestjs/common';
import { clientDetectionStatus, type KnownClient, normalizeClientBrand } from '@mnm/shared-types';
import type { Prisma } from '../generated/prisma/client';
import { GeoIpService } from '../players/geoip.service';
import { parseTexturesProperty } from '../players/skins';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { type ClientDetectionSettings, SETTING_KEYS, SettingsService } from '../settings/settings.service';
import type { JoinEvent, PluginEvent, SyncInput } from './plugin-events';

type Tx = Prisma.TransactionClient;

/**
 * Network session tracking driven by proxy events. Every operation is
 * idempotent (keyed by the plugin-generated session key) so buffered events
 * can be retried safely after outages.
 */
@Injectable()
export class PlayerTrackingService {
  private readonly logger = new Logger(PlayerTrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly geoip: GeoIpService,
  ) {}

  /** Applies a batch of proxy events in order. Returns how many were applied vs. skipped as duplicates. */
  async applyEvents(proxyId: string, events: PluginEvent[]): Promise<{ applied: number; skipped: number }> {
    let applied = 0;
    let joined = false;
    const detection = await this.settings.getClientDetection();
    for (const event of events) {
      const changed = await this.prisma.$transaction(async (tx) => {
        switch (event.type) {
          case 'player.join':
            return this.join(tx, proxyId, event, detection);
          case 'player.switch':
            return this.switchServer(tx, event.sessionKey, event.uuid, event.server, event.at);
          case 'player.brand':
            return this.brand(tx, event.sessionKey, event.uuid, event.brand, detection);
          case 'player.client':
            return this.integrationClient(tx, event.sessionKey, event.client, event.at, detection);
          case 'player.leave':
            return this.leave(tx, event.sessionKey, event.at);
        }
      });
      if (!changed) continue;
      applied++;
      if (event.type === 'player.join') joined = true;
      this.realtime.publish({
        type: event.type === 'player.join' ? 'player.online' : event.type === 'player.leave' ? 'player.offline' : 'player.updated',
        uuid: event.uuid,
      });
    }
    if (joined) await this.updatePlayerRecord();
    return { applied, skipped: events.length - applied };
  }

  private async join(tx: Tx, proxyId: string, e: JoinEvent, detection: ClientDetectionSettings): Promise<boolean> {
    if (await tx.playerSession.findUnique({ where: { sessionKey: e.sessionKey }, select: { id: true } })) return false;

    const skin = parseTexturesProperty(e.textures);
    const skinData = skin ? { skinTextureUrl: skin.url, skinModel: skin.model } : {};
    const geo = this.geoip.lookup(e.ip);
    // The brand can arrive before login completes; then it comes with the join (never from an earlier session).
    const brand = detection.enabled ? e.brand?.trim() || null : null;
    const brandData = brand ? { clientBrand: brand } : {};

    await tx.player.upsert({
      where: { uuid: e.uuid },
      create: {
        uuid: e.uuid,
        username: e.username,
        firstSeenAt: e.at,
        lastSeenAt: e.at,
        online: true,
        connectionCount: 1,
        clientProtocol: e.protocol,
        clientVersion: e.clientVersion,
        ...skinData,
        ...brandData,
      },
      update: {
        username: e.username,
        lastSeenAt: e.at,
        online: true,
        connectionCount: { increment: 1 },
        clientProtocol: e.protocol,
        clientVersion: e.clientVersion,
        ...skinData,
        ...brandData,
      },
    });
    await tx.playerName.upsert({
      where: { playerUuid_username: { playerUuid: e.uuid, username: e.username } },
      create: { playerUuid: e.uuid, username: e.username, firstSeenAt: e.at, lastSeenAt: e.at },
      update: { lastSeenAt: e.at },
    });
    const session = await tx.playerSession.create({
      data: { sessionKey: e.sessionKey, playerUuid: e.uuid, proxyServerId: proxyId, startedAt: e.at },
    });
    await tx.playerConnection.create({
      data: {
        playerUuid: e.uuid,
        sessionId: session.id,
        ipAddress: e.ip ?? null,
        virtualHost: e.virtualHost ?? null,
        clientProtocol: e.protocol ?? null,
        ...(brand ? { clientBrand: brand, clientName: normalizeClientBrand(brand), clientSource: 'BRAND', clientDetectedAt: e.at } : {}),
        connectedAt: e.at,
        // Approximate, IP-derived location (only when a GeoIP database is configured).
        countryCode: geo?.countryCode ?? null,
        region: geo?.region ?? null,
        city: geo?.city ?? null,
        asn: geo?.asn ?? null,
        isp: geo?.isp ?? null,
      },
    });
    if (detection.debug) this.logger.log(`Client detection: session ${short(e.sessionKey)} joined, ${brand ? `brand "${brand}" → ${describe(brand)}` : 'no brand yet'}`);
    return true;
  }

  private async switchServer(tx: Tx, sessionKey: string, uuid: string, serverName: string, at: Date): Promise<boolean> {
    const session = await tx.playerSession.findUnique({ where: { sessionKey } });
    if (!session || session.endedAt) return false;

    const server = await tx.server.findUnique({ where: { name: serverName }, select: { id: true } });
    const open = await tx.playerServerVisit.findFirst({ where: { sessionId: session.id, leftAt: null }, orderBy: { joinedAt: 'desc' } });
    if (open && server && open.serverId === server.id) return false;
    if (open) await tx.playerServerVisit.update({ where: { id: open.id }, data: { leftAt: at } });

    if (server) {
      await tx.playerServerVisit.create({ data: { playerUuid: uuid, sessionId: session.id, serverId: server.id, joinedAt: at } });
    } else {
      // Backend servers must be registered under the same name as in velocity.toml.
      this.logger.debug(`Player ${uuid} switched to unregistered server "${serverName}"`);
    }
    await tx.player.update({ where: { uuid }, data: { currentServerId: server?.id ?? null } });
    return true;
  }

  /**
   * Stores the brand of exactly the session that reported it. Empty brands never
   * overwrite a recorded one, and a repeated brand (retried batch, server switch)
   * is a no-op.
   */
  private async brand(tx: Tx, sessionKey: string, uuid: string, raw: string, detection: ClientDetectionSettings): Promise<boolean> {
    if (!detection.enabled) return false;
    const brand = raw.trim();
    if (!brand) {
      if (detection.debug) this.logger.log(`Client detection: session ${short(sessionKey)} reported an empty brand (ignored)`);
      return false;
    }
    const session = await tx.playerSession.findUnique({ where: { sessionKey }, select: { id: true, connection: { select: { id: true, clientBrand: true, clientSource: true } } } });
    if (!session?.connection) {
      if (detection.debug) this.logger.log(`Client detection: brand for unknown session ${short(sessionKey)} dropped`);
      return false;
    }
    const connection = session.connection;
    if (connection.clientBrand === brand) return false;
    const integration = connection.clientSource === 'INTEGRATION';
    try {
      await tx.playerConnection.update({
        where: { id: connection.id },
        data: {
          clientBrand: brand,
          // An explicit integration signal outranks the self-reported brand.
          ...(integration ? {} : { clientName: normalizeClientBrand(brand), clientSource: 'BRAND', clientDetectedAt: new Date() }),
        },
      });
      await tx.player.updateMany({ where: { uuid }, data: { clientBrand: brand } });
    } catch (err) {
      this.logger.warn(`Client detection: storing the brand of session ${short(sessionKey)} failed: ${(err as Error).message}`);
      throw err;
    }
    if (detection.debug) this.logger.log(`Client detection: session ${short(sessionKey)} brand "${brand}" → ${describe(brand)}`);
    return true;
  }

  /** A client confirmed by its own server API (higher priority than the brand). */
  private async integrationClient(tx: Tx, sessionKey: string, client: KnownClient, at: Date, detection: ClientDetectionSettings): Promise<boolean> {
    if (!detection.enabled) return false;
    const session = await tx.playerSession.findUnique({ where: { sessionKey }, select: { connection: { select: { id: true, clientName: true, clientSource: true } } } });
    const connection = session?.connection;
    if (!connection) {
      if (detection.debug) this.logger.log(`Client detection: integration signal for unknown session ${short(sessionKey)} dropped`);
      return false;
    }
    if (connection.clientName === client && connection.clientSource === 'INTEGRATION') return false;
    await tx.playerConnection.update({ where: { id: connection.id }, data: { clientName: client, clientSource: 'INTEGRATION', clientDetectedAt: at } });
    if (detection.debug) this.logger.log(`Client detection: session ${short(sessionKey)} confirmed as ${client} by the client's server API`);
    return true;
  }

  private async leave(tx: Tx, sessionKey: string, at: Date): Promise<boolean> {
    const session = await tx.playerSession.findUnique({ where: { sessionKey } });
    if (!session || session.endedAt) return false;
    await this.closeSession(tx, session, at);
    return true;
  }

  /** Ends a session, accumulates playtime and recomputes the player's online state. */
  private async closeSession(tx: Tx, session: { id: bigint; playerUuid: string; startedAt: Date }, at: Date): Promise<void> {
    const endedAt = at < session.startedAt ? session.startedAt : at;
    const duration = Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000);
    await tx.playerSession.update({ where: { id: session.id }, data: { endedAt, durationSeconds: duration } });
    await tx.playerServerVisit.updateMany({ where: { sessionId: session.id, leftAt: null }, data: { leftAt: endedAt } });

    const stillOnline = (await tx.playerSession.count({ where: { playerUuid: session.playerUuid, endedAt: null } })) > 0;
    await tx.player.update({
      where: { uuid: session.playerUuid },
      data: {
        totalPlaytimeSeconds: { increment: BigInt(duration) },
        lastSeenAt: endedAt,
        online: stillOnline,
        ...(stillOnline ? {} : { currentServerId: null }),
      },
    });
  }

  /**
   * Reconciles the proxy's authoritative list of connected players with the
   * database: closes sessions the proxy no longer has and opens missing ones.
   */
  async sync(proxyId: string, input: SyncInput): Promise<{ closed: number; opened: number; moved: number }> {
    const now = new Date();
    const reported = new Map(input.sessions.map((s) => [s.sessionKey, s]));
    const open = await this.prisma.playerSession.findMany({ where: { proxyServerId: proxyId, endedAt: null } });
    let closed = 0;
    let opened = 0;
    let moved = 0;

    for (const session of open) {
      if (session.sessionKey && reported.has(session.sessionKey)) continue;
      await this.prisma.$transaction((tx) => this.closeSession(tx, session, now));
      this.realtime.publish({ type: 'player.offline', uuid: session.playerUuid });
      closed++;
    }

    const known = new Set(open.map((s) => s.sessionKey));
    const detection = await this.settings.getClientDetection();
    for (const s of input.sessions) {
      if (!known.has(s.sessionKey)) {
        const created = await this.prisma.$transaction((tx) =>
          this.join(tx, proxyId, { type: 'player.join', sessionKey: s.sessionKey, uuid: s.uuid, username: s.username, at: now, brand: s.brand }, detection),
        );
        if (created) {
          opened++;
          this.realtime.publish({ type: 'player.online', uuid: s.uuid });
        }
      }
      if (s.server) {
        const server = s.server;
        if (await this.prisma.$transaction((tx) => this.switchServer(tx, s.sessionKey, s.uuid, server, now))) moved++;
      }
    }
    if (opened) await this.updatePlayerRecord();
    return { closed, opened, moved };
  }

  /** Closes every open session of a proxy (shutdown or lost heartbeat). */
  async closeProxySessions(proxyId: string, at: Date): Promise<number> {
    const open = await this.prisma.playerSession.findMany({ where: { proxyServerId: proxyId, endedAt: null } });
    for (const session of open) {
      await this.prisma.$transaction((tx) => this.closeSession(tx, session, at));
      this.realtime.publish({ type: 'player.offline', uuid: session.playerUuid });
    }
    return open.length;
  }

  async updateGamemodes(players: { uuid: string; gamemode: string }[]): Promise<void> {
    const byMode = new Map<string, string[]>();
    for (const p of players) byMode.set(p.gamemode, [...(byMode.get(p.gamemode) ?? []), p.uuid]);
    for (const [gamemode, uuids] of byMode) {
      await this.prisma.player.updateMany({ where: { uuid: { in: uuids }, NOT: { gamemode } }, data: { gamemode } });
    }
  }

  /** Network-wide concurrent player record (measured, never estimated). */
  private async updatePlayerRecord(): Promise<void> {
    const online = await this.prisma.player.count({ where: { online: true } });
    const record = await this.settings.get<{ count: number; at: string }>(SETTING_KEYS.PLAYER_RECORD);
    if (!record || online > record.count) {
      await this.settings.set(SETTING_KEYS.PLAYER_RECORD, { count: online, at: new Date().toISOString() }, null);
    }
  }
}

/** Session keys are random; the first 8 characters are enough to follow a session in the logs. */
function short(sessionKey: string): string {
  return sessionKey.slice(0, 8);
}

function describe(brand: string): string {
  const status = clientDetectionStatus(brand);
  return status === 'DETECTED' ? (normalizeClientBrand(brand) as string) : 'not a known client (stored as reported)';
}
