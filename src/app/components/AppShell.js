'use client';

import { useState, useEffect, useRef, createContext, useContext } from 'react';
import styles from '../layout.module.css';
import { useProfile } from '../context/ProfileContext';
import OnboardingModal from './OnboardingModal';
import AIAssistant from './AIAssistant';
import Representatives from './Representatives';
import Elections from './Elections';
import CourtRulings from './CourtRulings';
import Settings from './Settings';
import AuthModal from './AuthModal';
import AuthScreen from './AuthScreen';
import authScreenStyles from './AuthScreen.module.css';
import NotificationPanel from './NotificationPanel';
import { useAuth } from '../context/AuthContext';
import { useWatchedBills } from '../context/WatchedBillsContext';
import { useSubscription } from '../context/SubscriptionContext';
import UpgradeModal from './UpgradeModal';

// Context to share the askAI callback with any descendant
const AskAIContext = createContext(null);
export function useAskAI() { return useContext(AskAIContext); }

/* --- Simple SVG Icons (inline, no external deps needed) --- */
const Icons = {
    logo: (
        <svg viewBox="0 0 512 512" width="24" height="24">
            <defs>
                <linearGradient id="sidebar-logo-bg" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#3b6de8"/>
                    <stop offset="100%" stopColor="#9b4fea"/>
                </linearGradient>
            </defs>
            <rect width="512" height="512" rx="112" ry="112" fill="url(#sidebar-logo-bg)"/>
            <text
                x="256"
                y="352"
                fontFamily="-apple-system, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif"
                fontSize="288"
                fontWeight="800"
                fill="white"
                textAnchor="middle"
                dominantBaseline="auto"
            >C</text>
        </svg>
    ),
    feed: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" />
        </svg>
    ),
    assistant: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
    ),
    reps: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
    elections: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    ),
    settings: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
    ),
    search: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    bell: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    ),
    menu: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
    ),
    trendUp: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
        </svg>
    ),
    zap: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
    ),
    rulings: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /><path d="M8 2l1.5 1.5" /><path d="M16 2l-1.5 1.5" /><path d="M4.5 7.5L3 7" /><path d="M19.5 7.5L21 7" />
        </svg>
    ),
};

const navItems = [
    { id: 'feed', label: 'My Feed', icon: Icons.feed },
    { id: 'assistant', label: 'AI Assistant', icon: Icons.assistant },
    { id: 'reps', label: 'Representatives', icon: Icons.reps },
    { id: 'rulings', label: 'Court Rulings', icon: Icons.rulings },
    { id: 'elections', label: 'Elections & Actions', icon: Icons.elections },
];

const secondaryNavItems = [
    { id: 'settings', label: 'Settings', icon: Icons.settings },
];

