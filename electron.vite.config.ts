import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';

/**
 * electron-vite 三段配置：
 * - main：Electron 主进程，打包为 ESM（package.json 为 type=module，Electron 28+ 支持 ESM 主进程）
 * - preload：必须为 CJS，沙箱化 preload 不支持 ESM，因此输出 .cjs
 * - renderer：Vue 3 渲染层。生产环境下页面由内嵌的 server.mjs 提供（同源 HTTP），
 *   而不是 loadFile，因此 dev 阶段需要通过 Vite 代理转发 /api 请求（见 server.proxy）。
 */
const root = import.meta.dirname;
/**
 * 开发期后端端口：必须是固定值，Vite 代理才能在启动时就指向它。
 * 主进程在未打包时也使用同一端口（见 src/main/backend.ts），可用 QDII_DEV_BACKEND_PORT 覆盖。
 */
const devBackendPort = Number(process.env.QDII_DEV_BACKEND_PORT ?? 8787);
const devBackendOrigin = `http://127.0.0.1:${devBackendPort}`;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(root, 'src/main/index.ts'),
        formats: ['es'],
      },
      rollupOptions: {
        output: { entryFileNames: 'index.js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(root, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
      rollupOptions: {
        output: { entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer'),
        '@shared': resolve(root, 'src/shared'),
      },
    },
    plugins: [
      vue(),
      {
        // 开发期由 Vite 直接返回页面，没有后端那条 CSP 响应头，Electron 会报警告。
        // 这里仅对 dev server 注入一条等价的 CSP；打包后仍以后端响应头为准。
        name: 'dev-csp',
        apply: 'serve',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content:
                  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data: blob:; font-src 'self' data:",
              },
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    ],
    server: {
      port: 5273,
      strictPort: true,
      proxy: {
        // 两处校验都要处理：server.mjs 的 Host 白名单（需 changeOrigin）
        // 与 Origin 白名单（需改写 Origin 头），否则 POST/PUT 会被判为跨站。
        '/api': {
          target: devBackendOrigin,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('origin', devBackendOrigin);
            });
          },
        },
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      emptyOutDir: true,
      assetsDir: 'assets',
    },
    css: {
      preprocessorOptions: {
        scss: {
          loadPaths: [resolve(root, 'src/renderer/styles')],
          // 变量表统一注入，组件内不必重复 @use；variables.scss 自身跳过避免自引用。
          additionalData: (content: string, filePath: string) =>
            /variables\.scss$/.test(filePath) ? content : `@use "variables" as *;\n${content}`,
        },
      },
    },
  },
});
