/**
 * llm — capa de proveedor de hydric-chat. Claude (SDK oficial de Anthropic, streaming, tool use, thinking adaptativo,
 * caché de prompt y fallbacks server-side) cuando existe ANTHROPIC_API_KEY; Groq como respaldo para que el chat no
 * quede caído si falta la clave. Emite eventos neutros que index.ts traduce a SSE.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.135.0';
import { ejecutaHerramienta, HERRAMIENTAS, volcadoCompleto, type Tarjeta } from './herramientas.ts';
import type { Snapshot } from './contexto.ts';
import { normalizaHistorial, type MensajeHistorial } from './validacion.ts';

export type { MensajeHistorial };

export interface EntradaLlm {
    estatico: string;
    dinamico: string;
    historial: MensajeHistorial[];
    snapshot: Snapshot;
    signal: AbortSignal;
}

export interface UsoLlm { entrada: number; salida: number; cache_lectura: number; cache_escritura: number }

export type EventoLlm =
    | { tipo: 'texto'; texto: string }
    | { tipo: 'pensando'; texto: string }
    | { tipo: 'estado'; texto: string }
    | { tipo: 'tarjetas'; tarjetas: Tarjeta[] }
    | { tipo: 'fin'; razon: string; proveedor: 'claude' | 'groq'; modelo: string; truncada: boolean; rechazada: boolean; uso?: UsoLlm };

/** Error del proveedor con un código estable para que el cliente decida qué mostrar (sin filtrar detalles internos). */
export class ErrorProveedor extends Error {
    constructor(public codigo: 'cuota' | 'sobrecarga' | 'config' | 'entrada' | 'timeout' | 'proveedor', mensaje: string) { super(mensaje); }
}

const MODELO_CLAUDE = () => Deno.env.get('ANTHROPIC_MODEL') || 'claude-opus-5-5';
const EFFORT = () => Deno.env.get('ANTHROPIC_EFFORT') || 'medium';
const MODELO_GROQ = 'llama-3.3-70b-versatile';
const MAX_VUELTAS = 5;
const MAX_PENSAMIENTO_CHARS = 700;

let avisoRespaldo = false;
export function proveedorActivo(): 'claude' | 'groq' {
    if (Deno.env.get('ANTHROPIC_API_KEY')) return 'claude';
    if (!avisoRespaldo) { avisoRespaldo = true; console.warn('hydric-chat: falta ANTHROPIC_API_KEY, se usa Groq (respaldo, sin herramientas).'); }
    return 'groq';
}

export async function* conversar(e: EntradaLlm): AsyncGenerator<EventoLlm> {
    if (proveedorActivo() === 'claude') yield* conversarClaude(e);
    else yield* conversarGroq(e);
}

// ─── Claude ─────────────────────────────────────────────────────────────────────────────────────────────────────

function mapeaErrorAnthropic(err: unknown): ErrorProveedor {
    if (err instanceof Anthropic.APIUserAbortError) return new ErrorProveedor('timeout', 'La consulta fue cancelada.');
    if (err instanceof Anthropic.RateLimitError) return new ErrorProveedor('cuota', 'El motor de IA alcanzó su límite de uso. Espera unos minutos e intenta de nuevo.');
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new ErrorProveedor('config', 'El motor de IA no está configurado correctamente (clave o permisos). Avisa al administrador.');
    if (err instanceof Anthropic.BadRequestError) return new ErrorProveedor('entrada', 'El motor de IA rechazó la consulta. Reformula la pregunta o inicia una conversación nueva.');
    if (err instanceof Anthropic.APIConnectionError) return new ErrorProveedor('timeout', 'No se pudo contactar al motor de IA. Intenta de nuevo.');
    if (err instanceof Anthropic.APIError && (err.status === 529 || (err.status ?? 0) >= 500)) return new ErrorProveedor('sobrecarga', 'El motor de IA está saturado. Intenta de nuevo en un momento.');
    return new ErrorProveedor('proveedor', 'Error del motor de IA.');
}

