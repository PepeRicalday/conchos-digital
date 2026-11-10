import { useState } from 'react';
import { MapPin, Thermometer, Wind, Sun, CloudRain, Check, Calendar, Users, FlaskConical, TrendingUp } from 'lucide-react';
import type { OpcionesGeoInforme } from '../utils/exportClimaGeoInforme';
import { CAPAS_INFO, CAPAS_INFORME, type CapaId } from '../utils/capasCuenca';
import { getTodayString, addDays } from '../utils/dateHelpers';
import { Modal, Boton } from './ui/base';

interface GeoInformeOpcionesModalProps {
    abierto: boolean;
    onCerrar: () => void;
    onConfirmar: (opciones: OpcionesGeoInforme) => void;
}

// Acento por variable — mismos tonos que ya identifican cada magnitud en el
// resto de Clima.tsx (naranja=temperatura en quick-stat, azul=precipitación,
// verde=evapotranspiración/aire). La radiación solar toma ámbar (sol) para no
// repetir el naranja de temperatura. Son valores fijos (no clases Tailwind
// "-primary"/"-accent": esos tokens no existen en el tema de Tailwind v4 de
// este proyecto — sin un bloque @theme que los declare, cualquier utilidad
// que los use ("text-primary", "bg-primary/15", "border-primary/50") no
// genera CSS y queda inerte; se verificó en runtime con getComputedStyle
// antes de este cambio: el ícono, el botón "Generar informe" y el estado
// activo de estos chips no mostraban ningún color pese a esas clases).
const VARIABLES_UI: Array<{
    clave: OpcionesGeoInforme['variables'][number];
    label: string;
    Icono: typeof Thermometer;
    color: string;
    bg: string;
    border: string;
}> = [
    { clave: 'tempC', label: 'Temperatura', Icono: Thermometer, color: '#fb923c', bg: 'rgba(251,146,60,0.14)', border: 'rgba(251,146,60,0.45)' },
    { clave: 'vientoMs', label: 'Viento', Icono: Wind, color: '#38bdf8', bg: 'rgba(56,189,248,0.14)', border: 'rgba(56,189,248,0.45)' },
    { clave: 'radSolarWm2', label: 'Radiación solar', Icono: Sun, color: '#fbbf24', bg: 'rgba(251,191,36,0.14)', border: 'rgba(251,191,36,0.45)' },
    { clave: 'lluviaDiaMm', label: 'Precipitación', Icono: CloudRain, color: '#3b82f6', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.45)' },
];

/**
 * Modal previo a la descarga del Informe Geoclimático: elegir qué variables
 * incluir (evita archivos innecesariamente grandes/largos cuando solo
 * interesa una) y qué periodo analizar. Por defecto el periodo es "Todo el
 * histórico": el mapa y todos los apartados usan el corte actual (última
 * lectura), igual que antes. Si se fija un rango (mismo patrón de
 * input+presets que TendenciasPanel.tsx), todo el informe — mapas, KPIs,
 * veredicto, tablas — pasa a mostrar el agregado de ese periodo, y cada
 * bloque de variable añade el desglose mes a mes dentro del rango (ver
 * generarGeoInforme en Clima.tsx y climaResumenMensual.ts). Mismo patrón que
 * WindyMapModal.tsx: componente controlado por `abierto`, Escape cierra,
 * scroll del body bloqueado mientras está abierto.
 */