export default function AppShell({ children }) {
    const { profile, getPrimaryLocation } = useProfile();
    const { user, loading, logOut } = useAuth();
    const { unreadCount } = useWatchedBills();
    const { isPro } = useSubscription();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [activePage, setActivePage] = useState('feed');
    const [modalOpen, setModalOpen] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [showNotifPanel, setShowNotifPanel] = useState(false);
    const [askAIQuestion, setAskAIQuestion] = useState(null);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const contentRef = useRef(null);

    // Reset scroll position when switching pages
    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = 0;
        }
    }, [activePage]);

    const handleNavClick = (id) => {
        // Gate State & Local behind Pro subscription (web only — iOS has no IAP yet)
        const native = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
        if (id === 'state' && !native && !isPro) {
            setShowUpgradeModal(true);
            setSidebarOpen(false);
            return;
        }
        setActivePage(id);
        setSidebarOpen(false);
    };

    const handleAskAI = (question) => {
        setAskAIQuestion(question);
        setActivePage('assistant');
    };

    // Listen for custom navigation events (e.g., from Elections quick actions)
    useEffect(() => {
        const navHandler = (e) => setActivePage(e.detail);
        const authHandler = () => setShowAuthModal(true);
        window.addEventListener('civiclens:navigate', navHandler);
        window.addEventListener('civiclens:openAuth', authHandler);
        return () => {
            window.removeEventListener('civiclens:navigate', navHandler);
            window.removeEventListener('civiclens:openAuth', authHandler);
        };
    }, []);

    // Tag <html> with a class when running inside Capacitor native shell
    useEffect(() => {
        if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
            document.documentElement.classList.add('capacitor-native');
        }
    }, []);

    // Fix iOS WebView viewport shift when keyboard dismisses
    useEffect(() => {
        const handleFocusOut = () => {
            // Small delay to let iOS finish keyboard animation
            setTimeout(() => {
                window.scrollTo(0, 0);
            }, 100);
        };
        document.addEventListener('focusout', handleFocusOut);
        return () => document.removeEventListener('focusout', handleFocusOut);
    }, []);

    const locationText = getPrimaryLocation() || 'Add your location →';
    const profileName = profile.hasCompletedOnboarding ? 'Your Profile' : 'Set up profile';

    // --- Auth Gate: show loading or auth screen when not signed in ---
    if (loading) {
        return (
            <div className={authScreenStyles.loadingScreen}>
                <div className={authScreenStyles.spinner} />
            </div>
        );
    }

    if (!user) {
        return (
            <AuthScreen
                onSignUp={() => {
                    if (!profile.hasCompletedOnboarding) {
                        setTimeout(() => setModalOpen(true), 400);
                    }
                }}
            />
        );
    }

    return (
        <AskAIContext.Provider value={handleAskAI}>
            <div className={styles.shell}>
                {/* Sidebar */}
                <aside className={`${styles.sidebar} ${sidebarOpen ? styles.open : ''}`}>
                    <div className={styles.sidebarHeader}>
                        <div className={styles.logoMark}>
                            {Icons.logo}
                        </div>
                        <div className={styles.logoText}>
                            Civis<span>ly</span>
                        </div>
                    </div>

                    <nav className={styles.nav}>
                        <div className={styles.navSection}>
                            <div className={styles.navSectionLabel}>Main</div>
                            {navItems.map((item) => (
                                <button
                                    key={item.id}
                                    className={`${styles.navItem} ${activePage === item.id ? styles.active : ''}`}
                                    onClick={() => handleNavClick(item.id)}
                                >
                                    <span className={styles.navIcon}>{item.icon}</span>
                                    {item.label}
                                    {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                                </button>
                            ))}
                        </div>

                        <div className={styles.navSection}>
                            <div className={styles.navSectionLabel}>General</div>
                            {secondaryNavItems.map((item) => (
                                <button
                                    key={item.id}
                                    className={`${styles.navItem} ${activePage === item.id ? styles.active : ''}`}
                                    onClick={() => handleNavClick(item.id)}
                                >
                                    <span className={styles.navIcon}>{item.icon}</span>
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </nav>

                    <div className={styles.sidebarFooter}>
                        {user ? (
                            <div className={styles.userCard} onClick={() => { if (profile.hasCompletedOnboarding) { setActivePage('settings'); setSidebarOpen(false); } else { setModalOpen(true); setSidebarOpen(false); } }}>
                                <div className={styles.userAvatar}>
                                    {user.displayName ? user.displayName[0].toUpperCase() : user.email[0].toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className={styles.userName}>{user.displayName || user.email.split('@')[0]}</div>
                                    <div className={styles.userLocation}>{locationText}</div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); logOut(); }}
                                    title="Sign Out"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--cl-gray-400)', padding: '4px', borderRadius: '6px' }}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                                    </svg>
                                </button>
                            </div>
                        ) : (
                            <>
                                <div className={styles.userCard}>
                                    <div className={styles.userAvatar}>CL</div>
                                    <div>
                                        <div className={styles.userName}>Guest</div>
                                        <div className={styles.userLocation}>Sign in to save your data</div>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowAuthModal(true)}
                                    style={{
                                        width: '100%', marginTop: '8px', padding: '9px 16px', borderRadius: '10px',
                                        border: '1px solid var(--cl-primary-300)', background: 'var(--cl-primary-50)',
                                        color: 'var(--cl-primary-600)', fontSize: '0.82rem', fontWeight: 600,
                                        cursor: 'pointer', transition: 'all 0.2s'
                                    }}
                                >
                                    Sign In / Sign Up
                                </button>
                            </>
                        )}
                    </div>
                </aside>

                {/* Mobile overlay */}
                <div
                    className={`${styles.overlay} ${sidebarOpen ? styles.visible : ''}`}
                    onClick={() => setSidebarOpen(false)}
                />

                {/* Main area */}
                <main className={styles.mainArea}>
                    {/* Top bar */}
                    <header className={styles.topBar}>
                        <div className={styles.topBarLeft}>
                            <button
                                className={styles.menuButton}
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                                aria-label="Toggle menu"
                            >
                                {Icons.menu}
                            </button>
                            <h1 className={styles.pageTitle}>
                                {navItems.find(i => i.id === activePage)?.label ||
                                    secondaryNavItems.find(i => i.id === activePage)?.label ||
                                    'Civisly'}
                            </h1>
                        </div>

                        <div className={styles.searchBar}>
                            <span className={styles.searchIcon}>{Icons.search}</span>
                            <input
                                type="text"
                                className={styles.searchInput}
                                placeholder="Search laws, bills, reps..."
                            />
                            <span className={styles.searchShortcut}>⌘K</span>
                        </div>

                        <div className={styles.topBarRight} style={{ position: 'relative' }}>
                            <button
                                className={styles.topBarAction}
                                aria-label="Notifications"
                                onClick={() => setShowNotifPanel(p => !p)}
                                style={{ position: 'relative' }}
                            >
                                {Icons.bell}
                                {unreadCount > 0 && (
                                    <span className={styles.notifDot} style={{
                                        background: 'var(--cl-danger-500)',
                                        position: 'absolute', top: 6, right: 6,
                                        width: 8, height: 8, borderRadius: '50%',
                                        border: '2px solid white',
                                    }} />
                                )}
                            </button>
                            {showNotifPanel && (
                                <NotificationPanel onClose={() => setShowNotifPanel(false)} />
                            )}
                        </div>
                    </header>

                    {/* Content */}
                    <div className={styles.content} ref={contentRef}>
                        <div className={styles.contentInner}>
                            {activePage === 'assistant' ? (
                                <AIAssistant initialQuestion={askAIQuestion} onQuestionConsumed={() => setAskAIQuestion(null)} />
                            ) : activePage === 'reps' ? (
                                <Representatives />
                            ) : activePage === 'rulings' ? (
                                <CourtRulings />
                            ) : activePage === 'elections' ? (
                                <Elections />
                            ) : activePage === 'settings' ? (
                                <Settings />
                            ) : children}
                        </div>
                    </div>
                </main>

                <OnboardingModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
                {showAuthModal && (
                    <AuthModal
                        onClose={() => setShowAuthModal(false)}
                        onSignUp={() => {
                            if (!profile.hasCompletedOnboarding) {
                                setTimeout(() => setModalOpen(true), 300);
                            }
                        }}
                    />
                )}
                {showUpgradeModal && !(typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
            </div>
        </AskAIContext.Provider>
    );
}
