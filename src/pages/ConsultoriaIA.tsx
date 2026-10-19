import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Library, MessageSquare, ShieldOff, Siren } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useHydricChat, type EnvioFallido } from '../hooks/useHydricChat';
import { useHydricKnowledge } from '../hooks/useHydricKnowledge';
import { useHydricEvents } from '../hooks/useHydricEvents';
import { useFrescuraSistema } from '../hooks/useFrescuraSistema';
import { useDevice } from '../hooks/useDevice';
import { useAhora } from '../hooks/useAhora';
import { useSesionReal } from '../hooks/useSesionReal';
import { PaginaHero } from '../components/ui/PaginaHero';
import type { ChipEstado } from '../utils/alertasVivas';
import { edadTexto } from '../utils/consultoria';
import { ChatPanel } from '../components/consultoria/ChatPanel';
import { Historial } from '../components/consultoria/Historial';
import '../styles/sala-control.css';
import '../components/consultoria/consultoria.css';

const BaseConocimiento = lazy(() => import('../components/consultoria/BaseConocimiento').then((m) => ({ default: m.BaseConocimiento })));

type Pestana = 'chat' | 'biblioteca';
const STALE_PRESA_H = 36;
const STALE_ESCALA_MIN = 240;

/** El guard va ANTES de montar los hooks: un usuario que no es S.R.L. ya no dispara el chat, los eventos ni las consultas de datos. */
export default function ConsultoriaIA() {
    const { profile } = useAuth();
    if (profile?.rol !== 'SRL') {
        return (
            <div className="sc-root sc-pagina ci-pagina">
                <section className="sc-card" role="alert" style={{ textAlign: 'center', padding: '40px 20px' }}>
                    <ShieldOff size={36} aria-hidden="true" style={{ color: 'var(--sc-crit)' }} />
                    <h1 className="sc-titulo" style={{ marginTop: 8 }}>Acceso restringido</h1>
                    <p style={{ color: 'var(--sc-t2)', margin: '8px auto 0', maxWidth: '52ch' }}>
                        La Consultoría IA está disponible solo para usuarios con rol de Gerencia (S.R.L.).
                    </p>
                </section>
            </div>
        );
    }
    return <ConsultoriaIAInterna />;
}

