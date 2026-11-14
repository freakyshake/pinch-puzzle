/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * The game script (index.ts -> app.js) and two chunks it pulls in at run time
 * (the world initializer and the font data) are loaded one after another:
 * each is only discovered after the previous one has been parsed. Listing
 * them in index.html as module preloads lets the browser fetch all of them
 * at once from the first byte, which shortens the load by the waterfall.
 * Build only; the dev server serves unbundled modules.
 */
function preloadGameChunks(): Plugin {
  const wanted = /^assets\/(app|world-initializer|inter)-[\w-]+\.js$/;
  return {
    name: 'preload-game-chunks',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {}).filter((name) => wanted.test(name));
        return names.map((name) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: '', href: `./${name}` },
          injectTo: 'head',
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), preloadGameChunks()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
