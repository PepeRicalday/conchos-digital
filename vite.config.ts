import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }
import { execFile } from 'node:child_process'
import path from 'node:path'

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
      tailwindcss(),
      // SICA Conservación: SOLO en el servidor de desarrollo local. Lee la carpeta de PacOT de la SRL
      // (Conservacion/SRL CONCHOS), admite y registra cada libro con `scripts/conservacion-derivar.mjs --json`
      // y entrega el resultado a la pantalla. No existe en el build publicado ni acepta rutas del cliente.
      {
        name: 'conservacion-carpeta-pacot',
        apply: 'serve' as const,
        configureServer(server: import('vite').ViteDevServer) {
          let cola: Promise<unknown> = Promise.resolve()
          const correr = () => new Promise<string>((resolve, reject) => {
            const viteNode = path.resolve(server.config.root, 'node_modules', 'vite-node', 'vite-node.mjs')
            execFile(process.execPath, [viteNode, 'scripts/conservacion-derivar.mjs', '--', '--json'],
              { cwd: server.config.root, maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60 * 1000 },
              (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).slice(0, 600))) : resolve(stdout)))
          })
          server.middlewares.use('/__conservacion/derivacion', (req, res) => {
            const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.setHeader('Cache-Control', 'no-store')
            if (req.method !== 'GET' || !local) { res.statusCode = local ? 405 : 403; res.end('{"error":"no permitido"}'); return }
            const turno = cola.then(correr)
            cola = turno.catch(() => undefined) // una corrida lenta o fallida no bloquea las siguientes
            turno.then((txt) => { res.end(txt) }, (e: Error) => { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) })
          })
        },
      },
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
          // Mismos colores que la app (fondo oscuro): sin destello blanco al abrir desde
          // la pantalla de inicio del iPhone y barra de estado integrada.
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          lang: 'es',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          // index.html se sirve SIEMPRE desde la red (NetworkFirst más abajo).
          // Es el documento que apunta a los chunks con hash; si queda cacheado,
          // el dispositivo sigue pidiendo chunks que ya no existen en el servidor
          // y nunca alcanza la versión nueva.
          navigateFallback: null,
          globIgnores: [
            // index.html FUERA del precache: es el documento que referencia los
            // chunks con hash. Precacheado, el dispositivo queda anclado a una
            // lista de chunks que el servidor ya borró (404) y no puede avanzar.
            'index.html',
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
          // El navegador SIEMPRE revalida el SW contra la red, así que este
          // archivo es el único punto de entrada que no puede quedar atrapado
          // en caché. Al activarse una versión nueva, purga todo lo anterior:
          // sin esto, index.html se servía desde caché y el dispositivo nunca
          // llegaba a ver las referencias a los chunks nuevos — el bundle viejo
          // se perpetuaba aunque el SW sí se hubiera actualizado.
          importScripts: ['/sw-purge.js'],
          runtimeCaching: [
            // Documento de navegación — SIEMPRE red primero.
            // Garantiza que el index.html (y con él, las referencias a los
            // chunks vigentes) se revalide en cada carga. La caché solo actúa
            // como respaldo sin conexión.
            {
              urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'sica-html-cache',
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 5 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
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
            'vendor-recharts': ['recharts'],
            'vendor-xlsx': ['xlsx'],
            'vendor-shapefile': ['shpjs', '@tmcw/togeojson'],
          },
        },
      },
    },
    server: {
      open: false
    }
  }
})
