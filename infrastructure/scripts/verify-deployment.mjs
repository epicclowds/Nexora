#!/usr/bin/env node
// Verifies a running deployment end to end through the dashboard (which also
// proxies the API), exactly like a browser and a Minecraft plugin would.
//
//   node infrastructure/scripts/verify-deployment.mjs <dashboard-url> [mode] [options]
//
// Modes:
//   setup    – fresh installation: run the setup wizard API with SETUP_TOKEN,
//              register a Velocity and a Paper server, send signed plugin
//              traffic, seed players and verify the dashboard sees it all.
//   load     – performance check against an initialised installation
//              (needs the state file written by "setup"): concurrent plugin
//              traffic and dashboard reads with latency thresholds.
//   check    – read-only check after an update or restore: login works and
//              the data written by "setup" is still there.
//
// Options (environment): SETUP_TOKEN, VERIFY_STATE (default .verify-state.json),
// VERIFY_PLAYERS (default 2000), LOAD_SECONDS (default 60),
// LOAD_P95_MS (default 500).
//
// Uses only Node.js 22 built-ins. Never run "setup" against a production
// installation: it creates an owner account and test data.
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [base = 'http://localhost:3000', mode = 'setup'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = base.replace(/\/$/, '');
const STATE_FILE = process.env.VERIFY_STATE ?? '.verify-state.json';
const OWNER = { username: 'verify-owner', email: 'verify-owner@example.test', password: `Verify-${randomBytes(12).toString('hex')}` };
const PLAYERS = Number(process.env.VERIFY_PLAYERS ?? 2000);

let failures = 0;
const step = (name) => console.log(`\n▶ ${name}`);
function check(condition, message, detail) {
  if (condition) console.log(`  ✔ ${message}`);
  else {
    failures++;
    console.error(`  ✖ ${message}${detail === undefined ? '' : `\n    ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 500)}`}`);
  }
  return condition;
}
function fatal(message, detail) {
  check(false, message, detail);
  process.exit(1);
}

// ── HTTP helpers ─────────────────────────────────────────────────

const jar = new Map();
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-mnm-csrf': '1', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const index = pair.indexOf('=');
    const value = pair.slice(index + 1);
    if (value) jar.set(pair.slice(0, index), value);
    else jar.delete(pair.slice(0, index));
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
/** Same contract as apps/backend/src/plugin-api/plugin-signature.ts. */
async function signed(creds, method, path, body) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = randomBytes(16).toString('hex');
  const canonical = [method, path, timestamp, nonce, sha256(raw)].join('\n');
  const signature = createHmac('sha256', Buffer.from(sha256(creds.secret), 'hex')).update(canonical).digest('hex');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-mnm-key-id': creds.keyId, 'x-mnm-timestamp': timestamp, 'x-mnm-nonce': nonce, 'x-mnm-signature': signature },
    body: raw || undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function waitReady() {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const res = await call('GET', '/api/health/ready');
      if (res.status === 200) return res.body;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  fatal('backend became ready through the dashboard within 3 minutes');
}

