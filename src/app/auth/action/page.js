'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { verifyPasswordResetCode, confirmPasswordReset, applyActionCode } from 'firebase/auth';
import { auth } from '../../lib/firebase';

function AuthActionContent() {
    const searchParams = useSearchParams();
    const mode = searchParams.get('mode');
    const oobCode = searchParams.get('oobCode');

    const [email, setEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPass, setConfirmPass] = useState('');
    const [status, setStatus] = useState('loading'); // loading | ready | success | error
    const [error, setError] = useState('');

    useEffect(() => {
        if (!oobCode) {
            setStatus('error');
            setError('Invalid or missing action code.');
            return;
        }

        if (mode === 'resetPassword') {
            verifyPasswordResetCode(auth, oobCode)
                .then((email) => {
                    setEmail(email);
                    setStatus('ready');
                })
                .catch(() => {
                    setStatus('error');
                    setError('This password reset link has expired or already been used. Please request a new one.');
                });
        } else if (mode === 'verifyEmail') {
            applyActionCode(auth, oobCode)
                .then(() => setStatus('verified'))
                .catch(() => {
                    setStatus('error');
                    setError('This verification link has expired or already been used.');
                });
        } else {
            setStatus('error');
            setError('Unknown action.');
        }
    }, [mode, oobCode]);

    const handleResetPassword = async (e) => {
        e.preventDefault();
        setError('');

        if (newPassword.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        if (newPassword !== confirmPass) {
            setError('Passwords do not match.');
            return;
        }

        try {
            await confirmPasswordReset(auth, oobCode, newPassword);
            setStatus('success');
        } catch (err) {
            if (err.code === 'auth/weak-password') {
                setError('Password is too weak. Please use at least 6 characters.');
            } else if (err.code === 'auth/expired-action-code') {
                setError('This link has expired. Please request a new password reset.');
            } else {
                setError('Something went wrong. Please try again.');
            }
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(145deg, #f0f2f8 0%, #e8eaf3 30%, #f5f6fa 100%)',
            padding: '24px',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        }}>
            <div style={{
                width: '100%',
                maxWidth: '440px',
                textAlign: 'center',
            }}>
                {/* Logo */}
                <div style={{ marginBottom: '32px' }}>
                    <h1 style={{
                        fontSize: '2rem',
                        fontWeight: 800,
                        color: '#171a21',
                        margin: 0,
                        letterSpacing: '-0.02em',
                    }}>
                        Civis<span style={{ color: '#6366f1' }}>ly</span>
                    </h1>
                </div>

                {/* Card */}
                <div style={{
                    background: '#fff',
                    borderRadius: '20px',
                    boxShadow: '0 8px 40px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
                    padding: '36px 32px',
                }}>
                    {/* Loading */}
                    {status === 'loading' && (
                        <div style={{ padding: '20px 0' }}>
                            <div style={{
                                width: '36px', height: '36px',
                                border: '3px solid #e5e7eb',
                                borderTopColor: '#6366f1',
                                borderRadius: '50%',
                                animation: 'spin 0.8s linear infinite',
                                margin: '0 auto 16px',
                            }} />
                            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>Verifying your link...</p>
                        </div>
                    )}

                    {/* Reset Password Form */}
                    {status === 'ready' && mode === 'resetPassword' && (
                        <>
                            <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>🔐</div>
                            <h2 style={{
                                fontSize: '1.25rem', fontWeight: 700,
                                color: '#171a21', marginBottom: '4px',
                            }}>Reset Your Password</h2>
                            <p style={{
                                fontSize: '0.85rem', color: '#6b7280',
                                marginBottom: '24px',
                            }}>
                                Enter a new password for <strong style={{ color: '#374151' }}>{email}</strong>
                            </p>

                            <form onSubmit={handleResetPassword} style={{
                                display: 'flex', flexDirection: 'column', gap: '14px',
                                textAlign: 'left',
                            }}>
                                <div>
                                    <label style={{
                                        fontSize: '0.78rem', fontWeight: 600, color: '#4b5263',
                                        display: 'block', marginBottom: '5px',
                                    }}>New Password</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        style={{
                                            width: '100%', padding: '11px 14px',
                                            borderRadius: '10px', border: '1px solid #d8dbe2',
                                            fontSize: '16px', outline: 'none',
                                            background: '#fafbfc', boxSizing: 'border-box',
                                        }}
                                    />
                                </div>
                                <div>
                                    <label style={{
                                        fontSize: '0.78rem', fontWeight: 600, color: '#4b5263',
                                        display: 'block', marginBottom: '5px',
                                    }}>Confirm Password</label>
                                    <input
                                        type="password"
                                        placeholder="••••••••"
                                        value={confirmPass}
                                        onChange={(e) => setConfirmPass(e.target.value)}
                                        required
                                        minLength={6}
                                        style={{
                                            width: '100%', padding: '11px 14px',
                                            borderRadius: '10px', border: '1px solid #d8dbe2',
                                            fontSize: '16px', outline: 'none',
                                            background: '#fafbfc', boxSizing: 'border-box',
                                        }}
                                    />
                                </div>

                                {error && (
                                    <div style={{
                                        padding: '10px 14px', background: '#fef2f2',
                                        border: '1px solid #fecaca', borderRadius: '8px',
                                        color: '#b91c1c', fontSize: '0.8rem',
                                    }}>{error}</div>
                                )}

                                <button type="submit" style={{
                                    width: '100%', padding: '12px 16px',
                                    borderRadius: '12px', border: 'none',
                                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                    color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                                    cursor: 'pointer', marginTop: '4px',
                                    boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
                                }}>
                                    Set New Password
                                </button>
                            </form>
                        </>
                    )}

                    {/* Success */}
                    {status === 'success' && (
                        <>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>✅</div>
                            <h2 style={{
                                fontSize: '1.25rem', fontWeight: 700,
                                color: '#171a21', marginBottom: '8px',
                            }}>Password Updated!</h2>
                            <p style={{
                                fontSize: '0.88rem', color: '#6b7280',
                                marginBottom: '24px', lineHeight: 1.5,
                            }}>
                                Your password has been successfully reset. You can now sign in with your new password.
                            </p>
                            <a href="/" style={{
                                display: 'inline-block', padding: '12px 28px',
                                borderRadius: '12px', textDecoration: 'none',
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                                boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
                            }}>
                                Go to Civisly →
                            </a>
                        </>
                    )}

                    {/* Email Verified */}
                    {status === 'verified' && (
                        <>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>✅</div>
                            <h2 style={{
                                fontSize: '1.25rem', fontWeight: 700,
                                color: '#171a21', marginBottom: '8px',
                            }}>Email Verified!</h2>
                            <p style={{
                                fontSize: '0.88rem', color: '#6b7280',
                                marginBottom: '24px', lineHeight: 1.5,
                            }}>
                                Your email has been verified. You're all set!
                            </p>
                            <a href="/" style={{
                                display: 'inline-block', padding: '12px 28px',
                                borderRadius: '12px', textDecoration: 'none',
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                                boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
                            }}>
                                Go to Civisly →
                            </a>
                        </>
                    )}

                    {/* Error */}
                    {status === 'error' && (
                        <>
                            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⚠️</div>
                            <h2 style={{
                                fontSize: '1.25rem', fontWeight: 700,
                                color: '#171a21', marginBottom: '8px',
                            }}>Something Went Wrong</h2>
                            <p style={{
                                fontSize: '0.88rem', color: '#b91c1c',
                                marginBottom: '24px', lineHeight: 1.5,
                            }}>{error}</p>
                            <a href="/" style={{
                                display: 'inline-block', padding: '12px 28px',
                                borderRadius: '12px', textDecoration: 'none',
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: '#fff', fontSize: '0.9rem', fontWeight: 600,
                                boxShadow: '0 2px 8px rgba(99,102,241,0.25)',
                            }}>
                                Back to Civisly
                            </a>
                        </>
                    )}
                </div>

                <p style={{
                    marginTop: '24px', fontSize: '0.78rem',
                    color: '#8f95a5',
                }}>
                    © {new Date().getFullYear()} Civisly. Your Personal Civic Assistant.
                </p>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                input:focus {
                    border-color: #6366f1 !important;
                    box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
                    background: #fff !important;
                }
            `}</style>
        </div>
    );
}

export default function AuthActionPage() {
    return (
        <Suspense fallback={
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(145deg, #f0f2f8 0%, #e8eaf3 30%, #f5f6fa 100%)',
            }}>
                <div style={{
                    width: '36px', height: '36px',
                    border: '3px solid #e5e7eb',
                    borderTopColor: '#6366f1',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                }} />
            </div>
        }>
            <AuthActionContent />
        </Suspense>
    );
}
