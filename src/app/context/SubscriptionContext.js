'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { useAuth } from './AuthContext';
import { db } from '../lib/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getApiBase } from '../lib/apiUrl';

const SubscriptionContext = createContext({ isPro: false, subscription: null, loading: true });

export function useSubscription() {
    return useContext(SubscriptionContext);
}

// ── RevenueCat Plugin ────────────────────────────────────────────────────────
let RCPlugin = null;
function getRevenueCat() {
    if (!RCPlugin && typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
        try {
            // The plugin registers itself as 'Purchases' via @capacitor/core
            RCPlugin = registerPlugin('Purchases');
        } catch (e) {
            console.log('[RC] Plugin not available:', e.message);
            return null;
        }
    }
    return RCPlugin;
}

const RC_API_KEY = 'appl_ijxbakLWpsbXAiRuduSsiYAqWFc';

export function SubscriptionProvider({ children }) {
    const { user } = useAuth();
    const [subscription, setSubscription] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isNative] = useState(() => typeof window !== 'undefined' && Capacitor.isNativePlatform());
    const [rcReady, setRcReady] = useState(false);

    // ── Initialize RevenueCat on native ──────────────────────────────────────
    useEffect(() => {
        if (!isNative) return;

        async function initRC() {
            const RC = getRevenueCat();
            if (!RC) return;

            try {
                await RC.configure({ apiKey: RC_API_KEY });
                console.log('[RC] Configured successfully');
                setRcReady(true);
            } catch (e) {
                console.warn('[RC] Configure failed:', e.message);
            }
        }

        initRC();
    }, [isNative]);

    // ── Identify user with RevenueCat (links RC to Firebase UID) ─────────────
    useEffect(() => {
        if (!isNative || !rcReady || !user?.uid) return;

        async function identifyUser() {
            const RC = getRevenueCat();
            if (!RC) return;

            try {
                await RC.logIn({ appUserID: user.uid });
                console.log('[RC] User identified:', user.uid);
            } catch (e) {
                console.warn('[RC] Login failed:', e.message);
            }
        }

        identifyUser();
    }, [isNative, rcReady, user?.uid]);

    // ── Firestore subscription listener (works for both Stripe and IAP) ──────
    useEffect(() => {
        if (!user) {
            setSubscription(null);
            setLoading(false);
            return;
        }

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

    // Admin accounts always get Pro access
    const ADMIN_EMAILS = ['patrickrv3@gmail.com'];
    const isAdmin = ADMIN_EMAILS.includes(user?.email);
    const isPro = isAdmin || subscription?.status === 'active';

    // ── Native IAP Purchase (RevenueCat) ─────────────────────────────────────
    const purchasePro = useCallback(async () => {
        const RC = getRevenueCat();
        if (!RC) {
            console.error('[RC] Plugin not available for purchase');
            return false;
        }

        try {
            // Get current offerings
            const offerings = await RC.getOfferings();
            const currentOffering = offerings.current;

            if (!currentOffering?.availablePackages?.length) {
                console.error('[RC] No packages available');
                alert('Unable to load subscription. Please try again later.');
                return false;
            }

            // Purchase the first available package (monthly pro)
            const pkg = currentOffering.availablePackages[0];
            const result = await RC.purchasePackage({ aPackage: pkg });
            console.log('[RC] Purchase result:', JSON.stringify(result.customerInfo?.entitlements));

            // Write Pro status directly to Firestore for immediate UI update
            if (user?.uid) {
                await setDoc(doc(db, 'users', user.uid, 'subscription', 'pro'), {
                    status: 'active',
                    plan: 'pro',
                    store: 'app_store',
                    activatedAt: Date.now(),
                    updatedAt: Date.now(),
                }, { merge: true });
                console.log('[RC] Purchase successful — Firestore updated');
                return true;
            }

            return false;
        } catch (e) {
            if (e.code === 1 || e.message?.includes('cancelled') || e.message?.includes('canceled')) {
                console.log('[RC] Purchase cancelled by user');
                return false;
            }
            console.error('[RC] Purchase error:', e);
            alert('Purchase failed. Please try again.');
            return false;
        }
    }, [user]);

    // ── Restore Purchases (Apple requirement) ────────────────────────────────
    const restorePurchases = useCallback(async () => {
        const RC = getRevenueCat();
        if (!RC) return false;

        try {
            const result = await RC.restorePurchases();
            console.log('[RC] Restore result:', JSON.stringify(result.customerInfo?.entitlements));

            // Check if any entitlement is active (entitlement name may vary)
            const activeEntitlements = result.customerInfo?.entitlements?.active;
            if (activeEntitlements && Object.keys(activeEntitlements).length > 0) {
                if (user?.uid) {
                    await setDoc(doc(db, 'users', user.uid, 'subscription', 'pro'), {
                        status: 'active',
                        plan: 'pro',
                        store: 'app_store',
                        activatedAt: Date.now(),
                        updatedAt: Date.now(),
                    }, { merge: true });
                }
                console.log('[RC] Restore successful — Pro active');
                return true;
            }
            console.log('[RC] Restore complete — no active entitlement');
            return false;
        } catch (e) {
            console.error('[RC] Restore error:', e);
            return false;
        }
    }, [user]);

    // ── Web Stripe Checkout ──────────────────────────────────────────────────
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

    // ── Web Stripe Portal ────────────────────────────────────────────────────
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
        <SubscriptionContext.Provider value={{
            isPro,
            subscription,
            loading,
            isNative,
            rcReady,
            startCheckout,
            openPortal,
            purchasePro,
            restorePurchases,
        }}>
            {children}
        </SubscriptionContext.Provider>
    );
}
