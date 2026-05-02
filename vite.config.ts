import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import electron from 'vite-plugin-electron';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          resolve: {
            // deepagents 同时 import「zod」与「zod/v4」；Rollup 若不合并会出现两份 Zod 运行时，LangChain 的 schema instanceof 会报
            // "Schema must be an instance of z3.ZodObject or z4.$ZodObject"
            dedupe: ['zod'],
            alias: [
              // Electron 主进程构建使用独立的 Vite 配置；这里同样需要把 `#backend/**.js` 映射为无扩展名路径，便于解析到 .ts 源文件
              { find: /^#backend\/(.*)\.js$/, replacement: path.resolve(__dirname, './backend/$1') },
              { find: '#backend', replacement: path.resolve(__dirname, './backend') },
              { find: '@', replacement: path.resolve(__dirname, './src') },
              {
                find: /^zod\/v4$/,
                replacement: path.resolve(__dirname, 'node_modules/zod/index.js'),
              },
              {
                find: 'deepagents/node_modules/@langchain/core/messages',
                replacement: '@langchain/core/messages',
              },
            ],
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'electron-store', 'sharp'],
              output: {
                format: 'es',
                entryFileNames: 'main.js',
                // 强制整包 zod 进同一 chunk，避免「zod」与「zod/v4」等子路径被拆成两份运行时（instanceof 仍失败）
                manualChunks(id) {
                  const n = id.replace(/\\/g, '/');
                  if (n.includes('/node_modules/zod/')) return 'vendor-zod';
                  return undefined;
                },
              },
            },
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Vite/Rollup 无法用 .js 扩展名直接解析到 .ts（尤其在 alias 路径上），这里统一把 `#backend/**.js` 映射为无扩展名路径。
      { find: /^#backend\/(.*)\.js$/, replacement: path.resolve(__dirname, './backend/$1') },
      { find: '#backend', replacement: path.resolve(__dirname, './backend') },
      // 将 deepagents 内部引用的子路径映射到顶层安装，消除 commonjs-resolver 警告
      { find: 'deepagents/node_modules/@langchain/core/messages', replacement: '@langchain/core/messages' },
    ],
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
  optimizeDeps: {
    exclude: ['langchain', '@langchain/core', '@langchain/langgraph', '@langchain/openai', 'deepagents'],
  },
});