const uuidFor = (i) => {
  const hex = sha256(`verify-player-${i}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const nameFor = (i) => `Verify${String(i).padStart(5, '0')}`;

// ── Modes ────────────────────────────────────────────────────────

async function setup() {
  const token = process.env.SETUP_TOKEN;
  if (!token) fatal('SETUP_TOKEN is set (needed to initialise the installation)');

  step('Health and setup status');
  const ready = await waitReady();
  check(ready?.status === 'ok', `backend ready (v${ready?.version})`, ready);
  const status = await call('GET', '/api/setup/status');
  check(status.body?.initialized === false, 'installation not yet initialised', status.body);
  check(status.body?.database?.connected && status.body?.database?.pendingMigrations === false, 'database connected, all migrations applied', status.body?.database);
  check(status.body?.redis?.connected === true, 'Redis connected');

  step('Security headers');
  const page = await fetch(`${BASE}/login`);
  check(page.status === 200, 'login page served');
  check((page.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"), 'dashboard sends a Content-Security-Policy');
  check(page.headers.get('x-content-type-options') === 'nosniff', 'nosniff header present');
  check(!page.headers.get('x-powered-by'), 'no X-Powered-By header');

  step('Setup wizard');
  const wrong = await call('POST', '/api/setup/initialize', { setupCode: 'WRONG-CODE-0000000000', owner: OWNER, network: { name: 'Verify Network' } });
  check(wrong.status === 403, 'wrong setup code rejected', wrong.body);
  const init = await call('POST', '/api/setup/initialize', { setupCode: token, owner: OWNER, network: { name: 'Verify Network', defaultTimezone: 'UTC' } });
  check(init.status === 201, 'installation initialised', init.body);
  const again = await call('POST', '/api/setup/initialize', { setupCode: token, owner: OWNER, network: { name: 'Again' } });
  check(again.status === 409, 'setup cannot run twice');

  step('Dashboard login');
  jar.clear();
  const login = await call('POST', '/api/auth/login', { identifier: OWNER.username, password: OWNER.password });
  check(login.status === 200 && jar.has('mnm_access'), 'owner can sign in', login.body);
  check((await call('GET', '/api/auth/me')).body?.permissions?.includes('*'), 'owner has all permissions');
  jar.clear();
  check((await call('GET', '/api/auth/me')).status === 401, 'API rejects requests without a session');
  await call('POST', '/api/auth/login', { identifier: OWNER.username, password: OWNER.password });

  step('Server registration');
  const servers = {};
  for (const [type, name] of [['VELOCITY', 'proxy'], ['PAPER', 'lobby']]) {
    const created = await call('POST', '/api/servers/registration-tokens', { type, name });
    if (!check(created.status === 201, `registration token for ${name}`, created.body)) continue;
    const reg = await call('POST', '/api/plugin/v1/register', { token: created.body.token, pluginVersion: 'verify', platformVersion: type });
    check(reg.status === 201, `${name} registered`, reg.body);
    check((await call('POST', '/api/plugin/v1/register', { token: created.body.token, pluginVersion: 'verify' })).status === 401, `${name} token is single-use`);
    const progress = await call('GET', `/api/servers/registration-tokens/${created.body.id}`);
    check(progress.body?.status === 'REGISTERED', `${name} registration visible in the dashboard`);
    servers[name] = { keyId: reg.body.keyId, secret: reg.body.secret };
  }
  const proxy = servers.proxy;
  const paper = servers.lobby;
  if (!proxy || !paper) fatal('both servers registered');

  step('Signed plugin traffic');
  const ping = await signed(proxy, 'GET', '/api/plugin/v1/ping');
  check(ping.status === 200 && ping.body.serverName === 'proxy', 'signed ping accepted', ping.body);
  const forged = await fetch(`${BASE}/api/plugin/v1/ping`, { headers: { 'x-mnm-key-id': proxy.keyId, 'x-mnm-timestamp': String(Date.now()), 'x-mnm-nonce': randomBytes(16).toString('hex'), 'x-mnm-signature': '0'.repeat(64) } });
  check(forged.status === 401, 'forged signature rejected');
  for (const creds of [proxy, paper]) {
    const hb = await signed(creds, 'POST', '/api/plugin/v1/heartbeat', { pluginVersion: 'verify', onlinePlayers: 0, maxPlayers: 500, tps: 20, mspt: 5 });
    check(hb.status === 200 && typeof hb.body.configRevision === 'number', 'heartbeat accepted with config revision', hb.body);
  }
  const config = await signed(paper, 'GET', '/api/plugin/v1/config');
  check(config.status === 200 && config.body.revision === 0, 'managed plugin settings served');

  step(`Seeding ${PLAYERS} players (joins, switches, leaves)`);
  const started = Date.now();
  const online = Math.min(100, PLAYERS);
  for (let i = 0; i < PLAYERS; i += 60) {
    const events = [];
    for (let j = i; j < Math.min(PLAYERS, i + 60); j++) {
      const sessionKey = randomUUID();
      const at = Date.now() - 3_600_000 + j;
      events.push(
        { type: 'player.join', sessionKey, uuid: uuidFor(j), username: nameFor(j), at, ip: `198.51.100.${j % 250}`, protocol: 775, clientVersion: '26.3' },
        { type: 'player.switch', sessionKey, uuid: uuidFor(j), server: 'lobby', at: at + 1000 },
      );
      if (j >= online) events.push({ type: 'player.leave', sessionKey, uuid: uuidFor(j), at: at + 1_800_000 });
    }
    const res = await signed(proxy, 'POST', '/api/plugin/v1/events', { events });
    if (!check(res.status === 200 || res.status === 201, `event batch ${i / 60 + 1}`, res.body)) break;
  }
  console.log(`  ⏱ seeded in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const summary = await call('GET', '/api/dashboard/summary');
  check(summary.body?.onlinePlayers === online, `dashboard shows ${online} online players`, summary.body);
  const search = await call('GET', `/api/players?search=${nameFor(42)}`);
  check(search.body?.items?.[0]?.uuid === uuidFor(42), 'player search finds a seeded player');

  step('Audit trail');
  const audit = await call('GET', '/api/audit-logs?action=servers.');
  check((audit.body?.items ?? []).some((e) => e.action === 'servers.registered'), 'registrations are audit-logged');

  writeFileSync(STATE_FILE, JSON.stringify({ owner: OWNER, servers, players: PLAYERS, online }, null, 2));
  console.log(`\nState written to ${STATE_FILE} (contains test credentials; delete after use).`);
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return fatal(`state file ${STATE_FILE} from a previous "setup" run exists`);
  }
}

async function signIn(state) {
  await waitReady();
  const login = await call('POST', '/api/auth/login', { identifier: state.owner.username, password: state.owner.password });
  check(login.status === 200, 'owner can sign in', login.body);
}

