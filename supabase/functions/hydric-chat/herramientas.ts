/**
 * herramientas — datos que el modelo consulta por tool use. Todo se calcula aquí, de forma determinista y con la
 * regla "S/D nunca cero"; el modelo lee resultados, no hace aritmética. Cada herramienta devuelve además TARJETAS
 * estructuradas (tablas) que la interfaz pinta junto a la respuesta. Módulo PURO.
 *
 * Si una consulta de la que depende la herramienta falló, el resultado lleva `datos_incompletos` y la tarjeta una
 * nota: una lista vacía por un fallo NO debe leerse como "no hay datos".
 */
import { balanceTramos, resumenBalance, type EscalaQ, type Toma } from './balance.ts';
import { esEscalaReferencia, fallosDe, fmt, fmtFechaDia, nombreFallo, num, type FilaPerfil, type Snapshot } from './contexto.ts';

export interface Tarjeta {
    kind: 'presas' | 'escalas' | 'balance' | 'almacenamiento' | 'modulos' | 'transito';
    titulo: string;
    columnas: string[];
    filas: Array<Array<string | number | null>>;
    nota?: string;
}
export interface ResultadoHerramienta { contenido: Record<string, unknown>; tarjetas: Tarjeta[] }

export interface DefinicionHerramienta { name: string; description: string; estado: string }

/** `estado` es el texto del indicador de pasos en la interfaz. */
export const HERRAMIENTAS: DefinicionHerramienta[] = [
    { name: 'consultar_presas', estado: 'Leyendo presas…', description: 'Estado de las presas (La Boquilla, Fco. I. Madero): elevación, almacenamiento, % de llenado, extracción, fecha de lectura y si está vigente. Úsala para cualquier pregunta de almacenamiento o disponibilidad.' },
    { name: 'consultar_escalas', estado: 'Leyendo escalas del canal…', description: 'Las 14 escalas del canal (Km 0–104): nivel, nivel aguas abajo, gasto, aperturas de compuertas radiales, antigüedad de la lectura y su estado (vigente, vencida, arrastre, sd). Distingue escalas de referencia.' },
    { name: 'consultar_balance_canal', estado: 'Calculando balance por tramo…', description: 'Balance de masa por tramo entre escalas de control consecutivas ya calculado (entrada, salida, tomas, pérdida, eficiencia, estado) y las tomas activas hoy. Indica si el balance de riego aplica según el modo operativo y si las tomas se conocen.' },
    { name: 'consultar_almacenamiento_canal', estado: 'Leyendo volúmenes del canal…', description: 'Volumen almacenado en el canal por zona (Z1–Z4) y entre represas consecutivas, con % de llenado, tirante de diseño y capacidad (y_capacidad_m).' },
    { name: 'consultar_modulos', estado: 'Leyendo módulos y entregas…', description: 'Módulos de riego: volumen autorizado vs entregado del ciclo (fuente oficial), saldo, remanente, balance base/adicional por zona y entregas declaradas por módulo y zona.' },
    { name: 'consultar_perfil_canal', estado: 'Leyendo perfil hidráulico…', description: 'Perfil hidráulico por tramo (plantilla, talud, pendiente, Qmax, velocidad, tirante y bordo libre de diseño) y tiempos de tránsito acumulados desde el Km 0.' },
];

const r3 = (v: number | null) => (v == null ? null : Number(v.toFixed(3)));

/** Añade el aviso de datos incompletos al contenido y a la primera tarjeta cuando una consulta de la herramienta falló. */
function conAviso(r: ResultadoHerramienta, s: Snapshot, herramienta: string): ResultadoHerramienta {
    const fallos = fallosDe(s, herramienta);
    if (fallos.length === 0) return r;
    const texto = `Datos incompletos: no se pudo leer ${fallos.map((f) => nombreFallo(f.replace(' (truncada)', '')) + (f.endsWith('(truncada)') ? ' (truncado)' : '')).join('; ')}. Lo que falta es S/D, no cero.`;
    return {
        contenido: { ...r.contenido, datos_incompletos: fallos, aviso: texto },
        tarjetas: r.tarjetas.map((t, i) => (i === 0 ? { ...t, nota: [texto, t.nota].filter(Boolean).join(' ') } : t)),
    };
}

