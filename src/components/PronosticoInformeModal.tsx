import { useEffect, useState } from 'react';
import { X, CloudSun, Users, FlaskConical, Clock, Download, Printer, Home, Image as ImageIcon } from 'lucide-react';

export type NivelInformePronostico = 'ciudadano' | 'operativo' | 'tecnico';

export interface OpcionesInformePronostico {
    horizonteH: 24 | 48;
    /** 'ciudadano' = informe básico en lenguaje llano para cualquier persona. */
    nivel: NivelInformePronostico;
    modoTecnico: boolean;
    /** 'descargar' = archivo HTML; 'imprimir' = abre el informe y lanza imprimir/PDF; 'imagen' = PNG para compartir (solo ciudadano). */
    accion: 'descargar' | 'imprimir' | 'imagen';
}

interface PronosticoInformeModalProps {
    abierto: boolean;
    onCerrar: () => void;
    onConfirmar: (opciones: OpcionesInformePronostico) => void;
}

const ACENTO = '#38bdf8';

/**
 * Opciones previas al Informe de Pronóstico: horizonte (24/48 h), nivel de detalle
 * y salida (archivo HTML o imprimir/PDF). Mismo patrón que GeoInformeOpcionesModal:
 * controlado por `abierto`, Escape cierra, scroll del body bloqueado y el overlay
 * excluye el sidebar fijo.
 */
