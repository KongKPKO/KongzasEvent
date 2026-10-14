import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig({
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['nireq-mark.svg', 'apple-touch-icon.png', 'mask-icon.svg', 'robots.txt', 'sitemap.xml'],
      manifest: {
        name: 'Nireq',
        short_name: 'Nireq',
        description: 'Creator booth queues, orders, payment evidence, and pickup.',
        theme_color: '#be185d',
        background_color: '#fffafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      devOptions: {
        enabled: false // Disable PWA in development to prevent caching issues
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,webp,wasm}'],
        // Upload conversion and optional replay are not needed to reopen offline sales.
        globIgnores: ['**/heic2any-*.js', '**/webp_enc*', '**/logrocket-*.js'],
        // Only the prepared offline workspace uses the precached app shell.
        navigateFallbackAllowlist: [/^\/offline(?:\?|$)/],
        directoryIndex: '',
        // Don't cache API calls or Firestore
        navigateFallbackDenylist: [/^\/admin/, /^\/api/, /^https:\/\/firestore\.googleapis\.com/],
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === 'navigate' && !url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nireq-pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 30 },
              cacheableResponse: { statuses: [200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    // heic2any is loaded only on HEIC uploads in the admin catalog flow.
    // Keep the warning above that lazy tool chunk while still catching larger bundles.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react-router-dom/')) {
            return 'vendor-react'
          }
          if (id.includes('/node_modules/@supabase/supabase-js/')) {
            return 'vendor-supabase'
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'vendor-ui'
          }
          return undefined
        }
      }
    }
  }
})
