'use client';

import { useState, useEffect } from 'react';
import styles from './Elections.module.css';

/* ====== SVG Icons ====== */
const CalendarIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
);

const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const ArrowRightIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

const VoteIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
);

const ClockIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);

/* ====== Checklist Items ====== */
const CHECKLIST_ITEMS = [
    { id: 'register', label: 'Register to vote (or verify your registration)' },
    { id: 'reps', label: 'Look up your representatives' },
    { id: 'bills', label: 'Read about upcoming bills in your feed' },
    { id: 'contact', label: 'Contact a representative about an issue' },
    { id: 'share', label: 'Share CivicLens with a friend' },
];

/* ====== Quick Actions ====== */
const QUICK_ACTIONS = [
    {
        emoji: '🗳️',
        title: 'Check Voter Registration',
        desc: 'Verify you\'re registered and your info is up to date.',
        url: 'https://www.vote.org/am-i-registered-to-vote/',
        external: true,
    },
    {
        emoji: '📋',
        title: 'Register to Vote',
        desc: 'Register online in minutes — it\'s quick and easy.',
        url: 'https://vote.gov/',
        external: true,
    },
    {
        emoji: '📍',
        title: 'Find Your Polling Place',
        desc: 'Locate where to vote on Election Day.',
        url: 'https://www.vote.org/polling-place-locator/',
        external: true,
    },
    {
        emoji: '📞',
        title: 'Contact Your Representatives',
        desc: 'See who represents you and how to reach them.',
        url: 'reps',
        external: false,
    },
];

/* ====== Important Dates ====== */
const IMPORTANT_DATES = [
    { date: '2026-03-15', label: 'Many states: voter registration deadline for spring primaries' },
    { date: '2026-04-07', label: 'Local spring elections in many jurisdictions' },
    { date: '2026-05-01', label: 'Primary election registration deadlines begin' },
    { date: '2026-06-02', label: 'Primary Election Day (varies by state)' },
    { date: '2026-10-05', label: 'Voter registration deadline for general election (most states)' },
    { date: '2026-10-19', label: 'Early voting begins (most states)' },
    { date: '2026-11-03', label: '2026 Midterm Election Day' },
];

