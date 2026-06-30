'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './CourtRulings.module.css';
import FeedCard from './FeedCard';
import { useProfile } from '../context/ProfileContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useCourtRulings } from '../context/CourtRulingsContext';
import UpgradeModal from './UpgradeModal';

const PAGE_SIZE = 10;

export default function CourtRulings() {
    const { profile } = useProfile();
    const { isPro } = useSubscription();
    const { rulings, isLoading, error } = useCourtRulings();

    const [courtFilter, setCourtFilter] = useState('all');
    const [sortBy, setSortBy] = useState('recent');
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    const sentinelRef = useRef(null);

    const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
    const canSeeAll = isPro || isNative;

    // Reset visible count when filters change
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [courtFilter, sortBy]);

    // Apply filters and sorting
    const filteredRulings = rulings
        .filter(item => {
            if (courtFilter !== 'all' && item.courtType !== courtFilter) return false;
            return true;
        })
        .sort((a, b) => {
            if (sortBy === 'impact') {
                const impactOrder = { 'High Impact': 0, 'Moderate Impact': 1, 'Low Impact': 2 };
                return (impactOrder[a.impactLevel] ?? 2) - (impactOrder[b.impactLevel] ?? 2);
            }
            return (b.date || '').localeCompare(a.date || '');
        });

    const visibleRulings = filteredRulings.slice(0, visibleCount);
    const hasMore = visibleCount < filteredRulings.length;

    // Count items per court for badges
    const courtCounts = {
        all: rulings.length,
        scotus: rulings.filter(r => r.courtType === 'scotus').length,
        federal_appeals: rulings.filter(r => r.courtType === 'federal_appeals').length,
        district: rulings.filter(r => r.courtType === 'district').length,
    };

    // Infinite scroll with IntersectionObserver
    const loadMore = useCallback(() => {
        setVisibleCount(prev => prev + PAGE_SIZE);
    }, []);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore) {
                    loadMore();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadMore]);

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h1 className={styles.title}>⚖️ Court Rulings</h1>
                <p className={styles.subtitle}>Recent judicial decisions explained in plain English</p>
            </div>

            {/* Filter Bar — Court tabs + Sort */}
            <div className={styles.filterBar}>
                <div className={styles.filterGroup}>
                    {[
                        { id: 'all', label: 'All Courts' },
                        { id: 'scotus', label: 'Supreme Court' },
                        { id: 'federal_appeals', label: 'Appeals' },
                        { id: 'district', label: 'D.C. District' },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.filterPill} ${courtFilter === f.id ? styles.filterPillActive : ''}`}
                            onClick={() => setCourtFilter(f.id)}
                        >
                            {f.label}
                            {courtCounts[f.id] > 0 && (
                                <span className={styles.countBadge}>{courtCounts[f.id]}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className={styles.sortGroup}>
                    {[
                        { id: 'recent', label: '🕐 Recent' },
                        { id: 'impact', label: '⚡ Impact' },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.sortPill} ${sortBy === f.id ? styles.sortPillActive : ''}`}
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
                        {courtFilter !== 'all'
                            ? 'No rulings for this court yet. Check back later.'
                            : 'Check back later for new rulings.'}
                    </div>
                </div>
            )}

            {/* Rulings List */}
            {!isLoading && !error && visibleRulings.length > 0 && (
                <div className={styles.rulingsList}>
                    {visibleRulings.map(item => (
                        <FeedCard key={item.id} item={item} profile={profile} />
                    ))}

                    {/* Infinite scroll sentinel */}
                    {hasMore && (
                        <div ref={sentinelRef} className={styles.loadMoreSentinel}>
                            <div className={styles.spinner} />
                            <span className={styles.loadingText}>Loading more rulings...</span>
                        </div>
                    )}

                    {/* End of list indicator */}
                    {!hasMore && (
                        <div className={styles.endOfList}>
                            <div className={styles.endOfListIcon}>⚖️</div>
                            <div className={styles.endOfListTitle}>You're all caught up!</div>
                            <div className={styles.endOfListText}>
                                You've seen all {filteredRulings.length} ruling{filteredRulings.length !== 1 ? 's' : ''}{courtFilter !== 'all' ? ' in this court' : ''}. New rulings are added every 6 hours.
                            </div>
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
