// ═══════════════════════════════════════════════════════════════════════════
// Informe de Pronóstico — nivel BÁSICO para la ciudadanía — SICA-005
// ---------------------------------------------------------------------------
// Mismo `DatosPronostico` que el informe operativo, contado para cualquier
// persona: sin siglas (m/s, mm/h, S/D, módulos), con km/h, palabras en lugar de
// umbrales, ilustraciones y recomendaciones concretas. Todas las reglas de
// lenguaje viven en funciones PURAS y exportadas (describeDia, titularLlano,
// recomendaciones, resumenSencillo) para poder verificarlas contra la base de
// datos sin abrir el HTML.
//
// Revisado por tres agentes independientes (veracidad contra la BD, lenguaje
// claro y diseño/accesibilidad); sus hallazgos están incorporados aquí.
//
// Reglas de veracidad (las mismas del informe operativo):
//   · cielo y lluvia son cosas distintas: un día despejado puede traer lluvia
//     (convectiva) y uno nublado puede no traerla; sin dato de nubosidad el cielo
//     se rotula "sin información", nunca un sol por omisión.
//   · sin dato de lluvia NUNCA se dice "no se espera lluvia" (S/D ≠ 0).
//   · un día que el pronóstico no cubre completo se rotula como parcial.
//   · una cifra de lluvia nunca se presenta como certeza: es pronóstico.
//   · no sustituye los avisos oficiales de Protección Civil ni del SMN.
// ═══════════════════════════════════════════════════════════════════════════
import { assetToDataURI } from './assetToDataURI';
import { guardaOComparte } from './descargaArchivo';
import { getTodayString } from './dateHelpers';
import { rasterizaHtml } from './rasterizaHtml';
import { fmtHora, type DatosPronostico, type Franja, type NivelRiesgo, type ResumenDia } from './informePronosticoDatos';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kmh = (ms: number | null) => (ms == null ? null : Math.round(ms * 3.6));
const grados = (v: number | null) => (v == null ? '—' : `${Math.round(v)}°`);
const hhmm = (ms: number) => fmtHora(ms);

// ── Umbrales (vienen de clima_umbrales vía d.riesgos; valores sembrados como respaldo) ──
export interface UmbralesLlanos {
    lluviaAvisoMm: number; lluviaCriticoMm: number;
    vientoAvisoMs: number; vientoCriticoMs: number;
    heladaAvisoC: number; calorAvisoC: number;
}
export function umbralesLlanos(d: DatosPronostico): UmbralesLlanos {
    const r = (c: string) => d.riesgos.find(x => x.clave === c);
    return {
        lluviaAvisoMm: r('lluvia')?.aviso ?? 10, lluviaCriticoMm: r('lluvia')?.critico ?? 25,
        vientoAvisoMs: r('viento')?.aviso ?? 6, vientoCriticoMs: r('viento')?.critico ?? 10,
        heladaAvisoC: r('helada')?.aviso ?? 4, calorAvisoC: r('calor')?.aviso ?? 36,
    };
}

