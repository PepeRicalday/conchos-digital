import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://dumfyrgwnshcgeibffvr.supabase.co'

  // Safe RegExp generation for any dynamic Supabase project URL
  const escapedUrl = supabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const supabaseCacheRegex = new RegExp(`^${escapedUrl}\\/rest\\/v1\\/.*`);

  return {
    define: {
      '__APP_VERSION__': JSON.stringify(pkg.version),
      '__BUILD_HASH__': JSON.stringify('v2.4.1-structural-bypass-fix')
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',   // SW se actualiza sin prompt
        filename: 'sw-v2.4.1.js',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
        manifest: {
          name: 'SICA 005 - Conchos Digital',
          short_name: 'SICA 005',
          description: 'Sistema de Integridad y Control de Agua - Distrito 005',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: supabaseCacheRegex,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 // 24 hours
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        },
        devOptions: {
          enabled: false,   // NUNCA activar en dev
          type: 'module'
        }
      })
    ],
    server: {
      open: false
    }
  }
})
