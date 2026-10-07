import { useState } from 'react';
import { ImageDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePresasHistorico } from '../hooks/usePresasHistorico';
import type { PresaData } from '../hooks/usePresas';
import type { PresaId } from '../utils/historicoPresas';
import { procedenciaNivel } from '../utils/presaMetrics';
import { construirDatosInfografia, type EntradaPresaInfografia, type LecturaCilaInf } from '../utils/infografiaPresas';
import { ANCHO_INFOGRAFIA, htmlInfografiaPresas } from '../utils/infografiaPresasHtml';
import { rasterizaHtml } from '../utils/rasterizaHtml';
import { assetToDataURI } from '../utils/assetToDataURI';
import { guardaOComparte } from '../utils/descargaArchivo';

const PRESAS_INFOGRAFIA: PresaId[] = ['PRE-001', 'PRE-002'];
/** Nombres oficiales del encabezado (la plantilla rotula "(Las Vírgenes)" en Madero). */
const NOMBRE_ENCABEZADO: Record<PresaId, string> = { 'PRE-001': 'La Boquilla', 'PRE-002': 'Francisco I. Madero' };

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

interface FilaCila {
    presa_id: string;
    fecha: string;
    almacenamiento_mm3: unknown;
    pct_conservacion: unknown;
    cap_conservacion_mm3: unknown;
    archivo_last_modified: string | null;
}

const aLectura = (f: FilaCila): LecturaCilaInf => ({
    fecha: f.fecha,
    almacenamiento_mm3: num(f.almacenamiento_mm3),
    pct_conservacion: num(f.pct_conservacion),
    cap_conservacion_mm3: num(f.cap_conservacion_mm3),
    archivo_last_modified: f.archivo_last_modified,
});

/**
 * Botón "Infografía" de la página Presas: genera un PNG (1600 px a 2x) del estado actual con las cifras oficiales
 * CILA/USIBWC y lo entrega con la hoja de Compartir en iOS o como descarga en escritorio.
 * Las lecturas CILA se consultan al pulsar (siempre frescas); elevación y salida vienen de `usePresas` (props).
 */
export default function BotonInfografiaPresas({ presas }: { presas: PresaData[] }) {
    const { indice } = usePresasHistorico();
    const [generando, setGenerando] = useState(false);
    const [aviso, setAviso] = useState<string | null>(null);

    const generar = async () => {
        if (generando) return;
        setGenerando(true);
        setAviso(null);
        try {
            const { data, error } = await supabase
                .from('lecturas_presas_cila')
                .select('presa_id, fecha, almacenamiento_mm3, pct_conservacion, cap_conservacion_mm3, archivo_last_modified')
                .in('presa_id', PRESAS_INFOGRAFIA)
                .order('fecha', { ascending: false })
                .limit(8);
            if (error) throw new Error('No se pudo leer el reporte CILA.');
            const filas = (data ?? []) as FilaCila[];

            const entradas: EntradaPresaInfografia[] = PRESAS_INFOGRAFIA.map(id => {
                const propias = filas.filter(f => f.presa_id === id); // ya vienen de la más reciente a la más antigua
                const presa = presas.find(p => p.id === id);
                const lect = presa?.lectura ?? null;
                const hayNivel = lect?.escala_msnm != null;
                return {
                    id,
                    nombre: NOMBRE_ENCABEZADO[id],
                    actual: propias[0] ? aLectura(propias[0]) : null,
                    previa: propias[1] ? { fecha: propias[1].fecha, almacenamiento_mm3: num(propias[1].almacenamiento_mm3), pct_conservacion: num(propias[1].pct_conservacion) } : null,
                    historico: indice[id],
                    elevacion: { valor: lect?.escala_msnm ?? null, procedencia: procedenciaNivel(lect?.notas, hayNivel) },
                    salida: { valor: lect?.extraccion_conocida ? lect.extraccion_total_m3s : null, conocida: !!lect?.extraccion_conocida },
                };
            });

            const datos = construirDatosInfografia(entradas);
            if (datos.presas.every(p => p.volumen == null)) {
                setAviso('Sin datos CILA disponibles: no se genera la infografía.');
                return;
            }

            const logo = await assetToDataURI('/logos/logo-srl.png'); // '' si falla: la plantilla lo omite
            const png = await rasterizaHtml(htmlInfografiaPresas(datos, logo), { ancho: ANCHO_INFOGRAFIA, escala: 2 });
            await guardaOComparte(png, `estado-presas-conchos-${datos.corte.fechaDato ?? 'sin-fecha'}.png`, 'image/png');
        } catch (e) {
            setAviso(e instanceof Error ? e.message : 'No se pudo generar la infografía.');
        } finally {
            setGenerando(false);
        }
    };

    return (
        <>
            <button type="button" className="scada-action-btn" onClick={generar} disabled={generando}
                title="Genera una imagen del estado actual de las presas para enviar por mensaje" aria-busy={generando}>
                {generando ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <ImageDown size={11} />}
                {generando ? 'Generando…' : 'Infografía'}
            </button>
            {aviso && <span role="alert" className="scada-action-aviso">{aviso}</span>}
        </>
    );
}