// ── Nombres que reconoce la gente ───────────────────────────────────────────
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** '2026-10-15' → '15 de octubre'. Si no es una fecha ISO, se devuelve tal cual. */
export function fechaLarga(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${Number(m[3])} de ${MESES_LARGOS[Number(m[2]) - 1]}` : iso;
}

export function lugarLlano(nombre: string): string {
    if (/boquilla/i.test(nombre)) return 'la Presa La Boquilla';
    if (/v[ií]rgenes/i.test(nombre)) return 'la Presa Las Vírgenes';
    if (/san rafael/i.test(nombre)) return 'la zona de San Rafael';
    const m = /m[oó]dulo\s*(\d+)/i.exec(nombre);
    return m ? `la zona de riego del Módulo ${m[1]}` : nombre;
}

// ── Palabras para cada magnitud ─────────────────────────────────────────────
export type CieloTipo = 'despejado' | 'poco' | 'parcial' | 'nublado' | 'sin_dato';
export function cieloDe(pct: number | null): { tipo: CieloTipo; texto: string } {
    if (pct == null || !Number.isFinite(pct)) return { tipo: 'sin_dato', texto: 'Sin información del cielo' };
    if (pct <= 20) return { tipo: 'despejado', texto: 'Despejado' };
    if (pct <= 50) return { tipo: 'poco', texto: 'Poco nublado' };
    if (pct <= 80) return { tipo: 'parcial', texto: 'Parcialmente nublado' };
    return { tipo: 'nublado', texto: 'Nublado' };
}

export type LluviaNivel = 'sin_dato' | 'ninguna' | 'posible' | 'llovizna' | 'ligera' | 'moderada' | 'fuerte' | 'muy_fuerte';
export function lluviaDe(dia: ResumenDia, u: UmbralesLlanos): { nivel: LluviaNivel; texto: string } {
    // Sin dato NO es "sin lluvia": si falta tanto la lámina como la probabilidad, se dice que no hay información.
    if (dia.lluviaMaxMm == null && dia.probMaxPct == null) return { nivel: 'sin_dato', texto: 'Sin información de lluvia' };
    const prob = dia.probMaxPct ?? 0, mm = dia.lluviaMaxMm ?? 0;
    if (mm < 0.3 && prob < 20) return { nivel: 'ninguna', texto: 'No se espera lluvia' };
    if (mm < 0.3 && prob < 40) return { nivel: 'posible', texto: 'Es poco probable que llueva' };
    if (mm < 0.3) return { nivel: 'posible', texto: `Puede llover un poco (${Math.round(prob)} de cada 100)` };
    if (mm < 1) return { nivel: 'llovizna', texto: 'Llovizna' };
    if (mm < 5) return { nivel: 'ligera', texto: 'Lluvia ligera' };
    if (mm < u.lluviaAvisoMm) return { nivel: 'moderada', texto: 'Lluvia moderada' };
    if (mm < u.lluviaCriticoMm) return { nivel: 'fuerte', texto: 'Lluvia fuerte' };
    return { nivel: 'muy_fuerte', texto: 'Lluvia muy fuerte' };
}
const llueveDeVerdad = (n: LluviaNivel) => n !== 'ninguna' && n !== 'posible' && n !== 'sin_dato';
const lluviaFuerte = (n: LluviaNivel) => n === 'fuerte' || n === 'muy_fuerte';

/** Probabilidad en palabras; la cifra queda entre paréntesis, expresada como "N de cada 100". */
export function probFrase(p: number | null): string {
    if (p == null) return '';
    const n = Math.round(p);
    if (p >= 80) return `Es casi seguro que llueva (${n} de cada 100)`;
    if (p >= 50) return `Es probable que llueva (${n} de cada 100)`;
    if (p >= 20) return `Puede llover (${n} de cada 100)`;
    return `Es poco probable que llueva (${n} de cada 100)`;
}

export type VientoNivel = 'ligero' | 'moderado' | 'fuerte' | 'muy_fuerte';
/** Muy fuerte desde 54 km/h (15 m/s): daño a estructuras ligeras y ramas. */
const VIENTO_MUY_FUERTE_MS = 15;
/**
 * Escala para PERSONAS: ligero < 12 km/h, moderado hasta el umbral crítico de SICA (10 m/s = 36 km/h),
 * fuerte hasta 54 km/h, muy fuerte después. El umbral de AVISO de SICA (6 m/s ≈ 22 km/h) es de riego por
 * aspersión, no de seguridad: ahí el viento ya estorba al riego pero para una persona solo es "moderado".
 */
export function vientoDe(ms: number | null, u: UmbralesLlanos): { nivel: VientoNivel; texto: string; kmh: number | null } | null {
    if (ms == null) return null;
    const k = kmh(ms)!;
    if (ms < 3.3) return { nivel: 'ligero', texto: `Viento ligero (hasta ${k} km/h)`, kmh: k };
    if (ms < u.vientoCriticoMs) return { nivel: 'moderado', texto: `Viento moderado (hasta ${k} km/h)`, kmh: k };
    if (ms < VIENTO_MUY_FUERTE_MS) return { nivel: 'fuerte', texto: `Viento fuerte (hasta ${k} km/h)`, kmh: k };
    return { nivel: 'muy_fuerte', texto: `Viento muy fuerte (hasta ${k} km/h)`, kmh: k };
}
const vientoFuerte = (n: VientoNivel | undefined) => n === 'fuerte' || n === 'muy_fuerte';

export function sensacionDe(tMax: number | null, u: UmbralesLlanos): string {
    if (tMax == null) return 'Sin información de temperatura';
    if (tMax < 10) return 'Frío';
    if (tMax < 18) return 'Fresco';
    if (tMax < 27) return 'Agradable';
    if (tMax < u.calorAvisoC - 3) return 'Caluroso';
    return 'Calor intenso';
}

const FRANJA_TXT: Record<Franja, string> = { madrugada: 'la madrugada', mañana: 'la mañana', tarde: 'la tarde', noche: 'la noche' };
/** Cuándo llueve, con la preposición ya incluida ("en la tarde y la noche", "casi todo el día"). */
export function cuandoLlueve(f: Franja[]): string {
    if (!f.length) return '';
    if (f.length === 4) return 'todo el día';
    if (f.length === 3) return 'casi todo el día';
    const t = f.map(x => FRANJA_TXT[x]);
    return `en ${t.length === 1 ? t[0] : `${t[0]} y ${t[1]}`}`;
}

/** Cuándo llueve en un día, con horas reales: "entre las 10:00 y las 20:00 h" o "casi todo el día". */
export function cuandoTexto(dia: ResumenDia): string {
    if (dia.lluviaDesdeMs != null && dia.lluviaHastaMs != null) {
        const horas = (dia.lluviaHastaMs - dia.lluviaDesdeMs) / 3_600_000;
        if (horas >= 20) return 'casi todo el día';
        return `entre las ${hhmm(dia.lluviaDesdeMs)} y las ${hhmm(dia.lluviaHastaMs)} h`;
    }
    return cuandoLlueve(dia.franjasLluvia);
}

export type IconoClave = 'sol' | 'sol_nube' | 'nube' | 'lluvia' | 'lluvia_fuerte' | 'viento' | 'viento_fuerte' | 'frio' | 'calor' | 'paraguas' | 'alerta' | 'ok' | 'sin_dato' | 'sin_lluvia' | 'campo' | 'rayo';

export interface DiaLlano {
    dia: ResumenDia;
    cielo: ReturnType<typeof cieloDe>;
    lluvia: ReturnType<typeof lluviaDe>;
    viento: ReturnType<typeof vientoDe>;
    sensacion: string;
    /** Línea de cielo: separa cielo y lluvia pero los muestra juntos ("Nublado, con lluvia fuerte"). */
    lineaCielo: string;
    /** Frase de lluvia completa, con cuándo y dónde. */
    fraseLluvia: string;
    icono: IconoClave;
}

export function describeDia(dia: ResumenDia, u: UmbralesLlanos): DiaLlano {
    const cielo = cieloDe(dia.nubMediaPct), lluvia = lluviaDe(dia, u), viento = vientoDe(dia.vientoMaxMs, u);
    let fraseLluvia = lluvia.texto;
    if (llueveDeVerdad(lluvia.nivel)) {
        const cuando = cuandoTexto(dia);
        fraseLluvia = `${lluvia.texto}${cuando ? ` ${cuando}` : ''}.`;
        if (dia.probMaxPct != null) fraseLluvia += ` ${probFrase(dia.probMaxPct)}.`;
        if (dia.lugarMasLluvia && (dia.lluviaMaxMm ?? 0) >= 2) fraseLluvia += ` Puede caer más lluvia hacia ${lugarLlano(dia.lugarMasLluvia)}.`;
    }
    // Un día que el pronóstico no cubre completo (hasta las 10:00 de pasado mañana) lo dice en cada dato.
    const cortado = dia.parcial && dia.etiqueta !== 'Hoy';
    if (cortado) fraseLluvia = `Hasta las ${hhmm(dia.hastaMs)} h: ${fraseLluvia.charAt(0).toLowerCase()}${fraseLluvia.slice(1)}`;

    // Icono: la lluvia manda si es relevante; si no, el cielo. Sin dato de cielo NO se dibuja sol.
    let icono: IconoClave;
    if (lluviaFuerte(lluvia.nivel)) icono = 'lluvia_fuerte';
    else if (lluvia.nivel === 'moderada' || lluvia.nivel === 'ligera' || lluvia.nivel === 'llovizna') icono = 'lluvia';
    else icono = cielo.tipo === 'despejado' ? 'sol' : cielo.tipo === 'poco' || cielo.tipo === 'parcial' ? 'sol_nube' : cielo.tipo === 'nublado' ? 'nube' : 'sin_dato';
    const lineaCielo = llueveDeVerdad(lluvia.nivel) ? `${cielo.texto}, con ${lluvia.texto.toLowerCase()}` : cielo.texto;
    return { dia, cielo, lluvia, viento, sensacion: sensacionDe(dia.tMaxC, u), lineaCielo, fraseLluvia, icono };
}

// ── Titular y semáforo ──────────────────────────────────────────────────────
const nombreDia = (x: DiaLlano) => (x.dia.etiqueta === 'Hoy' ? 'hoy' : x.dia.etiqueta === 'Mañana' ? 'mañana' : x.dia.etiqueta === 'Pasado mañana' ? 'pasado mañana' : x.dia.etiqueta);

export interface TitularLlano { nivel: NivelRiesgo; sinDatos: boolean; titulo: string; detalle: string }
export function titularLlano(d: DatosPronostico, u: UmbralesLlanos = umbralesLlanos(d)): TitularLlano {
    const ds = d.dias.map(x => describeDia(x, u));
    if (!ds.length) return { nivel: 'normal', sinDatos: true, titulo: 'Sin información de pronóstico por ahora', detalle: 'Intente de nuevo en una hora.' };

    // Lluvia fuerte y viento fuerte el mismo día (o lluvia muy fuerte): situación de riesgo mayor.
    const tormenta = ds.find(x => lluviaFuerte(x.lluvia.nivel) && vientoFuerte(x.viento?.nivel));
    const muyFuerte = ds.find(x => x.lluvia.nivel === 'muy_fuerte' || x.viento?.nivel === 'muy_fuerte');
    const fuerteLluvia = ds.find(x => lluviaFuerte(x.lluvia.nivel));
    if (tormenta || muyFuerte) {
        const x = (tormenta ?? muyFuerte)!;
        const cuando = cuandoTexto(x.dia);
        return {
            nivel: 'critico', sinDatos: false,
            titulo: `${lluviaFuerte(x.lluvia.nivel) ? `${x.lluvia.texto} y ${x.viento ? x.viento.texto.split(' (')[0].toLowerCase() : 'viento'}` : x.viento!.texto.split(' (')[0]} ${nombreDia(x)}${cuando ? `, ${cuando}` : ''}`,
            detalle: 'Evite salir si no es necesario. No cruce canales ni arroyos y manténgase lejos de árboles y postes.',
        };
    }
    if (fuerteLluvia) {
        const cuando = cuandoTexto(fuerteLluvia.dia);
        return {
            nivel: 'aviso', sinDatos: false,
            titulo: `${fuerteLluvia.lluvia.texto} ${nombreDia(fuerteLluvia)}${cuando ? `, ${cuando}` : ''}`,
            detalle: 'No cruce arroyos ni canales, evite las zonas bajas y maneje despacio.',
        };
    }
    const fuerteViento = ds.find(x => vientoFuerte(x.viento?.nivel));
    if (fuerteViento) {
        const h = fuerteViento.dia.vientoMaxHoraMs;
        return {
            nivel: 'aviso', sinDatos: false,
            titulo: `Viento fuerte ${nombreDia(fuerteViento)}${h ? `, sobre todo cerca de las ${hhmm(h)} h` : ''}`,
            detalle: 'Asegure objetos sueltos y no se detenga bajo árboles, postes ni estructuras débiles.',
        };
    }
    const helada = ds.find(x => x.dia.tMinC != null && x.dia.tMinC <= u.heladaAvisoC);
    if (helada) return { nivel: 'aviso', sinDatos: false, titulo: `Riesgo de helada ${nombreDia(helada)} (mínima de ${Math.round(helada.dia.tMinC!)} °C)`, detalle: 'Cubra las plantas sensibles y proteja del frío a personas y mascotas.' };
    const posible = ds.find(x => llueveDeVerdad(x.lluvia.nivel) && ((x.dia.probMaxPct ?? 0) >= 40 || (x.dia.lluviaMaxMm ?? 0) >= 1));
    if (posible) {
        const cuando = cuandoTexto(posible.dia);
        return { nivel: 'normal', sinDatos: false, titulo: `${posible.lluvia.texto} ${nombreDia(posible)}${cuando ? `, ${cuando}` : ''}`, detalle: 'Será poca cantidad; lleve paraguas si va a salir.' };
    }
    const posibleLeve = ds.find(x => x.lluvia.nivel === 'posible' && (x.dia.probMaxPct ?? 0) >= 40);
    if (posibleLeve) return { nivel: 'normal', sinDatos: false, titulo: `Podría caer un poco de lluvia ${nombreDia(posibleLeve)}`, detalle: 'Si va a salir, lleve paraguas por si acaso.' };
    const calor = ds.find(x => x.dia.tMaxC != null && x.dia.tMaxC >= u.calorAvisoC);
    if (calor) return { nivel: 'aviso', sinDatos: false, titulo: `Calor intenso ${nombreDia(calor)} (máxima de ${Math.round(calor.dia.tMaxC!)} °C)`, detalle: 'Tome agua con frecuencia y evite el sol directo entre las 12 y las 17 h.' };
    // Sin ninguna señal de riesgo: solo se dice "sin riesgos" si realmente hay datos de lluvia.
    if (ds.every(x => x.lluvia.nivel === 'sin_dato')) return { nivel: 'normal', sinDatos: true, titulo: 'Sin información suficiente de lluvia', detalle: 'Revise el cielo y tome precauciones si ve nubes oscuras.' };
    return { nivel: 'normal', sinDatos: false, titulo: 'Sin riesgos en las próximas 48 horas', detalle: 'No se esperan lluvias fuertes, viento fuerte, helada ni calor intenso.' };
}

export const SEMAFORO_LLANO: Record<NivelRiesgo | 'sin_dato', { texto: string; color: string; fondo: string; simbolo: string }> = {
    normal: { texto: 'SIN RIESGOS', color: '#166534', fondo: '#dcfce7', simbolo: '●' },
    aviso: { texto: 'PRECAUCIÓN', color: '#92400e', fondo: '#fef3c7', simbolo: '▲' },
    critico: { texto: 'PELIGRO', color: '#991b1b', fondo: '#fee2e2', simbolo: '■' },
    sin_dato: { texto: 'SIN DATOS', color: '#334155', fondo: '#e2e8f0', simbolo: '?' },
};

// ── Recomendaciones concretas ───────────────────────────────────────────────
export interface Recomendacion { icono: IconoClave; texto: string }

export function recomendaciones(d: DatosPronostico, u: UmbralesLlanos = umbralesLlanos(d)): Recomendacion[] {
    const ds = d.dias.map(x => describeDia(x, u));
    const out: Recomendacion[] = [];
    const hay = (f: (x: DiaLlano) => boolean) => ds.some(f);
    const hayViento = hay(x => vientoFuerte(x.viento?.nivel));
    const hayMuyFuerte = hay(x => x.lluvia.nivel === 'muy_fuerte' || x.viento?.nivel === 'muy_fuerte');

    if (hayMuyFuerte) out.push({ icono: 'alerta', texto: 'Evite salir si no es indispensable.' });
    if (hay(x => lluviaFuerte(x.lluvia.nivel))) {
        out.push({ icono: 'lluvia_fuerte', texto: 'No cruce arroyos, canales ni cruces de agua sobre el camino, aunque parezcan poco profundos.' });
        out.push({ icono: 'paraguas', texto: hayViento ? 'Use impermeable: con este viento el paraguas se voltea. Maneje despacio y con las luces encendidas.' : 'Lleve impermeable o paraguas. Maneje despacio y con las luces encendidas.' });
        out.push({ icono: 'rayo', texto: 'Si escucha truenos, resguárdese en un lugar cerrado. No se quede en campo abierto, bajo un árbol solo, ni junto a postes o cercas de alambre.' });
        out.push({ icono: 'alerta', texto: 'No se estacione ni acampe en arroyos o zonas bajas.' });
    } else if (hay(x => x.lluvia.nivel === 'moderada' || x.lluvia.nivel === 'ligera' || x.lluvia.nivel === 'llovizna')) {
        out.push({ icono: 'paraguas', texto: hayViento ? 'Lleve impermeable: con viento el paraguas se voltea.' : 'Lleve paraguas o impermeable si va a salir: puede llover en algún momento.' });
    }
    if (hayViento) {
        out.push({ icono: 'viento_fuerte', texto: 'Asegure o guarde objetos sueltos: macetas, láminas, lonas y anuncios.' });
        out.push({ icono: 'alerta', texto: 'No se detenga bajo árboles, postes ni estructuras débiles. El polvo irrita ojos y garganta: cúbrase y maneje despacio en carretera.' });
    }
    if (hay(x => x.dia.tMinC != null && x.dia.tMinC <= u.heladaAvisoC)) {
        out.push({ icono: 'frio', texto: 'Riesgo de helada: cubra las plantas sensibles, proteja a mascotas, niñas, niños y personas mayores, y no deje agua en tuberías ni mangueras expuestas.' });
    } else if (hay(x => x.dia.tMinC != null && x.dia.tMinC < 10)) {
        out.push({ icono: 'frio', texto: 'Las mañanas y las noches estarán frías: abríguese bien.' });
    }
    if (hay(x => x.dia.tMaxC != null && x.dia.tMaxC >= u.calorAvisoC)) {
        out.push({ icono: 'calor', texto: 'Tome agua con frecuencia, use ropa ligera y evite el sol de 12 a 17 h. Si hay mareo, piel seca o confusión, busque sombra y llame al 911.' });
    }
    if (ds.every(x => x.lluvia.nivel === 'sin_dato')) out.push({ icono: 'sin_dato', texto: 'Hoy no hay información de lluvia: si ve nubes oscuras o escucha truenos, tome precauciones.' });
    if (!out.length) out.push({ icono: 'ok', texto: 'No se esperan condiciones que requieran precauciones especiales.' });
    // Aviso permanente en un distrito de riego: los canales llevan corriente aunque no llueva.
    out.push({ icono: 'alerta', texto: 'Aunque no llueva, manténgase lejos de las orillas de los canales de riego y no intente cruzarlos: la corriente arrastra aunque parezca tranquila.' });
    return out;
}

/** Consejos para quien trabaja en el campo (Delicias es zona agrícola): solo los que aplican. */
export function consejosCampo(d: DatosPronostico, u: UmbralesLlanos = umbralesLlanos(d)): string[] {
    const ds = d.dias.map(x => describeDia(x, u));
    const out: string[] = [];
    if (ds.some(x => (x.dia.vientoMaxMs ?? 0) >= u.vientoAvisoMs)) out.push(`Con viento de ${kmh(u.vientoAvisoMs)} km/h o más conviene no regar con aspersores (los que lanzan agua al aire): el viento desvía el agua y se desperdicia.`);
    if (ds.some(x => (x.dia.lluviaMaxMm ?? 0) >= 5)) out.push('Si cae lluvia de 5 mm o más (5 litros por metro cuadrado), puede posponer el siguiente riego.');
    if (ds.some(x => (x.dia.lluviaMaxMm ?? 0) >= u.lluviaAvisoMm)) out.push('Antes de la lluvia fuerte, revise regaderas, tomas del canal y desagües para que el agua corra libre.');
    if (ds.some(x => x.dia.tMinC != null && x.dia.tMinC <= u.heladaAvisoC)) out.push('Con riesgo de helada, no riegue de noche y proteja los cultivos sensibles.');
    if (ds.some(x => x.dia.tMaxC != null && x.dia.tMaxC >= u.calorAvisoC)) out.push('Con calor intenso, trabaje temprano o al atardecer y programe los riegos de madrugada.');
    return out;
}

/** Resumen en 1-3 frases, reutilizable en el informe operativo ("En palabras sencillas"). */
export function resumenSencillo(d: DatosPronostico): string {
    const u = umbralesLlanos(d);
    const t = titularLlano(d, u);
    const ds = d.dias.map(x => describeDia(x, u));
    const partes = ds.slice(0, 3).map(x => {
        const temp = x.dia.tMinC != null && x.dia.tMaxC != null ? `entre ${grados(x.dia.tMinC)} y ${grados(x.dia.tMaxC)}` : 'temperatura sin información';
        const lluvia = llueveDeVerdad(x.lluvia.nivel) ? `${x.lluvia.texto.toLowerCase()} ${cuandoTexto(x.dia)}`.trim() : x.lluvia.nivel === 'sin_dato' ? 'sin información de lluvia' : 'sin lluvia';
        const cola = x.dia.parcial && x.dia.etiqueta !== 'Hoy' ? ` (solo hasta las ${hhmm(x.dia.hastaMs)} h)` : '';
        return `${x.dia.etiqueta}: ${x.cielo.texto.toLowerCase()}, ${temp}, ${lluvia}${cola}`;
    });
    return `${t.titulo}. ${partes.join('. ')}.`;
}

// ── Ilustraciones (SVG propio, sin dependencias) ────────────────────────────
const NUBE = 'M18 44h28a10 10 0 0 0 1.5-19.9A14 14 0 0 0 20.4 27 8.6 8.6 0 0 0 18 44z';
const sol = (cx: number, cy: number, r: number) => {
    const rayos = Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4, x1 = cx + Math.cos(a) * (r + 3), y1 = cy + Math.sin(a) * (r + 3), x2 = cx + Math.cos(a) * (r + 8), y2 = cy + Math.sin(a) * (r + 8);
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#f59e0b" stroke-width="3" stroke-linecap="round"/>`;
    }).join('');
    return `${rayos}<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fbbf24" stroke="#f59e0b" stroke-width="2"/>`;
};
const gotas = (xs: number[], y: number, color = '#2563eb') => xs.map(x => `<path d="M${x} ${y}l-3 8" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');

/** Los iconos son decorativos: el texto de al lado dice lo mismo, así que no se anuncian a lectores de pantalla. */
export function icono(clave: IconoClave, px = 64): string {
    const f = (inner: string) => `<svg viewBox="0 0 64 64" width="${px}" height="${px}" aria-hidden="true" focusable="false">${inner}</svg>`;
    switch (clave) {
        case 'sol': return f(sol(32, 32, 12));
        case 'sol_nube': return f(`${sol(24, 24, 9)}<path d="${NUBE}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2" transform="translate(2 4)"/>`);
        case 'nube': return f(`<path d="${NUBE}" fill="#cbd5e1" stroke="#64748b" stroke-width="2" transform="translate(0 4)"/>`);
        case 'lluvia': return f(`<path d="${NUBE}" fill="#cbd5e1" stroke="#64748b" stroke-width="2" transform="translate(0 -4)"/>${gotas([24, 34, 44], 46)}`);
        case 'lluvia_fuerte': return f(`<path d="${NUBE}" fill="#94a3b8" stroke="#475569" stroke-width="2" transform="translate(0 -6)"/>${gotas([20, 28, 36, 44], 42)}${gotas([24, 32, 40], 52)}`);
        case 'viento': return f(`<path d="M8 24h30a6 6 0 1 0-6-6M8 34h40a6 6 0 1 1-6 6M8 44h22" fill="none" stroke="#0ea5e9" stroke-width="4" stroke-linecap="round"/>`);
        case 'viento_fuerte': return f(`<path d="M6 22h32a7 7 0 1 0-7-7M6 33h44a7 7 0 1 1-7 7M6 44h24" fill="none" stroke="#0369a1" stroke-width="5.5" stroke-linecap="round"/>`);
        case 'frio': return f(`<g stroke="#0ea5e9" stroke-width="3.5" stroke-linecap="round"><path d="M32 8v48M10 20l44 24M10 44l44-24"/><path d="M26 12l6 5 6-5M26 52l6-5 6 5"/></g>`);
        case 'calor': return f(`<rect x="27" y="8" width="10" height="34" rx="5" fill="#fff" stroke="#dc2626" stroke-width="3"/><circle cx="32" cy="48" r="9" fill="#dc2626"/><rect x="30" y="22" width="4" height="26" fill="#dc2626"/>`);
        case 'paraguas': return f(`<path d="M8 32a24 20 0 0 1 48 0z" fill="#2563eb"/><path d="M32 32v18a5 5 0 0 1-10 0" fill="none" stroke="#1e293b" stroke-width="3.5" stroke-linecap="round"/>`);
        case 'rayo': return f(`<path d="M36 6L16 36h14l-4 22 22-32H33z" fill="#fbbf24" stroke="#b45309" stroke-width="2.5" stroke-linejoin="round"/>`);
        case 'alerta': return f(`<path d="M32 8L58 54H6z" fill="#fbbf24" stroke="#b45309" stroke-width="3" stroke-linejoin="round"/><path d="M32 24v14" stroke="#1e293b" stroke-width="5" stroke-linecap="round"/><circle cx="32" cy="46" r="3" fill="#1e293b"/>`);
        case 'ok': return f(`<circle cx="32" cy="32" r="24" fill="#22c55e"/><path d="M20 33l8 8 16-17" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
        case 'sin_lluvia': return f(`<path d="M32 10c9 13 14 20 14 27a14 14 0 0 1-28 0c0-7 5-14 14-27z" fill="#e0f2fe" stroke="#7dd3fc" stroke-width="2.5"/><path d="M12 54L52 12" stroke="#64748b" stroke-width="5" stroke-linecap="round"/>`);
        case 'campo': return f(`<path d="M6 50h52" stroke="#65a30d" stroke-width="4" stroke-linecap="round"/><path d="M18 50V30M18 36c-6-2-8-8-8-12 6 0 9 5 8 12zM18 40c6-2 8-8 8-12-6 0-9 5-8 12zM42 50V26M42 33c-7-2-9-9-9-13 7 0 10 5 9 13zM42 38c7-2 9-9 9-13-7 0-10 5-9 13z" fill="#84cc16" stroke="#4d7c0f" stroke-width="2" stroke-linecap="round"/>`);
        default: return f(`<path d="${NUBE}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="2" stroke-dasharray="4 3" transform="translate(0 4)"/><text x="32" y="38" text-anchor="middle" font-size="18" font-weight="700" fill="#64748b" font-family="system-ui">?</text>`);
    }
}

