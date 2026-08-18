/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import electronRenderer from 'vite-plugin-electron-renderer';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// 修复：某些 CI/自动化终端会注入 ELECTRON_RUN_AS_NODE=1，
// 这会导致 vite-plugin-electron spawn 出的 Electron 以纯 Node 模式运行，
// 进而使 `require("electron")` 返回路径字符串而非 API 对象，主进程启动即崩溃。
// 在配置加载阶段主动删除该变量，确保 Electron 子进程以 GUI 模式启动。
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
}

// ESM 中不存在 __dirname，需要用 import.meta.url 来模拟
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，构建时注入到前端
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), electron({
    main: {
      // Shortcut of `build.lib.entry`.
      entry: 'electron/main.ts',
      vite: {
        build: {
          // 强制输出 CommonJS，保证 better-sqlite3 等 native 模块能正常加载
          // 依赖 vite-plugin-electron/simple 基于 package.json 无 "type":"module" 时的默认 CJS 输出。
          rollupOptions: {
            external: ['better-sqlite3', '@lancedb/lancedb'],
            output: {
              format: 'cjs'
            }
          }
        }
      }
    },
    preload: {
      // Shortcut of `build.rollupOptions.input`.
      // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
      input: path.join(__dirname, 'electron/preload.ts')
    }
  }), process.env.NODE_ENV !== 'test' && electronRenderer()],
  server: {
    watch: {
      ignored: ['**/docs/**']
    }
  },
  define: {
    // 构建时将 package.json 版本注入为全局常量，避免 StatusBar 硬编码版本号
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  optimizeDeps: {
    entries: ['index.html', 'src/**/*.{ts,tsx}']
  },
  build: {
    rollupOptions: {
      output: {
        // 手动分包：把大体积依赖拆成独立 chunk，减少首屏单包体积与解析时间。
        // 注意匹配顺序：先精确匹配 monaco/codemirror/radix，最后才用宽松的 react 匹配，
        // 避免 @monaco-editor/react 等被误归入 react-vendor。
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) return 'monaco';
          if (
            id.includes('@codemirror') ||
            id.includes('@uiw/react-codemirror') ||
            id.includes('@lezer')
          ) return 'codemirror';
          if (id.includes('@radix-ui')) return 'radix-ui';
          if (
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('/react-markdown/') ||
            id.includes('/react-resizable-panels/') ||
            id.includes('/zustand/') ||
            id.includes('/remark-gfm/') ||
            id.includes('/rehype-raw/')
          ) return 'react-vendor';

          return undefined;
        },
      },
      onwarn(warning, defaultHandler) {
        // 过滤掉已知的无害警告
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return;
        if (warning.message?.includes('Invalid key')) return;
        defaultHandler(warning);
      },
    },
  },
});
