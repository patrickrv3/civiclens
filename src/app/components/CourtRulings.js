'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './CourtRulings.module.css';
import FeedCard from './FeedCard';
import { useProfile } from '../context/ProfileContext';
import { useSubscription } from '../context/SubscriptionContext';
import { useCourtRulings } from '../context/CourtRulingsContext';
import UpgradeModal from './UpgradeModal';

const PAGE_SIZE = 10;

// Court tabs that require Pro on web
const PRO_COURTS = new Set(['federal_appeals', 'district']);

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
            // Non-Pro web users can only see SCOTUS rulings
            if (!canSeeAll && item.courtType !== 'scotus') return false;
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
        all: canSeeAll ? rulings.length : rulings.filter(r => r.courtType === 'scotus').length,
        scotus: rulings.filter(r => r.courtType === 'scotus').length,
        federal_appeals: rulings.filter(r => r.courtType === 'federal_appeals').length,
        district: rulings.filter(r => r.courtType === 'district').length,
    };

    // Handle court filter click — intercept locked tabs for non-Pro web users
    const handleCourtFilter = (courtId) => {
        if (!canSeeAll && PRO_COURTS.has(courtId)) {
            setShowUpgradeModal(true);
            return;
        }
        setCourtFilter(courtId);
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
                        { id: 'federal_appeals', label: 'Appeals', locked: !canSeeAll },
                        { id: 'district', label: 'D.C. District', locked: !canSeeAll },
                    ].map(f => (
                        <button
                            key={f.id}
                            className={`${styles.filterPill} ${courtFilter === f.id ? styles.filterPillActive : ''}`}
                            onClick={() => handleCourtFilter(f.id)}
                        >
                            {f.label}
                            {f.locked && <span style={{ fontSize: '0.7rem', marginLeft: '4px' }}>🔒</span>}
                            {!f.locked && courtCounts[f.id] > 0 && (
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

            {/* Pro upsell banner — show for non-Pro web users */}
            {!canSeeAll && (
                <div style={{
                    margin: '0 0 16px',
                    padding: '14px 18px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.08))',
                    border: '1px solid rgba(99,102,241,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                }}>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--cl-gray-900)', marginBottom: '2px' }}>
                            🔒 Appeals &amp; D.C. District Courts
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--cl-gray-500)' }}>
                            Upgrade to Pro to access all federal court rulings
                        </div>
                    </div>
                    <button
                        style={{
                            padding: '8px 18px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                            color: '#fff',
                            fontWeight: 600,
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                        onClick={() => setShowUpgradeModal(true)}
                    >
                        Upgrade to Pro
                    </button>
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
                            <div className={styles.endOfListTitle}>You&apos;re all caught up!</div>
                            <div className={styles.endOfListText}>
                                You&apos;ve seen all {filteredRulings.length} ruling{filteredRulings.length !== 1 ? 's' : ''}{courtFilter !== 'all' ? ' in this court' : ''}. New rulings are added daily.
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
