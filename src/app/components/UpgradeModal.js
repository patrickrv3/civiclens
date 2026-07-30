'use client';

import { useState } from 'react';
import styles from './UpgradeModal.module.css';
import { useSubscription } from '../context/SubscriptionContext';
import { useAuth } from '../context/AuthContext';

const CheckIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

const CloseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

const proFeatures = [
    'State & Local legislation for your area',
    'Watch bills & get in-app status notifications',
    'Unlimited personalized feed',
    'Early access to new features',
];

export default function UpgradeModal({ onClose }) {
    const { startCheckout, purchasePro, restorePurchases, isNative } = useSubscription();
    const { user } = useAuth();
    const [purchasing, setPurchasing] = useState(false);
    const [restoring, setRestoring] = useState(false);

    const handleUpgrade = async () => {
        if (!user) {
            window.dispatchEvent(new CustomEvent('civiclens:openAuth'));
            onClose();
            return;
        }

        setPurchasing(true);
        try {
            if (isNative) {
                const success = await purchasePro();
                if (success) onClose();
            } else {
                await startCheckout();
            }
        } finally {
            setPurchasing(false);
        }
    };

    const handleRestore = async () => {
        setRestoring(true);
        try {
            const success = await restorePurchases();
            if (success) {
                onClose();
            } else {
                alert('No active subscription found. If you believe this is an error, please contact support.');
            }
        } finally {
            setRestoring(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className={styles.modal}>
                <button className={styles.closeBtn} onClick={onClose}><CloseIcon /></button>

                <div className={styles.badge}>Civisly Pro</div>
                <h2 className={styles.title}>Unlock the full picture</h2>
                <p className={styles.subtitle}>
                    Get access to state & local legislation, bill tracking, and real-time notifications — all for less than a coffee a month.
                </p>

                <div className={styles.price}>
                    <span className={styles.amount}>$4.99</span>
                    <span className={styles.period}>/month</span>
                </div>

                <ul className={styles.features}>
                    {proFeatures.map(f => (
                        <li key={f} className={styles.feature}>
                            <span className={styles.checkIcon}><CheckIcon /></span>
                            {f}
                        </li>
                    ))}
                </ul>

                <button
                    className={styles.upgradeBtn}
                    onClick={handleUpgrade}
                    disabled={purchasing}
                >
                    {purchasing ? 'Processing...' : 'Upgrade to Pro →'}
                </button>

                {isNative && (
                    <button
                        onClick={handleRestore}
                        disabled={restoring}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: '#6366f1',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: '8px',
                            marginTop: '4px',
                            width: '100%',
                            textAlign: 'center',
                        }}
                    >
                        {restoring ? 'Restoring...' : 'Restore Purchases'}
                    </button>
                )}

                <p className={styles.fine}>
                    Cancel anytime. {isNative
                        ? 'Subscription renews automatically. Manage in Settings → Apple ID → Subscriptions.'
                        : 'Billed monthly via Stripe.'}
                </p>
            </div>
        </div>
    );
}
