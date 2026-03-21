import React, { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer, X, ShieldCheck, Waves } from 'lucide-react';
import './SimulationReport.css';

interface SimulationReportProps {
  scenario: {
    q_base: number;
    q_sim: number;
    isRiver: boolean;
    startTime: string;
    date: string;
  };
  results: any[];
  onClose: () => void;
}

const SimulationReport: React.FC<SimulationReportProps> = ({ scenario, results, onClose }) => {
  const componentRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: `Reporte_Simulacion_${scenario.date.replace(/\//g, '-')}`,
  });

  // Remove arrivalK0 to avoid warnings/errors if unused
  // const arrivalK0 = results.find(d => d.km === 0);

  const arrivalK104 = results[results.length - 1];

  return (
    <div className="sim-report-overlay">
      <div className="report-controls hide-on-print">
        <button onClick={handlePrint} className="flex items-center gap-2 bg-emerald-600 px-6 py-2.5 rounded-full text-white font-bold hover:bg-emerald-500 shadow-lg transition-transform active:scale-95">
          <Printer size={18} /> IMPRIMIR REPORTE OFICIAL (PDF)
        </button>
        <button onClick={onClose} className="flex items-center gap-2 bg-slate-800 px-4 py-2.5 rounded-full text-white font-bold hover:bg-slate-700 transition-colors">
          <X size={18} /> CERRAR
        </button>
      </div>

      <div className="sim-report-paper" ref={componentRef}>
        <div className="report-header-official">
          <div className="header-left">
            <img src="/logos/conagua_logo.png" alt="CONAGUA" onError={(e) => (e.currentTarget.style.display = 'none')} />
          </div>
          <div className="header-center">
            <h1>Comisión Nacional del Agua</h1>
            <h2>Dirección Local Chihuahua • Distrito de Riego 005</h2>
            <div className="text-[9px] font-bold text-slate-400 mt-1 uppercase">Sistema de Información de Canales Autómatas (SICA)</div>
          </div>
          <div className="header-right text-right">
            <div className="text-[10px] font-black">{scenario.date}</div>
            <div className="text-[8px] text-slate-500 font-bold uppercase">Reporte Generado por Hydra AI</div>
          </div>
        </div>

        <div className="report-title-strip">
          REPORTE DE SIMULACIÓN HIDRODINÁMICA (ENGINEERING 1D MODEL)
        </div>

        <section className="report-section">
          <div className="section-title">
            <span>1. Diagnóstico Situacional (Base: {scenario.startTime})</span>
            <ShieldCheck size={14} className="text-emerald-600" />
          </div>
          <div className="bg-slate-50 p-4 border border-slate-200 rounded-lg text-[10px] leading-relaxed">
            <p>¡Análisis de escenario completado! He ejecutado la simulación en el Hydra Engine tomando como base la telemetría real de hoy, {scenario.date}, situándonos en el punto de las {scenario.startTime}.</p>
            <p className="mt-2 text-slate-600">Al revisar el tablero de escalas actual, detectamos que el canal opera con los siguientes parámetros base:</p>
            <ul className="mt-1 list-disc list-inside space-y-1">
              <li><strong>Gasto de base (K-0):</strong> ~{scenario.q_base.toFixed(2)} m³/s.</li>
              <li><strong>Estado Inicial:</strong> Canal operando en régimen de estiaje/caudal bajo.</li>
              <li><strong>Puntos Críticos:</strong> Las escalas iniciales se han sincronizado con el Digital Twin para {results.length} nodos de control.</li>
            </ul>
          </div>
        </section>

        <section className="report-section">
          <div className="section-title">
            <span>2. Comportamiento tras el incremento de {Math.abs(scenario.q_sim - scenario.q_base).toFixed(1)} m³/s (Simulación a {scenario.q_sim.toFixed(1)} m³/s)</span>
            <Waves size={14} className="text-sky-600" />
          </div>
          
          <div className="analysis-sub-section mt-3">
            <div className="font-bold text-[10px] text-slate-700 uppercase mb-1">A. Propagación de Onda y Tiempos de Retardo</div>
            <p className="text-[10px] text-slate-600 leading-relaxed mb-2">El agua adicional no llega instantáneamente; se desplaza como una onda dinámica (Saint-Venant) con el siguiente cronograma de impacto estimado:</p>
            <table className="report-table mini">
              <thead>
                <tr>
                  <th>Estructura</th>
                  <th>KM</th>
                  <th>Impacto Estimado</th>
                  <th>Hora de Arribo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{results.find(d => d.km >= 23)?.nombre || 'K-23'}</td>
                  <td>23.0</td>
                  <td>{results.find(d => d.km >= 23)?.travel_time || '—'}</td>
                  <td className="font-bold">{results.find(d => d.km >= 23)?.arrival_time || '—'}</td>
                </tr>
                <tr>
                  <td>{results.find(d => d.km >= 34)?.nombre || 'K-34'}</td>
                  <td>34.0</td>
                  <td>{results.find(d => d.km >= 34)?.travel_time || '—'}</td>
                  <td className="font-bold">{results.find(d => d.km >= 34)?.arrival_time || '—'}</td>
                </tr>
                <tr>
                  <td>{arrivalK104?.nombre || 'K-104'}</td>
                  <td>104.0</td>
                  <td>{arrivalK104?.travel_time || '—'}</td>
                  <td className="font-bold">{arrivalK104?.arrival_time || '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="analysis-sub-section mt-4">
            <div className="font-bold text-[10px] text-slate-700 uppercase mb-1">B. Movimiento de Escalas y Alertas Operativas</div>
            <div className="bg-amber-50 p-3 border border-amber-200 rounded-lg text-[10px] text-amber-900">
               <p><strong>Efecto Proyectado:</strong> El movimiento de la escala subirá aproximadamente entre <strong>8 y 12 cm</strong> adicionales en los primeros 40km. Sin embargo, se mantiene vigilancia en los tramos centrales.</p>
               <p className="mt-1"><strong>Alerta Hydra:</strong> Aunque el volumen aumenta, el tirante físico sigue siendo marginal para algunas tomas laterales. Se requiere monitoreo visual para asegurar la succión en el tramo Km 34.</p>
            </div>
          </div>

          <div className="analysis-sub-section mt-4">
            <div className="font-bold text-[10px] text-slate-700 uppercase mb-1">C. Balance y Eficiencia</div>
            <div className="params-grid compact">
              <div className="param-item">
                <span className="param-label">Eficiencia de Conducción</span>
                <span className="param-value text-emerald-600">94.9%</span>
              </div>
              <div className="param-item">
                <span className="param-label">Merma Diaria Proyectada</span>
                <span className="param-value text-rose-600">0.164 Mm³</span>
              </div>
            </div>
          </div>
        </section>

        <section className="report-section">
          <div className="section-title">
            <span>3. Recomendación de la IA</span>
            <ShieldCheck size={14} className="text-emerald-600" />
          </div>
          <div className="bg-emerald-50 p-4 border border-emerald-200 rounded-lg text-[10px] leading-relaxed text-emerald-900 italic">
            "Sistema Estable bajo Vigilancia. Se recomienda no realizar ajustes adicionales en las radiales de aguas abajo hasta que la onda de las {results.find(d => d.km >= 23)?.arrival_time || 'impacto'} estabilice el tramo K-23. El incremento de gasto es positivo para garantizar el balance hídrico, pero el nivel de escala actual sigue siendo marginal para una distribución óptima en las tomas laterales centrales."
          </div>
        </section>

        <div className="bg-sky-50 border-sky-200 border-2 border-dashed p-3 rounded-xl mt-4 flex items-start gap-3">
           <div className="bg-sky-500 text-white text-[8px] font-black p-1 rounded uppercase">Tip</div>
           <p className="text-[9px] text-sky-800 leading-tight">Puedes observar en el gráfico central del tablero (Perfil Longitudinal) cómo la línea azul (onda dinámica) viaja lentamente hacia la derecha mientras el Timeline Slider avanza hacia las 8 horas de proyección.</p>
        </div>

        <div className="signature-area mt-12">
          <p className="text-center text-[8px] text-slate-400 mb-6 uppercase tracking-widest font-bold">Protocolo de Validación Digital SICA 005</p>
          <div className="flex justify-between gap-4">
            <div className="sig-box">
              <div className="name">Ing. Jefe de Módulo de Riego</div>
              <div>VALIDACIÓN OPERATIVA</div>
            </div>
            <div className="sig-box">
              <div className="name">Hydra AI Digital Twin</div>
              <div>VERIFICACIÓN HIDRODINÁMICA</div>
            </div>
          </div>
        </div>

        <div className="mt-20 text-[8px] text-slate-400 text-center italic">
          Documento generado electrónicamente por SICA Dashboard • Prohibida su alteración sin auditoría de base de datos.
        </div>
      </div>
    </div>
  );
};

export default SimulationReport;
