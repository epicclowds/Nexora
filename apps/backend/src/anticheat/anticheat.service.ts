import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, type Prisma, PunishmentSource, PunishmentType } from '../generated/prisma/client';
import { normalizeUuid } from '../players/players.controller';
import { PrismaService } from '../prisma/prisma.service';
import { PunishmentsService } from '../punishments/punishments.service';
import { RealtimeService } from '../realtime/realtime.service';
import { SettingsService } from '../settings/settings.service';
import { type AntiCheatSettings, antiCheatSettingsSchema, decide, type Outcome, resolveRule } from './anticheat-rules';

export const ANTICHEAT_SETTINGS_KEY = 'anticheat';
const PUNISHING_OUTCOMES: Outcome[] = ['WARNING', 'KICK', 'TEMP_BAN', 'BAN'];
const ACTION_TO_TYPE: Record<'WARNING' | 'KICK' | 'TEMP_BAN' | 'BAN', PunishmentType> = {
  WARNING: PunishmentType.WARNING,
  KICK: PunishmentType.KICK,
  TEMP_BAN: PunishmentType.TEMP_BAN,
  BAN: PunishmentType.BAN,
};

export interface AntiCheatReport {
  target: string;
  provider: string;
  cheatType: string;
  violationLevel?: number;
  reason?: string;
  evidence?: string;
  metadata?: Record<string, unknown>;
  explicit: boolean;
  eventKey: string;
}

