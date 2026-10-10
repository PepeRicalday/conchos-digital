import type { DiagramaComp } from '../../../conservacion/verificacion/comprobacion';

const f2 = (x: number): string => x.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Exageración de la escala vertical: la sección es ancha y baja, y sin ella un espesor de 0.3 m no se ve. Se declara en la leyenda. */
export const EXAGERACION_VERTICAL = 2;

export interface ItemLeyenda { readonly muestra: 'hierba' | 'talud' | 'hombro' | 'azolve' | 'plantas' | 'descopete' | 'losa' | 'plantilla' | 'calzada' | 'carpeta' | 'ilustrativo'; readonly texto: string }

/** Lo que el libro no trae del camino: se dice siempre que se dibuja uno. */
export const NOTA_CAMINO_ILUSTRATIVO = 'El libro no trae medidas de bermas ni cunetas (solo renglones en SEG-3 y PO-1): se dibujan tenues, solo como ilustración. Escala vertical exagerada ×2.';
export const NOTA_150_INFERENCIA = 'El 150 es una inferencia; el libro no declara el espesor.';

function leyendaCamino(d: DiagramaComp): ItemLeyenda[] {
    const sup = d.superficie ?? 'superficie S/D';
    const calzada: ItemLeyenda = { muestra: 'calzada', texto: `Calzada de ${d.ancho === null || d.ancho === undefined ? 'ancho S/D' : `${f2(d.ancho)} m`} (dimensión de IO3), superficie ${sup}` };
    const ilus: ItemLeyenda = { muestra: 'ilustrativo', texto: 'Cunetas y bermas (tenues): ilustrativas' };
    switch (d.modo) {
        case 'camino-conformacion': return [calzada, { muestra: 'hierba', texto: `Conformación de la calzada: ${d.rotulo ?? 'pasadas por km S/D'} (modelo declarado por el comprobador, hipótesis; el libro solo trae km)` }, ilus];
        case 'camino-rastreo': return [calzada, { muestra: 'hierba', texto: `Rastreo de la superficie: ${d.rotulo ?? 'pasadas por km S/D'} (modelo declarado por el comprobador, hipótesis; el libro solo trae km)` }, ilus];
        case 'camino-revestimiento': return d.espesor === null || d.espesor === undefined
            ? [calzada, { muestra: 'carpeta', texto: d.superficie === 'Terracería' ? 'terracería: no lleva revestimiento; el libro asigna 0 a este tramo' : 'Sin reposición de revestimiento asignada en este tramo' }, ilus]
            : [calzada, { muestra: 'carpeta', texto: `Carpeta de reposición: espesor ${f2(d.espesor)} m (inferencia)` }, ilus];
        case 'camino-terraceria': return [calzada, { muestra: 'descopete', texto: 'Terracerías: unidad sospechosa, no se dibuja volumen' }, ilus];
        default: return [];
    }
}

/** El texto descriptivo vive fuera del dibujo, en HTML (se lee a cualquier tamaño y se puede seleccionar); el dibujo solo lleva cifras. */
export function leyendaSeccion(d: DiagramaComp): ItemLeyenda[] {
    if (d.familia === 'camino') return leyendaCamino(d);
    const talud = d.revestido === true ? 'Taludes revestidos de concreto' : d.revestido === false ? 'Taludes sin revestir' : 'Taludes';
    switch (d.modo) {
        case 'limpia': return [
            { muestra: 'hierba', texto: d.rotulo === 'equivalente'
                ? `Limpia y deshierbe: ancho equivalente de ${d.anchoFranja === null ? 'ancho no definido' : `${f2(d.anchoFranja)} m`} por margen. El libro calcula la cantidad con la longitud inclinada del talud, no con una franja fija; el dibujo solo muestra la franja que equivale a esa cantidad` 
                : `Limpia y deshierbe: franja de ${d.anchoFranja === null ? 'ancho no definido' : `${f2(d.anchoFranja)} m`} por margen, desde el hombro hacia afuera. Es el criterio del PacOT: el Manual ubica el deshierbe en la sección, los caminos de servicio y la corona de los bordos, sin fijar un ancho` },
            { muestra: 'hombro', texto: 'Hombro: donde termina la sección del canal' },
            { muestra: 'talud', texto: d.revestido === true ? `${talud}: el concepto no se aplica ahí` : `${talud}: el libro no dice si se deshierban` },
        ];
        case 'desazolve': return [
            { muestra: 'azolve', texto: `Azolve: capa de ${d.h === null ? 'espesor no definido' : `${f2(d.h)} m`} sobre la plantilla y los taludes` },
            { muestra: 'talud', texto: talud },
        ];
        case 'acuaticas': return [
            { muestra: 'plantas', texto: 'Plantas acuáticas: se miden sobre el ancho de la plantilla' },
            { muestra: 'talud', texto: talud },
        ];
        case 'descopete': return [
            { muestra: 'descopete', texto: 'Descopete: material sobre el bordo, a cada lado del hombro. El libro no declara el perfil.' },
            { muestra: 'talud', texto: talud },
        ];
        case 'terracerias': return [
            { muestra: 'descopete', texto: 'Terracerías (descopete): material sobre el bordo, a cada lado del hombro. El libro no declara el perfil; el dibujo es ilustrativo.' },
            { muestra: 'talud', texto: talud },
        ];
        case 'revestimiento': return [
            { muestra: 'losa', texto: 'Reposición de losas: reserva por kilómetro sobre el revestimiento, no una medición del daño' },
            { muestra: 'plantilla', texto: 'Plantilla y taludes forman el perímetro revestido' },
        ];
        default: return leyendaCamino(d);
    }
}

