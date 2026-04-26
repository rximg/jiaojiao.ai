import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // vitest 使用 Vite 的解析器：把 `#backend/**.js` 映射为无扩展名路径，便于解析到 .ts 源文件
      { find: /^#backend\/(.*)\.js$/, replacement: path.resolve(__dirname, 'backend/$1') },
      { find: '#backend', replacement: path.resolve(__dirname, 'backend') },
    ],
  },
  test: {
    watch: false,
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup/env.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/worktrees/**'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    poolOptions: {
      threads: {
        isolate: true,
      },
    },
  },
});
