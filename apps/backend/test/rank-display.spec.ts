import { minecraftPlainText, parseMinecraftText } from '@mnm/shared-types';
import { describe, expect, it } from 'vitest';
import { decodeIcon, MAX_ICON_BYTES, type RankDisplayConfig, rankDisplaySchema, resolveRank, sniffIconType } from '../src/luckperms/rank-display';

const plain = { color: null, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };

describe('Minecraft text formatting', () => {
  it('renders the reported LuckPerms prefix "&4&lADMIN &4" as bold dark red ADMIN', () => {
    expect(parseMinecraftText('&4&lADMIN &4')).toEqual([{ ...plain, text: 'ADMIN', color: '#AA0000', bold: true }]);
  });

  it('supports legacy & and § colours, styles and reset', () => {
    expect(parseMinecraftText('§6§l[Admin]')).toEqual([{ ...plain, text: '[Admin]', color: '#FFAA00', bold: true }]);
    expect(parseMinecraftText('&c&oIt&r&nUnder&mStrike')).toEqual([
      { ...plain, text: 'It', color: '#FF5555', italic: true },
      { ...plain, text: 'Under', underlined: true },
      { ...plain, text: 'Strike', underlined: true, strikethrough: true },
    ]);
    // A colour code resets the styles, as in Minecraft.
    expect(parseMinecraftText('&l&4X')).toEqual([{ ...plain, text: 'X', color: '#AA0000' }]);
    expect(parseMinecraftText('&kmagic')[0].obfuscated).toBe(true);
  });

  it('supports RGB hex colours in all common notations', () => {
    expect(parseMinecraftText('&#1E90FF[Dev]')[0]).toMatchObject({ text: '[Dev]', color: '#1E90FF' });
    expect(parseMinecraftText('§x§1§e§9§0§f§f[Dev]')[0]).toMatchObject({ text: '[Dev]', color: '#1E90FF' });
    expect(parseMinecraftText('&x&1&e&9&0&f&f[Dev]')[0]).toMatchObject({ text: '[Dev]', color: '#1E90FF' });
    expect(parseMinecraftText('{#1E90FF}[Dev]')[0]).toMatchObject({ text: '[Dev]', color: '#1E90FF' });
  });

  it('supports MiniMessage colours, styles, nesting and reset', () => {
    expect(parseMinecraftText('<green>[Helper]</green>')).toEqual([{ ...plain, text: '[Helper]', color: '#55FF55' }]);
    expect(parseMinecraftText('<color:#ff00aa><b>VIP</b>+</color>')).toEqual([
      { ...plain, text: 'VIP', color: '#FF00AA', bold: true },
      { ...plain, text: '+', color: '#FF00AA' },
    ]);
    expect(parseMinecraftText('<#123456><italic>A<reset>B')).toEqual([
      { ...plain, text: 'A', color: '#123456', italic: true },
      { ...plain, text: 'B' },
    ]);
    expect(parseMinecraftText('<gradient:red:blue>[Owner]</gradient>')[0]).toMatchObject({ text: '[Owner]', color: '#FF5555' });
    expect(parseMinecraftText('<hover:show_text:Hi><u>Mod</u></hover>')).toEqual([{ ...plain, text: 'Mod', underlined: true }]);
  });

  it('keeps plain text, trims whitespace and drops formatting without text', () => {
    expect(parseMinecraftText('Member')).toEqual([{ ...plain, text: 'Member' }]);
    expect(parseMinecraftText('  &7  [Mod]   &r ')).toEqual([{ ...plain, text: '[Mod]', color: '#AAAAAA' }]);
    expect(parseMinecraftText('')).toEqual([]);
    expect(parseMinecraftText(null)).toEqual([]);
    expect(parseMinecraftText('&7&l')).toEqual([]);
    expect(minecraftPlainText('Tom & Jerry')).toBe('Tom & Jerry');
  });

  it('degrades invalid formatting to readable text', () => {
    expect(minecraftPlainText('&z&#12345G<color:nope>X')).toBe('&z&#12345GX');
    expect(minecraftPlainText('5 < 6 > 4')).toBe('5 < 6 > 4');
    expect(minecraftPlainText('§')).toBe('');
  });

  it('never produces markup: unknown tags stay inert text, output is plain data', () => {
    const segments = parseMinecraftText('<script>alert(1)</script><img src=x onerror=alert(1)>&c[X]');
    for (const s of segments) {
      expect(Object.keys(s).sort()).toEqual(['bold', 'color', 'italic', 'obfuscated', 'strikethrough', 'text', 'underlined']);
      expect(s.color === null || /^#[0-9A-F]{6}$/.test(s.color)).toBe(true);
    }
    // Text is returned verbatim for React to escape – it is never interpreted as HTML.
    expect(segments.map((s) => s.text).join('')).toBe('<script>alert(1)</script><img src=x onerror=alert(1)>[X]');
    expect(parseMinecraftText('<color:red;background:url(x)>A')[0].color).toBeNull();
  });
});

const now = new Date('2026-11-25T12:00:00Z');
function snapshot(over: Partial<{ primaryGroup: string | null; groupDisplay: string | null; prefix: string | null }> = {}) {
  return { primaryGroup: 'administrator', groupDisplay: null, prefix: '&4&lADMIN &4', groups: ['administrator', 'default'], source: 'LUCKPERMS', synchronizedAt: now, ...over };
}
function config(over: Partial<RankDisplayConfig> = {}): Map<string, RankDisplayConfig> {
  const c: RankDisplayConfig = {
    id: 'rd1', groupName: 'administrator', enabled: true, displaySource: 'CUSTOM', displayName: 'ADMIN', textColor: '#AA0000', backgroundColor: '#2A1010', bold: true,
    iconText: null, hasIcon: false, fallbackText: null, tooltip: null, updatedAt: now, ...over,
  };
  return new Map([[c.groupName, c]]);
}

describe('rank display resolution', () => {
  it('uses the formatted LuckPerms prefix when no display name is set', () => {
    const rank = resolveRank(snapshot(), new Map())!;
    expect(rank.display.source).toBe('LUCKPERMS_PREFIX');
    expect(rank.display.segments).toEqual([{ ...plain, text: 'ADMIN', color: '#AA0000', bold: true }]);
    expect(rank.displayName).toBe('ADMIN');
    expect(rank.color).toBe('#AA0000');
    expect(rank.displayName).not.toContain('&');
  });

  it('prefers a formatted LuckPerms display name, coloured by the prefix when it has no colour', () => {
    expect(resolveRank(snapshot({ groupDisplay: '&cAdmin' }), new Map())!.display).toMatchObject({ source: 'LUCKPERMS_DISPLAY_NAME', segments: [{ text: 'Admin', color: '#FF5555' }] });
    expect(resolveRank(snapshot({ groupDisplay: 'Administrator' }), new Map())!.display.segments[0]).toMatchObject({ text: 'Administrator', color: '#AA0000' });
    // A display name that is just the group identifier yields to the prefix.
    expect(resolveRank(snapshot({ groupDisplay: 'administrator' }), new Map())!.display.source).toBe('LUCKPERMS_PREFIX');
  });

  it('falls back to the readable group name, then to nothing', () => {
    expect(resolveRank(snapshot({ prefix: null, primaryGroup: 'senior_mod' }), new Map())!.display).toMatchObject({ source: 'GROUP_NAME', segments: [{ text: 'Senior Mod' }] });
    expect(resolveRank(snapshot({ prefix: '&7', primaryGroup: null }), new Map())).toBeNull();
    expect(resolveRank(null, new Map())).toBeNull();
  });

  it('applies an explicit Nexora override first', () => {
    const rank = resolveRank(snapshot({ groupDisplay: '&cSomething else' }), config())!;
    expect(rank.display).toMatchObject({ source: 'CUSTOM', textColor: '#AA0000', backgroundColor: '#2A1010', bold: true, segments: [{ text: 'ADMIN', color: '#AA0000' }] });
  });

  it('maps groups case-insensitively and ignores disabled overrides', () => {
    expect(resolveRank(snapshot({ primaryGroup: 'Administrator' }), config({ displayName: 'Boss' }))!.displayName).toBe('Boss');
    expect(resolveRank(snapshot(), config({ enabled: false, displayName: 'Boss' }))!.display.source).toBe('LUCKPERMS_PREFIX');
    expect(resolveRank(snapshot({ primaryGroup: 'moderator', prefix: null }), config())!.display.source).toBe('GROUP_NAME');
  });

  it('can keep the LuckPerms text and only restyle it', () => {
    const rank = resolveRank(snapshot(), config({ displaySource: 'LUCKPERMS_PREFIX', textColor: '#00AAFF', iconText: '★' }))!;
    expect(rank.display).toMatchObject({ source: 'LUCKPERMS_PREFIX', iconText: '★', segments: [{ text: 'ADMIN', color: '#00AAFF', bold: true }] });
    // Missing LuckPerms text falls back to the automatic order instead of showing nothing.
    expect(resolveRank(snapshot({ prefix: null }), config({ displaySource: 'LUCKPERMS_DISPLAY_NAME' }))!.display.source).toBe('GROUP_NAME');
  });

  it('exposes uploaded icons as a versioned backend URL plus fallback text', () => {
    const rank = resolveRank(snapshot(), config({ hasIcon: true, fallbackText: '[A]', tooltip: 'Server administrator' }))!;
    expect(rank.display.iconUrl).toBe(`/api/rank-icons/rd1?v=${now.getTime()}`);
    expect(rank.display).toMatchObject({ fallbackText: '[A]', tooltip: 'Server administrator' });
    expect(resolveRank(snapshot(), config())!.display.iconUrl).toBeNull();
  });

  it('validates rank display input', () => {
    expect(rankDisplaySchema.parse({ displayName: ' ADMIN ', textColor: '#aa0000' })).toMatchObject({ displayName: 'ADMIN', textColor: '#AA0000', displaySource: 'CUSTOM' });
    expect(rankDisplaySchema.safeParse({ displaySource: 'CUSTOM' }).success).toBe(false);
    expect(rankDisplaySchema.safeParse({ displayName: 'X', textColor: 'red' }).success).toBe(false);
    expect(rankDisplaySchema.safeParse({ displayName: 'X', textColor: '#fff;background:url(x)' }).success).toBe(false);
    expect(rankDisplaySchema.safeParse({ displaySource: 'LUCKPERMS_PREFIX' }).success).toBe(true);
    expect(rankDisplaySchema.safeParse({ displayName: 'X', unknown: 1 }).success).toBe(false);
  });
});

describe('rank icons', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  it('accepts raster images by content, not by name', () => {
    expect(sniffIconType(png)).toBe('image/png');
    expect(sniffIconType(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffIconType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffIconType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('rejects SVG, HTML and other content', () => {
    expect(sniffIconType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(sniffIconType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffIconType(Buffer.alloc(0))).toBeNull();
  });

  it('decodes base64 and data URLs, rejecting other input', () => {
    expect(decodeIcon(`data:image/png;base64,${png.toString('base64')}`).equals(png)).toBe(true);
    expect(decodeIcon(png.toString('base64')).equals(png)).toBe(true);
    expect(() => decodeIcon('not base64!')).toThrow();
    expect(MAX_ICON_BYTES).toBe(64 * 1024);
  });
});
