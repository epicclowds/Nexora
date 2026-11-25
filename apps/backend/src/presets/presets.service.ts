import { ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { type CommandMode, COMMAND_MODES, MAX_PRESET_NUMERIC_ID, presetPermission, type PresetCategory } from '@mnm/shared-types';
import type { z } from 'zod';
import { AuditService, type AuditActor } from '../audit/audit.service';
import { type Prisma, type PunishmentPreset } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_KEYS, SettingsService } from '../settings/settings.service';
import { type createPresetSchema, type PresetRecord, type ReasonRequest, resolveReason, type ResolvedReason, type updatePresetSchema } from './presets';

const KEYS = { MODE: 'moderation.commandMode', REVISION: 'moderation.revision', IMPORTED: 'moderation.presetsImported' } as const;

export interface Editor {
  userId: string | null;
  name: string;
  actor: AuditActor;
  ipAddress?: string | null;
}

export function serializePreset(p: PunishmentPreset) {
  return {
    id: p.id,
    category: p.category,
    numericId: p.numericId,
    name: p.name,
    reason: p.reason,
    description: p.description,
    durationSeconds: p.permanent ? null : p.durationSeconds,
    permanent: p.permanent,
    permission: p.permission,
    canonicalPermission: p.permission === presetPermission(p.category, p.numericId),
    enabled: p.enabled,
    archived: p.archivedAt !== null,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    sortOrder: p.sortOrder,
    version: p.version,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    updatedBy: p.updatedByName,
  };
}

/**
 * Punishment reason presets and the network-wide command mode. Every change
 * bumps a revision that the plugins receive with their heartbeat, so all
 * proxies and servers pick up new reasons and the mode without a restart.
 */
