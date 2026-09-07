import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { host: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Talking Face',
        short_name: 'Talking Face',
        description: 'Make your own photo talk.',
        theme_color: '#0e1116',
        background_color: '#0e1116',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only. The landmark assets are deliberately NOT
        // precached: the three WASM variants are ~11MB each and only one is ever
        // loaded (SIMD vs no-SIMD is decided at runtime), so precaching them
        // would cost ~33MB of install-time download to use a third of it. They
        // are cached on first use instead, which is the moment the user starts
        // the capture flow, and an avatar that has been built keeps working
        // offline thereafter.
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        globIgnores: ['**/models/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'face-models',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
