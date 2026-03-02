'use client';

import { useState, useEffect } from 'react';
import styles from './Representatives.module.css';
import { useProfile } from '../context/ProfileContext';
import RepCard from './RepCard';

const MapPinIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
    </svg>
);

const UsersIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
);

export default function Representatives() {
    const { profile } = useProfile();
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        const zipCode = profile?.location?.zipCode;
        if (!zipCode) return;

        setIsLoading(true);
        setError(null);

        fetch('/api/representatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zipCode }),
        })
            .then(res => res.json())
            .then(result => {
                if (result.error) {
                    setError(result.error);
                } else {
                    setData(result);
                }
            })
            .catch(err => setError(err.message))
            .finally(() => setIsLoading(false));
    }, [profile?.location?.zipCode]);

    // No zip code — prompt user
    if (!profile?.location?.zipCode) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h2 className={styles.title}>My Representatives</h2>
                    <p className={styles.subtitle}>Find your elected officials based on your location.</p>
                </div>
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>
                        <MapPinIcon />
                    </div>
                    <h3 className={styles.emptyTitle}>Set your location first</h3>
                    <p className={styles.emptyText}>
                        Click on your profile in the sidebar and enter your zip code so we can find your representatives.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>My Representatives</h2>
                <p className={styles.subtitle}>Your elected officials in Congress based on your zip code.</p>
                {data && (
                    <div className={styles.stateBadge}>
                        <MapPinIcon />
                        {data.stateName} ({data.state})
                    </div>
                )}
            </div>

            {isLoading ? (
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    <p className={styles.loadingText}>Finding your representatives...</p>
                </div>
            ) : error ? (
                <div className={styles.error}>
                    <strong>Error:</strong> {error}
                </div>
            ) : data ? (
                <>
                    {/* Senators */}
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>
                            Your Senators
                            <span className={styles.sectionCount}>{data.senators.length}</span>
                        </h3>
                        <div className={styles.cardList}>
                            {data.senators.length > 0 ? (
                                data.senators.map(m => <RepCard key={m.id} member={m} />)
                            ) : (
                                <p className={styles.emptyText}>No senators found for your state.</p>
                            )}
                        </div>
                    </div>

                    {/* House Members */}
                    <div className={styles.section}>
                        <h3 className={styles.sectionTitle}>
                            Your House Representatives
                            <span className={styles.sectionCount}>{data.houseMembers.length}</span>
                        </h3>
                        <div className={styles.cardList}>
                            {data.houseMembers.length > 0 ? (
                                data.houseMembers.map(m => <RepCard key={m.id} member={m} />)
                            ) : (
                                <p className={styles.emptyText}>No house representatives found for your state.</p>
                            )}
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
}
