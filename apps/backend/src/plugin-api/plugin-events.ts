import { z } from 'zod';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const uuidSchema = z.string().regex(UUID, 'Expected a dashed UUID').transform((v) => v.toLowerCase());

/** Epoch milliseconds from the plugin clock. Future values (clock drift) are clamped to "now". */
export const instantSchema = z
  .number()
  .int()
  .positive()
  .transform((ms) => new Date(Math.min(ms, Date.now())));

// Minecraft names are 3–16 chars [A-Za-z0-9_]; offline-mode/Bedrock proxies may use other characters.
const usernameSchema = z.string().min(1).max(16).regex(/^[A-Za-z0-9_.*-]+$/);
const serverNameSchema = z.string().min(1).max(64);

export const joinEventSchema = z.object({
  type: z.literal('player.join'),
  sessionKey: uuidSchema,
  uuid: uuidSchema,
  username: usernameSchema,
  at: instantSchema,
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  virtualHost: z.string().max(255).optional(),
  protocol: z.number().int().min(0).max(1_000_000).optional(),
  clientVersion: z.string().max(32).optional(),
  /** Base64 'textures' game-profile property (skin). */
  textures: z.string().max(8192).optional(),
});

export const switchEventSchema = z.object({
  type: z.literal('player.switch'),
  sessionKey: uuidSchema,
  uuid: uuidSchema,
  server: serverNameSchema,
  at: instantSchema,
});

export const brandEventSchema = z.object({
  type: z.literal('player.brand'),
  sessionKey: uuidSchema,
  uuid: uuidSchema,
  brand: z.string().max(128),
});

export const leaveEventSchema = z.object({
  type: z.literal('player.leave'),
  sessionKey: uuidSchema,
  uuid: uuidSchema,
  at: instantSchema,
});

export const pluginEventSchema = z.discriminatedUnion('type', [joinEventSchema, switchEventSchema, brandEventSchema, leaveEventSchema]);
export type PluginEvent = z.infer<typeof pluginEventSchema>;
export type JoinEvent = z.infer<typeof joinEventSchema>;

export const eventBatchSchema = z.object({ events: z.array(pluginEventSchema).min(1).max(500) });

export const syncSchema = z.object({
  sessions: z
    .array(
      z.object({
        sessionKey: uuidSchema,
        uuid: uuidSchema,
        username: usernameSchema,
        server: serverNameSchema.optional(),
      }),
    )
    .max(100_000),
});
export type SyncInput = z.infer<typeof syncSchema>;

export const heartbeatSchema = z.object({
  pluginVersion: z.string().min(1).max(32),
  platformVersion: z.string().max(128).optional(),
  minecraftVersion: z.string().max(32).optional(),
  onlinePlayers: z.number().int().min(0).max(1_000_000),
  maxPlayers: z.number().int().min(0).max(1_000_000).optional(),
  tps: z.number().min(0).max(1000).optional(),
  mspt: z.number().min(0).max(1_000_000).optional(),
  memoryUsedBytes: z.number().int().min(0).optional(),
  memoryMaxBytes: z.number().int().min(0).optional(),
  cpuLoad: z.number().min(0).max(1).optional(),
  /** Paper only: per-player state that is only known on the backend server. */
  players: z
    .array(z.object({ uuid: uuidSchema, gamemode: z.enum(['SURVIVAL', 'CREATIVE', 'ADVENTURE', 'SPECTATOR']) }))
    .max(10_000)
    .optional(),
});
export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
