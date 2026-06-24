'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [profileFilter, setProfileFilter] = useState('all');
    const [courtFilter, setCourtFilter] = useState('all');
    const [topicFilter, setTopicFilter] = useState('all');
    const [sortBy, setSortBy] = useState('recent');
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);

    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const canSeeAll = isPro || isNative;

    // Fetch rulings
    const fetchRulings = async (pageNum = 1, append = false) => {
        if (append) {
            setIsLoadingMore(true);
        } else {
            setIsLoading(true);
        }
        setError('');
        try {
            const res = await fetch('/api/court-rulings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lifeTags: profile.lifeTags || [],
                    interests: profile.interests || [],
                    page: pageNum,
                }),
            });
            if (!res.ok) throw new Error(`API error: ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            if (append) {
                setRulings(prev => [...prev, ...(data.items || [])]);
            } else {
                setRulings(data.items || []);
            }
            setHasMore(data.hasMore || false);
            setPage(pageNum);
        } catch (err) {
            console.error('Court rulings fetch error:', err);
            setError(err.message);
        } finally {
            setIsLoading(false);
            setIsLoadingMore(false);
        }
    };

    // Fetch on mount
    useEffect(() => {
        fetchRulings(1, false);
    }, [profile.lifeTags, profile.interests]);

    const loadingMoreRef = useRef(false);
    const handleLoadMore = useCallback(() => {
        if (!loadingMoreRef.current && hasMore && !isLoading) {
            loadingMoreRef.current = true;
            fetchRulings(page + 1, true).finally(() => {
                loadingMoreRef.current = false;
            });
        }
    }, [page, hasMore, isLoading]);

    // Infinite scroll: observe sentinel div at bottom
    const sentinelRef = useRef(null);
    useEffect(() => {
        if (!sentinelRef.current) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !isLoadingMore && !isLoading) {
                    handleLoadMore();
                }
            },
            { threshold: 0.1 }
        );
        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [hasMore, isLoadingMore, isLoading, handleLoadMore]);

    const handleCourtFilter = (court) => {
        setCourtFilter(court);
    };

    // Apply filters and sorting
    const filteredRulings = rulings
        .filter(item => {
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
                        { id: 'federal_appeals', label: 'Federal Appeals' },
                        { id: 'district', label: 'District' },
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

                    {/* Infinite scroll sentinel */}
                    {hasMore && (
                        <div ref={sentinelRef} className={styles.loadingMore}>
                            <div className={styles.spinnerSmall} />
                            <span>Loading more rulings...</span>
                        </div>
                    )}
                    {!hasMore && rulings.length > 10 && (
                        <div className={styles.endOfList}>
                            You&apos;re all caught up! ⚖️
                        </div>
                    )}
                </div>
            )}

            {/* Upgrade Modal */}
            {showUpgradeModal && !isNative && (
                <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
            )}
        </div>
    );
}
