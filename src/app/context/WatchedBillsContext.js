'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
    collection, doc, setDoc, deleteDoc,
    onSnapshot, addDoc, updateDoc, query, orderBy, serverTimestamp, getDocs
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from './AuthContext';

const WatchedBillsContext = createContext(null);

export function WatchedBillsProvider({ children }) {
    const { user } = useAuth();
    const [watchedBills, setWatchedBills] = useState([]);
    const [notifications, setNotifications] = useState([]);
    const [isChecking, setIsChecking] = useState(false);

    const unreadCount = notifications.filter(n => !n.read).length;

    // Real-time listener for watched bills
    useEffect(() => {
        if (!user) {
            setWatchedBills([]);
            setNotifications([]);
            return;
        }

        const watchedRef = collection(db, 'users', user.uid, 'watchedBills');
        const unsubWatched = onSnapshot(watchedRef, (snap) => {
            setWatchedBills(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const notifRef = query(
            collection(db, 'users', user.uid, 'notifications'),
            orderBy('createdAt', 'desc')
        );
        const unsubNotifs = onSnapshot(notifRef, (snap) => {
            setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        return () => { unsubWatched(); unsubNotifs(); };
    }, [user]);

    // Check for status changes on load
    useEffect(() => {
        if (!user || watchedBills.length === 0 || isChecking) return;

        const checkStatuses = async () => {
            setIsChecking(true);
            try {
                // Separate bills from court rulings
                const bills = watchedBills.filter(b => !b.id.startsWith('court-'));
                const rulings = watchedBills.filter(b => b.id.startsWith('court-'));

                // Check bill statuses
                if (bills.length > 0) {
                    const res = await fetch('/api/check-bill-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            bills: bills.map(b => ({
                                id: b.id,
                                billIdentifier: b.billIdentifier,
                                level: b.level,
                                state: b.state,
                                status: b.status,
                            }))
                        }),
                    });
                    if (res.ok) {
                        const { results } = await res.json();
                        for (const result of results) {
                            if (result.changed) {
                                const billRef = doc(db, 'users', user.uid, 'watchedBills', result.id);
                                await updateDoc(billRef, { status: result.currentStatus });
                                const notifRef = collection(db, 'users', user.uid, 'notifications');
                                await addDoc(notifRef, {
                                    billId: result.id,
                                    billTitle: result.title,
                                    oldStatus: result.oldStatus,
                                    newStatus: result.currentStatus,
                                    type: 'bill',
                                    createdAt: serverTimestamp(),
                                    read: false,
                                });
                            }
                        }
                    }
                }

                // Check court ruling statuses
                if (rulings.length > 0) {
                    const res = await fetch('/api/check-ruling-status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            rulings: rulings.map(r => ({
                                id: r.id,
                                status: r.status,
                                title: r.shortTitle || r.title || '',
                            }))
                        }),
                    });
                    if (res.ok) {
                        const { results } = await res.json();
                        for (const result of results) {
                            if (result.changed) {
                                const rulingRef = doc(db, 'users', user.uid, 'watchedBills', result.id);
                                await updateDoc(rulingRef, { status: result.currentStatus });
                                const notifRef = collection(db, 'users', user.uid, 'notifications');
                                await addDoc(notifRef, {
                                    billId: result.id,
                                    billTitle: result.title,
                                    oldStatus: result.oldStatus,
                                    newStatus: result.currentStatus,
                                    type: 'ruling',
                                    createdAt: serverTimestamp(),
                                    read: false,
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Status check failed:', err);
            } finally {
                setIsChecking(false);
            }
        };

        const timer = setTimeout(checkStatuses, 2000);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, watchedBills.length]);

    const watchBill = useCallback(async (item) => {
        if (!user) return false;
        const billRef = doc(db, 'users', user.uid, 'watchedBills', item.id);
        await setDoc(billRef, {
            id: item.id,
            title: item.originalTitle || item.shortTitle || item.title || '',
            shortTitle: item.shortTitle || item.title || '',
            status: item.status || 'Introduced',
            level: item.level || 'Federal',
            state: item.state || null,
            url: item.url || '',
            billIdentifier: item.billIdentifier || item.id,
            watchedAt: serverTimestamp(),
        });
        return true;
    }, [user]);

    const unwatchBill = useCallback(async (billId) => {
        if (!user) return;
        const billRef = doc(db, 'users', user.uid, 'watchedBills', billId);
        await deleteDoc(billRef);
    }, [user]);

    const markAllRead = useCallback(async () => {
        if (!user) return;
        const notifRef = collection(db, 'users', user.uid, 'notifications');
        const snap = await getDocs(notifRef);
        await Promise.all(
            snap.docs
                .filter(d => !d.data().read)
                .map(d => updateDoc(doc(db, 'users', user.uid, 'notifications', d.id), { read: true }))
        );
    }, [user]);

    const clearNotification = useCallback(async (notifId) => {
        if (!user) return;
        await deleteDoc(doc(db, 'users', user.uid, 'notifications', notifId));
    }, [user]);

    const isWatching = useCallback((billId) => {
        return watchedBills.some(b => b.id === billId);
    }, [watchedBills]);

    return (
        <WatchedBillsContext.Provider value={{
            watchedBills,
            notifications,
            unreadCount,
            isChecking,
            watchBill,
            unwatchBill,
            markAllRead,
            clearNotification,
            isWatching,
        }}>
            {children}
        </WatchedBillsContext.Provider>
    );
}

export function useWatchedBills() {
    const ctx = useContext(WatchedBillsContext);
    if (!ctx) throw new Error('useWatchedBills must be used inside WatchedBillsProvider');
    return ctx;
}
