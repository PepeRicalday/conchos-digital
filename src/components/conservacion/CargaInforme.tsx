import { useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { leerInforme, MAX_BYTES_INFORME, type ArchivoInforme } from '../../conservacion/informe/esquemaInforme';

interface Props { onInforme: (a: ArchivoInforme) => void; compacto?: boolean }

/** Abre un informe .json generado en este equipo. El archivo no se envía a ningún servidor: se lee en el navegador. */
export function CargaInforme({ onInforme, compacto = false }: Props) {
    const entrada = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [sobre, setSobre] = useState(false);

    const leer = async (f: File | undefined) => {
        if (!f) return;
        setError(null);
        if (f.size > MAX_BYTES_INFORME) { setError('El archivo es demasiado grande para ser un informe de SICA Conservación.'); return; }
        const r = leerInforme(await f.text());
        if (r.ok) onInforme(r.archivo); else setError(r.error);
    };
    const soltar = (e: DragEvent) => { e.preventDefault(); setSobre(false); void leer(e.dataTransfer.files[0]); };

    const zona = (
        <div
            className={`cons-zona ${sobre ? 'cons-zona-sobre' : ''}`}
            role="button" tabIndex={0} aria-label="Abrir informe de SICA Conservación (archivo .json)"
            onClick={() => entrada.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setSobre(true); }} onDragLeave={() => setSobre(false)} onDrop={soltar}
        >
            <UploadCloud size={40} aria-hidden="true" />
            <h2>Abrir informe</h2>
            <p>Arrastre aquí el archivo <b>informe-….json</b> o toque para elegirlo. Se lee en este navegador; no se sube a ningún servidor.</p>
            <input ref={entrada} type="file" accept=".json,application/json" tabIndex={-1} onChange={(e) => { void leer(e.target.files?.[0]); e.target.value = ''; }} />
            {error && <p className="cons-error" role="alert">{error}</p>}
        </div>
    );
    if (compacto) return zona;

    return (
        <div className="cons-vacio">
            {zona}
            <section className="sc-card" aria-labelledby="cons-como">
                <span className="sc-kicker">Cómo se genera</span>
                <h3 id="cons-como">El análisis corre en su equipo</h3>
                <ol className="cons-pasos">
                    <li>Tenga a la mano el PacOT en formato <b>.xls</b>. El original nunca se modifica ni sale de su computadora.</li>
                    <li>En la carpeta de la plataforma, ejecute:<code>npm run conservacion:analizar -- "ruta\PacOT.xls" --modulo MOD-001</code></li>
                    <li>El comando escribe <b>informes-conservacion/informe-….json</b> con los hallazgos, la cobertura de reglas y los parámetros usados.</li>
                    <li>Ábralo aquí. Necesita Python con <b>xlrd 2.0.1</b> para leer el .xls.</li>
                </ol>
            </section>
        </div>
    );
}
