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
    const [showCourtInfo, setShowCourtInfo] = useState(false);
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    const sentinelRef = useRef(null);

    const canSeeAll = isPro;

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
                    <button
                        onClick={() => setShowCourtInfo(prev => !prev)}
                        title="About court rulings"
                        style={{
                            background: 'none', border: '1px solid var(--cl-border, #333)',
                            borderRadius: '50%', width: '26px', height: '26px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--cl-text-secondary, #999)',
                            fontSize: '0.75rem', fontWeight: 600, fontStyle: 'italic',
                            flexShrink: 0, marginLeft: '4px',
                        }}
                    >
                        i
                    </button>
                </div>
            </div>

            {showCourtInfo && (
                <div
                    onClick={() => setShowCourtInfo(false)}
                    style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                        zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '24px',
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--cl-card-bg, #1a1a2e)', border: '1px solid var(--cl-border, #333)',
                            borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '380px',
                            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                            fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--cl-text-primary, #e0e0e0)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <strong style={{ fontSize: '1rem' }}>ℹ️ About Court Rulings</strong>
                            <button onClick={() => setShowCourtInfo(false)} style={{ background: 'none', border: 'none', color: 'var(--cl-text-secondary, #999)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}>✕</button>
                        </div>
                        <p style={{ margin: '0 0 12px 0' }}>
                            We display the most recent judicial opinions from the <strong>U.S. Supreme Court</strong>, <strong>Federal Circuit Courts of Appeals</strong>, and the <strong>D.C. District Court</strong>, covering rulings from the past 90 days.
                        </p>
                        <p style={{ margin: '0 0 12px 0' }}>
                            We maintain a rolling cache of up to <strong>50 rulings per court</strong>, refreshed every 2 hours. Each ruling is summarized by AI to explain the decision in plain English.
                        </p>
                        <p style={{ margin: 0, color: 'var(--cl-text-secondary, #888)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            All summaries are AI-generated and may not capture every legal nuance. Tap any ruling to read the full opinion.
                        </p>
                    </div>
                </div>
            )}

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
            {showUpgradeModal && (
                <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
            )}
        </div>
    );
}
