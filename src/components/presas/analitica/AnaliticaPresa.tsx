import { useMemo, useState } from 'react';
import { usePresasHistorico } from '../../../hooks/usePresasHistorico';
import type { PresaData } from '../../../hooks/usePresas';
import { NOMBRE_PRESA, formatearNumero } from '../../../utils/historicoPresas';
import { UMBRAL_BAJO_PCT, UMBRAL_CRITICO_PCT, estadoEmbalse } from '../../../utils/presaNiveles';
import {
    anioInicioCiclo, bandaCiclos, ciclosHistoricos, crucesUmbral, diaDeCiclo, etiquetaCiclo, fechaCorta,
    posicionEnCiclos, proyectarCiclo, ritmoActual, serieCiclo, ultimoDiaCiclo,
} from '../../../utils/analiticaPresas';
import GraficaCiclo from './GraficaCiclo';
import GraficaProyeccion from './GraficaProyeccion';
import EstacionesGoes from '../goes/EstacionesGoes';
import './analitica.css';

type Horizonte = 90 | 'ciclo';

const GLIFO: Record<string, string> = { ok: '●', warn: '▲', crit: '■', sd: '◇' };

const signo = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${formatearNumero(Math.abs(v), d)}`;

interface Props { presa: PresaData; fechaISO: string }

type Vista = 'ciclo' | 'goes';

/**
 * Pestaña "Analítica y forecasting": dos vistas. «Ciclo y proyección» (volumen del ciclo agrícola) y «Estaciones GOES»
 * (telemetría satelital de nivel y gasto). El estado de cada vista vive en su propio componente.
 */
export default function AnaliticaPresa(props: Props) {
    const [vista, setVista] = useState<Vista>('ciclo');
    return (
        <div className="an-root">
            <div className="an-vistas" role="group" aria-label="Vista de analítica">
                <button type="button" className="an-vista-btn" aria-pressed={vista === 'ciclo'} onClick={() => setVista('ciclo')}>Ciclo y proyección</button>
                <button type="button" className="an-vista-btn" aria-pressed={vista === 'goes'} onClick={() => setVista('goes')}>Estaciones GOES</button>
            </div>
            {vista === 'ciclo' ? <AnaliticaCiclo {...props} /> : <EstacionesGoes presaId={props.presa.id} />}
        </div>
    );
}

/**
 * Vista "Ciclo y proyección": ciclo agrícola en curso (1-oct → 30-sep) frente a los ciclos pasados reales y
 * proyección por trayectorias análogas. Sin datos inventados: lo que no se puede calcular se muestra como S/D.
 */
function AnaliticaCiclo({ presa, fechaISO }: Props) {
    const { indice, loading, error, recargar } = usePresasHistorico();
    const [horizonte, setHorizonte] = useState<Horizonte>(90);

    const mapa = indice[presa.id];
    const anioCiclo = anioInicioCiclo(fechaISO);
    const diaHoy = diaDeCiclo(fechaISO, anioCiclo);
    const capacidad = presa.capacidad_max_mm3 > 0 ? presa.capacidad_max_mm3 : null;
    const valorHoy = presa.lectura?.almacenamiento_mm3 != null && Number.isFinite(Number(presa.lectura.almacenamiento_mm3)) ? Number(presa.lectura.almacenamiento_mm3) : null;
    const pctHoy = presa.lectura?.porcentaje_llenado ?? (valorHoy != null && capacidad ? (valorHoy / capacidad) * 100 : null);

    const calc = useMemo(() => {
        const { usados, excluidos } = ciclosHistoricos(mapa, anioCiclo);
        const actual = serieCiclo(mapa, anioCiclo);
        const proy = proyectarCiclo(usados, anioCiclo, fechaISO, valorHoy, horizonte === 'ciclo' ? 9999 : 90, capacidad);
        const umbralCritico = capacidad ? (capacidad * UMBRAL_CRITICO_PCT) / 100 : null;
        return {
            usados, excluidos, actual, proy,
            banda: bandaCiclos(usados),
            posicion: posicionEnCiclos(valorHoy, usados, diaHoy),
            ritmo: ritmoActual(actual, anioCiclo, diaHoy, usados),
            umbralCritico,
            umbralBajo: capacidad ? (capacidad * UMBRAL_BAJO_PCT) / 100 : null,
            cruces: proy && umbralCritico != null ? crucesUmbral(proy, umbralCritico) : null,
        };
    }, [mapa, anioCiclo, fechaISO, valorHoy, horizonte, capacidad, diaHoy]);

    const nombre = NOMBRE_PRESA[presa.id] ?? presa.nombre;
    const estado = estadoEmbalse(valorHoy == null ? null : pctHoy);
    const etiquetaActual = etiquetaCiclo(anioCiclo);
    const diasCiclo = ultimoDiaCiclo(anioCiclo) + 1;

    if (loading) {
        return <div className="an-root" aria-busy="true" aria-label="Cargando analítica"><div className="an-skeleton" /><div className="an-skeleton an-skeleton--alta" /></div>;
    }
    if (error) {
        return (
            <div className="an-root"><div className="an-vacio" role="alert">
                <strong>No se pudo cargar el histórico de presas.</strong>
                <span>{error}</span>
                <button type="button" className="an-btn" onClick={recargar}>Reintentar</button>
            </div></div>
        );
    }
    if (!mapa || calc.usados.length < 3) {
        return <div className="an-root"><div className="an-vacio" role="status"><strong>Sin histórico comparable (S/D)</strong><span>Se necesitan al menos 3 ciclos agrícolas con datos para comparar y proyectar.</span></div></div>;
    }

    const p = calc.proy;
    const ultimo = p?.puntos[p.puntos.length - 1];
    const seco = calc.cruces?.find(c => c.escenario === 'seco');
    const mediana = calc.cruces?.find(c => c.escenario === 'mediana');
    const agotaria = !!p && p.puntos.some(x => x.min != null && x.min <= 0);

    const resumenCruce = !p || calc.umbralCritico == null ? null
        : seco?.fecha == null && mediana?.fecha == null
            ? `Sin cruce del umbral crítico de referencia (${formatearNumero(calc.umbralCritico, 0)} Mm³) en ${p.horizonteDias} días en ningún escenario.`
            : `Umbral crítico de referencia (${formatearNumero(calc.umbralCritico, 0)} Mm³): escenario seco ${seco?.fecha ? `hacia el ${fechaCorta(seco.fecha)}` : 'sin cruce'} · mediana ${mediana?.fecha ? `hacia el ${fechaCorta(mediana.fecha)}` : 'sin cruce'}.`;

    return (
        <div className="an-root pr-reveal">
            <header className="an-head">
                <div>
                    <h3 className="an-titulo">{nombre} · ciclo agrícola {etiquetaActual}</h3>
                    <p className="an-sub">Del 1 de octubre de {anioCiclo} al 30 de septiembre de {anioCiclo + 1} · hoy es el día {diaHoy + 1} de {diasCiclo} · {fechaCorta(fechaISO)}</p>
                </div>
                <span className={`an-chip an-chip--${estado.clave}`}><span aria-hidden="true">{GLIFO[estado.clave]}</span> {estado.etiqueta}</span>
            </header>

            <div className="an-kpis" role="list">
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Volumen hoy</span>
                    <span className="an-kpi-val">{valorHoy == null ? 'S/D' : formatearNumero(valorHoy, 1)}<small> Mm³</small></span>
                    <span className="an-kpi-sub">{pctHoy == null ? 'Sin lectura vigente' : `${formatearNumero(pctHoy, 1)} % de la capacidad`}</span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Posición en el ciclo</span>
                    <span className="an-kpi-val">{calc.posicion ? `${calc.posicion.posicion}.º` : 'S/D'}<small>{calc.posicion ? ` más bajo de ${calc.posicion.de}` : ''}</small></span>
                    <span className="an-kpi-sub">Mismo día del ciclo en los ciclos pasados</span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Ritmo reciente</span>
                    <span className="an-kpi-val">{calc.ritmo ? signo(calc.ritmo.mm3PorDia) : 'S/D'}<small> Mm³/día</small></span>
                    <span className="an-kpi-sub">{calc.ritmo
                        ? `${calc.ritmo.dias} d · ${calc.ritmo.historicoMediana != null ? `mediana histórica ${signo(calc.ritmo.historicoMediana)}` : 'sin referencia histórica'}`
                        : 'Se necesitan dos lecturas separadas 3 días o más'}</span>
                </div>
                <div className="an-kpi" role="listitem">
                    <span className="an-kpi-lbl">Proyección {p ? `al ${fechaCorta(p.puntos[p.puntos.length - 1].fecha)}` : ''}</span>
                    <span className="an-kpi-val an-kpi-val--rango">{ultimo?.min != null && ultimo.max != null ? `${formatearNumero(ultimo.min, 0)} – ${formatearNumero(ultimo.max, 0)}` : 'S/D'}<small> Mm³</small></span>
                    <span className="an-kpi-sub">{ultimo?.mediana != null ? `Mediana ${formatearNumero(ultimo.mediana, 0)} Mm³ · ${p!.trayectorias.length} trayectorias` : 'Sin base suficiente'}</span>
                </div>
            </div>

            <section className="an-card" aria-label="Ciclo en curso frente a ciclos pasados">
                <h4 className="an-h">Ciclo en curso frente a los ciclos pasados</h4>
                <p className="an-nota">Línea azul: lecturas reales del ciclo {etiquetaActual}. Banda: mínimo y máximo de {calc.usados.length} ciclos con datos ({calc.usados.map(c => c.etiqueta).join(', ')}).</p>
                <GraficaCiclo
                    anioActual={anioCiclo} diaHoy={diaHoy} actual={calc.actual} banda={calc.banda}
                    previo={calc.usados.find(c => c.anioInicio === anioCiclo - 1) ?? null}
                />
            </section>

            <section className="an-card" aria-label="Proyección del volumen">
                <div className="an-h-fila">
                    <h4 className="an-h">Proyección del volumen</h4>
                    <div className="an-seg" role="group" aria-label="Horizonte de la proyección">
                        <button type="button" className="an-seg-btn" aria-pressed={horizonte === 90} onClick={() => setHorizonte(90)}>90 días</button>
                        <button type="button" className="an-seg-btn" aria-pressed={horizonte === 'ciclo'} onClick={() => setHorizonte('ciclo')}>Hasta fin de ciclo</button>
                    </div>
                </div>
                {p ? (
                    <>
                        {resumenCruce && <p className="an-resumen" aria-live="polite">{resumenCruce}</p>}
                        <GraficaProyeccion proy={p} umbralCritico={calc.umbralCritico} umbralBajo={calc.umbralBajo} capacidad={capacidad} />
                        {agotaria && <p className="an-aviso">En el escenario seco la analogía agota el volumen: la banda se corta en 0 Mm³. No es una predicción, indica que ese ciclo pasado perdió más agua de la que hoy hay almacenada.</p>}
                        {horizonte === 'ciclo' && <p className="an-aviso">A fin de ciclo la banda es muy ancha porque solo hay {p.trayectorias.length} ciclos de referencia con estiajes y avenidas muy distintos. Úsala como rango plausible, no como pronóstico.</p>}
                    </>
                ) : (
                    <div className="an-vacio" role="status"><strong>Proyección S/D</strong><span>{valorHoy == null ? 'No hay lectura vigente de volumen.' : 'No hay trayectorias comparables suficientes para este día del ciclo.'}</span></div>
                )}
            </section>

            <footer className="an-pie">
                <h4 className="an-h an-h--pie">Cómo se calcula y qué falta</h4>
                <ul>
                    <li><b>Método:</b> volumen de hoy más el cambio que tuvo el almacenamiento en cada ciclo pasado desde este mismo día del ciclo. Ese cambio ya incluye aportaciones, evaporación y la extracción de riego de aquel ciclo.</li>
                    <li><b>Ciclos usados:</b> {calc.usados.map(c => `${c.etiqueta} (${Math.round(c.cobertura * 100)} % de días con dato)`).join(' · ')}.{calc.excluidos.length > 0 ? ` Excluidos por poca cobertura: ${calc.excluidos.map(c => c.etiqueta).join(', ')}.` : ''} Huecos de hasta 10 días se interpolan solo en ciclos pasados, nunca en el actual.</li>
                    <li><b>Volumen autorizado {etiquetaActual}:</b> pendiente; aún no está definido, por eso no se compara contra la demanda del ciclo.</li>
                    <li><b>Umbrales {UMBRAL_CRITICO_PCT} % y {UMBRAL_BAJO_PCT} %:</b> referencia interna de SICA, no una norma de operación.</li>
                    <li>Orientativa: no sustituye el plan de riego ni la programación oficial.</li>
                </ul>
            </footer>
        </div>
    );
}
