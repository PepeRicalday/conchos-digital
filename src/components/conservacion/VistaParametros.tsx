import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';
import { DataTable } from '../ui/base';

const ORIGEN: Readonly<Record<string, string>> = {
    defecto_manual_2026: 'Defecto del Manual 2026', organizacion: 'Organización', distrito: 'Distrito', sesion: 'Sesión',
};

export function VistaParametros({ archivo }: { archivo: ArchivoInforme }) {
    const ps = archivo.informe.declaracionParametros;
    return (
        <section className="sc-card" aria-labelledby="cons-p-t" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div><span className="sc-kicker">NOR-001 · capa 0</span><h3 id="cons-p-t" style={{ marginBottom: 0 }}>Parámetros declarados antes de auditar</h3></div>
            <p className="sc-aviso" role="note">
                <span>El Manual de Conservación 2026 prevalece sobre los Anexos. Los valores alternos son una <b>nota informativa</b>, nunca un error del PacOT; un valor distinto del Manual exige sustento de quien lo declara.</span>
            </p>
            <DataTable
                apilar captionOculto className="cons-tabla" caption="Parámetros normativos usados en la comprobación"
                clave={(p) => p.id} filas={ps}
                columnas={[
                    { id: 'id', titulo: 'ID', className: 'cons-id', render: (p) => p.id },
                    { id: 'nombre', titulo: 'Parámetro', render: (p) => p.nombre },
                    { id: 'valor', titulo: 'Valor usado', className: 'cons-id', render: (p) => <span style={{ whiteSpace: 'normal' }}>{p.valor}</span> },
                    { id: 'fuente', titulo: 'Fuente', render: (p) => `${p.fuente.documento} ${p.fuente.seccion}` },
                    { id: 'origen', titulo: 'Origen', render: (p) => <>{ORIGEN[p.origen] ?? p.origen}{p.sustento ? <><br /><small>Sustento: {p.sustento}</small></> : null}</> },
                    { id: 'alt', titulo: 'Valores alternos', render: (p) => p.alternos.length > 0 ? <ul className="cons-pend">{p.alternos.map((a, i) => <li key={i}>{a}</li>)}</ul> : '—' },
                ]}
            />
        </section>
    );
}