interface TomasLeidas { tomas: Toma[]; descartadas: number; disponibles: boolean }
function tomasDe(s: Snapshot): TomasLeidas {
    const out: Toma[] = [];
    let descartadas = 0;
    for (const t of s.crudos.tomas) {
        const km = num(t.puntos_entrega?.km), q = num(t.caudal_promedio);
        if (km == null || q == null || q <= 0) { descartadas++; continue; }   // sin km o sin caudal: no es una toma activa ni suma 0
        out.push({ nombre: t.puntos_entrega?.nombre || 'Toma', km, caudal: q });
    }
    // Sin reportes del día (o con la consulta caída) las tomas son DESCONOCIDAS, no cero.
    const disponibles = !s.crudos.fallos.includes('tomas_activas') && s.crudos.tomas.length > 0;
    return { tomas: out, descartadas, disponibles };
}

function presas(s: Snapshot): ResultadoHerramienta {
    return {
        contenido: {
            presas: s.presas,
            nota: 'extraccion_m3s null = S/D (sin medición). estado "vencida" = lectura de hace más de 36 h.',
        },
        tarjetas: [{
            kind: 'presas', titulo: 'Presas',
            columnas: ['Presa', 'Llenado %', 'Almacenamiento Mm³', 'Elevación msnm', 'Extracción m³/s', 'Lectura'],
            filas: s.presas.map((p) => [p.corto || p.nombre, p.llenado_pct, p.almacenamiento_mm3, p.elevacion_msnm, p.extraccion_m3s,
                p.estado === 'sd' ? 'S/D' : `${p.fecha}${p.estado === 'vencida' ? ' (vencida)' : ''}`]),
        }],
    };
}

function escalas(s: Snapshot): ResultadoHerramienta {
    const etiqueta = (e: Snapshot['escalas'][number]) =>
        e.estado === 'vigente' ? `vigente (${e.edad_min} min)` : e.estado === 'vencida' ? `vencida (${e.edad_min} min)` : e.estado === 'arrastre' ? 'arrastre (no es medición)' : 'sin dato';
    return {
        contenido: {
            resumen: s.resumenEscalas,
            escalas: s.escalas.map((e) => ({
                nombre: e.nombre, km: e.km, referencia: e.referencia, estado: e.estado, lectura: e.lectura, edad_min: e.edad_min,
                nivel_m: e.nivel_m, nivel_abajo_m: e.nivel_abajo_m, carga_m: e.carga_m, gasto_m3s: e.gasto_m3s,
                aperturas_m: e.aperturas_m, pzas_radiales: e.pzas_radiales, ancho_m: e.ancho_m, alto_m: e.alto_m,
                nivel_arrastrado_m: e.nivel_arrastrado_m,
            })),
            nota: 'null = S/D. nivel_arrastrado_m es continuidad automática de medianoche, NO una medición. Las escalas de referencia no tienen gasto.',
        },
        tarjetas: [{
            kind: 'escalas', titulo: 'Escalas del canal',
            columnas: ['Escala', 'Km', 'Nivel m', 'Gasto m³/s', 'Lectura', 'Estado'],
            filas: s.escalas.map((e) => [e.nombre, e.km, e.nivel_m, e.referencia ? 'referencia' : e.gasto_m3s, e.lectura, etiqueta(e)]),
            nota: s.resumenEscalas.arrastre > 0 ? `${s.resumenEscalas.arrastre} escala(s) solo con arrastre de continuidad: no es medición.` : undefined,
        }],
    };
}

const TEXTO_ESTADO: Record<string, string> = {
    sin_dato: 'S/D', tomas_sd: 'Tomas S/D', no_aplica: 'No aplica (vaciado)', optimo: 'optimo', atencion: 'atencion', alerta: 'alerta',
    critico: 'critico', anomalo: 'anomalo', cerrado: 'cerrado',
};

