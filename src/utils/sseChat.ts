/**
 * sseChat — interpretación PURA de los eventos SSE de la edge function hydric-chat (sin React ni red).
 * Protocolo (aditivo; los campos `delta`, `done`, `error`, `conversation_id` los lee también el cliente antiguo):
 *   inicio · estado · pensando · tarjetas · delta · done · error
 */
import type { FuenteRag, MetaMensaje, Tarjeta } from '../hooks/useHydricChat';

export const MAX_PENSANDO = 220;

export interface EstadoStream {
    texto: string;
    meta: MetaMensaje;
    convId: string | null;
    /** Paso actual ("Leyendo presas…"). */
    estado: string | null;
    /** Último fragmento del razonamiento resumido (acotado). */
    pensando: string;
    motor: { proveedor: string; modelo: string | null } | null;
    /** Llegó el evento `done`. */
    hecho: boolean;
}

export const estadoInicial = (convId: string | null): EstadoStream => ({ texto: '', meta: {}, convId, estado: null, pensando: '', motor: null, hecho: false });

export class ErrorStream extends Error {
    code?: string;
    constructor(mensaje: string, code?: string) { super(mensaje); this.code = code; }
}

/** Separa un búfer SSE en eventos JSON completos y el resto (línea parcial). Las líneas ilegibles se descartan. */
export function separaEventos(buffer: string): { eventos: Array<Record<string, unknown>>; resto: string } {
    const lineas = buffer.split('\n');
    const resto = lineas.pop() ?? '';
    const eventos: Array<Record<string, unknown>> = [];
    for (const linea of lineas) {
        const t = linea.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload) continue;
        try {
            const j = JSON.parse(payload);
            if (j && typeof j === 'object') eventos.push(j as Record<string, unknown>);
        } catch { /* fotograma ilegible */ }
    }
    return { eventos, resto };
}

const esTexto = (v: unknown): v is string => typeof v === 'string';

/** Aplica un evento al estado y devuelve el nuevo. Un evento `error` lanza ErrorStream (con su `code`). */
export function aplicaEvento(est: EstadoStream, j: Record<string, unknown>): EstadoStream {
    if (j.error) throw new ErrorStream(esTexto(j.message) && j.message ? j.message : 'Error de streaming', esTexto(j.code) ? j.code : undefined);

    let s = est;
    if (esTexto(j.conversation_id) && j.conversation_id) s = { ...s, convId: j.conversation_id };

    switch (j.type) {
        case 'inicio':
            if (esTexto(j.proveedor) && !s.motor) s = { ...s, motor: { proveedor: j.proveedor, modelo: null } };
            break;
        case 'estado':
            if (esTexto(j.texto)) s = { ...s, estado: j.texto };
            break;
        case 'pensando':
            if (esTexto(j.texto)) s = { ...s, pensando: (s.pensando + j.texto).slice(-MAX_PENSANDO) };
            break;
        case 'tarjetas':
            if (Array.isArray(j.tarjetas)) s = { ...s, meta: { ...s.meta, tarjetas: [...(s.meta.tarjetas ?? []), ...(j.tarjetas as Tarjeta[])] } };
            break;
        case 'done': {
            const meta: MetaMensaje = { ...s.meta, proveedor: esTexto(j.proveedor) ? j.proveedor : undefined, modelo: esTexto(j.modelo) ? j.modelo : null, truncada: !!j.truncada };
            if (Array.isArray(j.fuentes) && j.fuentes.length) meta.fuentes = j.fuentes as FuenteRag[];
            if (j.persistido === false) meta.persistido = false;
            if (j.rechazada === true) meta.rechazada = true;
            if (Array.isArray(j.datos_incompletos) && j.datos_incompletos.length) meta.datos_incompletos = j.datos_incompletos.filter(esTexto);
            s = { ...s, meta, hecho: true, motor: esTexto(j.proveedor) ? { proveedor: j.proveedor, modelo: esTexto(j.modelo) ? j.modelo : null } : s.motor };
            break;
        }
    }
    if (esTexto(j.delta) && j.delta) s = { ...s, texto: s.texto + j.delta };
    return s;
}
