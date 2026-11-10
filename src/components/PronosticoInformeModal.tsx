import { useState } from 'react';
import { Users, FlaskConical, Clock, Download, Printer, Home, Image as ImageIcon } from 'lucide-react';
import { Modal, Boton } from './ui/base';

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

/**
 * Opciones previas al Informe de Pronóstico: horizonte (24/48 h), nivel de detalle y salida (archivo HTML o imprimir/PDF).
 * Usa el Modal base: foco atrapado, Escape, scroll bloqueado y el fondo deja libre el menú lateral.
 */
export function PronosticoInformeModal({ abierto, onCerrar, onConfirmar }: PronosticoInformeModalProps) {
    const [horizonteH, setHorizonteH] = useState<24 | 48>(48);
    const [nivel, setNivel] = useState<NivelInformePronostico>('operativo');

    const opcion = (activo: boolean, onClick: () => void, Icono: typeof Users, label: string, desc: string, key: string) => (
        <button key={key} type="button" onClick={onClick} aria-pressed={activo} className="pron-opcion">
            <span className="pron-opcion__ico"><Icono size={14} aria-hidden="true" /></span>
            <span className="pron-opcion__txt">
                <span className="pron-opcion__tit">{label}</span>
                <span className="pron-opcion__desc">{desc}</span>
            </span>
        </button>
    );

    const confirmar = (accion: OpcionesInformePronostico['accion']) => {
        // El informe básico siempre cubre 48 h (hoy, mañana y pasado): es lo que la gente espera ver.
        onConfirmar({ horizonteH: nivel === 'ciudadano' ? 48 : horizonteH, nivel, modoTecnico: nivel === 'tecnico', accion });
        onCerrar();
    };

    return (
        <Modal
            abierto={abierto} onCerrar={onCerrar} titulo="Informe de pronóstico" kicker="Qué hacer en las próximas horas"
            tamano="md" cubreSidebar={false}
            pie={<>
                <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
                {nivel === 'ciudadano' && <Boton onClick={() => confirmar('imagen')} icono={<ImageIcon size={14} aria-hidden="true" />}>Imagen para compartir</Boton>}
                <Boton onClick={() => confirmar('imprimir')} icono={<Printer size={14} aria-hidden="true" />}>Imprimir / PDF</Boton>
                <Boton variante="primario" onClick={() => confirmar('descargar')} icono={<Download size={14} aria-hidden="true" />}>Descargar HTML</Boton>
            </>}
        >
            {nivel !== 'ciudadano' && (
                <section className="pron-bloque">
                    <p className="pron-rotulo">Horizonte</p>
                    <div className="pron-rejilla pron-rejilla--2">
                        {opcion(horizonteH === 24, () => setHorizonteH(24), Clock, 'Próximas 24 h', 'Decisiones del día: riego, aspersión y entregas', 'h24')}
                        {opcion(horizonteH === 48, () => setHorizonteH(48), Clock, 'Próximas 48 h', 'Incluye la ventana completa que evalúan las alertas', 'h48')}
                    </div>
                </section>
            )}

            <section className="pron-bloque">
                <p className="pron-rotulo">¿Para quién es el informe?</p>
                <div className="pron-rejilla pron-rejilla--3">
                    {opcion(nivel === 'ciudadano', () => setNivel('ciudadano'), Home, 'Básico', 'Para cualquier persona: mapa de módulos con su probabilidad de lluvia, hora por hora y qué esperar cada día', 'ciu')}
                    {opcion(nivel === 'operativo', () => setNivel('operativo'), Users, 'Operativo', 'Veredicto, decisiones por módulo, ventanas de riesgo y gráficas', 'op')}
                    {opcion(nivel === 'tecnico', () => setNivel('tecnico'), FlaskConical, 'Técnico', 'Añade definiciones, nubosidad y la metodología abierta', 'tec')}
                </div>
                <p className="pron-nota">
                    {nivel === 'ciudadano'
                        ? 'Informe para la ciudadanía: mapa de los módulos con su probabilidad de lluvia, hora por hora, y hoy, mañana y pasado mañana con temperatura, lluvia y viento en km/h. Se puede imprimir o compartir como imagen.'
                        : 'Todo el pronóstico es del modelo (Open-Meteo), ajustado por su error sistemático medido donde lo hay; lo observado se rotula aparte. Las estaciones con lecturas sospechosas aparecen como S/D.'}
                </p>
            </section>
        </Modal>
    );
}
