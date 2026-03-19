import React, { useState, useEffect, useMemo } from 'react';
import { 
  Settings, 
  Activity, 
  Database, 
  Map as MapIcon, 
  Zap, 
  Layers, 
  AlertCircle,
  Download,
  Box,
  TrendingDown
} from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import { supabase } from '../lib/supabase';
import './ModelingDashboard.css';

interface CanalSegment {
    km_inicio: number;
    km_fin: number;
    plantilla_m: number;
    talud_z: number;
    pendiente_s0: number;
    rugosidad_n: number;
    tirante_diseno_m: number;
}

const ModelingDashboard: React.FC = () => {
  // State
  const [segments, setSegments] = useState<CanalSegment[]>([]);
  const [q, setQ] = useState(60);
  const [qRef, setQRef] = useState(40); // Baseline comparison
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSimulation, setIsSimulation] = useState(true);
  const [gateOpening, setGateOpening] = useState(85);
  
  // ── 1. Fetch Geometry from DB ──
  useEffect(() => {
    const fetchGeometry = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('perfil_hidraulico_canal')
        .select('*')
        .order('km_inicio', { ascending: true });
      
      if (data) setSegments(data);
      setLoading(false);
    };
    fetchGeometry();
  }, []);

  // ── 2. Hydraulic Model (Local Approximation - Manning) ──
  const calculateProfile = (flow: number) => {
    if (segments.length === 0) return [];
    return segments.map(s => {
      const q_ratio = flow / 60;
      const y_normal = s.tirante_diseno_m * Math.pow(q_ratio, 0.6);
      return {
        km: s.km_inicio,
        y: parseFloat(y_normal.toFixed(2)),
        z_fondo: 0.1,
        h_energia: y_normal + 0.3
      };
    });
  };

  const profileData = useMemo(() => calculateProfile(q), [segments, q]);
  const compareData = useMemo(() => calculateProfile(qRef), [segments, qRef]);

  // ── 3. Chart Configuration ──
  const getProfileOption = () => {
    if (profileData.length === 0) return {};

    const series = [
      {
        name: 'Línea de Energía (H)',
        type: 'line',
        smooth: true,
        data: profileData.map(p => p.h_energia),
        lineStyle: { color: '#f59e0b', width: 1, type: 'dashed' },
        symbol: 'none'
      },
      {
        name: compareEnabled ? 'Perfil Simulado (Q)' : 'Tirante de Agua (y)',
        type: 'line',
        smooth: true,
        data: profileData.map(p => p.y),
        lineStyle: { color: '#22d3ee', width: 3 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(34, 211, 238, 0.3)' },
              { offset: 1, color: 'rgba(34, 211, 238, 0)' }
            ]
          }
        },
        animationDuration: 1000,
        symbol: 'none'
      },
      {
        name: 'Fondo del Canal',
        type: 'line',
        step: 'end',
        data: profileData.map(p => p.z_fondo),
        lineStyle: { color: '#475569', width: 2 },
        symbol: 'none'
      }
    ];

    if (compareEnabled) {
      series.push({
        name: 'Perfil Referencia (Q-Ref)',
        type: 'line',
        smooth: true,
        data: compareData.map(p => p.y),
        lineStyle: { color: '#94a3b8', width: 2, type: 'dotted' },
        symbol: 'none'
      } as any);
    }

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' }
      },
      legend: {
        data: ['Línea de Energía (H)', compareEnabled ? 'Perfil Simulado (Q)' : 'Tirante de Agua (y)', 'Perfil Referencia (Q-Ref)', 'Fondo del Canal'],
        textStyle: { color: '#94a3b8', fontSize: 10, fontWeight: 700 },
        bottom: 0
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '10%', containLabel: true },
      xAxis: {
        type: 'category',
        data: profileData.map(p => p.km.toFixed(1)),
        axisLine: { lineStyle: { color: '#334155' } },
        axisLabel: { color: '#64748b', fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 5,
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: { color: '#64748b', fontSize: 10 }
      },
      dataZoom: [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', bottom: 35, height: 15, borderColor: 'transparent', fillerColor: 'rgba(34, 211, 238, 0.1)' }],
      series
    };
  };

  return (
    <div className="modeling-dashboard">
      <header className="modeling-header">
        <div className="modeling-title">
          <div style={{ background: 'rgba(34, 211, 238, 0.15)', padding: '8px', borderRadius: '12px', border: '1px solid rgba(34, 211, 238, 0.3)' }}>
            <Activity size={20} className="text-cyan-400" />
          </div>
          <div>
            <h2>Modelación de Flujos e Inteligencia Hídrica</h2>
            <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                <span style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>Canal Principal Conchos</span>
                <span style={{ fontSize: '0.6rem', color: '#22d3ee', fontWeight: 800, textTransform: 'uppercase' }}>• Motor Hydra v1.1</span>
            </div>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '4px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
             <div style={{ width: 8, height: 8, background: '#22d3ee', borderRadius: '50%', boxShadow: '0 0 10px #22d3ee' }}></div>
             <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8' }}>MODO: {isSimulation ? 'SIMULACIÓN' : 'TIEMPO REAL'}</span>
          </div>
          <button className="export-btn" style={{ marginTop: 0, padding: '8px 16px', fontSize: '0.65rem' }}>
             <Download size={14} style={{ marginRight: 8 }} />
             Exportar Reporte
          </button>
        </div>
      </header>

      <main className="modeling-main">
        {/* PANEL 1: CONFIGURACIÓN (IZQ) */}
        <section className="modeling-panel">
          <div className="panel-header">
            <Settings size={16} className="text-slate-400" />
            <h3>Parámetros de Entrada</h3>
          </div>
          <div className="panel-content">
            
            <div className="control-group">
              <label className="control-label">Origen de Datos</label>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                 <button className="modeling-input" style={{ flex: 1, padding: '6px', background: isSimulation ? '#0ea5e9' : '#1e293b' }} onClick={() => setIsSimulation(true)}>Simulado</button>
                 <button className="modeling-input" style={{ flex: 1, padding: '6px', background: !isSimulation ? '#0ea5e9' : '#1e293b' }} onClick={() => setIsSimulation(false)}>Real</button>
              </div>
            </div>

            <div className="control-group">
              <div className="control-label">
                <span>Gasto Primario (Q)</span>
                <span className="control-value">{q} m³/s</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="80" 
                step="0.1"
                value={q} 
                onChange={e => setQ(parseFloat(e.target.value))}
                className="modeling-slider"
              />
            </div>

            <div className="control-group" style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div className="control-label">
                <span style={{ color: '#94a3b8' }}>Comparar con Referencia</span>
                <input 
                    type="checkbox" 
                    checked={compareEnabled} 
                    onChange={e => setCompareEnabled(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                />
              </div>
              {compareEnabled && (
                  <div style={{ marginTop: '1rem' }}>
                    <div className="control-label">
                        <span>Gasto Base (Q-Ref)</span>
                        <span className="control-value" style={{ color: '#94a3b8' }}>{qRef} m³/s</span>
                    </div>
                    <input 
                        type="range" 
                        min="0" 
                        max="80" 
                        step="0.1"
                        value={qRef} 
                        onChange={e => setQRef(parseFloat(e.target.value))}
                        className="modeling-slider"
                        style={{ filter: 'grayscale(1)' }}
                    />
                  </div>
              )}
            </div>

            <div className="control-group">
              <div className="control-label">
                <span>Sesgo de Rugosidad (n)</span>
                <span className="control-value">±2%</span>
              </div>
              <input 
                type="range" 
                min="-10" 
                max="10" 
                value={0} 
                className="modeling-slider"
              />
            </div>

            <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(34, 211, 238, 0.05)', border: '1px dashed rgba(34, 211, 238, 0.2)', borderRadius: '12px' }}>
               <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                 <TrendingDown size={16} className="text-cyan-400" style={{ marginTop: 2, flexShrink: 0 }} />
                 <div>
                    <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#f1f5f9', marginBottom: 4 }}>Balance de Masa</p>
                    <p style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: 1.4 }}>
                        Tránsito estimado: <b>{Math.round(q > 0 ? (120 / (q/20)) : 0)} min</b> hasta Km 150+000
                    </p>
                 </div>
               </div>
            </div>

            <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
               <button className="export-btn" style={{ width: '100%', background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                  Calcular Escenario
               </button>
            </div>

          </div>
        </section>

        {/* PANEL 2: VISUALIZACIÓN (CENTRO) */}
        <section className="viz-container">
          <div className="modeling-panel chart-card" style={{ flex: 1.2 }}>
            <div className="panel-header">
              <Activity size={16} className="text-cyan-400" />
              <h3>Perfil Hidráulico Completo - Canal Principal Conchos</h3>
            </div>
            {loading ? (
               <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="animate-pulse flex space-x-4">
                     <div className="h-2 w-24 bg-slate-700 rounded"></div>
                  </div>
               </div>
            ) : (
               <div style={{ flex: 1, padding: '10px' }}>
                 <ReactECharts 
                    option={getProfileOption()} 
                    style={{ height: '100%', width: '100%' }}
                    theme="dark"
                  />
               </div>
            )}
          </div>

          <div className="modeling-panel extruded-view">
             <div className="panel-header" style={{ background: 'rgba(2, 6, 23, 0.8)' }}>
                <Box size={16} className="text-indigo-400" />
                <h3>Extrusión 3D (Simulación Estructural)</h3>
             </div>
             <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#020617' }}>
                <div style={{ textAlign: 'center' }}>
                    <svg width="600" height="220" viewBox="0 0 600 220">
                      {/* Isometric Canal Base */}
                      <path d="M 50 180 L 550 180 L 500 130 L 100 130 Z" fill="#1e293b" stroke="#334155" />
                      {/* Water Body using Q */}
                      <path 
                        d={`M 100 130 L 500 130 L ${500 - q/5} ${130 - q/3} L ${100 + q/5} ${130 - q/3} Z`} 
                        fill="rgba(34, 211, 238, 0.4)" 
                        stroke="#22d3ee" 
                        strokeWidth="2" 
                      />
                      <text x="300" y="80" textAnchor="middle" fill="#94a3b8" fontSize="11" fontWeight="900" letterSpacing="3">HYDRA CORE 3D VISUALIZER</text>
                      <text x="300" y="210" textAnchor="middle" fill="#64748b" fontSize="9">SECCIÓN TRANSVERSAL TÍPICA (TRAPEZOIDAL)</text>
                    </svg>
                </div>
             </div>
          </div>
        </section>

        {/* PANEL 3: BALANCE Y MATRIZ (DER) */}
        <section className="modeling-panel">
          <div className="panel-header">
            <Layers size={16} className="text-emerald-400" />
            <h3>Balance Operativo de Volúmenes</h3>
          </div>
          <div className="panel-content">
            <table className="matrix-table">
              <thead>
                <tr>
                  <th>MODULO/DESTINO</th>
                  <th style={{ textAlign: 'center' }}>Q SOLIC.</th>
                  <th style={{ textAlign: 'center' }}>Q REAL.</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Módulo 01 (Conchos)</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>12.50</td>
                  <td style={{ textAlign: 'center' }} className="value-positive">12.45</td>
                </tr>
                <tr>
                  <td>Módulo 02 (SRL)</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>8.20</td>
                  <td style={{ textAlign: 'center' }} className="value-neutral">8.20</td>
                </tr>
                <tr>
                  <td>Módulo 05 (Julimes)</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>5.40</td>
                  <td style={{ textAlign: 'center' }} className="value-warning">4.90</td>
                </tr>
                <tr>
                  <td>Urbano Delicias</td>
                  <td style={{ textAlign: 'center', fontWeight: 'bold' }}>1.20</td>
                  <td style={{ textAlign: 'center' }} className="value-positive">1.20</td>
                </tr>
              </tbody>
            </table>

            <div className="balance-card">
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.6rem', color: '#64748b' }}>PERDIDAS (E+I)</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 900, color: '#f87171' }}>1.45 m³/s</span>
               </div>
               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.6rem', color: '#64748b' }}>EFICIENCIA TRAMO</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 900, color: '#4ade80' }}>94.2%</span>
               </div>
               <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ height: '100%', width: '94.2%', background: '#4ade80' }}></div>
               </div>
            </div>

            <div style={{ marginTop: '2rem' }}>
               <h4 style={{ fontSize: '0.65rem', fontWeight: 900, color: '#94a3b8', marginBottom: '15px', textTransform: 'uppercase' }}>Alertas de Seguridad</h4>
               <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '12px', borderRadius: '12px', display: 'flex', gap: '10px' }}>
                  <AlertCircle size={18} className="text-rose-500" />
                  <div>
                     <p style={{ fontSize: '0.7rem', fontWeight: 800, color: '#fca5a5' }}>Punto Crítico Detectado</p>
                     <p style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: 2 }}>Km 28+400: El tirante supera el 95% del bordo libre.</p>
                  </div>
               </div>
            </div>

            <button className="export-btn" style={{ marginTop: 'auto' }}>
               Guardar Escenario Oficial
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default ModelingDashboard;
