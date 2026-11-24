#!/usr/bin/env node
// Reads a published image from GitHub Container Registry anonymously – exactly
// as a public user would – and prints its digest, platforms and source revision.
//
//   node infrastructure/scripts/image-info.mjs ghcr.io/epicclowds/nexora/backend 1.0.1
//
// Output (JSON): {"exists":true,"digest":"sha256:…","platforms":["linux/amd64",…],"revision":"<git sha>","version":"1.0.1"}
// or {"exists":false}. Exits 1 when the registry refuses anonymous access
// (private package) or answers with an unexpected error.
const [ref, tag] = process.argv.slice(2);
const match = /^ghcr\.io\/(.+)$/.exec(ref ?? '');
if (!match || !tag) {
  console.error('Usage: image-info.mjs ghcr.io/<owner>/<name> <tag>');
  process.exit(2);
}
const name = match[1];
const INDEX_TYPES = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'];
const MANIFEST_TYPES = ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];

const tokenRes = await fetch(`https://ghcr.io/token?scope=repository:${name}:pull&service=ghcr.io`);
if (!tokenRes.ok) {
  console.error(`Anonymous token request failed (${tokenRes.status}): the package may be private.`);
  process.exit(1);
}
const { token } = await tokenRes.json();
const get = (path, accept) => fetch(`https://ghcr.io/v2/${name}/${path}`, { headers: { authorization: `Bearer ${token}`, accept: accept.join(', ') } });

const top = await get(`manifests/${tag}`, [...INDEX_TYPES, ...MANIFEST_TYPES]);
if (top.status === 404) {
  console.log(JSON.stringify({ exists: false }));
  process.exit(0);
}
if (!top.ok) {
  console.error(`Registry answered ${top.status} for ${ref}:${tag}${top.status === 401 || top.status === 403 ? ' – anonymous pulls are not allowed (private package)' : ''}`);
  process.exit(1);
}
const digest = top.headers.get('docker-content-digest');
const body = await top.json();
let manifest = body;
let platforms = [];
if (INDEX_TYPES.includes(body.mediaType) || body.manifests) {
  const images = body.manifests.filter((m) => m.platform && m.platform.os !== 'unknown');
  platforms = images.map((m) => `${m.platform.os}/${m.platform.architecture}`);
  const amd64 = images.find((m) => m.platform.architecture === 'amd64') ?? images[0];
  manifest = await (await get(`manifests/${amd64.digest}`, MANIFEST_TYPES)).json();
}
const config = await (await get(`blobs/${manifest.config.digest}`, ['application/json'])).json();
const labels = config.config?.Labels ?? {};
console.log(
  JSON.stringify({
    exists: true,
    digest,
    platforms,
    revision: labels['org.opencontainers.image.revision'] ?? null,
    version: labels['org.opencontainers.image.version'] ?? null,
    user: config.config?.User ?? '',
  }),
);