async function checkData() {
  const state = loadState();
  step('Data after update/restore');
  await signIn(state);
  const servers = await call('GET', '/api/servers');
  check(servers.body?.length >= 2, 'registered servers still present', servers.body);
  const players = await call('GET', '/api/players?pageSize=1');
  check(players.body?.total === state.players, `all ${state.players} players still present`, players.body?.total);
  const ping = await signed(state.servers.proxy, 'GET', '/api/plugin/v1/ping');
  check(ping.status === 200, 'plugin credentials still valid');
  const status = await call('GET', '/api/setup/status');
  check(status.body?.initialized === true && status.body?.database?.pendingMigrations === false, 'installation initialised, migrations up to date');
}

function percentile(sorted, p) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
}

async function load() {
  const state = loadState();
  await signIn(state);
  const seconds = Number(process.env.LOAD_SECONDS ?? 60);
  const p95Limit = Number(process.env.LOAD_P95_MS ?? 500);
  // Stays below the per-IP rate limits (1200/min plugin API, 300/min dashboard API):
  // all traffic originates from this one machine.
  const plan = [
    { name: 'plugin heartbeat', rps: 6, run: () => signed(state.servers.lobby, 'POST', '/api/plugin/v1/heartbeat', { pluginVersion: 'verify', onlinePlayers: state.online, tps: 19.9, mspt: 8 }) },
    { name: 'plugin events', rps: 6, run: () => {
      const sessionKey = randomUUID();
      const i = Math.floor(Math.random() * state.players);
      return signed(state.servers.proxy, 'POST', '/api/plugin/v1/events', { events: [
        { type: 'player.join', sessionKey, uuid: uuidFor(i), username: nameFor(i), at: Date.now(), protocol: 775 },
        { type: 'player.switch', sessionKey, uuid: uuidFor(i), server: 'lobby', at: Date.now() + 1 },
        { type: 'player.leave', sessionKey, uuid: uuidFor(i), at: Date.now() + 2 },
      ] });
    } },
    { name: 'punishment feed', rps: 3, run: () => signed(state.servers.lobby, 'GET', '/api/plugin/v1/punishments/changes?after=0') },
    { name: 'player search', rps: 1.5, run: () => call('GET', `/api/players?search=Verify0${Math.floor(Math.random() * 99)}`) },
    { name: 'player profile', rps: 1, run: () => call('GET', `/api/players/${uuidFor(Math.floor(Math.random() * state.players))}`) },
    { name: 'dashboard summary', rps: 1, run: () => call('GET', '/api/dashboard/summary') },
  ];
  step(`Load: ${plan.reduce((s, p) => s + p.rps, 0)} requests/s for ${seconds} s`);
  const results = new Map(plan.map((p) => [p.name, { latencies: [], errors: 0 }]));
  const end = Date.now() + seconds * 1000;
  await Promise.all(
    plan.map(async (p) => {
      const interval = 1000 / p.rps;
      const inflight = [];
      while (Date.now() < end) {
        const t0 = performance.now();
        inflight.push(
          p.run().then(
            (res) => {
              const r = results.get(p.name);
              r.latencies.push(performance.now() - t0);
              if (res.status >= 400) r.errors++;
            },
            () => results.get(p.name).errors++,
          ),
        );
        await new Promise((r) => setTimeout(r, interval));
      }
      await Promise.all(inflight);
    }),
  );
  console.log('\n  endpoint              requests  errors   p50     p95     p99   (ms)');
  const summary = ['| Endpoint | Requests | Errors | p50 (ms) | p95 (ms) | p99 (ms) |', '| --- | ---: | ---: | ---: | ---: | ---: |'];
  for (const [name, r] of results) {
    const sorted = [...r.latencies].sort((a, b) => a - b);
    const [p50, p95, p99] = [50, 95, 99].map((p) => percentile(sorted, p).toFixed(0));
    console.log(`  ${name.padEnd(20)} ${String(sorted.length).padStart(8)} ${String(r.errors).padStart(7)} ${p50.padStart(6)}  ${p95.padStart(6)}  ${p99.padStart(6)}`);
    summary.push(`| ${name} | ${sorted.length} | ${r.errors} | ${p50} | ${p95} | ${p99} |`);
    // CI: results as annotations (readable without access to the logs) and a job summary.
    if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Load test – ${name}::requests=${sorted.length} errors=${r.errors} p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
    check(r.errors === 0, `${name}: no errors`);
    check(percentile(sorted, 95) <= p95Limit, `${name}: p95 ≤ ${p95Limit} ms`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Load test (${seconds} s, ${state.players} seeded players)\n\n${summary.join('\n')}\n`);
  }
}

const modes = { setup, load, check: checkData };
if (!modes[mode]) fatal(`unknown mode "${mode}" (setup | load | check)`);
await modes[mode]();
console.log(failures === 0 ? '\n✅ Deployment verified.' : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
