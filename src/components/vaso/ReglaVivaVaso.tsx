import { memo, useCallback, useId, useMemo, useRef, useState } from 'react';
import { COTAS_OFICIALES, type TonoCota } from '../../utils/cotasPresas';
import { elevacionPorVolumen, type PuntoCurva } from '../../utils/presaNiveles';

/**
 * "Regla viva" del Manejo de vaso: limnímetro y control del simulador en uno.
 * - Zonas del embalse: volumen muerto (achurado bajo la capacidad muerta) y franja NAMO–NAME.
 * - Escala interior de % del volumen al NAMO (25/50/75/100) calculada con la curva: muestra que el volumen
 *   NO crece en línea recta con el nivel.
 * - Dos aguas: la lectura real queda fija; lo simulado se marca con TEXTURA (achurado celeste si sube, contorno
 *   discontinuo ámbar si baja) — la diferencia no depende solo del color.
 * - Manija arrastrable (puntero/táctil) y operable con teclado (role="slider"). Sin nivel → S/D, nunca 0.
 */

const COLOR: Record<TonoCota, string> = { muted: '#8fa3ba', warn: '#fbbf24', alert: '#f87171', info: '#3FB2F3' };
const W = 380, TOP = 24, BOT = 332, TX = 64, TW = 110;
const PASO_TECLA = 0.1, PASO_PAGINA = 0.5;
const f2 = (v: number) => v.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pasoNice(rango: number): number {
    for (const p of [1, 2, 5, 10, 20, 50]) if (rango / p <= 9) return p;
    return 50;
}

interface Props {
    presaId: string;
    /** Lectura real; null = S/D (sin agua dibujada ni control). */
    nivelBase: number | null;
    /** Nivel mostrado (igual a nivelBase si no se simula). */
    nivel: number | null;
    /** Rango permitido para simular. */
    min: number;
    max: number;
    curva?: PuntoCurva[];
    /** Capacidad al NAMO (Mm³) para la escala de %. */
    capacidad: number | null;
    estimada?: boolean;
    etiquetaLectura: string;
    /** Texto del cambio simulado (p. ej. "−2.00 m · −121.4 Mm³"). */
    deltaTexto: string | null;
    onNivel?: (n: number) => void;
}

