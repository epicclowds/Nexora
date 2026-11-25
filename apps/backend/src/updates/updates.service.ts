import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/app-config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { type ComponentState, componentState, latestRelease, parseReleases, pluginCompatibility, type PluginCompatibility, type ReleaseChannel, type ReleaseInfo } from './releases';
import { compareVersions } from './semver';

export const DEFAULT_RELEASES_URL = 'https://api.github.com/repos/epicclowds/Nexora/releases?per_page=30';
export const RELEASES_PAGE_URL = 'https://github.com/epicclowds/Nexora/releases';

export const updateSettingsSchema = z
  .object({
    /** Periodic checks against the GitHub Releases API. */
    enabled: z.boolean().default(true),
    checkIntervalHours: z.number().int().min(1).max(168).default(6),
    /** stable = only stable releases; prerelease = also release candidates. */
    channel: z.enum(['stable', 'prerelease']).default('stable'),
    dashboardNotifications: z.boolean().default(true),
    minecraftNotifications: z.boolean().default(true),
    /** Minimum time between two in-game notifications for the same staff member. */
    notificationCooldownHours: z.number().int().min(1).max(720).default(24),
    /** Allow "Check for updates" (dashboard) in addition to the schedule. */
    manualChecks: z.boolean().default(true),
  })
  .strict();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export interface CheckError {
  code: 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'HTTP_ERROR' | 'INVALID_RESPONSE';
  status?: number;
  at: string;
}

/** Persisted (system_settings) so the last known result survives restarts and outages. */
export interface UpdateState {
  releases: ReleaseInfo[];
  etag: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: CheckError | null;
  rateLimitedUntil: string | null;
}

const EMPTY_STATE: UpdateState = { releases: [], etag: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, rateLimitedUntil: null };
const KEYS = { SETTINGS: 'updates.settings', STATE: 'updates.state' } as const;
const TICK_MS = 15 * 60_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Manual checks within this window return the cached result instead of calling GitHub again. */
const MANUAL_CHECK_MIN_INTERVAL_MS = 60_000;
const KEEP_RELEASES = 15;
const CACHE_MS = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export const UPDATES_FETCH = Symbol('UPDATES_FETCH');

export interface ServerUpdateStatus {
  id: string;
  name: string;
  type: string;
  status: string;
  pluginVersion: string | null;
  state: ComponentState;
  compatibility: PluginCompatibility;
}

export interface UpdateWarning {
  code: 'UPGRADE_PATH' | 'PLUGIN_INCOMPATIBLE' | 'PLUGIN_VERSION_UNKNOWN';
  version?: string;
  server?: string;
}

/** Heartbeat payload for the plugins (cached data only – plugins never call GitHub). */
export interface PluginUpdateInfo {
  latestVersion: string;
  installedVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string | null;
  checkedAt: string | null;
  notify: boolean;
  cooldownMinutes: number;
}

/**
 * Central update checker. The backend asks the GitHub Releases API (read-only,
 * unauthenticated, conditional requests with ETag) at most every
 * checkIntervalHours and caches the result; dashboards and plugins only read
 * the cache. Nothing is ever downloaded or installed automatically.
 */
