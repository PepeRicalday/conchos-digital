import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// Fuente única de la versión: package.json. Antes estaba escrita a mano aquí,
// en el nombre del SW y en el <title> de index.html; los tres se desincronizaban
// (producción mostró "v2.8.4" durante cinco versiones).
const APP_VERSION = pkg.version

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL || 'https://dumfyrgwnshcgeibffvr.supabase.co'

  // Safe RegExp generation for any dynamic Supabase project URL
  const escapedUrl = supabaseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const supabaseCacheRegex = new RegExp(`^${escapedUrl}\\/rest\\/v1\\/.*`);

  return {
    define: {
      '__V2_APP_VERSION__': JSON.stringify(APP_VERSION),
      '__V2_BUILD_HASH__': JSON.stringify(`v${APP_VERSION}`),
      '__BUILD_DATE__': JSON.stringify(new Date().toISOString())
    },
    plugins: [
      react(),
      // Sustituye %APP_VERSION% en index.html para que el <title> siga a package.json.
      {
        name: 'html-app-version',
        transformIndexHtml(html: string) {
          return html.replace(/%APP_VERSION%/g, APP_VERSION)
        }
      },
      VitePWA({
        registerType: 'autoUpdate',   // SW se actualiza sin prompt
        filename: `sw-v${APP_VERSION}.js`,
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
          globIgnores: [
            '**/vendor-echarts-*.js',
            '**/vendor-leaflet-*.js',
            '**/GeoMonitor-*.js',
            '**/InteligenciaHidrica-*.js',
            '**/ImportReport-*.js',
            '**/boquilla_*.png',
          ],
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            // Lecturas de escalas — NetworkFirst, 1h stale-while-revalidate
            {
              urlPattern: new RegExp(`^${escapedUrl}\\/rest\\/v1\\/(lecturas_escalas|lecturas_presas|movimientos_presas|escalas).*`),
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sica-telemetria-cache',
                networkTimeoutSeconds: 6,
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60, // 1 hora
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Resto de la API Supabase — NetworkFirst, 24h
            {
              urlPattern: supabaseCacheRegex,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'supabase-api-cache',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // GeoJSON estático — CacheFirst, 7 días
            {
              urlPattern: /\/geo\/.*\.geojson$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'sica-geo-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            // Chunks grandes excluidos del precache — StaleWhileRevalidate al visitarlos
            {
              urlPattern: /\/assets\/(vendor-echarts|vendor-leaflet|GeoMonitor|InteligenciaHidrica|ImportReport)-.*\.js$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'sica-heavy-chunks-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ]
        },
        devOptions: {
          enabled: false,   // NUNCA activar en dev
          type: 'module'
        }
      })
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-leaflet': ['leaflet', 'react-leaflet'],
            'vendor-echarts': ['echarts', 'echarts-for-react'],
            'vendor-supabase': ['@supabase/supabase-js'],
          },
        },
      },
    },
    server: {
      open: false
    }
  }
})