function balance(s: Snapshot): ResultadoHerramienta {
    const escalasQ: EscalaQ[] = s.escalas.map((e) => ({
        nombre: e.nombre, km: e.km, referencia: e.referencia,
        // Solo una medición vigente entra al balance; vencida/arrastre/sd = sin dato (nunca 0).
        gasto: e.estado === 'vigente' ? e.gasto_m3s : null,
    }));
    const t = tomasDe(s);
    const aplica = s.operacion.balance_aplica;
    let tramos = balanceTramos(escalasQ, t.disponibles ? t.tomas : null);
    // Con el balance de riego inaplicable (vaciado / ciclo cerrado) los tramos no se clasifican como fugas.
    if (aplica === false) tramos = tramos.map((x) => ({ ...x, estado: 'no_aplica' as const }));

    const k104 = [...s.escalas].filter((e) => !e.referencia).sort((a, b) => b.km - a.km)[0];
    const notas: string[] = [];
    if (aplica === false) notas.push('El canal está en VACIADO o el ciclo está cerrado: no hay gasto de entrada de riego y este balance NO aplica como diagnóstico de conducción.');
    if (aplica === null) notas.push('No se pudo determinar el modo operativo (consulta fallida): interpreta el balance con reserva.');
    if (!t.disponibles) notas.push('No hay reportes de tomas del día (o la consulta falló): Q_tomas es S/D, no cero. Sin tomas solo se afirma la cota inferior de eficiencia; "q_tomas_mas_perdidas" es tomas + pérdidas, NO una pérdida.');
    if (t.descartadas > 0) notas.push(`${t.descartadas} toma(s) sin km o sin caudal se descartaron.`);
    if (tramos.length === 0) {
        notas.push(fallosDe(s, 'consultar_balance_canal').some((f) => f === 'catalogo_escalas' || f === 'lecturas_escalas')
            ? 'No se pudo armar el balance: faltan escalas por una consulta fallida.'
            : 'Hay menos de dos escalas de control: no hay tramos que balancear.');
    } else if (tramos.every((x) => x.estado === 'sin_dato')) {
        notas.push('Ningún tramo tiene medición vigente en ambos extremos.');
    }
    const nota = notas.join(' ') || undefined;

    return {
        contenido: {
            balance_aplica: aplica,
            modo_operativo: s.operacion.modo,
            tomas_conocidas: t.disponibles,
            tramos,
            resumen: resumenBalance(tramos),
            tomas_activas_hoy: t.disponibles ? t.tomas.map((x) => ({ nombre: x.nombre, km: x.km, caudal_m3s: x.caudal })) : null,
            salida_sistema: k104 ? { escala: k104.nombre, km: k104.km, estado: k104.estado, gasto_m3s: k104.estado === 'vigente' ? k104.gasto_m3s : null, nota: 'Entrega comprometida aguas abajo: no es pérdida ni excedente.' } : null,
            nota,
        },
        tarjetas: [{
            kind: 'balance', titulo: 'Balance por tramo',
            columnas: ['Tramo', 'Q entrada', 'Q salida', 'Tomas', 'Pérdida', 'Eficiencia %', 'Estado'],
            filas: tramos.map((x) => [`${x.de} → ${x.a}`, x.q_entrada, x.q_salida, x.q_tomas, x.q_perdidas, x.eficiencia, TEXTO_ESTADO[x.estado] ?? x.estado]),
            nota,
        }],
    };
}

function almacenamiento(s: Snapshot): ResultadoHerramienta {
    const zonas = s.crudos.zonas.map((z) => ({
        zona: z.codigo ?? 'S/D', km_inicio: num(z.km_inicio), km_fin: num(z.km_fin), nivel_medio_m: r3(num(z.nivel_medio_m)),
        tirante_diseno_m: r3(num(z.tirante_diseno_m)), bordo_libre_m: r3(num(z.bordo_libre_m)), y_capacidad_m: r3(num(z.y_capacidad_m)),
        vol_actual_mm3: r3(num(z.vol_actual_mm3)), vol_capacidad_mm3: num(z.vol_capacidad_m3) == null ? null : r3((num(z.vol_capacidad_m3) as number) / 1e6),
        llenado_pct: num(z.pct_llenado),
    }));
    // La vista parte los tramos en K-64 y K-94+200 (escalas de referencia, que NO cortan tramos): se marcan para no
    // leer esos subtotales como tramos reales.
    const entre = s.crudos.interescalas.map((v) => {
        const up = num(v.km_up), down = num(v.km_down);
        return {
            km_up: up, km_down: down, nivel_up_m: num(v.nivel_up_m), nivel_down_m: num(v.nivel_down_m), vol_m3: num(v.vol_m3), vol_mm3: num(v.vol_mm3),
            toca_referencia: esEscalaReferencia(null, up) || esEscalaReferencia(null, down),
        };
    });
    return {
        contenido: {
            zonas,
            entre_represas: entre,
            nota: 'Volúmenes calculados con perfil trapecial y el último nivel registrado (puede ser arrastre de continuidad): no re-derivar con Manning. Los tramos con toca_referencia=true terminan en K-64 o K-94+200, que NO son represas: sus subtotales son parciales de un tramo real.',
        },
        tarjetas: [{
            kind: 'almacenamiento', titulo: 'Almacenamiento por zona',
            columnas: ['Zona', 'Km', 'Nivel medio m', 'Vol. actual Mm³', 'Capacidad Mm³', 'Llenado %'],
            filas: zonas.map((z) => [z.zona, `${fmt(z.km_inicio, 0)}–${fmt(z.km_fin, 0)}`, z.nivel_medio_m, z.vol_actual_mm3, z.vol_capacidad_mm3, z.llenado_pct]),
        }],
    };
}

