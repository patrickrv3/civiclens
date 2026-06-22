'use client';

import { useState, useEffect, useRef } from 'react';
import styles from './Settings.module.css';
import { useProfile } from '../context/ProfileContext';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';

const LIFE_TAGS = [
    'Homeowner', 'Renter', 'Student', 'Parent', 'Veteran',
    'Small Business Owner', 'Freelancer', 'Retiree', 'Immigrant',
    'Healthcare Worker', 'Educator', 'First-time Voter',
];

const POLICY_INTERESTS = [
    'Healthcare', 'Education', 'Housing', 'Immigration', 'Taxes',
    'Environment & Climate', 'Criminal Justice', 'Gun Policy',
    'Economy & Jobs', 'Technology & Privacy', 'Civil Rights',
    'National Security', 'Infrastructure', 'Social Security',
];

export default function Settings() {
    const { profile, updateProfile } = useProfile();
    const { user, logOut } = useAuth();
    const { isPro, subscription, startCheckout, openPortal } = useSubscription();
    const [zip, setZip] = useState(profile.location?.zipCode || '');
    const [showSaved, setShowSaved] = useState(false);
    const saveTimeout = useRef(null);

    // Sync zip from profile when it loads
    useEffect(() => {
        if (profile.location?.zipCode && !zip) {
            setZip(profile.location.zipCode);
        }
    }, [profile.location?.zipCode]);

    const handleZipChange = (e) => {
        const value = e.target.value.replace(/\D/g, '').slice(0, 5);
        setZip(value);

        if (saveTimeout.current) clearTimeout(saveTimeout.current);

        if (value.length === 5) {
            saveTimeout.current = setTimeout(() => {
                updateProfile({ location: { zipCode: value } });
                setShowSaved(true);
                setTimeout(() => setShowSaved(false), 2000);
            }, 500); // Debounce
        }
    };

    const toggleLifeTag = (tag) => {
        const current = profile.lifeTags || [];
        const updated = current.includes(tag)
            ? current.filter(t => t !== tag)
            : [...current, tag];
        updateProfile({ lifeTags: updated });
    };

    const toggleInterest = (interest) => {
        const current = profile.interests || [];
        const updated = current.includes(interest)
            ? current.filter(i => i !== interest)
            : [...current, interest];
        updateProfile({ interests: updated });
    };

    const togglePersonalizedImpact = () => {
        updateProfile({ wantsPersonalizedImpact: !profile.wantsPersonalizedImpact });
    };

    const handleResetProfile = () => {
        if (window.confirm('Are you sure you want to reset your profile? This will clear all your preferences.')) {
            updateProfile({
                hasCompletedOnboarding: false,
                location: { zipCode: '' },
                lifeTags: [],
                interests: [],
                wantsPersonalizedImpact: false,
            });
            setZip('');
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Settings</h2>
                <p className={styles.subtitle}>Manage your profile, preferences, and account.</p>
            </div>

            {/* Location */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>📍 Location</div>
                <div className={styles.card}>
                    <div className={styles.fieldRow}>
                        <label className={styles.fieldLabel}>Zip Code</label>
                        <input
                            className={styles.input}
                            type="text"
                            placeholder="e.g. 90505"
                            value={zip}
                            onChange={handleZipChange}
                            maxLength={5}
                        />
                        {showSaved && <span className={styles.savedBadge}>✓ Saved</span>}
                    </div>
                </div>
            </div>

            {/* Life Situation */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>🏷️ Life Situation</div>
                <div className={styles.card}>
                    <div className={styles.tagGrid}>
                        {LIFE_TAGS.map(tag => (
                            <button
                                key={tag}
                                className={`${styles.tag} ${(profile.lifeTags || []).includes(tag) ? styles.tagActive : ''}`}
                                onClick={() => toggleLifeTag(tag)}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Policy Interests */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>📋 Policy Interests</div>
                <div className={styles.card}>
                    <div className={styles.tagGrid}>
                        {POLICY_INTERESTS.map(interest => (
                            <button
                                key={interest}
                                className={`${styles.tag} ${(profile.interests || []).includes(interest) ? styles.tagActive : ''}`}
                                onClick={() => toggleInterest(interest)}
                            >
                                {interest}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Personalization */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>✨ Personalization</div>
                <div className={styles.card}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleInfo}>
                            <div className={styles.toggleLabel}>Show &ldquo;Why it matters to you&rdquo;</div>
                            <div className={styles.toggleDesc}>
                                Display personalized impact explanations on feed cards based on your life situation.
                            </div>
                        </div>
                        <button
                            className={`${styles.toggle} ${profile.wantsPersonalizedImpact ? styles.toggleOn : ''}`}
                            onClick={togglePersonalizedImpact}
                        />
                    </div>
                </div>
            </div>

            {/* Subscription — hidden in iOS app until Apple IAP is implemented */}
            {!(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) && (
            <div className={styles.section}>
                <div className={styles.sectionTitle}>⚡ Subscription</div>
                <div className={styles.card}>
                    {isPro ? (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <span style={{
                                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                    color: '#fff', borderRadius: '99px',
                                    padding: '3px 12px', fontSize: '0.8rem', fontWeight: 700,
                                }}>Pro Member ✓</span>
                                <span style={{ fontSize: '0.85rem', color: 'var(--cl-gray-500)' }}>$4.99/month</span>
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--cl-gray-500)', marginBottom: '14px' }}>
                                You have full access to State &amp; Local legislation and bill tracking notifications.
                            </p>
                            <button
                                onClick={openPortal}
                                style={{
                                    padding: '9px 18px', borderRadius: '10px',
                                    border: '1px solid var(--cl-gray-200)',
                                    background: '#fff', cursor: 'pointer',
                                    fontSize: '0.85rem', fontWeight: 600,
                                    color: 'var(--cl-gray-700)',
                                }}
                            >
                                Manage Subscription →
                            </button>
                        </div>
                    ) : (
                        <div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '6px', color: 'var(--cl-gray-900)' }}>
                                Upgrade to Civisly Pro
                            </div>
                            <p style={{ fontSize: '0.85rem', color: 'var(--cl-gray-500)', marginBottom: '14px' }}>
                                Get access to State &amp; Local legislation, bill watching, and in-app notifications — just $4.99/month.
                            </p>
                            <button
                                onClick={startCheckout}
                                style={{
                                    padding: '11px 22px', borderRadius: '12px',
                                    background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                    color: '#fff', fontWeight: 700, fontSize: '0.9rem',
                                    border: 'none', cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
                                }}
                            >
                                Upgrade — $4.99/month
                            </button>
                        </div>
                    )}
                </div>
            </div>
            )}

            {/* Account */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>👤 Account</div>
                <div className={styles.card}>
                    {user ? (
                        <>
                            <div className={styles.accountInfo}>
                                <div className={styles.accountAvatar}>
                                    {user.displayName ? user.displayName[0].toUpperCase() : user.email[0].toUpperCase()}
                                </div>
                                <div>
                                    <div className={styles.accountEmail}>{user.displayName || user.email}</div>
                                    <div className={styles.accountLabel}>Signed in · Data synced to cloud</div>
                                </div>
                            </div>
                            <button className={styles.signOutBtn} onClick={logOut}>
                                Sign Out
                            </button>
                        </>
                    ) : (
                        <div className={styles.signInPrompt}>
                            <p>Sign in to sync your profile across devices.</p>
                            <button
                                className={styles.signInBtn}
                                onClick={() => window.dispatchEvent(new CustomEvent('civiclens:openAuth'))}
                            >
                                Sign In / Sign Up
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Danger Zone */}
            <div className={styles.section}>
                <div className={styles.sectionTitle}>⚠️ Danger Zone</div>
                <div className={styles.dangerCard}>
                    <div className={styles.toggleRow}>
                        <div className={styles.toggleInfo}>
                            <div className={styles.toggleLabel}>Reset Profile</div>
                            <div className={styles.toggleDesc}>
                                Clear all your preferences and start fresh. This cannot be undone.
                            </div>
                        </div>
                    </div>
                    <button className={styles.resetBtn} onClick={handleResetProfile}>
                        Reset All Preferences
                    </button>
                </div>
            </div>
        </div>
    );
}
