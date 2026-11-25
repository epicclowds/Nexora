import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, Optional } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/app-config';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SettingsService } from '../settings/settings.service';
import { type ComponentState, componentState, latestRelease, parseReleases, pluginCompatibility, type PluginCompatibility, type ReleaseChannel, type ReleaseInfo } from './releases';
import { compareVersions } from './semver';

export const DEFAULT_RELEASES_URL = 'https://api.github.com/repos/epicclowds/Nexora/releases?per_page=30';
export const RELEASES_PAGE_URL = 'https://github.com/epicclowds/Nexora/releases';
/** The optional GitHub token is only ever sent to this host. */
const GITHUB_API_HOST = 'api.github.com';

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
  code: 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'TOKEN_INVALID' | 'HTTP_ERROR' | 'INVALID_RESPONSE';
  status?: number;
  at: string;
}

/** GitHub's rate-limit headers of the last response (for display; never a secret). */
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: string | null;
  resource: string | null;
}

/** Shared state: Redis (fast, shared by all replicas) and the database (durable). */
export interface UpdateState {
  releases: ReleaseInfo[];
  etag: string | null;
  lastModified: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: CheckError | null;
  /** No request to GitHub before this time (rate limit / Retry-After). */
  rateLimitedUntil: string | null;
  /** When the scheduler may ask GitHub next (interval after success, backoff after failures). */
  nextCheckAt: string | null;
  consecutiveFailures: number;
  rateLimit: RateLimitInfo | null;
}

const EMPTY_STATE: UpdateState = {
  releases: [],
  etag: null,
  lastModified: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  rateLimitedUntil: null,
  nextCheckAt: null,
  consecutiveFailures: 0,
  rateLimit: null,
};
const KEYS = { SETTINGS: 'updates.settings', STATE: 'updates.state' } as const;
const REDIS_STATE_KEY = 'nexora:updates:state';
const REDIS_LOCK_KEY = 'nexora:updates:check-lock';
const LOCK_TTL_MS = 30_000;
const TICK_MS = 5 * 60_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Manual checks within this window return the cached result instead of calling GitHub again. */
const MANUAL_CHECK_MIN_INTERVAL_MS = 60_000;
const KEEP_RELEASES = 15;
const SETTINGS_CACHE_MS = 60_000;
/** Backoff after failures that are not rate limits: 15 min, 30 min, 1 h, … (capped at the interval). */
const FAILURE_BACKOFF_MS = 15 * 60_000;
/** Secondary rate limits without headers: wait at least one minute, doubling (GitHub's guidance). */
const SECONDARY_LIMIT_MS = 60_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export const UPDATES_FETCH = Symbol('UPDATES_FETCH');

export type Verification = 'up-to-date' | 'update-available' | 'unable-to-verify';

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

export type CheckOutcome = 'checked' | 'recent' | 'rate-limited' | 'busy';

/**
 * Central update checker. Only the backend talks to GitHub (read-only), at
 * most once per check interval across all replicas: the result is cached in
 * Redis (shared) and the database (survives restarts), a Redis lock makes
 * sure only one replica sends a request, conditional requests (ETag /
 * Last-Modified) make unchanged answers free, and GitHub's rate-limit
 * headers decide when the next request may be sent. Dashboard page loads,
 * notifications and plugin heartbeats only read the cache. Nothing is ever
 * downloaded or installed automatically.
 */