function ReglaVivaVaso({ presaId, nivelBase, nivel, min, max, curva, capacidad, estimada = false, etiquetaLectura, deltaTexto, onNivel }: Props) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    const svgRef = useRef<SVGSVGElement>(null);
    const [arrastrando, setArrastrando] = useState(false);
    const cfg = COTAS_OFICIALES[presaId];
    const simulado = nivel != null && nivelBase != null && Math.abs(nivel - nivelBase) > 0.005;

    const geom = useMemo(() => {
        const cotas = cfg?.cotas ?? [];
        const fondo = cfg?.fondo ?? (nivelBase != null ? nivelBase - 15 : 0);
        const maxCota = Math.max(...cotas.map((c) => c.elev), nivel ?? fondo + 1, nivelBase ?? fondo + 1, max);
        const lo = fondo, hi = maxCota + Math.max(1, (maxCota - fondo) * 0.04);
        const y = (e: number) => BOT - ((e - lo) / (hi - lo)) * (BOT - TOP);
        const elevDeY = (py: number) => lo + ((BOT - py) / (BOT - TOP)) * (hi - lo);
        const paso = pasoNice(hi - lo);
        const ticks: number[] = [];
        for (let t = Math.ceil(lo / paso) * paso; t <= hi; t += paso) ticks.push(t);
        const pctVol = capacidad ? [0.25, 0.5, 0.75, 1].map((p) => ({ p, e: elevacionPorVolumen(curva, p * capacidad) })).filter((x): x is { p: number; e: number } => x.e != null) : [];
        const elev = (label: string) => cotas.find((c) => c.label === label)?.elev ?? null;
        // Rótulos a la derecha (cotas + lectura + simulado), separados para no encimarse.
        type Rot = { key: string; y: number; yRot: number; label: string; valor: string; color: string; fuerte?: boolean };
        const rots: Rot[] = cotas.map((c) => ({ key: c.label, y: y(c.elev), yRot: y(c.elev), label: c.label.toUpperCase(), valor: `${f2(c.elev)} m`, color: COLOR[c.tono] }));
        if (nivelBase != null) rots.push({ key: 'base', y: y(nivelBase), yRot: y(nivelBase), label: simulado ? etiquetaLectura.toUpperCase() : 'NIVEL ACTUAL', valor: `${estimada ? '≈' : ''}${f2(nivelBase)} m`, color: simulado ? '#b4c2d4' : COLOR.info, fuerte: !simulado });
        if (simulado && nivel != null) rots.push({ key: 'sim', y: y(nivel), yRot: y(nivel), label: 'SIMULADO', valor: `${f2(nivel)} m`, color: COLOR.info, fuerte: true });
        rots.sort((a, b) => a.y - b.y);
        const hueco = (a: Rot, b: Rot) => (a.fuerte || b.fuerte ? 50 : 32);
        for (let i = 1; i < rots.length; i++) { const g = hueco(rots[i - 1], rots[i]); if (rots[i].yRot - rots[i - 1].yRot < g) rots[i].yRot = rots[i - 1].yRot + g; }
        for (let i = rots.length - 2; i >= 0; i--) if (rots[i + 1].yRot > BOT + 4) { rots[i + 1].yRot = BOT + 4; const g = hueco(rots[i], rots[i + 1]); if (rots[i].yRot > rots[i + 1].yRot - g) rots[i].yRot = rots[i + 1].yRot - g; }
        return { y, elevDeY, ticks, pctVol, rots, muerta: elev('Capacidad muerta'), namo: elev('NAMO'), name: elev('NAME'), fuente: cfg?.fuente ?? 'Curva de capacidad' };
    }, [cfg, nivelBase, nivel, max, capacidad, curva, simulado, etiquetaLectura, estimada]);

    const { y, ticks, pctVol, rots, muerta, namo, name } = geom;
    const yBase = nivelBase != null ? y(nivelBase) : null;
    const yNivel = nivel != null ? y(nivel) : null;
    const acotar = useCallback((n: number) => Math.min(max, Math.max(min, +n.toFixed(2))), [min, max]);

    const desdePuntero = useCallback((clientY: number) => {
        const svg = svgRef.current;
        if (!svg || !onNivel) return;
        const ctm = svg.getScreenCTM();
        if (!ctm) return;
        const p = svg.createSVGPoint(); p.x = 0; p.y = clientY;
        onNivel(acotar(geom.elevDeY(p.matrixTransform(ctm.inverse()).y)));
    }, [onNivel, acotar, geom]);

    const control = onNivel && nivel != null && nivelBase != null;
    const teclas = (e: React.KeyboardEvent) => {
        if (!control) return;
        const d = { ArrowUp: PASO_TECLA, ArrowRight: PASO_TECLA, ArrowDown: -PASO_TECLA, ArrowLeft: -PASO_TECLA, PageUp: PASO_PAGINA, PageDown: -PASO_PAGINA }[e.key];
        if (d != null) { e.preventDefault(); onNivel!(acotar(nivel! + d)); }
        else if (e.key === 'Home') { e.preventDefault(); onNivel!(min); }
        else if (e.key === 'End') { e.preventDefault(); onNivel!(max); }
        else if (e.key === 'Escape') { e.preventDefault(); onNivel!(nivelBase!); }
    };
    const resumen = nivelBase == null ? 'Sin lectura de nivel' : `Nivel ${simulado ? `simulado ${nivel!.toFixed(2)} msnm, lectura ${nivelBase.toFixed(2)}` : `${nivelBase.toFixed(2)} msnm`}`;

    return (
        <figure className={`vaso-regla${arrastrando ? ' arrastrando' : ''}`} aria-label={resumen}>
            <svg ref={svgRef} viewBox={`0 0 ${W} ${BOT + 30}`} className="vaso-regla-svg" role="group" aria-label={resumen} preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id={`agua-${uid}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3FB2F3" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="#0b3a5c" stopOpacity="0.95" />
                    </linearGradient>
                    <pattern id={`muerto-${uid}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                        <line x1="0" y1="0" x2="0" y2="7" stroke="#8fa3ba" strokeWidth="1.6" strokeOpacity="0.35" />
                    </pattern>
                    <pattern id={`sube-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="6" stroke="#3FB2F3" strokeWidth="1.6" strokeOpacity="0.8" />
                    </pattern>
                    <pattern id={`baja-${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                        <line x1="0" y1="0" x2="0" y2="6" stroke="#fbbf24" strokeWidth="1.4" strokeOpacity="0.7" />
                    </pattern>
                    <clipPath id={`tubo-${uid}`}><rect x={TX} y={TOP} width={TW} height={BOT - TOP} rx="4" /></clipPath>
                </defs>

                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={TX - 8} x2={TX + TW} y1={y(t)} y2={y(t)} stroke="#1c2b40" strokeWidth="1" />
                        <line x1={TX - 8} x2={TX} y1={y(t)} y2={y(t)} stroke="#5b708a" strokeWidth="1.4" />
                        <text x={TX - 12} y={y(t) + 4} textAnchor="end" className="vaso-regla-tick">{t}</text>
                    </g>
                ))}

                {/* tubo (zona de toque para fijar el nivel) */}
                <rect x={TX} y={TOP} width={TW} height={BOT - TOP} rx="4" fill="#06111f" stroke="#2a3d57" strokeWidth="1.2"
                    className={control ? 'vaso-regla-tubo' : undefined}
                    onPointerDown={control ? (e) => { (e.target as Element).setPointerCapture?.(e.pointerId); setArrastrando(true); desdePuntero(e.clientY); } : undefined}
                    onPointerMove={control ? (e) => { if (arrastrando) desdePuntero(e.clientY); } : undefined}
                    onPointerUp={control ? () => setArrastrando(false) : undefined} onPointerCancel={control ? () => setArrastrando(false) : undefined} />

                <g clipPath={`url(#tubo-${uid})`} pointerEvents="none">
                    {/* franja NAMO–NAME (sobrealmacenamiento) */}
                    {namo != null && name != null && <rect x={TX} y={y(name)} width={TW} height={y(namo) - y(name)} fill="rgba(251,191,36,0.10)" />}
                    {/* agua real (si se simula a la baja, solo hasta el nivel simulado) */}
                    {yBase != null && yNivel != null && (
                        <rect x={TX} y={Math.max(yBase, yNivel)} width={TW} height={BOT - Math.max(yBase, yNivel)} fill={`url(#agua-${uid})`} />
                    )}
                    {/* tramo simulado */}
                    {simulado && yBase != null && yNivel != null && (yNivel < yBase
                        ? <rect x={TX} y={yNivel} width={TW} height={yBase - yNivel} fill="rgba(63, 178, 243,0.35)" />
                        : <rect x={TX} y={yBase} width={TW} height={yNivel - yBase} fill="rgba(251,191,36,0.06)" />)}
                    {simulado && yBase != null && yNivel != null && (yNivel < yBase
                        ? <rect x={TX} y={yNivel} width={TW} height={yBase - yNivel} fill={`url(#sube-${uid})`} />
                        : <rect x={TX + 1} y={yBase} width={TW - 2} height={yNivel - yBase} fill={`url(#baja-${uid})`} stroke="#fbbf24" strokeWidth="1.4" strokeDasharray="5 3" />)}
                    {/* volumen muerto */}
                    {muerta != null && <rect x={TX} y={y(muerta)} width={TW} height={BOT - y(muerta)} fill={`url(#muerto-${uid})`} />}
                    {muerta != null && BOT - y(muerta) > 18 && <text x={TX + TW / 2} y={(y(muerta) + BOT) / 2 + 4} textAnchor="middle" className="vaso-regla-zona">Volumen muerto</text>}
                    {/* escala interior de % del volumen al NAMO */}
                    {pctVol.filter(({ e }) => [yBase, yNivel].every((yy) => yy == null || Math.abs(y(e) - yy) > 12)).map(({ p, e }) => (
                        <g key={p}>
                            <line x1={TX + TW - 12} x2={TX + TW} y1={y(e)} y2={y(e)} stroke="#e8eef6" strokeOpacity="0.6" strokeWidth="1.2" />
                            <text x={TX + TW - 15} y={y(e) + 4} textAnchor="end" className="vaso-regla-pct">{p * 100} %</text>
                        </g>
                    ))}
                </g>

                {/* cotas oficiales */}
                {(cfg?.cotas ?? []).map((c) => (
                    <line key={c.label} x1={TX - 8} x2={TX + TW + 14} y1={y(c.elev)} y2={y(c.elev)} stroke={COLOR[c.tono]} strokeWidth="1.3" strokeDasharray="5 3" pointerEvents="none" />
                ))}
                {/* lectura real */}
                {yBase != null && <line x1={TX - 8} x2={TX + TW + 14} y1={yBase} y2={yBase} stroke={simulado ? '#b4c2d4' : COLOR.info} strokeWidth={simulado ? 1.6 : 2.2} strokeDasharray={simulado ? '2 3' : undefined} pointerEvents="none" />}

                {/* nivel simulado + manija */}
                {yNivel != null && (
                    <g className="vaso-regla-sim" style={{ transform: `translateY(${yNivel}px)` }}>
                        <line x1={TX - 8} x2={TX + TW + 14} y1={0} y2={0} stroke={COLOR.info} strokeWidth="2.4" pointerEvents="none" />
                        {simulado && deltaTexto && (
                            <g pointerEvents="none">
                                <rect x={TX + 6} y={-24} width={TW - 26} height={18} rx="4" fill="#061532" fillOpacity="0.85" />
                                <text x={TX + 10} y={-11} className="vaso-regla-delta">{deltaTexto.split(' · ')[0]}</text>
                            </g>
                        )}
                        {control && (
                            <g role="slider" tabIndex={0} aria-label="Nivel simulado (msnm). Arrastra, o usa flechas ±0.1 m, Re Pág/Av Pág ±0.5 m, Esc vuelve a la lectura"
                                aria-valuemin={min} aria-valuemax={max} aria-valuenow={+nivel!.toFixed(2)}
                                aria-valuetext={`${nivel!.toFixed(2)} msnm${deltaTexto ? `, ${deltaTexto}` : ''}`}
                                className="vaso-regla-manija" onKeyDown={teclas}
                                onPointerDown={(e) => { (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setArrastrando(true); }}
                                onPointerMove={(e) => { if (arrastrando) desdePuntero(e.clientY); }}
                                onPointerUp={() => setArrastrando(false)} onPointerCancel={() => setArrastrando(false)}>
                                <rect x={TX + TW - 22} y={-22} width={44} height={44} fill="transparent" />
                                <rect x={TX + TW - 14} y={-7} width={28} height={14} rx="7" className="vaso-regla-pildora" />
                                <line x1={TX + TW - 5} x2={TX + TW - 5} y1={-3} y2={3} stroke="#061532" strokeWidth="1.4" />
                                <line x1={TX + TW + 5} x2={TX + TW + 5} y1={-3} y2={3} stroke="#061532" strokeWidth="1.4" />
                            </g>
                        )}
                    </g>
                )}

                {rots.map((r) => (
                    <g key={r.key} pointerEvents="none">
                        <polyline fill="none" stroke={r.color} strokeWidth="1" strokeOpacity="0.7" points={`${TX + TW + 14},${r.y} ${TX + TW + 24},${r.yRot} ${TX + TW + 30},${r.yRot}`} />
                        <text x={TX + TW + 34} y={r.yRot - (r.fuerte ? 8 : 2)} className={`vaso-regla-rot${r.fuerte ? ' fuerte' : ''}`} fill={r.color}>{r.label}</text>
                        <text x={TX + TW + 34} y={r.yRot + (r.fuerte ? 20 : 13)} className={`vaso-regla-val${r.fuerte ? ' fuerte' : ''}`} fill={r.fuerte ? '#e0f2fe' : '#c3d0e0'}>{r.valor}</text>
                    </g>
                ))}
                {nivelBase == null && <text x={TX + TW / 2} y={(TOP + BOT) / 2} textAnchor="middle" className="vaso-regla-sd">S/D</text>}
                <text x={TX} y={BOT + 22} className="vaso-regla-pie">msnm · escala interior: % del volumen al NAMO</text>
            </svg>
            <figcaption className="vaso-regla-fuente">{geom.fuente}</figcaption>
        </figure>
    );
}

export default memo(ReglaVivaVaso);