@Injectable()
export class PresetsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PresetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureMode();
    await this.importLegacyTemplates();
  }

  /**
   * Upgrades keep the previous behaviour (typed reasons only) until the Owner
   * switches the mode; fresh installations start in hybrid mode.
   */
  private async ensureMode(): Promise<void> {
    if (await this.settings.get(KEYS.MODE)) return;
    const upgraded = (await this.settings.get<boolean>(SETTING_KEYS.SETUP_COMPLETED)) === true || (await this.prisma.punishment.count({ take: 1 })) > 0;
    const mode: CommandMode = upgraded ? 'FREE_TEXT' : 'HYBRID';
    await this.settings.set(KEYS.MODE, { mode }, null);
    if (!upgraded && (await this.prisma.punishmentPreset.count()) === 0) await this.seedExamples();
    this.logger.log(`Punishment command mode initialised to ${mode}${upgraded ? ' (existing installation: unchanged behaviour)' : ''}.`);
  }

  /** Example reasons for fresh installations (editable, can be disabled or archived). */
  private async seedExamples(): Promise<void> {
    const d = 86_400;
    const examples: Array<[PresetCategory, number, string, number | null]> = [
      ['BAN', 1, 'Hacking', 30 * d],
      ['BAN', 2, 'Griefing', 7 * d],
      ['BAN', 3, 'Exploiting', 14 * d],
      ['BAN', 4, 'Advertising', 3 * d],
      ['BAN', 5, 'Severe cheating', null],
      ['MUTE', 1, 'Spam', 3600],
      ['MUTE', 2, 'Insulting players', 12 * 3600],
      ['MUTE', 3, 'Advertising', 7 * d],
    ];
    await this.prisma.punishmentPreset.createMany({
      data: examples.map(([category, numericId, name, durationSeconds], index) => ({
        category,
        numericId,
        name,
        reason: name,
        durationSeconds,
        permanent: durationSeconds === null,
        permission: presetPermission(category, numericId),
        sortOrder: index,
        updatedByName: 'setup',
      })),
    });
    await this.settings.set(KEYS.IMPORTED, { at: new Date().toISOString(), imported: 0, seeded: examples.length }, null);
    await this.bumpRevision();
  }

  /** One-time import of the 1.x punishment templates (Settings → Moderation) as numbered presets. */
  private async importLegacyTemplates(): Promise<void> {
    if (await this.settings.get(KEYS.IMPORTED)) return;
    const stored = await this.settings.get<{ presets?: Array<{ name?: string; type?: string; reason?: string; durationSeconds?: number | null }> }>(SETTING_KEYS.MODERATION);
    const legacy = Array.isArray(stored?.presets) ? stored.presets : [];
    let imported = 0;
    if (legacy.length && (await this.prisma.punishmentPreset.count()) === 0) {
      const next: Record<PresetCategory, number> = { BAN: 1, MUTE: 1, KICK: 1, WARN: 1 };
      for (const [index, t] of legacy.entries()) {
        const category: PresetCategory | null = t.type === 'BAN' || t.type === 'TEMP_BAN' ? 'BAN' : t.type === 'MUTE' || t.type === 'TEMP_MUTE' ? 'MUTE' : t.type === 'KICK' ? 'KICK' : t.type === 'WARNING' ? 'WARN' : null;
        if (!category || !t.name || !t.reason) continue;
        const numericId = next[category]++;
        const timed = category === 'BAN' || category === 'MUTE';
        const permanent = timed && (t.type === 'BAN' || t.type === 'MUTE');
        await this.prisma.punishmentPreset.create({
          data: {
            category,
            numericId,
            name: t.name.slice(0, 100),
            reason: t.reason.slice(0, 500),
            durationSeconds: timed && !permanent ? (t.durationSeconds ?? null) : null,
            permanent,
            permission: presetPermission(category, numericId),
            sortOrder: index,
            updatedByName: 'migration',
          },
        });
        imported++;
      }
    }
    await this.settings.set(KEYS.IMPORTED, { at: new Date().toISOString(), imported }, null);
    if (imported) {
      await this.bumpRevision();
      this.logger.log(`Imported ${imported} punishment templates as numbered reason presets.`);
    }
  }

  // ── mode & revision ───────────────────────────────────────────────

  async mode(): Promise<CommandMode> {
    const stored = await this.settings.get<{ mode?: string }>(KEYS.MODE);
    return (COMMAND_MODES as readonly string[]).includes(stored?.mode ?? '') ? (stored!.mode as CommandMode) : 'FREE_TEXT';
  }

  async setMode(mode: CommandMode, editor: Editor): Promise<CommandMode> {
    const before = await this.mode();
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set(KEYS.MODE, { mode }, editor.userId, tx);
      await this.audit.record({ actor: editor.actor, action: 'moderation.command_mode_changed', targetType: 'setting', targetId: KEYS.MODE, metadata: { before, after: mode }, ipAddress: editor.ipAddress ?? null }, tx);
    });
    await this.bumpRevision();
    return mode;
  }

  async revision(): Promise<number> {
    return (await this.settings.get<{ revision?: number }>(KEYS.REVISION))?.revision ?? 0;
  }

  private async bumpRevision(): Promise<void> {
    const next = (await this.revision()) + 1;
    await this.settings.set(KEYS.REVISION, { revision: next }, null);
  }

  // ── presets ───────────────────────────────────────────────────────

  list(options: { includeArchived?: boolean } = {}) {
    return this.prisma.punishmentPreset.findMany({
      where: options.includeArchived ? {} : { archivedAt: null },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { numericId: 'asc' }],
    });
  }

  async create(input: z.infer<typeof createPresetSchema>, editor: Editor) {
    try {
      const preset = await this.prisma.$transaction(async (tx) => {
        const created = await tx.punishmentPreset.create({
          data: {
            category: input.category,
            numericId: input.numericId,
            name: input.name,
            reason: input.reason,
            description: input.description || null,
            durationSeconds: input.permanent ? null : (input.durationSeconds ?? null),
            permanent: input.permanent,
            permission: input.permission || presetPermission(input.category, input.numericId),
            enabled: input.enabled,
            sortOrder: input.sortOrder,
            updatedByUserId: editor.userId,
            updatedByName: editor.name,
          },
        });
        await this.audit.record({ actor: editor.actor, action: 'moderation.preset_created', targetType: 'preset', targetId: created.id, metadata: serializePreset(created), ipAddress: editor.ipAddress ?? null }, tx);
        return created;
      });
      await this.bumpRevision();
      return preset;
    } catch (err) {
      throw this.duplicateError(err, input.category, input.numericId);
    }
  }

  async update(id: string, input: z.infer<typeof updatePresetSchema>, editor: Editor) {
    const current = await this.prisma.punishmentPreset.findUnique({ where: { id } });
    if (!current) throw new NotFoundException({ code: 'PRESET_NOT_FOUND', message: 'Preset not found' });
    if (current.version !== input.version) throw new ConflictException({ code: 'STALE_PRESET', message: 'The preset was changed in the meantime' });
    const timed = current.category === 'BAN' || current.category === 'MUTE';
    if (!timed && (input.durationSeconds || input.permanent)) throw new ConflictException({ code: 'INVALID_DURATION', message: 'Kicks and warnings have no duration' });
    const numericId = input.numericId ?? current.numericId;
    const wasCanonical = current.permission === presetPermission(current.category, current.numericId);
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.punishmentPreset.updateMany({
          where: { id, version: input.version },
          data: {
            numericId,
            name: input.name,
            reason: input.reason,
            description: input.description || null,
            durationSeconds: input.permanent ? null : (input.durationSeconds ?? null),
            permanent: input.permanent,
            // A canonical permission follows a changed numeric ID; custom permissions stay as entered.
            permission: input.permission || (wasCanonical || !current.permission ? presetPermission(current.category, numericId) : current.permission),
            enabled: input.enabled,
            sortOrder: input.sortOrder,
            version: { increment: 1 },
            updatedByUserId: editor.userId,
            updatedByName: editor.name,
          },
        });
        if (result.count === 0) throw new ConflictException({ code: 'STALE_PRESET', message: 'The preset was changed in the meantime' });
        const after = await tx.punishmentPreset.findUniqueOrThrow({ where: { id } });
        await this.audit.record({ actor: editor.actor, action: 'moderation.preset_updated', targetType: 'preset', targetId: id, metadata: { before: serializePreset(current), after: serializePreset(after) }, ipAddress: editor.ipAddress ?? null }, tx);
        return after;
      });
      await this.bumpRevision();
      return updated;
    } catch (err) {
      throw this.duplicateError(err, current.category, numericId);
    }
  }

  /** Archive (hide, keep the numeric ID reserved) or restore. Punishments keep their snapshot. */
  async setArchived(id: string, archived: boolean, editor: Editor) {
    const current = await this.prisma.punishmentPreset.findUnique({ where: { id } });
    if (!current) throw new NotFoundException({ code: 'PRESET_NOT_FOUND', message: 'Preset not found' });
    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.punishmentPreset.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null, enabled: archived ? false : current.enabled, version: { increment: 1 }, updatedByUserId: editor.userId, updatedByName: editor.name },
      });
      await this.audit.record({ actor: editor.actor, action: archived ? 'moderation.preset_archived' : 'moderation.preset_restored', targetType: 'preset', targetId: id, metadata: { category: current.category, numericId: current.numericId, name: current.name }, ipAddress: editor.ipAddress ?? null }, tx);
      return after;
    });
    await this.bumpRevision();
    return updated;
  }

  /** Copy with the next free numeric ID of the category (disabled until reviewed). */
  async duplicate(id: string, editor: Editor) {
    const source = await this.prisma.punishmentPreset.findUnique({ where: { id } });
    if (!source) throw new NotFoundException({ code: 'PRESET_NOT_FOUND', message: 'Preset not found' });
    const used = await this.prisma.punishmentPreset.findMany({ where: { category: source.category }, select: { numericId: true } });
    const taken = new Set(used.map((u) => u.numericId));
    let numericId = 1;
    while (taken.has(numericId) && numericId <= MAX_PRESET_NUMERIC_ID) numericId++;
    if (numericId > MAX_PRESET_NUMERIC_ID) throw new ConflictException({ code: 'NO_FREE_ID', message: 'No free reason ID' });
    return this.create(
      {
        category: source.category,
        numericId,
        name: `${source.name} (copy)`.slice(0, 100),
        reason: source.reason,
        description: source.description,
        durationSeconds: source.durationSeconds,
        permanent: source.permanent,
        permission: null,
        enabled: false,
        sortOrder: source.sortOrder + 1,
      },
      editor,
    );
  }

  private duplicateError(err: unknown, category: PresetCategory, numericId: number): unknown {
    if ((err as { code?: string }).code === 'P2002') {
      return new ConflictException({ code: 'DUPLICATE_PRESET_ID', message: `Reason ID ${numericId} is already used for ${category.toLowerCase()} reasons (archived reasons keep their ID)` });
    }
    return err;
  }

  // ── resolution ────────────────────────────────────────────────────

  /** Applies the global mode, the preset and the actor's permissions to a punishment request. */
  async resolve(request: ReasonRequest, can: (permission: string) => boolean): Promise<ResolvedReason> {
    const [mode, presets] = await Promise.all([this.mode(), this.prisma.punishmentPreset.findMany()]);
    const byKey = new Map(presets.map((p) => [`${p.category}:${p.numericId}`, p as PresetRecord]));
    return resolveReason(mode, request, (category, numericId) => byKey.get(`${category}:${numericId}`) ?? null, can);
  }

  /** What the plugins need: mode, revision and the usable presets (enabled, not archived). */
  async pluginCatalog() {
    const [mode, revision, presets] = await Promise.all([this.mode(), this.revision(), this.prisma.punishmentPreset.findMany({ where: { archivedAt: null, enabled: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { numericId: 'asc' }] })]);
    return {
      mode,
      revision,
      presets: presets.map((p) => ({ category: p.category, numericId: p.numericId, name: p.name, reason: p.reason, durationSeconds: p.permanent ? null : p.durationSeconds, permanent: p.permanent, permission: p.permission })),
    };
  }
}

export type PresetWrite = Prisma.PunishmentPresetUncheckedCreateInput;
