/**
 * Statistic keys reported by the Paper plugin.
 *
 * - `custom:<namespaced key>`  vanilla untyped statistics (e.g. custom:minecraft:jump)
 * - `mined:` / `placed:` / `killed:` + namespaced id  per block / entity type
 * - `mnm:*`  values tracked by the plugin itself (AFK time, chat, XP) or totals
 *
 * Values are cumulative per server. A missing value means "never collected".
 */
export type StatCategory = 'movement' | 'combat' | 'blocks' | 'general';
/** cm: distance in centimetres; damage: tenths of a heart; ticks: 1/20 s. */
export type StatUnit = 'count' | 'cm' | 'damage' | 'ticks' | 'seconds';

export const STATS = {
  WALK: 'custom:minecraft:walk_one_cm',
  SPRINT: 'custom:minecraft:sprint_one_cm',
  CROUCH: 'custom:minecraft:crouch_one_cm',
  SWIM: 'custom:minecraft:swim_one_cm',
  FLY: 'custom:minecraft:fly_one_cm',
  ELYTRA: 'custom:minecraft:aviate_one_cm',
  BOAT: 'custom:minecraft:boat_one_cm',
  MINECART: 'custom:minecraft:minecart_one_cm',
  HORSE: 'custom:minecraft:horse_one_cm',
  JUMPS: 'custom:minecraft:jump',
  PLAYER_KILLS: 'custom:minecraft:player_kills',
  MOB_KILLS: 'custom:minecraft:mob_kills',
  DEATHS: 'custom:minecraft:deaths',
  DAMAGE_DEALT: 'custom:minecraft:damage_dealt',
  DAMAGE_TAKEN: 'custom:minecraft:damage_taken',
  FISH_CAUGHT: 'custom:minecraft:fish_caught',
  PLAY_TIME: 'custom:minecraft:play_time',
  BLOCKS_MINED: 'mnm:blocks_mined',
  BLOCKS_PLACED: 'mnm:blocks_placed',
  ITEMS_CRAFTED: 'mnm:items_crafted',
  ITEMS_USED: 'mnm:items_used',
  ACTIVE_TIME: 'mnm:active_time',
  AFK_TIME: 'mnm:afk_time',
  CHAT_MESSAGES: 'mnm:chat_messages',
  XP_GAINED: 'mnm:xp_gained',
} as const;

export type StatKey = (typeof STATS)[keyof typeof STATS];

export const STAT_PREFIXES = { MINED: 'mined:', PLACED: 'placed:', KILLED: 'killed:' } as const;

export interface StatDefinition {
  key: StatKey;
  category: StatCategory;
  unit: StatUnit;
}

export const STAT_DEFINITIONS: readonly StatDefinition[] = [
  { key: STATS.WALK, category: 'movement', unit: 'cm' },
  { key: STATS.SPRINT, category: 'movement', unit: 'cm' },
  { key: STATS.CROUCH, category: 'movement', unit: 'cm' },
  { key: STATS.SWIM, category: 'movement', unit: 'cm' },
  { key: STATS.FLY, category: 'movement', unit: 'cm' },
  { key: STATS.ELYTRA, category: 'movement', unit: 'cm' },
  { key: STATS.BOAT, category: 'movement', unit: 'cm' },
  { key: STATS.MINECART, category: 'movement', unit: 'cm' },
  { key: STATS.HORSE, category: 'movement', unit: 'cm' },
  { key: STATS.JUMPS, category: 'movement', unit: 'count' },
  { key: STATS.PLAYER_KILLS, category: 'combat', unit: 'count' },
  { key: STATS.MOB_KILLS, category: 'combat', unit: 'count' },
  { key: STATS.DEATHS, category: 'combat', unit: 'count' },
  { key: STATS.DAMAGE_DEALT, category: 'combat', unit: 'damage' },
  { key: STATS.DAMAGE_TAKEN, category: 'combat', unit: 'damage' },
  { key: STATS.BLOCKS_MINED, category: 'blocks', unit: 'count' },
  { key: STATS.BLOCKS_PLACED, category: 'blocks', unit: 'count' },
  { key: STATS.PLAY_TIME, category: 'general', unit: 'ticks' },
  { key: STATS.ACTIVE_TIME, category: 'general', unit: 'seconds' },
  { key: STATS.AFK_TIME, category: 'general', unit: 'seconds' },
  { key: STATS.FISH_CAUGHT, category: 'general', unit: 'count' },
  { key: STATS.ITEMS_CRAFTED, category: 'general', unit: 'count' },
  { key: STATS.ITEMS_USED, category: 'general', unit: 'count' },
  { key: STATS.CHAT_MESSAGES, category: 'general', unit: 'count' },
  { key: STATS.XP_GAINED, category: 'general', unit: 'count' },
];

/** Ores shown in the ore breakdown (vanilla block ids). */
export const ORE_BLOCKS = [
  'minecraft:coal_ore', 'minecraft:deepslate_coal_ore',
  'minecraft:iron_ore', 'minecraft:deepslate_iron_ore',
  'minecraft:copper_ore', 'minecraft:deepslate_copper_ore',
  'minecraft:gold_ore', 'minecraft:deepslate_gold_ore', 'minecraft:nether_gold_ore',
  'minecraft:redstone_ore', 'minecraft:deepslate_redstone_ore',
  'minecraft:lapis_ore', 'minecraft:deepslate_lapis_ore',
  'minecraft:diamond_ore', 'minecraft:deepslate_diamond_ore',
  'minecraft:emerald_ore', 'minecraft:deepslate_emerald_ore',
  'minecraft:nether_quartz_ore', 'minecraft:ancient_debris',
] as const;

/** Statistics offered as network leaderboards. */
export const LEADERBOARD_STATS: readonly StatKey[] = [
  STATS.ACTIVE_TIME, STATS.BLOCKS_MINED, STATS.BLOCKS_PLACED, STATS.MOB_KILLS, STATS.PLAYER_KILLS,
  STATS.DEATHS, STATS.WALK, STATS.ELYTRA, STATS.FISH_CAUGHT, STATS.CHAT_MESSAGES, STATS.JUMPS,
];

/** Accepted key syntax (validated on ingestion). */
export const STAT_KEY_PATTERN = /^(custom:minecraft:[a-z0-9_]{1,64}|mnm:[a-z_]{1,48}|(mined|placed|killed):minecraft:[a-z0-9_]{1,64})$/;
