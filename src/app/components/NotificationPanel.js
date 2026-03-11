'use client';

import { useWatchedBills } from '../context/WatchedBillsContext';
import { useAuth } from '../context/AuthContext';
import styles from './NotificationPanel.module.css';

const BellIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
);

const TrashIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
    </svg>
);

const EyeOffIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" />
    </svg>
);

function timeAgo(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Math.floor((Date.now() - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationPanel({ onClose }) {
    const { user } = useAuth();
    const {
        watchedBills, notifications, unreadCount,
        markAllRead, clearNotification, unwatchBill, isChecking
    } = useWatchedBills();

    if (!user) {
        return (
            <div className={styles.panel}>
                <div className={styles.header}>
                    <span className={styles.title}>Notifications</span>
                    <button className={styles.closeBtn} onClick={onClose}>✕</button>
                </div>
                <div className={styles.empty}>
                    <div className={styles.emptyIcon}><BellIcon /></div>
                    <p>Sign in to watch bills and receive status notifications.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <span className={styles.title}>
                    Notifications
                    {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
                </span>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isChecking && <span className={styles.checking}>Checking...</span>}
                    {unreadCount > 0 && (
                        <button className={styles.markReadBtn} onClick={markAllRead}>
                            Mark all read
                        </button>
                    )}
                    <button className={styles.closeBtn} onClick={onClose}>✕</button>
                </div>
            </div>

            {/* Notifications */}
            <div className={styles.section}>
                <div className={styles.sectionLabel}>Status Updates</div>
                {notifications.length === 0 ? (
                    <div className={styles.emptySmall}>
                        No status updates yet. Watch some bills and we&apos;ll notify you when they move.
                    </div>
                ) : (
                    <ul className={styles.notifList}>
                        {notifications.map(n => (
                            <li key={n.id} className={`${styles.notifItem} ${!n.read ? styles.unread : ''}`}>
                                <div className={styles.notifContent}>
                                    <div className={styles.notifTitle}>{n.billTitle || n.billId}</div>
                                    <div className={styles.notifChange}>
                                        <span className={styles.oldStatus}>{n.oldStatus}</span>
                                        <span className={styles.arrow}>→</span>
                                        <span className={styles.newStatus}>{n.newStatus}</span>
                                    </div>
                                    <div className={styles.notifTime}>{timeAgo(n.createdAt)}</div>
                                </div>
                                <button
                                    className={styles.deleteBtn}
                                    onClick={() => clearNotification(n.id)}
                                    title="Dismiss"
                                >
                                    <TrashIcon />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Watched Bills */}
            <div className={styles.section}>
                <div className={styles.sectionLabel}>
                    Watching ({watchedBills.length})
                </div>
                {watchedBills.length === 0 ? (
                    <div className={styles.emptySmall}>
                        You&apos;re not watching any bills yet. Click the 🔔 on any feed card to start tracking.
                    </div>
                ) : (
                    <ul className={styles.watchList}>
                        {watchedBills.map(b => (
                            <li key={b.id} className={styles.watchItem}>
                                <div className={styles.watchContent}>
                                    <div className={styles.watchTitle}>{b.shortTitle || b.title || b.id}</div>
                                    <div className={styles.watchStatus}>
                                        <span className={styles.levelTag}>{b.level}</span>
                                        {b.status}
                                    </div>
                                </div>
                                <button
                                    className={styles.unwatchBtn}
                                    onClick={() => unwatchBill(b.id)}
                                    title="Stop watching"
                                >
                                    <EyeOffIcon />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
