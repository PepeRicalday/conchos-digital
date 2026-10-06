import { memo } from 'react';
import { Droplets, Layers, Waves } from 'lucide-react';
import { TileCifra } from '../ui/TileCifra';
import { GaugeConduccion } from './GaugeConduccion';
import { fmt, fmtMiles } from '../../utils/formato';
import type { AvanceDistrito } from '../../utils/distribucion';
import type { EficienciaCanal } from '../../hooks/useEficienciaCanal';

interface Props {
    seccional: boolean;
    /** null = sin dato (fecha distinta de hoy, o ninguna toma con captura). */
    entregaLps: number | null;
    volumenDiaMm3: number | null;
    acumuladoMm3: number | null;
    avance: AvanceDistrito;
    ultimaCaptura: string | null;
    hoy: string;
    esHoy: boolean;
    canal: EficienciaCanal;
}

/** Balance del distrito: entrega actual (con la fecha de su captura), volumen del día, avance del ciclo y eficiencia única. */
export const BalanceDistrito = memo(function BalanceDistrito({ seccional, entregaLps, volumenDiaMm3, acumuladoMm3, avance, ultimaCaptura, hoy, esHoy, canal }: Props) {
    const vieja = ultimaCaptura != null && ultimaCaptura < hoy;
    return (
        <section className="dc-balance" aria-label={seccional ? 'Balance seccional' : 'Balance del distrito 005'}>
            <TileCifra etiqueta={seccional ? 'Entrega actual · tramo' : 'Entrega actual · distrito'} icono={<Droplets size={18} aria-hidden="true" />} acento="var(--sc-s3)"
                valor={entregaLps != null ? fmtMiles(entregaLps, 0) : null} unidad="L/s"
                lineas={[esHoy ? 'Captura por módulo (no por toma)' : 'Sin histórico por fecha: elige "Hoy" para ver las cifras']}
                frescura={esHoy && ultimaCaptura ? `Última captura: ${ultimaCaptura.split('-').reverse().join('/')}${vieja ? ' · no es de hoy' : ''}` : undefined}
                frescuraVieja={vieja} />
            <TileCifra etiqueta="Volumen del día" icono={<Waves size={18} aria-hidden="true" />} acento="var(--sc-s1)"
                valor={volumenDiaMm3 != null ? fmt(volumenDiaMm3, 3) : null} unidad="Mm³"
                lineas={['Último volumen capturado en el día; no se suma al acumulado del ciclo']} />
            <TileCifra etiqueta={seccional ? 'Acumulado del ciclo · tramo' : 'Avance del ciclo'} icono={<Layers size={18} aria-hidden="true" />} acento="var(--sc-violet)"
                valor={seccional ? (acumuladoMm3 != null ? fmt(acumuladoMm3, 2) : null) : (avance.pct != null ? fmt(avance.pct) : null)} unidad={seccional ? 'Mm³' : '%'}
                lineas={seccional ? ['Suma de lo entregado por las tomas del tramo'] : [
                    avance.autorizadoMm3 != null ? `${fmt(avance.acumuladoMm3, 1)} de ${fmt(avance.autorizadoMm3, 1)} Mm³ autorizados` : 'Sin volumen autorizado cargado',
                    `${avance.modulosConAutorizado} de ${avance.modulosTotal} módulos con autorizado`,
                ]} />
            <GaugeConduccion valor={canal.conduccion.eficienciaPct} clasificacion={canal.clasificacion} qEntrada={canal.qEntrada} qSalida={canal.qSalida} />
        </section>
    );
});
