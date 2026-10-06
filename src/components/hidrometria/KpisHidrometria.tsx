import { memo } from 'react';
import { Upload, Download, Activity, ClipboardCheck } from 'lucide-react';
import { TileCifra } from '../ui/TileCifra';
import { fmt, fmtEdadMin, fmtUnidad } from '../../utils/formato';
import type { EficienciaCanal } from '../../hooks/useEficienciaCanal';
import type { ResumenSemana } from '../../utils/hidrometria';
import { relacionEntregaEntrada } from '../../utils/eficienciaCanal';

interface Props {
    canal: EficienciaCanal;
    ahoraMs: number;
    /** Σ gasto actual de los módulos (m³/s); null si no hay módulos cargados. */
    entregaM3s: number | null;
    /** Fecha (YYYY-MM-DD) de la última captura de entregas por módulo, y hoy. */
    ultimaCaptura: string | null;
    hoy: string;
    resumen: ResumenSemana;
    cumplimientoEtiqueta: { texto: string; tipo: 'ok' | 'warn' | 'crit' | 'sd' | 'info' };
}

const edadMin = (ahora: number, ms: number | null) => (ms == null ? null : (ahora - ms) / 60000);

/** Franja de cifras: entrada K-0, entrega de módulos, eficiencia de conducción (única) y cumplimiento del programa. */
export const KpisHidrometria = memo(function KpisHidrometria({ canal, ahoraMs, entregaM3s, ultimaCaptura, hoy, resumen, cumplimientoEtiqueta }: Props) {
    const rel = relacionEntregaEntrada(entregaM3s, canal.qEntrada);
    const capturaVieja = ultimaCaptura != null && ultimaCaptura < hoy;
    const c = canal.conduccion;
    return (
        <section className="sc-pulso" aria-label="Cifras de hidrometría">
            <TileCifra etiqueta="Entrada · K-0+000" icono={<Upload size={18} aria-hidden="true" />} acento="var(--sc-s1)"
                valor={canal.qEntrada != null ? fmt(canal.qEntrada, 3) : null} unidad="m³/s"
                lineas={[canal.qEntrada == null ? 'Sin lectura vigente (≤ 4 h) en K-0' : 'Gasto medido en la escala de entrada']}
                frescura={canal.k0TelemetriaMs != null ? `Telemetría ${fmtEdadMin(edadMin(ahoraMs, canal.k0TelemetriaMs))}` : 'Sin lectura'}
                frescuraVieja={!canal.k0Fresca} />

            <TileCifra etiqueta="Entrega a módulos" icono={<Download size={18} aria-hidden="true" />} acento="var(--sc-s3)"
                valor={entregaM3s != null ? fmt(entregaM3s, 3) : null} unidad="m³/s"
                lineas={[
                    'Suma de la captura por módulo',
                    rel.estado === 'inconsistente' ? `⚠ Supera a la entrada K-0 en ${fmtUnidad(rel.exceso, 'm³/s', 3)}: fuentes o ventanas de tiempo distintas` : null,
                ].filter(Boolean)}
                frescura={ultimaCaptura ? `Última captura: ${ultimaCaptura.split('-').reverse().join('/')}${capturaVieja ? ' · no es de hoy' : ''}` : 'Sin capturas registradas'}
                frescuraVieja={capturaVieja || !ultimaCaptura} />

            <TileCifra etiqueta="Eficiencia de conducción" icono={<Activity size={18} aria-hidden="true" />} acento="var(--sc-s2)"
                valor={c.eficienciaPct != null && !c.incoherente ? fmt(c.eficienciaPct) : null} unidad="%"
                estado={{ texto: canal.clasificacion.etiqueta, tipo: canal.clasificacion.estado }}
                lineas={[
                    `K-0 ${fmtUnidad(canal.qEntrada, 'm³/s', 2)} → K-104 ${fmtUnidad(canal.qSalida, 'm³/s', 2)}`,
                    c.perdidaM3s != null && !c.incoherente ? `Pérdida ${fmtUnidad(c.perdidaM3s, 'm³/s', 2)} (${fmt(c.perdidaPct)} %)` : canal.clasificacion.descripcion,
                ]}
                frescura="Misma cifra que el Dashboard (Qs/Qe, extremos vigentes)" aria="Eficiencia de conducción K-0 a K-104" />

            <TileCifra etiqueta="Cumplimiento del programa" icono={<ClipboardCheck size={18} aria-hidden="true" />} acento="var(--sc-violet)"
                valor={resumen.cumplimientoPct != null ? fmt(resumen.cumplimientoPct) : null} unidad="%"
                estado={cumplimientoEtiqueta}
                lineas={[
                    `Solicitud capturada: ${resumen.modulosConSolicitud} de ${resumen.modulosTotal} módulos`,
                    `Programado ${resumen.programadoMm3 != null ? fmtUnidad(resumen.programadoMm3, 'Mm³', 3) : 'S/D'} · entregado ${resumen.entregadoMm3 != null ? fmtUnidad(resumen.entregadoMm3, 'Mm³', 3) : 'S/D'}`,
                ]}
                frescura="Entregado / programado prorrateado a los días transcurridos" />
        </section>
    );
});
