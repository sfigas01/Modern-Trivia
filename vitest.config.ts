import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server/**/*.ts', 'client/src/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.test.tsx'],
    },
    projects: [
      {
        test: {
          name: 'server-and-shared',
          environment: 'node',
          include: ['server/**/*.test.ts', 'shared/**/*.test.ts'],
        },
        resolve: {
          alias: {
            '@shared': path.resolve(import.meta.dirname, 'shared'),
          },
        },
      },
      {
        plugins: [react()],
        // Match vite.config.ts: skip the legacy root postcss.config.js so
        // components that import CSS (e.g. the pixel UI) load in tests.
        css: {
          postcss: {
            plugins: [],
          },
        },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['client/src/**/*.test.{ts,tsx}'],
        },
        resolve: {
          alias: {
            '@': path.resolve(import.meta.dirname, 'client', 'src'),
            '@shared': path.resolve(import.meta.dirname, 'shared'),
          },
        },
      },
    ],
  },
});