export function GeoInformeOpcionesModal({ abierto, onCerrar, onConfirmar }: GeoInformeOpcionesModalProps) {
    // Simple por defecto: la mayoría de quienes generan este informe son
    // personal de campo/gerencia, no auditores de datos — el detalle técnico
    // completo (badges MEDIDO/INTERPOLADO, distancias IDW en km, cobertura de
    // muestras, tabla de estaciones) sigue existiendo íntegro en modo Técnico
    // y en el acordeón de metodología de ambos modos, nunca se pierde, solo
    // deja de ser lo primero que ve alguien que no lo necesita (pedido del
    // usuario 2026-09-16: la subtabla de precipitación con 3 columnas
    // numéricas y ceros repetidos era ilegible para personal no técnico).
    const [modoTecnico, setModoTecnico] = useState(false);
    // Alcance: 'distrito' (default) = solo los 6 módulos; 'cuenca' = los 6 módulos y, además, toda la cuenca del Conchos (red JCAS + propias).
    const [alcance, setAlcance] = useState<'distrito' | 'cuenca'>('distrito');
    const [capas, setCapas] = useState<CapaId[]>([...CAPAS_INFORME]);
    const [variables, setVariables] = useState<Set<OpcionesGeoInforme['variables'][number]>>(
        new Set(['tempC', 'vientoMs', 'radSolarWm2', 'lluviaDiaMm']),
    );
    // null = "Todo el histórico" (comportamiento actual, sin filtro de
    // periodo) — mismo significado que "sin rango" en el resto del informe.
    const [periodo, setPeriodo] = useState<{ desde: string; hasta: string } | null>(null);
    // Opcional y apagado por defecto: añade a cada variable su tendencia día a
    // día (y, en lluvia, acumulado e intensidad por hora) dentro del periodo.
    // Cuesta una consulta de lecturas crudas, por eso solo se pide si se marca.
    const [incluirTendencias, setIncluirTendencias] = useState(false);

    if (!abierto) return null;

    const alternarVariable = (clave: OpcionesGeoInforme['variables'][number]) => {
        setVariables(prev => {
            const next = new Set(prev);
            if (next.has(clave)) {
                // Nunca dejar la selección vacía: un informe sin ningún mapa no
                // tiene sentido — se ignora el intento de deseleccionar la última.
                if (next.size > 1) next.delete(clave);
            } else {
                next.add(clave);
            }
            return next;
        });
    };

    const presetDias = (dias: number) => {
        const hasta = getTodayString();
        setPeriodo({ desde: addDays(hasta, -dias), hasta });
    };

    // "Hoy": desde = hasta = hoy, un rango de un solo día — sigue el mismo
    // camino de periodo explícito que 7d/30d/90d (estacionesDesdeResumenRango
    // en Clima.tsx), no el atajo de "todo el histórico" con el contador de
    // consola: para un solo día, el acumulado reconstruido desde la BD y la
    // lectura real coinciden, así que no hay divergencia que resolver aquí.
    const presetHoy = () => {
        const hoy = getTodayString();
        setPeriodo({ desde: hoy, hasta: hoy });
    };
    const esHoy = !!periodo && periodo.desde === getTodayString() && periodo.hasta === getTodayString();
    // Mismo criterio de comparación que esHoy, para los presets 7/30/90 días —
    // antes estos 3 botones no comparaban contra `periodo` en absoluto (estilo
    // hardcodeado), así que aplicar "30 d" cambiaba las fechas correctamente
    // pero ningún pill se resaltaba: el usuario no tenía forma de confirmar
    // qué preset quedó activo antes de generar el informe.
    const esPresetDias = (dias: number) =>
        !!periodo && periodo.hasta === getTodayString() && periodo.desde === addDays(getTodayString(), -dias);

    const confirmar = () => {
        if (!variables.size) return;
        onConfirmar({
            variables: Array.from(variables),
            periodoDesde: periodo?.desde,
            periodoHasta: periodo?.hasta,
            modoTecnico,
            incluirTendencias,
            alcance,
            capas,
        });
        onCerrar();
    };

    return (
        <Modal
            abierto onCerrar={onCerrar} tamano="md" cubreSidebar={false}
            titulo="Informe geoclimático" kicker="Elige qué incluir"
            icono={<MapPin size={22} aria-hidden="true" />}
            pie={<>
                <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
                <Boton variante="primario" onClick={confirmar}>Generar informe</Boton>
            </>}
        >
                    <div style={{ marginBottom: 20 }} role="radiogroup" aria-label="Alcance del informe">
                        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>
                            Alcance
                        </p>
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {([
                                { valor: 'distrito', label: 'Solo distrito', desc: 'Los 6 módulos de la SRL, como siempre' },
                                { valor: 'cuenca', label: 'Distrito y toda la cuenca', desc: 'Añade planos de lluvia, temperatura y viento de toda la cuenca del Conchos' },
                            ] as const).map(({ valor, label, desc }) => {
                                const activo = alcance === valor;
                                return (
                                    <button
                                        key={valor}
                                        type="button"
                                        role="radio"
                                        aria-checked={activo}
                                        onClick={() => setAlcance(valor)}
                                        className="transition-colors"
                                        style={{
                                            minHeight: 44, padding: '10px 12px', borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                                            border: `1px solid ${activo ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.10)'}`,
                                            background: activo ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.02)',
                                        }}
                                    >
                                        <span className="font-semibold block" style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#94a3b8' }}>{activo ? '● ' : '○ '}{label}</span>
                                        <span style={{ fontSize: 11.5, color: '#94a3b8', display: 'block', marginTop: 2, lineHeight: 1.3 }}>{desc}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {alcance === 'cuenca' && (
                            <div style={{ marginTop: 10 }} role="group" aria-label="Capas de referencia de los planos de la cuenca">
                                <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 6px' }}>Capas de referencia de los planos (se activan o no según la necesidad):</p>
                                <div className="flex flex-wrap" style={{ gap: 6 }}>
                                    {CAPAS_INFO.map((k) => {
                                        const on = capas.includes(k.id);
                                        return (
                                            <button key={k.id} type="button" aria-pressed={on} title={k.ayuda}
                                                onClick={() => setCapas(CAPAS_INFO.map((x) => x.id).filter((id) => (id === k.id ? !on : capas.includes(id))))}
                                                style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: on ? '#f1f5f9' : '#94a3b8', border: `1px solid ${on ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.12)'}`, background: on ? 'rgba(56,189,248,0.14)' : 'transparent' }}>
                                                {on ? '✓ ' : '+ '}{k.titulo}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {alcance === 'cuenca' && (
                            <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.4 }}>
                                La cuenca usa la red JCAS/UACJ y las estaciones propias (dato provisional de contexto). Su periodo es la ventana disponible más cercana al elegido (hoy, ayer, 7 o 30 días); la radiación solar no tiene red en la cuenca.
                            </p>
                        )}
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>
                            Nivel de detalle
                        </p>
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {([
                                { valor: false, label: 'Simple', Icono: Users, desc: 'KPIs, mapas y gráficas — para todo el personal' },
                                { valor: true, label: 'Técnico', Icono: FlaskConical, desc: 'Añade procedencia, distancias y cobertura de cada dato' },
                            ] as const).map(({ valor, label, Icono, desc }) => {
                                const activo = modoTecnico === valor;
                                return (
                                    <button
                                        key={label}
                                        type="button"
                                        onClick={() => setModoTecnico(valor)}
                                        className="flex items-center transition-colors"
                                        style={{
                                            gap: 10,
                                            padding: '10px 12px',
                                            borderRadius: 12,
                                            border: `1px solid ${activo ? 'rgba(56,189,248,0.45)' : 'rgba(255,255,255,0.10)'}`,
                                            background: activo ? 'rgba(56,189,248,0.14)' : 'rgba(255,255,255,0.02)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                        aria-pressed={activo}
                                    >
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 28, height: 28, borderRadius: 8, flex: 'none',
                                                background: activo ? '#38bdf8' : 'rgba(255,255,255,0.06)',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <Icono size={14} color={activo ? '#0f172a' : '#64748b'} />
                                        </span>
                                        <span style={{ flex: 1 }}>
                                            <span
                                                className="font-semibold block"
                                                style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#64748b' }}
                                            >
                                                {label}
                                            </span>
                                            <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginTop: 1, lineHeight: 1.3 }}>
                                                {desc}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <p className="font-bold uppercase" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px' }}>
                            Variables a incluir
                        </p>
                        <div className="grid grid-cols-2" style={{ gap: 10 }}>
                            {VARIABLES_UI.map(({ clave, label, Icono, color, bg, border }) => {
                                const activo = variables.has(clave);
                                return (
                                    <button
                                        key={clave}
                                        type="button"
                                        onClick={() => alternarVariable(clave)}
                                        className="flex items-center transition-colors"
                                        style={{
                                            gap: 10,
                                            padding: '10px 12px',
                                            borderRadius: 12,
                                            border: `1px solid ${activo ? border : 'rgba(255,255,255,0.10)'}`,
                                            background: activo ? bg : 'rgba(255,255,255,0.02)',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                        aria-pressed={activo}
                                    >
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 28, height: 28, borderRadius: 8, flex: 'none',
                                                background: activo ? color : 'rgba(255,255,255,0.06)',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            <Icono size={14} color={activo ? '#0f172a' : '#64748b'} />
                                        </span>
                                        <span
                                            className="font-semibold"
                                            style={{ fontSize: 12.5, color: activo ? '#f1f5f9' : '#64748b', flex: 1 }}
                                        >
                                            {label}
                                        </span>
                                        <span
                                            className="flex items-center justify-center"
                                            style={{
                                                width: 18, height: 18, borderRadius: '50%', flex: 'none',
                                                border: `1.5px solid ${activo ? color : 'rgba(255,255,255,0.18)'}`,
                                                background: activo ? color : 'transparent',
                                            }}
                                        >
                                            {activo && <Check size={12} color="#0f172a" strokeWidth={3} />}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <p style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                            Cada variable incluye el mapa del corte (o del periodo elegido abajo) y su evolución mensual (promedio; acumulado en precipitación). Menos variables = archivo más ligero.
                        </p>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <button
                            type="button"
                            onClick={() => setIncluirTendencias(v => !v)}
                            className="flex items-center transition-colors w-full"
                            style={{
                                gap: 10,
                                padding: '10px 12px',
                                borderRadius: 12,
                                border: `1px solid ${incluirTendencias ? 'rgba(52,211,153,0.45)' : 'rgba(255,255,255,0.10)'}`,
                                background: incluirTendencias ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.02)',
                                cursor: 'pointer',
                                textAlign: 'left',
                            }}
                            role="switch"
                            aria-checked={incluirTendencias}
                        >
                            <span
                                className="flex items-center justify-center"
                                style={{
                                    width: 28, height: 28, borderRadius: 8, flex: 'none',
                                    background: incluirTendencias ? '#34d399' : 'rgba(255,255,255,0.06)',
                                    transition: 'background 0.15s',
                                }}
                            >
                                <TrendingUp size={14} color={incluirTendencias ? '#0f172a' : '#64748b'} />
                            </span>
                            <span style={{ flex: 1 }}>
                                <span className="font-semibold block" style={{ fontSize: 12.5, color: incluirTendencias ? '#f1f5f9' : '#64748b' }}>
                                    Incluir gráficas de tendencias
                                </span>
                                <span style={{ fontSize: 11, color: '#64748b', display: 'block', marginTop: 1, lineHeight: 1.3 }}>
                                    Evolución día a día de cada variable dentro del periodo; en precipitación añade acumulado, día pico e intensidad por hora. Útil en temporal.
                                </span>
                            </span>
                            <span
                                className="flex items-center justify-center"
                                style={{
                                    width: 18, height: 18, borderRadius: '50%', flex: 'none',
                                    border: `1.5px solid ${incluirTendencias ? '#34d399' : 'rgba(255,255,255,0.18)'}`,
                                    background: incluirTendencias ? '#34d399' : 'transparent',
                                }}
                            >
                                {incluirTendencias && <Check size={12} color="#0f172a" strokeWidth={3} />}
                            </span>
                        </button>
                    </div>

                    <div style={{ marginBottom: 4 }}>
                        <p className="font-bold uppercase flex items-center" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 10px', gap: 6 }}>
                            <Calendar size={13} /> Periodo del informe
                        </p>
                        <div className="flex items-center flex-wrap" style={{ gap: 8, marginBottom: 10 }}>
                            <button
                                type="button"
                                onClick={() => setPeriodo(null)}
                                className="font-semibold transition-colors"
                                style={{
                                    padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                    border: `1px solid ${!periodo ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                    background: !periodo ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.03)',
                                    color: !periodo ? '#7dd3fc' : '#94a3b8',
                                }}
                            >
                                Todo el histórico
                            </button>
                            <button
                                type="button"
                                onClick={presetHoy}
                                className="font-semibold transition-colors"
                                style={{
                                    padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                    border: `1px solid ${esHoy ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                    background: esHoy ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.03)',
                                    color: esHoy ? '#7dd3fc' : '#94a3b8',
                                }}
                            >
                                Hoy
                            </button>
                            {[7, 30, 90].map(dias => {
                                const activo = esPresetDias(dias);
                                return (
                                    <button
                                        key={dias}
                                        type="button"
                                        onClick={() => presetDias(dias)}
                                        className="font-semibold transition-colors"
                                        style={{
                                            padding: '6px 12px', borderRadius: 999, fontSize: 11.5,
                                            border: `1px solid ${activo ? 'rgba(56,189,248,0.5)' : 'rgba(255,255,255,0.12)'}`,
                                            background: activo ? 'rgba(56,189,248,0.16)' : 'rgba(255,255,255,0.03)',
                                            color: activo ? '#7dd3fc' : '#94a3b8',
                                        }}
                                    >
                                        {dias} d
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex items-center flex-wrap" style={{ gap: 12 }}>
                            <label className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#94a3b8' }}>
                                Desde
                                <input
                                    type="date"
                                    value={periodo?.desde ?? ''}
                                    max={periodo?.hasta ?? getTodayString()}
                                    onChange={e => setPeriodo({ desde: e.target.value, hasta: periodo?.hasta ?? getTodayString() })}
                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(15,23,42,0.9)', color: '#f1f5f9', fontSize: 11.5 }}
                                />
                            </label>
                            <label className="flex items-center" style={{ gap: 6, fontSize: 11.5, color: '#94a3b8' }}>
                                Hasta
                                <input
                                    type="date"
                                    value={periodo?.hasta ?? ''}
                                    min={periodo?.desde}
                                    max={getTodayString()}
                                    onChange={e => setPeriodo({ desde: periodo?.desde ?? e.target.value, hasta: e.target.value })}
                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(15,23,42,0.9)', color: '#f1f5f9', fontSize: 11.5 }}
                                />
                            </label>
                        </div>
                        <p style={{ fontSize: 11, color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                            {periodo
                                ? 'El informe mostrará el promedio (o acumulado, en precipitación) global del rango elegido, además del desglose mes a mes dentro de ese rango.'
                                : 'Todo el histórico: el informe mostrará el promedio (o acumulado, en precipitación) desde el primer dato de la red hasta hoy — no solo la lectura del día en que se genera.'}
                        </p>
                    </div>
        </Modal>
    );
}