export type EscenaTipo = 'sol' | 'parcial' | 'nublado' | 'lluvia' | 'tormenta' | 'viento' | 'neutra';
/** Escena panorámica del distrito (cerros, parcelas y canal) según el tiempo dominante. Es ambientación, no información. */
export function escenaDistrito(tipo: EscenaTipo): string {
    const cielo: Record<EscenaTipo, [string, string]> = {
        sol: ['#38bdf8', '#e0f2fe'], parcial: ['#60a5fa', '#e0f2fe'], nublado: ['#94a3b8', '#e2e8f0'],
        lluvia: ['#64748b', '#cbd5e1'], tormenta: ['#334155', '#94a3b8'], viento: ['#38bdf8', '#e0f2fe'], neutra: ['#cbd5e1', '#f1f5f9'],
    };
    const [a, b] = cielo[tipo];
    const nube = (x: number, y: number, s: number, c: string) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="${NUBE}" fill="${c}" opacity="0.95"/></g>`;
    let cuerpo = '';
    if (tipo === 'sol') cuerpo = `<g transform="translate(690 60) scale(2.2)">${sol(0, 0, 12)}</g>`;
    if (tipo === 'parcial') cuerpo = `<g transform="translate(660 62) scale(1.9)">${sol(0, 0, 12)}</g>${nube(540, 30, 3.2, '#ffffff')}${nube(120, 50, 2.6, '#f8fafc')}`;
    if (tipo === 'nublado') cuerpo = `${nube(80, 20, 4, '#e2e8f0')}${nube(330, 36, 3.4, '#cbd5e1')}${nube(560, 14, 4.4, '#e2e8f0')}`;
    if (tipo === 'lluvia' || tipo === 'tormenta') {
        const c = tipo === 'tormenta' ? '#475569' : '#94a3b8';
        const lineas = Array.from({ length: 34 }, (_, i) => { const x = 20 + i * 24 + (i % 3) * 5; const y = 70 + (i % 4) * 14; return `<path d="M${x} ${y}l-6 20" stroke="#bfdbfe" stroke-width="2.4" stroke-linecap="round" opacity="0.85"/>`; }).join('');
        cuerpo = `${nube(40, 4, 4.6, c)}${nube(300, 18, 4.2, c)}${nube(560, 0, 4.8, c)}${lineas}`;
    }
    if (tipo === 'viento') cuerpo = `${nube(520, 36, 3, '#ffffff')}<path d="M60 50h150a14 14 0 1 0-14-14M30 80h210a14 14 0 1 1-14 14M90 110h110" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity="0.9"/>`;
    const surcos = Array.from({ length: 8 }, (_, i) => `<path d="M0 ${172 + i * 5}Q400 ${165 + i * 5} 800 ${174 + i * 5}" stroke="#4d7c0f" stroke-width="1.6" fill="none" opacity="0.55"/>`).join('');
    // El canal queda por encima de la franja que cubre el aviso (el banner se solapa unos px con la escena).
    return `<svg viewBox="0 0 800 240" width="100%" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="cielo-${tipo}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
      <rect width="800" height="240" fill="url(#cielo-${tipo})"/>
      ${cuerpo}
      <path d="M0 160L90 110 170 150 270 96 380 154 470 118 590 160 690 104 800 150V240H0z" fill="#a8a29e"/>
      <path d="M0 172L120 138 240 168 360 134 500 172 640 144 800 174V240H0z" fill="#84a98c"/>
      <rect y="168" width="800" height="72" fill="#a3d977"/>${surcos}
      <path d="M0 200Q200 186 400 198T800 190" stroke="#38bdf8" stroke-width="9" fill="none" stroke-linecap="round"/>
      <path d="M0 200Q200 186 400 198T800 190" stroke="#bae6fd" stroke-width="2.5" fill="none" stroke-dasharray="8 12"/>
    </svg>`;
}

export function escenaPara(d: DatosPronostico): EscenaTipo {
    const u = umbralesLlanos(d);
    const ds = d.dias.slice(0, 2).map(x => describeDia(x, u));
    if (ds.some(x => x.lluvia.nivel === 'muy_fuerte')) return 'tormenta';
    if (ds.some(x => x.lluvia.nivel === 'fuerte' || x.lluvia.nivel === 'moderada')) return 'lluvia';
    if (ds.some(x => vientoFuerte(x.viento?.nivel))) return 'viento';
    if (ds.some(x => x.lluvia.nivel === 'ligera' || x.lluvia.nivel === 'llovizna')) return 'nublado';
    const nub = ds[0]?.dia.nubMediaPct;
    if (nub == null) return 'neutra';          // sin dato de cielo: ni sol ni nubes por omisión
    return nub <= 25 ? 'sol' : nub <= 70 ? 'parcial' : 'nublado';
}

// ── HTML ────────────────────────────────────────────────────────────────────
const SRL_MARRON = '#6B2D2D';
const FMT_EMISION = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Chihuahua', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true });
const emisionTxt = (ms: number) => FMT_EMISION.format(new Date(ms)).replace(/\./g, '').replace(/\s+(am|pm)$/i, (_m, x: string) => ` ${x.toLowerCase() === 'am' ? 'a. m.' : 'p. m.'}`);

export interface OpcionesCiudadano {
    /** Versión angosta (una columna, sin glosario) pensada para compartir como imagen en el celular. */
    compacto?: boolean;
}

export async function construyeInformeCiudadanoHTML(d: DatosPronostico, op: OpcionesCiudadano = {}): Promise<string> {
    const [logoSrl, logoSica] = await Promise.all([assetToDataURI('/logos/logo-srl.png'), assetToDataURI('/logos/SICA005.png')]);
    const u = umbralesLlanos(d);
    const tit = titularLlano(d, u);
    const sem = SEMAFORO_LLANO[tit.sinDatos ? 'sin_dato' : tit.nivel];
    const ds = d.dias.map(x => describeDia(x, u));
    const recos = recomendaciones(d, u);
    const campo = consejosCampo(d, u);
    const cola = d.dias.length ? d.dias[d.dias.length - 1] : null;

    const tarjetas = ds.map(x => {
        const cortado = x.dia.parcial && x.dia.etiqueta !== 'Hoy';
        const fecha = x.dia.etiqueta === 'Hoy'
            ? `${esc(x.dia.fechaTxt)} · <em>de ahora en adelante</em>`
            : cortado ? `${esc(x.dia.fechaTxt)} · <em>solo hasta las ${hhmm(x.dia.hastaMs)} h</em>` : esc(x.dia.fechaTxt);
        const temp = x.dia.tMinC != null && x.dia.tMaxC != null
            ? `<div class="temp"><span class="tmin"><small>Mín</small>${Math.round(x.dia.tMinC)} °C</span><span class="tmax"><small>Máx</small>${Math.round(x.dia.tMaxC)} °C</span></div>${cortado ? '' : `<div class="sens">${esc(x.sensacion)}</div>`}`
            : `<div class="sens">Sin información de temperatura</div>`;
        const viento = x.viento ? `<li><span class="ic">${icono(vientoFuerte(x.viento.nivel) ? 'viento_fuerte' : 'viento', 26)}</span>${esc(x.viento.texto)}</li>` : '';
        const lluviaIc: IconoClave = x.lluvia.nivel === 'sin_dato' ? 'sin_dato' : !llueveDeVerdad(x.lluvia.nivel) ? 'sin_lluvia' : lluviaFuerte(x.lluvia.nivel) ? 'lluvia_fuerte' : 'lluvia';
        return `<article class="dia">
          <h2>${esc(x.dia.etiqueta)}</h2>
          <div class="fecha">${fecha}</div>
          <div class="icono">${icono(x.icono, 84)}</div>
          <div class="cielo">${esc(x.lineaCielo)}</div>
          ${temp}
          <ul class="datos">
            <li><span class="ic">${icono(lluviaIc, 26)}</span>${esc(x.fraseLluvia)}</li>
            ${viento}
          </ul>
        </article>`;
    }).join('');

    const filasReco = recos.map(r => `<li><span class="ic">${icono(r.icono, 44)}</span><span>${esc(r.texto)}</span></li>`).join('');
    const bloqueCampo = campo.length ? `<section class="caja campo"><h2><span class="ic">${icono('campo', 34)}</span> Si trabaja en el campo</h2><ul>${campo.map(c => `<li>${esc(c)}</li>`).join('')}</ul></section>` : '';

    // ¿Qué tan seguro es? — cifras reales de verificación, en palabras y contando DÍAS.
    const ver = d.verificacion;
    const temp06 = ver?.variables.find(v => v.variable === 'temperatura' && v.rango === '0-6 h');
    const ll = ver?.lluvia;
    const seguro = [
        temp06
            ? `La temperatura se pronostica con buena precisión: en las últimas semanas, a pocas horas de distancia, el pronóstico se desvió en promedio <b>${temp06.mae.toFixed(1)} °C</b>.`
            : 'La temperatura suele pronosticarse con buena precisión: el error típico es de pocos grados.',
        ll && ll.diasConLluviaObservada
            ? `Con la lluvia es más difícil: en las últimas semanas hubo <b>${ll.diasConLluviaObservada}</b> ${ll.diasConLluviaObservada === 1 ? 'día' : 'días'} con lluvia importante y el pronóstico avisó de <b>${ll.detectados}</b>. Puede fallar en <b>cuánta</b> lluvia cae y <b>en qué lugar</b>.`
            : 'Con la lluvia es más difícil: puede llover fuerte en un lugar y nada a pocos kilómetros.',
        'Las tormentas son muy locales. Si ve nubes oscuras o escucha truenos, tome precauciones aunque el pronóstico diga otra cosa.',
    ].map(t => `<li>${t}</li>`).join('');

    const aviso = d.modelo.vieja
        ? `<p class="stale">Aviso: este pronóstico tiene ${Math.round((d.modelo.edadCorridaMin ?? 0) / 60)} horas de antigüedad y puede haber cambiado.</p>` : '';
    const cobertura = cola?.parcial && cola.etiqueta !== 'Hoy'
        ? `hoy, mañana y pasado mañana (este último solo hasta las ${hhmm(cola.hastaMs)} h)` : 'hoy, mañana y pasado mañana';

    return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>El clima en Delicias — ${esc(getTodayString())}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #eef2f7; color: #0f172a; font: 17px/1.55 system-ui, -apple-system, 'Segoe UI', Arial, sans-serif; }
  .hoja { max-width: 900px; margin: 0 auto; background: #fff; }
  header { display: flex; align-items: center; gap: 14px; padding: 16px 22px; border-bottom: 4px solid ${SRL_MARRON}; }
  header img { height: 54px; width: auto; }
  header .t { flex: 1; text-align: center; }
  header .k { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: ${SRL_MARRON}; font-weight: 800; }
  header h1 { margin: 2px 0 0; font-size: 26px; line-height: 1.15; }
  .escena { line-height: 0; max-height: 240px; overflow: hidden; }
  .banner { margin: -14px 22px 0; position: relative; border-radius: 16px; padding: 16px 20px; border: 3px solid ${sem.color}; background: ${sem.fondo}; box-shadow: 0 6px 18px rgba(15,23,42,.15); }
  .banner .sem { font-size: 15px; font-weight: 900; letter-spacing: .12em; color: ${sem.color}; }
  .banner h2 { font-size: 28px; font-weight: 900; line-height: 1.15; margin: 4px 0; }
  .banner .detalle { font-size: 18px; margin: 0; }
  .oficiales { margin: 10px 22px 0; font-size: 15px; color: #334155; }
  .emision { margin: 6px 22px 0; font-size: 15px; color: #475569; }
  .stale { margin: 10px 22px 0; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 10px; padding: 8px 12px; font-size: 15px; }
  .caja { margin: 18px 22px 0; border-radius: 16px; padding: 16px 20px; border: 2px solid #e2e8f0; }
  .caja h2 { font-size: 24px; margin: 0 0 10px; }
  .caja ul { margin: 0; padding: 0; list-style: none; }
  .reco li { display: flex; gap: 12px; align-items: center; padding: 8px 0; border-top: 1px solid #f1f5f9; font-size: 18px; }
  .reco li:first-child { border-top: 0; }
  .dias { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 18px 22px 6px; }
  .dia { border: 2px solid #e2e8f0; border-radius: 16px; padding: 14px 14px 12px; text-align: center; background: #fff; }
  .dia h2 { margin: 0; font-size: 22px; }
  .dia .fecha { font-size: 15px; color: #475569; }
  .dia .icono { margin: 6px 0 2px; line-height: 0; }
  .dia .cielo { font-weight: 800; font-size: 18px; }
  .dia .temp { display: flex; justify-content: center; gap: 18px; font-size: 30px; font-weight: 900; line-height: 1.1; margin-top: 6px; }
  .dia .temp small { display: block; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #475569; }
  .dia .tmin { color: #1d4ed8; } .dia .tmax { color: #b91c1c; }
  .dia .sens { font-size: 15px; color: #475569; margin-bottom: 4px; }
  ul.datos { list-style: none; margin: 8px 0 0; padding: 0; text-align: left; font-size: 15.5px; }
  ul.datos li { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; border-top: 1px solid #f1f5f9; }
  .ic { display: inline-block; flex: none; line-height: 0; }
  .campo { background: #f7fee7; border-color: #bef264; } .campo li { padding: 5px 0 5px 4px; font-size: 17px; }
  .campo h2 { display: flex; align-items: center; gap: 10px; }
  .campo ul { list-style: disc; padding-left: 22px; }
  .seguro { background: #f8fafc; } .seguro ul { list-style: disc; padding-left: 22px; } .seguro li { margin: 5px 0; font-size: 16.5px; }
  .glosario { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; font-size: 15px; }
  .glosario div { background: #f1f5f9; border-radius: 12px; padding: 10px 12px; }
  .glosario b { display: block; margin-bottom: 2px; }
  .oficial { margin: 18px 22px 0; border-radius: 14px; padding: 14px 18px; background: #fef2f2; border: 2px solid #fecaca; font-size: 16px; }
  footer { margin-top: 20px; padding: 14px 22px 20px; border-top: 1px solid #e2e8f0; font-size: 14px; color: #475569; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  @media screen and (max-width: 720px) { .dias, .glosario { grid-template-columns: 1fr; } header h1 { font-size: 21px; } .banner h2 { font-size: 23px; } }
  /* Versión para imagen compartible: una columna angosta que se lee en el celular sin ampliar. */
  .compacto .hoja { max-width: 540px; } .compacto .dias, .compacto .glosario { grid-template-columns: 1fr; }
  .compacto header h1 { font-size: 22px; } .compacto .banner h2 { font-size: 24px; } .compacto .escena { max-height: 150px; }
  @media print {
    body { background: #fff; } .hoja { max-width: none; } @page { size: A4; margin: 10mm; }
    .dias { grid-template-columns: repeat(3, 1fr) !important; } .glosario { grid-template-columns: repeat(3, 1fr) !important; }
    .escena { max-height: 90px; }
    .dia, .caja, .oficial, .campo, footer { break-inside: avoid; } h2 { break-after: avoid; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style></head><body class="${op.compacto ? 'compacto' : ''}"><div class="hoja">
<header>
  ${logoSica ? `<img src="${logoSica}" alt="SICA 005">` : ''}
  <div class="t"><div class="k">SRL Unidad Conchos · Delicias, Chihuahua</div><h1>¿Cómo estará el clima?</h1></div>
  ${logoSrl ? `<img src="${logoSrl}" alt="SRL Unidad Conchos">` : ''}
</header>
<div class="escena">${escenaDistrito(escenaPara(d))}</div>
<section class="banner" aria-label="Aviso principal">
  <div class="sem">${sem.simbolo} ${sem.texto}</div>
  <h2>${esc(tit.titulo)}</h2>
  <p class="detalle">${esc(tit.detalle)}</p>
</section>
<p class="oficiales"><b>Avisos oficiales:</b> Protección Civil (911) y Servicio Meteorológico Nacional.</p>
<p class="emision">Actualizado el ${esc(emisionTxt(d.generadoMs))} (hora de Chihuahua). Pronóstico para Delicias y su zona de riego: ${esc(cobertura)}.</p>
${aviso}

<section class="caja reco" style="border-color:${sem.color}"><h2>¿Qué hago?</h2><ul>${filasReco}</ul></section>
<section class="dias" aria-label="Pronóstico por día">${tarjetas}</section>
${bloqueCampo}

<section class="caja seguro"><h2>¿Qué tan seguro es el pronóstico?</h2><ul>${seguro}</ul></section>

${op.compacto ? '' : `<section class="caja"><h2>Para entender mejor</h2>
  <div class="glosario">
    <div><b>Probabilidad de lluvia</b>Qué tan posible es que llueva en algún punto de la zona. "70 de cada 100" no significa que llueva 70 % del día.</div>
    <div><b>Milímetros (mm) de lluvia</b>1 mm equivale a 1 litro de agua por cada metro cuadrado. Más de 10 mm en un día ya es lluvia fuerte para la región.</div>
    <div><b>Viento en km/h</b>Hasta 20 km/h es brisa. De 20 a 35 km/h ya se nota y levanta polvo. Desde 36 km/h es viento fuerte y desde 54 km/h, muy fuerte.</div>
  </div>
</section>`}

<div class="oficial"><b>Importante:</b> este informe es una orientación de la SRL Unidad Conchos. <b>No sustituye</b> los avisos oficiales de Protección Civil ni del Servicio Meteorológico Nacional. Ante una emergencia, llame al 911 y siga sus indicaciones.</div>
<footer>
  <span>SICA 005 · SRL Unidad Conchos · Distrito de Riego 005 Delicias</span>
  <span>Pronóstico de modelo (${esc(d.modelo.proveedor)}), verificado con las estaciones de la red</span>
</footer>
</div></body></html>`;
}