async function* conversarClaude(e: EntradaLlm): AsyncGenerator<EventoLlm> {
    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY'), maxRetries: 1, timeout: 120_000 });
    const modelo = MODELO_CLAUDE();

    const tools = HERRAMIENTAS.map((h) => ({
        name: h.name, description: h.description, strict: true,
        input_schema: { type: 'object', properties: {}, additionalProperties: false, required: [] as string[] },
    }));
    const system = [
        // Parte estática (reglas, fórmulas) primero y con punto de caché: se reutiliza entre consultas.
        { type: 'text', text: e.estatico, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: e.dinamico },
    ];
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = normalizaHistorial(e.historial).map((m) => ({ role: m.role, content: m.content }));

    let usarFallback = true;       // fallbacks server-side del propio API; se desactiva si el API los rechaza
    let emitioAlgo = false;
    let pensamiento = 0;
    const uso: UsoLlm = { entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0 };

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        const params = {
            model: modelo, max_tokens: 16000, system, tools, messages,
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: EFFORT() },
            // En la última vuelta se prohíben nuevas herramientas: el modelo DEBE redactar la respuesta con lo que ya consultó.
            ...(vuelta === MAX_VUELTAS - 1 ? { tool_choice: { type: 'none' } } : {}),
            ...(usarFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        };

        let final;
        try {
            // deno-lint-ignore no-explicit-any
            const stream = (client.beta.messages as any).stream(params, { signal: e.signal });
            for await (const ev of stream) {
                if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
                    const h = HERRAMIENTAS.find((x) => x.name === ev.content_block.name);
                    yield { tipo: 'estado', texto: h?.estado ?? 'Consultando datos…' };
                    emitioAlgo = true;
                } else if (ev.type === 'content_block_delta') {
                    const d = ev.delta;
                    if (d?.type === 'text_delta' && d.text) { emitioAlgo = true; yield { tipo: 'texto', texto: d.text }; }
                    else if (d?.type === 'thinking_delta' && d.thinking && pensamiento < MAX_PENSAMIENTO_CHARS) {
                        pensamiento += d.thinking.length;
                        yield { tipo: 'pensando', texto: d.thinking };
                    }
                }
            }
            final = await stream.finalMessage();
        } catch (err) {
            // Si el API no acepta `fallbacks` (cuenta/plataforma), reintenta UNA vez sin ellos antes de emitir nada.
            if (usarFallback && !emitioAlgo && err instanceof Anthropic.BadRequestError && /fallback/i.test(String(err.message))) {
                usarFallback = false; vuelta--; continue;
            }
            throw mapeaErrorAnthropic(err);
        }

        uso.entrada += final.usage?.input_tokens ?? 0;
        uso.salida += final.usage?.output_tokens ?? 0;
        uso.cache_lectura += final.usage?.cache_read_input_tokens ?? 0;
        uso.cache_escritura += final.usage?.cache_creation_input_tokens ?? 0;

        if (final.stop_reason === 'tool_use') {
            // El contenido del asistente (con sus bloques de thinking) se devuelve TAL CUAL; todos los
            // tool_result van en UN solo mensaje de usuario.
            messages.push({ role: 'assistant', content: final.content });
            const resultados: unknown[] = [];
            for (const b of final.content) {
                if (b.type !== 'tool_use') continue;
                try {
                    const r = ejecutaHerramienta(b.name, e.snapshot);
                    if (r.tarjetas.length) yield { tipo: 'tarjetas', tarjetas: r.tarjetas };
                    resultados.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r.contenido), ...(r.error ? { is_error: true } : {}) });
                } catch (err) {
                    // Una herramienta que falla no debe tumbar la respuesta: el modelo recibe el error y lo comunica.
                    console.error(`herramienta ${b.name}:`, err);
                    resultados.push({ type: 'tool_result', tool_use_id: b.id, is_error: true, content: 'No se pudo consultar este dato (error interno). Trátalo como S/D y adviértelo al usuario.' });
                }
            }
            messages.push({ role: 'user', content: resultados });
            continue;
        }

        yield {
            tipo: 'fin', razon: final.stop_reason ?? 'end_turn', proveedor: 'claude', modelo: final.model ?? modelo,
            truncada: final.stop_reason === 'max_tokens', rechazada: final.stop_reason === 'refusal', uso,
        };
        return;
    }
    yield { tipo: 'fin', razon: 'max_vueltas', proveedor: 'claude', modelo, truncada: true, rechazada: false, uso };
}

