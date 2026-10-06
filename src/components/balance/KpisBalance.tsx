import { memo } from 'react';
import { Activity, GitBranch, Droplets, TriangleAlert } from 'lucide-react';
import { TileCifra } from '../ui/TileCifra';
import { fmt, fmtUnidad } from '../../utils/formato';
import type { EficienciaCanal } from '../../hooks/useEficienciaCanal';
import type { ResumenBalance } from '../../utils/balanceTramos';

interface Props { canal: EficienciaCanal; resumen: ResumenBalance; tomasActivas: number; qTomas: number; escalas: number; sinKm: number }

/** Cifras del balance. La eficiencia global es la de conducción K-0→K-104 (única); el resto describe los tramos. */
export const KpisBalance = memo(function KpisBalance({ canal, resumen, tomasActivas, qTomas, escalas, sinKm }: Props) {
    const c = canal.conduccion;
    return (
        <section className="sc-pulso" aria-label="Cifras del balance hídrico">
            <TileCifra etiqueta="Eficiencia de conducción" icono={<Activity size={18} aria-hidden="true" />} acento="var(--sc-s2)"
                valor={c.eficienciaPct != null && !c.incoherente ? fmt(c.eficienciaPct) : null} unidad="%"
                estado={{ texto: canal.clasificacion.etiqueta, tipo: canal.clasificacion.estado }}
                lineas={[`K-0 ${fmtUnidad(canal.qEntrada, 'm³/s', 2)} → K-104 ${fmtUnidad(canal.qSalida, 'm³/s', 2)}`, canal.clasificacion.descripcion]}
                frescura="Qs/Qe de extremo a extremo · misma cifra que el Dashboard" aria="Eficiencia de conducción K-0 a K-104" />
            <TileCifra etiqueta="Tramos con dato" icono={<GitBranch size={18} aria-hidden="true" />} acento="var(--sc-s1)"
                valor={`${resumen.conDato}`} unidad={`de ${resumen.tramos}`}
                lineas={[`${escalas} escalas con km${sinKm > 0 ? ` · ${sinKm} sin km (excluidas)` : ''}`,
                    `${resumen.sinDato} sin dato · ${resumen.cerrados} cerrados · ${resumen.anomalos} anómalos`]} />
            <TileCifra etiqueta="Tomas con caudal" icono={<Droplets size={18} aria-hidden="true" />} acento="var(--sc-s3)"
                valor={`${tomasActivas}`} lineas={[`Caudal captado ${fmtUnidad(qTomas, 'm³/s', 3)}`, 'Solo tomas con caudal > 0 y km conocido']} />
            <TileCifra etiqueta="Pérdida real en tramos" icono={<TriangleAlert size={18} aria-hidden="true" />} acento={resumen.fugas > 0 ? 'var(--sc-crit)' : 'var(--sc-ok)'}
                valor={`${resumen.fugas}`} estado={{ texto: resumen.fugas > 0 ? 'Revisar tramos' : 'Sin pérdida detectada', tipo: resumen.fugas > 0 ? 'crit' : 'ok' }}
                lineas={['Tramos con eficiencia bajo 90 %, sin anomalía de medición']} />
        </section>
    );
});
