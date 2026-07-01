import { NextResponse } from 'next/server';
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const CACHE_KEYS = [
    '_court_cache_scotus_v1_',
    '_court_cache_appeals_v1_',
    '_court_cache_district_v1_',
];

/**
 * POST /api/admin/reset-court-cache
 * Resets the fetchedAt timestamp on all court caches so the next
 * page load triggers a fresh fetch from CourtListener.
 * Protected by CRON_SECRET.
 */
export async function POST(request) {
    try {
        const { secret } = await request.json();
        if (secret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const results = [];
        for (const key of CACHE_KEYS) {
            const ref = doc(db, 'billSummaries', key);
            const snap = await getDoc(ref);
            if (snap.exists()) {
                const data = snap.data();
                await setDoc(ref, { ...data, fetchedAt: 0 });
                results.push({ key, idsCount: (data.ids || []).length, reset: true });
            } else {
                results.push({ key, reset: false, reason: 'not found' });
            }
        }

        return NextResponse.json({ success: true, results });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