@Injectable()
export class UpdatesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UpdatesService.name);
  private readonly fetchImpl: FetchLike;
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<UpdateState> | null = null;
  /** Short-lived cache: several backend replicas share the database values. */
  private cache: { settings?: UpdateSettings; state?: UpdateState; at: number } = { at: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    @Optional() @Inject(UPDATES_FETCH) fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get installedVersion(): string {
    return this.config.version;
  }

  get releasesUrl(): string {
    return this.config.env.UPDATES_RELEASES_URL ?? DEFAULT_RELEASES_URL;
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const tick = () => void this.checkIfDue().catch((err: Error) => this.logger.warn(`Update check failed: ${err.message}`));
    this.firstTimer = setTimeout(tick, FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(tick, TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  // ── settings & state ───────────────────────────────────────────────

  private fresh(): boolean {
    if (Date.now() - this.cache.at > CACHE_MS) this.cache = { at: Date.now() };
    return true;
  }

  async getSettings(): Promise<UpdateSettings> {
    if (this.fresh() && this.cache.settings) return this.cache.settings;
    const parsed = updateSettingsSchema.safeParse((await this.settings.get<unknown>(KEYS.SETTINGS)) ?? {});
    this.cache.settings = parsed.success ? parsed.data : updateSettingsSchema.parse({});
    return this.cache.settings;
  }

  async saveSettings(next: UpdateSettings, userId: string, tx?: Prisma.TransactionClient): Promise<UpdateSettings> {
    const value = updateSettingsSchema.parse(next);
    await this.settings.set(KEYS.SETTINGS, value, userId, tx);
    this.cache.settings = value;
    return value;
  }

  async getState(): Promise<UpdateState> {
    if (this.fresh() && this.cache.state) return this.cache.state;
    const stored = await this.settings.get<Partial<UpdateState>>(KEYS.STATE);
    this.cache.state = { ...EMPTY_STATE, ...(stored ?? {}), releases: Array.isArray(stored?.releases) ? stored.releases : [] };
    return this.cache.state;
  }

  private async saveState(state: UpdateState): Promise<void> {
    this.cache.state = state;
    await this.settings.set(KEYS.STATE, state as unknown as Prisma.InputJsonValue, null);
  }

  // ── checking ───────────────────────────────────────────────────────

  async checkIfDue(now = new Date()): Promise<UpdateState | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;
    const state = await this.getState();
    const last = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    if (now.getTime() - last < settings.checkIntervalHours * 3_600_000) return null;
    return this.check(now);
  }

  /** Manual check: rate-limited per installation (cached result within one minute). */
  async checkNow(now = new Date()): Promise<{ state: UpdateState; refreshed: boolean }> {
    const state = await this.getState();
    const last = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    if (now.getTime() - last < MANUAL_CHECK_MIN_INTERVAL_MS) return { state, refreshed: false };
    return { state: await this.check(now), refreshed: true };
  }

  /** One request at a time; failures keep the last known releases. */
  check(now = new Date()): Promise<UpdateState> {
    this.inFlight ??= this.doCheck(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doCheck(now: Date): Promise<UpdateState> {
    const previous = await this.getState();
    const at = now.toISOString();
    if (previous.rateLimitedUntil && Date.parse(previous.rateLimitedUntil) > now.getTime()) {
      // GitHub asked us to wait; do not send a request before the reset time.
      return previous;
    }
    const base: UpdateState = { ...previous, lastAttemptAt: at };
    const fail = async (error: Omit<CheckError, 'at'>, rateLimitedUntil: string | null = null): Promise<UpdateState> => {
      const state = { ...base, lastError: { ...error, at }, rateLimitedUntil };
      this.logger.warn(`Update check failed (${error.code}${error.status ? ` ${error.status}` : ''}); keeping the last known result.`);
      await this.saveState(state);
      return state;
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.releasesUrl, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': `Nexora/${this.installedVersion} (update check)`,
          ...(previous.etag && previous.releases.length ? { 'if-none-match': previous.etag } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (err) {
      return fail({ code: (err as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' });
    }

    if (response.status === 304) {
      const state = { ...base, lastSuccessAt: at, lastError: null, rateLimitedUntil: null };
      await this.saveState(state);
      return state;
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const retryAfter = Number(response.headers.get('retry-after'));
      if (response.status === 429 || remaining === '0' || retryAfter > 0) {
        const until = retryAfter > 0 ? now.getTime() + retryAfter * 1000 : reset > 0 ? reset * 1000 : now.getTime() + 3_600_000;
        return fail({ code: 'RATE_LIMITED', status: response.status }, new Date(until).toISOString());
      }
    }
    if (!response.ok) return fail({ code: 'HTTP_ERROR', status: response.status });

    let releases: ReleaseInfo[];
    try {
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('response too large');
      releases = parseReleases(JSON.parse(text));
    } catch {
      return fail({ code: 'INVALID_RESPONSE' });
    }
    const kept = [...releases].sort((a, b) => compareVersions(b.version, a.version) ?? 0).slice(0, KEEP_RELEASES);
    const state: UpdateState = { ...base, releases: kept, etag: response.headers.get('etag'), lastSuccessAt: at, lastError: null, rateLimitedUntil: null };
    await this.saveState(state);
    const latest = latestRelease(kept, (await this.getSettings()).channel);
    if (latest && componentState(this.installedVersion, latest.version) === 'outdated') this.logger.log(`Nexora ${latest.version} is available (installed: ${this.installedVersion}): ${latest.url}`);
    return state;
  }

  // ── views ──────────────────────────────────────────────────────────

  async latest(): Promise<ReleaseInfo | null> {
    const [state, settings] = await Promise.all([this.getState(), this.getSettings()]);
    return latestRelease(state.releases, settings.channel as ReleaseChannel);
  }

  /** Full status for Settings → Updates. */
  async status() {
    const [state, settings, latest, servers] = await Promise.all([
      this.getState(),
      this.getSettings(),
      this.latest(),
      this.prisma.server.findMany({ select: { id: true, name: true, type: true, status: true, pluginVersion: true, enabled: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    ]);
    const installed = this.installedVersion;
    // Rules published by the installed release (if it is in the cache), otherwise none.
    const installedRelease = state.releases.find((r) => compareVersions(r.version, installed) === 0) ?? null;
    const rules = installedRelease?.compatibility ?? null;
    const serverStatus: ServerUpdateStatus[] = servers
      .filter((s) => s.enabled)
      .map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        pluginVersion: s.pluginVersion,
        state: componentState(s.pluginVersion, latest?.version),
        compatibility: pluginCompatibility(s.pluginVersion, installed, rules),
      }));
    const warnings: UpdateWarning[] = [];
    const minUpgrade = latest?.compatibility?.minUpgradeFrom;
    if (minUpgrade && compareVersions(installed, minUpgrade) === -1) warnings.push({ code: 'UPGRADE_PATH', version: minUpgrade });
    for (const s of serverStatus) {
      if (s.compatibility === 'incompatible') warnings.push({ code: 'PLUGIN_INCOMPATIBLE', server: s.name, version: s.pluginVersion ?? undefined });
      if (s.compatibility === 'unknown') warnings.push({ code: 'PLUGIN_VERSION_UNKNOWN', server: s.name });
    }
    const backendState = componentState(installed, latest?.version);
    return {
      settings,
      installed: { backend: installed },
      latest,
      backend: { version: installed, state: backendState },
      updateAvailable: backendState === 'outdated',
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      rateLimitedUntil: state.rateLimitedUntil,
      releasesPage: RELEASES_PAGE_URL,
      servers: serverStatus,
      warnings,
    };
  }

  /** Dashboard notification for one user, or null (disabled, up to date, unknown, dismissed). */
  async notificationFor(userId: string) {
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.dashboardNotifications) return null;
    const latest = await this.latest();
    if (!latest || componentState(this.installedVersion, latest.version) !== 'outdated') return null;
    const user = await this.prisma.dashboardUser.findUnique({ where: { id: userId }, select: { dismissedUpdateVersion: true } });
    if (user?.dismissedUpdateVersion && compareVersions(user.dismissedUpdateVersion, latest.version) !== null && compareVersions(user.dismissedUpdateVersion, latest.version)! >= 0) return null;
    return { currentVersion: this.installedVersion, latestVersion: latest.version, publishedAt: latest.publishedAt, url: latest.url, name: latest.name, notes: latest.notes };
  }

  /** Hides the notification for this version (it returns for a newer one). */
  async dismiss(userId: string, version: string): Promise<void> {
    await this.prisma.dashboardUser.update({ where: { id: userId }, data: { dismissedUpdateVersion: version } });
  }

  /** Cached update information sent with each plugin heartbeat response. */
  async pluginInfo(pluginVersion: string | null | undefined): Promise<PluginUpdateInfo | null> {
    const [settings, state] = await Promise.all([this.getSettings(), this.getState()]);
    if (!settings.enabled) return null;
    const latest = latestRelease(state.releases, settings.channel);
    if (!latest) return null;
    return {
      latestVersion: latest.version,
      installedVersion: pluginVersion ?? '',
      updateAvailable: componentState(pluginVersion, latest.version) === 'outdated',
      releaseUrl: latest.url,
      publishedAt: latest.publishedAt,
      checkedAt: state.lastSuccessAt,
      notify: settings.minecraftNotifications,
      cooldownMinutes: settings.notificationCooldownHours * 60,
    };
  }
}
