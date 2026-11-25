import type { ComponentState } from './api';

/**
 * Semantic version precedence (same rules as the backend): numeric parts are
 * compared as numbers (1.10.0 > 1.9.0) and pre-releases sort before releases.
 */
const PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(value: string | null | undefined) {
  const m = PATTERN.exec(value?.trim() ?? '');
  return m ? { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] } : null;
}

export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return Math.sign(pa.core[i] - pb.core[i]);
  if (!pa.pre.length || !pb.pre.length) return Math.sign(pb.pre.length - pa.pre.length);
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y)) return Math.sign(Number(x) - Number(y));
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Installed version against the latest release; "unknown" when either cannot be parsed. */
export function componentState(installed: string | null | undefined, latest: string | null | undefined): ComponentState {
  const c = compareVersions(installed, latest);
  return c === null ? 'unknown' : c < 0 ? 'outdated' : c > 0 ? 'newer' : 'current';
}
