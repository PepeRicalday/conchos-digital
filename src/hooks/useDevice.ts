// ÚNICA FUENTE de detección de dispositivo/pantalla (teléfono · tablet · escritorio).
//
// `initDeviceDetection()` se llama en main.tsx ANTES de montar React: escribe atributos en <html>
// y se mantiene sincronizado con redimensionados y giros de pantalla, de modo que el CSS
// (`html[data-device="phone"] …`) acierta desde el primer pintado, sin parpadeo.
// `useDevice()` expone lo mismo a componentes que necesiten lógica en JS.
//
//   data-device       phone | tablet | desktop
//   data-orientation  portrait | landscape
//   data-touch        true | false   (puntero táctil principal)
//   data-standalone   true | false   (PWA instalada en pantalla de inicio)
//   data-ios          true | false
//
// Reglas:
//   phone   = ancho ≤ 900 px, o táctil con alto ≤ 500 px (iPhone en horizontal, 956×440).
//   tablet  = táctil con ancho ≤ 1366 px que no es phone (iPad).
//   desktop = el resto.
// Las mismas consultas están documentadas en src/index.css; si se cambian aquí, cambiar allá.
import { useSyncExternalStore } from 'react';
import { esIOS } from '../utils/descargaArchivo';

export type TipoDispositivo = 'phone' | 'tablet' | 'desktop';

export interface Dispositivo {
    tipo: TipoDispositivo;
    orientacion: 'portrait' | 'landscape';
    tactil: boolean;
    standalone: boolean;
    ios: boolean;
    esPhone: boolean;
    esTablet: boolean;
    esDesktop: boolean;
}

const MQ_PHONE = '(max-width: 900px), (pointer: coarse) and (max-height: 500px)';
const MQ_TABLET = '(max-width: 1366px) and (pointer: coarse)';
const MQ_PORTRAIT = '(orientation: portrait)';
const MQ_TOUCH = '(pointer: coarse)';
const MQ_STANDALONE = '(display-mode: standalone)';

const mq = (q: string) => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(q) : null);

function leer(): Dispositivo {
    const phone = mq(MQ_PHONE)?.matches ?? false;
    const tablet = !phone && (mq(MQ_TABLET)?.matches ?? false);
    const tipo: TipoDispositivo = phone ? 'phone' : tablet ? 'tablet' : 'desktop';
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { standalone?: boolean }) : undefined;
    return {
        tipo,
        orientacion: (mq(MQ_PORTRAIT)?.matches ?? true) ? 'portrait' : 'landscape',
        tactil: (mq(MQ_TOUCH)?.matches ?? false) || (typeof window !== 'undefined' && 'ontouchstart' in window),
        standalone: (mq(MQ_STANDALONE)?.matches ?? false) || nav?.standalone === true,
        ios: typeof navigator !== 'undefined' ? esIOS() : false,
        esPhone: phone,
        esTablet: tablet,
        esDesktop: !phone && !tablet,
    };
}

let actual: Dispositivo | null = null;
const oyentes = new Set<() => void>();
let iniciado = false;

function aplicar() {
    const nuevo = leer();
    const igual = actual
        && actual.tipo === nuevo.tipo && actual.orientacion === nuevo.orientacion && actual.tactil === nuevo.tactil
        && actual.standalone === nuevo.standalone && actual.ios === nuevo.ios;
    if (igual) return;
    actual = nuevo;                                   // nueva referencia solo si algo cambió (useSyncExternalStore)
    if (typeof document !== 'undefined') {
        const d = document.documentElement.dataset;
        d.device = nuevo.tipo;
        d.orientation = nuevo.orientacion;
        d.touch = String(nuevo.tactil);
        d.standalone = String(nuevo.standalone);
        d.ios = String(nuevo.ios);
    }
    oyentes.forEach(fn => fn());
}

/** Idempotente. Llamar una vez, antes de `createRoot(...).render(...)`. */
export function initDeviceDetection() {
    if (iniciado || typeof window === 'undefined') return;
    iniciado = true;
    aplicar();
    [MQ_PHONE, MQ_TABLET, MQ_PORTRAIT, MQ_TOUCH, MQ_STANDALONE].forEach(q => mq(q)?.addEventListener?.('change', aplicar));
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', aplicar);
}

function suscribir(fn: () => void) {
    initDeviceDetection();
    oyentes.add(fn);
    return () => { oyentes.delete(fn); };
}

function instantanea(): Dispositivo {
    if (!actual) { initDeviceDetection(); actual = actual ?? leer(); }
    return actual;
}

/** Dispositivo actual; el componente se re-renderiza al cambiar tipo/orientación/modo. */
export function useDevice(): Dispositivo {
    return useSyncExternalStore(suscribir, instantanea, instantanea);
}
