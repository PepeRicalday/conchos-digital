import { memo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Waves, Gauge, CloudSun, ShieldAlert } from 'lucide-react';
import type { ExtraccionTotal, ResumenAlertas } from '../../utils/dashboardKpis';
import type { ConduccionTramo } from '../../utils/conduccion';
import { etiquetaEficiencia } from '../../utils/conduccion';
import type { ClimaPulso } from '../../hooks/useDashboardPulso';

const f = (v: number | null | undefined, d = 1) => (v == null ? null : v.toFixed(d));

function Numero({ valor, unidad }: { valor: string | null; unidad?: string }) {
    return valor == null
        ? <div className="sc-num sc-num-sd" aria-label="Sin dato">S/D</div>
        : <div className="sc-num">{valor}{unidad && <small>{unidad}</small>}</div>;
}

function Tile({ clase, to, etiqueta, icono, children, aria }: { clase: string; to: string; etiqueta: string; icono: ReactNode; children: ReactNode; aria: string }) {
    return (
        <Link to={to} className={`sc-tile ${clase}`} aria-label={aria}>
            <div className="sc-tile-cab"><span className="sc-kicker">{etiqueta}</span>{icono}</div>
            {children}
        </Link>
    );
}

interface Props {
    presas: {
        pct: number | null; almacenadoMm3: number | null; capacidadMm3: number; conDato: number; total: number;
        extraccion: ExtraccionTotal; frescuraTexto: string | null; stale: boolean;
    };
    canal: {
        conduccion: ConduccionTramo; qEntrada: number | null; qSalida: number | null; k0Fresca: boolean; k104Fresca: boolean; cargado: boolean;
        entregaMilM3: number | null;
    };
    clima: ClimaPulso & { cargado: boolean };
    alertas: ResumenAlertas;
}

/** "Pulso del sistema": cuatro numerales en orden de prioridad, cada uno con su cobertura y su frescura. */
export const PulsoSistema = memo(function PulsoSistema({ presas, canal, clima, alertas }: Props) {
    const c = canal.conduccion;
    const etiqueta = etiquetaEficiencia(c.eficienciaPct);
    return (
        <section className="sc-pulso" aria-label="Pulso del sistema">
            <Tile clase="sc-tile-presas" to="/presas" etiqueta="Presas · almacenamiento" icono={<Waves size={18} aria-hidden="true" />}
                aria={`Presas: almacenamiento ${f(presas.pct) ?? 'sin dato'} por ciento. Abrir Presas`}>
                <Numero valor={f(presas.pct)} unidad="%" />
                <ul className="sc-lineas">
                    <li>{presas.almacenadoMm3 != null ? <><b>{presas.almacenadoMm3.toFixed(1)}</b> / {presas.capacidadMm3.toFixed(0)} Mm³</> : 'Sin lectura de nivel'}</li>
                    <li>Cobertura <b>{presas.conDato} de {presas.total}</b> presas</li>
                    <li>Extracción <b>{presas.extraccion.valorM3s != null ? `${presas.extraccion.valorM3s.toFixed(1)} m³/s` : 'S/D'}</b>
                        {presas.extraccion.valorM3s != null && presas.extraccion.conMedicion < presas.extraccion.total ? ` (${presas.extraccion.conMedicion} de ${presas.extraccion.total} medidas)` : ''}</li>
                </ul>
                <span className={`sc-fresco ${presas.stale ? 'sc-viejo' : ''}`}>{presas.frescuraTexto ?? 'Sin lectura'}{presas.stale ? ' · dato antiguo' : ''}</span>
            </Tile>

            <Tile clase="sc-tile-canal" to="/monitor-publico" etiqueta="Canal · K-0 → K-104" icono={<Gauge size={18} aria-hidden="true" />}
                aria={`Canal: eficiencia de conducción ${f(c.eficienciaPct) ?? 'sin dato'}. Abrir Monitor Público`}>
                <Numero valor={f(c.eficienciaPct)} unidad="%" />
                <ul className="sc-lineas">
                    <li>Entrada K-0 <b>{f(canal.qEntrada, 2) ?? 'S/D'}</b> · Salida K-104 <b>{f(canal.qSalida, 2) ?? 'S/D'}</b> m³/s</li>
                    <li>{c.perdidaM3s != null ? <>Pérdida <b>{c.perdidaM3s.toFixed(2)} m³/s</b> ({f(c.perdidaPct)} %) · {etiqueta}</> : 'Balance no confiable: falta K-0 o K-104 fresco'}</li>
                    {c.incoherente && <li>⚠ Salida mayor que entrada: aforos desfasados</li>}
                    <li>Entregado a módulos hoy <b>{f(canal.entregaMilM3) ?? 'S/D'}</b> miles m³</li>
                </ul>
                <span className={`sc-fresco ${!canal.cargado || !(canal.k0Fresca && canal.k104Fresca) ? 'sc-viejo' : ''}`}>
                    {!canal.cargado ? 'Consultando…' : canal.k0Fresca && canal.k104Fresca ? 'Extremos con lectura vigente (≤ 4 h)' : 'Lectura de extremos no vigente (> 4 h)'}
                </span>
            </Tile>

            <Tile clase="sc-tile-clima" to="/clima" etiqueta="Clima · demanda de riego" icono={<CloudSun size={18} aria-hidden="true" />}
                aria={`Clima: temperatura máxima ${f(clima.tempMax) ?? 'sin dato'} grados. Abrir Clima`}>
                <Numero valor={f(clima.tempMax)} unidad="°C" />
                <ul className="sc-lineas">
                    <li>Mín. <b>{f(clima.tempMin) ?? 'S/D'} °C</b> · viento máx. <b>{f(clima.vientoMax) ?? 'S/D'} m/s</b></li>
                    <li>Lluvia hoy <b>{f(clima.lluviaProm) ?? 'S/D'} mm</b> · ETₒ al corte <b>{f(clima.etoProm, 2) ?? 'S/D'} mm</b></li>
                    <li>Estaciones válidas <b>{clima.estacionesValidas} de {clima.estacionesTotal}</b>{clima.excluidas.length > 0 ? ` · fuera: ${clima.excluidas.join(', ')}` : ''}</li>
                </ul>
                <span className="sc-fresco">{clima.cargado ? 'Promedios sin estaciones sospechosas ni sin señal' : 'Consultando…'}</span>
            </Tile>

            <Tile clase={`sc-tile-alertas ${alertas.criticas > 0 ? 'sc-hay-crit' : alertas.avisos > 0 ? 'sc-hay-aviso' : ''}`} to="/alertas" etiqueta="Alertas vigentes" icono={<ShieldAlert size={18} aria-hidden="true" />}
                aria={`${alertas.accionables} alertas vigentes. Abrir Alertas`}>
                <Numero valor={String(alertas.accionables)} />
                <ul className="sc-lineas">
                    <li><b>{alertas.criticas}</b> crítica(s) · <b>{alertas.avisos}</b> aviso(s)</li>
                    <li><b>{alertas.informativas}</b> informativa(s)</li>
                    <li>{alertas.antiguas > 0 ? <><b>{alertas.antiguas}</b> pendiente(s) con más de 14 d sin resolver</> : 'Sin pendientes antiguos'}</li>
                </ul>
                <span className="sc-fresco">Misma cifra que el menú lateral</span>
            </Tile>
        </section>
    );
});