// ── Salidas ─────────────────────────────────────────────────────────────────
export async function descargarInformeCiudadano(d: DatosPronostico): Promise<void> {
    const html = await construyeInformeCiudadanoHTML(d);
    await guardaOComparte(new Blob([html], { type: 'text/html;charset=utf-8;' }), `clima-delicias-${getTodayString()}.html`, 'text/html');
}

/**
 * PNG para compartir por mensajería o redes. Se genera en versión angosta (540 px, una columna): un ancho de
 * 900 px se reduce a ~43 % en un celular y el texto de 15-17 px queda ilegible.
 */
export async function imagenInformeCiudadano(d: DatosPronostico): Promise<void> {
    const html = await construyeInformeCiudadanoHTML(d, { compacto: true });
    const png = await rasterizaHtml(html, { ancho: 540, escala: 3 });
    await guardaOComparte(png, `clima-delicias-${getTodayString()}.png`, 'image/png');
}

export async function imprimirInformeCiudadano(d: DatosPronostico): Promise<void> {
    const html = await construyeInformeCiudadanoHTML(d);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8;' }));
    const ventana = window.open(url, '_blank');
    if (!ventana) { URL.revokeObjectURL(url); throw new Error('El navegador bloqueó la ventana de impresión. Habilita ventanas emergentes para este sitio.'); }
    const imprime = () => { ventana.print(); setTimeout(() => URL.revokeObjectURL(url), 30000); };
    if (ventana.document.readyState === 'complete') imprime(); else ventana.addEventListener('load', imprime, { once: true });
}
