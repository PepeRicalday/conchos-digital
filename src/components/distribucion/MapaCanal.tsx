import { memo } from 'react';
import { Crosshair, Droplet, Zap, ArrowRight } from 'lucide-react';
import { posicionKm } from '../../utils/distribucion';
import { fmt, fmtEdadMin } from '../../utils/formato';
import type { EscalaCanal } from '../../hooks/useEscalasCanal';

export interface PuntoMapa { id: string; name: string; km: number; type: 'toma' | 'lateral' | 'carcamo'; flow: number; isOpen: boolean; wasActive?: boolean }
export interface TramoModulo { id: string; nombre: string; rango: [number, number] | null; lps: number }

interface Props {
    kmIni: number;
    kmFin: number;
    escalas: EscalaCanal[];
    modulos: TramoModulo[];
    puntos: PuntoMapa[];
    activoId: string | null;
    onPunto: (id: string) => void;
    mensajeVacio: string | null;
    ahoraMs: number;
    titulo: string;
}

const ICONO = { lateral: ArrowRight, carcamo: Zap, toma: Droplet } as const;
const LANAS = 3;

/**
 * Canal lineal con escalas (nivel y gasto vigentes), tramo de cada módulo y tomas con captura. Aunque no haya ni una
 * toma con captura, el canal sigue informando por escalas y módulos; el vacío se explica, no se deja un lienzo en blanco.
 */
export const MapaCanal = memo(function MapaCanal({ kmIni, kmFin, escalas, modulos, puntos, activoId, onPunto, mensajeVacio, ahoraMs, titulo }: Props) {
    const escalasVista = escalas.filter((e) => posicionKm(e.km, kmIni, kmFin) != null);
    return (
        <section className="sc-card dc-mapa" aria-labelledby="dc-mapa-t">
            <span className="sc-kicker">Km {kmIni.toFixed(0)} → Km {kmFin.toFixed(0)}</span>
            <h3 id="dc-mapa-t">{titulo}</h3>
            {mensajeVacio && <p className="sc-aviso" role="status">{mensajeVacio}</p>}

            <div className="dc-mapa-scroll" tabIndex={0} role="region" aria-label="Mapa lineal del canal (desplazable)">
                <div className="dc-mapa-lienzo">
                    {/* Tramo de cada módulo (según el rango de sus propias tomas) */}
                    <div className="dc-tramos">
                        {modulos.map((m, i) => {
                            if (!m.rango) return null;
                            const a = Math.max(m.rango[0], kmIni), b = Math.min(m.rango[1], kmFin);
                            const pa = posicionKm(a, kmIni, kmFin), pb = posicionKm(b, kmIni, kmFin);
                            if (pa == null || pb == null) return null;
                            return (
                                <div key={m.id} className="dc-tramo" style={{ left: `${pa}%`, width: `${Math.max(pb - pa, 1.5)}%`, top: `${(i % LANAS) * 22}px` }}
                                    title={`${m.nombre}: km ${m.rango[0].toFixed(1)}–${m.rango[1].toFixed(1)} · ${m.lps.toFixed(0)} L/s`}>
                                    <span>{m.nombre}{m.lps > 0 ? ` · ${m.lps.toFixed(0)} L/s` : ''}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="dc-linea" aria-hidden="true" />

                    {/* Escalas */}
                    {escalasVista.map((e) => (
                        <div key={e.id} className={`dc-escala ${e.referencia ? 'dc-escala-ref' : e.fresca ? 'dc-escala-viva' : 'dc-escala-vieja'}`} style={{ left: `${posicionKm(e.km, kmIni, kmFin)}%` }}
                            title={`${e.nombre} · km ${e.km} · nivel ${fmt(e.nivelM, 2)} m · gasto ${fmt(e.gasto, 2)} m³/s · ${e.telemetriaMs ? fmtEdadMin((ahoraMs - e.telemetriaMs) / 60000) : 'sin lectura'}`}>
                            <Crosshair size={13} aria-hidden="true" />
                            <span className="dc-escala-km">K{Math.round(e.km)}</span>
                        </div>
                    ))}

                    {/* Tomas con captura */}
                    {puntos.map((p) => {
                        const pos = posicionKm(p.km, kmIni, kmFin);
                        if (pos == null) return null;
                        const Ico = ICONO[p.type] ?? Droplet;
                        const estado = p.isOpen ? 'abierta' : p.wasActive ? 'cerrada con movimiento' : 'cerrada';
                        return (
                            <button key={p.id} type="button" className={`dc-toma ${p.isOpen ? 'abierta' : 'movimiento'} ${p.id === activoId ? 'activa' : ''}`} style={{ left: `${pos}%` }}
                                onClick={() => onPunto(p.id)} aria-pressed={p.id === activoId} aria-label={`${p.name}, km ${p.km}, ${estado}${p.isOpen ? `, ${(p.flow * 1000).toFixed(0)} litros por segundo` : ''}`}>
                                <Ico size={13} aria-hidden="true" />
                            </button>
                        );
                    })}
                    <span className="dc-km dc-km-ini">Km {kmIni.toFixed(0)}</span>
                    <span className="dc-km dc-km-fin">Km {kmFin.toFixed(0)}</span>
                </div>
            </div>

            <ul className="sc-leyenda" aria-label="Leyenda del mapa">
                <li><i style={{ background: 'rgba(56,189,248,.5)' }} />Tramo de módulo</li>
                <li><i style={{ background: '#34d399' }} />Escala con lectura vigente (≤ 4 h)</li>
                <li><i style={{ background: '#8396ad' }} />Escala sin lectura vigente</li>
                <li><i style={{ background: '#a78bfa' }} />Escala de referencia (K-64, K-94+200): solo nivel, sin gasto</li>
                <li><i style={{ background: '#fbbf24' }} />Toma abierta / con movimiento</li>
            </ul>

            <div className="sc-tabla-wrap">
                <table className="sc-tabla">
                    <caption>Escalas del tramo con su última lectura</caption>
                    <thead><tr><th scope="col">Escala</th><th scope="col">Km</th><th scope="col">Nivel</th><th scope="col">Gasto</th><th scope="col">Lectura</th></tr></thead>
                    <tbody>
                        {escalasVista.length === 0 && <tr><td colSpan={5}>Sin escalas en este tramo.</td></tr>}
                        {escalasVista.map((e) => (
                            <tr key={e.id}>
                                <th scope="row">{e.nombre}{e.referencia && <span className="sc-fresco"> · referencia (solo nivel)</span>}</th>
                                <td>{e.km.toFixed(1)}</td>
                                <td>{e.nivelM != null ? `${e.nivelM.toFixed(2)} m` : 'S/D'}</td>
                                <td>{e.referencia ? 'No aplica' : e.fresca && e.gasto != null ? `${e.gasto.toFixed(2)} m³/s` : 'S/D'}</td>
                                <td><span className={`sc-estado ${e.fresca ? 'sc-estado-ok' : 'sc-estado-sd'}`}>{e.telemetriaMs ? fmtEdadMin((ahoraMs - e.telemetriaMs) / 60000) : 'sin lectura'}</span></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
});