export function PronosticoInformeModal({ abierto, onCerrar, onConfirmar }: PronosticoInformeModalProps) {
    const [horizonteH, setHorizonteH] = useState<24 | 48>(48);
    const [nivel, setNivel] = useState<NivelInformePronostico>('operativo');

    useEffect(() => {
        if (!abierto) return;
        const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
        document.addEventListener('keydown', alPulsar);
        const overflowPrevio = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', alPulsar);
            document.body.style.overflow = overflowPrevio;
        };
    }, [abierto, onCerrar]);

    if (!abierto) return null;

    const opcion = <T,>(activo: boolean, onClick: () => void, Icono: typeof Users, label: string, desc: string, key: T) => (
        <button
            key={String(key)} type="button" onClick={onClick} aria-pressed={activo}
            className="flex items-center transition-colors"
            style={{
                gap: 10, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                border: `1px solid ${activo ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.10)'}`,
                background: activo ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.02)',
            }}
        >
            <span className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 8, flex: 'none', background: activo ? ACENTO : 'rgba(255,255,255,0.06)' }}>
                <Icono size={14} color={activo ? '#0f172a' : '#64748b'} />
            </span>
            <span style={{ flex: 1 }}>
                <span className="font-semibold block" style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#64748b' }}>{label}</span>
                <span style={{ fontSize: 9.5, color: '#64748b', display: 'block', marginTop: 1, lineHeight: 1.3 }}>{desc}</span>
            </span>
        </button>
    );

    const rotulo = (texto: string) => (
        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>{texto}</p>
    );

    const confirmar = (accion: OpcionesInformePronostico['accion']) => {
        // El informe básico siempre cubre 48 h (hoy, mañana y pasado): es lo que la gente espera ver.
        onConfirmar({ horizonteH: nivel === 'ciudadano' ? 48 : horizonteH, nivel, modoTecnico: nivel === 'tecnico', accion });
        onCerrar();
    };

    return (
        <div
            className="fixed top-0 right-0 bottom-0 left-[var(--sidebar-w,280px)] z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
            style={{ padding: 16 }} onClick={onCerrar} role="presentation"
        >
            <div
                className="glass-card shadow-2xl w-full max-w-xl border-white/10"
                style={{ padding: 0, overflow: 'hidden' }}
                onClick={(e) => e.stopPropagation()}
                role="dialog" aria-modal="true" aria-label="Opciones del Informe de Pronóstico"
            >
                <div style={{ height: 3, background: 'linear-gradient(90deg, #38bdf8, #3b82f6 45%, transparent)' }} />
                <div style={{ padding: '20px 28px 16px' }}>
                    <div className="flex justify-between items-center" style={{ marginBottom: 18 }}>
                        <div className="flex items-center" style={{ gap: 14 }}>
                            <div className="flex items-center justify-center" style={{ width: 42, height: 42, borderRadius: 12, flex: 'none', background: 'linear-gradient(140deg, #38bdf8, #2563eb)', boxShadow: '0 6px 18px -6px rgba(37,99,235,0.6)' }}>
                                <CloudSun size={20} color="#fff" />
                            </div>
                            <div>
                                <h2 className="font-black text-white uppercase" style={{ fontSize: 16, letterSpacing: '0.04em', margin: 0 }}>Informe de Pronóstico</h2>
                                <p className="font-bold uppercase" style={{ fontSize: 10, letterSpacing: '0.18em', color: '#64748b', margin: '2px 0 0' }}>Qué hacer en las próximas horas</p>
                            </div>
                        </div>
                        <button className="hover:bg-slate-800 transition-colors" style={{ padding: 8, background: 'rgba(15,23,42,0.9)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }} onClick={onCerrar} title="Cerrar">
                            <X size={16} className="text-slate-400" />
                        </button>
                    </div>

                    {nivel !== 'ciudadano' && <div style={{ marginBottom: 20 }}>
                        {rotulo('Horizonte')}
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {opcion(horizonteH === 24, () => setHorizonteH(24), Clock, 'Próximas 24 h', 'Decisiones del día: riego, aspersión y entregas', 24)}
                            {opcion(horizonteH === 48, () => setHorizonteH(48), Clock, 'Próximas 48 h', 'Incluye la ventana completa que evalúan las alertas', 48)}
                        </div>
                    </div>}

                    <div style={{ marginBottom: 6 }}>
                        {rotulo('¿Para quién es el informe?')}
                        <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 10 }}>
                            {opcion(nivel === 'ciudadano', () => setNivel('ciudadano'), Home, 'Básico', 'Para cualquier persona: mapa de módulos con su probabilidad de lluvia, hora por hora y qué esperar cada día', 'ciu')}
                            {opcion(nivel === 'operativo', () => setNivel('operativo'), Users, 'Operativo', 'Veredicto, decisiones por módulo, ventanas de riesgo y gráficas', 'op')}
                            {opcion(nivel === 'tecnico', () => setNivel('tecnico'), FlaskConical, 'Técnico', 'Añade definiciones, nubosidad y la metodología abierta', 'tec')}
                        </div>
                        <p style={{ fontSize: 10.5, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                            {nivel === 'ciudadano'
                                ? 'Informe para la ciudadanía: mapa de los módulos con su probabilidad de lluvia, hora por hora, y hoy, mañana y pasado mañana con temperatura, lluvia y viento en km/h. Se puede imprimir o compartir como imagen.'
                                : 'Todo el pronóstico es del modelo (Open-Meteo), ajustado por su error sistemático medido donde lo hay; lo observado se rotula aparte. Las estaciones con lecturas sospechosas aparecen como S/D.'}
                        </p>
                    </div>
                </div>

                <div className="flex justify-end" style={{ gap: 8, padding: '14px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.015)' }}>
                    <button type="button" onClick={onCerrar} className="font-semibold hover:text-slate-300 transition-colors" style={{ padding: '9px 16px', borderRadius: 10, fontSize: 12, color: '#94a3b8' }}>
                        Cancelar
                    </button>
                    {nivel === 'ciudadano' && (
                        <button type="button" onClick={() => confirmar('imagen')} className="font-bold transition-colors whitespace-nowrap flex items-center"
                            style={{ gap: 6, padding: '9px 16px', borderRadius: 10, fontSize: 12, color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)' }}>
                            <ImageIcon size={13} /> Imagen para compartir
                        </button>
                    )}
                    <button type="button" onClick={() => confirmar('imprimir')} className="font-bold transition-colors whitespace-nowrap flex items-center"
                        style={{ gap: 6, padding: '9px 16px', borderRadius: 10, fontSize: 12, color: '#e2e8f0', border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)' }}>
                        <Printer size={13} /> Imprimir / PDF
                    </button>
                    <button type="button" onClick={() => confirmar('descargar')} className="font-bold transition-colors whitespace-nowrap flex items-center"
                        style={{ gap: 6, padding: '9px 18px', borderRadius: 10, fontSize: 12, color: '#fff', background: 'linear-gradient(135deg, #38bdf8, #2563eb)', boxShadow: '0 6px 18px -6px rgba(37,99,235,0.55)' }}>
                        <Download size={13} /> Descargar HTML
                    </button>
                </div>
            </div>
        </div>
    );
}
