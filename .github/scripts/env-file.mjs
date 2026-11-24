#!/usr/bin/env node
// CI helper for .env files (single-quoted values, so special characters are literal).
//   node .github/scripts/env-file.mjs set KEY=VALUE [KEY=VALUE…]
//   node .github/scripts/env-file.mjs get KEY
import { readFileSync, writeFileSync } from 'node:fs';

const [command, ...args] = process.argv.slice(2);
let env = readFileSync('.env', 'utf8');
if (command === 'set') {
  for (const pair of args) {
    const i = pair.indexOf('=');
    const key = pair.slice(0, i);
    const value = pair.slice(i + 1);
    if (value.includes("'") || value.includes('\n')) throw new Error(`${key}: single quotes and newlines are not supported`);
    const line = `${key}='${value}'`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    env = pattern.test(env) ? env.replace(pattern, () => line) : `${env.trimEnd()}\n${line}\n`;
  }
  writeFileSync('.env', env);
} else if (command === 'get') {
  const match = new RegExp(`^${args[0]}=(.*)$`, 'm').exec(env);
  if (!match) process.exit(1);
  process.stdout.write(match[1].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'));
} else {
  console.error('Usage: env-file.mjs set KEY=VALUE… | get KEY');
  process.exit(2);
}
