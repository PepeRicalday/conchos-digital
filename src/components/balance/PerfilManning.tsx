import { memo } from 'react';
import { manningFlow, type PerfilTramo } from '../../utils/hydraulics';
import { fmt } from '../../utils/formato';

/** Perfil de diseño: gasto teórico por Manning, velocidad y Froude de cada tramo (solo lectura). */
export const PerfilManning = memo(function PerfilManning({ perfil }: { perfil: PerfilTramo[] }) {
    if (perfil.length === 0) return null;
    return (
        <section className="sc-card" aria-labelledby="bal-man-t">
            <span className="sc-kicker">Hidráulica de diseño</span>
            <h3 id="bal-man-t">Perfil de diseño · Manning teórico</h3>
            <div className="bal-manning">
                {perfil.slice(0, 12).map((t) => {
                    const m = manningFlow(t.plantilla_m, t.talud_z, t.tirante_diseno_m, t.pendiente_s0, t.rugosidad_n);
                    const qDiseno = t.capacidad_diseno_m3s > 0 ? t.capacidad_diseno_m3s : m.Q;
                    return (
                        <article key={`${t.km_inicio}-${t.nombre_tramo}`} className="bal-manning-item">
                            <header><b>{t.nombre_tramo}</b><span>Km {fmt(t.km_inicio, 1)}–{fmt(t.km_fin, 1)}</span></header>
                            <dl>
                                <div><dt>Q Manning</dt><dd>{fmt(m.Q, 2)} m³/s</dd></div>
                                <div><dt>Q diseño</dt><dd>{fmt(qDiseno, 2)} m³/s</dd></div>
                                <div><dt>Velocidad</dt><dd>{fmt(m.V, 2)} m/s</dd></div>
                                <div><dt>Froude</dt><dd>{fmt(m.Fr, 3)}{m.Fr > 1 ? ' · supercrítico' : ''}</dd></div>
                            </dl>
                        </article>
                    );
                })}
            </div>
        </section>
    );
});
