import type { NextRequest } from 'next/server';

/**
 * Same-origin proxy from the dashboard to the backend API. Keeps session
 * cookies first-party (SameSite=Strict) and lets the backend URL be configured
 * at runtime via BACKEND_INTERNAL_URL (no rebuild needed).
 */
const BACKEND = (process.env.BACKEND_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const FORWARD_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'cookie', 'user-agent', 'x-mnm-csrf', 'authorization'];
const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${BACKEND}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Only the right-most hop is meaningful: it was added by Next.js (socket
  // address) or by the reverse proxy in front of the dashboard. Anything to the
  // left is client-controlled. See docs/installation/https.md.
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor.split(',').pop()!.trim());
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  headers.set('x-forwarded-proto', proto);
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await req.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json({ statusCode: 502, code: 'BACKEND_UNREACHABLE', message: 'Backend unreachable' }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key)) responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
