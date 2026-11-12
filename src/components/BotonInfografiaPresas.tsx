import { useState } from 'react';
import { ImageDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { cargarIndiceHistorico } from '../hooks/usePresasHistorico';
import type { PresaData } from '../hooks/usePresas';
import type { PresaId } from '../utils/historicoPresas';
import { procedenciaNivel } from '../utils/presaMetrics';
import { construirDatosInfografia, type EntradaPresaInfografia, type LecturaCilaInf, type OrigenInfografia } from '../utils/infografiaPresas';
import { ANCHO_INFOGRAFIA, htmlInfografiaPresas } from '../utils/infografiaPresasHtml';
import { rasterizaHtml } from '../utils/rasterizaHtml';
import { cargarLogoSicaInforme, cargarLogoSrlInforme } from '../utils/logosInforme';
import { guardaOComparte } from '../utils/descargaArchivo';
import { Boton, Modal } from './ui/base';
import { confirmarConCila, GLIFO_CONFIRMACION, type Confirmacion } from '../utils/confirmacionCila';
import { CAPACIDAD_FIJA_MM3 } from '../utils/seguimientoPresas';

const PRESAS_INFOGRAFIA: PresaId[] = ['PRE-001', 'PRE-002'];
/** Nombres oficiales del encabezado (la plantilla rotula "(Las Vírgenes)" en Madero). */
const NOMBRE_ENCABEZADO: Record<PresaId, string> = { 'PRE-001': 'La Boquilla', 'PRE-002': 'Francisco I. Madero' };
const CLAVE_SEGUIMIENTO: Record<PresaId, string> = { 'PRE-001': 'boquilla', 'PRE-002': 'madero' };

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

interface FilaCila { presa_id: string; fecha: string; almacenamiento_mm3: unknown; pct_conservacion: unknown; cap_conservacion_mm3: unknown; archivo_last_modified: string | null }
interface FilaSeg { clave: string; fecha: string; hora: string | null; almacenamiento_mm3: unknown; elevacion_msnm: unknown; extraccion_m3s: unknown; namo_mm3: unknown }
interface FilaLect { presa_id: string; fecha: string; almacenamiento_mm3: unknown }

const aLectura = (f: FilaCila): LecturaCilaInf => ({
    fecha: f.fecha, almacenamiento_mm3: num(f.almacenamiento_mm3), pct_conservacion: num(f.pct_conservacion),
    cap_conservacion_mm3: num(f.cap_conservacion_mm3), archivo_last_modified: f.archivo_last_modified,
});

// Las tablas seguimiento_presas aún no están en los tipos generados de Supabase.
interface ConsultaLibre<T> extends PromiseLike<{ data: T[] | null; error: { message: string } | null }> {
    select: (c: string) => ConsultaLibre<T>; in: (c: string, v: string[]) => ConsultaLibre<T>; lt: (c: string, v: string) => ConsultaLibre<T>;
    order: (c: string, o: { ascending: boolean }) => ConsultaLibre<T>; limit: (n: number) => ConsultaLibre<T>;
}
const sb = <T,>(t: string) => (supabase as unknown as { from: (t: string) => ConsultaLibre<T> }).from(t);

interface Insumos {
    cila: FilaCila[]; seg: FilaSeg[]; lect: FilaLect[];
    /** Por presa: la lectura de cada fuente del día más reciente y su contraste. */
    resumen: { id: PresaId; captura: { fecha: string; hora: string | null; mm3: number } | null; cila: { fecha: string; mm3: number } | null; confirmacion: Confirmacion }[];
}

async function cargar(): Promise<Insumos> {
    const [c, s, l] = await Promise.all([
        sb<FilaCila>('lecturas_presas_cila').select('presa_id, fecha, almacenamiento_mm3, pct_conservacion, cap_conservacion_mm3, archivo_last_modified').in('presa_id', PRESAS_INFOGRAFIA).order('fecha', { ascending: false }).limit(8),
        sb<FilaSeg>('seguimiento_presas').select('clave, fecha, hora, almacenamiento_mm3, elevacion_msnm, extraccion_m3s, namo_mm3').in('clave', Object.values(CLAVE_SEGUIMIENTO)).order('fecha', { ascending: false }).limit(8),
        sb<FilaLect>('lecturas_presas').select('presa_id, fecha, almacenamiento_mm3').in('presa_id', PRESAS_INFOGRAFIA).order('fecha', { ascending: false }).limit(12),
    ]);
    if (c.error) throw new Error('No se pudo leer el reporte CILA.');
    const cila = c.data ?? [], seg = s.error ? [] : (s.data ?? []), lect = l.error ? [] : (l.data ?? []); // sin captura la infografía CILA sigue funcionando
    const resumen: Insumos['resumen'] = PRESAS_INFOGRAFIA.map((id) => {
        const sg = seg.find((x) => x.clave === CLAVE_SEGUIMIENTO[id]);
        // La captura se contrasta con el CILA de SU MISMO día; si no existe, queda pendiente.
        const cm = sg ? cila.find((x) => x.presa_id === id && x.fecha === sg.fecha) : undefined;
        const ultCila = cila.find((x) => x.presa_id === id);
        const cap = CAPACIDAD_FIJA_MM3[id] ?? num(cm?.cap_conservacion_mm3) ?? num(sg?.namo_mm3);
        return {
            id,
            captura: sg && num(sg.almacenamiento_mm3) != null ? { fecha: sg.fecha, hora: sg.hora, mm3: num(sg.almacenamiento_mm3) as number } : null,
            cila: ultCila && num(ultCila.almacenamiento_mm3) != null ? { fecha: ultCila.fecha, mm3: num(ultCila.almacenamiento_mm3) as number } : null,
            confirmacion: confirmarConCila(num(sg?.almacenamiento_mm3), num(cm?.almacenamiento_mm3), cap),
        };
    });
    return { cila, seg, lect, resumen };
}

const f3 = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fCorta = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

/**
 * Botón "Infografía" de la página Presas. Abre un diálogo donde se ELIGE la fuente de la lectura que se publica:
 * la captura manual del seguimiento (Registrar, 07:00 h) o el reporte oficial CILA/IBWC. Antes de generar se ve cada lectura
 * y si CILA confirma la captura. Genera un PNG (1600 px a 2x) y lo entrega con la hoja de Compartir en iOS o como descarga.
 */
export default function BotonInfografiaPresas({ presas }: { presas: PresaData[] }) {
    const [abierto, setAbierto] = useState(false);
    const [cargando, setCargando] = useState(false);
    const [generando, setGenerando] = useState<OrigenInfografia | null>(null);
    const [aviso, setAviso] = useState<string | null>(null);
    const [ins, setIns] = useState<Insumos | null>(null);

    const abrir = async () => {
        setAbierto(true); setAviso(null); setIns(null); setCargando(true);
        try { setIns(await cargar()); } catch (e) { setAviso(e instanceof Error ? e.message : 'No se pudieron leer las lecturas.'); } finally { setCargando(false); }
    };

    const generar = async (origen: OrigenInfografia) => {
        if (generando || !ins) return;
        setGenerando(origen); setAviso(null);
        try {
            let indice: Awaited<ReturnType<typeof cargarIndiceHistorico>>;
            try { indice = await cargarIndiceHistorico(); }
            catch { throw new Error('No se pudo cargar el histórico de presas; intenta de nuevo (sin él la infografía saldría sin clasificación).'); }

            const entradas: EntradaPresaInfografia[] = PRESAS_INFOGRAFIA.map((id) => {
                const presa = presas.find((p) => p.id === id);
                const lect = presa?.lectura ?? null;
                const res = ins.resumen.find((r) => r.id === id)!;
                const propiasCila = ins.cila.filter((f) => f.presa_id === id); // de la más reciente a la más antigua
                if (origen === 'cila') {
                    const hayNivel = lect?.escala_msnm != null;
                    // Contraste informativo: la captura del mismo día (si la hay) frente a lo que publica CILA.
                    const conf = res.captura && propiasCila[0] && res.captura.fecha === propiasCila[0].fecha ? res.confirmacion
                        : res.captura ? confirmarConCila(res.captura.mm3, null, null) : confirmarConCila(null, null, null);
                    return {
                        id, nombre: NOMBRE_ENCABEZADO[id],
                        actual: propiasCila[0] ? aLectura(propiasCila[0]) : null,
                        previa: propiasCila[1] ? { fecha: propiasCila[1].fecha, almacenamiento_mm3: num(propiasCila[1].almacenamiento_mm3), pct_conservacion: num(propiasCila[1].pct_conservacion) } : null,
                        historico: indice[id],
                        elevacion: { valor: lect?.escala_msnm ?? null, procedencia: procedenciaNivel(lect?.notas, hayNivel) },
                        salida: { valor: lect?.extraccion_conocida ? lect.extraccion_total_m3s : null, conocida: !!lect?.extraccion_conocida },
                        confirmacion: conf,
                    };
                }
                // Origen = captura (Registrar): lectura de las 07:00 h del seguimiento; elevación y salida son las capturadas.
                const sg = ins.seg.find((x) => x.clave === CLAVE_SEGUIMIENTO[id]);
                const cap = CAPACIDAD_FIJA_MM3[id] ?? num(propiasCila[0]?.cap_conservacion_mm3) ?? num(sg?.namo_mm3);
                const vol = num(sg?.almacenamiento_mm3);
                const previaL = sg ? ins.lect.find((x) => x.presa_id === id && x.fecha < sg.fecha) : undefined; // día anterior de cualquier fuente
                const pv = num(previaL?.almacenamiento_mm3);
                return {
                    id, nombre: NOMBRE_ENCABEZADO[id],
                    actual: sg && vol != null ? { fecha: sg.fecha, almacenamiento_mm3: vol, pct_conservacion: cap ? (vol / cap) * 100 : null, cap_conservacion_mm3: cap, archivo_last_modified: sg.hora ? `${sg.fecha}T${sg.hora.slice(0, 5)}:00-06:00` : null } : null,
                    previa: previaL && pv != null ? { fecha: previaL.fecha, almacenamiento_mm3: pv, pct_conservacion: cap ? (pv / cap) * 100 : null } : null,
                    historico: indice[id],
                    elevacion: { valor: num(sg?.elevacion_msnm), procedencia: num(sg?.elevacion_msnm) != null ? 'CAMPO' as const : null },
                    salida: { valor: num(sg?.extraccion_m3s), conocida: num(sg?.extraccion_m3s) != null },
                    confirmacion: res.confirmacion,
                };
            });

            const datos = construirDatosInfografia(entradas, origen);
            if (datos.presas.every((p) => p.volumen == null)) {
                setAviso(origen === 'captura' ? 'Sin captura de seguimiento: pégala primero en Registrar.' : 'Sin datos CILA disponibles: no se genera la infografía.');
                return;
            }
            const [logo, logoSica] = await Promise.all([cargarLogoSrlInforme(), cargarLogoSicaInforme()]); // '' si falla: la plantilla deja solo el texto
            const png = await rasterizaHtml(htmlInfografiaPresas(datos, logo, logoSica), { ancho: ANCHO_INFOGRAFIA, escala: 2 });
            await guardaOComparte(png, `estado-presas-conchos-${datos.corte.fechaDato ?? 'sin-fecha'}-${origen === 'captura' ? 'captura' : 'cila'}.png`, 'image/png');
            setAbierto(false);
        } catch (e) {
            setAviso(e instanceof Error ? e.message : 'No se pudo generar la infografía.');
        } finally {
            setGenerando(null);
        }
    };

    const hayCaptura = !!ins?.resumen.some((r) => r.captura), hayCila = !!ins?.resumen.some((r) => r.cila);
    // Recomendada: la captura si existe y es del mismo día que CILA o más reciente.
    const fCap = ins?.resumen.map((r) => r.captura?.fecha).filter(Boolean).sort().pop(), fCil = ins?.resumen.map((r) => r.cila?.fecha).filter(Boolean).sort().pop();
    const recomendada: OrigenInfografia = hayCaptura && (!fCil || (fCap as string) >= (fCil as string)) ? 'captura' : 'cila';

    return (
        <>
            <button type="button" className="scada-action-btn" onClick={abrir}
                title="Genera una imagen del estado actual de las presas para enviar por mensaje: elige la captura de Registrar o el reporte CILA" aria-haspopup="dialog">
                <ImageDown size={11} />Infografía estado actual
            </button>
            {abierto && (
                <Modal abierto onCerrar={() => { if (!generando) setAbierto(false); }} tamano="md" kicker="Infografía · estado actual de las presas" titulo="¿Qué lectura se publica?"
                    pie={<Boton onClick={() => setAbierto(false)} disabled={!!generando}>Cancelar</Boton>}>
                    <p className="text-[13px] text-slate-300" style={{ marginBottom: 12 }}>
                        Elija la fuente de las cifras de la imagen. La captura de Registrar (07:00 h) es la prioritaria; CILA la confirma cuando publica su reporte.
                    </p>
                    {cargando && <p role="status" className="text-[13px] text-slate-300"><Loader2 size={13} style={{ display: 'inline', animation: 'spin 1s linear infinite' }} /> Leyendo lecturas…</p>}
                    {ins && (
                        <div className="seg-fuentes" role="group" aria-label="Lecturas disponibles por presa">
                            {ins.resumen.map((r) => (
                                <div key={r.id} className="seg-fuente-fila">
                                    <b>{NOMBRE_ENCABEZADO[r.id]}</b>
                                    <span>Captura: {r.captura ? <><b>{f3(r.captura.mm3)}</b> hm³ · {fCorta(r.captura.fecha)}{r.captura.hora ? ` ${r.captura.hora.slice(0, 5)} h` : ''}</> : <i>sin captura</i>}</span>
                                    <span>CILA: {r.cila ? <><b>{f3(r.cila.mm3)}</b> hm³ · {fCorta(r.cila.fecha)}</> : <i>sin dato</i>}</span>
                                    <span className={`seg-conf seg-conf--${r.confirmacion.estado}`}><span aria-hidden="true">{GLIFO_CONFIRMACION[r.confirmacion.estado]}</span> {r.confirmacion.texto}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    {aviso && <p role="alert" className="seg-aviso seg-aviso--error" style={{ marginTop: 10 }}>{aviso}</p>}
                    {ins && (
                        <div className="seg-fuente-botones">
                            <Boton variante={recomendada === 'captura' ? 'primario' : 'secundario'} onClick={() => generar('captura')} disabled={!hayCaptura || !!generando} cargando={generando === 'captura'}>
                                Usar la captura (Registrar){recomendada === 'captura' ? ' · recomendada' : ''}
                            </Boton>
                            <Boton variante={recomendada === 'cila' ? 'primario' : 'secundario'} onClick={() => generar('cila')} disabled={!hayCila || !!generando} cargando={generando === 'cila'}>
                                Usar el reporte CILA{recomendada === 'cila' ? ' · recomendada' : ''}
                            </Boton>
                        </div>
                    )}
                </Modal>
            )}
        </>
    );
}
