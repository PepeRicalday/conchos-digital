/* eslint-disable react-refresh/only-export-components -- el almacén del trazo, el hook y el proveedor viven juntos a propósito: un solo fetch compartido. */
/**
 * TrazoContext — carga UNA sola vez el trazo real del canal (public/geo/canal_conchos.geojson, que el service worker ya cachea) y lo
 * reparte a la ventana de ubicación y a la infografía. Si la red falla, el trazo es null y todo degrada a la cuerda entre vértices del
 * inventario con un aviso (nunca se inventa un contorno).
 *
 * `useTrazo()` funciona con o sin `<TrazoProvider>`: ambos leen el mismo almacén de módulo, de modo que hay un solo fetch por página.
 * Las versiones simplificadas (Douglas-Peucker 10 m para el mapa del tramo, 50 m para el canal completo) se calculan una vez.
 */
import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { parsearTrazoGeoJSON, simplificarDP } from '../../../conservacion/geo/trazo';
import type { Trazo } from '../../../conservacion/geo/trazo';

export const URL_TRAZO = '/geo/canal_conchos.geojson';
export const TOLERANCIA_MAPA_TRAMO_M = 10;
export const TOLERANCIA_CANAL_COMPLETO_M = 50;

type Punto = [number, number];

export interface EstadoTrazo {
    /** 'cargando' = aún no llega; 'listo' = trazo válido; 'error' = red o formato inválido (se usa la cuerda). */
    readonly estado: 'cargando' | 'listo' | 'error';
    readonly trazo: Trazo | null;
    /** Polilínea [lat, lon] simplificada a 10 m (mapa del tramo). */
    readonly dp10: readonly Punto[];
    /** Polilínea [lat, lon] simplificada a 50 m (canal completo). */
    readonly dp50: readonly Punto[];
    readonly motivo: string | null;
}

const INICIAL: EstadoTrazo = { estado: 'cargando', trazo: null, dp10: [], dp50: [], motivo: null };
let actual: EstadoTrazo = INICIAL;
let promesa: Promise<EstadoTrazo> | null = null;
const oyentes = new Set<() => void>();

const aLatLon = (pts: ReadonlyArray<readonly [number, number]>): Punto[] => pts.map((p) => [p[1], p[0]] as Punto);

function publicar(e: EstadoTrazo): EstadoTrazo {
    actual = e;
    oyentes.forEach((f) => f());
    return e;
}

/** Un solo fetch por página: las llamadas siguientes devuelven la misma promesa (o el resultado ya listo). */
export function obtenerTrazo(): Promise<EstadoTrazo> {
    if (promesa === null) {
        promesa = fetch(URL_TRAZO)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((g: unknown) => {
                const trazo = parsearTrazoGeoJSON(g);
                if (trazo === null) return publicar({ estado: 'error', trazo: null, dp10: [], dp50: [], motivo: 'el archivo del trazo no tiene el formato esperado' });
                return publicar({
                    estado: 'listo', trazo, motivo: null,
                    dp10: aLatLon(simplificarDP(trazo.puntos, TOLERANCIA_MAPA_TRAMO_M)), dp50: aLatLon(simplificarDP(trazo.puntos, TOLERANCIA_CANAL_COMPLETO_M)),
                });
            })
            .catch((e: unknown) => publicar({ estado: 'error', trazo: null, dp10: [], dp50: [], motivo: e instanceof Error ? e.message : 'sin conexión' }));
    }
    return promesa;
}

const suscribir = (f: () => void): (() => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };

const Ctx = createContext<EstadoTrazo | null>(null);

/** Lee el trazo del canal (dispara la carga la primera vez). */
export function useTrazo(): EstadoTrazo {
    const delProveedor = useContext(Ctx);
    const global = useSyncExternalStore(suscribir, () => actual, () => INICIAL);
    useEffect(() => { void obtenerTrazo(); }, []);
    return delProveedor ?? global;
}

/** Opcional: precarga el trazo al montar. Los hijos obtienen lo mismo con `useTrazo()` con o sin este proveedor. */
export function TrazoProvider({ children }: { children: ReactNode }) {
    const e = useSyncExternalStore(suscribir, () => actual, () => INICIAL);
    useEffect(() => { void obtenerTrazo(); }, []);
    return <Ctx.Provider value={e}>{children}</Ctx.Provider>;
}

/** Solo para pruebas: reinicia el almacén. */
export function reiniciarTrazoParaPruebas(): void { actual = INICIAL; promesa = null; }