export default function Elections() {
    const [elections, setElections] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [checkedItems, setCheckedItems] = useState({});

    // Load elections from API
    useEffect(() => {
        fetch('/api/elections')
            .then(res => res.json())
            .then(data => setElections(data.elections || []))
            .catch(() => { })
            .finally(() => setIsLoading(false));
    }, []);

    // Load/save checklist from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('civiclens_checklist');
        if (saved) {
            try { setCheckedItems(JSON.parse(saved)); } catch (e) { }
        }
    }, []);

    const toggleCheck = (id) => {
        setCheckedItems(prev => {
            const updated = { ...prev, [id]: !prev[id] };
            localStorage.setItem('civiclens_checklist', JSON.stringify(updated));
            return updated;
        });
    };

    const completedCount = CHECKLIST_ITEMS.filter(i => checkedItems[i.id]).length;
    const progressPercent = (completedCount / CHECKLIST_ITEMS.length) * 100;

    const getDaysUntil = (dateStr) => {
        const target = new Date(dateStr);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
        return diff;
    };

    const formatDate = (dateStr) => {
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
    };

    const isPast = (dateStr) => {
        return getDaysUntil(dateStr) < 0;
    };

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h2 className={styles.title}>Elections & Civic Actions</h2>
                <p className={styles.subtitle}>Stay informed, take action, and make your voice heard.</p>
            </div>

            {/* Section 1: Upcoming Elections */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    <CalendarIcon />
                    Upcoming Elections
                </h3>
                {isLoading ? (
                    <div className={styles.loading}>
                        <div className={styles.spinner}></div>
                        <p className={styles.loadingText}>Checking for elections...</p>
                    </div>
                ) : (
                    <div className={styles.electionList}>
                        {elections.map(election => {
                            const days = getDaysUntil(election.date);
                            const levelClass = election.level === 'federal' ? styles.electionFederal
                                : election.level === 'state' ? styles.electionState
                                    : styles.electionLocal;
                            const badgeClass = election.level === 'federal' ? styles.badgeFederal
                                : election.level === 'state' ? styles.badgeState
                                    : styles.badgeLocal;

                            return (
                                <div key={election.id} className={`${styles.electionCard} ${levelClass}`}>
                                    <div className={styles.electionIcon}>
                                        <VoteIcon />
                                    </div>
                                    <div className={styles.electionInfo}>
                                        <div className={styles.electionName}>
                                            {election.name}
                                            <span className={`${styles.levelBadge} ${badgeClass}`}>
                                                {election.level}
                                            </span>
                                        </div>
                                        <div className={styles.electionDate}>
                                            {formatDate(election.date)}
                                        </div>
                                    </div>
                                    <div className={`${styles.electionCountdown} ${days <= 60 ? styles.countdownSoon : styles.countdownFar}`}>
                                        <ClockIcon />
                                        {days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : `${days} days`}
                                    </div>
                                </div>
                            );
                        })}
                        {elections.length === 0 && (
                            <p style={{ color: 'var(--cl-gray-500)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
                                No upcoming elections found. Check back closer to election season!
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Section 2: Quick Actions */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    ⚡ Quick Actions
                </h3>
                <div className={styles.actionsGrid}>
                    {QUICK_ACTIONS.map((action, i) => (
                        <a
                            key={i}
                            href={action.external ? action.url : '#'}
                            target={action.external ? '_blank' : undefined}
                            rel={action.external ? 'noopener noreferrer' : undefined}
                            className={styles.actionCard}
                            onClick={action.external ? undefined : (e) => {
                                e.preventDefault();
                                // Navigate to reps page — dispatch a custom event
                                window.dispatchEvent(new CustomEvent('civiclens:navigate', { detail: action.url }));
                            }}
                        >
                            <div className={styles.actionEmoji}>{action.emoji}</div>
                            <div className={styles.actionContent}>
                                <div className={styles.actionTitle}>{action.title}</div>
                                <div className={styles.actionDesc}>{action.desc}</div>
                            </div>
                            <div className={styles.actionArrow}>
                                <ArrowRightIcon />
                            </div>
                        </a>
                    ))}
                </div>
            </div>

            {/* Section 3: Civic Participation Checklist */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    ✅ Civic Participation Checklist
                </h3>
                <div className={styles.checklist}>
                    <div className={styles.progressBar}>
                        <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className={styles.progressText}>
                        {completedCount} of {CHECKLIST_ITEMS.length} completed
                    </div>
                    {CHECKLIST_ITEMS.map(item => (
                        <div
                            key={item.id}
                            className={styles.checkItem}
                            onClick={() => toggleCheck(item.id)}
                        >
                            <div className={`${styles.checkbox} ${checkedItems[item.id] ? styles.checkboxChecked : ''}`}>
                                <CheckIcon />
                            </div>
                            <span className={`${styles.checkLabel} ${checkedItems[item.id] ? styles.checkLabelDone : ''}`}>
                                {item.label}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Section 4: Important Dates */}
            <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                    📅 Important Dates
                </h3>
                <div className={styles.timeline}>
                    {IMPORTANT_DATES.map((item, i) => {
                        const past = isPast(item.date);
                        return (
                            <div key={i} className={styles.timelineItem}>
                                <div className={`${styles.timelineDot} ${past ? styles.timelineDotPast : ''}`} />
                                <div className={`${styles.timelineDate} ${past ? styles.timelineDatePast : ''}`}>
                                    {formatDate(item.date)}
                                </div>
                                <div className={`${styles.timelineText} ${past ? styles.timelineTextPast : ''}`}>
                                    {item.label}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
