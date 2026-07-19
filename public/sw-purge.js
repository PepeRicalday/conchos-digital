/**
 * sw-purge.js — Purga de caché al activar una versión nueva del Service Worker.
 *
 * PROBLEMA QUE RESUELVE
 * El SW precachea index.html. Tras un deploy, los chunks cambian de hash
 * (Dashboard-BkZBISHi.js → Dashboard-C0JlXrOp.js) y el chunk viejo desaparece
 * del servidor (404). Pero el dispositivo sigue sirviendo el index.html viejo
 * desde caché, que apunta al chunk viejo, que también está en caché — así que
 * el bundle anterior se perpetúa indefinidamente.
 *
 * Los mecanismos de reset que viven en el bundle de la app (epoch, búsqueda
 * periódica de versión) NO pueden resolver esto: están dentro del código que
 * el dispositivo nunca llega a cargar. Es circular.
 *
 * Este archivo se importa DENTRO del SW. El navegador siempre revalida el SW
 * contra la red, por lo que es el único punto de entrada inmune al caché.
 * Al activarse una versión nueva, borra todo y toma control.
 */

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            try {
                // Purga total: workbox mantiene el precache nuevo por su cuenta,
                // pero las entradas viejas (incluido index.html) deben irse.
                const nombres = await caches.keys();
                await Promise.all(nombres.map((n) => caches.delete(n)));
            } catch {
                // Si falla la purga, seguimos: es preferible tomar control con
                // caché sucia que dejar al dispositivo sin SW.
            }

            await self.clients.claim();

            // Recarga las pestañas abiertas para que carguen el index.html nuevo.
            const clientes = await self.clients.matchAll({ type: 'window' });
            for (const cliente of clientes) {
                if ('navigate' in cliente) {
                    cliente.navigate(cliente.url).catch(() => { /* pestaña cerrada */ });
                }
            }
        })()
    );
});
