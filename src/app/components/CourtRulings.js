'use client';

import { useState, useEffect } from 'react';
import styles from './CourtRulings.module.css';
import FeedCard from './FeedCard';
import { useProfile } from '../context/ProfileContext';
import { useSubscription } from '../context/SubscriptionContext';
import UpgradeModal from './UpgradeModal';

const TOPIC_OPTIONS = [
    'Immigration', 'First Amendment', 'Executive Power', 'Civil Rights',
    'Voting Rights', 'Criminal Justice', 'Environment', 'Healthcare',
    'Gun Rights', 'Labor', 'Technology', 'Education',
];

export default function CourtRulings() {
    const { profile } = useProfile();
    const { isPro } = useSubscription();

    const [rulings, setRulings] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [profileFilter, setProfileFilter] = useState('all');
    const [courtFilter, setCourtFilter] = useState('all');
    const [topicFilter, setTopicFilter] = useState('all');
    const [sortBy, setSortBy] = useState('recent');
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);

    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const canSeeAll = isPro || isNative;

    // Fetch rulings on mount
    useEffect(() => {
        async function fetchRulings() {
            setIsLoading(true);
            setError('');
            try {
                const res = await fetch('/api/court-rulings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lifeTags: profile.lifeTags || [],
                        interests: profile.interests || [],
                    }),
                });
                if (!res.ok) throw new Error(`API error: ${res.status}`);
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                setRulings(data.items || []);
            } catch (err) {
                console.error('Court rulings fetch error:', err);
                setError(err.message);
            } finally {
                setIsLoading(false);
            }
        }
        fetchRulings();
    }, [profile.lifeTags, profile.interests]);

    // Handle court filter clicks with Pro gating
    const handleCourtFilter = (court) => {
        if (!canSeeAll && court !== 'all' && court !== 'scotus') {
            setShowUpgradeModal(true);
            return;
        }
        setCourtFilter(court);
    };

    // Apply filters and sorting
    const filteredRulings = rulings
        .filter(item => {
            // Pro gating: non-Pro users only see SCOTUS on web
            if (!canSeeAll && item.courtType !== 'scotus') return false;

            // Profile filter
            if (profileFilter === 'high-profile' && item.profileLevel !== 'High Profile') return false;
            if (profileFilter === 'notable' && item.profileLevel !== 'Notable') return false;

            // Court filter
            if (courtFilter !== 'all' && item.courtType !== courtFilter) return false;

            // Topic filter
            if (topicFilter !== 'all') {
                const topics = item.topics || [];
                if (!topics.includes(topicFilter)) return false;
            }

            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'impact') {
                const impactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
                return (impactOrder[a.impactLevel] ?? 2) - (impactOrder[b.impactLevel] ?? 2);
            }
            // Default: most recent first
            return (b.date || '').localeCompare(a.date || '');
        });

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h1 className={styles.title}>⚖️ Court Rulings</h1>
                <p className={styles.subtitle}>Recent judicial decisions explained in plain English</p>
            </div>

            {/* Filter Bar */}
            <div className={styles.filterBar}>
                {/* Profile Filter */}
                <span className={styles.filterLabel}>PROFILE:</span>
                <div className={styles.filterGroup}>
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'high-profile', label: '🔥 High Profile' },
                        { id: 'notable', label: 'Notable' },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.filterPill} ${profileFilter === f.id ? styles.filterPillActive : ''}`}
                            onClick={() => setProfileFilter(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className={styles.filterDivider} />

                {/* Court Filter */}
                <span className={styles.filterLabel}>COURT:</span>
                <div className={styles.filterGroup}>
                    {[
                        { id: 'all', label: 'All Courts' },
                        { id: 'scotus', label: 'Supreme Court' },
                        { id: 'federal_appeals', label: `Federal Appeals${!canSeeAll ? ' 🔒' : ''}` },
                        { id: 'state_supreme', label: `State Supreme${!canSeeAll ? ' 🔒' : ''}` },
                        { id: 'district', label: `District${!canSeeAll ? ' 🔒' : ''}` },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.filterPill} ${courtFilter === f.id ? styles.filterPillActive : ''}`}
                            onClick={() => handleCourtFilter(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <div className={styles.filterDivider} />

                {/* Topic Filter */}
                <select
                    className={styles.topicSelect}
                    value={topicFilter}
                    onChange={(e) => setTopicFilter(e.target.value)}
                >
                    <option value="all">All Topics</option>
                    {TOPIC_OPTIONS.map(topic => (
                        <option key={topic} value={topic}>{topic}</option>
                    ))}
                </select>

                <div className={styles.filterDivider} />

                {/* Sort */}
                <span className={styles.filterLabel}>SORT:</span>
                <div className={styles.filterGroup}>
                    {[
                        { id: 'recent', label: '🕐 Most Recent' },
                        { id: 'impact', label: '⚡ High Impact' },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.filterPill} ${sortBy === f.id ? styles.filterPillActive : ''}`}
                            onClick={() => setSortBy(f.id)}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Pro Upsell Banner */}
            {!canSeeAll && (
                <div className={styles.proBanner}>
                    🏛️ Showing <strong>Supreme Court rulings only</strong>.{' '}
                    <a onClick={() => setShowUpgradeModal(true)}>Upgrade to Pro</a>{' '}
                    to see Federal Appeals, State Supreme Courts &amp; District Court rulings.
                </div>
            )}

            {/* Loading State */}
            {isLoading && (
                <div className={styles.loadingContainer}>
                    <div className={styles.spinner} />
                    <span className={styles.loadingText}>Loading court rulings...</span>
                </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
                <div className={styles.errorBanner}>
                    Error loading court rulings: {error}
                </div>
            )}

            {/* Empty State */}
            {!isLoading && !error && filteredRulings.length === 0 && (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>⚖️</div>
                    <div className={styles.emptyTitle}>No court rulings found</div>
                    <div className={styles.emptyText}>
                        {profileFilter !== 'all' || courtFilter !== 'all' || topicFilter !== 'all'
                            ? 'Try adjusting your filters to see more results.'
                            : 'Check back later for new rulings.'}
                    </div>
                </div>
            )}

            {/* Rulings List */}
            {!isLoading && !error && filteredRulings.length > 0 && (
                <div className={styles.rulingsList}>
                    {filteredRulings.map(item => (
                        <FeedCard key={item.id} item={item} profile={profile} />
                    ))}
                </div>
            )}

            {/* Upgrade Modal */}
            {showUpgradeModal && !isNative && (
                <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
            )}
        </div>
    );
}