function modulos(s: Snapshot): ResultadoHerramienta {
    const cicloId = s.crudos.ciclo?.id ?? null;
    // Fuente oficial del volumen por módulo: la vista volumen_ciclo_modulo (modulos.vol_acumulado quedó obsoleto en 0).
    const delCiclo = s.crudos.volumenCiclo.filter((v) => cicloId == null || v.ciclo_id === cicloId);
    const caudalMax = (codigo: string | null | undefined) => {
        const m = s.crudos.modulos.find((x) => x.codigo_corto === codigo);
        // Solo la autorización del ciclo vigente: sin coincidencia es S/D, nunca la de otro ciclo.
        const auth = cicloId ? m?.autorizaciones_ciclo?.find((a) => a.ciclo_id === cicloId) : undefined;
        return num(auth?.caudal_max);
    };
    const mods = delCiclo
        .map((v) => ({
            modulo: v.codigo_corto || v.modulo_nombre || 'S/D', numero: num(v.numero_modulo),
            autorizado_miles_m3: num(v.vol_autorizado_miles_m3), entregado_miles_m3: num(v.vol_entregado_miles_m3),
            de_ellos_remanente_miles_m3: num(v.vol_remanente_miles_m3), saldo_miles_m3: num(v.vol_saldo_miles_m3),
            pct_entregado: num(v.pct_entregado), meses_con_dato: num(v.meses_con_dato), ultimo_mes: v.ultimo_mes_hoja ?? null,
            remanente_del: v.remanente_desde ? fmtFechaDia(v.remanente_desde) : null, remanente_al: v.remanente_hasta ? fmtFechaDia(v.remanente_hasta) : null,
            caudal_max_m3s: caudalMax(v.codigo_corto),
        }))
        .sort((a, b) => (a.numero ?? 999) - (b.numero ?? 999));
    const completos = mods.length > 0 && mods.every((m) => m.autorizado_miles_m3 != null && m.entregado_miles_m3 != null);
    const total = completos ? {
        autorizado_miles_m3: r3(mods.reduce((a, m) => a + (m.autorizado_miles_m3 as number), 0)),
        entregado_miles_m3: r3(mods.reduce((a, m) => a + (m.entregado_miles_m3 as number), 0)),
    } : null;

    const entregas = s.crudos.entregas.map((e) => ({
        modulo_id: e.modulo_id ?? 'S/D', zona_id: e.zona_id ?? null, tipo: e.tipo_entrega ?? 'S/D', gasto_m3s: num(e.gasto_m3s), volumen_m3: num(e.volumen_m3),
        fecha: fmtFechaDia(e.fecha), es_de_hoy: (e.fecha ?? '').slice(0, 10) === s.hoy,
    }));
    const bm = s.crudos.balanceModulos.map((b) => ({
        zona: b.zona_codigo ?? 'S/D', modulo: b.codigo_corto || b.modulo_nombre || 'S/D', estado: b.estado_volumen ?? 'S/D',
        base_mm3: r3(num(b.vol_base_m3) == null ? null : (num(b.vol_base_m3) as number) / 1e6),
        usado_mm3: r3(num(b.vol_base_consumido_m3) == null ? null : (num(b.vol_base_consumido_m3) as number) / 1e6),
        adicional_mm3: r3(num(b.vol_adicional_consumido_m3) == null ? null : (num(b.vol_adicional_consumido_m3) as number) / 1e6),
        pct_base_consumido: num(b.pct_base_consumido),
    }));
    const nota = 'Volúmenes en miles de m³ (1 miles de m³ = 1,000 m³). Fuente oficial: volumen_ciclo_modulo. "entregado" ya incluye el remanente del cierre. ' +
        'balance_base_adicional: un módulo multizona (p. ej. M2, M12) puede tener varias filas por zona que son capturas PARCIALES: no sumar entre zonas ni mezclar con el total del ciclo. ' +
        (s.operacion.ciclo?.vencido ? 'El ciclo ya cerró: son cifras finales.' : '');
    return {
        contenido: { ciclo: s.operacion.ciclo, modulos: mods, total, balance_base_adicional: bm, entregas_recientes: entregas, nota },
        tarjetas: [{
            kind: 'modulos', titulo: 'Módulos — volumen del ciclo',
            columnas: ['Módulo', 'Autorizado (miles m³)', 'Entregado (miles m³)', 'Saldo (miles m³)', '% entregado'],
            filas: mods.map((m) => [m.modulo, m.autorizado_miles_m3, m.entregado_miles_m3, m.saldo_miles_m3, m.pct_entregado]),
            nota: s.operacion.ciclo?.vencido ? 'El ciclo ya cerró: son cifras finales del ciclo.' : undefined,
        }],
    };
}