@Injectable()
export class AntiCheatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly punishments: PunishmentsService,
    private readonly realtime: RealtimeService,
  ) {}

  async getSettings(): Promise<AntiCheatSettings> {
    const parsed = antiCheatSettingsSchema.safeParse((await this.settings.get<unknown>(ANTICHEAT_SETTINGS_KEY)) ?? {});
    return parsed.success ? parsed.data : antiCheatSettingsSchema.parse({});
  }

  /**
   * Records a report and applies the matching rule. Idempotent per eventKey:
   * a retried report returns the original outcome without punishing twice.
   */
  async report(server: { id: string; name: string }, input: AntiCheatReport) {
    const eventKey = `${server.id}:${input.eventKey}`;
    const existing = await this.prisma.antiCheatEvent.findUnique({ where: { eventKey } });
    if (existing) return this.result(existing.id, existing.outcome as Outcome, existing.punishmentId);

    const player = await this.punishments.resolvePlayer(input.target);
    const settings = await this.getSettings();
    const now = new Date();
    const cheatType = input.cheatType.trim();

    const { rule } = resolveRule(settings, cheatType, input.explicit);
    const [inCooldown, recentPunishments] = await Promise.all([
      rule.cooldownSeconds > 0
        ? this.prisma.antiCheatEvent
            .count({ where: { playerUuid: player.uuid, cheatType, outcome: { in: PUNISHING_OUTCOMES }, createdAt: { gt: new Date(now.getTime() - rule.cooldownSeconds * 1000) } } })
            .then((n) => n > 0)
        : Promise.resolve(false),
      this.prisma.antiCheatEvent.count({ where: { serverId: server.id, outcome: { in: PUNISHING_OUTCOMES }, createdAt: { gt: new Date(now.getTime() - 60_000) } } }),
    ]);
    const decision = decide(settings, { cheatType, violationLevel: input.violationLevel ?? null, explicit: input.explicit }, { inCooldown, rateLimited: recentPunishments >= settings.maxPunishmentsPerMinute });
    let outcome = decision.outcome;

    let punishmentId: string | null = null;
    if (PUNISHING_OUTCOMES.includes(outcome) && decision.rule) {
      const action = outcome as keyof typeof ACTION_TO_TYPE;
      if (action === 'KICK' && !player.online) {
        outcome = 'SKIPPED_OFFLINE';
      } else {
        try {
          const created = await this.punishments.create({
            type: ACTION_TO_TYPE[action],
            targetUuid: player.uuid,
            reason: (input.reason?.trim() || `[AntiCheat] ${cheatType}`).slice(0, 500),
            durationSeconds: action === 'TEMP_BAN' ? (decision.rule.durationSeconds ?? undefined) : undefined,
            source: PunishmentSource.ANTICHEAT,
            issuer: { type: ActorType.SERVER, name: `AntiCheat (${input.provider})`.slice(0, 64) },
            serverId: server.id,
            idempotencyKey: `ac:${eventKey}`.slice(0, 64),
          });
          punishmentId = created.id;
          if (settings.collectEvidence) {
            await this.prisma.punishmentEvidence.create({
              data: {
                punishmentId,
                kind: 'anticheat',
                title: `${input.provider}: ${cheatType}`.slice(0, 200),
                createdByType: ActorType.SYSTEM,
                createdByName: `AntiCheat (${input.provider})`.slice(0, 64),
                content: input.evidence?.slice(0, 10_000) ?? null,
                metadata: { provider: input.provider, cheatType, violationLevel: input.violationLevel ?? null, rule: decision.matchedCheatType, details: (input.metadata ?? {}) as Prisma.InputJsonValue },
              },
            });
          }
        } catch (err) {
          if (err instanceof ConflictException) outcome = 'SKIPPED_DUPLICATE';
          else throw err;
        }
      }
    }

    const event = await this.prisma.antiCheatEvent.create({
      data: {
        playerUuid: player.uuid,
        serverId: server.id,
        provider: input.provider,
        cheatType,
        violationLevel: input.violationLevel ?? null,
        outcome,
        reason: input.reason?.slice(0, 500) ?? null,
        explicit: input.explicit,
        eventKey,
        punishmentId,
        metadata: settings.collectEvidence ? ({ evidence: input.evidence?.slice(0, 10_000) ?? null, ...(input.metadata ?? {}) } as Prisma.InputJsonValue) : undefined,
      },
    });
    this.realtime.publish({ type: 'anticheat.event', uuid: player.uuid });
    return this.result(event.id, outcome, punishmentId);
  }

  async list(filter: { page: number; pageSize: number; uuid?: string; provider?: string; cheatType?: string; punishedOnly?: boolean }) {
    const where: Prisma.AntiCheatEventWhereInput = {
      ...(filter.uuid ? { playerUuid: filter.uuid } : {}),
      ...(filter.provider ? { provider: filter.provider } : {}),
      ...(filter.cheatType ? { cheatType: filter.cheatType } : {}),
      ...(filter.punishedOnly ? { punishmentId: { not: null } } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.antiCheatEvent.count({ where }),
      this.prisma.antiCheatEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.pageSize,
        take: filter.pageSize,
        include: { player: { select: { uuid: true, username: true, online: true } }, server: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      total,
      page: filter.page,
      pageSize: filter.pageSize,
      items: rows.map((e) => ({
        id: e.id,
        player: e.player,
        server: e.server,
        provider: e.provider,
        cheatType: e.cheatType,
        violationLevel: e.violationLevel,
        outcome: e.outcome,
        explicit: e.explicit,
        reason: e.reason,
        punishmentId: e.punishmentId,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  /** Counters for the AntiCheat page header. */
  async summary(since: Date) {
    const [events, punished, byType, providers] = await Promise.all([
      this.prisma.antiCheatEvent.count({ where: { createdAt: { gte: since } } }),
      this.prisma.antiCheatEvent.count({ where: { createdAt: { gte: since }, punishmentId: { not: null } } }),
      this.prisma.antiCheatEvent.groupBy({ by: ['cheatType'], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { cheatType: 'desc' } }, take: 8 }),
      this.prisma.antiCheatEvent.findMany({ distinct: ['provider'], select: { provider: true }, take: 50 }),
    ]);
    return {
      since: since.toISOString(),
      events,
      punished,
      topCheatTypes: byType.map((t) => ({ cheatType: t.cheatType, count: t._count._all })),
      providers: providers.map((p) => p.provider).sort(),
    };
  }

  private result(eventId: string, outcome: Outcome, punishmentId: string | null) {
    return { eventId, outcome, punishmentId };
  }

  /** Validates a dashboard UUID parameter. */
  static uuid(raw: string): string {
    const uuid = normalizeUuid(raw);
    if (!uuid) throw new NotFoundException();
    return uuid;
  }
}
