/**
 * ShapefileImporter — Convierte archivos .zip (Shapefile) a GeoJSON
 * y los almacena en el directorio público /geo/ del proyecto.
 * 
 * Uso: El usuario sube un .zip que contiene (.shp, .dbf, .prj, .shx)
 *      y el sistema lo convierte a GeoJSON en el navegador usando shpjs.
 *      El GeoJSON resultante puede guardarse o usarse directamente en el mapa.
 */
import { useState, useCallback } from 'react';
import { Upload, FileJson, Check, AlertTriangle, Layers, X } from 'lucide-react';
// @ts-ignore
import shp from 'shpjs';

export interface GeoLayer {
    id: string;
    name: string;
    type: 'modulos' | 'presas' | 'canal' | 'tomas' | 'custom';
    geojson: GeoJSON.FeatureCollection;
    color: string;
    visible: boolean;
    fillOpacity: number;
}

interface ShapefileImporterProps {
    onLayerImported: (layer: GeoLayer) => void;
    onClose: () => void;
}

const LAYER_PRESETS: { id: string; name: string; type: GeoLayer['type']; color: string }[] = [
    { id: 'modulos', name: 'Módulos de Riego', type: 'modulos', color: '#3b82f6' },
    { id: 'presas', name: 'Vasos de Presas', type: 'presas', color: '#1d4ed8' },
    { id: 'canal', name: 'Canal Principal', type: 'canal', color: '#22d3ee' },
    { id: 'tomas', name: 'Tomas y Laterales', type: 'tomas', color: '#f59e0b' },
    { id: 'custom', name: 'Capa Personalizada', type: 'custom', color: '#8b5cf6' },
];

export const ShapefileImporter = ({ onLayerImported, onClose }: ShapefileImporterProps) => {
    const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [selectedPreset, setSelectedPreset] = useState(LAYER_PRESETS[0]);
    const [preview, setPreview] = useState<GeoJSON.FeatureCollection | null>(null);
    const [featureCount, setFeatureCount] = useState(0);

    const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setStatus('processing');
        setMessage(`Procesando ${file.name}...`);

        try {
            const arrayBuffer = await file.arrayBuffer();
            let geojson: GeoJSON.FeatureCollection;

            if (file.name.endsWith('.zip')) {
                // Shapefile en .zip → convertir con shpjs
                const result = await shp(arrayBuffer);
                // shpjs puede devolver un array de FeatureCollections o una sola
                geojson = Array.isArray(result) ? result[0] : result;
            } else if (file.name.endsWith('.geojson') || file.name.endsWith('.json')) {
                // GeoJSON directo
                const text = new TextDecoder().decode(arrayBuffer);
                geojson = JSON.parse(text);
            } else {
                throw new Error('Formato no soportado. Use .zip (Shapefile) o .geojson');
            }

            if (!geojson || !geojson.features) {
                throw new Error('El archivo no contiene features GeoJSON válidas');
            }

            setPreview(geojson);
            setFeatureCount(geojson.features.length);
            setStatus('done');
            setMessage(`✅ ${geojson.features.length} features encontradas en "${file.name}"`);
        } catch (err: any) {
            setStatus('error');
            setMessage(`Error: ${err.message}`);
        }
    }, []);

    const handleImport = () => {
        if (!preview) return;

        const layer: GeoLayer = {
            id: `${selectedPreset.id}-${Date.now()}`,
            name: selectedPreset.name,
            type: selectedPreset.type,
            geojson: preview,
            color: selectedPreset.color,
            visible: true,
            fillOpacity: 0.2,
        };

        onLayerImported(layer);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-center justify-center p-4">
            <div className="bg-[#0f172a] border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-cyan-500/10 rounded-xl">
                            <Layers className="text-cyan-400" size={20} />
                        </div>
                        <div>
                            <h2 className="text-white font-bold text-lg">Importar Capa Geográfica</h2>
                            <p className="text-slate-500 text-xs">Shapefile (.zip) o GeoJSON (.geojson)</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
                        <X className="text-slate-400" size={18} />
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Tipo de Capa */}
                    <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2 block">
                            Tipo de Capa
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {LAYER_PRESETS.map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => setSelectedPreset(preset)}
                                    className={`p-2 rounded-lg text-[10px] font-bold uppercase transition-all border ${selectedPreset.id === preset.id
                                            ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400'
                                            : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-slate-600'
                                        }`}
                                >
                                    {preset.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Upload Zone */}
                    <div className="relative">
                        <input
                            type="file"
                            accept=".zip,.geojson,.json,.shp"
                            onChange={handleFile}
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                        />
                        <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-all ${status === 'done' ? 'border-green-500/50 bg-green-500/5' :
                                status === 'error' ? 'border-red-500/50 bg-red-500/5' :
                                    status === 'processing' ? 'border-cyan-500/50 bg-cyan-500/5 animate-pulse' :
                                        'border-slate-700 hover:border-slate-500 bg-slate-800/30'
                            }`}>
                            {status === 'idle' && (
                                <>
                                    <Upload className="mx-auto text-slate-500 mb-2" size={32} />
                                    <p className="text-slate-400 text-sm font-semibold">
                                        Arrastra o selecciona archivo
                                    </p>
                                    <p className="text-slate-600 text-xs mt-1">
                                        .zip (Shapefile) • .geojson • .json
                                    </p>
                                </>
                            )}
                            {status === 'processing' && (
                                <>
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto mb-2" />
                                    <p className="text-cyan-400 text-sm font-semibold">{message}</p>
                                </>
                            )}
                            {status === 'done' && (
                                <>
                                    <Check className="mx-auto text-green-400 mb-2" size={32} />
                                    <p className="text-green-400 text-sm font-semibold">{message}</p>
                                </>
                            )}
                            {status === 'error' && (
                                <>
                                    <AlertTriangle className="mx-auto text-red-400 mb-2" size={32} />
                                    <p className="text-red-400 text-sm font-semibold">{message}</p>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Preview Info */}
                    {preview && (
                        <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                            <div className="flex items-center gap-2 mb-2">
                                <FileJson className="text-cyan-400" size={16} />
                                <span className="text-white text-sm font-bold">Vista Previa</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="text-slate-400">Features: <span className="text-white font-mono">{featureCount}</span></div>
                                <div className="text-slate-400">Tipo: <span className="text-white font-mono">
                                    {preview.features[0]?.geometry?.type || '—'}
                                </span></div>
                                {preview.features[0]?.properties && (
                                    <div className="col-span-2 text-slate-400">
                                        Campos: <span className="text-white font-mono text-[10px]">
                                            {Object.keys(preview.features[0].properties).slice(0, 5).join(', ')}
                                            {Object.keys(preview.features[0].properties).length > 5 ? '...' : ''}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 py-3 rounded-xl bg-slate-800 text-slate-400 font-bold text-sm hover:bg-slate-700 transition"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleImport}
                            disabled={!preview}
                            className="flex-1 py-3 rounded-xl bg-cyan-600 text-white font-bold text-sm hover:bg-cyan-500 transition disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-cyan-900/30"
                        >
                            Importar al Mapa
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
