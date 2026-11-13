import { useState, type ReactNode } from 'react';

/**
 * Sección plegable de una pestaña de la Cuenca. Las pestañas largas (Balance, Clima) medían de 7 a 8 pantallas: cada bloque
 * se pliega bajo un encabezado con una línea de resumen. El contenido se monta la primera vez que se abre (y se conserva),
 * así una sección cerrada no calcula ni pide nada. Las notas de lectura van al pie de la sección a la que pertenecen.
 */
export default function SeccionCuenca({ id, titulo, resumen, abierta, onAlternar, notas, children }: {
  id: string; titulo: string; resumen?: ReactNode; abierta: boolean; onAlternar: (id: string, abierta: boolean) => void;
  notas?: ReactNode; children: ReactNode;
}) {
  const [montada, setMontada] = useState(abierta);
  if (abierta && !montada) setMontada(true);
  return (
    <details className="cu-sec" id={`cu-sec-${id}`} open={abierta} onToggle={(e) => { const o = e.currentTarget.open; if (o !== abierta) onAlternar(id, o); }}>
      <summary className="cu-sec-sum">
        <span className="cu-sec-t">{titulo}</span>
        {resumen && <span className="cu-sec-res">{resumen}</span>}
      </summary>
      {montada && (
        <div className="cu-sec-cuerpo">
          {children}
          {notas && (
            <details className="an-pie cu-notas cu-sec-notas">
              <summary className="cu-notas-sum">Cómo se lee</summary>
              <ul>{notas}</ul>
            </details>
          )}
        </div>
      )}
    </details>
  );
}
