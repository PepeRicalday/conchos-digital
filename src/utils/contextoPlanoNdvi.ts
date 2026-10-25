/**
 * contextoPlanoNdvi — carga del contexto cartográfico del plano del informe NDVI: relieve recortado a la SRL (JPEG chico),
 * canal Conchos y vecinos del DR-005 ya simplificados (public/geo/plano_ndvi_contexto.json). Se descarga UNA vez por sesión
 * (y los bytes del JPEG se incrustan como data URI en el informe). Nunca lanza: sin contexto el plano sale sin relieve.
 * Los archivos los generan scripts/recorta_hillshade_srl.py y scripts/genera_contexto_plano_ndvi.ts.
 */
import type { ContextoPlano } from './informeNdviSvg';

export const RUTA_CONTEXTO_JSON = '/geo/plano_ndvi_contexto.json';
export const RUTA_RELIEVE_JPG = '/dem-distrito-hillshade/hillshade_srl_plano.jpg';

/** JSON del contexto + data URI del relieve → ContextoPlano (puro; lo usan el cargador y las pruebas). */
export function armarContextoPlano(json: unknown, relieveUri: string): ContextoPlano | null {
    const j = json as Partial<ContextoPlano> | null;
    const caja = j?.bbox;
    if (!Array.isArray(caja) || caja.length !== 4 || !caja.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
    const lista = (x: unknown) => (Array.isArray(x) ? (x as ContextoPlano['canal']) : []);
    return { bbox: caja as ContextoPlano['bbox'], relieveUri, canal: lista(j?.canal), rio: lista(j?.rio), vecinos: lista(j?.vecinos) };
}

function aDataUri(buf: ArrayBuffer, tipo: string): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${tipo};base64,${btoa(bin)}`;
}

let promesa: Promise<ContextoPlano | null> | null = null;

/** Descarga el contexto (una vez por sesión). Si el JSON falla → null; si solo falla el JPEG → contexto vectorial sin relieve. */
export function cargarContextoPlano(): Promise<ContextoPlano | null> {
    if (!promesa) {
        promesa = (async () => {
            try {
                const r = await fetch(RUTA_CONTEXTO_JSON);
                if (!r.ok) return null;
                const json = await r.json();
                let uri = '';
                try {
                    const j = await fetch(RUTA_RELIEVE_JPG);
                    if (j.ok) uri = aDataUri(await j.arrayBuffer(), 'image/jpeg');
                } catch { /* sin relieve */ }
                return armarContextoPlano(json, uri);
            } catch { return null; }
        })().then((c) => { if (!c) promesa = null; return c; });
    }
    return promesa;
}