// ─── Groq (respaldo sin herramientas) ───────────────────────────────────────────────────────────────────────────

async function* conversarGroq(e: EntradaLlm): AsyncGenerator<EventoLlm> {
    const key = Deno.env.get('GROQ_API_KEY');
    if (!key) throw new ErrorProveedor('config', 'El motor de IA no está configurado (falta ANTHROPIC_API_KEY o GROQ_API_KEY).');

    const nota = 'MODO DE RESPALDO: en esta consulta no hay herramientas; los resultados de todas las herramientas están al final de este mensaje de sistema. Aplican las mismas reglas de veracidad.';
    const system = `${e.estatico}\n\n${nota}\n\n${e.dinamico}\n\n${volcadoCompleto(e.snapshot)}`;
    const messages = [{ role: 'system', content: system }, ...normalizaHistorial(e.historial)];

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODELO_GROQ, messages, temperature: 0.1, max_tokens: 2500, stream: true }),
        signal: e.signal,
    });
    if (!res.ok || !res.body) {
        console.error('Groq error', res.status, (await res.text()).slice(0, 300));
        if (res.status === 429) throw new ErrorProveedor('cuota', 'El motor de IA alcanzó su límite de uso. Espera unos minutos e intenta de nuevo.');
        if (res.status === 401 || res.status === 403) throw new ErrorProveedor('config', 'El motor de IA no está configurado correctamente (clave o permisos). Avisa al administrador.');
        throw new ErrorProveedor('proveedor', 'Error del motor de IA.');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let razon: string | null = null;
    let terminoLimpio = false;      // llegó [DONE] o un finish_reason: el proveedor cerró la respuesta
    let ilegibles = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lineas = buffer.split('\n');
        buffer = lineas.pop() ?? '';          // lo que queda es una línea aún incompleta: se completa con el siguiente bloque
        for (const linea of lineas) {
            const t = linea.trim();
            if (!t.startsWith('data:')) continue;
            const payload = t.slice(5).trim();
            if (payload === '[DONE]') { terminoLimpio = true; continue; }
            let j;
            try { j = JSON.parse(payload); } catch { ilegibles++; continue; }
            // Groq puede mandar un fotograma {"error": …} a mitad de la respuesta: no es una respuesta vacía "completa".
            if (j.error) {
                console.error('Groq: error en el stream:', JSON.stringify(j.error).slice(0, 300));
                throw new ErrorProveedor('proveedor', 'El motor de IA reportó un error durante la respuesta.');
            }
            const delta = j.choices?.[0]?.delta?.content;
            if (j.choices?.[0]?.finish_reason) { razon = j.choices[0].finish_reason; terminoLimpio = true; }
            if (delta) yield { tipo: 'texto', texto: delta };
        }
    }
    if (ilegibles > 0) console.warn(`Groq: ${ilegibles} fotograma(s) SSE ilegibles`);
    // Conexión cortada sin cierre explícito: la respuesta puede estar incompleta y así se marca.
    yield {
        tipo: 'fin', razon: razon ?? (terminoLimpio ? 'stop' : 'stream_incompleto'), proveedor: 'groq', modelo: MODELO_GROQ,
        truncada: razon === 'length' || !terminoLimpio, rechazada: false,
    };
}
