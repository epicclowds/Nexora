import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from './env';

/** Injectable, typed access to validated configuration. */
export class AppConfig {
  readonly version: string;

  constructor(readonly env: Env) {
    this.version = readVersion();
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}

function readVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    // dist/config/app-config.js -> ../../package.json
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
