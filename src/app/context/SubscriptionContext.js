'use client';

import { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { getApiBase } from '../lib/apiUrl';

const SubscriptionContext = createContext({ isPro: false, subscription: null, loading: true });

export function useSubscription() {
    return useContext(SubscriptionContext);
}

export function SubscriptionProvider({ children }) {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setSubscription(null);
            setLoading(false);
            return;
        }

        // Listen to the user's subscription doc in real time
        const subRef = doc(db, 'users', user.uid, 'subscription', 'pro');
        const unsubscribe = onSnapshot(subRef, (snap) => {
            if (snap.exists()) {
                setSubscription(snap.data());
            } else {
                setSubscription(null);
            }
            setLoading(false);
        }, (err) => {
            console.warn('Subscription listener error:', err);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const isPro = subscription?.status === 'active';

    const startCheckout = async () => {
        if (!user) return;
        try {
            const res = await fetch(`${getApiBase()}/api/stripe-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: user.uid, email: user.email }),
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (err) {
            console.error('Checkout error:', err);
        }
    };

    const openPortal = async () => {
        if (!subscription?.stripeCustomerId) return;
        try {
            const res = await fetch(`${getApiBase()}/api/stripe-portal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ customerId: subscription.stripeCustomerId }),
            });
            const data = await res.json();
            if (data.url) window.location.href = data.url;
        } catch (err) {
            console.error('Portal error:', err);
        }
    };

    return (
        <SubscriptionContext.Provider value={{ isPro, subscription, loading, startCheckout, openPortal }}>
            {children}
        </SubscriptionContext.Provider>
    );
}
