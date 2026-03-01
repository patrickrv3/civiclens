'use client';

import { useState } from 'react';
import styles from './FeedCard.module.css';

// SVG Icons
const AlertCircleIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

const MessageSquareIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const UsersIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

const SparklesIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10H12V2Z" /><path d="M12 12 2.1 12" /><path d="M12 12 12 21.9" /><path d="M12 12 19 4.9" />
    </svg>
);

const ThumbsUpIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 10v12" />
        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
);

const ThumbsDownIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 14V2" />
        <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
    </svg>
);

export default function FeedCard({ item, profile }) {
    const [reaction, setReaction] = useState(null); // 'like', 'dislike', or null

    const handleReaction = (type) => {
        if (reaction === type) {
            setReaction(null);
        } else {
            setReaction(type);
        }
    };

    const displayLikes = (item.likes || 0) + (reaction === 'like' ? 1 : 0);
    const displayDislikes = (item.dislikes || 0) + (reaction === 'dislike' ? 1 : 0);

    const formatNumber = (num) => {
        if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
        return num;
    };

    // Determine if we should show a personalized impact statement
    let personalizedImpact = null;

    if (profile.wantsPersonalizedImpact && profile.lifeTags && profile.lifeTags.length > 0) {
        // Find the first relevant impact based on user's selected tags
        for (const tag of profile.lifeTags) {
            if (item.tagImpacts && item.tagImpacts[tag]) {
                personalizedImpact = item.tagImpacts[tag];
                break; // Show the first one we find for brevity
            }
        }
    }

    // Determine badge class dynamically
    let badgeClass = styles.badgeBill;
    if (item.type === 'Executive') badgeClass = styles.badgeExecutive;
    if (item.type === 'Court') badgeClass = styles.badgeCourt;
    if (item.type === 'Law') badgeClass = styles.badgeLaw;

    return (
        <article className={styles.feedCard}>
            <div className={styles.feedHeader}>
                <div className={styles.feedMeta}>
                    <span className={`${styles.feedBadge} ${badgeClass}`}>{item.type}</span>
                    <span className={styles.feedTime}>{item.level} • {item.date}</span>
                </div>
                <div className={styles.feedImpact} style={{
                    color: item.impactLevel === 'High Impact' ? '#dc2626' :
                        item.impactLevel === 'Moderate Impact' ? '#ea580c' : '#38bdf8'
                }}>
                    <AlertCircleIcon /> {item.impactLevel}
                </div>
            </div>

            {item.status && (() => {
                const statusColors = {
                    'Introduced': { bg: '#f3f4f6', color: '#4b5563' },
                    'In Committee': { bg: '#dbeafe', color: '#1d4ed8' },
                    'Passed House': { bg: '#ede9fe', color: '#7c3aed' },
                    'Passed Senate': { bg: '#ede9fe', color: '#7c3aed' },
                    'Passed Both Chambers': { bg: '#fce7f3', color: '#be185d' },
                    'Signed into Law': { bg: '#dcfce7', color: '#16a34a' },
                    'Failed': { bg: '#fee2e2', color: '#dc2626' },
                };
                const sc = statusColors[item.status] || statusColors['Introduced'];
                return (
                    <div style={{ marginBottom: '6px' }}>
                        <span style={{
                            display: 'inline-block',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            background: sc.bg,
                            color: sc.color,
                            letterSpacing: '0.02em',
                        }}>
                            {item.status}
                        </span>
                        {item.latestAction && (
                            <span style={{ fontSize: '0.75rem', color: '#9ca3af', marginLeft: '8px' }}>
                                {item.latestAction}
                            </span>
                        )}
                    </div>
                );
            })()}

            <h4 className={styles.feedTitle}>{item.shortTitle || item.title}</h4>

            <div className={styles.aiSummary}>
                <div className={styles.aiHeader}>
                    <SparklesIcon />
                    AI Summary
                </div>
                <p className={styles.aiText}>
                    {item.generalSummary}

                    {personalizedImpact && (
                        <>
                            <br /><br />
                            <strong>Why it matters to you:</strong> {personalizedImpact}
                        </>
                    )}
                </p>
            </div>

            {item.originalTitle && item.url && (
                <div className={styles.originalSource}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--cl-gray-500)', fontStyle: 'italic', marginBottom: '16px' }}>
                        <strong>Official Bill:</strong> <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cl-primary-600)', textDecoration: 'underline' }}>{item.originalTitle}</a>
                    </p>
                </div>
            )}

            <div className={styles.feedFooter}>
                <div style={{ display: 'flex', gap: '8px', marginRight: 'auto' }}>
                    <button
                        className={`${styles.actionBtn} ${reaction === 'like' ? styles.activeLike : ''}`}
                        onClick={() => handleReaction('like')}
                        aria-label="Like"
                    >
                        <ThumbsUpIcon />
                        <span className={styles.reactionCount}>{formatNumber(displayLikes)}</span>
                    </button>
                    <button
                        className={`${styles.actionBtn} ${reaction === 'dislike' ? styles.activeDislike : ''}`}
                        onClick={() => handleReaction('dislike')}
                        aria-label="Dislike"
                    >
                        <ThumbsDownIcon />
                        <span className={styles.reactionCount}>{formatNumber(displayDislikes)}</span>
                    </button>
                </div>

                <button className={styles.actionBtn}>
                    <MessageSquareIcon /> Ask AI
                </button>
                {item.sponsors && item.sponsors.length > 0 && (
                    <button className={styles.actionBtn}>
                        <UsersIcon /> See Sponsors
                    </button>
                )}
            </div>
        </article>
    );
}
