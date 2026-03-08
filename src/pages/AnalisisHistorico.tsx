import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { IterationCcw } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Line, LineChart } from 'recharts';
import { parseISO, endOfMonth, format } from 'date-fns';
import { toast } from 'sonner';

import './AnalisisHistorico.css';

// Tooltip personalizado para integrar los dos años
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="ah-custom-tooltip">
                <div className="ah-custom-tooltip-title">
                    Día {label || '--'}
                </div>
                {payload.map((entry: any, index: number) => {
                    if (entry.value == null) return null;
                    return (
                        <div key={index} className="ah-custom-tooltip-item" style={{ color: entry.color }}>
                            <span>{entry.name}:</span>
                            <strong>{Number(entry.value).toFixed(2)} {entry.unit}</strong>
                        </div>
                    );
                })}
            </div>
        );
    }
    return null;
};

const AnalisisHistorico = () => {
    const currentYear = new Date().getFullYear();
    const [year1, setYear1] = useState<number>(currentYear);
    const [year2, setYear2] = useState<number | 'none'>('none');
    const [year3, setYear3] = useState<number | 'none'>('none');
    const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
    const [loading, setLoading] = useState(false);

    const [combinedData, setCombinedData] = useState<any[]>([]);
    const [stats, setStats] = useState<any>(null);

    const startYear = 2020;
    const years = Array.from({ length: currentYear - startYear + 1 }, (_, i) => currentYear - i);
    const months = [
        { v: 1, l: 'Enero' }, { v: 2, l: 'Febrero' }, { v: 3, l: 'Marzo' }, { v: 4, l: 'Abril' },
        { v: 5, l: 'Mayo' }, { v: 6, l: 'Junio' }, { v: 7, l: 'Julio' }, { v: 8, l: 'Agosto' },
        { v: 9, l: 'Septiembre' }, { v: 10, l: 'Octubre' }, { v: 11, l: 'Noviembre' }, { v: 12, l: 'Diciembre' }
    ];

    const loadData = async () => {
        setLoading(true);
        try {
            // -- FETCH AÑO 1 --
            const startDate1 = `${year1}-${month.toString().padStart(2, '0')}-01`;
            const endDateObj1 = endOfMonth(parseISO(startDate1));
            const endDate1 = format(endDateObj1, 'yyyy-MM-dd');

            const { data: data1, error: error1 } = await supabase
                .from('lecturas_presas')
                .select('*')
                .gte('fecha', startDate1)
                .lte('fecha', endDate1)
                .order('fecha', { ascending: true });

            if (error1) throw error1;

            const boquilla1 = data1.filter(d => d.presa_id === 'PRE-001');
            const madero1 = data1.filter(d => d.presa_id === 'PRE-002');

            // -- FETCH AÑO 2 (Opcional) --
            let boquilla2: any[] = [];
            let madero2: any[] = [];

            if (year2 !== 'none') {
                const startDate2 = `${year2}-${month.toString().padStart(2, '0')}-01`;
                const endDate2 = format(endOfMonth(parseISO(startDate2)), 'yyyy-MM-dd');
                const { data: data2 } = await supabase.from('lecturas_presas').select('*').gte('fecha', startDate2).lte('fecha', endDate2).order('fecha', { ascending: true });
                boquilla2 = (data2 || []).filter(d => d.presa_id === 'PRE-001');
                madero2 = (data2 || []).filter(d => d.presa_id === 'PRE-002');
            }

            // -- FETCH AÑO 3 (Opcional) --
            let boquilla3: any[] = [];
            let madero3: any[] = [];

            if (year3 !== 'none') {
                const startDate3 = `${year3}-${month.toString().padStart(2, '0')}-01`;
                const endDate3 = format(endOfMonth(parseISO(startDate3)), 'yyyy-MM-dd');
                const { data: data3 } = await supabase.from('lecturas_presas').select('*').gte('fecha', startDate3).lte('fecha', endDate3).order('fecha', { ascending: true });
                boquilla3 = (data3 || []).filter(d => d.presa_id === 'PRE-001');
                madero3 = (data3 || []).filter(d => d.presa_id === 'PRE-002');
            }

            // -- COMBINACIÓN DIARIA (1 a 31) --
            const combined = [];
            const maxDays = 31; // Simplificamos al máximo del mes

            for (let i = 1; i <= maxDays; i++) {
                const dayStr = i.toString().padStart(2, '0');
                const monStr = month.toString().padStart(2, '0');

                const bDay1 = boquilla1.find(d => d.fecha === `${year1}-${monStr}-${dayStr}`);
                const mDay1 = madero1.find(d => d.fecha === `${year1}-${monStr}-${dayStr}`);

                let req: any = {
                    dia: i,
                    boqVol1: bDay1 ? bDay1.almacenamiento_mm3 : null,
                    boqEscala1: bDay1 ? bDay1.escala_msnm : null,
                    boqExt1: bDay1 ? bDay1.extraccion_total_m3s : null,
                    boqPct1: bDay1 ? bDay1.porcentaje_llenado : null,
                    madVol1: mDay1 ? mDay1.almacenamiento_mm3 : null,
                    madEscala1: mDay1 ? mDay1.escala_msnm : null,
                    madExt1: mDay1 ? mDay1.extraccion_total_m3s : null,
                    madPct1: mDay1 ? mDay1.porcentaje_llenado : null,
                };

                if (year2 !== 'none') {
                    const bDay2 = boquilla2.find(d => d.fecha === `${year2}-${monStr}-${dayStr}`);
                    const mDay2 = madero2.find(d => d.fecha === `${year2}-${monStr}-${dayStr}`);
                    req = {
                        ...req,
                        boqVol2: bDay2?.almacenamiento_mm3, boqEscala2: bDay2?.escala_msnm, boqExt2: bDay2?.extraccion_total_m3s, boqPct2: bDay2?.porcentaje_llenado,
                        madVol2: mDay2?.almacenamiento_mm3, madEscala2: mDay2?.escala_msnm, madExt2: mDay2?.extraccion_total_m3s, madPct2: mDay2?.porcentaje_llenado,
                    };
                }

                if (year3 !== 'none') {
                    const bDay3 = boquilla3.find(d => d.fecha === `${year3}-${monStr}-${dayStr}`);
                    const mDay3 = madero3.find(d => d.fecha === `${year3}-${monStr}-${dayStr}`);
                    req = {
                        ...req,
                        boqVol3: bDay3?.almacenamiento_mm3, boqEscala3: bDay3?.escala_msnm, boqExt3: bDay3?.extraccion_total_m3s, boqPct3: bDay3?.porcentaje_llenado,
                        madVol3: mDay3?.almacenamiento_mm3, madEscala3: mDay3?.escala_msnm, madExt3: mDay3?.extraccion_total_m3s, madPct3: mDay3?.porcentaje_llenado,
                    };
                }

                // Push only if we have data for at least one year on this day
                if (req.boqVol1 || req.boqVol2 || req.boqVol3 || req.madVol1 || req.madVol2 || req.madVol3) {
                    combined.push(req);
                }
            }

            setCombinedData(combined);

            // -- CÁLCULO DE ESTADÍSTICAS --
            const calcStats = (boq: any[], mad: any[]) => {
                if (boq.length === 0 && mad.length === 0) return null;
                const bStart = boq[0]?.almacenamiento_mm3 || 0;
                const bEnd = boq[boq.length - 1]?.almacenamiento_mm3 || 0;
                const mStart = mad[0]?.almacenamiento_mm3 || 0;
                const mEnd = mad[mad.length - 1]?.almacenamiento_mm3 || 0;

                const bPctAvg = boq.length ? boq.reduce((acc, curr) => acc + (curr.porcentaje_llenado || 0), 0) / boq.length : 0;
                const mPctAvg = mad.length ? mad.reduce((acc, curr) => acc + (curr.porcentaje_llenado || 0), 0) / mad.length : 0;

                return {
                    bDif: bEnd - bStart,
                    mDif: mEnd - mStart,
                    bExtAvg: boq.length ? boq.reduce((acc, curr) => acc + (curr.extraccion_total_m3s || 0), 0) / boq.length : 0,
                    mExtAvg: mad.length ? mad.reduce((acc, curr) => acc + (curr.extraccion_total_m3s || 0), 0) / mad.length : 0,
                    bPctAvg,
                    mPctAvg
                };
            };

            setStats({
                y1: calcStats(boquilla1, madero1),
                y2: year2 !== 'none' ? calcStats(boquilla2, madero2) : null,
                y3: year3 !== 'none' ? calcStats(boquilla3, madero3) : null
            });

        } catch (error: any) {
            toast.error("Error al cargar historia: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [year1, year2, year3, month]);

    const isComparing2 = year2 !== 'none';
    const isComparing3 = year3 !== 'none';
    const sparkData = Array.from({ length: 15 }).map(() => ({ val: Math.random() * 10 }));

    return (
        <div className="analisis-historico-container">
            <header className="ah-header">
                <div>
                    <h1 className="ah-title">ANÁLISIS COMPARATIVO HISTÓRICO</h1>
                    <div className="ah-controls-row">
                        <div className="ah-control-group">
                            <span className="ah-control-label">MES ALINEADO</span>
                            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="ah-select">
                                {months.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                            </select>
                        </div>
                        <div className="ah-control-group">
                            <span className="ah-control-label">AÑO BASE</span>
                            <select value={year1} onChange={(e) => setYear1(Number(e.target.value))} className="ah-select" style={{ borderLeft: '3px solid #38bdf8' }}>
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="ah-control-group">
                            <span className="ah-control-label" style={{ color: '#a78bfa' }}>AÑO A COMPARAR (Capa 2)</span>
                            <select value={year2} onChange={(e) => setYear2(e.target.value === 'none' ? 'none' : Number(e.target.value))} className="ah-select" style={{ borderLeft: isComparing2 ? '3px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)' }}>
                                <option value="none">-- 2da Capa --</option>
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="ah-control-group">
                            <span className="ah-control-label" style={{ color: '#10b981' }}>TENDENCIA HISTÓRICA (Capa 3)</span>
                            <select value={year3} onChange={(e) => setYear3(e.target.value === 'none' ? 'none' : Number(e.target.value))} className="ah-select" style={{ borderLeft: isComparing3 ? '3px solid #10b981' : '1px solid rgba(255,255,255,0.1)' }}>
                                <option value="none">-- 3ra Capa --</option>
                                {years.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                        <div className="ah-auto-detect-info">
                            <IterationCcw size={14} style={{ display: 'inline', marginBottom: '-2px', marginRight: '4px' }} />
                            {isComparing2 || isComparing3 ? 'Modo Tridimensional Multi-Año activado.' : 'Selecciona más años para analizar.'}
                        </div>
                    </div>
                </div>
                <div className="ah-logos">
                    <img src="/logos/SICA005.png" alt="SICA 005" />
                </div>
            </header>

            {loading ? (
                <div className="ah-loader-wrapper">
                    <span style={{ color: '#38bdf8', letterSpacing: '2px', fontWeight: 'bold' }}>SINCRONIZANDO VECTORES TEMPORALES...</span>
                </div>
            ) : combinedData.length === 0 ? (
                <div className="ah-empty-state">
                    <h3>Sin registros para los periodos seleccionados.</h3>
                    <p>Revise la base de datos o importe los folios de Excel oficiales.</p>
                </div>
            ) : (
                <>
                    <div className="ah-top-cards">
                        {/* BOQUILLA */}
                        <div className="ah-neon-card blue">
                            <div className="ah-card-title">Δ VOLUMEN: BOQUILLA</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: '100%' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                    <div className="ah-card-value">
                                        {stats?.y1?.bDif > 0 ? '+' : ''}{stats?.y1?.bDif?.toFixed(1) || '0.0'}
                                        <span className="ah-card-unit">Mm³ <small style={{ fontSize: '0.5em', opacity: 0.6 }}>{year1}</small></span>
                                    </div>
                                    {isComparing2 && (
                                        <div className="ah-card-value" style={{ fontSize: '1.2rem', color: '#a78bfa', marginTop: '0.2rem' }}>
                                            {stats?.y2?.bDif > 0 ? '+' : ''}{stats?.y2?.bDif?.toFixed(1) || '0.0'}
                                            <span className="ah-card-unit" style={{ fontSize: '0.6rem' }}>Mm³ <small>{year2}</small></span>
                                        </div>
                                    )}
                                    {isComparing3 && (
                                        <div className="ah-card-value" style={{ fontSize: '1.2rem', color: '#10b981', marginTop: '0.2rem' }}>
                                            {stats?.y3?.bDif > 0 ? '+' : ''}{stats?.y3?.bDif?.toFixed(1) || '0.0'}
                                            <span className="ah-card-unit" style={{ fontSize: '0.6rem' }}>Mm³ <small>{year3}</small></span>
                                        </div>
                                    )}
                                </div>
                                <div className="ah-sparkline-container" style={{ width: '40%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={sparkData}>
                                            <Line type="monotone" dataKey="val" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* MADERO */}
                        <div className="ah-neon-card yellow">
                            <div className="ah-card-title">Δ VOLUMEN: MADERO</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', height: '100%' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                    <div className="ah-card-value">
                                        {stats?.y1?.mDif > 0 ? '+' : ''}{stats?.y1?.mDif?.toFixed(1) || '0.0'}
                                        <span className="ah-card-unit">Mm³ <small style={{ fontSize: '0.5em', opacity: 0.6 }}>{year1}</small></span>
                                    </div>
                                    {isComparing2 && (
                                        <div className="ah-card-value" style={{ fontSize: '1.2rem', color: '#f43f5e', marginTop: '0.2rem' }}>
                                            {stats?.y2?.mDif > 0 ? '+' : ''}{stats?.y2?.mDif?.toFixed(1) || '0.0'}
                                            <span className="ah-card-unit" style={{ fontSize: '0.6rem' }}>Mm³ <small>{year2}</small></span>
                                        </div>
                                    )}
                                    {isComparing3 && (
                                        <div className="ah-card-value" style={{ fontSize: '1.2rem', color: '#f59e0b', marginTop: '0.2rem' }}>
                                            {stats?.y3?.mDif > 0 ? '+' : ''}{stats?.y3?.mDif?.toFixed(1) || '0.0'}
                                            <span className="ah-card-unit" style={{ fontSize: '0.6rem' }}>Mm³ <small>{year3}</small></span>
                                        </div>
                                    )}
                                </div>
                                <div className="ah-sparkline-container" style={{ width: '40%' }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={sparkData}>
                                            <Line type="monotone" dataKey="val" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>

                        {/* EXTRACCIÓN */}
                        <div className="ah-neon-card green">
                            <div className="ah-card-title">PORCENTAJE DE LLENADO (%)</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', height: '100%', marginTop: '0.5rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', width: '100%' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.2rem' }}>
                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Año {year1}</span>
                                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Boq: <span style={{ color: '#38bdf8' }}>{stats?.y1?.bPctAvg?.toFixed(1)}%</span> | Mad: <span style={{ color: '#fbbf24' }}>{stats?.y1?.mPctAvg?.toFixed(1)}%</span></span>
                                    </div>
                                    {isComparing2 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.2rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: '#a78bfa' }}>Año {year2}</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Boq: <span style={{ color: '#a78bfa' }}>{stats?.y2?.bPctAvg?.toFixed(1)}%</span> | Mad: <span style={{ color: '#f43f5e' }}>{stats?.y2?.mPctAvg?.toFixed(1)}%</span></span>
                                        </div>
                                    )}
                                    {isComparing3 && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '0.2rem' }}>
                                            <span style={{ fontSize: '0.7rem', color: '#10b981' }}>Año {year3}</span>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>Boq: <span style={{ color: '#10b981' }}>{stats?.y3?.bPctAvg?.toFixed(1)}%</span> | Mad: <span style={{ color: '#f59e0b' }}>{stats?.y3?.mPctAvg?.toFixed(1)}%</span></span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="ah-main-grid">

                        {/* HUELLA HIDROLOGICA */}
                        <div className="ah-chart-card ah-main-chart-area">
                            <div className="ah-chart-card-header" style={{ alignItems: 'flex-start' }}>
                                <h2 className="ah-chart-title">COMPARATIVA DE HUELLA HIDROLÓGICA</h2>
                                <div className="ah-chart-legend" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <div className="ah-legend-item"><div className="ah-legend-color blue" /><span>Boq {year1}</span></div>
                                        <div className="ah-legend-item"><div className="ah-legend-color yellow" /><span>Mad {year1}</span></div>
                                    </div>
                                    {isComparing2 && (
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <div className="ah-legend-item"><div className="ah-legend-color purple" style={{ backgroundColor: '#a78bfa', boxShadow: '0 0 5px #a78bfa' }} /><span>Boq {year2}</span></div>
                                            <div className="ah-legend-item"><div className="ah-legend-color red" style={{ backgroundColor: '#f43f5e', boxShadow: '0 0 5px #f43f5e' }} /><span>Mad {year2}</span></div>
                                        </div>
                                    )}
                                    {isComparing3 && (
                                        <div style={{ display: 'flex', gap: '1rem' }}>
                                            <div className="ah-legend-item"><div className="ah-legend-color green" style={{ backgroundColor: '#10b981', boxShadow: '0 0 5px #10b981' }} /><span>Boq {year3}</span></div>
                                            <div className="ah-legend-item"><div className="ah-legend-color mix" style={{ backgroundColor: '#f59e0b', boxShadow: '0 0 5px #f59e0b' }} /><span>Mad {year3}</span></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ flex: 1, minHeight: '350px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={combinedData} margin={{ top: 20, right: 30, left: 10, bottom: 20 }}>
                                        <defs>
                                            <linearGradient id="gBoq1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.6} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0.0} /></linearGradient>
                                            <linearGradient id="gMad1" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fbbf24" stopOpacity={0.6} /><stop offset="95%" stopColor="#fbbf24" stopOpacity={0.0} /></linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={true} />
                                        <XAxis dataKey="dia" stroke="rgba(255,255,255,0.3)" tick={{ fill: '#94a3b8', fontSize: 11 }} label={{ value: 'Día del Mes', position: 'bottom', fill: '#94a3b8', fontSize: 12, dy: 10 }} />
                                        <YAxis yAxisId="left" stroke="rgba(255,255,255,0.3)" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 3000]} />
                                        <YAxis yAxisId="right" orientation="right" stroke="rgba(255,255,255,0.3)" tick={{ fill: '#94a3b8', fontSize: 11 }} domain={[0, 400]} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />

                                        {/* Year 3 (Bottom-layer) */}
                                        {isComparing3 && <Line yAxisId="left" type="monotone" dataKey="boqVol3" name={`Boquilla ${year3}`} unit="Mm³" stroke="#10b981" strokeDasharray="3 3" strokeWidth={2} dot={false} connectNulls />}
                                        {isComparing3 && <Line yAxisId="right" type="monotone" dataKey="madVol3" name={`Madero ${year3}`} unit="Mm³" stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={2} dot={false} connectNulls />}

                                        {/* Year 2 (Sub-layer) */}
                                        {isComparing2 && <Line yAxisId="left" type="monotone" dataKey="boqVol2" name={`Boquilla ${year2}`} unit="Mm³" stroke="#a78bfa" strokeDasharray="5 5" strokeWidth={2} dot={{ r: 2, fill: '#a78bfa' }} connectNulls />}
                                        {isComparing2 && <Line yAxisId="right" type="monotone" dataKey="madVol2" name={`Madero ${year2}`} unit="Mm³" stroke="#f43f5e" strokeDasharray="5 5" strokeWidth={2} dot={{ r: 2, fill: '#f43f5e' }} connectNulls />}

                                        {/* Year 1 (Top-layer Area) */}
                                        <Area yAxisId="left" type="monotone" dataKey="boqVol1" name={`Boquilla ${year1}`} unit="Mm³" stroke="#38bdf8" strokeWidth={3} fill="url(#gBoq1)" activeDot={{ r: 6, fill: '#38bdf8' }} connectNulls />
                                        <Area yAxisId="right" type="monotone" dataKey="madVol1" name={`Madero ${year1}`} unit="Mm³" stroke="#fbbf24" strokeWidth={3} fill="url(#gMad1)" activeDot={{ r: 6, fill: '#fbbf24' }} connectNulls />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* VARIACION DE ESCALAS */}
                        <div className="ah-chart-card ah-sub-chart">
                            <div className="ah-chart-card-header pb-0">
                                <h2 className="ah-chart-title">ELEVACIÓN (M.S.N.M.)</h2>
                            </div>
                            <div style={{ flex: 1, marginTop: '1rem' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={combinedData} margin={{ top: 5, right: 0, left: 10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="dia" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                                        <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['dataMin - 0.2', 'dataMax + 0.2']} />
                                        <YAxis yAxisId="right" orientation="right" hide domain={['dataMin - 0.2', 'dataMax + 0.2']} />
                                        <Tooltip content={<CustomTooltip />} />

                                        {isComparing3 && <Line yAxisId="left" type="stepAfter" dataKey="boqEscala3" name={`Escala Boq ${year3}`} unit="m" stroke="#10b981" strokeDasharray="3 3" strokeWidth={1} dot={false} connectNulls />}
                                        {isComparing3 && <Line yAxisId="right" type="stepAfter" dataKey="madEscala3" name={`Escala Mad ${year3}`} unit="m" stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} dot={false} connectNulls />}
                                        {isComparing2 && <Line yAxisId="left" type="stepAfter" dataKey="boqEscala2" name={`Escala Boq ${year2}`} unit="m" stroke="#a78bfa" strokeDasharray="3 3" strokeWidth={2} dot={false} connectNulls />}
                                        {isComparing2 && <Line yAxisId="right" type="stepAfter" dataKey="madEscala2" name={`Escala Mad ${year2}`} unit="m" stroke="#f43f5e" strokeDasharray="3 3" strokeWidth={2} dot={false} connectNulls />}
                                        <Line yAxisId="left" type="stepAfter" dataKey="boqEscala1" name={`Escala Boq ${year1}`} unit="m" stroke="#38bdf8" strokeWidth={3} dot={false} connectNulls />
                                        <Line yAxisId="right" type="stepAfter" dataKey="madEscala1" name={`Escala Mad ${year1}`} unit="m" stroke="#fbbf24" strokeWidth={3} dot={false} connectNulls />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* ESFUERZO DE EXTRACCION - AHORA PORCENTAJE % */}
                        <div className="ah-chart-card ah-sub-chart">
                            <div className="ah-chart-card-header pb-0">
                                <h2 className="ah-chart-title">COMPARATIVA DE LLENADO (%)</h2>
                            </div>
                            <div style={{ flex: 1, marginTop: '1rem' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={combinedData} margin={{ top: 5, right: 0, left: 10, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                        <XAxis dataKey="dia" tickLine={false} axisLine={false} tick={{ fill: '#64748b', fontSize: 10 }} />
                                        <YAxis tickLine={false} axisLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} domain={[0, 100]} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />

                                        {isComparing3 && <Line type="monotone" dataKey="boqPct3" name={`Boq % ${year3}`} unit="%" stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" dot={false} />}
                                        {isComparing3 && <Line type="monotone" dataKey="madPct3" name={`Mad % ${year3}`} unit="%" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} />}
                                        {isComparing2 && <Line type="monotone" dataKey="boqPct2" name={`Boq % ${year2}`} unit="%" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 5" dot={false} />}
                                        {isComparing2 && <Line type="monotone" dataKey="madPct2" name={`Mad % ${year2}`} unit="%" stroke="#f43f5e" strokeWidth={2} strokeDasharray="5 5" dot={false} />}
                                        <Line type="monotone" dataKey="boqPct1" name={`Boq % ${year1}`} unit="%" stroke="#22d3ee" strokeWidth={3} dot={{ r: 2 }} />
                                        <Line type="monotone" dataKey="madPct1" name={`Mad % ${year1}`} unit="%" stroke="#34d399" strokeWidth={3} dot={{ r: 2 }} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                    </div>
                </>
            )}
        </div>
    );
};

export default AnalisisHistorico;