@Injectable()
export class UpdatesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(UpdatesService.name);
  private readonly fetchImpl: FetchLike;
  private timer: NodeJS.Timeout | null = null;
  private firstTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<UpdateState> | null = null;
  private settingsCache: { value: UpdateSettings; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: AppConfig,
    @Optional() private readonly redis?: RedisService,
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

  /** True when a GitHub token is configured and will be used for the configured URL. */
  get authenticated(): boolean {
    return Boolean(this.token());
  }

  /** The token, only for https://api.github.com (never for mirrors, never logged or returned). */
  private token(): string | null {
    const token = this.config.env.GITHUB_TOKEN;
    if (!token) return null;
    try {
      const url = new URL(this.releasesUrl);
      return url.protocol === 'https:' && url.hostname === GITHUB_API_HOST ? token : null;
    } catch {
      return null;
    }
  }

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    if (this.config.env.GITHUB_TOKEN && !this.token()) this.logger.warn('GITHUB_TOKEN is set but not used: it is only sent to https://api.github.com.');
    const tick = () => void this.checkIfDue().catch((err: Error) => this.logger.warn(`Update check failed: ${err.message}`));
    this.firstTimer = setTimeout(tick, FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(tick, TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  // ── settings & state ───────────────────────────────────────────────

  async getSettings(): Promise<UpdateSettings> {
    if (this.settingsCache && Date.now() - this.settingsCache.at < SETTINGS_CACHE_MS) return this.settingsCache.value;
    const parsed = updateSettingsSchema.safeParse((await this.settings.get<unknown>(KEYS.SETTINGS)) ?? {});
    const value = parsed.success ? parsed.data : updateSettingsSchema.parse({});
    this.settingsCache = { value, at: Date.now() };
    return value;
  }

  async saveSettings(next: UpdateSettings, userId: string, tx?: Prisma.TransactionClient): Promise<UpdateSettings> {
    const value = updateSettingsSchema.parse(next);
    const before = await this.getSettings();
    await this.settings.set(KEYS.SETTINGS, value, userId, tx);
    this.settingsCache = { value, at: Date.now() };
    // A shorter interval applies right away instead of after the old one.
    if (value.checkIntervalHours < before.checkIntervalHours) {
      const state = await this.getState();
      if (state.lastSuccessAt && state.nextCheckAt) {
        const next = Date.parse(state.lastSuccessAt) + value.checkIntervalHours * 3_600_000;
        if (next < Date.parse(state.nextCheckAt)) await this.saveState({ ...state, nextCheckAt: new Date(next).toISOString() });
      }
    }
    return value;
  }

  private normalise(stored: Partial<UpdateState> | null | undefined): UpdateState {
    return { ...EMPTY_STATE, ...(stored ?? {}), releases: Array.isArray(stored?.releases) ? stored.releases : [] };
  }

  /** Redis first (shared by all replicas); the database when Redis is empty or unavailable. */
  async getState(): Promise<UpdateState> {
    const cached = await this.redis?.client.get(REDIS_STATE_KEY).catch(() => null);
    if (cached) {
      try {
        return this.normalise(JSON.parse(cached) as Partial<UpdateState>);
      } catch {
        // fall through to the database
      }
    }
    const state = this.normalise(await this.settings.get<Partial<UpdateState>>(KEYS.STATE));
    await this.redis?.client.set(REDIS_STATE_KEY, JSON.stringify(state)).catch(() => undefined);
    return state;
  }

  private async saveState(state: UpdateState): Promise<void> {
    await this.settings.set(KEYS.STATE, state as unknown as Prisma.InputJsonValue, null);
    await this.redis?.client.set(REDIS_STATE_KEY, JSON.stringify(state)).catch(() => undefined);
  }

  // ── checking ───────────────────────────────────────────────────────

  /** Scheduled check: only when enabled and due (interval, backoff and rate limits respected). */
  async checkIfDue(now = new Date()): Promise<UpdateState | null> {
    const settings = await this.getSettings();
    if (!settings.enabled) return null;
    const state = await this.getState();
    if (!this.isDue(state, settings, now)) return null;
    return this.check(now);
  }

  private isDue(state: UpdateState, settings: UpdateSettings, now: Date): boolean {
    if (state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > now.getTime()) return false;
    if (state.nextCheckAt) return Date.parse(state.nextCheckAt) <= now.getTime();
    // State from 1.2.0 (no nextCheckAt yet): interval after the last attempt.
    const last = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    return now.getTime() - last >= (state.lastSuccessAt ? settings.checkIntervalHours * 3_600_000 : FAILURE_BACKOFF_MS);
  }

  /** Manual check: never during a rate limit, at most once a minute per installation. */
  async checkNow(now = new Date()): Promise<{ state: UpdateState; refreshed: boolean; outcome: CheckOutcome }> {
    const state = await this.getState();
    if (state.rateLimitedUntil && Date.parse(state.rateLimitedUntil) > now.getTime()) return { state, refreshed: false, outcome: 'rate-limited' };
    const last = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
    if (now.getTime() - last < MANUAL_CHECK_MIN_INTERVAL_MS) return { state, refreshed: false, outcome: 'recent' };
    const before = state.lastAttemptAt;
    const after = await this.check(now);
    const refreshed = after.lastAttemptAt !== before;
    return { state: after, refreshed, outcome: refreshed ? 'checked' : 'busy' };
  }

  /** One request at a time per process, and – with Redis – per installation. */
  check(now = new Date()): Promise<UpdateState> {
    this.inFlight ??= this.lockedCheck(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async lockedCheck(now: Date): Promise<UpdateState> {
    const lockToken = randomUUID();
    let locked = true;
    if (this.redis) {
      const result = await this.redis.client.set(REDIS_LOCK_KEY, lockToken, 'PX', LOCK_TTL_MS, 'NX').catch(() => 'unavailable' as const);
      // Another replica is checking right now: use its result instead of sending a second request.
      if (result === null) return this.getState();
      locked = result === 'OK';
    }
    try {
      return await this.doCheck(now);
    } finally {
      if (this.redis && locked) {
        await this.redis.client
          .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, REDIS_LOCK_KEY, lockToken)
          .catch(() => undefined);
      }
    }
  }

  private async doCheck(now: Date): Promise<UpdateState> {
    const previous = await this.getState();
    const settings = await this.getSettings();
    const at = now.toISOString();
    if (previous.rateLimitedUntil && Date.parse(previous.rateLimitedUntil) > now.getTime()) {
      // GitHub asked us to wait; never send a request before that time.
      return previous;
    }
    const intervalMs = settings.checkIntervalHours * 3_600_000;
    const base: UpdateState = { ...previous, lastAttemptAt: at };
    const fail = async (error: Omit<CheckError, 'at'>, waitUntil: number | null, rateLimit: RateLimitInfo | null): Promise<UpdateState> => {
      const failures = previous.consecutiveFailures + 1;
      const backoff = Math.min(intervalMs, FAILURE_BACKOFF_MS * 2 ** (failures - 1));
      const next = waitUntil ?? now.getTime() + backoff;
      const state: UpdateState = {
        ...base,
        lastError: { ...error, at },
        rateLimitedUntil: error.code === 'RATE_LIMITED' && waitUntil ? new Date(waitUntil).toISOString() : null,
        nextCheckAt: new Date(next).toISOString(),
        consecutiveFailures: failures,
        rateLimit: rateLimit ?? previous.rateLimit,
      };
      this.logger.warn(
        `Update check failed (${error.code}${error.status ? ` ${error.status}` : ''}); keeping the last known result, next attempt after ${state.nextCheckAt}.` +
          (error.code === 'RATE_LIMITED' && !this.authenticated ? ' Unauthenticated requests share 60 per hour per public IP address; set GITHUB_TOKEN to raise the limit.' : ''),
      );
      await this.saveState(state);
      return state;
    };

    const token = this.token();
    const conditional = previous.releases.length > 0;
    let response: Response;
    try {
      response = await this.fetchImpl(this.releasesUrl, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': `Nexora/${this.installedVersion} (update check; +https://github.com/epicclowds/Nexora)`,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(conditional && previous.etag ? { 'if-none-match': previous.etag } : {}),
          ...(conditional && previous.lastModified ? { 'if-modified-since': previous.lastModified } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (err) {
      return fail({ code: (err as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK' }, null, null);
    }

    const rateLimit = readRateLimit(response.headers);
    if (response.status === 304) {
      const state: UpdateState = { ...base, lastSuccessAt: at, lastError: null, rateLimitedUntil: null, nextCheckAt: new Date(now.getTime() + intervalMs).toISOString(), consecutiveFailures: 0, rateLimit };
      await this.saveState(state);
      return state;
    }
    if (response.status === 401) return fail({ code: 'TOKEN_INVALID', status: 401 }, null, rateLimit);
    if (response.status === 403 || response.status === 429) {
      let wait = rateLimitWait(response, now.getTime(), previous.consecutiveFailures);
      // Secondary rate limits may come without headers; GitHub names them in the message.
      if (wait === null && /rate limit/i.test(await response.text().catch(() => ''))) wait = now.getTime() + SECONDARY_LIMIT_MS * 2 ** Math.min(previous.consecutiveFailures, 6);
      if (wait !== null) return fail({ code: 'RATE_LIMITED', status: response.status }, wait, rateLimit);
    }
    if (!response.ok) return fail({ code: 'HTTP_ERROR', status: response.status }, null, rateLimit);

    let releases: ReleaseInfo[];
    try {
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new Error('response too large');
      releases = parseReleases(JSON.parse(text));
    } catch {
      return fail({ code: 'INVALID_RESPONSE' }, null, rateLimit);
    }
    const kept = [...releases].sort((a, b) => compareVersions(b.version, a.version) ?? 0).slice(0, KEEP_RELEASES);
    const state: UpdateState = {
      ...base,
      releases: kept,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      lastSuccessAt: at,
      lastError: null,
      rateLimitedUntil: null,
      nextCheckAt: new Date(now.getTime() + intervalMs).toISOString(),
      consecutiveFailures: 0,
      rateLimit,
    };
    await this.saveState(state);
    const latest = latestRelease(kept, settings.channel);
    if (latest && componentState(this.installedVersion, latest.version) === 'outdated') this.logger.log(`Nexora ${latest.version} is available (installed: ${this.installedVersion}): ${latest.url}`);
    return state;
  }

  // ── views ──────────────────────────────────────────────────────────

  async latest(): Promise<ReleaseInfo | null> {
    const [state, settings] = await Promise.all([this.getState(), this.getSettings()]);
    return latestRelease(state.releases, settings.channel as ReleaseChannel);
  }

  /** Full status for Settings → Updates (cache only – never triggers a GitHub request). */
  async status() {
    const [state, settings, servers] = await Promise.all([
      this.getState(),
      this.getSettings(),
      this.prisma.server.findMany({ select: { id: true, name: true, type: true, status: true, pluginVersion: true, enabled: true }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    ]);
    const latest = latestRelease(state.releases, settings.channel);
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
      verification: verification(backendState, latest),
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      rateLimitedUntil: state.rateLimitedUntil,
      nextCheckAt: settings.enabled ? state.nextCheckAt : null,
      rateLimit: state.rateLimit,
      authenticated: this.authenticated,
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

/** Up to date / update available only with verified release data; otherwise "unable to verify". */
export function verification(backendState: ComponentState, latest: ReleaseInfo | null): Verification {
  if (!latest) return 'unable-to-verify';
  if (backendState === 'outdated') return 'update-available';
  if (backendState === 'current' || backendState === 'newer') return 'up-to-date';
  return 'unable-to-verify';
}

function readRateLimit(headers: Headers): RateLimitInfo | null {
  const num = (name: string) => {
    const value = headers.get(name);
    return value === null || value.trim() === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  const limit = num('x-ratelimit-limit');
  const remaining = num('x-ratelimit-remaining');
  const reset = num('x-ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, resetAt: reset === null ? null : new Date(reset * 1000).toISOString(), resource: headers.get('x-ratelimit-resource') };
}

/**
 * When a 403/429 is a rate limit, the time before which no request may be sent
 * (GitHub's documented order: Retry-After, then x-ratelimit-reset when nothing
 * is remaining, otherwise at least one minute, doubling for repeated secondary
 * limits). null when the 403 is not a rate limit (e.g. access denied).
 */
export function rateLimitWait(response: Response, now: number, previousFailures: number): number | null {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return now + retryAfter * 1000;
  const remaining = response.headers.get('x-ratelimit-remaining');
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  if (remaining === '0' && Number.isFinite(reset) && reset > 0) return Math.max(reset * 1000, now + 1000);
  if (response.status === 429 || remaining === '0') return now + SECONDARY_LIMIT_MS * 2 ** Math.min(previousFailures, 6);
  return null;
}
