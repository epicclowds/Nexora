import { parseMinecraftText } from '@mnm/shared-types';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RankLabel } from '@/components/rank-badge';
import { emptyDraft, previewDisplay } from '@/components/rank-display-settings';
import { BADGE_DARK, BADGE_LIGHT, badgeColors, contrastRatio, hasPrivateUseGlyph, MIN_CONTRAST, type RankDisplay, rankDisplayOf, rankIcon, safeColor, segmentStyle } from './rank';

function display(over: Partial<RankDisplay> = {}): RankDisplay {
  return { source: 'LUCKPERMS_PREFIX', segments: parseMinecraftText('&4&lADMIN &4'), textColor: null, backgroundColor: null, bold: false, iconText: null, iconUrl: null, fallbackText: null, tooltip: null, ...over };
}
const render = (d: RankDisplay) => renderToStaticMarkup(createElement(RankLabel, { display: d, title: d.tooltip ?? undefined }));

describe('rank rendering', () => {
  it('renders "&4&lADMIN &4" as bold dark-red ADMIN without formatting codes', () => {
    const html = render(display());
    expect(html).toContain('>ADMIN</span>');
    expect(html).not.toContain('&amp;4');
    expect(html).not.toContain('&amp;l');
    expect(html).toContain('color:#AA0000');
    expect(html).toContain('font-weight:700');
  });

  it('escapes everything: LuckPerms text and tooltips can never inject markup', () => {
    const html = render(display({ segments: parseMinecraftText('<img src=x onerror=alert(1)>&c<b>x</b>'), tooltip: '"><script>alert(1)</script>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('title="&quot;&gt;&lt;script&gt;');
  });

  it('only accepts validated hex colours in styles', () => {
    expect(safeColor('#aa0000')).toBe('#AA0000');
    expect(safeColor('red')).toBeNull();
    expect(safeColor('#fff;background:url(javascript:alert(1))')).toBeNull();
    const evil = { text: 'x', color: 'red;background:url(x)', bold: false, italic: true, underlined: true, strikethrough: true, obfuscated: false };
    expect(segmentStyle(evil)).toEqual({ color: undefined, fontWeight: undefined, fontStyle: 'italic', textDecorationLine: 'underline line-through' });
    expect(render(display({ textColor: 'red;x', backgroundColor: 'url(x)' }))).not.toContain('url(');
  });

  it('shows uploaded icons from the backend only, falling back to text', () => {
    expect(rankIcon({ iconUrl: '/api/rank-icons/abc?v=1', iconText: '★', fallbackText: '[A]' }, false)).toEqual({ kind: 'image', url: '/api/rank-icons/abc?v=1' });
    // Missing asset (failed to load) → icon text.
    expect(rankIcon({ iconUrl: '/api/rank-icons/abc?v=1', iconText: '★', fallbackText: '[A]' }, true)).toEqual({ kind: 'text', text: '★' });
    // Foreign URLs are never loaded.
    expect(rankIcon({ iconUrl: 'https://evil.example/x.png', iconText: null, fallbackText: '[A]' }, false)).toEqual({ kind: 'text', text: '[A]' });
    expect(rankIcon({ iconUrl: null, iconText: null, fallbackText: null }, false)).toBeNull();
    expect(render(display({ iconUrl: '/api/rank-icons/abc?v=1' }))).toContain('src="/api/rank-icons/abc?v=1"');
  });

  it('replaces resource-pack glyphs (private use characters) with the fallback text', () => {
    expect(hasPrivateUseGlyph('')).toBe(true);
    expect(hasPrivateUseGlyph('★')).toBe(false);
    expect(rankIcon({ iconUrl: null, iconText: '', fallbackText: '[ADMIN]' }, false)).toEqual({ kind: 'text', text: '[ADMIN]' });
    expect(rankIcon({ iconUrl: null, iconText: '', fallbackText: null }, false)).toBeNull();
  });

  it('keeps ranks readable in light and dark themes', () => {
    for (const color of ['#AA0000', '#FFFF55', '#FFFFFF', '#000000', '#55FF55', '#0000AA', '#AAAAAA']) {
      const colors = badgeColors({ segments: [], textColor: color, backgroundColor: null });
      expect([BADGE_DARK, BADGE_LIGHT]).toContain(colors.background);
      expect(colors.contrast).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    expect(badgeColors({ segments: [], textColor: '#FFFF55', backgroundColor: null }).background).toBe(BADGE_DARK);
    expect(badgeColors({ segments: [], textColor: '#0000AA', backgroundColor: null }).background).toBe(BADGE_LIGHT);
    // A configured background is respected; its contrast is reported for the editor's warning.
    expect(badgeColors({ segments: [], textColor: '#AA0000', backgroundColor: '#2A1010' }).contrast).toBeLessThan(MIN_CONTRAST);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
  });

  it('supports responses from older backends (plain name and colour)', () => {
    const d = rankDisplayOf({ primaryGroup: 'mod', displayName: '[Mod]', prefix: '[Mod]', color: '#FF5555', groups: ['mod'], source: 'LUCKPERMS', synchronizedAt: '2026-11-25T00:00:00Z' })!;
    expect(d.segments[0]).toMatchObject({ text: '[Mod]', color: '#FF5555' });
    expect(rankDisplayOf({ primaryGroup: null, displayName: null, prefix: null, color: null, groups: [], source: 'LUCKPERMS', synchronizedAt: '' })).toBeNull();
  });
});

describe('rank display live preview', () => {
  it('previews a custom override with the configured colours', () => {
    const draft = { ...emptyDraft('administrator'), displayName: 'ADMIN', textColor: '#AA0000', backgroundColor: '#2A1010', bold: true };
    const preview = previewDisplay(draft, { prefix: '&4&lADMIN &4', groupDisplay: null }, null)!;
    expect(preview).toMatchObject({ source: 'CUSTOM', backgroundColor: '#2A1010', bold: true, segments: [{ text: 'ADMIN', color: '#AA0000' }] });
    const html = render(preview);
    expect(html).toContain('background-color:#2A1010');
    expect(html).toContain('font-weight:700');
  });

  it('previews the real LuckPerms prefix of the group', () => {
    const preview = previewDisplay({ ...emptyDraft('vip'), displaySource: 'LUCKPERMS_PREFIX' }, { prefix: '<gold><b>VIP</b>+', groupDisplay: null }, null)!;
    expect(preview.segments).toEqual([
      { text: 'VIP', color: '#FFAA00', bold: true, italic: false, underlined: false, strikethrough: false, obfuscated: false },
      { text: '+', color: '#FFAA00', bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false },
    ]);
  });

  it('falls back to the group name when no player of the group was synchronised', () => {
    expect(previewDisplay({ ...emptyDraft('senior_mod'), displaySource: 'LUCKPERMS_PREFIX' }, undefined, null)!.segments[0].text).toBe('Senior Mod');
  });

  it('ignores invalid colours while typing', () => {
    const preview = previewDisplay({ ...emptyDraft('admin'), textColor: '#AA00', backgroundColor: 'nope' }, undefined, null)!;
    expect(preview.textColor).toBeNull();
    expect(preview.backgroundColor).toBeNull();
  });
});
