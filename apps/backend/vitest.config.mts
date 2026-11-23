import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is used so decorator metadata is emitted like in the real build.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    environment: 'node',
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
