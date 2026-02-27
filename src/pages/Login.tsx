import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogIn, Lock, Mail } from 'lucide-react';
import './Login.css';

const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) throw authError;

            navigate('/');
        } catch (err: any) {
            console.error('Login error:', err);
            setError(err.message || 'Error al iniciar sesión. Verifica tus credenciales.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-bg-glow"></div>

            <div className="login-card">
                <div className="logo-container">
                    <img
                        src="/logos/logo-srl.png"
                        alt="SRL Unidad Conchos"
                        className="logo-srl"
                        style={{
                            width: '190px',
                            height: 'auto',
                            maxHeight: 'none',
                            minHeight: '0',
                            display: 'block',
                            objectFit: 'contain',
                            flexShrink: 0
                        }}
                    />
                </div>

                <div className="login-header">
                    <h1 className="login-title">Unidad Conchos</h1>
                    <span className="login-subtitle">HIDRO-SINCRONÍA DIGITAL</span>
                    <p className="login-description">
                        Sociedad de Asociaciones de Usuarios Unidad Conchos S.R.L. De I.P. y C.V.
                    </p>
                </div>

                <div className="divider"></div>

                <div className="login-header">
                    <h3 className="login-section-title">
                        CONTROL DIGITAL
                    </h3>
                    <p className="login-section-desc">
                        Ingresa tus credenciales para acceder al sistema
                    </p>
                </div>

                <form onSubmit={handleLogin} style={{ width: '100%' }}>
                    <div className="form-group">
                        <label className="form-label">CORREO ELECTRÓNICO</label>
                        <div className="input-wrapper">
                            <Mail className="input-icon" size={18} />
                            <input
                                type="email"
                                placeholder="correo@srlconchos.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="login-input"
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">CONTRASEÑA</label>
                        <div className="input-wrapper">
                            <Lock className="input-icon" size={18} />
                            <input
                                type="password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="login-input"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="error-message">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="login-button"
                    >
                        {loading ? (
                            <div className="loading-spinner"></div>
                        ) : (
                            <>
                                <LogIn size={20} />
                                <span>Iniciar Sesión</span>
                            </>
                        )}
                    </button>
                </form>

                <div className="footer-logo-section">
                    <span className="footer-tagline">Respaldo Tecnológico</span>
                    <div className="sica-badge">
                        <img src="/logos/SICA005.png" alt="SICA 005" className="logo-sica" />
                    </div>

                    <div className="version-info">
                        <span className="version-label">
                            SICA v{APP_VERSION} • {BUILD_HASH}
                        </span>

                        <button
                            onClick={() => {
                                if (window.confirm('¿Deseas FORZAR la limpieza de la aplicación? Se borrará el caché y tendrás que volver a iniciar sesión.')) {
                                    window.location.href = "/nuke";
                                }
                            }}
                            className="nuke-button"
                        >
                            Limpiar Caché y Actualizar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