function ConsultoriaIAInterna() {
    const { esPhone } = useDevice();
    const chat = useHydricChat();
    const kb = useHydricKnowledge();
    const { activeEvent, cargado: eventoCargado, error: eventoError } = useHydricEvents();
    const frescura = useFrescuraSistema();
    const ahoraMs = useAhora(60_000);
    const sesionReal = useSesionReal();
    const [pestana, setPestana] = useState<Pestana>('chat');
    const [historialAbierto, setHistorialAbierto] = useState(false);

    const chips = useMemo<ChipEstado[]>(() => {
        const out: ChipEstado[] = [];
        // Motor: se conoce con certeza solo tras la primera respuesta (el servidor lo informa; no se adivina).
        if (!chat.motor) out.push({ key: 'motor', sev: 'info', texto: 'Motor de IA: se confirma al responder' });
        else if (chat.motor.proveedor === 'groq') out.push({ key: 'motor', sev: 'warn', texto: 'Motor de respaldo (Groq): Claude no está configurado' });
        else out.push({ key: 'motor', sev: 'ok', texto: `Motor: Claude${chat.motor.modelo ? ` · ${chat.motor.modelo.replace(/^claude-/, '')}` : ''}` });

        out.push({ key: 'protocolo', sev: eventoCargado && !eventoError ? 'info' : 'warn', texto: activeEvent ? `Protocolo vigente: ${activeEvent.evento_tipo}` : !eventoCargado ? 'Protocolo: sincronizando…' : eventoError ? 'Protocolo: S/D' : 'Sin protocolo oficial vigente' });

        if (frescura.cargado && ahoraMs > 0) {
            const ahora = ahoraMs;
            const presa = frescura.presaMs == null ? null : ahora - frescura.presaMs;
            out.push({ key: 'presas', sev: presa == null ? 'warn' : presa > STALE_PRESA_H * 3_600_000 ? 'warn' : 'ok', texto: presa == null ? 'Presas: S/D' : `Presas: lectura ${edadTexto(presa)}` });
            const escala = frescura.escalaMs == null ? null : ahora - frescura.escalaMs;
            out.push({ key: 'escalas', sev: escala == null || escala > STALE_ESCALA_MIN * 60_000 ? 'warn' : 'ok', texto: frescura.error && escala == null ? 'Escalas: S/D' : escala == null ? 'Escalas: sin medición de campo' : `Escalas: medición ${edadTexto(escala)}` });
        }

        const indexados = kb.documents.filter((d) => d.estado_procesamiento === 'completado').length;
        const enProceso = kb.documents.filter((d) => d.estado_procesamiento === 'pendiente' || d.estado_procesamiento === 'procesando').length;
        out.push({ key: 'docs', sev: 'info', texto: kb.cargado && sesionReal !== false ? `${indexados} documentos indexados${enProceso ? ` · ${enProceso} en proceso` : ''}` : 'Documentos: S/D' });
        return esPhone ? out.slice(0, 3) : out;
    }, [chat.motor, activeEvent, eventoCargado, eventoError, frescura, kb.documents, kb.cargado, sesionReal, esPhone, ahoraMs]);

    const reintentar = (f: EnvioFallido) => { void chat.sendMessage(f.texto, f.contexto, f); };
    const teclasPestanas = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const sig: Pestana = pestana === 'chat' ? 'biblioteca' : 'chat';
            setPestana(sig);
            requestAnimationFrame(() => document.getElementById(`ci-tab-${sig}`)?.focus());     // el foco acompaña a la pestaña activa
        }
    };

    return (
        <div className="sc-root sc-pagina ci-pagina">
            <PaginaHero
                kicker="Inteligencia hídrica · solo S.R.L."
                titulo="Consultoría IA"
                subtitulo="Asistente especialista en hidrometría y modelado del DR-005 Delicias. Consulta datos reales del sistema; lo que no tiene medición vigente lo informa como S/D."
                chips={chips}
                // En teléfono, Protocolos ya está en el menú: se ahorra una fila completa de cabecera.
                acciones={esPhone ? undefined : <Link to="/protocolos" className="sc-btn"><Siren size={16} aria-hidden="true" /> Protocolos</Link>}
            />

            {sesionReal === false && (
                <p className="sc-aviso sc-aviso-warn" role="alert">
                    <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>Estás en una <b>sesión local de emergencia</b> (sin credenciales de Supabase). El asistente, el historial y la biblioteca necesitan tu usuario real: cierra sesión e inicia con tu cuenta S.R.L. Los conteos de esta pantalla no son confiables en este modo.</span>
                </p>
            )}

            <div className="ci-tabs" role="tablist" aria-label="Secciones de Consultoría IA" onKeyDown={teclasPestanas}>
                <button type="button" role="tab" id="ci-tab-chat" aria-selected={pestana === 'chat'} aria-controls="ci-panel-chat" tabIndex={pestana === 'chat' ? 0 : -1} className="ci-tab" onClick={() => setPestana('chat')}>
                    <MessageSquare size={16} aria-hidden="true" /> Consultoría chat
                </button>
                <button type="button" role="tab" id="ci-tab-biblioteca" aria-selected={pestana === 'biblioteca'} aria-controls="ci-panel-biblioteca" tabIndex={pestana === 'biblioteca' ? 0 : -1} className="ci-tab" onClick={() => setPestana('biblioteca')}>
                    <Library size={16} aria-hidden="true" /> Base de conocimiento
                </button>
            </div>

            {/* El chat se oculta, no se desmonta: el borrador, el scroll y una respuesta en curso sobreviven al cambio de pestaña. */}
            {(
                <div className="ci-shell" id="ci-panel-chat" role="tabpanel" aria-labelledby="ci-tab-chat" hidden={pestana !== 'chat'} style={pestana !== 'chat' ? { display: 'none' } : undefined}>
                    <Historial
                        conversaciones={chat.conversations} activaId={chat.activeConversationId} cargando={chat.isLoading}
                        historialNoDisponible={chat.historialJwtError} abierto={historialAbierto} onCerrar={() => setHistorialAbierto(false)}
                        onSeleccionar={(id) => { void chat.selectConversation(id); }} onNueva={chat.startNewConversation}
                        onRenombrar={(id, t) => { void chat.renameConversation(id, t); }} onEliminar={(id) => { void chat.deleteConversation(id); }}
                    />
                    <ChatPanel
                        mensajes={chat.messages} cargandoMensajes={chat.isLoadingMessages} enviando={chat.isSending} paso={chat.paso}
                        error={chat.error} fallido={chat.fallido} valoraciones={chat.valoraciones} onValorar={(id, v) => { void chat.valorar(id, v); }} cooldownUntil={chat.cooldownUntil} eventoTipo={activeEvent?.evento_tipo}
                        onEnviar={(t, ctx) => chat.sendMessage(t, ctx)} onReintentar={reintentar} onDetener={chat.detener}
                        onNueva={chat.startNewConversation} onAbrirHistorial={() => setHistorialAbierto(true)} onCerrarError={() => { chat.clearError(); chat.clearFallido(); }}
                    />
                </div>
            )}

            {pestana === 'biblioteca' && (
                <div id="ci-panel-biblioteca" role="tabpanel" aria-labelledby="ci-tab-biblioteca">
                    <Suspense fallback={<p className="ci-vacio" role="status">Cargando biblioteca…</p>}>
                        <BaseConocimiento
                            documentos={kb.documents} cargado={kb.cargado} subiendo={kb.isUploading} error={kb.error} onCerrarError={kb.clearError}
                            onSubir={kb.uploadDocument} onEliminar={kb.deleteDocument} onReintentar={kb.reprocesarDocumento}
                        />
                    </Suspense>
                </div>
            )}
        </div>
    );
}
