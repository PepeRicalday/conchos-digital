import type { ArchivoInforme } from '../../conservacion/informe/esquemaInforme';

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
            <div className="sc-tabla-wrap table-scroll">
                <table className="sc-tabla cons-tabla cons-apila">
                    <caption style={{ position: 'absolute', left: -9999 }}>Parámetros normativos usados en la comprobación</caption>
                    <thead>
                        <tr><th scope="col">ID</th><th scope="col">Parámetro</th><th scope="col">Valor usado</th><th scope="col">Fuente</th><th scope="col">Origen</th><th scope="col">Valores alternos</th></tr>
                    </thead>
                    <tbody>
                        {ps.map((p) => (
                            <tr key={p.id}>
                                <td className="cons-id" data-label="ID">{p.id}</td>
                                <td data-label="Parámetro">{p.nombre}</td>
                                <td className="cons-id" data-label="Valor usado" style={{ whiteSpace: 'normal' }}>{p.valor}</td>
                                <td data-label="Fuente">{p.fuente.documento} {p.fuente.seccion}</td>
                                <td data-label="Origen">{ORIGEN[p.origen] ?? p.origen}{p.sustento ? <><br /><small>Sustento: {p.sustento}</small></> : null}</td>
                                <td data-label="Valores alternos">{p.alternos.length > 0 ? <ul className="cons-pend">{p.alternos.map((a, i) => <li key={i}>{a}</li>)}</ul> : '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
