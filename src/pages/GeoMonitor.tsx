import { Map } from 'lucide-react';

const GeoMonitor = () => {
    return (
        <div className="flex flex-col h-screen bg-slate-900 text-white overflow-hidden p-6">
            <header className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2 text-cyan-400">
                        <Map className="text-cyan-500" />
                        Geo-Monitor (Video Wall)
                    </h1>
                    <p className="text-slate-400 text-sm">Monitoreo Hidro-Sincrónico Interactivo SDR-005</p>
                </div>
                <div className="flex gap-4">
                    <span className="flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full border border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        LIVE SYNC
                    </span>
                </div>
            </header>

            <div className="flex-1 flex gap-6">
                {/* Left: Map Area Placeholder */}
                <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 relative overflow-hidden shadow-2xl flex items-center justify-center">
                    {/* Here react-leaflet would map the canals */}
                    <div className="text-center opacity-50 pointer-events-none">
                        <Map size={64} className="mx-auto mb-4" />
                        <h2 className="text-xl font-mono text-slate-300">ESPACIO PARA MAPBOX / LEAFLET</h2>
                        <p className="text-sm mt-2 text-slate-500">Módulo en construcción (Fase 4.1)</p>
                    </div>
                </div>

                {/* Right: Real-time event log */}
                <div className="w-96 bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col">
                    <h3 className="font-bold text-slate-300 border-b border-slate-700 pb-2 mb-4">Registro Operativo (Tiempo Real)</h3>
                    <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs">
                        {/* Mock Events */}
                        <div className="bg-slate-900 p-3 rounded border border-slate-700/50">
                            <div className="font-bold text-slate-400 mb-1">08:15 AM - Canal Principal Conchos</div>
                            <div className="text-amber-400">Escala 1302.50 editada por OP-01. Gasto recalculado: 45.2 m³/s</div>
                        </div>
                        <div className="bg-slate-900 p-3 rounded border border-slate-700/50">
                            <div className="font-bold text-slate-400 mb-1">08:00 AM - Presa Boquilla</div>
                            <div className="text-emerald-400">Gasto estable: 45 m³/s.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeoMonitor;