export function transitoAcumulado(perfil: FilaPerfil[]) {
    const ordenado = [...perfil].sort((a, b) => (num(a.km_inicio) ?? 0) - (num(b.km_inicio) ?? 0));
    let acum: number | null = 0;
    return ordenado.map((t) => {
        const ini = num(t.km_inicio), fin = num(t.km_fin), v = num(t.velocidad_diseno_ms);
        const tMin = ini != null && fin != null && v != null && v > 0 ? Math.round(((fin - ini) * 1000) / v / 60) : null;
        acum = acum != null && tMin != null ? acum + tMin : null;   // un tramo sin velocidad corta el acumulado (S/D)
        return {
            km_inicio: ini, km_fin: fin, tramo: t.nombre_tramo ?? '', plantilla_m: num(t.plantilla_m), talud_z: num(t.talud_z), pendiente_s0: num(t.pendiente_s0),
            qmax_m3s: num(t.capacidad_diseno_m3s), velocidad_ms: v, tirante_diseno_m: num(t.tirante_diseno_m), bordo_libre_m: num(t.bordo_libre_m),
            t_tramo_min: tMin, t_acum_min: acum,
        };
    });
}

const hhmm = (min: number | null) => (min == null ? 'S/D' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);

function perfil(s: Snapshot): ResultadoHerramienta {
    const filas = transitoAcumulado(s.crudos.perfil);
    return {
        contenido: { tramos: filas, nota: 'Tránsito entre Ka y Kb = t_acum(Kb) − t_acum(Ka). t = L / velocidad de diseño. null = S/D.' },
        tarjetas: [{
            kind: 'transito', titulo: 'Tránsito acumulado desde el Km 0',
            columnas: ['Tramo (Km)', 'Qmax m³/s', 'Velocidad m/s', 'Tránsito h:mm', 'Acumulado h:mm'],
            filas: filas.map((t) => [`${fmt(t.km_inicio, 1)}–${fmt(t.km_fin, 1)}`, t.qmax_m3s, t.velocidad_ms, hhmm(t.t_tramo_min), hhmm(t.t_acum_min)]),
        }],
    };
}

const MANEJADORES: Record<string, (s: Snapshot) => ResultadoHerramienta> = {
    consultar_presas: presas,
    consultar_escalas: escalas,
    consultar_balance_canal: balance,
    consultar_almacenamiento_canal: almacenamiento,
    consultar_modulos: modulos,
    consultar_perfil_canal: perfil,
};

/** `error: true` solo para herramientas desconocidas: llm.ts lo devuelve como tool_result con is_error. */
export function ejecutaHerramienta(nombre: string, s: Snapshot): ResultadoHerramienta & { error?: boolean } {
    const f = MANEJADORES[nombre];
    if (!f) return { contenido: { error: `Herramienta desconocida: ${nombre}` }, tarjetas: [], error: true };
    return conAviso(f(s), s, nombre);
}

/** Respaldo sin tool use (Groq): TODOS los datos en texto compacto dentro del prompt. */
export function volcadoCompleto(s: Snapshot): string {
    const partes = HERRAMIENTAS.map((h) => `### ${h.name}\n${JSON.stringify(ejecutaHerramienta(h.name, s).contenido)}`);
    return `=== DATOS DEL SISTEMA (equivalentes a las herramientas de consulta) ===\n${partes.join('\n\n')}`;
}
