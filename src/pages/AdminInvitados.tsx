import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Power, UserPlus } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Invitado {
    id: string;
    nombre: string | null;
    email: string | null;
    activo: boolean;
    vigente_hasta: string | null;
    ultimo_acceso: string | null;
    bloqueado: boolean;
}

/** Llama a la edge function admin-invitados (solo SRL; el rol se valida en el servidor). */
async function llamar<T>(cuerpo: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke('admin-invitados', { body: cuerpo });
    if (error) {
        // El detalle útil viene en el cuerpo de la respuesta, no en error.message.
        let msg = 'No se pudo completar la acción.';
        try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* sin cuerpo */ }
        throw new Error(msg);
    }
    return data as T;
}

const hoy = () => new Date().toISOString().slice(0, 10);
const estado = (i: Invitado): { txt: string; cls: string } => {
    if (!i.activo) return { txt: 'Desactivada', cls: 'text-slate-400' };
    if (i.vigente_hasta && i.vigente_hasta < hoy()) return { txt: 'Vencida', cls: 'text-amber-400' };
    if (i.bloqueado) return { txt: 'Bloqueada', cls: 'text-amber-400' };
    return { txt: 'Activa', cls: 'text-emerald-400' };
};

export default function AdminInvitados() {
    const [lista, setLista] = useState<Invitado[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [email, setEmail] = useState('');
    const [nombre, setNombre] = useState('');
    const [vigencia, setVigencia] = useState('');
    const [guardando, setGuardando] = useState(false);
    // La contraseña temporal se muestra una sola vez; no se guarda en ningún lado.
    const [credencial, setCredencial] = useState<{ email: string; password: string } | null>(null);

    const cargar = useCallback(async () => {
        setCargando(true); setError(null);
        try { setLista((await llamar<{ invitados: Invitado[] }>({ accion: 'listar' })).invitados); }
        catch (e) { setError(e instanceof Error ? e.message : 'Error al cargar.'); }
        finally { setCargando(false); }
    }, []);
    useEffect(() => { void cargar(); }, [cargar]);

    const crear = async (e: React.FormEvent) => {
        e.preventDefault();
        setGuardando(true);
        try {
            const r = await llamar<{ email: string; password_temporal: string }>({ accion: 'crear', email, nombre, vigente_hasta: vigencia || null });
            setCredencial({ email: r.email, password: r.password_temporal });
            setEmail(''); setNombre(''); setVigencia('');
            await cargar();
        } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo crear.'); }
        finally { setGuardando(false); }
    };

    const accion = async (cuerpo: Record<string, unknown>, ok: string) => {
        try { await llamar(cuerpo); toast.success(ok); await cargar(); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo completar.'); }
    };

    const restablecer = async (i: Invitado) => {
        if (!window.confirm(`¿Generar una contraseña nueva para ${i.email}? La anterior dejará de funcionar.`)) return;
        try {
            const r = await llamar<{ password_temporal: string }>({ accion: 'restablecer', id: i.id });
            setCredencial({ email: i.email ?? '', password: r.password_temporal });
        } catch (err) { toast.error(err instanceof Error ? err.message : 'No se pudo restablecer.'); }
    };

    const copiar = (t: string) => { void navigator.clipboard?.writeText(t).then(() => toast.success('Copiado')); };

    return (
        <div className="p-4 md:p-8 space-y-6 max-w-5xl mx-auto">
            <header>
                <h1 className="text-2xl font-bold">Cuentas de invitado</h1>
                <p className="text-slate-400 text-sm mt-1">
                    Acceso de <strong>solo lectura</strong> para mostrar la plataforma. No pueden capturar, editar ni borrar datos, ni ver volúmenes por módulo, aforos o solicitudes.
                </p>
            </header>

            {credencial && (
                <div className="sc-card" role="status" style={{ border: '1px solid color-mix(in srgb, var(--st-ok) 40%, transparent)' }}>
                    <strong>Credenciales (se muestran solo ahora)</strong>
                    <p className="text-sm mt-1">Correo: <code>{credencial.email}</code></p>
                    <p className="text-sm">Contraseña temporal: <code>{credencial.password}</code></p>
                    <div className="flex gap-2 mt-3">
                        <button type="button" className="sc-btn" onClick={() => copiar(`Correo: ${credencial.email}\nContraseña temporal: ${credencial.password}`)}><Copy size={14} aria-hidden="true" /> Copiar</button>
                        <button type="button" className="sc-btn" onClick={() => setCredencial(null)}>Ya la guardé</button>
                    </div>
                </div>
            )}

            <form onSubmit={crear} className="sc-card grid gap-3 md:grid-cols-4 items-end">
                <label className="flex flex-col text-sm gap-1">Nombre
                    <input required minLength={2} maxLength={80} value={nombre} onChange={(e) => setNombre(e.target.value)} className="p-2 rounded bg-slate-900 border border-slate-700" />
                </label>
                <label className="flex flex-col text-sm gap-1">Correo
                    <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="p-2 rounded bg-slate-900 border border-slate-700" />
                </label>
                <label className="flex flex-col text-sm gap-1">Vigente hasta (opcional)
                    <input type="date" min={hoy()} value={vigencia} onChange={(e) => setVigencia(e.target.value)} className="p-2 rounded bg-slate-900 border border-slate-700" />
                </label>
                <button type="submit" disabled={guardando} className="sc-btn sc-btn-primario"><UserPlus size={16} aria-hidden="true" /> {guardando ? 'Creando…' : 'Crear invitado'}</button>
            </form>

            <section className="sc-card">
                <h2 className="text-lg font-semibold mb-3">Invitados</h2>
                {cargando && <p className="text-slate-400">Cargando…</p>}
                {error && <p role="alert" className="text-red-400">{error}</p>}
                {!cargando && !error && lista.length === 0 && <p className="text-slate-400">Aún no hay cuentas de invitado.</p>}
                <ul className="divide-y divide-slate-800">
                    {lista.map((i) => {
                        const st = estado(i);
                        return (
                            <li key={i.id} className="py-3 flex flex-wrap items-center gap-3 justify-between">
                                <div className="min-w-0">
                                    <div className="font-medium truncate">{i.nombre ?? '—'} <span className={`text-xs ml-2 ${st.cls}`}>{st.txt}</span></div>
                                    <div className="text-xs text-slate-400 truncate">{i.email} · vigencia: {i.vigente_hasta ?? 'sin límite'} · último acceso: {i.ultimo_acceso ? new Date(i.ultimo_acceso).toLocaleString('es-MX') : 'nunca'}</div>
                                </div>
                                <div className="flex gap-2 items-center">
                                    <input type="date" aria-label={`Vigencia de ${i.nombre ?? i.email}`} min={hoy()} defaultValue={i.vigente_hasta ?? ''}
                                        onBlur={(e) => { if ((e.target.value || null) !== i.vigente_hasta) void accion({ accion: 'actualizar', id: i.id, vigente_hasta: e.target.value || null }, 'Vigencia actualizada'); }}
                                        className="p-1 text-sm rounded bg-slate-900 border border-slate-700" />
                                    <button type="button" className="sc-btn" onClick={() => void restablecer(i)}><KeyRound size={14} aria-hidden="true" /> Contraseña</button>
                                    <button type="button" className="sc-btn" onClick={() => void accion({ accion: 'actualizar', id: i.id, activo: !i.activo }, i.activo ? 'Cuenta desactivada' : 'Cuenta activada')}>
                                        <Power size={14} aria-hidden="true" /> {i.activo ? 'Desactivar' : 'Activar'}
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}
