import { useCallback, useEffect, useMemo, useState } from 'react';
import { CAPAS_PANTALLA, cargarCapas, todasLasCapas, type CapaId, type DatosCapas } from '../utils/capasCuenca';

const CLAVE = 'sica.cuenca.capas';

/** Capas recordadas por equipo (solo una comodidad: si el navegador bloquea el almacenamiento, vale el valor por defecto). */
function leer(): CapaId[] {
    try {
        const t = window.localStorage.getItem(CLAVE);
        if (t == null) return CAPAS_PANTALLA;
        const validas = new Set<string>(todasLasCapas());
        const a = JSON.parse(t);
        return Array.isArray(a) ? (a.filter((x) => typeof x === 'string' && validas.has(x)) as CapaId[]) : CAPAS_PANTALLA;
    } catch { return CAPAS_PANTALLA; }
}

export interface CapasCuenca { ids: CapaId[]; datos: DatosCapas; alternar: (id: CapaId) => void; todas: () => void; ninguna: () => void }

/**
 * Capas de referencia activas de la cuenca (ríos, municipios, presas…) y sus datos. Un solo estado para los planos y el mapa de la red,
 * de modo que lo que el usuario enciende se ve igual en ambos. Los archivos se descargan solo cuando una capa se activa (con caché).
 */
export function useCapasCuenca(): CapasCuenca {
    const [ids, setIds] = useState<CapaId[]>(leer);
    const [datos, setDatos] = useState<DatosCapas>({});

    useEffect(() => {
        let vivo = true;
        cargarCapas(ids).then((d) => { if (vivo) setDatos(d); });
        return () => { vivo = false; };
    }, [ids]);

    const guardar = useCallback((n: CapaId[]) => {
        setIds(n);
        try { window.localStorage.setItem(CLAVE, JSON.stringify(n)); } catch { /* sin almacenamiento: no se recuerda */ }
    }, []);
    const alternar = useCallback((id: CapaId) => guardar(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]), [ids, guardar]);
    const todas = useCallback(() => guardar(todasLasCapas()), [guardar]);
    const ninguna = useCallback(() => guardar([]), [guardar]);
    return useMemo(() => ({ ids, datos, alternar, todas, ninguna }), [ids, datos, alternar, todas, ninguna]);
}
