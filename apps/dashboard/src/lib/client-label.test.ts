import messages from '@mnm/translations/locales/en-US.json';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClientLabel } from '@/components/client-label';
import type { ClientInfo } from './api';

const render = (client: ClientInfo | null, details = true) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: 'en-US', messages, timeZone: 'UTC', children: createElement(ClientLabel, { client, details }) }));

describe('connection history client display', () => {
  it('names a detected client with its raw brand and source', () => {
    const html = render({ name: 'norisk', status: 'DETECTED', source: 'BRAND', detectedAt: '2026-11-25T10:00:00Z', brand: 'NoRisk Client' });
    expect(html).toContain('NoRisk Client');
    expect(html).toContain('Reported brand');
    expect(html).toContain('Detected from the reported brand');
  });

  it('shows Unknown when nothing was reported – never a guess', () => {
    const html = render({ name: null, status: 'NONE', source: null, detectedAt: null });
    expect(html).toContain('Unknown');
    expect(html).not.toContain('Vanilla');
    expect(render(null)).toContain('Unknown');
  });

  it('keeps an unrecognised brand visible for staff, but as Unknown', () => {
    const html = render({ name: null, status: 'UNRECOGNIZED', source: 'BRAND', detectedAt: null, brand: 'my-launcher' });
    expect(html).toContain('Unknown');
    expect(html).toContain('my-launcher');
  });

  it('hides the raw brand when the viewer may not see it', () => {
    const html = render({ name: 'fabric', status: 'DETECTED', source: 'BRAND', detectedAt: null });
    expect(html).toContain('Fabric');
    expect(html).not.toContain('Reported brand');
  });

  it('labels integration results and escapes brands', () => {
    expect(render({ name: 'norisk', status: 'DETECTED', source: 'INTEGRATION', detectedAt: null })).toContain('Confirmed by the client integration');
    expect(render({ name: null, status: 'UNRECOGNIZED', source: 'BRAND', detectedAt: null, brand: '<script>x</script>' })).toContain('&lt;script&gt;');
  });
});
