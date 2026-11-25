import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ReleaseNotes } from '../components/release-notes';
import { compareVersions, componentState } from './semver';

describe('dashboard version comparison', () => {
  it('uses semantic version precedence', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.0-rc.1', '1.2.0')).toBe(-1);
    expect(compareVersions('1.2.0-rc.10', '1.2.0-rc.9')).toBe(1);
    expect(componentState('1.1.0', '1.2.0')).toBe('outdated');
    expect(componentState('1.2.0', '1.2.0')).toBe('current');
    expect(componentState('1.3.0', '1.2.0')).toBe('newer');
    expect(componentState('', '1.2.0')).toBe('unknown');
    expect(componentState('1.2.0', undefined)).toBe('unknown');
  });
});

describe('release notes rendering', () => {
  const render = (markdown: string) => renderToStaticMarkup(createElement(ReleaseNotes, { markdown }));

  it('renders basic Markdown', () => {
    const html = render('## Added\n- **Edit** punishments with `/editban`\n- See [docs](https://github.com/epicclowds/Nexora)');
    expect(html).toContain('<strong>Edit</strong>');
    expect(html).toContain('<code');
    expect(html).toContain('href="https://github.com/epicclowds/Nexora"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('never interprets HTML and only links https URLs', () => {
    const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[click](javascript:alert(1)) [data](data:text/html,x) [http](http://example.com)\n<!-- nexora-compatibility {"minPluginVersion":"1.2.0"} -->');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript');
    expect(html).not.toContain('href="data');
    expect(html).not.toContain('href="http://');
    expect(html).not.toContain('nexora-compatibility');
  });
});
