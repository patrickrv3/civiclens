'use client';

import { useState } from 'react';
import styles from './AuthModal.module.css';
import { useAuth } from '../context/AuthContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';

const isNative = () =>
    typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

const GoogleIcon = () => (
    <svg viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const CloseIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const MailIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
        <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
);

export default function AuthModal({ onClose, onSignUp }) {
    const { signUp, signIn, signInWithGoogle } = useAuth();
    const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'reset'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [resetSent, setResetSent] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (mode === 'signup') {
                await signUp(email, password);
                onClose();
                if (onSignUp) onSignUp();
            } else {
                await signIn(email, password);
                onClose();
            }
        } catch (err) {
            const code = err.code || '';
            if (code === 'auth/email-already-in-use') {
                setError('An account with this email already exists.');
            } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
                if (isNative()) {
                    setError('Invalid email or password. If you signed up with Google on the web, tap "Forgot Password?" below to set a password.');
                } else {
                    setError('Invalid email or password.');
                }
            } else if (code === 'auth/weak-password') {
                setError('Password must be at least 6 characters.');
            } else if (code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError(err.message || 'Something went wrong. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleResetPassword = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            await sendPasswordResetEmail(auth, email);
            setResetSent(true);
        } catch (err) {
            const code = err.code || '';
            if (code === 'auth/user-not-found') {
                setError('No account found with this email.');
            } else if (code === 'auth/invalid-email') {
                setError('Please enter a valid email address.');
            } else {
                setError('Something went wrong. Please try again.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleGoogle = async () => {
        setError('');
        setIsLoading(true);
        try {
            await signInWithGoogle();
            onClose();
            if (onSignUp) onSignUp();
        } catch (err) {
            console.error('Google sign-in error:', err.code, err.message);
            if (err.code !== 'auth/popup-closed-by-user' && err.code !== 'auth/cancelled-popup-request') {
                setError(`Sign-in failed (${err.code || 'unknown'}). Please try again.`);
            }
        } finally {
            setIsLoading(false);
        }
    };

    const switchToReset = () => {
        setMode('reset');
        setError('');
        setResetSent(false);
    };

    const switchToSignIn = () => {
        setMode('signin');
        setError('');
        setResetSent(false);
    };

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modal}>
                <div className={styles.modalInner}>
                    <button className={styles.closeBtn} onClick={onClose}>
                        <CloseIcon />
                    </button>

                    <div className={styles.header}>
                        <div className={styles.logo}>
                            Civis<span className={styles.logoAccent}>ly</span>
                        </div>
                        <p className={styles.headerSubtitle}>
                            {mode === 'reset'
                                ? 'Reset your password or set one for the first time.'
                                : mode === 'signin'
                                    ? 'Welcome back! Sign in to sync your data.'
                                    : 'Create an account to save your progress.'}
                        </p>
                    </div>

                    {/* Tabs — hide in reset mode */}
                    {mode !== 'reset' && (
                        <div className={styles.tabs}>
                            <button
                                className={`${styles.tab} ${mode === 'signin' ? styles.tabActive : ''}`}
                                onClick={() => { setMode('signin'); setError(''); }}
                            >
                                Sign In
                            </button>
                            <button
                                className={`${styles.tab} ${mode === 'signup' ? styles.tabActive : ''}`}
                                onClick={() => { setMode('signup'); setError(''); }}
                            >
                                Sign Up
                            </button>
                        </div>
                    )}

                    <div className={styles.body}>
                        {/* iOS-only banner for Google users */}
                        {isNative() && mode === 'signin' && (
                            <div className={styles.infoBanner}>
                                <span className={styles.infoBannerIcon}>ℹ️</span>
                                <span>Signed up with Google on civisly.com? Tap <strong>Forgot Password</strong> below to set a password for this app.</span>
                            </div>
                        )}

                        {/* Google button — only show on web */}
                        {!isNative() && mode !== 'reset' && (
                            <>
                                <button className={styles.googleBtn} onClick={handleGoogle} type="button">
                                    <GoogleIcon />
                                    Continue with Google
                                </button>
                                <div className={styles.divider}>or</div>
                            </>
                        )}

                        {/* Reset Password Form */}
                        {mode === 'reset' ? (
                            resetSent ? (
                                <div className={styles.resetSuccess}>
                                    <MailIcon />
                                    <h3>Check your email</h3>
                                    <p>We sent a password reset link to <strong>{email}</strong>. Click the link to set your password, then come back and sign in.</p>
                                    <button className={styles.submitBtn} type="button" onClick={switchToSignIn}>
                                        ← Back to Sign In
                                    </button>
                                </div>
                            ) : (
                                <form className={styles.form} onSubmit={handleResetPassword}>
                                    <div className={styles.field}>
                                        <label className={styles.label}>Email</label>
                                        <input
                                            className={styles.input}
                                            type="email"
                                            placeholder="you@example.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                        />
                                    </div>

                                    {error && <div className={styles.error}>{error}</div>}

                                    <button className={styles.submitBtn} type="submit" disabled={isLoading}>
                                        {isLoading ? 'Sending...' : 'Send Reset Link'}
                                    </button>

                                    <button className={styles.linkBtn} type="button" onClick={switchToSignIn}>
                                        ← Back to Sign In
                                    </button>
                                </form>
                            )
                        ) : (
                            /* Sign In / Sign Up Form */
                            <form className={styles.form} onSubmit={handleSubmit}>
                                <div className={styles.field}>
                                    <label className={styles.label}>Email</label>
                                    <input
                                        className={styles.input}
                                        type="email"
                                        placeholder="you@example.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className={styles.field}>
                                    <label className={styles.label}>Password</label>
                                    <input
                                        className={styles.input}
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                    />
                                </div>

                                {error && <div className={styles.error}>{error}</div>}

                                <button className={styles.submitBtn} type="submit" disabled={isLoading}>
                                    {isLoading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
                                </button>

                                {mode === 'signin' && (
                                    <button className={styles.linkBtn} type="button" onClick={switchToReset}>
                                        Forgot Password?
                                    </button>
                                )}
                            </form>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
