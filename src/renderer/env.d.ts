/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare global {
  interface Window {
    desktop: {
      versions: { electron: string; chrome: string; node: string };
    };
  }
}

export {};
